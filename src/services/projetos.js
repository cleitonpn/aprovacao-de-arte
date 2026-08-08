// Leitura e gravação dos projetos (as peças que cada stand precisa entregar).
//
// Dois públicos, dois caminhos:
//
// - o time interno lê e escreve tudo, autenticado e presente em `admins`;
// - o expositor lê UM projeto, o dele, com uma sessão anônima e sabendo o
//   token — que é aleatório e vive só no link que ele recebeu. É o mesmo
//   modelo de proteção dos arquivos: conhecer o endereço exato é a credencial.

import { carregarFirebase, sessaoAnonima } from './firebase.js'
import { idDeFeira } from '../data/cadastro.js'
import { normalizarProjeto } from '../data/projeto.js'
import { semIndefinidos } from '../core/mensagem.js'

const COLECAO = 'projetos'

// O Firestore aceita no máximo 500 operações por lote. 200 projetos deixam
// folga para as feiras que entram no mesmo lote e evitam um pacote enorme numa
// conexão ruim de saguão de feira.
const POR_LOTE = 200

function paraDocumento(projeto, autor) {
  const limpo = normalizarProjeto(projeto)
  return {
    ...limpo,
    feiraId: idDeFeira(limpo.feira),
    atualizadoPor: autor || null,
  }
}

export async function salvarProjeto(fb, projeto, autor) {
  const { getFirestore, doc, setDoc, serverTimestamp } = fb.firestore
  const bd = getFirestore(fb.app)
  const dados = paraDocumento(projeto, autor)

  await setDoc(doc(bd, COLECAO, dados.token), semIndefinidos({
    ...dados,
    atualizadoEm: serverTimestamp(),
  }), { merge: true })

  await setDoc(
    doc(bd, 'feiras', dados.feiraId),
    { nome: dados.feira, atualizadaEm: serverTimestamp() },
    { merge: true },
  )
  return dados
}

/** Grava vários projetos de uma vez (importação de planilha). */
export async function salvarProjetos(fb, projetos, autor, aoProgredir) {
  const { getFirestore, doc, writeBatch, serverTimestamp } = fb.firestore
  const bd = getFirestore(fb.app)
  const preparados = projetos.map((p) => paraDocumento(p, autor))
  const feiras = new Map(preparados.map((p) => [p.feiraId, p.feira]))

  let gravados = 0
  for (let i = 0; i < preparados.length; i += POR_LOTE) {
    const fatia = preparados.slice(i, i + POR_LOTE)
    const lote = writeBatch(bd)
    for (const p of fatia) {
      lote.set(doc(bd, COLECAO, p.token), semIndefinidos({ ...p, atualizadoEm: serverTimestamp() }), { merge: true })
    }
    if (i === 0) {
      for (const [id, nome] of feiras) {
        lote.set(doc(bd, 'feiras', id), { nome, atualizadaEm: serverTimestamp() }, { merge: true })
      }
    }
    await lote.commit()
    gravados += fatia.length
    aoProgredir?.(gravados, preparados.length)
  }
  return preparados
}

export async function listarProjetos(fb, feiraId) {
  const { getFirestore, collection, getDocs, query, where } = fb.firestore
  const bd = getFirestore(fb.app)
  // Filtra no servidor e ordena aqui, pelo mesmo motivo dos envios: combinar
  // `where` com `orderBy` exigiria um índice composto, criado só por linha de
  // comando ou por um link escondido dentro de uma mensagem de erro.
  const snap = await getDocs(feiraId
    ? query(collection(bd, COLECAO), where('feiraId', '==', feiraId))
    : collection(bd, COLECAO))
  return snap.docs
    .map((d) => ({ token: d.id, ...d.data() }))
    .sort((a, b) => String(a.stand || '').localeCompare(String(b.stand || ''), 'pt-BR'))
}

export async function apagarProjeto(fb, token) {
  const { getFirestore, doc, deleteDoc } = fb.firestore
  await deleteDoc(doc(getFirestore(fb.app), COLECAO, token))
}

/**
 * Carrega o projeto do expositor a partir do token do link.
 *
 * Roda com sessão anônima: o cliente não faz login em momento nenhum. Um token
 * inexistente devolve `null` para a tela poder dizer "link inválido" em vez de
 * quebrar.
 */
