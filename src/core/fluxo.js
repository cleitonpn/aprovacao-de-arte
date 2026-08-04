// A esteira de cada peça: de "aguardando" a "impressa".
//
// Até aqui a peça só existia ou não existia. Com a prova de aprovação, o
// reenvio controlado e o prazo, ela passa a ter ESTADO — e estado espalhado
// pela interface é como se constroem regras que ninguém consegue mais
// explicar. Então todo o raciocínio mora aqui, em funções puras, e as telas só
// desenham o que estas funções dizem.
//
// O caminho normal:
//
//   aguardando → recebida → em prova → aprovada → em impressão → impressa
//                    ↑                     ↓
//                    └── nova versão ← reprovada (total ou em partes)
//
// Onde os dados vivem, e por quê:
//
// - `entregas`, `pedidos`, `respostasProva` são gravados pelo CLIENTE (ele tem
//   o token do link). São as ações dele: enviei, quero reenviar, aprovo a prova.
// - `controle` é gravado só pelo TIME. São as decisões: liberei o reenvio,
//   recusei, subi a prova, mandei imprimir.
//
// Essa separação é o que impede o cliente de assinar a decisão do analista.
// Ela está nas regras do Firestore, não só aqui.

export const STATUS = {
  aguardando: { rotulo: 'Aguardando arte', ordem: 0, cor: 'neutro' },
  recebida: { rotulo: 'Arte recebida', ordem: 1, cor: 'ok' },
  em_prova: { rotulo: 'Prova aguardando sua aprovação', ordem: 2, cor: 'alerta' },
  aprovada: { rotulo: 'Prova aprovada', ordem: 3, cor: 'ok' },
  reprovada: { rotulo: 'Prova reprovada — refazer', ordem: 4, cor: 'ruim' },
  em_impressao: { rotulo: 'Em impressão', ordem: 5, cor: 'ok' },
  impressa: { rotulo: 'Impressa', ordem: 6, cor: 'ok' },
}

export const STATUS_DO_TIME = ['em_impressao', 'impressa']

/** Estados em que a peça está com o cliente, esperando ação dele. */
export const PRECISA_DO_CLIENTE = ['aguardando', 'em_prova', 'reprovada']

const mapa = (v) => (v && typeof v === 'object' ? v : {})
const emMs = (v) => {
  if (!v) return 0
  if (typeof v === 'string') return Date.parse(v) || 0
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  if (v instanceof Date) return v.getTime()
  return 0
}

/** Converte prazo (Timestamp do Firestore, Date ou ISO) em milissegundos. */
export const prazoEmMs = emMs

/**
 * Situação do prazo de envio do projeto.
 *
 * A prorrogação é por stand e vence junto com a data que o time escolheu — não
 * é um "liberado para sempre", senão a exceção vira a regra e o prazo perde o
 * sentido em duas feiras.
 */
export function situacaoDoPrazo(projeto, agora = Date.now()) {
  const prazo = emMs(projeto?.prazoEnvio)
  const prorrogado = emMs(projeto?.prorrogadoAte)
  if (!prazo) return { temPrazo: false, vencido: false, prorrogado: false, limite: null, diasRestantes: null }

  const limite = Math.max(prazo, prorrogado)
  const vencido = agora > limite
  const dia = 24 * 60 * 60 * 1000
  return {
    temPrazo: true,
    prazo,
    limite,
    prorrogado: prorrogado > prazo,
    vencido,
    diasRestantes: Math.ceil((limite - agora) / dia),
  }
}

/**
 * Estado completo de uma peça, reunindo o que o cliente fez e o que o time
 * decidiu.
 */
