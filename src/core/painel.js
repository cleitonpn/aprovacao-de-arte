// O cenário inteiro de uma feira, num objeto só.
//
// A pergunta que este arquivo responde é a que o admin faz ao abrir o painel
// de manhã: "como está a feira?". Hoje ela só era respondível lendo a lista de
// stands inteira e somando de cabeça — e na semana da montagem essa lista tem
// centenas de linhas.
//
// Tudo aqui é função pura sobre os documentos que as telas já carregam. Não há
// consulta nova, não há contador guardado no banco para sair de sincronia: o
// painel é uma leitura diferente dos mesmos dados que a lista mostra.

import { resumoDoProjeto, STATUS, rotuloParaOTime, situacaoDoPrazo } from './fluxo.js'
import { dificuldadeDoProjeto } from './reprovacoes.js'
import { sinalDeContato, correioDoProjeto, contatoDoProjeto, precisaDeIntervencao, SINAL } from './contato.js'

/**
 * Junta as duas fontes de verdade sobre um projeto.
 *
 * O ESTADO de cada peça (em prova, aprovada, em impressão) sai do documento do
 * projeto. Já o que de fato CHEGOU sai de `envios`, que o expositor não lê nem
 * escreve. É de propósito: se algum dia o espelho do projeto divergir do que
 * foi realmente recebido, o painel mostra o que chegou, não o que alguém
 * declarou ter enviado.
 */
export function situacaoDoProjeto(projeto, envios = []) {
  const resumo = resumoDoProjeto(projeto)
  const comEnvio = new Set(envios.filter((e) => e.pecaId).map((e) => e.pecaId))

  const pecas = resumo.pecas.map((s) => ({ ...s, envios: envios.filter((e) => e.pecaId === s.peca.id) }))
  const recebidas = pecas.filter((s) => comEnvio.has(s.peca.id)).length

  const dificuldade = dificuldadeDoProjeto(projeto)

  return {
    ...resumo,
    pecas,
    envios,
    recebidas,
    // Por que este stand está calado. "0 de 5" é o mesmo número para quem nunca
    // abriu o link e para quem está com o designer trabalhando — e as duas
    // situações pedem ações opostas.
    sinal: sinalDeContato(projeto, { recebidas, dificuldade }),
    correio: correioDoProjeto(projeto),
    contato: contatoDoProjeto(projeto),
    pendentes: pecas.filter((s) => !comEnvio.has(s.peca.id)),
    apoio: envios.filter((e) => e.tipoEnvio === 'avulso'),
    // Arte que o cliente mandou por fora da lista: ele digitou a medida à mão.
    // Precisa aparecer com destaque justamente porque é o único caso em que a
    // medida voltou a ser palpite dele.
    extras: envios.filter((e) => e.tipoEnvio !== 'avulso' && !e.pecaId),
    completo: pecas.length > 0 && recebidas === pecas.length,
    provasAguardando: pecas.filter((s) => s.status === 'em_prova').length,
    dificuldade,
  }
}

// A ordem da esteira é a ordem real do trabalho, não a alfabética nem a do
// objeto STATUS. Quem olha a barra está lendo um caminho da esquerda para a
// direita: o que ainda não chegou, o que chegou, o que está com o cliente, o
// que já é produção.
const ESTEIRA = ['aguardando', 'recebida', 'em_prova', 'reprovada', 'aprovada', 'em_impressao', 'impressa']

const pct = (parte, todo) => (todo ? Math.round((parte / todo) * 100) : 0)

/**
 * O panorama da feira.
 *
 * @param {Array<{projeto: object, sit: object, temMensagemNova?: boolean}>} linhas
 */
