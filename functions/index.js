// Os avisos por e-mail do cliente.
//
// Quatro coisas que o cliente precisava saber e não sabia:
//
//   1. o stand dele foi cadastrado, com estas peças e este prazo;
//   2. a prova de impressão está pronta e esperando o aceite dele;
//   3. o time devolveu uma arte e precisa da versão corrigida;
//   4. o prazo de envio está acabando e faltam peças.
//
// As três primeiras são reações a uma mudança no projeto, então rodam num
// gatilho do Firestore — o e-mail sai em segundos, no momento em que o
// analista clica. A última não tem mudança nenhuma para reagir (o tempo
// passa, o documento fica parado), então roda uma vez por dia.
//
// A REGRA de quem avisar não mora aqui: mora em `nucleo/avisos.js`, que é o
// mesmo código do site e roda nos testes sem rede nem Firebase. Aqui fica só
// o encanamento — ler, gravar a marca, mandar.

import { onDocumentWritten, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

import { avisosPendentes } from './nucleo/avisos.js'
import { enviarEmail } from './src/correio.js'
import { assinaturaConfere, lerEvento } from './src/retorno.js'

// A chave do Resend é o único valor secreto aqui, e o único que merece o
// Secret Manager: ela dá poder de mandar e-mail em nome do domínio.
const CHAVE_RESEND = defineSecret('RESEND_API_KEY')

// O segredo com que o Resend assina os avisos de entrega. Sem ele o endereço
// do retorno seria uma porta aberta na internet para qualquer um marcar o
// e-mail de qualquer cliente como "voltou".
const SEGREDO_RETORNO = defineSecret('RESEND_WEBHOOK_SECRET')

// Constantes, não parâmetros configuráveis.
//
// Eu tinha declarado os dois como parâmetros, e o deploy passou a exigir um
// valor para cada um a cada publicação. Configurabilidade custa alguma coisa,
// e aqui não comprava nada: trocar o remetente ou o endereço do site sem
// mexer no código não é um cenário real — o texto dos e-mails, o CNAME e
// estes valores mudam juntos ou não mudam.
//
// `nao-responda` porque o domínio de fato não recebe e-mail (não há MX na
// raiz) e porque toda a tratativa com o cliente acontece dentro do sistema.
const REMETENTE = 'Sistema Stands <nao-responda@sistemastands.com>'
const ENDERECO_SITE = 'https://sistemastands.com'

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
async function despachar(token, projetoCru, { agora = Date.now(), novo = false } = {}) {
  const projeto = await comPrazoDaFeira(projetoCru)
  const pendentes = avisosPendentes({ ...projeto, token }, {
    agora,
    base: ENDERECO_SITE,
    novo,
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
        de: REMETENTE,
        para: aviso.para,
        assunto: aviso.assunto,
        texto: aviso.texto,
        html: aviso.html,
      })
      await marca.set({ envioId: id ?? null }, { merge: true })
      // O caminho de volta: quando o Resend avisar que este e-mail voltou, ele
      // manda o id do envio e mais nada que ligue ao stand. Uma consulta por
      // grupo de coleção resolveria, ao custo de um índice a criar à mão no
      // console — e um índice esquecido só aparece no dia do primeiro retorno,
      // como erro. Um documento chato de uma linha evita a classe inteira.
      if (id) {
        await bd.doc(`correio/${id}`)
          .set({ token, chave: aviso.chave, tipo: aviso.tipo, em: new Date().toISOString() })
          .catch((erro) => logger.warn('não foi possível indexar o envio', { id, erro: String(erro) }))
      }
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
    // Só a criação manda boas-vindas. É o gatilho que sabe disso — a varredura
    // diária não, e é bom que não saiba: se soubesse, o primeiro dia no ar
    // mandaria "bem-vindo, envie suas artes" para a base inteira, incluindo
    // quem já imprimiu.
    const novo = evento.data?.before?.exists === false
    await despachar(evento.params.token, depois.data(), { novo })
  },
)

// ------------------------------------------------------- apagar uma feira
//
// Feira de teste ficava para sempre. O navegador consegue apagar os stands e a
// feira — as regras permitem —, mas não os ENVIOS nem os ARQUIVOS: envio é
// registro histórico e nenhuma sessão de navegador pode apagá-lo, o que é uma
// trava que vale manter. Uma conta de serviço passa por cima das regras, então
// a limpeza pesada mora aqui.
//
// A divisão de trabalho não é arbitrária. O navegador faz a parte que NÃO PODE
// falhar em silêncio — enquanto o documento do projeto existir, o link do
// cliente continua abrindo e a varredura diária continua mandando e-mail. Isso
// acontece na frente do analista, com erro na tela se der errado. O que sobra
// para cá é o que ninguém percebe se demorar um minuto: arquivo guardado e
// registro de envio.

/** As quatro pastas do Storage, todas organizadas por feira. */
const PASTAS_DA_FEIRA = ['envios', 'avulsos', 'provas', 'gabaritos']

async function apagarEmLotes(consulta, rotulo, feiraId) {
  let apagados = 0
  // Em páginas porque uma feira grande tem milhares de envios, e carregar tudo
  // de uma vez estoura a memória da função — justamente no caso em que ela
  // mais precisa terminar.
  for (;;) {
    const pagina = await consulta.limit(300).get()
    if (pagina.empty) break
    const lote = bd.batch()
    for (const doc of pagina.docs) lote.delete(doc.ref)
    await lote.commit()
    apagados += pagina.size
    if (pagina.size < 300) break
  }
  if (apagados) logger.info(`${rotulo} apagados`, { feiraId, apagados })
  return apagados
}

