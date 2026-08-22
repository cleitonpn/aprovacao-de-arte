// Como está o contato com este cliente.
//
// O painel sabia dizer quantas artes faltam. Não sabia dizer POR QUE faltam —
// e "0 de 5" é o mesmo número para quatro situações que pedem quatro ações
// completamente diferentes:
//
//   o e-mail voltou            ele nunca soube; achar outro contato, hoje
//   chegou e nunca abriu       não começou nada; ligar e entender
//   abriu e baixou o gabarito  o designer está trabalhando; cobrar perto do prazo
//   tentou e não conseguiu     travou na ferramenta; é ajuda técnica, não cobrança
//
// A última já existia (o contador de reprovações). As outras três são o que
// este arquivo lê.
//
// Por que o gabarito é o sinal que importa: para produzir a arte o designer
// PRECISA do gabarito, que só existe na página. Quem não baixou não começou —
// não é palpite, é uma dependência do processo. E a quatro dias do prazo essa
// diferença decide se o time liga hoje ou espera.
//
// Sobre o que NÃO é medido aqui: quem abriu. O link circula entre marketing,
// agência e quem assina, e é o que se quer — a pergunta é "alguém começou?",
// não "quem clicou". Nada de identificar pessoa, nem IP, nem rastreio de
// navegação. Um carimbo de tempo por stand, e só.

/**
 * Quanto tempo entre duas gravações de visita.
 *
 * Sem isto, um cliente que recarrega a página vinte vezes numa tarde gera vinte
 * escritas — e o que se ganha com a vigésima é nada: a informação que o time
 * usa é "abriu alguma vez" e "abriu recentemente", não a contagem exata.
 */
export const HORAS_ENTRE_VISITAS = 6

/** A partir de quantos dias do prazo o silêncio vira caso de telefonema. */
export const DIAS_DE_INTERVENCAO = 7

const HORA = 60 * 60 * 1000
const emMs = (v) => {
  if (!v) return null
  if (typeof v === 'number') return v
  if (typeof v?.toMillis === 'function') return v.toMillis()
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/**
 * O que gravar nesta visita — ou `null` quando não há o que gravar.
 *
 * Devolve só os campos que mudam, em caminho pontilhado, para nunca
 * sobrescrever o que já está lá. Duas abas abertas ao mesmo tempo não podem
 * fazer uma apagar a primeira visita da outra.
 */
export function visitaAGravar(acesso, { agora = Date.now(), gabarito = false } = {}) {
  const ultima = emMs(acesso?.ultimaEm)
  const primeira = emMs(acesso?.primeiraEm)
  const jaTemGabarito = Boolean(emMs(acesso?.gabaritoEm))

  const novoGabarito = gabarito && !jaTemGabarito
  const recente = ultima != null && agora - ultima < HORAS_ENTRE_VISITAS * HORA

  // Baixar o gabarito grava sempre na primeira vez, mesmo dentro da janela de
  // silêncio: é o sinal mais valioso da tela e não pode ser perdido porque a
  // pessoa abriu a página cinco minutos antes.
  if (recente && !novoGabarito) return null

  const em = new Date(agora).toISOString()
  const mudanca = {
    'acesso.ultimaEm': em,
    'acesso.visitas': (Number(acesso?.visitas) || 0) + 1,
  }
  if (primeira == null) mudanca['acesso.primeiraEm'] = em
  if (novoGabarito) mudanca['acesso.gabaritoEm'] = em
  return mudanca
}

// Ordem de gravidade, do pior para o melhor. É a ordem em que o time deve
// atacar a lista quando o prazo aperta.
export const SINAL = {
  nunca_abriu: {
    rotulo: 'Nunca abriu o link',
    acao: 'Ligar: nada foi começado',
    cor: 'ruim',
    ordem: 0,
  },
  abriu: {
    rotulo: 'Abriu, não baixou o gabarito',
    acao: 'Confirmar se o designer recebeu o link',
    cor: 'alerta',
    ordem: 1,
  },
  travado: {
    rotulo: 'Tentando enviar, sem conseguir',
    acao: 'Ajuda técnica, não cobrança',
    cor: 'alerta',
    ordem: 2,
  },
  produzindo: {
    rotulo: 'Baixou o gabarito',
    acao: 'A arte está sendo feita; cobrar perto do prazo',
    cor: 'neutro',
    ordem: 3,
  },
  enviando: {
    rotulo: 'Já enviou arte',
    acao: null,
    cor: 'bom',
    ordem: 4,
  },
}

/**
 * Em que pé está este cliente.
 *
 * A precedência é por FORÇA DA EVIDÊNCIA, não por ordem cronológica: já ter
 * enviado alguma arte diz mais do que qualquer carimbo de visita, e tentar sem
 * conseguir diz mais do que ter baixado o gabarito.
 */
export function sinalDeContato(projeto, sit = {}) {
  const acesso = projeto?.acesso || null
  const desde = emMs(acesso?.primeiraEm)
  const base = (id) => ({ id, ...SINAL[id], desde, visitas: Number(acesso?.visitas) || 0 })

  if (sit.recebidas > 0) return base('enviando')
  if (sit.dificuldade?.alerta) return base('travado')
  if (emMs(acesso?.gabaritoEm)) return base('produzindo')
  if (desde != null) return base('abriu')
  return base('nunca_abriu')
}

// ------------------------------------------------------------------ correio
//
// O que o serviço de e-mail devolveu sobre o último aviso enviado. Sem isto, um
// endereço com erro de digitação — e a importação da produção está cheia deles
// — é indistinguível de cliente relapso: o stand fica quieto e o analista cobra
// por três dias alguém que nunca recebeu nada.

export const CORREIO = {
  ok: { rotulo: 'E-mail entregue', cor: 'bom' },
  voltou: { rotulo: 'E-mail voltou', cor: 'ruim', acao: 'Endereço inválido — achar outro contato' },
  reclamou: { rotulo: 'Marcado como spam', cor: 'alerta', acao: 'Os próximos avisos não chegam' },
  desconhecido: { rotulo: 'Sem retorno ainda', cor: 'neutro' },
}

export function correioDoProjeto(projeto) {
  const c = projeto?.correio || null
  const estado = CORREIO[c?.estado] ? c.estado : 'desconhecido'
  return { estado, ...CORREIO[estado], em: emMs(c?.em), para: c?.para || null, motivo: c?.motivo || null }
}

/**
 * Este stand precisa de um telefonema?
 *
 * Duas portas, e a diferença entre elas importa:
 *
 * - e-mail que voltou é urgente SEMPRE. Não é sobre prazo: enquanto o endereço
 *   estiver errado, nenhum dos avisos automáticos chega, nem o da prova pronta
 *   depois. O canal está quebrado, e só uma pessoa conserta.
 * - silêncio só é urgente perto do prazo. Cliente que não abriu o link com 30
 *   dias pela frente não é problema; com 4 dias, é o problema mais caro que a
 *   feira tem, porque ainda dá tempo — mas só hoje.
 */
export function precisaDeIntervencao({ sinal, correio, prazo, sit }, { dias = DIAS_DE_INTERVENCAO } = {}) {
  if (sit?.total > 0 && sit.recebidas >= sit.total) return false
  if (correio?.estado === 'voltou' || correio?.estado === 'reclamou') return true
  if (!prazo?.temPrazo || prazo.vencido) return false
  if (prazo.diasRestantes > dias) return false
  return sinal?.id === 'nunca_abriu' || sinal?.id === 'abriu'
}
