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
  const snap = await firestore.getDoc(firestore.doc(firestore.getFirestore(app), COLECAO, limpo))
  return snap.exists() ? { token: snap.id, ...snap.data() } : null
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

/** Libera exatamente uma versão nova daquela peça. */
export function liberarNovaVersao(fb, token, pecaId, { ate, observacao, por }) {
  return escreverComoTime(fb, token, {
    [`controle.pecas.${pecaId}.liberadoAte`]: Number(ate) || 2,
    [`controle.pecas.${pecaId}.liberacao`]: semIndefinidos({
      em: new Date().toISOString(),
      por: por ?? null,
      observacao: String(observacao || '').trim().slice(0, 600) || null,
    }),
    [`controle.pecas.${pecaId}.recusa`]: null,
  })
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
export function registrarProva(fb, token, { id, arquivo, pecaIds, observacao, por }) {
  return escreverComoTime(fb, token, {
    [`controle.provas.${id}`]: semIndefinidos({
      arquivo: arquivo ?? null,
      pecaIds: pecaIds || [],
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

/**
 * Aplica o prazo a todos os projetos da feira.
 *
 * O prazo mora no projeto, e não na feira, por um motivo prático: o cliente já
 * lê o projeto dele: guardá-lo na feira exigiria uma segunda leitura e uma
 * regra a mais para liberar essa leitura ao expositor. O custo é reescrever os
 * projetos quando a data muda — que é raro, e cabe num lote.
 */
export async function definirPrazoDaFeira(fb, feiraId, prazoIso, por, aoProgredir) {
  const { getFirestore, doc, writeBatch } = fb.firestore
  const bd = getFirestore(fb.app)
  const projetos = await listarProjetos(fb, feiraId)
  const carimbo = paraCarimbo(fb, prazoIso)

  for (let i = 0; i < projetos.length; i += POR_LOTE) {
    const fatia = projetos.slice(i, i + POR_LOTE)
    const lote = writeBatch(bd)
    for (const p of fatia) {
      lote.update(doc(bd, COLECAO, p.token), { prazoEnvio: carimbo, prazoPor: por ?? null })
    }
    await lote.commit()
    aoProgredir?.(Math.min(i + POR_LOTE, projetos.length), projetos.length)
  }
  return projetos.length
}

export { carregarFirebase }