export async function carregarProjetoPublico(token) {
  const limpo = String(token || '').trim().toLowerCase()
  if (!/^[a-z0-9]{6,40}$/.test(limpo)) return null
  const { app, firestore } = await sessaoAnonima()
  const bd = firestore.getFirestore(app)
  const snap = await firestore.getDoc(firestore.doc(bd, COLECAO, limpo))
  if (!snap.exists()) return null

  const projeto = { token: snap.id, ...snap.data() }

  // O prazo é da FEIRA, então é lido dela. A versão anterior copiava a data
  // para dentro de cada projeto no momento em que o time clicava em "aplicar"
  // — e todo stand cadastrado depois disso nascia sem prazo, sem ninguém
  // perceber, porque a tela continuava mostrando a data. Ler da origem elimina
  // a classe inteira do problema: não há o que reaplicar nem ordem certa de
  // cadastrar.
  try {
    const feira = await firestore.getDoc(firestore.doc(bd, 'feiras', projeto.feiraId))
    const daFeira = feira.exists() ? feira.data() : null
    if (daFeira && 'prazoEnvio' in daFeira) projeto.prazoEnvio = daFeira.prazoEnvio
    if (daFeira?.nome) projeto.feira = daFeira.nome
  } catch (e) {
    // Feira ilegível (regras antigas, por exemplo) não pode derrubar a tela do
    // cliente. Sem ela sobra a cópia guardada no projeto, que é o que existia
    // antes — pior que o ideal, melhor que uma página de erro.
    console.warn('não foi possível ler a feira; usando o prazo guardado no projeto', e)
  }

  return projeto
}

/**
 * Marca no projeto que uma peça foi entregue.
 *
 * É um espelho, não a fonte da verdade — quem manda é o documento em `envios`,
 * que o expositor não consegue ler nem alterar. Este espelho existe porque a
 * tela do cliente precisa mostrar "já enviada" sem poder consultar a coleção
 * de envios: liberar essa consulta significaria deixar um expositor ver o que
 * os outros mandaram.
 *
 * Se esta gravação falhar, o envio continua válido. Por isso quem chama trata
 * a falha como aviso, nunca como erro de envio.
 */
export async function marcarEntrega(token, pecaId, dados) {
  const { app, firestore } = await sessaoAnonima()
  const bd = firestore.getFirestore(app)
  await firestore.updateDoc(firestore.doc(bd, COLECAO, token), {
    [`entregas.${pecaId}`]: semIndefinidos({
      protocolo: dados.protocolo ?? null,
      veredicto: dados.veredicto ?? null,
      arquivo: dados.arquivo ?? null,
      versao: Number(dados.versao) || 1,
      riscoAceito: dados.riscoAceito ? true : false,
      em: new Date().toISOString(),
    }),
  })
}

// ------------------------------------------------------- ações do cliente
//
// Tudo aqui roda com a sessão anônima e o token do link, e por isso só toca
// nos três campos que as regras liberam ao cliente: `entregas`, `pedidos` e
// `respostasProva`. A decisão do analista mora em `controle`, que ele não
// alcança — é o que impede o cliente de assinar a própria liberação.

async function escreverComoCliente(token, mudanca) {
  const { app, firestore } = await sessaoAnonima()
  const bd = firestore.getFirestore(app)
  await firestore.updateDoc(firestore.doc(bd, COLECAO, token), mudanca)
}

/**
 * Pedido de nova versão de uma peça já entregue.
 *
 * `paraVersao` é o que impede o pedido de continuar valendo depois de
 * atendido: sem ele, a peça ficaria presa em "em análise" para sempre. E o
 * motivo é obrigatório porque, sem ele, o analista decide no escuro — não sabe
 * se é correção de telefone ou troca de conceito.
 */
export function pedirNovaVersao(token, pecaId, { motivo, paraVersao }) {
  return escreverComoCliente(token, {
    [`pedidos.${pecaId}`]: semIndefinidos({
      motivo: String(motivo || '').trim().slice(0, 600),
      paraVersao: Number(paraVersao) || 2,
      em: new Date().toISOString(),
      aceiteExtra: null,
    }),
  })
}

/**
 * Aceite do custo extra.
 *
 * Guarda o TEXTO exato que estava na tela junto com a data. Um `true` seco não
 * serviria de nada numa discussão sobre a fatura três meses depois — e é
 * justamente aí que este registro é usado.
 */
export function aceitarCustoExtra(token, pecaId, { texto, motivoDaRecusa }) {
  return escreverComoCliente(token, {
    [`pedidos.${pecaId}.aceiteExtra`]: semIndefinidos({
      em: new Date().toISOString(),
      texto: String(texto || '').slice(0, 2000),
      motivoDaRecusa: motivoDaRecusa ?? null,
    }),
  })
}