export function panorama(linhas = [], { feira = null, agora = Date.now() } = {}) {
  const sits = linhas.map((l) => l.sit)
  const soma = (f) => sits.reduce((s, x) => s + f(x), 0)

  const total = soma((s) => s.total)
  const recebidas = soma((s) => s.recebidas)

  // Cada faixa carrega os STANDS que a compõem, não só o número.
  //
  // Sem isso a barra respondia "onde estão as peças?" e parava aí — o número
  // certo e nenhum caminho até ele. "11 provas esperando o cliente" é uma
  // informação incompleta: a pergunta seguinte é sempre "de quem?", e ela
  // levava a abrir a lista inteira e conferir stand por stand.
  const pecas = sits.flatMap((s) => s.pecas)
  const esteira = ESTEIRA.map((id) => {
    const stands = linhas
      .map(({ projeto, sit }) => ({
        projeto,
        pecas: sit.pecas.filter((p) => p.status === id).map((p) => p.peca.rotulo),
      }))
      .filter((l) => l.pecas.length > 0)
      .sort((a, b) => b.pecas.length - a.pecas.length)

    return {
      id,
      // O rótulo do TIME: esta barra é do painel, e "sua aprovação" aqui
      // apontaria para o analista em vez do cliente.
      rotulo: rotuloParaOTime(id),
      cor: STATUS[id]?.cor || 'neutro',
      n: pecas.filter((p) => p.status === id).length,
      stands,
    }
  }).filter((f) => f.n > 0)

  // "Precisa de você" é a lista do que só anda com uma ação do time. Não é um
  // resumo do que existe — é a fila de trabalho, e por isso mistura coisas de
  // naturezas diferentes que têm em comum estarem paradas esperando alguém.
  const pedidos = linhas.filter(({ sit }) => sit.pedidosEmAberto.length > 0)
  const provas = linhas.filter(({ sit }) => sit.provasAguardando > 0)
  const mensagens = linhas.filter((l) => l.temMensagemNova)
  const dificuldade = linhas
    .filter(({ sit }) => sit.dificuldade.alerta)
    .sort((a, b) => b.sit.dificuldade.total - a.sit.dificuldade.total)

  // O prazo é da feira e vale para todos; o de um stand prorrogado é exceção e
  // aparece na linha dele, não aqui.
  const prazo = situacaoDoPrazo({ prazoEnvio: feira?.prazoEnvio }, agora)

  // Quem precisa de um telefonema hoje.
  //
  // Esta é a única lista do painel que aponta para FORA do sistema: as outras
  // pedem um clique do analista, esta pede que alguém ligue. Por isso ela é
  // curta de propósito — e-mail que voltou (o canal está quebrado, e nenhum
  // aviso futuro vai chegar) ou silêncio total com o prazo em cima.
  //
  // O prazo usado é o do STAND quando ele tem um (prorrogação é individual) e
  // o da feira quando não tem.
  const intervencao = linhas
    .filter(({ sit }) => precisaDeIntervencao({
      sinal: sit.sinal,
      correio: sit.correio,
      contato: sit.contato,
      prazo: sit.prazo?.temPrazo ? sit.prazo : prazo,
      sit,
    }, { agora }))
    .sort((a, b) => (a.sit.correio.estado === 'voltou' ? -1 : 0) - (b.sit.correio.estado === 'voltou' ? -1 : 0)
      || (SINAL[a.sit.sinal.id]?.ordem ?? 9) - (SINAL[b.sit.sinal.id]?.ordem ?? 9)
      || b.sit.total - a.sit.total)

  const semNada = linhas.filter(({ sit }) => sit.total > 0 && sit.recebidas === 0)
  const incompletos = linhas
    .filter(({ sit }) => sit.total > 0 && sit.recebidas < sit.total)
    .sort((a, b) => (a.sit.recebidas / a.sit.total) - (b.sit.recebidas / b.sit.total)
      || b.sit.total - a.sit.total)

  return {
    stands: linhas.length,
    artes: { total, recebidas, faltam: total - recebidas, pct: pct(recebidas, total) },
    completos: linhas.filter(({ sit }) => sit.completo).length,
    semNada,
    incompletos,
    esteira,
    pecasTotal: pecas.length,
    emProducao: soma((s) => s.emProducao),
    impressas: soma((s) => s.impressas),
    apoio: soma((s) => s.apoio.length),
    extras: soma((s) => s.extras.length),
    acoes: { pedidos, provas, mensagens, dificuldade, intervencao },
    // Quantas coisas, ao todo, dependem de alguém do time agora. É o número
    // que diz se o dia está tranquilo ou não.
    aFazer: pedidos.length + provas.length + mensagens.length + dificuldade.length + intervencao.length,
    prazo,
  }
}
