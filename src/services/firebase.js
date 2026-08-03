// Carregamento sob demanda do Firebase.
//
// O SDK é pesado e nem todo acesso precisa dele: quem só quer analisar uma
// arte e baixar o laudo não baixa nada disto. Ele entra em cena no primeiro
// envio e na tela do time.

import { FIREBASE } from '../config.js'

let promessa = null

export function carregarFirebase() {
  if (!promessa) {
    promessa = (async () => {
      const [app, auth, firestore, storage] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
        import('firebase/storage'),
      ])
      const instancia = app.getApps()[0] || app.initializeApp(FIREBASE)
      return { app: instancia, auth, firestore, storage }
    })()
  }
  return promessa
}

/**
 * Sessão anônima.
 *
 * É o que permite o expositor enviar a arte sem fazer login: o navegador
 * recebe uma credencial descartável, sem tela, sem senha, sem o cliente
 * perceber. As regras de segurança exigem essa credencial para aceitar
 * qualquer gravação — é o que impede o mundo inteiro de escrever no projeto.
 */
export async function sessaoAnonima() {
  const fb = await carregarFirebase()
  const autenticacao = fb.auth.getAuth(fb.app)
  if (!autenticacao.currentUser) {
    await fb.auth.signInAnonymously(autenticacao)
  }
  return { ...fb, usuario: autenticacao.currentUser }
}
