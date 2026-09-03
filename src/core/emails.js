// A regra de e-mail da ferramenta, num lugar só.
//
// Ela morava em `data/projeto.js`, e havia mais duas cópias soltas: uma em
// `data/cadastro.js` e outra em `core/producao.js`, esta última chamada
// `EMAIL_SIMPLES`. Três cópias da mesma expressão é o começo de um defeito
// clássico: elas não divergem no dia em que são escritas, divergem seis meses
// depois, quando alguém conserta uma e não sabe das outras.
//
// E não é hipótese — foi exatamente o que aconteceu. A cópia de `producao.js`
// validava a linha INTEIRA contra o padrão de UM endereço, enquanto o resto da
// ferramenta já aceitava vários separados por vírgula. Quem colava dois
// e-mails na tela de importação via "Falta: e-mail" em vermelho, com os dois
// endereços certos ali na frente, e não tinha como importar aquele stand.
//
// Mora em `core/` porque `core/` é o que a tela e as funções compartilham, e
// nada aqui depende de navegador.

/** Um endereço. Deliberadamente permissiva: barrar digitação errada, não fazer papel de RFC. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * A lista de e-mails de um campo escrito à mão.
 *
 * Aceita vírgula, ponto e vírgula e espaço como separador — os três, porque é
 * impossível adivinhar qual deles a pessoa vai usar ao colar de uma planilha,
 * do Outlook ou do WhatsApp, e recusar o separador "errado" só ensina que o
 * campo não funciona.
 *
 * Vários endereços não é luxo: o link do stand circula entre o marketing do
 * expositor, a agência e quem de fato monta a arte. Mandar a cobrança só para
 * o primeiro é quase o mesmo que não mandar — alguém responde "não sou eu que
 * vejo isso" e a arte atrasa mais uma semana.
 *
 * O teto de 8 é para o campo não virar lista de transmissão.
 */
export function listaDeEmails(valor) {
  const bruto = Array.isArray(valor) ? valor : String(valor || '').split(/[;,\s]+/)
  const limpos = bruto
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => EMAIL.test(e))
  return [...new Set(limpos)].slice(0, 8)
}
