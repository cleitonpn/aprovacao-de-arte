import test from 'node:test'
import assert from 'node:assert/strict'
import { escalaProvavel } from '../src/core/analise.js'

// Um cliente real levou DEZ reprovações seguidas porque montou a arte em 1:10 e
// não trocou o seletor na tela. A ferramenta já calculava esta função desde
// sempre e nenhuma tela lia o resultado: ela sabia a resposta e calava.
//
// Agora ela aplica sozinha — e por isso a função decide veredicto. Um falso
// positivo aqui aprova uma arte que está de fato pequena demais, que é
// exatamente o erro que a ferramenta existe para não cometer.

test('reconhece as escalas de trabalho usuais', () => {
  assert.equal(escalaProvavel(27.5, 275), 10)
  assert.equal(escalaProvavel(68.75, 275), 4)
  assert.equal(escalaProvavel(137.5, 275), 2)
})

test('tamanho real não vira escala', () => {
  // O caso mais comum de todos não pode ser confundido com nada.
  assert.equal(escalaProvavel(275, 275), null)
})

test('tolera o arredondamento de quem montou o arquivo', () => {
  // 27,5 cm vira 27 ou 28 na mão do designer, e continua sendo 1:10.
  assert.equal(escalaProvavel(28, 275), 10)
  assert.equal(escalaProvavel(27, 275), 10)
})

test('arquivo pequeno demais e fora de escala continua sendo problema', () => {
  // 1:7 não existe como escala de trabalho. Sem correspondência, a arte é
  // reprovada por tamanho — que é o certo.
  assert.equal(escalaProvavel(39.3, 275), null)
  assert.equal(escalaProvavel(5, 275), null)
})

test('arquivo maior que a peça nunca é escala', () => {
  // Sangria faz o arquivo passar da medida; reduzir é o oposto disso.
  assert.equal(escalaProvavel(295, 275), null)
})

test('medida ausente ou zero não inventa escala', () => {
  for (const v of [null, 0, undefined, NaN]) {
    assert.equal(escalaProvavel(v, 275), null)
    assert.equal(escalaProvavel(27.5, v), null)
  }
})
