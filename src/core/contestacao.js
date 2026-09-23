// Quando o cliente discorda da reprovação.
//
// A ferramenta reprova no navegador e a arte não sobe — é a trava que dá
// sentido a tudo o mais. Mas a trava produz um impasse que não tinha saída: o
// cliente liga dizendo "a minha arte está certa e a ferramenta está
// reprovando", e o time não tem como conferir, porque o arquivo nunca chegou.
// A conversa vira palavra contra palavra, e quem está com pressa é quem
// desiste — às vezes o cliente que tinha razão.
//
// A saída NÃO é afrouxar a análise nem guardar em silêncio o que foi reprovado
// (a ferramenta promete, em três telas, que o arquivo só sai do computador do
// cliente quando ele clica em enviar — quebrar isso custaria a confiança que
// faz ele testar dez vezes sem medo).
//
// A saída é uma CONTESTAÇÃO: o cliente afirma, por escrito e assinado, que
// considera a arte correta; o arquivo sobe MARCADO como contestado; e uma
// pessoa do time decide, também por escrito. Três consequências, todas
// deliberadas:
//
// 1. o cliente deixa de ficar travado sem saída;
// 2. o time passa a ter o arquivo — mas só nos casos em que alguém de fato
//    discordou, não nas reprovações legítimas que ninguém iria olhar;
// 3. a discussão fica registrada: quem contestou, com que argumento, quem
//    decidiu e por quê. É o que tira o "isso é muito subjetivo" da mesa.
//
// A peça contestada NÃO conta como recebida enquanto espera decisão. Se
// contasse, o stand apareceria pronto sem estar — e o pior momento para
// descobrir isso é no dia da montagem.

/**
 * Tamanho mínimo do texto, nos dois sentidos.
 *
 * Não é burocracia: é o que separa este registro de um formulário que se
 * despacha no automático. "ok", "está certo" e "não pode" não ensinam nada a
 * quem for ler os casos depois para calibrar a ferramenta — e ler os casos
 * depois é a razão de o registro existir.
 */
export const MINIMO_MOTIVO = 20

/** Os achados que NÃO podem ser contestados, com o motivo de cada um. */
export const SEM_CONTESTACAO = {
  // Fonte não incorporada não é questão de opinião nem de calibragem: o texto
  // sai com outra fonte na produção, ou não sai. Deixar contestar aqui só
  // adiaria a descoberta para o dia da impressão, que é quando custa caro.
  'pdf-fontes': 'Fonte não incorporada troca o texto na impressão — isso não muda com uma segunda opinião. Reexporte o PDF com as fontes incorporadas (ou converta os textos em curvas).',
}

const texto = (v) => String(v ?? '').trim()

/** O cliente pode contestar ESTE laudo? */
export function podeContestar(resultado) {
  if (resultado?.veredicto !== 'reprovado') return { pode: false, motivo: 'nao_reprovado' }

  const bloqueantes = (resultado?.achados || []).filter((a) => a.nivel === 'bloqueante')
  if (!bloqueantes.length) return { pode: false, motivo: 'nao_reprovado' }

  // Basta UM achado insuperável para o caminho não fazer sentido: mesmo que o
  // time aceitasse o resto, o arquivo continuaria não podendo ser impresso.
  const travado = bloqueantes.find((a) => SEM_CONTESTACAO[a.id])
  if (travado) {
    return { pode: false, motivo: 'insuperavel', achado: travado.id, explicacao: SEM_CONTESTACAO[travado.id] }
  }

  return { pode: true, motivo: 'ok' }
}

/**
 * O que o cliente escreveu vale como contestação?
 *
 * Nome obrigatório pelo mesmo motivo do aceite de ressalva: o link circula
 * entre marketing, agência e diretoria, e "alguém contestou" não é assinatura
 * de ninguém — nem serve de argumento quando a peça der problema depois.
 */
export function validarContestacao({ motivo, nome, email } = {}) {
  const erros = {}
  if (texto(motivo).length < MINIMO_MOTIVO) {
    erros.motivo = `Explique em pelo menos ${MINIMO_MOTIVO} caracteres por que você considera esta arte correta.`
  }
  if (texto(nome).length < 3) erros.nome = 'Informe seu nome.'
  // E-mail é opcional, mas se vier tem que ser plausível — é por ele que o
  // time responde quando a decisão sai.
  if (texto(email) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto(email))) {
    erros.email = 'E-mail inválido.'
  }
  return { valido: Object.keys(erros).length === 0, erros }
}

