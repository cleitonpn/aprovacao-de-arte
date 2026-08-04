// O que este analista já viu.
//
// Guardado no navegador dele, de propósito. A alternativa seria um documento
// por analista no Firestore, e isso custaria uma gravação a cada vez que
// alguém abrisse uma tela — dezenas por dia, por pessoa, para uma informação
// que só serve para pintar uma bolinha. O preço de ficar no navegador é que
// trocar de máquina zera os avisos uma vez; é um preço barato.
//
// A marca é sempre a data do item mais recente que estava na tela quando ele
// olhou. Comparar por data, e não por contagem, é o que faz o aviso continuar
// certo quando duas mensagens chegam entre um clique e outro.

const CHAVE = 'aprovacao-arte:visto'

function tudo() {
  try {
    const bruto = localStorage.getItem(CHAVE)
    const dados = bruto ? JSON.parse(bruto) : {}
    return dados && typeof dados === 'object' ? dados : {}
  } catch {
    return {}
  }
}

function gravar(dados) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(dados))
  } catch {
    /* aba anônima ou cota cheia: sem marcador, tudo aparece como novo */
  }
}

const emMs = (v) => {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Date.parse(v) || 0
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  if (v instanceof Date) return v.getTime()
  return 0
}

/** Data (ms) do último item que este analista viu neste assunto. */
export function vistoEm(quem, assunto) {
  return Number(tudo()[`${quem || 'anon'}:${assunto}`]) || 0
}

/** Marca como visto até a data do item mais recente que estava na tela. */
export function marcarVisto(quem, assunto, ate) {
  const ms = emMs(ate) || Date.now()
  const dados = tudo()
  const chave = `${quem || 'anon'}:${assunto}`
  // Nunca anda para trás: abrir uma tela antiga não pode "desver" o que já
  // tinha sido visto numa mais recente.
  if (ms > (Number(dados[chave]) || 0)) {
    dados[chave] = ms
    gravar(dados)
  }
}

/** Quantos itens da lista são mais novos que a última visita. */
export function novosDesde(itens, marca, dataDe = (x) => x.em) {
  const limite = Number(marca) || 0
  if (!limite) return itens.length
  return itens.filter((x) => emMs(dataDe(x)) > limite).length
}

export { emMs as dataEmMs }
