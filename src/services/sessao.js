// Sessão do time interno (analistas de comunicação visual).
//
// Três telas usam isto: artes recebidas, cadastro de projetos e cadastro de
// analistas. Todas exigem login — ao contrário do expositor, que continua sem
// login nenhum, de propósito.
//
// Sobre a verificação de e-mail: as regras exigem `email_verified`, e isso não
// é burocracia. Com o provedor de e-mail/senha ligado, qualquer pessoa da
// internet consegue criar uma conta com o endereço que quiser. Se bastasse o
// endereço constar em `admins`, alguém poderia se cadastrar com o e-mail de um
// analista que ainda não tem conta e entrar no painel. Exigir a verificação
// fecha essa porta: é preciso ter acesso à caixa de entrada.

import { useCallback, useEffect, useState } from 'react'
import { carregarFirebase, appSecundario } from './firebase.js'
import { firebaseConfigurado } from '../config.js'
import { acessoDe } from '../core/permissoes.js'

/**
 * @param {Error} e
 * @param {'acesso'|'gravacao'} contexto onde o erro aconteceu
 *
 * O `contexto` existe por causa do `permission-denied`, que significa duas
 * coisas muito diferentes e mandava o usuário para o lugar errado:
 *
 * - na ENTRADA, é conta fora da lista de analistas;
 * - numa GRAVAÇÃO feita por quem já está com o painel aberto, é o oposto — a
 *   conta está liberada (senão nem teria chegado ali) e quem recusou foram as
 *   regras publicadas no Firebase, quase sempre por estarem desatualizadas em
 *   relação ao que o código grava.
 *
 * Dizer "sua conta não está liberada" para um admin que acabou de entrar é
 * mandá-lo caçar um problema que não existe.
 */
export function traduzirErroAuth(e, contexto = 'acesso') {
  const codigo = e?.code || ''

  if (codigo.includes('permission-denied') && contexto === 'gravacao') {
    return 'As regras de segurança do Firestore recusaram esta gravação. '
      + 'Se você já está no painel, sua conta está liberada — o mais provável é '
      + 'que as regras publicadas no Firebase estejam desatualizadas. Republique '
      + 'o conteúdo do arquivo firestore.rules no console (Firestore → Regras).'
  }

  const mapa = {
    'unauthorized-domain': 'O endereço deste site não está nos domínios autorizados do Firebase. Adicione "cleitonpn.github.io" em Authentication → Settings → Domínios autorizados.',
    'popup-blocked': 'O navegador bloqueou a janela de login. Libere os pop-ups para este site e tente de novo.',
    'popup-closed-by-user': 'A janela de login foi fechada antes de concluir.',
    'invalid-credential': 'E-mail ou senha incorretos.',
    'wrong-password': 'E-mail ou senha incorretos.',
    'user-not-found': 'Não existe conta com este e-mail. Peça a um gestor para criar o seu acesso.',
    'invalid-email': 'E-mail inválido.',
    'user-disabled': 'Esta conta foi desativada.',
    'too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
    'email-already-in-use': 'Já existe uma conta com este e-mail.',
    'weak-password': 'A senha precisa de pelo menos 6 caracteres.',
    'operation-not-allowed': 'Este método de login não está ativado no Firebase (Authentication → Método de login).',
    'network-request-failed': 'Sem conexão com o Firebase. Confira a internet e tente de novo.',
    'permission-denied': 'Sua conta não está liberada para o painel. Peça a um gestor para cadastrar o seu e-mail em "Analistas".',
    'requires-recent-login': 'Por segurança, entre novamente antes de repetir esta ação.',
  }
  for (const [chave, texto] of Object.entries(mapa)) {
    if (codigo.includes(chave)) return texto
  }
  return e?.message || 'Não foi possível concluir a operação.'
}

const ADMINS = 'admins'

/**
 * Retrato dos dados do usuário que a interface precisa.
 *
 * Guardamos um objeto simples, e não o `User` do Firebase, porque o `User` é
 * uma instância de classe: espalhá-lo com `{...u}` para atualizar um campo
 * perderia os getters e devolveria um objeto com `email` indefinido — falha
 * silenciosa e confusa. As operações que precisam do usuário de verdade pegam
 * `auth.currentUser` na hora.
 */
