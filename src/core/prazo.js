// Prazo para promessas que podem não terminar nunca.
//
// Mora num arquivo próprio e não dentro de `pdf.js` por um motivo prático: o
// `pdf.js` só carrega com DOM, e uma função de controle de tempo não deveria
// precisar de navegador para ser testada. Enquanto ela morava lá, o teste dela
// era PULADO fora do navegador — e teste que pula em silêncio é pior que teste
// nenhum, porque conta como verde.

/**
 * Espera `promessa` até `prazoMs`. Estourou, rejeita com `motivo`.
 *
 * O `catch` solto na promessa original é o detalhe que não pode faltar: depois
 * do prazo ninguém mais a escuta, e uma rejeição sem ouvinte vira erro não
 * tratado — ruído no console do cliente, bem no momento em que ele já está
 * diante de um problema.
 *
 * Isto NÃO interrompe o trabalho de quem ficou devendo: quem puder cancelar
 * precisa cancelar por fora. O que a função garante é que o programa continue.
 */
export function comPrazo(promessa, prazoMs, motivo = 'prazo-estourado') {
  promessa.catch(() => {})
  let relogio
  const prazo = new Promise((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error(motivo)), prazoMs)
  })
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(relogio))
}
