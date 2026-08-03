// Configuração de ambiente.
//
// Nada aqui é segredo: são valores públicos por natureza (URL de função,
// chave de API do Firebase que só funciona junto com as regras do Firestore).
// A chave da service account que escreve no Drive fica NA FUNÇÃO, nunca aqui.
//
// A ferramenta funciona sem nada disto configurado — só o envio para o Drive
// e a tela do admin ficam indisponíveis, e a análise continua inteira.

const env = import.meta.env || {}

export const ENVIO = {
  endpoint: (env.VITE_ENVIO_ENDPOINT || '').replace(/\/$/, ''),
  // Token do evento: entra na URL que vocês mandam ao expositor
  // (…/?e=TOKEN). Serve para o endpoint não ficar aberto ao mundo.
  token: env.VITE_EVENTO_TOKEN || '',
  tamanhoMaximoMb: Number(env.VITE_TAMANHO_MAXIMO_MB || 800),
}

export const FIREBASE = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
}

export const envioConfigurado = () => Boolean(ENVIO.endpoint)
export const firebaseConfigurado = () => Boolean(FIREBASE.apiKey && FIREBASE.projectId)

/** Token do evento vindo da URL (?e=…), com precedência sobre o do build. */
export function tokenDoEvento() {
  try {
    const url = new URL(window.location.href)
    return url.searchParams.get('e') || ENVIO.token
  } catch {
    return ENVIO.token
  }
}
