// Espelha os expositores do app de produção para dentro deste projeto.
//
// Roda numa ação agendada do GitHub, nunca num navegador. É essa a razão de
// existir: são dois projetos Firebase separados, e a alternativa seria a
// ferramenta abrir uma conexão com o projeto da produção direto do navegador
// do analista — o que jogaria a credencial daquele projeto para dentro do
// nosso site. Aqui as duas credenciais ficam em secrets do repositório e nunca
// saem do runner.
//
// São dois sentidos, e eles não se misturam:
//
//   produção → ferramenta   os expositores, para a tela de importação
//   ferramenta → produção   o status da arte e a prova, para o app mostrar
//
// O segundo sentido só toca stands que foram importados (têm `producaoId`) e
// escreve numa coleção própria, `cv_status`. Nunca em `fair_clients`: aquela é
// o espelho da planilha do app e não é nossa para alterar.
//
// Secrets necessários no repositório (Settings → Secrets → Actions):
//
//   FIREBASE_SA_PRODUCAO  — service account do projeto do app (montagem-uset),
//                           com LEITURA em fair_clients e ESCRITA em cv_status
//   FIREBASE_SA_ARTE      — service account deste projeto
//
// Sem eles o script sai com uma mensagem clara em vez de uma pilha de erro.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
// O MESMO motor que a tela do analista usa. Recalcular o estado aqui, com
// outra implementação, garantiria que em uma semana o app mostrasse um status
// que o analista não reconhece.
import { resumoDoProjeto, provasDoProjeto } from '../src/core/fluxo.js'
import { statusParaProducao, eloConfere } from '../src/core/producao.js'

const COLECAO_ORIGEM = 'fair_clients'
const COLECAO_ESPELHO = 'producao_clientes'
const COLECAO_STATUS = 'cv_status'
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

