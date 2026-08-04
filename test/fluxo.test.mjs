import test from 'node:test'
import assert from 'node:assert/strict'
import {
  situacaoDaPeca, situacaoDoPrazo, resumoDoProjeto, provasDaPeca,
} from '../src/core/fluxo.js'

// A esteira da peça é a regra de negócio mais fácil de quebrar sem ninguém
// perceber: o defeito não aparece como erro, aparece como um cliente que
// conseguiu (ou não conseguiu) enviar quando não devia. Daí a densidade destes
// testes.

const DIA = 24 * 60 * 60 * 1000
const AGORA = Date.parse('2026-08-10T12:00:00Z')

const lona = { id: 'p_lona', rotulo: 'Lona de fundo', larguraCm: 275, alturaCm: 275 }
const testeira = { id: 'p_test', rotulo: 'Testeira', larguraCm: 150, alturaCm: 50 }

const projeto = (extra = {}) => ({
  token: 'abc123abc123',
  pecas: [lona, testeira],
  ...extra,
})

const entregue = (pecaId, versao = 1, em = '2026-08-01T10:00:00Z') => ({
  [pecaId]: { protocolo: 'AP-1', veredicto: 'aprovado', versao, em },
})

test('peça sem envio está aguardando e pode receber arte', () => {
  const s = situacaoDaPeca(projeto(), lona, AGORA)
  assert.equal(s.status, 'aguardando')
  assert.equal(s.podeEnviar, true)
  assert.equal(s.bloqueio, null)
  assert.equal(s.proximaVersao, 1)
})

test('peça já enviada exige pedido antes de uma versão nova', () => {
  const s = situacaoDaPeca(projeto({ entregas: entregue('p_lona') }), lona, AGORA)
  assert.equal(s.status, 'recebida')
  assert.equal(s.podeEnviar, false)
  assert.equal(s.bloqueio.tipo, 'precisa_pedir')
  assert.equal(s.proximaVersao, 2)
})

test('pedido feito e ainda sem resposta segura o envio', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    pedidos: { p_lona: { motivo: 'Corrigi o telefone', paraVersao: 2, em: '2026-08-02T10:00:00Z' } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.podeEnviar, false)
  assert.equal(s.bloqueio.tipo, 'em_analise')
  assert.equal(s.pedidoEmAberto, true)
})

// O pedido guarda para qual versão foi feito. Sem isso ele continuaria valendo
// depois de atendido, e a peça ficaria presa em "em análise" para sempre.
test('pedido já atendido não segura a peça de novo', () => {
  const p = projeto({
    entregas: entregue('p_lona', 2),
    pedidos: { p_lona: { motivo: 'Corrigi o telefone', paraVersao: 2 } },
    controle: { pecas: { p_lona: { liberadoAte: 2 } } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.bloqueio.tipo, 'precisa_pedir')
  assert.equal(s.pedidoEmAberto, false)
})

test('liberação do time abre exatamente uma versão', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    pedidos: { p_lona: { motivo: 'Corrigi o telefone', paraVersao: 2 } },
    controle: { pecas: { p_lona: { liberadoAte: 2 } } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.podeEnviar, true, 'com liberação para a v2, o envio abre')
  assert.equal(s.pedidoEmAberto, false)

  // depois de receber a v2, volta a precisar de pedido para a v3
  const depois = situacaoDaPeca({ ...p, entregas: entregue('p_lona', 2) }, lona, AGORA)
  assert.equal(depois.podeEnviar, false)
  assert.equal(depois.bloqueio.tipo, 'precisa_pedir')
})

test('recusa devolve o motivo escrito pelo analista', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    pedidos: { p_lona: { motivo: 'Quero trocar a foto' } },
    controle: { pecas: { p_lona: { recusa: { motivo: 'A peça já foi impressa.', exigeExtra: true } } } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.podeEnviar, false)
  assert.equal(s.bloqueio.tipo, 'recusado')
  assert.equal(s.bloqueio.texto, 'A peça já foi impressa.')
  assert.equal(s.bloqueio.podeAceitarExtra, true)
})

test('aceite do extra não libera sozinho — quem libera é o time', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    pedidos: { p_lona: { motivo: 'Trocar foto', aceiteExtra: { em: '2026-08-03T10:00:00Z' } } },
    controle: { pecas: { p_lona: { recusa: { motivo: 'Já impressa', exigeExtra: true } } } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.podeEnviar, false, 'aceitar o custo é o pedido, não a autorização')
  assert.equal(s.bloqueio.podeAceitarExtra, false, 'já aceitou: não oferece de novo')
})