export function situacaoDaPeca(projeto, peca, agora = Date.now()) {
  const entrega = mapa(projeto?.entregas)[peca.id] || null
  const pedido = mapa(projeto?.pedidos)[peca.id] || null
  const controle = mapa(mapa(projeto?.controle).pecas)[peca.id] || null
  const provas = provasDaPeca(projeto, peca.id)
  const provaAtual = provas[provas.length - 1] || null
  const resposta = provaAtual ? mapa(projeto?.respostasProva)[provaAtual.id] || null : null

  const versaoRecebida = Number(entrega?.versao) || (entrega ? 1 : 0)
  const proximaVersao = versaoRecebida + 1
  const liberadoAte = Number(controle?.liberadoAte) || 0
  const statusDoTime = controle?.status

  // O pedido guarda para QUAL versão ele foi feito. Sem isso, o pedido da v2
  // continuaria valendo depois de a v2 já ter chegado, e a peça ficaria
  // eternamente "em análise" — bloqueada por um pedido que já foi atendido.
  const pedidoVigente = pedido && (Number(pedido.paraVersao) || 2) === proximaVersao ? pedido : null

  // O status do time vence: se a peça já está na impressora, nada do que o
  // cliente faça na tela dele muda isso.
  let status
  if (STATUS_DO_TIME.includes(statusDoTime)) status = statusDoTime
  else if (resposta?.decisao === 'aprovada') status = 'aprovada'
  else if (resposta && ehReprovada(resposta, peca.id)) status = 'reprovada'
  else if (resposta) status = 'aprovada' // reprovação parcial que não incluiu esta peça
  else if (provaAtual) status = 'em_prova'
  else if (entrega) status = 'recebida'
  else status = 'aguardando'

  const prazo = situacaoDoPrazo(projeto, agora)
  const bloqueio = motivoDeBloqueio({
    status, pedido: pedidoVigente, controle, prazo, versaoRecebida, liberadoAte, proximaVersao,
  })

  return {
    peca,
    status,
    rotulo: STATUS[status]?.rotulo || status,
    cor: STATUS[status]?.cor || 'neutro',
    entrega,
    pedido: pedidoVigente,
    controle,
    provaAtual,
    provas,
    resposta,
    versaoRecebida,
    proximaVersao,
    liberadoAte,
    prazo,
    podeEnviar: !bloqueio,
    bloqueio,
    // Um pedido em aberto é o que a tela do time precisa ver em destaque.
    pedidoEmAberto: Boolean(pedidoVigente && liberadoAte < proximaVersao && !controle?.recusa),
    recusaEmAberto: Boolean(controle?.recusa && liberadoAte < proximaVersao),
  }
}

function ehReprovada(resposta, pecaId) {
  if (resposta.decisao === 'reprovada') return true
  if (resposta.decisao !== 'parcial') return false
  return (resposta.pecasReprovadas || []).includes(pecaId)
}

/**
 * Por que o envio está bloqueado — ou `null` se está liberado.
 *
 * A ordem das checagens é a ordem da conversa real com o cliente: primeiro o
 * que ele não pode mudar (já está na impressora), depois o que depende do time
 * (pedido em análise), e só então o prazo.
 */
