// Quem já viu o tutorial de boas-vindas.
//
// Guardado no navegador, por stand. Por stand, e não uma vez só na vida, é o
// certo aqui: o link circula entre o marketing do cliente, a agência que
// desenha e às vezes a diretoria — pessoas diferentes, navegadores diferentes,
// e cada uma abrindo aquele link pela primeira vez. Marcar "já viu" para todo
// mundo de uma vez deixaria justamente quem mais precisa da explicação sem ela.
//
// Não vai para o Firestore de propósito. Seria uma gravação por visita para
// decidir se mostra uma caixa de texto — e, pior, o cliente teria que ter onde
// gravar isso antes de mandar qualquer coisa.

const CHAVE = 'aprovacao-arte:tutorial'

function tudo() {
  try {
    const bruto = localStorage.getItem(CHAVE)
    const dados = bruto ? JSON.parse(bruto) : {}
    return dados && typeof dados === 'object' ? dados : {}
  } catch {
    return {}
  }
}

/**
 * Já viu o tutorial deste stand?
 *
 * Em aba anônima ou com o armazenamento bloqueado, a resposta é sempre "não" —
 * e é a resposta certa para errar: mostrar de novo a quem já viu custa um
 * clique em "fechar"; esconder de quem nunca viu custa a primeira arte errada.
 */
export function jaViuTutorial(token) {
  return Boolean(tudo()[token || 'aberto'])
}

export function marcarTutorialVisto(token) {
  try {
    const dados = tudo()
    dados[token || 'aberto'] = new Date().toISOString()
    localStorage.setItem(CHAVE, JSON.stringify(dados))
  } catch {
    /* sem onde gravar: o tutorial reaparece na próxima visita, e tudo bem */
  }
}
