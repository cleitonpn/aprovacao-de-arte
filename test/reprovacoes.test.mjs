import test from 'node:test'
import assert from 'node:assert/strict'
import { dificuldadeDoProjeto } from '../src/core/reprovacoes.js'

// ------------------------------------------- a saída do alerta de dificuldade
//
// O alerta sumia quando alguém ABRIA a ficha, e isso era local do navegador:
// voltava para o resto do time no dia seguinte. O stand ficava marcado para
// sempre, mesmo depois de o analista ter resolvido por telefone — e alerta que
// não se apaga vira paisagem, até o próximo caso de verdade passar batido.

test('conversa registrada cala o alerta de dificuldade', () => {
  const p = { dificuldade: { reprovacoes: 6 }, controle: { contato: { reprovacoesAte: 6 } } }
  const d = dificuldadeDoProjeto(p)
  assert.equal(d.alerta, false)
  assert.equal(d.atendido, true)
  assert.equal(d.total, 6, 'o número continua visível na ficha; o que cala é o alerta')
})

test('o alerta volta na tentativa reprovada seguinte', () => {
  // Por CONTAGEM, e não por tempo: aqui existe um evento novo capaz de dizer
  // que a conversa não resolveu — o cliente tentar de novo e ser recusado de
  // novo. Enquanto ele não tentar, não há notícia nenhuma.
  const p = { dificuldade: { reprovacoes: 7 }, controle: { contato: { reprovacoesAte: 6 } } }
  const d = dificuldadeDoProjeto(p)
  assert.equal(d.alerta, true)
  assert.equal(d.atendido, false)
})

test('conversa em stand que ainda não passou do limite não inventa alerta', () => {
  const p = { dificuldade: { reprovacoes: 2 }, controle: { contato: { reprovacoesAte: 2 } } }
  assert.equal(dificuldadeDoProjeto(p).alerta, false)
})

test('sem conversa registrada, nada muda no comportamento antigo', () => {
  assert.equal(dificuldadeDoProjeto({ dificuldade: { reprovacoes: 4 } }).alerta, true)
  assert.equal(dificuldadeDoProjeto({ dificuldade: { reprovacoes: 4 } }).atendido, false)
})