function motivoDeBloqueio({ status, pedido, controle, prazo, versaoRecebida, liberadoAte, proximaVersao }) {
  if (STATUS_DO_TIME.includes(status)) {
    return {
      tipo: 'em_producao',
      titulo: status === 'impressa' ? 'Esta peça já foi impressa' : 'Esta peça já entrou em impressão',
      texto: 'Uma arte nova a esta altura significa reimprimir a peça, com custo extra. Fale com o atendimento antes de qualquer coisa.',
    }
  }

  // Prova reprovada é o time PEDINDO arte nova. Exigir que o cliente peça
  // permissão para atender ao nosso próprio pedido seria absurdo — e o prazo,
  // pelo mesmo motivo, não se aplica: ele está corrigindo por causa da nossa
  // volta, não por ter se atrasado.
  if (status === 'reprovada') return null

  const precisaDeLiberacao = versaoRecebida >= 1 && liberadoAte < proximaVersao

  if (precisaDeLiberacao && controle?.recusa) {
    return {
      tipo: 'recusado',
      titulo: 'Pedido de nova versão recusado',
      texto: controle.recusa.motivo,
      exigeExtra: Boolean(controle.recusa.exigeExtra),
      podeAceitarExtra: Boolean(controle.recusa.exigeExtra) && !pedido?.aceiteExtra,
    }
  }

  if (precisaDeLiberacao && pedido) {
    return {
      tipo: 'em_analise',
      titulo: 'Pedido em análise',
      texto: 'O time recebeu seu pedido de nova versão e vai responder. Você recebe um aviso quando houver resposta.',
    }
  }

  if (precisaDeLiberacao) {
    return {
      tipo: 'precisa_pedir',
      titulo: 'Esta arte já foi enviada',
      texto: 'Para trocar por uma versão nova, faça o pedido explicando o que mudou. O time precisa saber — a peça pode já estar na fila de produção.',
    }
  }

  // O prazo bloqueia peça NOVA, nunca um ciclo de correção que o próprio time
  // abriu — a reprovação de prova já saiu acima, e uma versão liberada pelo
  // analista também não pode ser barrada por um prazo que ele conhecia ao
  // liberar.
  if (prazo.vencido && liberadoAte < proximaVersao) {
    return {
      tipo: 'prazo',
      titulo: 'Prazo de envio encerrado',
      texto: 'O prazo para envio de artes desta feira terminou. Fale com o atendimento para pedir uma liberação.',
    }
  }

  return null
}

/** Provas que cobrem esta peça, da mais antiga para a mais recente. */
export function provasDaPeca(projeto, pecaId) {
  const todas = mapa(mapa(projeto?.controle).provas)
  return Object.entries(todas)
    .map(([id, p]) => ({ id, ...p }))
    .filter((p) => (p.pecaIds || []).includes(pecaId))
    .sort((a, b) => emMs(a.enviadaEm) - emMs(b.enviadaEm))
}

/** Todas as provas do projeto, da mais recente para a mais antiga. */
export function provasDoProjeto(projeto) {
  const todas = mapa(mapa(projeto?.controle).provas)
  return Object.entries(todas)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => emMs(b.enviadaEm) - emMs(a.enviadaEm))
}

/** Resumo do projeto inteiro — alimenta o painel e a barra do cliente. */
export function resumoDoProjeto(projeto, agora = Date.now()) {
  const pecas = (projeto?.pecas || []).map((p) => situacaoDaPeca(projeto, p, agora))
  const conta = (f) => pecas.filter(f).length
  return {
    pecas,
    total: pecas.length,
    recebidas: conta((s) => s.status !== 'aguardando'),
    pendentes: pecas.filter((s) => s.status === 'aguardando'),
    aguardandoCliente: conta((s) => PRECISA_DO_CLIENTE.includes(s.status)),
    emProducao: conta((s) => STATUS_DO_TIME.includes(s.status)),
    pedidosEmAberto: pecas.filter((s) => s.pedidoEmAberto),
    prazo: situacaoDoPrazo(projeto, agora),
    completo: pecas.length > 0 && conta((s) => s.status !== 'aguardando') === pecas.length,
  }
}

// O aviso de custo extra é deliberadamente SEM valor. Parte dos expositores
// paga pela organizadora do evento, que aplica margem própria sobre o nosso
// preço — publicar um número aqui criaria uma expectativa que a fatura não
// confirma. O texto manda falar com o atendimento, que é onde o número existe.
export const AVISO_PRAZO = 'Artes enviadas depois do prazo podem ter taxa de urgência e acabamento comprometido — menos tempo de produção significa menos margem para conferência, correção e secagem. Para saber valores, fale com o atendimento antes de enviar.'

export const AVISO_EXTRA = 'Esta troca tem custo extra. O valor depende da peça e de como a sua contratação foi feita — em alguns casos a cobrança passa pela organizadora do evento. Antes de aceitar, fale com o atendimento para saber o valor.'