const retrato = (u) => (u && !u.isAnonymous
  ? { uid: u.uid, email: u.email, nome: u.displayName || '', emailVerified: u.emailVerified }
  : null)

/**
 * Estado de acesso do time interno.
 *
 * `liberado` só é verdadeiro quando as três condições valem ao mesmo tempo:
 * autenticado, e-mail verificado e presente na coleção `admins`. Cada uma
 * falha com uma mensagem diferente, porque a ação de correção também é
 * diferente — confundi-las é o que produz "não consigo entrar" sem saída.
 */
export function usarSessao() {
  const [fb, setFb] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [verificandoAcesso, setVerificandoAcesso] = useState(false)
  const [acesso, setAcesso] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    if (!firebaseConfigurado()) { setCarregando(false); return undefined }
    let vivo = true
    let cancelar = null
    carregarFirebase()
      .then((mod) => {
        if (!vivo) return
        setFb(mod)
        cancelar = mod.auth.onAuthStateChanged(mod.auth.getAuth(mod.app), (u) => {
          if (!vivo) return
          // Sessão anônima é a do expositor enviando arte: não vale como acesso.
          setUsuario(retrato(u))
          setCarregando(false)
        })
      })
      .catch((e) => { if (vivo) { setErro(traduzirErroAuth(e)); setCarregando(false) } })
    return () => { vivo = false; cancelar?.() }
  }, [])

  // Estar autenticado não é estar liberado. Quem decide é a coleção `admins`,
  // e a leitura acontece contra as regras do servidor — não dá para contornar
  // pelo navegador.
  useEffect(() => {
    if (!fb || !usuario || !usuario.emailVerified) { setAcesso(null); return undefined }
    let vivo = true
    setVerificandoAcesso(true)
    const { getFirestore, doc, getDoc } = fb.firestore
    getDoc(doc(getFirestore(fb.app), ADMINS, usuario.email))
      // O documento não diz só SE a pessoa entra: diz o que ela pode fazer e
      // em quais feiras. Ler as duas coisas de uma vez evita uma segunda
      // consulta e, principalmente, evita a janela em que a tela já apareceu
      // mas ainda não sabe o que esconder.
      .then((snap) => { if (vivo) setAcesso(snap.exists() ? acessoDe(snap.data()) : null) })
      .catch(() => { if (vivo) setAcesso(null) })
      .finally(() => { if (vivo) setVerificandoAcesso(false) })
    return () => { vivo = false }
  }, [fb, usuario])

  const comErro = useCallback(async (acao) => {
    setErro(null)
    try {
      return await acao()
    } catch (e) {
      setErro(traduzirErroAuth(e))
      throw e
    }
  }, [])

  const entrarComGoogle = useCallback(() => comErro(async () => {
    const provedor = new fb.auth.GoogleAuthProvider()
    provedor.setCustomParameters({ prompt: 'select_account' })
    await fb.auth.signInWithPopup(fb.auth.getAuth(fb.app), provedor)
  }), [fb, comErro])

  const entrarComEmail = useCallback((email, senha) => comErro(async () => {
    await fb.auth.signInWithEmailAndPassword(fb.auth.getAuth(fb.app), email.trim().toLowerCase(), senha)
  }), [fb, comErro])

  const redefinirSenha = useCallback((email) => comErro(async () => {
    await fb.auth.sendPasswordResetEmail(fb.auth.getAuth(fb.app), email.trim().toLowerCase())
  }), [fb, comErro])

  const reenviarVerificacao = useCallback(() => comErro(async () => {
    const atual = fb.auth.getAuth(fb.app).currentUser
    if (atual) await fb.auth.sendEmailVerification(atual)
  }), [fb, comErro])

  /**
   * Reconfere a verificação já feita na caixa de entrada.
   *
   * `reload()` sozinho não basta: as regras leem `email_verified` do token de
   * identidade, que o SDK só reemite quando forçado. Sem o `getIdToken(true)`
   * o analista clicaria no link do e-mail, voltaria à tela e continuaria
   * barrado — sem entender por quê.
   */
  const recarregarUsuario = useCallback(() => comErro(async () => {
    const atual = fb.auth.getAuth(fb.app).currentUser
    if (!atual) return
    await atual.reload()
    await atual.getIdToken(true)
    setUsuario(retrato(atual))
  }), [fb, comErro])

  const sair = useCallback(async () => {
    if (fb) await fb.auth.signOut(fb.auth.getAuth(fb.app))
  }, [fb])

  return {
    fb,
    usuario,
    carregando: carregando || verificandoAcesso,
    acesso,
    ehAdmin: Boolean(acesso),
    verificado: Boolean(usuario?.emailVerified),
    liberado: Boolean(usuario?.emailVerified && acesso),
    erro,
    setErro,
    entrarComGoogle,
    entrarComEmail,
    redefinirSenha,
    reenviarVerificacao,
    recarregarUsuario,
    sair,
  }
}