/** Resposta do cliente a uma prova: aprovada, reprovada ou reprovada em partes. */
export function responderProva(token, provaId, { decisao, pecasReprovadas = [], observacao = '' }) {
  return escreverComoCliente(token, {
    [`respostasProva.${provaId}`]: semIndefinidos({
      decisao,
      pecasReprovadas: decisao === 'aprovada' ? [] : pecasReprovadas,
      observacao: String(observacao || '').trim().slice(0, 1000),
      em: new Date().toISOString(),
    }),
  })
}

// ---------------------------------------------------------- ações do time

function escreverComoTime(fb, token, mudanca) {
  const { getFirestore, doc, updateDoc } = fb.firestore
  return updateDoc(doc(getFirestore(fb.app), COLECAO, token), mudanca)
}

/**
 * Libera exatamente uma versão nova daquela peça.
 *
 * `limparStatus` existe para o caso da reimpressão: liberar arte nova numa peça
 * que está "em impressão" e deixar o status como estava faria a tela mentir
 * duas vezes — diria que está imprimindo a arte antiga e que a nova pode
 * chegar. Liberou reimpressão, a peça volta para a esteira.
 */
export function liberarNovaVersao(fb, token, pecaId, { ate, observacao, por, limparStatus }) {
  const mudanca = {
    [`controle.pecas.${pecaId}.liberadoAte`]: Number(ate) || 2,
    [`controle.pecas.${pecaId}.liberacao`]: semIndefinidos({
      em: new Date().toISOString(),
      por: por ?? null,
      observacao: String(observacao || '').trim().slice(0, 600) || null,
    }),
    [`controle.pecas.${pecaId}.recusa`]: null,
  }
  if (limparStatus) {
    mudanca[`controle.pecas.${pecaId}.status`] = null
    mudanca[`controle.pecas.${pecaId}.statusEm`] = new Date().toISOString()
    mudanca[`controle.pecas.${pecaId}.statusPor`] = por ?? null
  }
  return escreverComoTime(fb, token, mudanca)
}

export function recusarNovaVersao(fb, token, pecaId, { motivo, exigeExtra, por }) {
  return escreverComoTime(fb, token, {
    [`controle.pecas.${pecaId}.recusa`]: semIndefinidos({
      motivo: String(motivo || '').trim().slice(0, 800),
      exigeExtra: Boolean(exigeExtra),
      em: new Date().toISOString(),
      por: por ?? null,
    }),
  })
}

/**
 * Devolve ao cliente uma arte que o time recusou.
 *
 * A aprovação da ferramenta é a primeira camada: ela confere o que dá para
 * conferir por software — resolução, medida, sangria, formato. O que ela não
 * vê é o resto — logo errado, texto desatualizado, cor fora da identidade,
 * arquivo do stand do vizinho. Quem vê isso é quem produz, e antes disto não
 * havia por onde essa recusa voltar ao cliente: o analista descobria o erro,
 * ligava, e a peça continuava "aprovada" na tela dele.
 *
 * `paraVersao` amarra a devolução à versão recusada. É o que faz o aviso sumir
 * sozinho quando a arte corrigida chega, em vez de ficar acusando um erro que
 * já foi resolvido.
 *
 * Zerar o status é parte da mesma decisão: devolver uma peça e deixá-la
 * marcada como "em impressão" seria a tela afirmando duas coisas contrárias ao
 * mesmo tempo.
 */
export function devolverArte(fb, token, pecaId, { motivo, paraVersao, por }) {
  return escreverComoTime(fb, token, {
    [`controle.pecas.${pecaId}.devolucao`]: semIndefinidos({
      motivo: String(motivo || '').trim().slice(0, 800),
      paraVersao: Number(paraVersao) || 1,
      em: new Date().toISOString(),
      por: por ?? null,
    }),
    [`controle.pecas.${pecaId}.status`]: null,
    [`controle.pecas.${pecaId}.statusEm`]: new Date().toISOString(),
    [`controle.pecas.${pecaId}.statusPor`]: por ?? null,
  })
}

/** Desfaz a devolução — o analista clicou errado, ou a recusa não procedia. */
export function desfazerDevolucao(fb, token, pecaId) {
  return escreverComoTime(fb, token, {
    [`controle.pecas.${pecaId}.devolucao`]: null,
  })
}

