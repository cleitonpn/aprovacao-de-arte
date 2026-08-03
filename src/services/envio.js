// Envio da arte aprovada.
//
// O arquivo vai para o Firebase Storage e o laudo para o Firestore, direto do
// navegador — sem servidor nosso no meio e sem login do expositor.
//
// O que autoriza a gravação é uma sessão anônima do Firebase, criada sem
// nenhuma tela. Quem realmente valida é o conjunto de regras
// (`firestore.rules` e `storage.rules`), que roda no servidor do Google: elas
// exigem os campos do cadastro, limitam tipo e tamanho do arquivo e — o mais
// importante para a operação — recusam qualquer envio de arte reprovada, ou
// de arte com ressalva sem o aceite de risco registrado.

import { sessaoAnonima } from './firebase.js'
import { ENVIO, envioConfigurado } from '../config.js'
import { paraNomeArquivo } from '../data/cadastro.js'

// O tipo é derivado do formato que a ANÁLISE detectou pela assinatura
// binária, não do que o navegador informa. Num .ai — ou num PDF escolhido
// pelo gerenciador de arquivos do celular — o navegador costuma mandar
// application/octet-stream ou string vazia, e as regras do Storage recusariam.
const TIPO_POR_FORMATO = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  ai: 'application/pdf', // .ai é PDF por dentro
}

export function protocoloNovo() {
  const d = new Date()
  const data = [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0')).join('')
  const aleatorio = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `AP-${data}-${aleatorio}`
}

export const idDeFeira = (nome) => paraNomeArquivo(nome, 60).toLowerCase()

function traduzirErro(e, etapa) {
  const codigo = e?.code || ''
  if (codigo.includes('unauthorized') || codigo.includes('permission-denied')) {
    // Separar as duas etapas importa: uma recusa no arquivo aponta para as
    // regras do Storage, uma recusa no registro aponta para as do Firestore.
    // Sem isso, a mesma frase serve para dois problemas bem diferentes.
    return etapa === 'arquivo'
      ? 'O envio do arquivo foi recusado pelas regras de segurança do Storage. Confira se elas foram publicadas no console do Firebase.'
      : 'O registro do envio foi recusado pelas regras do Firestore. Se a arte tem ressalva, é preciso aceitar o risco antes.'
  }
  if (codigo.includes('unauthenticated') || codigo.includes('operation-not-allowed')) {
    return 'O login anônimo não está ativado no Firebase. Ative-o em Authentication → Método de login → Anônimo.'
  }
  if (codigo.includes('quota-exceeded')) return 'O espaço de armazenamento acabou. Avise o time de comunicação visual.'
  if (codigo.includes('retry-limit-exceeded') || codigo.includes('unavailable')) {
    return 'A conexão caiu durante o envio. Tente novamente.'
  }
  if (codigo.includes('canceled')) return 'O envio foi cancelado.'
  return e?.message || 'Não foi possível enviar a arte.'
}

/**
 * @param {File} arquivo
 * @param {object} dados  { cadastro, peca, perfil, veredicto, laudo, riscoAceito }
 * @param {(fracao:number)=>void} aoProgredir
 */
export async function enviarArte(arquivo, dados, aoProgredir) {
  if (!envioConfigurado()) throw new Error('O envio não está configurado nesta instalação.')

  const limite = ENVIO.tamanhoMaximoMb * 1024 * 1024
  if (arquivo.size > limite) {
    throw new Error(`O arquivo tem ${(arquivo.size / 1048576).toFixed(0)} MB e o limite é ${ENVIO.tamanhoMaximoMb} MB.`)
  }
  const { cadastro, peca, perfil, veredicto, riscoAceito, laudo } = dados
  const tipo = TIPO_POR_FORMATO[laudo?.arquivo?.formato]
  if (!tipo) {
    throw new Error(`Este formato (${laudo?.arquivo?.formato || 'desconhecido'}) não pode ser enviado. Exporte em PDF, JPG ou PNG.`)
  }

  aoProgredir?.(0)

  const { app, firestore, storage } = await sessaoAnonima()

  const protocolo = protocoloNovo()
  const feiraId = idDeFeira(cadastro.feira)
  const extensao = (arquivo.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
  const nomeNoStorage = `${paraNomeArquivo(cadastro.stand)}__${paraNomeArquivo(perfil.nome)}__${protocolo}${extensao}`
  const caminho = `envios/${feiraId}/${nomeNoStorage}`

  let etapa = 'arquivo'
  try {
    const bucket = storage.getStorage(app)
    const alvo = storage.ref(bucket, caminho)

    // Retomável: numa arte de centenas de MB, uma oscilação de rede não joga
    // fora tudo o que já subiu.
    const tarefa = storage.uploadBytesResumable(alvo, arquivo, {
      contentType: tipo,
      customMetadata: {
        protocolo,
        expositor: cadastro.nome,
        email: cadastro.email,
        stand: cadastro.stand,
        feira: cadastro.feira,
        veredicto,
      },
    })

    await new Promise((resolve, reject) => {
      tarefa.on(
        'state_changed',
        (s) => aoProgredir?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
        reject,
        resolve,
      )
    })

    // O link é conveniência, não requisito. Se a leitura falhar, o arquivo já
    // está guardado e o envio não pode ser perdido por causa disso — o
    // registro guarda o `caminho`, que localiza o arquivo de qualquer forma.
    let link = null
    try {
      link = await storage.getDownloadURL(alvo)
    } catch (e) {
      console.warn('arquivo enviado, mas não foi possível gerar o link de download', e)
    }

    etapa = 'registro'
    const bd = firestore.getFirestore(app)
    // setDoc com merge:false num documento novo — as regras só permitem criar,
    // nunca sobrescrever, então um protocolo já usado é recusado pelo servidor.
    await firestore.setDoc(firestore.doc(bd, 'envios', protocolo), {
      protocolo,
      status: 'concluido',
      feiraId,
      feira: cadastro.feira,
      cadastro,
      peca,
      perfil: { id: perfil.id, nome: perfil.nome },
      veredicto,
      riscoAceito: riscoAceito || null,
      laudo: laudo || null,
      arquivo: {
        nome: arquivo.name,
        tamanho: arquivo.size,
        tipo,
        sha256: laudo?.arquivo?.sha256 || null,
      },
      caminho,
      link,
      criadoEm: firestore.serverTimestamp(),
    })

    // Alimenta o seletor de feiras do painel. Merge para não sobrescrever o
    // que já existe quando o segundo expositor da mesma feira enviar.
    await firestore.setDoc(
      firestore.doc(bd, 'feiras', feiraId),
      { nome: cadastro.feira, atualizadaEm: firestore.serverTimestamp() },
      { merge: true },
    )

    aoProgredir?.(1)
    return { protocolo, link, nomeNoStorage }
  } catch (e) {
    console.error(`falha no envio (etapa: ${etapa})`, e)
    throw new Error(traduzirErro(e, etapa))
  }
}
