// Quantas vezes o cliente tentou esta peça e a arte não passou.
//
// O time já tem esse número: `dificuldadeDoProjeto` conta as reprovações
// gravadas e acende um alerta no painel. Quem NÃO tinha era o próprio cliente —
// e ele é quem está travado. Um expositor tentou dez vezes com o mesmo arquivo
// em 1:10 e desistiu; do lado dele, a décima tela era idêntica à primeira.
//
// Fica no navegador, e não no Firestore, por dois motivos. Ler o log de
// tentativas exigiria abrir a subcoleção para o cliente, o que é acesso novo
// para desenhar um convite. E a pergunta aqui é sobre a SESSÃO de trabalho
// dele — "você está penando nesta peça agora" —, não sobre o histórico do
// stand, que pode ter tentativas de outra pessoa, em outro dia, já resolvidas.
//
// O preço é o de sempre: trocar de navegador zera a conta. Errar para o lado de
// não oferecer ajuda é melhor que oferecer ajuda a quem não pediu.

const CHAVE = 'aprovacao-arte:tentativas'

/** A partir de quantas reprovações na MESMA peça a ferramenta se oferece. */
export const TENTATIVAS_ATE_OFERECER = 3

const tudo = () => {
  try {
    const bruto = localStorage.getItem(CHAVE)
    const dados = bruto ? JSON.parse(bruto) : {}
    return dados && typeof dados === 'object' ? dados : {}
  } catch {
    return {}
  }
}

const gravar = (dados) => {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(dados))
  } catch {
    /* aba anônima ou cota cheia: sem conta, sem convite */
  }
}

const chaveDaPeca = (token, pecaId) => `${token}:${pecaId}`

/**
 * Registra uma reprovação e devolve o total desta peça.
 *
 * Idempotente por arquivo: o mesmo arquivo reanalisado — porque o cliente
 * trocou a escala, ou voltou e entrou de novo na peça — não conta duas vezes.
 * Sem isso o vaivém dele produziria o convite, e o convite passaria a aparecer
 * para quem não está com dificuldade nenhuma.
 */
export function anotarReprovacao(token, pecaId, marcaDoArquivo) {
  if (!token || !pecaId) return 0
  const dados = tudo()
  const chave = chaveDaPeca(token, pecaId)
  const atual = dados[chave] || { arquivos: [] }
  const marca = String(marcaDoArquivo || '').slice(0, 200)
  if (marca && atual.arquivos.includes(marca)) return atual.arquivos.length
  const arquivos = marca ? [...atual.arquivos, marca] : atual.arquivos
  // `...atual` e não um objeto novo: a marca de convite dispensado mora aqui
  // também. Reescrever o registro inteiro a cada tentativa fazia o convite
  // voltar na reprovação seguinte — que é exatamente o que ele não pode fazer.
  dados[chave] = { ...atual, arquivos: arquivos.slice(-20), em: Date.now() }
  gravar(dados)
  return dados[chave].arquivos.length
}

/** Quantos arquivos diferentes já foram reprovados nesta peça. */
export function reprovacoesDaPeca(token, pecaId) {
  return (tudo()[chaveDaPeca(token, pecaId)]?.arquivos || []).length
}

/**
 * O convite já foi feito e recusado nesta peça?
 *
 * Sem esta marca, quem dispensou o convite o veria de novo a cada tentativa —
 * e um aviso que volta depois de ser fechado é o que ensina a pessoa a ignorar
 * todos os avisos da tela.
 */
export function conviteDispensado(token, pecaId) {
  return Boolean(tudo()[chaveDaPeca(token, pecaId)]?.dispensado)
}

export function dispensarConvite(token, pecaId) {
  const dados = tudo()
  const chave = chaveDaPeca(token, pecaId)
  dados[chave] = { ...(dados[chave] || { arquivos: [] }), dispensado: true }
  gravar(dados)
}

/** Zera a peça — o cliente conseguiu, e o próximo problema começa do zero. */
export function limparPeca(token, pecaId) {
  const dados = tudo()
  delete dados[chaveDaPeca(token, pecaId)]
  gravar(dados)
}
