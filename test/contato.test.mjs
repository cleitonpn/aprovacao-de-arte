import test from 'node:test'
import assert from 'node:assert/strict'
import {
  visitaAGravar, sinalDeContato, correioDoProjeto, precisaDeIntervencao,
  HORAS_ENTRE_VISITAS, DIAS_DE_INTERVENCAO,
} from '../src/core/contato.js'

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA
const AGORA = Date.parse('2026-08-20T12:00:00Z')
const iso = (ms) => new Date(ms).toISOString()

// ------------------------------------------------------- o que se grava

test('a primeira visita grava o carimbo inicial', () => {
  const m = visitaAGravar(null, { agora: AGORA })
  assert.equal(m['acesso.primeiraEm'], iso(AGORA))
  assert.equal(m['acesso.ultimaEm'], iso(AGORA))
  assert.equal(m['acesso.visitas'], 1)
  assert.equal('acesso.gabaritoEm' in m, false)
})

test('recarregar a página não gera gravação nova', () => {
  // Um cliente que abre e fecha vinte vezes numa tarde geraria vinte escritas,
  // e a vigésima não informa nada que a primeira já não tenha informado.
  const acesso = { primeiraEm: iso(AGORA - HORA), ultimaEm: iso(AGORA - HORA), visitas: 1 }
  assert.equal(visitaAGravar(acesso, { agora: AGORA }), null)
})

test('passada a janela de silêncio, a visita volta a ser registrada', () => {
  const antes = AGORA - (HORAS_ENTRE_VISITAS + 1) * HORA
  const m = visitaAGravar({ primeiraEm: iso(antes), ultimaEm: iso(antes), visitas: 3 }, { agora: AGORA })
  assert.equal(m['acesso.visitas'], 4)
  // A primeira visita é imutável: é dela que sai "abriu pela primeira vez há
  // quantos dias", e sobrescrever apagaria o histórico do stand.
  assert.equal('acesso.primeiraEm' in m, false)
})

test('o gabarito grava mesmo dentro da janela de silêncio', () => {
  // É o sinal mais valioso da tela — quem baixou o gabarito começou a produzir.
  // Perdê-lo porque a pessoa abriu a página cinco minutos antes seria trocar o
  // dado que importa por uma escrita economizada.
  const acesso = { primeiraEm: iso(AGORA - 300000), ultimaEm: iso(AGORA - 300000), visitas: 1 }
  const m = visitaAGravar(acesso, { agora: AGORA, gabarito: true })
  assert.equal(m['acesso.gabaritoEm'], iso(AGORA))
})

test('baixar o gabarito de novo não regrava a data', () => {
  const acesso = { primeiraEm: iso(AGORA - DIA), ultimaEm: iso(AGORA - DIA), gabaritoEm: iso(AGORA - DIA) }
  const m = visitaAGravar(acesso, { agora: AGORA, gabarito: true })
  assert.equal('acesso.gabaritoEm' in m, false)
})

test('só grava campos de acesso, nada mais', () => {
  // As regras do Firestore liberam ao cliente um conjunto fechado de campos.
  // Uma chave a mais aqui vira "permission-denied" na cara dele, no meio do
  // envio, sem relação aparente com o que ele estava fazendo.
  const m = visitaAGravar(null, { agora: AGORA, gabarito: true })
  for (const chave of Object.keys(m)) assert.match(chave, /^acesso\./)
})

// ------------------------------------------------------------- o sinal

const sit = (extra = {}) => ({ total: 5, recebidas: 0, dificuldade: { alerta: false }, ...extra })

test('sem carimbo nenhum, nunca abriu', () => {
  assert.equal(sinalDeContato({}, sit()).id, 'nunca_abriu')
})

test('abriu mas não baixou o gabarito', () => {
  const s = sinalDeContato({ acesso: { primeiraEm: iso(AGORA - 2 * DIA), visitas: 4 } }, sit())
  assert.equal(s.id, 'abriu')
  assert.equal(s.desde, AGORA - 2 * DIA)
  assert.equal(s.visitas, 4)
})

test('baixou o gabarito: o designer está trabalhando', () => {
  const p = { acesso: { primeiraEm: iso(AGORA - DIA), gabaritoEm: iso(AGORA - DIA) } }
  assert.equal(sinalDeContato(p, sit()).id, 'produzindo')
})