/** produção → ferramenta: os expositores, para a tela de importação. */
async function espelharExpositores(producao, arte, saProducao) {
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

/**
 * ferramenta → produção: o status da arte e a prova de aprovação.
 *
 * Só stands importados entram — os que têm `producaoId`. Um projeto cadastrado
 * à mão, sem elo, não tem para onde ir, e inventar a correspondência pelo nome
 * aqui seria arriscar escrever o status de um stand na ficha de outro.
 */
async function publicarStatusDaArte(producao, arte) {
  console.log('Calculando o status da arte dos stands importados…')
  const snap = await arte.collection('projetos').where('producaoId', '!=', '').get()
  console.log(`  ${snap.size} projetos ligados à produção.`)

  const destino = producao.collection(COLECAO_STATUS)
  const jaLa = await destino.get()
  const assinaturas = new Map(jaLa.docs.map((d) => [d.id, d.data().assinatura || '']))

  // Dois projetos apontando para o MESMO expositor do app.
  //
  // Sem esta conferência, os dois escreviam no mesmo documento e vencia o
  // último do laço — sem erro, sem aviso, e alternando de execução para
  // execução. O efeito aparecia longe daqui: o print de um cliente abrindo na
  // ficha de outro no app de montagem, enquanto na ferramenta de aprovação
  // cada um mostrava o seu, corretamente. Um dos elos está errado (quase sempre
  // um "vincular" no stand errado), e daqui não há como saber qual.
  //
  // Na dúvida, não publicar. O app cai para o link da planilha, que é o
  // comportamento que ele tinha antes desta ponte existir — mostrar nada é
  // ruim, mostrar o cliente errado é pior, porque ninguém desconfia.
  const porProducaoId = new Map()
  for (const doc of snap.docs) {
    const id = doc.get('producaoId')
    if (!id) continue
    porProducaoId.set(id, [...(porProducaoId.get(id) || []), { token: doc.id, stand: doc.get('stand') || '' }])
  }
  const conflitados = new Set()
  for (const [id, lista] of porProducaoId) {
    if (lista.length < 2) continue
    conflitados.add(id)
    console.error(
      `CONFLITO: ${lista.length} projetos apontam para o expositor ${id} — `
      + `${lista.map((p) => `${p.stand || '(sem nome)'} [${p.token}]`).join(', ')}. `
      + 'Nada será publicado para ele até que o elo errado seja desfeito na ficha do stand.',
    )
  }

  // O elo ainda aponta para o mesmo cliente?
  //
  // Esta é a conferência que pega o defeito REAL, e a causa está do outro lado:
  // o id do expositor no app é `nomeDaFeira_númeroDaLinha` — a POSIÇÃO dele na
  // planilha, não um identificador dele. Inserir uma linha, apagar outra ou
  // reordenar a planilha reescreve o id de todo mundo abaixo, e cada cliente
  // herda o id que era do vizinho.
  //
  // A partir daí, `cv_status/feira_12` foi escrito quando a linha 12 era a
  // JadLog, e o app lê esse mesmo documento para a Selia, que hoje ocupa a
  // linha 12. Nenhum dos dois lados parece errado sozinho — o que se perdeu é a
  // correspondência entre eles, e é por isso que só uma conferência explícita
  // acha isso.
  const noApp = new Map(
    (await producao.collection(COLECAO_ORIGEM).get()).docs
      .map((d) => [d.id, { nome: d.get('nome') || '', local: d.get('local') || '' }]),
  )

  const desalinhados = new Set()
  for (const doc of snap.docs) {
    const id = doc.get('producaoId')
    if (!id || conflitados.has(id)) continue
    const veredicto = eloConfere(
      { expositor: doc.get('expositor') || '', stand: doc.get('stand') || '' },
      noApp.get(id),
    )
    if (veredicto.confere) continue
    desalinhados.add(id)
    console.error(
      veredicto.motivo === 'sumiu'
        ? `ELO ÓRFÃO: o projeto ${doc.get('stand') || doc.id} aponta para o expositor ${id}, que não existe mais no app. Nada será publicado para ele.`
        : `ELO TROCADO: o projeto aqui é "${veredicto.esperado}", mas o expositor ${id} no app hoje é "${veredicto.encontrado}". `
          + 'A planilha provavelmente foi reordenada. Nada será publicado para ele até o elo ser refeito.',
    )
  }

  let gravados = 0
  let lote = producao.batch()
  let noLote = 0
  const vistos = new Set()

  for (const doc of snap.docs) {
    const projeto = { token: doc.id, ...doc.data() }
    if (!projeto.producaoId) continue
    // Fora de `vistos` de propósito: assim o laço de limpeza abaixo APAGA o
    // documento que estava lá, tirando do app o print que pode ser do cliente
    // errado. Deixá-lo seria manter no ar exatamente o que se quer parar.
    if (conflitados.has(projeto.producaoId)) continue
    if (desalinhados.has(projeto.producaoId)) continue

    // O mesmo motor da tela do analista, sem segunda implementação.
    const resumo = resumoDoProjeto(projeto)
    const dados = statusParaProducao(projeto, resumo, provasDoProjeto(projeto))
    vistos.add(projeto.producaoId)

    const marca = assinatura(dados)
    if (assinaturas.get(projeto.producaoId) === marca) continue

    lote.set(destino.doc(projeto.producaoId), {
      ...dados,
      assinatura: marca,
      atualizadoEm: FieldValue.serverTimestamp(),
    })
    gravados += 1
    noLote += 1
    if (noLote >= POR_LOTE) { await lote.commit(); lote = producao.batch(); noLote = 0 }
  }

  // Projeto apagado aqui some do app. Sem isto, o app mostraria para sempre o
  // último status de um stand que não existe mais.
  let removidos = 0
  for (const d of jaLa.docs) {
    if (vistos.has(d.id)) continue
    lote.delete(d.ref)
    removidos += 1
    noLote += 1
    if (noLote >= POR_LOTE) { await lote.commit(); lote = producao.batch(); noLote = 0 }
  }

  if (noLote) await lote.commit()
  console.log(`Status publicado: ${gravados} gravados, ${removidos} removidos.`)
}

async function principal() {
  const saProducao = credencial('FIREBASE_SA_PRODUCAO')
  const saArte = credencial('FIREBASE_SA_ARTE')

  const producao = getFirestore(initializeApp({ credential: cert(saProducao) }, 'producao'))
  const arte = getFirestore(initializeApp({ credential: cert(saArte) }, 'arte'))

  await espelharExpositores(producao, arte, saProducao)
  await publicarStatusDaArte(producao, arte)
}

principal().catch((e) => {
  console.error('A sincronização falhou:', e)
  process.exit(1)
})
