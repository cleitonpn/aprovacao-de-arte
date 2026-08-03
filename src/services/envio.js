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
import { paraNomeArquivo, idDeFeira } from '../data/cadastro.js'
import { semIndefinidos } from '../core/mensagem.js'

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

// Arquivos de apoio (logo, fontes, manual de marca) não passam pela análise —
// não são peça, não têm tamanho impresso, não têm veredicto. Vão para um
// prefixo separado no armazenamento justamente para que as regras da arte
// possam continuar estritas: lá só entram JPG, PNG e PDF.
const TIPO_AVULSO_POR_EXTENSAO = {
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  ai: 'application/postscript',
  eps: 'application/postscript',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  zip: 'application/zip',
}

export const EXTENSOES_AVULSAS = Object.keys(TIPO_AVULSO_POR_EXTENSAO)

export function protocoloNovo() {
  const d = new Date()
  const data = [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0')).join('')
  const aleatorio = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `AP-${data}-${aleatorio}`
}

export { idDeFeira }

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
  const { cadastro, peca, perfil, veredicto, riscoAceito, laudo, projeto } = dados
  const tipo = TIPO_POR_FORMATO[laudo?.arquivo?.formato]
  if (!tipo) {
    throw new Error(`Este formato (${laudo?.arquivo?.formato || 'desconhecido'}) não pode ser enviado. Exporte em PDF, JPG ou PNG.`)
  }

  aoProgredir?.(0)

  const { app, firestore, storage } = await sessaoAnonima()

  const protocolo = protocoloNovo()
  const feiraId = idDeFeira(cadastro.feira)
  const extensao = (arquivo.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
  // Quando o envio vem de um projeto cadastrado, o nome da peça é o do projeto
  // — é o que o time reconhece na pasta de downloads. Sem projeto, sobra o
  // nome do tipo de peça, que é o que a ferramenta sabe.
  const rotuloPeca = projeto?.pecaRotulo || perfil.nome
  const nomeNoStorage = `${paraNomeArquivo(cadastro.stand)}__${paraNomeArquivo(rotuloPeca)}__${protocolo}${extensao}`
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
    await firestore.setDoc(firestore.doc(bd, 'envios', protocolo), semIndefinidos({
      protocolo,
      status: 'concluido',
      tipoEnvio: 'arte',
      feiraId,
      feira: cadastro.feira,
      // Amarra o arquivo à peça cadastrada. É o que permite ao painel dizer o
      // que ainda falta, em vez de só listar o que chegou.
      projetoId: projeto?.token || null,
      pecaId: projeto?.pecaId || null,
      pecaRotulo: projeto?.pecaRotulo || null,
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
    }))

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

/**
 * Envio de arquivo de apoio: logo, fonte, manual de marca.
 *
 * Vai sem análise, e é assim de propósito. Um logo em SVG não tem tamanho
 * impresso nem resolução — reprovar por "menos de 150 dpi" seria absurdo, e
 * obrigar o cliente a inventar uma medida para conseguir mandar o logo é
 * exatamente o tipo de atrito que faz o material chegar por WhatsApp de novo.
 *
 * @param {File} arquivo
 * @param {object} dados { cadastro, projeto: {token}, descricao }
 */
export async function enviarAvulso(arquivo, dados, aoProgredir) {
  if (!envioConfigurado()) throw new Error('O envio não está configurado nesta instalação.')

  const limite = ENVIO.tamanhoMaximoAvulsoMb * 1024 * 1024
  if (arquivo.size > limite) {
    throw new Error(`O arquivo tem ${(arquivo.size / 1048576).toFixed(0)} MB e o limite para arquivos de apoio é ${ENVIO.tamanhoMaximoAvulsoMb} MB.`)
  }

  const { cadastro, projeto, descricao } = dados
  const ext = (arquivo.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  const tipo = TIPO_AVULSO_POR_EXTENSAO[ext]
  if (!tipo) {
    throw new Error(`Arquivos .${ext || '(sem extensão)'} não são aceitos aqui. Envie ${EXTENSOES_AVULSAS.map((e) => `.${e}`).join(', ')} — ou compacte tudo num .zip.`)
  }

  aoProgredir?.(0)
  const { app, firestore, storage } = await sessaoAnonima()

  const protocolo = protocoloNovo()
  const feiraId = idDeFeira(cadastro.feira)
  const nomeNoStorage = `${paraNomeArquivo(cadastro.stand)}__apoio__${protocolo}.${ext}`
  const caminho = `avulsos/${feiraId}/${nomeNoStorage}`

  let etapa = 'arquivo'
  try {
    const alvo = storage.ref(storage.getStorage(app), caminho)
    const tarefa = storage.uploadBytesResumable(alvo, arquivo, {
      contentType: tipo,
      customMetadata: { protocolo, expositor: cadastro.nome, stand: cadastro.stand, feira: cadastro.feira },
    })
    await new Promise((resolve, reject) => {
      tarefa.on('state_changed', (s) => aoProgredir?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject, resolve)
    })

    let link = null
    try {
      link = await storage.getDownloadURL(alvo)
    } catch (e) {
      console.warn('arquivo de apoio enviado, mas não foi possível gerar o link', e)
    }

    etapa = 'registro'
    const bd = firestore.getFirestore(app)
    await firestore.setDoc(firestore.doc(bd, 'envios', protocolo), semIndefinidos({
      protocolo,
      status: 'concluido',
      tipoEnvio: 'avulso',
      feiraId,
      feira: cadastro.feira,
      projetoId: projeto?.token || null,
      pecaId: null,
      pecaRotulo: descricao || 'Arquivo de apoio',
      cadastro,
      arquivo: { nome: arquivo.name, tamanho: arquivo.size, tipo, sha256: null },
      caminho,
      link,
      criadoEm: firestore.serverTimestamp(),
    }))

    aoProgredir?.(1)
    return { protocolo, link, nomeNoStorage }
  } catch (e) {
    console.error(`falha no envio de apoio (etapa: ${etapa})`, e)
    throw new Error(traduzirErro(e, etapa))
  }
}