// ------------------------------------------------------------- analistas

export async function listarAnalistas(fb) {
  const { getFirestore, collection, getDocs } = fb.firestore
  const snap = await getDocs(collection(getFirestore(fb.app), ADMINS))
  return snap.docs
    .map((d) => ({ email: d.id, ...d.data() }))
    .sort((a, b) => String(a.email).localeCompare(String(b.email), 'pt-BR'))
}

/**
 * Cria a conta do analista e o libera no painel.
 *
 * A conta nasce numa instância secundária do SDK para não derrubar a sessão de
 * quem está cadastrando (ver `appSecundario`), e já sai com o e-mail de
 * verificação enviado — sem verificar, as regras não deixam entrar.
 */
export async function criarAnalista(fb, { email, nome, senha, papel, feiras, todasAsFeiras, criadoPor }) {
  const limpo = String(email || '').trim().toLowerCase()
  const { secundario, auth, firestore } = await appSecundario()
  const autenticacaoSecundaria = auth.getAuth(secundario)

  let credencial
  try {
    credencial = await auth.createUserWithEmailAndPassword(autenticacaoSecundaria, limpo, senha)
    await auth.sendEmailVerification(credencial.user)
  } finally {
    // Mesmo se o envio do e-mail falhar, a conta já existe: sair da instância
    // secundária evita deixar uma sessão pendurada.
    await auth.signOut(autenticacaoSecundaria).catch(() => {})
  }

  const bd = firestore.getFirestore(fb.app)
  await firestore.setDoc(firestore.doc(bd, ADMINS, limpo), {
    nome: String(nome || '').trim().slice(0, 120),
    papel: papel || 'completo',
    feiras: todasAsFeiras ? [] : (feiras || []),
    todasAsFeiras: Boolean(todasAsFeiras),
    criadoEm: firestore.serverTimestamp(),
    criadoPor: criadoPor || null,
  })

  return { email: limpo, uid: credencial?.user?.uid || null }
}

/**
 * Libera alguém que já tem conta, ou altera o acesso de quem já está na lista.
 *
 * `merge` de propósito: editar o papel de um analista não pode apagar quando
 * ele entrou nem quem o liberou — esse rastro é o que responde "por que fulano
 * tem esse acesso?" três meses depois.
 */
export async function liberarAnalista(fb, { email, nome, papel, feiras, todasAsFeiras, criadoPor }) {
  const limpo = String(email || '').trim().toLowerCase()
  const bd = fb.firestore.getFirestore(fb.app)
  await fb.firestore.setDoc(fb.firestore.doc(bd, ADMINS, limpo), {
    nome: String(nome || '').trim().slice(0, 120),
    papel: papel || 'completo',
    feiras: todasAsFeiras ? [] : (feiras || []),
    todasAsFeiras: Boolean(todasAsFeiras),
    criadoEm: fb.firestore.serverTimestamp(),
    criadoPor: criadoPor || null,
  }, { merge: true })
  return { email: limpo }
}

export async function removerAnalista(fb, email) {
  const bd = fb.firestore.getFirestore(fb.app)
  await fb.firestore.deleteDoc(fb.firestore.doc(bd, ADMINS, String(email).trim().toLowerCase()))
}