/** O que o ANALISTA escreveu vale como decisão? */
export function validarDecisao({ aceita, motivo } = {}) {
  const erros = {}
  if (aceita !== true && aceita !== false) erros.aceita = 'Escolha aceitar ou recusar.'
  // Obrigatório NOS DOIS SENTIDOS, e é o que faz o log valer alguma coisa.
  // Uma recusa sem motivo escrito vira "não deu" na tela do cliente — que é
  // exatamente a resposta que gerou a contestação — e não ensina nada a quem
  // for ler os casos para calibrar a ferramenta.
  if (texto(motivo).length < MINIMO_MOTIVO) {
    erros.motivo = `Escreva em pelo menos ${MINIMO_MOTIVO} caracteres o motivo da decisão — vale tanto para aceitar quanto para recusar.`
  }
  return { valido: Object.keys(erros).length === 0, erros }
}

/** O documento da contestação, do jeito que ele vai gravado no envio. */
export function contestacaoParaEnvio({ motivo, nome, email, em = new Date().toISOString() }) {
  return {
    motivo: texto(motivo).slice(0, 1000),
    nome: texto(nome).slice(0, 120),
    email: texto(email).toLowerCase().slice(0, 160) || null,
    em,
  }
}

/** O documento da decisão do time. */
export function decisaoParaEnvio({ aceita, motivo, por, em = new Date().toISOString() }) {
  return {
    aceita: aceita === true,
    motivo: texto(motivo).slice(0, 1000),
    por: texto(por).toLowerCase().slice(0, 160) || null,
    em,
  }
}

/** Em que pé está a contestação de um envio. */
export function estadoDaContestacao(envio) {
  const c = envio?.contestacao
  if (!c) return null
  if (!c.decisao) return 'aguardando'
  return c.decisao.aceita ? 'aceita' : 'recusada'
}

/** Este envio conta como arte entregue? */
export function contaComoEntrega(envio) {
  const estado = estadoDaContestacao(envio)
  // Sem contestação, o envio é o que sempre foi: aprovado ou ressalva aceita,
  // porque as regras não deixam outra coisa subir.
  if (estado === null) return true
  // Contestada e ainda sem resposta NÃO conta. Se contasse, o stand apareceria
  // pronto enquanto o time ainda nem olhou — e o dia de descobrir isso seria o
  // da montagem.
  return estado === 'aceita'
}

/** As contestações que ainda esperam alguém do time. */
export const contestacoesAbertas = (envios = []) =>
  envios.filter((e) => estadoDaContestacao(e) === 'aguardando')

/**
 * Os casos, do mais novo para o mais velho, para a tela de log.
 *
 * O objetivo declarado desta lista é alimentar a calibragem da ferramenta: ler
 * o que a análise reprovou, o que o cliente alegou e o que a pessoa decidiu, e
 * descobrir onde o limiar está errado. Por isso ela carrega os três textos
 * juntos — separados, ninguém cruza.
 */
export function casosDeContestacao(envios = []) {
  return envios
    .filter((e) => e?.contestacao)
    .map((e) => ({
      protocolo: e.protocolo,
      em: e.contestacao.em,
      estado: estadoDaContestacao(e),
      feiraId: e.feiraId ?? null,
      projetoId: e.projetoId ?? null,
      peca: e.pecaRotulo || e.cadastro?.stand || '—',
      stand: e.cadastro?.stand || '—',
      expositor: e.cadastro?.nome || '—',
      arquivo: e.arquivo || null,
      // O que a FERRAMENTA disse. Só os bloqueantes: são eles que reprovaram.
      motivosDaFerramenta: (e.laudo?.achados || [])
        .filter((a) => a.nivel === 'bloqueante')
        .map((a) => ({ id: a.id ?? null, titulo: a.titulo || '' })),
      // O que o CLIENTE alegou.
      alegacao: e.contestacao.motivo || '',
      quemContestou: e.contestacao.nome || '',
      // O que o TIME decidiu.
      decisao: e.contestacao.decisao || null,
    }))
    .sort((a, b) => Date.parse(b.em || 0) - Date.parse(a.em || 0))
}

/**
 * O placar por motivo de reprovação — a leitura que calibra a ferramenta.
 *
 * Um achado que o time aceita quase sempre é um limiar apertado demais; um que
 * ele recusa quase sempre está calibrado e o que falta é explicação melhor na
 * tela do cliente. Sem este cruzamento, o log vira uma lista que ninguém lê.
 */
export function placarPorMotivo(casos = []) {
  const placar = new Map()
  for (const caso of casos) {
    if (!caso.decisao) continue
    for (const m of caso.motivosDaFerramenta) {
      const chave = m.id || 'sem_id'
      const atual = placar.get(chave) || { id: chave, titulo: m.titulo, aceitas: 0, recusadas: 0 }
      if (caso.decisao.aceita) atual.aceitas += 1
      else atual.recusadas += 1
      placar.set(chave, atual)
    }
  }
  return [...placar.values()]
    .map((p) => ({ ...p, total: p.aceitas + p.recusadas }))
    .sort((a, b) => b.total - a.total)
}
