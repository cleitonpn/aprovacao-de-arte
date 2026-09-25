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

/**
 * O documento de uma mensagem, do jeito exato que ele vai para o Firestore.
 *
 * Mora aqui, e não solto nos dois `enviarMensagem*`, por causa de um defeito
 * que chegou a produção: a foto era montada com `undefined` quando não havia
 * foto, e `semIndefinidos` — que existe para o Firestore não recusar o
 * documento inteiro — troca `undefined` por `null` em vez de tirar a chave.
 * Resultado: toda mensagem gravava `imagem: null`, a regra do servidor via
 * `'imagem' in data` como verdadeiro e tentava ler `data.imagem.link` sobre
 * `null`. No Firestore isso é erro, e erro nega a escrita. Mensagem só de
 * texto parou de ser enviada; com foto, funcionava.
 *
 * A chave da foto entra ou NÃO EXISTE — nunca existe valendo `null`. É a
 * diferença entre "esta mensagem não tem foto" e "esta mensagem tem um campo
 * de foto vazio", e as regras do servidor distinguem as duas.
 *
 * Forma é lógica, e lógica testável não pertence a uma função de serviço que
 * só roda com rede.
 */
export function corpoDaMensagem({ autor, nome, email, texto, imagem, em }) {
  const limpo = (v, max) => String(v ?? '').trim().slice(0, max)
  const corpo = {
    autor: autor === 'time' ? 'time' : 'cliente',
    nome: limpo(nome, 120),
    email: limpo(email, 160).toLowerCase() || null,
    texto: limpo(texto, 2000),
    em: em || new Date().toISOString(),
  }
  // Só entra quando há foto DE VERDADE — com link, que é o que a regra do
  // servidor confere.
  if (imagem?.link) {
    corpo.imagem = {
      link: String(imagem.link),
      caminho: String(imagem.caminho || ''),
      nome: limpo(imagem.nome, 160) || 'foto',
      tipo: String(imagem.tipo || ''),
      tamanho: Number(imagem.tamanho) || null,
    }
  }
  return corpo
}

/** Uma mensagem vazia dos dois lados não é mensagem. */
export const mensagemTemConteudo = (corpo) =>
  Boolean(corpo?.texto?.trim?.() || corpo?.imagem?.link)
