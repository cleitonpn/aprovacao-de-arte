// Os avisos por e-mail do cliente.
//
// Três coisas que o cliente precisava saber e não sabia:
//
//   1. a prova de impressão está pronta e esperando o aceite dele;
//   2. o time devolveu uma arte e precisa da versão corrigida;
//   3. o prazo de envio está acabando e faltam peças.
//
// As duas primeiras são reações a uma mudança no projeto, então rodam num
// gatilho do Firestore — o e-mail sai em segundos, no momento em que o
// analista clica. A terceira não tem mudança nenhuma para reagir (o tempo
// passa, o documento fica parado), então roda uma vez por dia.
//
// A REGRA de quem avisar não mora aqui: mora em `nucleo/avisos.js`, que é o
// mesmo código do site e roda nos testes sem rede nem Firebase. Aqui fica só
// o encanamento — ler, gravar a marca, mandar.

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret, defineString } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { avisosPendentes } from './nucleo/avisos.js'
import { enviarEmail } from './src/correio.js'

const CHAVE_RESEND = defineSecret('RESEND_API_KEY')
const REMETENTE = defineString('REMETENTE', { default: 'Sistema Stands <artes@sistemastands.com>' })
const RESPONDER_PARA = defineString('RESPONDER_PARA', { default: '' })
const ENDERECO_SITE = defineString('ENDERECO_SITE', { default: 'https://sistemastands.com' })

// Ajustável no deploy: o gatilho do Firestore precisa acompanhar a região do
// banco. Se o deploy reclamar de região, é só mudar a variável no workflow —
// não o código.
const REGIAO = process.env.REGIAO_FUNCOES || 'us-central1'

initializeApp()
const bd = getFirestore()

/** Id de documento a partir da chave do aviso — `/` e `.` não valem em id. */
const idDoAviso = (chave) => String(chave).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 400)

// O prazo mora na FEIRA, não no projeto — a tela do cliente lê da origem, e a
// função precisa fazer o mesmo. Ler só o documento do projeto daria um stand
// sempre sem prazo, e o lembrete nunca sairia para ninguém: o tipo de falha
// que não aparece em lugar nenhum, porque a ausência de e-mail é silenciosa.
const feirasEmCache = new Map()

async function comPrazoDaFeira(projeto) {
  const id = projeto?.feiraId
  if (!id) return projeto

  if (!feirasEmCache.has(id)) {
    feirasEmCache.set(id, bd.doc(`feiras/${id}`).get()
      .then((s) => (s.exists ? s.data() : null))
      .catch((erro) => {
        // Feira ilegível não pode derrubar a varredura inteira. Sem ela sobra
        // a cópia guardada no projeto — pior que o ideal, melhor que silêncio.
        logger.warn('feira ilegível; usando o prazo do projeto', { feiraId: id, erro: String(erro) })
        return null
      }))
  }

  const feira = await feirasEmCache.get(id)
  if (!feira) return projeto
  return {
    ...projeto,
    ...(('prazoEnvio' in feira) ? { prazoEnvio: feira.prazoEnvio } : {}),
    ...(feira.nome ? { feira: feira.nome } : {}),
  }
}

/**
 * Manda o que ainda não foi mandado deste projeto.
 *
 * A marca é gravada ANTES do envio, com `create`, que falha se o documento já
 * existe. É isso que torna a repetição inofensiva — e repetição aqui é
 * rotina, não exceção: gatilho de Firestore roda "pelo menos uma vez", e uma
 * peça marcada como impressa reescreve o projeto inteiro sem que nada dos
 * avisos tenha mudado.
 *
 * Se o envio falhar, a marca é apagada. Sem isso, um erro momentâneo do
 * serviço de e-mail silenciaria aquele aviso para sempre — o pior desfecho
 * possível, porque ninguém fica sabendo que ninguém foi avisado.
 */
async function despachar(token, projetoCru, { agora = Date.now() } = {}) {
  const projeto = await comPrazoDaFeira(projetoCru)
  const pendentes = avisosPendentes({ ...projeto, token }, {
    agora,
    base: ENDERECO_SITE.value(),
  })
  if (!pendentes.length) return 0

  let enviados = 0
  for (const aviso of pendentes) {
    const marca = bd.doc(`projetos/${token}/avisos/${idDoAviso(aviso.chave)}`)

    try {
      await marca.create({
        chave: aviso.chave,
        tipo: aviso.tipo,
        para: aviso.para,
        assunto: aviso.assunto,
        em: new Date().toISOString(),
      })
    } catch (erro) {
      // ALREADY_EXISTS: já avisamos. É o caminho normal, não um problema.
      if (erro?.code === 6) continue
      throw erro
    }

    try {
      const id = await enviarEmail({
        chaveApi: CHAVE_RESEND.value(),
        de: REMETENTE.value(),
        responderPara: RESPONDER_PARA.value() || undefined,
        para: aviso.para,
        assunto: aviso.assunto,
        texto: aviso.texto,
        html: aviso.html,
      })
      await marca.set({ envioId: id ?? null }, { merge: true })
      enviados += 1
      logger.info('aviso enviado', { token, tipo: aviso.tipo, chave: aviso.chave, envioId: id })
    } catch (erro) {
      await marca.delete().catch(() => {})
      logger.error('falha ao enviar aviso', { token, chave: aviso.chave, erro: String(erro) })
      throw erro
    }
  }

  return enviados
}

/**
 * Prova pronta e arte devolvida: reagem à escrita do analista.
 *
 * Um gatilho só para os dois porque os dois são a mesma pergunta — "mudou
 * alguma coisa que o cliente precisa saber?" — e quem responde é o núcleo.
 */
export const avisarAoMudarProjeto = onDocumentWritten(
  { document: 'projetos/{token}', region: REGIAO, secrets: [CHAVE_RESEND], retry: false },
  async (evento) => {
    const depois = evento.data?.after
    if (!depois?.exists) return
    await despachar(evento.params.token, depois.data())
  },
)

/**
 * Lembrete de prazo, uma vez por dia.
 *
 * 9h de Brasília: cedo o bastante para o dia ainda render, tarde o bastante
 * para não chegar de madrugada. Quem já mandou tudo não recebe nada — cobrar
 * quem não deve é como se ensina o cliente a ignorar os nossos e-mails.
 */
export const avisarPrazo = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'America/Sao_Paulo',
    region: REGIAO,
    secrets: [CHAVE_RESEND],
  },
  async () => {
    const pagina = await bd.collection('projetos').get()
    let enviados = 0
    let falhas = 0
    // Uma feira tem centenas de stands e um prazo só: sem o cache seriam
    // centenas de leituras idênticas por dia.
    feirasEmCache.clear()

    for (const doc of pagina.docs) {
      try {
        enviados += await despachar(doc.id, doc.data())
      } catch (erro) {
        // Um projeto com problema não pode calar a feira inteira.
        falhas += 1
        logger.error('projeto falhou no lembrete', { token: doc.id, erro: String(erro) })
      }
    }

    logger.info('lembrete do dia', { projetos: pagina.size, enviados, falhas })
  },
)
