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

const TIPOS_ACEITOS = new Set(['image/jpeg', 'image/png', 'application/pdf', 'application/octet-stream'])

export function protocoloNovo() {
  const d = new Date()
  const data = [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0')).join('')
  const aleatorio = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `AP-${data}-${aleatorio}`
}

export const idDeFeira = (nome) => paraNomeArquivo(nome, 60).toLowerCase()

function traduzirErro(e) {
  const codigo = e?.code || ''
  if (codigo.includes('unauthorized') || codigo.includes('permission-denied')) {
    return 'O envio foi recusado pelas regras de segurança. Se a arte tem ressalva, é preciso aceitar o risco antes.'
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
  const tipo = arquivo.type || 'application/octet-stream'
  if (!TIPOS_ACEITOS.has(tipo)) throw new Error(`Tipo de arquivo não aceito para envio: ${tipo}.`)

  aoProgredir?.(0)

  const { app, firestore, storage } = await sessaoAnonima()
  const { cadastro, peca, perfil, veredicto, riscoAceito, laudo } = dados

  const protocolo = protocoloNovo()
  const feiraId = idDeFeira(cadastro.feira)
  const extensao = (arquivo.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
  const nomeNoStorage = `${paraNomeArquivo(cadastro.stand)}__${paraNomeArquivo(perfil.nome)}__${protocolo}${extensao}`
  const caminho = `envios/${feiraId}/${nomeNoStorage}`

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

    const link = await storage.getDownloadURL(alvo)

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
    console.error('falha no envio', e)
    throw new Error(traduzirErro(e))
  }
}