export function definirStatusDaPeca(fb, token, pecaId, status, por) {
  return escreverComoTime(fb, token, {
    [`controle.pecas.${pecaId}.status`]: status || null,
    [`controle.pecas.${pecaId}.statusEm`]: new Date().toISOString(),
    [`controle.pecas.${pecaId}.statusPor`]: por ?? null,
  })
}

/**
 * Registra a prova de aprovação já enviada ao armazenamento.
 *
 * Uma prova cobre N peças de propósito: na prática ela é o mockup do stand
 * inteiro, e é isso que dá sentido a "reprovar em partes" — o cliente aprova a
 * lona e reprova a testeira dentro da mesma imagem.
 */
export function registrarProva(fb, token, { id, arquivo, pecaIds, versoes, observacao, por }) {
  return escreverComoTime(fb, token, {
    [`controle.provas.${id}`]: semIndefinidos({
      arquivo: arquivo ?? null,
      pecaIds: pecaIds || [],
      // Qual versão da arte esta prova mostra, peça a peça. É o que faz a
      // prova caducar sozinha quando chega arte nova — sem isso o cartão do
      // cliente ficava preso em "reprovada" depois de ele já ter corrigido.
      versoes: versoes || {},
      observacao: String(observacao || '').trim().slice(0, 800) || null,
      enviadaEm: new Date().toISOString(),
      enviadaPor: por ?? null,
    }),
  })
}

/**
 * Datas vão como Timestamp do Firestore, não como texto.
 *
 * Texto ISO ordena bem e seria mais simples de ler no console — mas comparar
 * data em texto dentro de uma consulta ou de uma regra é armadilha certa. O
 * lado da leitura já aceita os três formatos (ver `fluxo.js`), então o custo
 * aqui é zero.
 */
function paraCarimbo(fb, iso) {
  if (!iso) return null
  const data = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(data.getTime()) ? null : fb.firestore.Timestamp.fromDate(data)
}

/** Prorrogação do prazo para um stand específico. `ate` em ISO, ou null. */
export function prorrogarPrazo(fb, token, ate, por) {
  return escreverComoTime(fb, token, {
    prorrogadoAte: paraCarimbo(fb, ate),
    prorrogadoPor: ate ? (por ?? null) : null,
  })
}

// ------------------------------------------------------------------ feiras

/**
 * Cadastro da feira: nome e prazo final de envio das artes.
 *
 * A feira é a dona do prazo. Antes ele era copiado para cada projeto num
 * clique de "aplicar a todos", e todo stand cadastrado depois nascia sem
 * prazo — falha silenciosa, porque a tela continuava exibindo a data. Com o
 * prazo aqui, cadastrar a feira antes dos clientes passa a ser o caminho
 * natural, e não uma sequência que alguém precisa lembrar.
 */
export async function salvarFeira(fb, { id, nome, prazoEnvio }, por) {
  const { getFirestore, doc, setDoc, serverTimestamp } = fb.firestore
  const feiraId = id || idDeFeira(nome)
  await setDoc(doc(getFirestore(fb.app), 'feiras', feiraId), semIndefinidos({
    nome: String(nome || '').trim().slice(0, 160),
    prazoEnvio: paraCarimbo(fb, prazoEnvio),
    atualizadaEm: serverTimestamp(),
    atualizadaPor: por ?? null,
  }), { merge: true })
  return feiraId
}

export { carregarFirebase }

// ------------------------------------------------------------- conversa
//
// O chat entre cliente e analista mora numa SUBCOLEÇÃO, e não num campo do
// projeto, por um motivo que é o próprio objetivo dele: servir de registro.
//
// Num campo do documento, o cliente — que precisa poder escrever — teria de
// receber permissão para regravar o campo inteiro, e com isso poderia reescrever
// a resposta do analista. Um histórico que uma das partes pode editar não
// resolve discussão nenhuma. Como documentos separados, cada mensagem é criada
// uma vez, por um autor, e ninguém altera nem apaga: nem o cliente, nem o time.

const MENSAGENS = 'mensagens'

export async function enviarMensagemDoCliente(token, { texto, nome, email }) {
  const { app, firestore } = await sessaoAnonima()
  const bd = firestore.getFirestore(app)
  const em = new Date().toISOString()
  await firestore.addDoc(firestore.collection(bd, COLECAO, token, MENSAGENS), semIndefinidos({
    autor: 'cliente',
    nome: String(nome || '').trim().slice(0, 120),
    email: String(email || '').trim().toLowerCase().slice(0, 160) || null,
    texto: String(texto || '').trim().slice(0, 2000),
    em,
  }))
  await resumirConversa(bd, firestore, token, 'cliente', em)
}

