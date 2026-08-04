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
  await firestore.addDoc(firestore.collection(bd, COLECAO, token, MENSAGENS), semIndefinidos({
    autor: 'cliente',
    nome: String(nome || '').trim().slice(0, 120),
    email: String(email || '').trim().toLowerCase().slice(0, 160) || null,
    texto: String(texto || '').trim().slice(0, 2000),
    em: new Date().toISOString(),
  }))
}

export async function enviarMensagemDoTime(fb, token, { texto, autorEmail, autorNome }) {
  const bd = fb.firestore.getFirestore(fb.app)
  await fb.firestore.addDoc(fb.firestore.collection(bd, COLECAO, token, MENSAGENS), semIndefinidos({
    autor: 'time',
    nome: String(autorNome || autorEmail || 'Comunicação visual').trim().slice(0, 120),
    email: autorEmail || null,
    texto: String(texto || '').trim().slice(0, 2000),
    em: new Date().toISOString(),
  }))
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
