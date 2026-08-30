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

/**
 * Todos os projetos já cadastrados, de todas as feiras — para não duplicar.
 *
 * `expositor` vinha faltando aqui, e a falta era cara: quem cruza os dois lados
 * comparava um nome vazio e concluía "não é o mesmo cliente" sempre. O efeito
 * era invisível enquanto o casamento se apoiava no nome do STAND; quando a
 * planilha da feira vem com a coluna de local em branco — que é o caso da
 * Conferencia Luxo —, o nome do expositor é a única coisa que resta, e sem ele
 * nem o "vincular" aparecia nem a religação era sugerida.
 */
export async function lerProjetosParaCruzar(fb) {
  const { getFirestore, collection, getDocs } = fb.firestore
  const snap = await getDocs(collection(getFirestore(fb.app), 'projetos'))
  return snap.docs.map((d) => ({
    token: d.id,
    feira: d.data().feira || '',
    expositor: d.data().expositor || '',
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

/**
 * Desfaz o elo com a produção.
 *
 * Existe porque o elo errado não dá erro em lugar nenhum: o estrago aparece no
 * app de montagem, como o print de um cliente na ficha de outro, e a única
 * forma de consertar era editar o documento no console do Firebase.
 *
 * O projeto continua inteiro — perde só a ponte com o app. Nenhuma arte, nenhum
 * histórico e nenhum link do cliente dependem deste campo.
 */
export function desvincularDaProducao(fb, token, por) {
  const { getFirestore, doc, updateDoc } = fb.firestore
  return updateDoc(doc(getFirestore(fb.app), 'projetos', token), {
    producaoId: '',
    desvinculadoEm: new Date().toISOString(),
    desvinculadoPor: por ?? null,
  })
}
