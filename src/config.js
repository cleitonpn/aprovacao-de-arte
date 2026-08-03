// Configuração de ambiente.
//
// Nada aqui é segredo. A chave de API do Firebase é pública por definição — o
// SDK a expõe no navegador de qualquer aplicação web. Quem protege os dados
// são as regras (`firestore.rules` e `storage.rules`), que rodam no servidor
// do Google e não dependem de nada que o navegador informe.
//
// A ferramenta funciona sem nada disto configurado: a análise é inteira no
// navegador. Só o envio e o painel do time dependem do Firebase.

const env = import.meta.env || {}

export const FIREBASE = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
}

export const ENVIO = {
  tamanhoMaximoMb: Number(env.VITE_TAMANHO_MAXIMO_MB || 800),
}

export const firebaseConfigurado = () => Boolean(FIREBASE.apiKey && FIREBASE.projectId)
export const envioConfigurado = () => Boolean(firebaseConfigurado() && FIREBASE.storageBucket)
