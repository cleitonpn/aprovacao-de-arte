// Quando a conversa tem novidade — para o cliente e para o time.
//
// A conta é a mesma dos dois lados, e por isso mora aqui: "tem mensagem nova"
// significa que a última mensagem foi do OUTRO e é mais recente que a última
// vez que eu olhei. Escrita duas vezes, ela derivaria — e o jeito de a bolinha
// perder a confiança do time é acender quando não devia.
//
// O resumo (`ultimoAutor` + `ultimaEm`) vem gravado no documento do projeto,
// não da subcoleção de mensagens. É o que permite pintar aviso em trinta
// stands na lista sem trinta consultas — ver `resumirConversa`, em
// `services/projetos.js`.

import { emMs } from './datas.js'

/** A chave sob a qual o "já vi" desta conversa é guardado. */
export const chaveDaConversa = (token) => `conversa:${token}`

/**
 * @param {object} p
 * @param {{ultimoAutor?:string, ultimaEm?:any}} p.conversa resumo do projeto
 * @param {boolean} p.ehTime quem está olhando
 * @param {number} p.vistoEmMs marca de `store/visto.js`
 */
export function temMensagemNova({ conversa, ehTime = false, vistoEmMs = 0 } = {}) {
  const doOutroLado = ehTime ? 'cliente' : 'time'
  if (!conversa || conversa.ultimoAutor !== doOutroLado) return false
  return emMs(conversa.ultimaEm) > (Number(vistoEmMs) || 0)
}
