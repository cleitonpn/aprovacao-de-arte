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
      riscoAceito: dados.riscoAceito ? true : false,
      em: new Date().toISOString(),
    }),
  })
}

export { carregarFirebase }
