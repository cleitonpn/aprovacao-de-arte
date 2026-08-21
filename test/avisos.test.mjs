import test from 'node:test'
import assert from 'node:assert/strict'
import { avisosPendentes, destinatarios, linkDoStand, DIAS_DE_LEMBRETE } from '../src/core/avisos.js'

// E-mail não se desfaz. Um aviso mandado à toa custa a confiança do cliente
// nos próximos, e um aviso que não sai custa a prova parada por três dias.
// Daí a densidade destes testes.

const DIA = 24 * 60 * 60 * 1000
const AGORA = Date.parse('2026-08-10T12:00:00Z')

const lona = { id: 'p_lona', rotulo: 'Lona de fundo', larguraCm: 275, alturaCm: 275 }
const testeira = { id: 'p_test', rotulo: 'Testeira', larguraCm: 150, alturaCm: 50 }

const projeto = (extra = {}) => ({
  token: 'abc123abc123',
  feira: 'KEMIN 2026',
  expositor: 'Kemin',
  emails: ['marketing@kemin.com', 'agencia@x.com'],
  pecas: [lona, testeira],
  ...extra,
})

const entregue = (pecaId, versao = 1) => ({
  [pecaId]: { protocolo: 'AP-1', veredicto: 'aprovado', versao, em: '2026-08-01T10:00:00Z' },
})

const tipos = (avisos) => avisos.map((a) => a.tipo).sort()

test('sem e-mail cadastrado não há o que mandar', () => {
  const p = projeto({ emails: [], email: '' })
  assert.deepEqual(avisosPendentes(p, { agora: AGORA }), [])
})

test('o aviso vai para a lista inteira, não só para o primeiro', () => {
  // Decisão de arte raramente cai numa pessoa só: tem o marketing, tem a
  // agência, tem quem assina.
  assert.deepEqual(destinatarios(projeto()), ['marketing@kemin.com', 'agencia@x.com'])
  // Compatível com os projetos antigos, que só têm o campo no singular.
  assert.deepEqual(destinatarios({ email: 'A@B.com' }), ['a@b.com'])
})

test('o link leva direto ao stand', () => {
  assert.equal(linkDoStand('abc123'), 'https://sistemastands.com/#/p/abc123')
})

// ------------------------------------------------------------------ prova

test('prova esperando aceite gera um aviso', () => {
  const p = projeto({
    entregas: { ...entregue('p_lona'), ...entregue('p_test') },
    controle: {
      provas: {
        pr1: {
          pecaIds: ['p_lona', 'p_test'],
          versoes: { p_lona: 1, p_test: 1 },
          enviadaEm: '2026-08-05T10:00:00Z',
        },
      },
    },
  })
  const avisos = avisosPendentes(p, { agora: AGORA })
  assert.equal(avisos.length, 1)
  const [a] = avisos
  assert.equal(a.tipo, 'prova')
  assert.equal(a.chave, 'prova:pr1')
  assert.deepEqual(a.para, ['marketing@kemin.com', 'agencia@x.com'])
  assert.match(a.assunto, /prova de impressão está pronta/i)
  assert.match(a.assunto, /KEMIN 2026/)
  // As duas peças cabem no mesmo e-mail: a prova é o mockup do stand inteiro,
  // e mandar um e-mail por peça para o mesmo aceite seria ruído.
  assert.match(a.texto, /Lona de fundo, Testeira/)
  assert.match(a.texto, /abc123abc123/)
  assert.match(a.html, /abc123abc123/)
})

test('prova já respondida não avisa de novo', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    respostasProva: { pr1: { decisao: 'aprovada', em: '2026-08-06T10:00:00Z' } },
    controle: {
      provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } },
    },
  })
  assert.deepEqual(avisosPendentes(p, { agora: AGORA }), [])
})

// --------------------------------------------------------------- devolução

test('arte devolvida avisa com o motivo e a próxima versão', () => {
  const p = projeto({
    entregas: entregue('p_lona'),
    controle: {
      pecas: {
        p_lona: {
          devolucao: {
            motivo: 'O texto do rodapé some atrás do perfil de alumínio.',
            paraVersao: 1,
            em: '2026-08-07T10:00:00Z',
          },
        },
      },
    },
  })
  const avisos = avisosPendentes(p, { agora: AGORA })
  assert.equal(avisos.length, 1)
  const [a] = avisos
  assert.equal(a.tipo, 'devolucao')
  assert.equal(a.chave, 'devolucao:p_lona:v1')
  assert.match(a.assunto, /Lona de fundo/)
  // O motivo tem que viajar no e-mail. Sem ele o cliente abre o link só para
  // descobrir o que já poderia ter lido.
  assert.match(a.texto, /perfil de alumínio/)
  assert.match(a.texto, /versão 2/)
})

