// Leitura ao vivo do app de produção, sem passar pelo espelho.
//
// Por que isto existe, já que existe o espelho: o espelho é preenchido por uma
// ação agendada do GitHub, e o agendamento do GitHub é "melhor esforço". Na
// prática, um `*/15` mediu 23 minutos numa execução e 2h23 na seguinte —
// horário de pico joga a tarefa numa fila compartilhada e ela atrasa ou é
// pulada. Para quem está cadastrando uma feira, esperar duas horas por um
// stand que já está no app é inaceitável, e nenhum ajuste de intervalo
// resolve: é a mesma fila.
//
// Aqui a ferramenta pergunta direto ao projeto da produção, e a resposta é
// imediata. O espelho continua existindo como reserva — quando esta leitura
// falha, a tela cai para ele em vez de ficar vazia.
//
// SOBRE A CONFIGURAÇÃO ABAIXO, e vale ser franco:
//
// Ela é a mesma que já viaja dentro do APK e do build web do app de produção,
// de onde qualquer pessoa a extrai em minutos. Chave de API de Firebase não é
// segredo — é identificador de projeto; quem protege os dados são as regras,
// que rodam no servidor do Google. As regras daquele projeto liberam leitura
// para qualquer sessão autenticada, inclusive a anônima que o próprio app usa.
//
// Ou seja: isto não abre nada que já não estivesse aberto. O que muda é que a
// config passa a estar em mais um lugar — e essa foi uma escolha consciente,
// trocada pela espera de horas.

import { carregarFirebase } from './firebase.js'
import { normalizarDaProducao, utilizavel } from '../core/producao.js'

const CONFIG = {
  apiKey: 'AIzaSyAqg0fPaDCOGckze6kkYY7V9lKRKUoic7I',
  appId: '1:154690975923:web:937904609f3a65505258c6',
  messagingSenderId: '154690975923',
  projectId: 'montagem-uset',
  storageBucket: 'montagem-uset.firebasestorage.app',
  authDomain: 'montagem-uset.firebaseapp.com',
}

const NOME = 'producao'

/**
 * Sessão anônima no projeto da produção — separada da nossa.
 *
 * Reaproveita o SDK que `carregarFirebase` já baixou, em vez de importar
 * `firebase/app` aqui em cima. A diferença não é estética: com o import
 * estático, o Firebase inteiro entrava no pacote principal e o pacote saltava
 * de 378 kB para 1 MB — baixado inclusive por quem só abre a tela do cliente
 * para mandar uma arte, no celular, no saguão da feira. Todo o resto da
 * ferramenta carrega o Firebase sob demanda pelo mesmo motivo.
 *
 * A instância tem nome próprio: inicializar sem nome substituiria a aplicação
 * padrão, e a ferramenta perderia a sessão do analista no meio do cadastro.
 */
async function sessao() {
  const fb = await carregarFirebase()
  const app = fb.appMod.getApps().find((a) => a.name === NOME)
    || fb.appMod.initializeApp(CONFIG, NOME)
  const auth = fb.auth.getAuth(app)
  if (!auth.currentUser) await fb.auth.signInAnonymously(auth)
  return { fs: fb.firestore, bd: fb.firestore.getFirestore(app) }
}

/** Expositores direto da produção, agora. */
export async function lerProducaoAoVivo() {
  const { fs, bd } = await sessao()
  const snap = await fs.getDocs(fs.collection(bd, 'fair_clients'))
  const clientes = snap.docs
    .map((d) => normalizarDaProducao({ ...d.data(), producaoId: d.id }))
    .filter(utilizavel)
    .sort((a, b) => a.expositor.localeCompare(b.expositor, 'pt-BR'))
  return { clientes, aoVivo: true, lidoEm: new Date().toISOString() }
}