/**
 * Limpa tudo que pertencia a uma feira apagada.
 *
 * Roda quando o documento da feira some. É irreversível de propósito — quem
 * apaga uma feira quer que ela suma —, e a confirmação por escrito fica na
 * tela, que é onde a pessoa ainda pode voltar atrás.
 *
 * Idempotente: se rodar duas vezes, a segunda não acha nada. Gatilho do
 * Firestore roda "pelo menos uma vez", então isso não é zelo, é requisito.
 */
export const limparFeiraApagada = onDocumentDeleted(
  { document: 'feiras/{feiraId}', region: REGIAO, retry: false, timeoutSeconds: 540, memory: '512MiB' },
  async (evento) => {
    const feiraId = evento.params.feiraId
    logger.info('limpando a feira apagada', { feiraId })

    // Os stands que o navegador não alcançou — se a rede caiu no meio, ou se
    // alguém apagou a feira direto pelo console do Firebase.
    const projetos = await bd.collection('projetos').where('feiraId', '==', feiraId).get()
    const tokens = new Set(projetos.docs.map((d) => d.id))

    const envios = await bd.collection('envios').where('feiraId', '==', feiraId).get()
    // Os stands que o navegador JÁ apagou deixaram as subcoleções órfãs
    // (mensagens, reprovações, avisos): apagar o documento pai no Firestore não
    // apaga o que está abaixo dele. Os envios sabem de quais stands eram.
    for (const doc of envios.docs) {
      const id = doc.get('projetoId')
      if (id) tokens.add(id)
    }

    for (const token of tokens) {
      // `recursiveDelete` desce nas subcoleções — é a única forma de não deixar
      // conversa e histórico de reprovação para trás.
      await bd.recursiveDelete(bd.doc(`projetos/${token}`))
    }
    if (tokens.size) logger.info('stands apagados', { feiraId, stands: tokens.size })

    await apagarEmLotes(bd.collection('envios').where('feiraId', '==', feiraId), 'envios', feiraId)

    // Os arquivos. Falham separadamente das quatro pastas de propósito: uma
    // pasta com problema de permissão não pode impedir a limpeza das outras
    // três, e o log diz qual foi.
    for (const pasta of PASTAS_DA_FEIRA) {
      try {
        await getStorage().bucket().deleteFiles({ prefix: `${pasta}/${feiraId}/`, force: true })
      } catch (erro) {
        logger.error('falha ao apagar arquivos da feira', { feiraId, pasta, erro: String(erro) })
      }
    }

    logger.info('feira limpa', { feiraId, stands: tokens.size, envios: envios.size })
  },
)

/**
 * O que o Resend devolve sobre um e-mail já enviado.
 *
 * A lacuna que isto fecha: mandamos quatro avisos automáticos e não sabíamos se
 * algum chegou. Um endereço com erro de digitação — e a importação da produção
 * está cheia deles — era indistinguível de cliente relapso: o stand ficava
 * quieto e o analista cobrava por três dias alguém que nunca recebeu nada.
 *
 * O endereço é público (é o Resend que chama, sem credencial nossa), então a
 * assinatura é a única coisa que separa um evento verdadeiro de qualquer pessoa
 * na internet marcando o e-mail de um cliente como inválido. Ela é conferida
 * sobre o corpo CRU: reserializar o JSON muda um byte e derruba todo evento
 * legítimo.
 *
 * Responde 200 para quase tudo, inclusive para o que não entendeu. É de
 * propósito: erro faz o Resend reenviar, e reenviar um evento que nunca vamos
 * saber processar é ruído infinito. Só a assinatura inválida responde 401 —
 * essa precisa aparecer.
 */
export const retornoDoCorreio = onRequest(
  { region: REGIAO, secrets: [SEGREDO_RETORNO], cors: false, maxInstances: 5 },
  async (req, resposta) => {
    if (req.method !== 'POST') { resposta.status(405).send('método não permitido'); return }

    const cru = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {})
    const ok = assinaturaConfere({
      segredo: SEGREDO_RETORNO.value(),
      id: req.get('svix-id'),
      timestamp: req.get('svix-timestamp'),
      assinatura: req.get('svix-signature'),
      corpo: cru,
    })
    if (!ok) {
      logger.warn('retorno recusado: assinatura inválida', { id: req.get('svix-id') })
      resposta.status(401).send('assinatura inválida')
      return
    }

    let evento = null
    try {
      evento = lerEvento(JSON.parse(cru))
    } catch (erro) {
      logger.warn('retorno com corpo ilegível', { erro: String(erro) })
    }
    if (!evento) { resposta.status(200).send('ignorado'); return }

    const indice = await bd.doc(`correio/${evento.envioId}`).get()
    if (!indice.exists) {
      // E-mail que este sistema não mandou, ou mandou antes de o índice existir.
      logger.info('retorno sem stand correspondente', { envioId: evento.envioId })
      resposta.status(200).send('sem correspondência')
      return
    }

    const { token, chave } = indice.data()
    await bd.doc(`projetos/${token}`).set({
      correio: {
        estado: evento.estado,
        em: evento.em || new Date().toISOString(),
        para: evento.para?.[0] || null,
        motivo: evento.motivo,
        chave: chave || null,
      },
    }, { merge: true })

    logger.info('retorno registrado', { token, estado: evento.estado, envioId: evento.envioId })
    resposta.status(200).send('ok')
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