test('quem tentou e não conseguiu não é caso de cobrança', () => {
  // Cobrar quem está travado na ferramenta é o pior erro possível de leitura:
  // a pessoa está tentando há dias e recebe uma ligação perguntando se vai
  // mandar.
  const p = { acesso: { primeiraEm: iso(AGORA - DIA), gabaritoEm: iso(AGORA - DIA) } }
  const s = sinalDeContato(p, sit({ dificuldade: { alerta: true } }))
  assert.equal(s.id, 'travado')
  assert.match(s.acao, /Ajuda técnica/)
})

test('quem já enviou vence qualquer carimbo de visita', () => {
  // Evidência mais forte manda. Um stand com arte recebida não pode aparecer
  // como "nunca abriu" só porque o carimbo é anterior a este recurso existir.
  assert.equal(sinalDeContato({}, sit({ recebidas: 2 })).id, 'enviando')
})

// ----------------------------------------------------------- o correio

test('sem retorno do serviço de e-mail, o estado é desconhecido', () => {
  // Nunca "entregue" por omissão: dizer que chegou sem ter recebido confirmação
  // é a mentira que faz o time parar de ligar para quem precisa.
  assert.equal(correioDoProjeto({}).estado, 'desconhecido')
  assert.equal(correioDoProjeto({ correio: { estado: 'inventado' } }).estado, 'desconhecido')
})

test('o retorno traz o endereço e o motivo', () => {
  const c = correioDoProjeto({
    correio: { estado: 'voltou', em: iso(AGORA), para: 'marketing@kemim.com', motivo: 'mailbox does not exist' },
  })
  assert.equal(c.cor, 'ruim')
  assert.equal(c.para, 'marketing@kemim.com')
  assert.match(c.acao, /outro contato/)
})

// ------------------------------------------------------- a intervenção

const caso = (extra = {}) => ({
  sinal: { id: 'nunca_abriu' },
  correio: { estado: 'desconhecido' },
  prazo: { temPrazo: true, vencido: false, diasRestantes: 4 },
  sit: sit(),
  ...extra,
})

test('quatro dias de prazo e nunca abriu é caso de telefonema', () => {
  assert.equal(precisaDeIntervencao(caso()), true)
})

test('trinta dias de prazo e nunca abriu não é urgência', () => {
  // Alarme que toca cedo demais é alarme que se aprende a ignorar — e aí o de
  // quatro dias também não é ouvido.
  assert.equal(precisaDeIntervencao(caso({ prazo: { temPrazo: true, vencido: false, diasRestantes: 30 } })), false)
  assert.equal(precisaDeIntervencao(caso({ prazo: { temPrazo: false } })), false)
})

test('e-mail que voltou é urgente independentemente do prazo', () => {
  // Não é sobre este aviso: enquanto o endereço estiver errado, NENHUM aviso
  // futuro chega — nem o da prova pronta, que é o mais caro de se perder.
  const c = caso({
    correio: { estado: 'voltou' },
    prazo: { temPrazo: true, vencido: false, diasRestantes: 45 },
    sinal: { id: 'produzindo' },
  })
  assert.equal(precisaDeIntervencao(c), true)
})

test('quem já entregou tudo sai da lista, mesmo com e-mail quebrado', () => {
  const c = caso({ correio: { estado: 'voltou' }, sit: sit({ recebidas: 5 }) })
  assert.equal(precisaDeIntervencao(c), false)
})

test('quem baixou o gabarito não entra na lista pelo prazo', () => {
  // Está produzindo. Ligar para quem está trabalhando gasta o telefonema que
  // faria falta em outro stand.
  assert.equal(precisaDeIntervencao(caso({ sinal: { id: 'produzindo' } })), false)
  assert.equal(precisaDeIntervencao(caso({ sinal: { id: 'travado' } })), false)
})

test('prazo vencido não entra: aí já é outra conversa', () => {
  const c = caso({ prazo: { temPrazo: true, vencido: true, diasRestantes: -2 } })
  assert.equal(precisaDeIntervencao(c), false)
})

test('o limiar de dias é o mesmo do lembrete de prazo mais próximo', () => {
  assert.equal(DIAS_DE_INTERVENCAO, 7)
})
