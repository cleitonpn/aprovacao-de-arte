// Espelha os expositores do app de produção para dentro deste projeto.
//
// Roda numa ação agendada do GitHub, nunca num navegador. É essa a razão de
// existir: são dois projetos Firebase separados, e a alternativa seria a
// ferramenta abrir uma conexão com o projeto da produção direto do navegador
// do analista — o que jogaria a credencial daquele projeto para dentro do
// nosso site. Aqui as duas credenciais ficam em secrets do repositório e nunca
// saem do runner.
//
// O sentido é UM só: produção → ferramenta, e só leitura do lado de lá. Este
// script não escreve nada no projeto do app. Quando chegar a vez do status da
// arte e da prova irem para o app, será uma segunda função aqui, explícita, e
// não um efeito colateral desta.
//
// Secrets necessários no repositório (Settings → Secrets → Actions):
//
//   FIREBASE_SA_PRODUCAO  — service account do projeto do app (montagem-uset),
//                           com permissão de LEITURA no Firestore
//   FIREBASE_SA_ARTE      — service account deste projeto, com escrita
//
// Sem eles o script sai com uma mensagem clara em vez de uma pilha de erro.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COLECAO_ORIGEM = 'fair_clients'
const COLECAO_ESPELHO = 'producao_clientes'
const DOC_ESTADO = 'producao_estado/atual'

// O Firestore aceita 500 operações por lote. 400 deixa folga para o documento
// de estado entrar junto sem estourar.
const POR_LOTE = 400

function credencial(nome) {
  const bruto = process.env[nome]
  if (!bruto) {
    console.error(`\nFalta o secret ${nome}.`)
    console.error('Crie em Settings → Secrets and variables → Actions, colando o JSON inteiro da conta de serviço.\n')
    process.exit(1)
  }
  try {
    return JSON.parse(bruto)
  } catch (e) {
    console.error(`\nO secret ${nome} não é um JSON válido. Cole o arquivo inteiro, incluindo as chaves { }.\n`)
    process.exit(1)
  }
}

/** Só o que esta ferramenta usa. Copiar o resto seria guardar dado de outro
 *  sistema sem ter o que fazer com ele — e assumir a manutenção dele junto. */
function paraEspelho(id, d) {
  const t = (v) => String(v ?? '').trim()
  return {
    producaoId: id,
    fairName: t(d.fairName),
    nome: t(d.nome),
    local: t(d.local),
    pavilhao: t(d.pavilhao),
    area: t(d.area),
    total_area: t(d.total_area),
    produtor: t(d.produtor),
    atendimento: t(d.atendimento),
    organizadora: t(d.organizadora),
    project_link: t(d.project_link),
    link_drive: t(d.link_drive),
    data_montagem: t(d.data_montagem),
    data_evento: t(d.data_evento),
    data_desmontagem: t(d.data_desmontagem),
  }
}

/** Assinatura do conteúdo, para regravar só o que mudou. */
const assinatura = (o) => JSON.stringify(o)

async function principal() {
  const saProducao = credencial('FIREBASE_SA_PRODUCAO')
  const saArte = credencial('FIREBASE_SA_ARTE')

  const producao = getFirestore(initializeApp({ credential: cert(saProducao) }, 'producao'))
  const arte = getFirestore(initializeApp({ credential: cert(saArte) }, 'arte'))

  console.log(`Lendo ${COLECAO_ORIGEM} de ${saProducao.project_id}…`)
  const origem = await producao.collection(COLECAO_ORIGEM).get()
  console.log(`  ${origem.size} expositores.`)

  const espelho = arte.collection(COLECAO_ESPELHO)
  const atuais = await espelho.get()
  const assinaturas = new Map(atuais.docs.map((d) => [d.id, d.data().assinatura || '']))

  let gravados = 0
  let removidos = 0
  const vistos = new Set()
  let lote = arte.batch()
  let noLote = 0

  const enviarLote = async () => {
    if (!noLote) return
    await lote.commit()
    lote = arte.batch()
    noLote = 0
  }

  for (const doc of origem.docs) {
    const dados = paraEspelho(doc.id, doc.data())
    vistos.add(doc.id)
    const marca = assinatura(dados)
    if (assinaturas.get(doc.id) === marca) continue

    lote.set(espelho.doc(doc.id), {
      ...dados,
      assinatura: marca,
      sincronizadoEm: FieldValue.serverTimestamp(),
    })
    gravados += 1
    noLote += 1
    if (noLote >= POR_LOTE) await enviarLote()
  }

  // Expositor que saiu da planilha do app some do espelho. Um projeto já
  // importado NÃO é afetado: ele vive na coleção `projetos`, com token, artes
  // e histórico próprios. O espelho é só a lista de onde se importa.
  for (const doc of atuais.docs) {
    if (vistos.has(doc.id)) continue
    lote.delete(doc.ref)
    removidos += 1
    noLote += 1
    if (noLote >= POR_LOTE) await enviarLote()
  }

  await enviarLote()

  const [colecao, id] = DOC_ESTADO.split('/')
  await arte.collection(colecao).doc(id).set({
    atualizadoEm: FieldValue.serverTimestamp(),
    total: origem.size,
    gravados,
    removidos,
    origem: saProducao.project_id,
  })

  console.log(`Espelho atualizado: ${gravados} gravados, ${removidos} removidos, ${origem.size} no total.`)
}

principal().catch((e) => {
  console.error('A sincronização falhou:', e)
  process.exit(1)
})