test('peça em impressão trava o envio acima de qualquer outra condição', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    controle: { pecas: { p_lona: { status: 'em_impressao', liberadoAte: 2 } } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.status, 'em_impressao')
  assert.equal(s.podeEnviar, false)
  assert.equal(s.bloqueio.tipo, 'em_producao')
})

// --------------------------------------------------------------- provas

test('prova enviada põe a peça em aprovação do cliente', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    controle: { provas: { pr1: { pecaIds: ['p_lona'], arquivo: { nome: 'prova.png' }, enviadaEm: '2026-08-05T10:00:00Z' } } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.status, 'em_prova')
  assert.equal(s.provaAtual.id, 'pr1')
})

test('reprovação parcial atinge só as peças marcadas', () => {
  const p = projeto({
    entregas: { ...entregue('p_lona'), ...entregue('p_test') },
    controle: { provas: { pr1: { pecaIds: ['p_lona', 'p_test'], enviadaEm: '2026-08-05T10:00:00Z' } } },
    respostasProva: { pr1: { decisao: 'parcial', pecasReprovadas: ['p_test'], em: '2026-08-06T10:00:00Z' } },
  })
  assert.equal(situacaoDaPeca(p, lona, AGORA).status, 'aprovada')

  const reprovada = situacaoDaPeca(p, testeira, AGORA)
  assert.equal(reprovada.status, 'reprovada')
  assert.equal(reprovada.podeEnviar, true, 'quem foi reprovado reenvia sem pedir liberação')
})

test('a prova mais recente é a que vale', () => {
  const p = projeto({
    controle: {
      provas: {
        pr1: { pecaIds: ['p_lona'], enviadaEm: '2026-08-05T10:00:00Z' },
        pr2: { pecaIds: ['p_lona'], enviadaEm: '2026-08-07T10:00:00Z' },
      },
    },
  })
  assert.deepEqual(provasDaPeca(p, 'p_lona').map((x) => x.id), ['pr1', 'pr2'])
  assert.equal(situacaoDaPeca(p, lona, AGORA).provaAtual.id, 'pr2')
})

// ---------------------------------------------------------------- prazo

test('o prazo vencido bloqueia peça nova', () => {
  const p = projeto({ prazoEnvio: '2026-08-01T23:59:00Z' })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.podeEnviar, false)
  assert.equal(s.bloqueio.tipo, 'prazo')
})

