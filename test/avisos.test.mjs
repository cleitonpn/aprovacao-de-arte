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

// Os três nomes são diferentes de propósito: quem recebe o e-mail (`expositor`,
// que na tela é "Cliente / expositor"), o stand e a feira. Iguais, um teste
// passaria com o campo trocado — foi assim que o assunto saiu "Suas artes do
// cleiton — Petvet", com o nome de quem recebe no lugar do stand.
const projeto = (extra = {}) => ({
  token: 'abc123abc123',
  feira: 'KEMIN 2026',
  expositor: 'Cleiton',
  stand: 'Kemin Nutrição Animal',
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

test('o e-mail não convida a responder — o domínio não recebe', () => {
  // Não há MX na raiz de sistemastands.com: uma resposta voltaria com erro de
  // entrega, e o cliente ficaria achando que falou com alguém. Toda a
  // tratativa é dentro do sistema, onde fica registrada junto com as artes.
  const p = projeto({
    entregas: entregue('p_lona'),
    controle: { provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } } },
  })
  const [a] = avisosPendentes(p, { agora: AGORA })
  for (const corpo of [a.texto, a.html]) {
    assert.doesNotMatch(corpo, /responda este e-?mail/i)
    assert.match(corpo, /não recebe respostas/i)
    assert.match(corpo, /Dúvidas com o time/)
  }
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

// ----------------------------------------------------- de quem é este e-mail
//
// O erro que isto tranca: o assunto saía "Suas artes do cleiton — Petvet",
// juntando o nome de quem recebe com o da feira. Quem expõe em três feiras no
// mês recebia três assuntos quase idênticos e não sabia qual stand abrir.

test('todo aviso se identifica pelo stand e pela feira, não pelo nome de quem recebe', () => {
  const p = projeto({
    prazoEnvio: AGORA + 2 * DIA,
    pecas: [lona, testeira, { id: 'p_bal', rotulo: 'Balcão', larguraCm: 100, alturaCm: 100 }],
    entregas: { ...entregue('p_lona'), ...entregue('p_test') },
    controle: {
      provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-05T10:00:00Z' } },
      pecas: { p_test: { devolucao: { motivo: 'Cor não fecha.', paraVersao: 1, em: '2026-08-07T10:00:00Z' } } },
    },
  })
  const avisos = avisosPendentes(p, { agora: AGORA, novo: true })
  assert.deepEqual(tipos(avisos), ['boas_vindas', 'devolucao', 'prazo', 'prova'])

  for (const a of avisos) {
    assert.match(a.assunto, /Kemin Nutrição Animal/, `assunto sem o stand: ${a.tipo}`)
    assert.match(a.assunto, /KEMIN 2026/, `assunto sem a feira: ${a.tipo}`)
    // O nome do cliente é para saudar, não para identificar o stand.
    assert.doesNotMatch(a.assunto, /Cleiton/, `nome do cliente no assunto: ${a.tipo}`)
    assert.match(a.texto, /^Olá, Cleiton!/, `saudação sem o nome: ${a.tipo}`)
    assert.match(a.texto, /stand Kemin Nutrição Animal para a feira KEMIN 2026/, a.tipo)
  }
})

test('sem nome de cliente a saudação não fica com vírgula solta', () => {
  const p = projeto({ expositor: '' })
  const [a] = avisosPendentes(p, { agora: AGORA, novo: true })
  assert.match(a.texto, /^Olá! Você está cadastrado/)
})

test('projeto antigo sem nome de stand cai no nome do cliente', () => {
  // A importação da produção nem sempre traz o stand. Melhor "stand Kemin" do
  // que "stand undefined" — o cliente reconhece o próprio nome.
  const p = projeto({ stand: '', expositor: 'Kemin' })
  const [a] = avisosPendentes(p, { agora: AGORA, novo: true })
  assert.match(a.assunto, /stand Kemin para a feira KEMIN 2026/)
})

test('sem feira cadastrada o assunto não fica pela metade', () => {
  const p = projeto({ feira: '' })
  const [a] = avisosPendentes(p, { agora: AGORA, novo: true })
  assert.equal(a.assunto, 'Suas artes do stand Kemin Nutrição Animal')
  assert.doesNotMatch(a.texto, /para a feira\b/)
})

// ------------------------------------------------------------ boas-vindas
//
// Substitui o e-mail que o atendimento manda à mão a cada cadastro. Numa feira
// de trezentos expositores isso é um dia de trabalho — e é onde o link se
// perde, chega sem as medidas, ou não chega.

test('cadastro novo recebe boas-vindas com peças, prazo e link', () => {
  const p = projeto({ prazoEnvio: AGORA + 20 * DIA })
  const avisos = avisosPendentes(p, { agora: AGORA, novo: true })
  const a = avisos.find((x) => x.tipo === 'boas_vindas')

  assert.ok(a, 'um cadastro novo precisa avisar o cliente')
  assert.equal(a.chave, 'boas_vindas:abc123abc123')
  assert.deepEqual(a.para, ['marketing@kemin.com', 'agencia@x.com'])
  assert.match(a.assunto, /KEMIN 2026/)
  // as peças com as medidas, que é o que o atendimento digitava à mão
  assert.match(a.texto, /Lona de fundo — 275 × 275 cm/)
  assert.match(a.texto, /Testeira — 150 × 50 cm/)
  assert.match(a.texto, /2 peças/)
  assert.match(a.texto, /30\/08\/2026/)
  assert.match(a.texto, /abc123abc123/)
})

// A trava que impede o primeiro dia no ar de mandar "bem-vindo, envie suas
// artes" para a base inteira, incluindo quem já imprimiu.
test('sem `novo`, projeto existente nunca recebe boas-vindas', () => {
  const p = projeto({ prazoEnvio: AGORA + 20 * DIA })
  assert.deepEqual(avisosPendentes(p, { agora: AGORA }), [])
  assert.equal(
    avisosPendentes(p, { agora: AGORA, novo: false }).some((x) => x.tipo === 'boas_vindas'),
    false,
  )
})

test('cadastro sem peças ainda não tem o que pedir', () => {
  const p = projeto({ pecas: [] })
  assert.equal(avisosPendentes(p, { agora: AGORA, novo: true }).length, 0)
})

test('sem prazo definido, o texto não inventa uma data', () => {
  const [a] = avisosPendentes(projeto(), { agora: AGORA, novo: true })
  assert.match(a.texto, /prazo de envio será informado/)
  assert.doesNotMatch(a.texto, /Invalid Date|NaN/)
})