/**
 * Espelha no documento do projeto quando foi a última mensagem e de quem.
 *
 * Existe por causa da bolinha de aviso na LISTA de projetos: sem este resumo,
 * pintar "tem mensagem nova" em trinta stands exigiria abrir a subcoleção de
 * cada um — trinta consultas para desenhar trinta bolinhas. Com o resumo, a
 * informação já vem junto com a lista que a tela carrega de qualquer forma.
 *
 * O cliente consegue escrever aqui, e isso é aceitável: o pior que ele faz é
 * provocar um aviso à toa. O conteúdo da conversa continua intocável.
 */
function resumirConversa(bd, firestore, token, autor, em) {
  return firestore.updateDoc(firestore.doc(bd, COLECAO, token), {
    conversa: { ultimaEm: em, ultimoAutor: autor },
  }).catch((e) => {
    // Falhar aqui não pode derrubar a mensagem, que já foi gravada.
    console.warn('mensagem enviada, mas o resumo da conversa não atualizou', e)
  })
}

export async function enviarMensagemDoTime(fb, token, { texto, autorEmail, autorNome }) {
  const bd = fb.firestore.getFirestore(fb.app)
  const em = new Date().toISOString()
  await fb.firestore.addDoc(fb.firestore.collection(bd, COLECAO, token, MENSAGENS), semIndefinidos({
    autor: 'time',
    nome: String(autorNome || autorEmail || 'Comunicação visual').trim().slice(0, 120),
    email: autorEmail || null,
    texto: String(texto || '').trim().slice(0, 2000),
    em,
  }))
  await resumirConversa(bd, fb.firestore, token, 'time', em)
}

/** Ordena aqui, e não na consulta, para não exigir índice: são poucas dezenas. */
function ordenar(docs) {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Date.parse(a.em || 0) - Date.parse(b.em || 0))
}

export async function lerConversaComoCliente(token) {
  const { app, firestore } = await sessaoAnonima()
  const bd = firestore.getFirestore(app)
  const snap = await firestore.getDocs(firestore.collection(bd, COLECAO, token, MENSAGENS))
  return ordenar(snap.docs)
}

export async function lerConversaComoTime(fb, token) {
  const bd = fb.firestore.getFirestore(fb.app)
  const snap = await fb.firestore.getDocs(fb.firestore.collection(bd, COLECAO, token, MENSAGENS))
  return ordenar(snap.docs)
}

// -------------------------------------------------- log de reprovação
//
// Arte reprovada não sobe — é a trava que dá sentido à ferramenta. O efeito
// colateral é que o cliente que tentou oito vezes e desistiu não deixava
// rastro nenhum: no painel ele era idêntico ao que nem começou. Aqui a
// tentativa fica registrada mesmo sem o arquivo.
//
// Mesma arquitetura da conversa, pelo mesmo motivo: cada tentativa é um
// documento criado uma vez e nunca alterado, e o documento do projeto guarda
// só o RESUMO (quantas, quando, por quê) — que é o que a lista e o painel
// precisam para acender o alerta sem abrir a subcoleção de cada stand.

const REPROVACOES = 'reprovacoes'

export async function registrarReprovacao(token, evento) {
  const { app, firestore } = await sessaoAnonima()
  const bd = firestore.getFirestore(app)
  await firestore.addDoc(
    firestore.collection(bd, COLECAO, token, REPROVACOES),
    semIndefinidos(evento),
  )
  // `increment` em vez de ler-somar-gravar: o cliente costuma ter a tela
  // aberta em mais de uma aba, e duas tentativas ao mesmo tempo gravariam o
  // mesmo número duas vezes.
  //
  // Caminho pontilhado, e não um mapa inteiro: `{dificuldade: {…}}` num
  // `updateDoc` SUBSTITUI o mapa, e a contagem voltaria a zero se um dos
  // campos faltasse. Com o caminho, cada campo é tocado isoladamente — e, para
  // as regras, o que mudou continua sendo a chave `dificuldade`.
  //
  // Falhar aqui não pode derrubar o registro, que já foi gravado: o espelho é
  // conveniência da lista, a verdade é a subcoleção.
  await firestore.updateDoc(firestore.doc(bd, COLECAO, token), {
    'dificuldade.reprovacoes': firestore.increment(1),
    'dificuldade.ultimaEm': evento.em,
    'dificuldade.ultimaPeca': evento.pecaRotulo || null,
    'dificuldade.ultimoMotivo': evento.motivos?.[0]?.titulo || null,
  }).catch((e) => console.warn('tentativa registrada, mas o contador não atualizou', e))
}

