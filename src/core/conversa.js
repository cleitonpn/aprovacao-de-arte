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

/*
   O "visualizado".

   Até aqui, "já vi" era só do lado de quem olhava: uma marca no localStorage,
   que serve para apagar a bolinha de aviso e nada mais. O time não tinha como
   saber se o cliente abriu a resposta — e essa é a pergunta que faz alguém
   ligar para perguntar "você viu o que eu mandei?".

   Para o outro lado enxergar, a marca precisa sair do navegador e ir para o
   documento do projeto. Duas marcas, uma por lado, dentro de `conversa`:
   `vistoPeloCliente` e `vistoPeloTime`.

   É a HORA DA ÚLTIMA MENSAGEM QUE A PESSOA VIU, não a hora em que ela olhou.
   A diferença aparece quando chega mensagem nova enquanto a tela está aberta:
   guardando o instante do olhar, a mensagem que chegou meio segundo depois
   contaria como vista sem ninguém ter lido.
*/

/** Onde a marca de cada lado mora, dentro de `conversa`. */
export const CAMPO_VISTO = { cliente: 'vistoPeloCliente', time: 'vistoPeloTime' }

/**
 * A última mensagem MINHA que o outro lado já viu.
 *
 * Devolve o id, para a tela marcar só essa — e não todas. "Visualizado"
 * repetido embaixo de cada balão vira ruído; embaixo da última, é a informação
 * que a pessoa procura: daqui para cima, ele leu.
 *
 * @param {object} p
 * @param {Array} p.mensagens a conversa inteira, em ordem
 * @param {boolean} p.ehTime quem está olhando a tela
 * @param {object} p.conversa o resumo gravado no projeto
 */
export function ultimaMensagemVista({ mensagens = [], ehTime = false, conversa = null } = {}) {
  const meuAutor = ehTime ? 'time' : 'cliente'
  const campoDoOutro = ehTime ? CAMPO_VISTO.cliente : CAMPO_VISTO.time
  const vistoAte = emMs(conversa?.[campoDoOutro])
  if (!vistoAte) return null

  let id = null
  for (const m of mensagens) {
    if (m?.autor !== meuAutor) continue
    if (emMs(m.em) > vistoAte) break
    id = m.id ?? null
  }
  return id
}

/**
 * Até que instante devo marcar como visto.
 *
 * A última mensagem DO OUTRO LADO que está na tela. Marcar pela minha própria
 * última mensagem não diz nada — eu sempre vi o que eu mesmo escrevi — e
 * marcar pelo relógio contaria como lido o que ainda vai chegar.
 *
 * `null` quando não há nada do outro lado para ver: aí não há o que gravar, e
 * gravar assim mesmo custaria uma escrita por abertura de tela, em toda
 * conversa que o cliente abre para fazer a primeira pergunta.
 */
export function vistoAteQuando({ mensagens = [], ehTime = false } = {}) {
  const doOutro = ehTime ? 'cliente' : 'time'
  let ultima = null
  for (const m of mensagens) {
    if (m?.autor === doOutro && emMs(m.em) > emMs(ultima)) ultima = m.em
  }
  return ultima
}
