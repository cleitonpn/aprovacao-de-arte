// Tema claro, escuro ou o que o sistema mandar.
//
// Três estados, e não dois. Um interruptor de duas posições precisa escolher
// uma para ser o padrão, e essa escolha é sempre errada para metade das
// pessoas: quem usa o computador no escuro recebe uma tela branca, quem usa
// sob luz recebe uma preta. "Sistema" é a única posição padrão que acerta nos
// dois casos — o botão existe para quem quer contrariar o sistema, não para
// substituí-lo.
//
// A troca acontece numa linha de CSS: o atributo aqui muda `color-scheme`, e
// `light-dark()` reescreve a paleta inteira a partir dele (ver `styles.css`).
// Vale também para os controles nativos do navegador, que um tema feito só com
// variáveis próprias deixa para trás.

// Repetida, sem escapatória, no `index.html`: o tema precisa estar aplicado
// ANTES do primeiro pixel, e nesse momento o JavaScript da aplicação ainda não
// carregou. Um teste guarda as duas cópias.
export const CHAVE_DO_TEMA = 'aprovacao-arte:tema'

export const TEMAS = ['sistema', 'claro', 'escuro']

export const ROTULO_TEMA = {
  sistema: { nome: 'Tema do sistema', curto: 'Automático', icone: '🖥' },
  claro: { nome: 'Tema claro', curto: 'Claro', icone: '☀' },
  escuro: { nome: 'Tema escuro', curto: 'Escuro', icone: '☾' },
}

/** O que está guardado neste navegador. Sem nada guardado, manda o sistema. */
export function temaGuardado() {
  try {
    const valor = localStorage.getItem(CHAVE_DO_TEMA)
    return TEMAS.includes(valor) ? valor : 'sistema'
  } catch {
    // Aba anônima ou cota cheia: seguir o sistema é o lado certo para errar.
    return 'sistema'
  }
}

/** Escreve o atributo que o CSS lê. Ausente = o sistema decide. */
export function aplicarTema(tema, raiz = globalThis.document?.documentElement) {
  if (!raiz) return
  if (tema === 'claro' || tema === 'escuro') raiz.setAttribute('data-tema', tema)
  else raiz.removeAttribute('data-tema')
}

/** Guarda e aplica. Gravar não pode derrubar a troca de tema. */
export function guardarTema(tema) {
  const valido = TEMAS.includes(tema) ? tema : 'sistema'
  try {
    localStorage.setItem(CHAVE_DO_TEMA, valido)
  } catch {
    /* sem onde gravar: o tema vale só nesta aba, e isso é melhor que nada */
  }
  aplicarTema(valido)
  return valido
}

/** O próximo estado do ciclo: sistema → claro → escuro → sistema. */
export function proximoTema(atual) {
  const i = TEMAS.indexOf(atual)
  return TEMAS[(i + 1) % TEMAS.length]
}