/** Ordena aqui, e não na consulta: são poucas dezenas por stand. */
function ordenarReprovacoes(docs) {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => Date.parse(b.em || 0) - Date.parse(a.em || 0))
}

export function ouvirReprovacoes(fb, token, aoMudar, aoFalhar) {
  const { getFirestore, collection, onSnapshot } = fb.firestore
  return onSnapshot(
    collection(getFirestore(fb.app), COLECAO, token, REPROVACOES),
    (snap) => aoMudar(ordenarReprovacoes(snap.docs)),
    aoFalhar,
  )
}

// ------------------------------------------------- envio fora do ar
//
// Arquivar, e não apagar. Um envio é registro histórico: diz que tal arte, com
// tal veredicto, chegou em tal data — e isso continua verdade mesmo depois de
// alguém limpar o arquivo do armazenamento para liberar espaço. Apagar o
// registro junto perderia o histórico e, pior, faria a arte sumir do laudo de
// uma discussão futura.
//
// O que se ganha arquivando é só o que incomoda: o registro sai da lista, e
// ninguém mais clica num "Baixar" que responde 403.

export function arquivarEnvio(fb, protocolo, por, arquivado = true) {
  const { getFirestore, doc, updateDoc } = fb.firestore
  return updateDoc(doc(getFirestore(fb.app), 'envios', protocolo), {
    arquivado: Boolean(arquivado),
    arquivadoEm: arquivado ? new Date().toISOString() : null,
    arquivadoPor: arquivado ? (por ?? null) : null,
  })
}

// ---------------------------------------------------- escuta em tempo real
//
// `onSnapshot` no lugar de recarregar a página. O analista deixa o painel
// aberto o dia inteiro durante a montagem; obrigá-lo a apertar F5 para
// descobrir se chegou arte é transformar a ferramenta num lugar que ele evita.
//
// O custo é baixo e vale explicitar, porque parece caro e não é: o Firestore
// cobra a leitura inicial de cada documento e, depois disso, só o que MUDA.
// Um painel aberto por oito horas numa feira parada custa o mesmo que abri-lo
// uma vez.
//
// Toda função aqui devolve o cancelador do listener. Quem chama é obrigado a
// usá-lo no `return` do efeito — listener que sobrevive à tela vaza conexão e,
// pior, escreve estado em componente que já saiu.

export function ouvirProjetos(fb, feiraId, aoMudar, aoFalhar) {
  const { getFirestore, collection, query, where, onSnapshot } = fb.firestore
  return onSnapshot(
    query(collection(getFirestore(fb.app), COLECAO), where('feiraId', '==', feiraId)),
    (snap) => aoMudar(snap.docs
      .map((d) => ({ token: d.id, ...d.data() }))
      .sort((a, b) => String(a.stand || '').localeCompare(String(b.stand || ''), 'pt-BR'))),
    aoFalhar,
  )
}

export function ouvirEnvios(fb, feiraId, aoMudar, aoFalhar) {
  const { getFirestore, collection, query, where, onSnapshot } = fb.firestore
  return onSnapshot(
    query(collection(getFirestore(fb.app), 'envios'), where('feiraId', '==', feiraId)),
    (snap) => aoMudar(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0))),
    aoFalhar,
  )
}

/** Escuta a conversa de um projeto. Serve aos dois lados. */
export async function ouvirConversa(token, aoMudar, aoFalhar, fb = null) {
  // O time já tem sessão; o cliente precisa da anônima. Uma função só para os
  // dois evita duas telas com comportamento sutilmente diferente.
  const contexto = fb ? { app: fb.app, firestore: fb.firestore } : await sessaoAnonima()
  const { getFirestore, collection, onSnapshot } = contexto.firestore
  return onSnapshot(
    collection(getFirestore(contexto.app), COLECAO, token, MENSAGENS),
    (snap) => aoMudar(ordenar(snap.docs)),
    aoFalhar,
  )
}

/** Escuta o projeto do cliente — entregas, provas e status chegam sozinhos. */
export async function ouvirProjetoPublico(token, aoMudar, aoFalhar) {
  const { app, firestore } = await sessaoAnonima()
  return firestore.onSnapshot(
    firestore.doc(firestore.getFirestore(app), COLECAO, token),
    (snap) => { if (snap.exists()) aoMudar({ token: snap.id, ...snap.data() }) },
    aoFalhar,
  )
}