// Este é o ponto em que a regra literal puniria o cliente pelo nosso pedido:
// a prova foi reprovada pelo time, ele PRECISA reenviar, e o prazo o barraria.
test('o prazo NÃO bloqueia quem está corrigindo a pedido do time', () => {
  const p = projeto({
    prazoEnvio: '2026-08-01T23:59:00Z',
    // A ordem das datas importa e é real: a arte chega, depois sai a prova,
    // depois vem a reprovação. Uma prova anterior à arte que ela mostra seria
    // impossível — e o motor, com razão, leria isso como arte mais nova que a
    // prova, dando a peça por resolvida.
    entregas: entregue('p_lona', 1, '2026-07-15T10:00:00Z'),
    controle: { provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-07-20T10:00:00Z' } } },
    respostasProva: { pr1: { decisao: 'reprovada', em: '2026-07-21T10:00:00Z' } },
  })
  const s = situacaoDaPeca(p, lona, AGORA)
  assert.equal(s.status, 'reprovada')
  assert.equal(s.podeEnviar, true)
})

test('o prazo NÃO bloqueia uma versão já liberada pelo time', () => {
  const p = projeto({
    prazoEnvio: '2026-08-01T23:59:00Z',
    entregas: entregue('p_lona'),
    pedidos: { p_lona: { motivo: 'erro de telefone' } },
    controle: { pecas: { p_lona: { liberadoAte: 2 } } },
  })
  assert.equal(situacaoDaPeca(p, lona, AGORA).podeEnviar, true)
})

test('a prorrogação por stand vale enquanto durar, e não para sempre', () => {
  const base = { prazoEnvio: '2026-08-01T00:00:00Z' }
  const aberta = situacaoDoPrazo({ ...base, prorrogadoAte: '2026-08-15T00:00:00Z' }, AGORA)
  assert.equal(aberta.vencido, false)
  assert.equal(aberta.prorrogado, true)
  assert.equal(aberta.diasRestantes, 5)

  const expirada = situacaoDoPrazo({ ...base, prorrogadoAte: '2026-08-05T00:00:00Z' }, AGORA)
  assert.equal(expirada.vencido, true)
})

test('prazo aceita Timestamp do Firestore, Date e texto ISO', () => {
  const alvo = Date.parse('2026-08-20T00:00:00Z')
  for (const valor of [
    { seconds: alvo / 1000 },
    new Date(alvo),
    '2026-08-20T00:00:00Z',
  ]) {
    const s = situacaoDoPrazo({ prazoEnvio: valor }, AGORA)
    assert.equal(s.vencido, false)
    assert.equal(s.limite, alvo)
  }
})

test('sem prazo cadastrado, nada é bloqueado', () => {
  const s = situacaoDoPrazo(projeto(), AGORA)
  assert.equal(s.temPrazo, false)
  assert.equal(s.vencido, false)
})

// --------------------------------------------------------------- resumo

test('o resumo conta o que o painel precisa mostrar', () => {
  const p = projeto({
    prazoEnvio: new Date(AGORA + 3 * DIA).toISOString(),
    entregas: { ...entregue('p_lona'), ...entregue('p_test') },
    pedidos: { p_test: { motivo: 'trocar cor' } },
    controle: { pecas: { p_lona: { status: 'em_impressao' } } },
  })
  const r = resumoDoProjeto(p, AGORA)
  assert.equal(r.total, 2)
  assert.equal(r.recebidas, 2)
  assert.equal(r.emProducao, 1)
  assert.equal(r.pedidosEmAberto.length, 1)
  assert.equal(r.pedidosEmAberto[0].peca.id, 'p_test')
  assert.equal(r.prazo.diasRestantes, 3)
  assert.equal(r.completo, true)
})

// Bug relatado na operação: o cliente mandava a arte corrigida e o cartão
// continuava vermelho, escrito "Prova reprovada — refazer". A tela pedia o que
// ele acabara de fazer. Uma prova fala de UMA versão da arte; chegando versão
// nova, ela deixa de valer.
test('arte nova encerra a reprovação daquela prova', () => {
  const base = {
    controle: { provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } } },
    respostasProva: { pr1: { decisao: 'reprovada', em: '2026-08-06T10:00:00Z' } },
  }

  const antes = situacaoDaPeca(projeto({ ...base, entregas: entregue('p_lona', 1) }), lona, AGORA)
  assert.equal(antes.status, 'reprovada')

  const depois = situacaoDaPeca(projeto({ ...base, entregas: entregue('p_lona', 2) }), lona, AGORA)
  assert.equal(depois.status, 'recebida', 'v2 recebida: a reprovação da v1 não vale mais')
  assert.equal(depois.provaAtual, null, 'a prova antiga sai de cena; o time manda uma nova')
  assert.equal(depois.podeEnviar, false, 'para uma v3 ele volta a precisar pedir')
})

test('aprovação também caduca quando chega arte nova', () => {
  const p = projeto({
    entregas: entregue('p_lona', 2),
    controle: { provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } } },
    respostasProva: { pr1: { decisao: 'aprovada', em: '2026-08-06T10:00:00Z' } },
  })
  assert.equal(situacaoDaPeca(p, lona, AGORA).status, 'recebida',
    'aprovar a v1 não aprova a v2 — precisa de prova nova')
})

test('prova antiga, sem a versão gravada, cai para a comparação de datas', () => {
  const semVersao = {
    controle: { provas: { pr1: { pecaIds: ['p_lona'], enviadaEm: '2026-08-05T10:00:00Z' } } },
    respostasProva: { pr1: { decisao: 'reprovada', em: '2026-08-06T10:00:00Z' } },
  }
  const antiga = { p_lona: { protocolo: 'AP-1', veredicto: 'aprovado', versao: 1, em: '2026-08-01T10:00:00Z' } }
  const nova = { p_lona: { protocolo: 'AP-2', veredicto: 'aprovado', versao: 2, em: '2026-08-07T10:00:00Z' } }

  assert.equal(situacaoDaPeca(projeto({ ...semVersao, entregas: antiga }), lona, AGORA).status, 'reprovada')
  assert.equal(situacaoDaPeca(projeto({ ...semVersao, entregas: nova }), lona, AGORA).status, 'recebida')
})

test('a prova continua valendo enquanto a versão não muda', () => {
  const p = projeto({
    entregas: entregue('p_lona', 1),
    controle: { provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } } },
  })
  assert.equal(situacaoDaPeca(p, lona, AGORA).status, 'em_prova')
})
