// Leitura do espelho da produção.
//
// Note o que NÃO tem aqui: nenhuma conexão com o projeto Firebase do app de
// produção. Esta é a razão de a ponte ser uma ação agendada — do ponto de
// vista do navegador, os dados da produção são só mais uma coleção deste
// projeto, com as mesmas regras e a mesma sessão de sempre.

import { normalizarDaProducao, utilizavel } from '../core/producao.js'

const ESPELHO = 'producao_clientes'
const ESTADO = 'producao_estado'

/**
 * Todos os expositores espelhados.
 *
 * Sem paginação de propósito: são algumas centenas de documentos pequenos,
 * lidos uma vez quando o admin abre a tela de importação, e a alternativa
 * (buscar por feira) exigiria carregar a lista de feiras antes — duas idas ao
 * servidor para montar uma tela que cabe numa.
 */
export async function lerProducao(fb) {
  const { getFirestore, collection, getDocs, doc, getDoc } = fb.firestore
  const bd = getFirestore(fb.app)

  const [snap, estadoSnap] = await Promise.all([
    getDocs(collection(bd, ESPELHO)),
    getDoc(doc(bd, ESTADO, 'atual')).catch(() => null),
  ])

  const clientes = snap.docs
    .map((d) => normalizarDaProducao({ ...d.data(), producaoId: d.id }))
    .filter(utilizavel)
    .sort((a, b) => a.expositor.localeCompare(b.expositor, 'pt-BR'))

  return {
    clientes,
    estado: estadoSnap?.exists?.() ? estadoSnap.data() : null,
  }
}

/** Todos os projetos já cadastrados, de todas as feiras — para não duplicar. */
export async function lerProjetosParaCruzar(fb) {
  const { getFirestore, collection, getDocs } = fb.firestore
  const snap = await getDocs(collection(getFirestore(fb.app), 'projetos'))
  return snap.docs.map((d) => ({
    token: d.id,
    feira: d.data().feira || '',
    stand: d.data().stand || '',
    producaoId: d.data().producaoId || '',
    pecas: d.data().pecas || [],
  }))
}

/** Liga um projeto que já existia ao stand correspondente na produção. */
export function vincularAProducao(fb, token, producaoId, por) {
  const { getFirestore, doc, updateDoc } = fb.firestore
  return updateDoc(doc(getFirestore(fb.app), 'projetos', token), {
    producaoId,
    vinculadoEm: new Date().toISOString(),
    vinculadoPor: por ?? null,
  })
}
