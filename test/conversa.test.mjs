import test from 'node:test'
import assert from 'node:assert/strict'
import { temMensagemNova, chaveDaConversa } from '../src/core/conversa.js'

// A badge vermelha da conversa, dos dois lados.
//
// O aviso que acende sem motivo é pior que aviso nenhum: em duas feiras o time
// para de olhar, e aí a mensagem que importava passa junto. Estes testes travam
// as três formas de ele mentir — acender pela própria mensagem, acender de
// novo depois de lido, e apagar cedo demais.

const agora = '2026-08-30T12:00:00.000Z'
const antes = '2026-08-30T09:00:00.000Z'
const ms = (iso) => Date.parse(iso)

test('a badge acende só para mensagem do outro lado', () => {
  const conversa = { ultimoAutor: 'cliente', ultimaEm: agora }
  assert.equal(temMensagemNova({ conversa, ehTime: true, vistoEmMs: 0 }), true)
  // O analista acabou de escrever: a própria mensagem dele não é novidade
  // para ele. Sem isto, todo painel ficaria permanentemente marcado.
  assert.equal(temMensagemNova({ conversa, ehTime: false, vistoEmMs: 0 }), false)

  const doTime = { ultimoAutor: 'time', ultimaEm: agora }
  assert.equal(temMensagemNova({ conversa: doTime, ehTime: false, vistoEmMs: 0 }), true)
  assert.equal(temMensagemNova({ conversa: doTime, ehTime: true, vistoEmMs: 0 }), false)
})

test('depois de lida, apaga — e continua apagada', () => {
  const conversa = { ultimoAutor: 'time', ultimaEm: antes }
  assert.equal(temMensagemNova({ conversa, vistoEmMs: ms(agora) }), false)
  // Marca exatamente igual à mensagem: já foi vista. Comparar com >= aqui
  // deixaria a bolinha acesa para sempre na última mensagem da conversa.
  assert.equal(temMensagemNova({ conversa, vistoEmMs: ms(antes) }), false)
})

test('mensagem mais nova que a última visita acende de novo', () => {
  const conversa = { ultimoAutor: 'time', ultimaEm: agora }
  assert.equal(temMensagemNova({ conversa, vistoEmMs: ms(antes) }), true)
})

test('conversa que nunca existiu não acende nada', () => {
  for (const conversa of [null, undefined, {}, { ultimaEm: agora }]) {
    assert.equal(temMensagemNova({ conversa, ehTime: true, vistoEmMs: 0 }), false)
  }
  assert.equal(temMensagemNova(), false)
})

test('a chave do "já vi" é a mesma que o painel sempre usou', () => {
  // Trocar este formato zeraria a marca de todo mundo em silêncio: o
  // localStorage do analista continuaria lá, sob a chave antiga, e a tela
  // acenderia aviso em cada stand como se nada tivesse sido lido.
  assert.equal(chaveDaConversa('abc123'), 'conversa:abc123')
})
