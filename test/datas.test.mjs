import test from 'node:test'
import assert from 'node:assert/strict'
import { emMs, formatarData, formatarDataHora, paraInputData, fimDoDia } from '../src/core/datas.js'
import { situacaoDoPrazo } from '../src/core/fluxo.js'

// Estes testes existem por causa de um bug que o cliente viu na cara:
//
//   "Prazo para envio das artes: Invalid Date — faltam 23 dia(s)"
//
// A conta dos dias estava certa. A data ao lado dela, não. A causa foi a mesma
// conversão copiada em cinco arquivos, cada cópia conhecendo um conjunto
// diferente de formatos: a da tela do cliente não sabia ler NÚMERO — e é
// exatamente número que `situacaoDoPrazo` devolve em `limite`.

const ISO = '2026-08-27T23:59:59.000Z'
const MS = Date.parse(ISO)

test('lê todas as formas de data que circulam na ferramenta', () => {
  assert.equal(emMs(ISO), MS, 'texto ISO')
  assert.equal(emMs(MS), MS, 'número em ms — o que as funções puras devolvem')
  assert.equal(emMs(new Date(MS)), MS, 'Date')
  assert.equal(emMs({ seconds: MS / 1000, nanoseconds: 0 }), MS, 'Timestamp do Firestore')
  assert.equal(emMs({ toMillis: () => MS }), MS, 'Timestamp já embrulhado')
})

test('devolve 0 para o que não é data, em vez de NaN', () => {
  for (const v of [null, undefined, '', 0, 'ontem', {}, [], NaN, Infinity]) {
    assert.equal(emMs(v), 0, `${String(v)} deveria virar 0`)
  }
})

test('o limite do prazo, que é número, formata como data de verdade', () => {
  const prazo = situacaoDoPrazo({ prazoEnvio: ISO }, MS - 23 * 24 * 60 * 60 * 1000)
  assert.equal(typeof prazo.limite, 'number')
  const texto = formatarData(prazo.limite)
  assert.notEqual(texto, 'Invalid Date')
  assert.match(texto, /^\d{2}\/\d{2}\/\d{4}$/)
})

test('sem data, mostra o vazio escolhido — e não "Invalid Date"', () => {
  assert.equal(formatarData(null), '—')
  assert.equal(formatarDataHora(null), '—')
  // A tela de cobrança conta com nulo para omitir a frase do prazo inteira.
  assert.equal(formatarData(null, null), null)
})

test('o campo de data não pula um dia por causa do fuso', () => {
  // Prazo gravado às 23:59:59 locais: com toISOString isto voltava para o
  // campo como o DIA SEGUINTE em qualquer fuso a oeste de Greenwich, e o
  // analista salvava sem perceber um prazo um dia mais longo.
  const local = fimDoDia('2026-08-27')
  assert.equal(paraInputData(local), '2026-08-27')
  assert.equal(paraInputData(null), '')
})

test('fim do dia é o fim do dia, não a virada', () => {
  const d = new Date(fimDoDia('2026-08-27'))
  assert.equal(d.getDate(), 27)
  assert.equal(d.getHours(), 23)
  assert.equal(d.getMinutes(), 59)
  assert.equal(fimDoDia(''), null)
})