test('devolução já atendida não avisa', () => {
  const p = projeto({
    entregas: entregue('p_lona', 2),
    controle: {
      pecas: { p_lona: { devolucao: { motivo: 'x', paraVersao: 1, em: '2026-08-07T10:00:00Z' } } },
    },
  })
  assert.equal(tipos(avisosPendentes(p, { agora: AGORA })).includes('devolucao'), false)
})

// ------------------------------------------------------------------ prazo

test('lembra do prazo nos dias combinados, e só neles', () => {
  const comPrazo = (dias) => projeto({ prazoEnvio: AGORA + dias * DIA })
  for (const d of DIAS_DE_LEMBRETE) {
    const avisos = avisosPendentes(comPrazo(d), { agora: AGORA })
    assert.equal(avisos.length, 1, `deveria avisar a ${d} dias`)
    assert.equal(avisos[0].chave.endsWith(`:${d}`), true)
  }
  // Num dia qualquer entre os combinados, silêncio.
  assert.deepEqual(avisosPendentes(comPrazo(5), { agora: AGORA }), [])
})

test('quem já mandou tudo não é cobrado', () => {
  // Cobrar quem não deve é como se ensina o cliente a ignorar os nossos
  // e-mails — e aí o aviso que importa também não é lido.
  const p = projeto({
    prazoEnvio: AGORA + 2 * DIA,
    entregas: { ...entregue('p_lona'), ...entregue('p_test') },
  })
  assert.equal(tipos(avisosPendentes(p, { agora: AGORA })).includes('prazo'), false)
})

test('prazo vencido não vira lembrete', () => {
  const p = projeto({ prazoEnvio: AGORA - 2 * DIA })
  assert.deepEqual(avisosPendentes(p, { agora: AGORA }), [])
})

test('o texto do prazo diz quantas peças faltam e a data', () => {
  // 2 dias exatos a partir de AGORA — a data é escrita no fuso de Brasília,
  // que é o do cliente, não o do servidor que mandou o e-mail.
  const p = projeto({ prazoEnvio: AGORA + 2 * DIA, entregas: entregue('p_lona') })
  const [a] = avisosPendentes(p, { agora: AGORA })
  assert.equal(a.tipo, 'prazo')
  assert.match(a.texto, /1 peça/)
  assert.match(a.texto, /12\/08\/2026/)
})

// ------------------------------------------------------------ idempotência

test('a chave é estável entre execuções', () => {
  // É a chave que impede o cliente de receber o mesmo e-mail duas vezes: quem
  // envia grava a chave antes de mandar. Se ela mudasse a cada passagem, a
  // marca não serviria para nada e o gatilho — que roda "pelo menos uma vez" —
  // mandaria em duplicata.
  const p = projeto({
    entregas: entregue('p_lona'),
    controle: { provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } } },
  })
  const a = avisosPendentes(p, { agora: AGORA })
  const b = avisosPendentes(p, { agora: AGORA + 3 * DIA })
  assert.deepEqual(a.map((x) => x.chave), b.map((x) => x.chave))
})

test('os três avisos convivem sem se atrapalhar', () => {
  const p = projeto({
    prazoEnvio: AGORA + 2 * DIA,
    pecas: [lona, testeira, { id: 'p_bal', rotulo: 'Balcão', larguraCm: 100, alturaCm: 100 }],
    entregas: { ...entregue('p_lona'), ...entregue('p_test') },
    controle: {
      provas: { pr1: { pecaIds: ['p_test'], versoes: { p_test: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } },
      pecas: { p_lona: { devolucao: { motivo: 'Cor não fecha.', paraVersao: 1, em: '2026-08-07T10:00:00Z' } } },
    },
  })
  assert.deepEqual(tipos(avisosPendentes(p, { agora: AGORA })), ['devolucao', 'prazo', 'prova'])
})
