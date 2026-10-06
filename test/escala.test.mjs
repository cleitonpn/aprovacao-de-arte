import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escalaProvavel, ESCALAS } from '../src/core/analise.js'

// Um cliente real levou DEZ reprovações seguidas porque montou a arte em 1:10 e
// não trocou o seletor na tela. A ferramenta já calculava esta função desde
// sempre e nenhuma tela lia o resultado: ela sabia a resposta e calava.
//
// Agora ela aplica sozinha — e por isso a função decide veredicto. Um falso
// positivo aqui aprova uma arte que está de fato pequena demais, que é
// exatamente o erro que a ferramenta existe para não cometer.

/** Peça do caso real relatado: lona de fundo com 10 cm de sangria por lado. */
const LONA = { larguraCm: 110, alturaCm: 275 }
const SANGRIA = 10

/** Uma peça sem sangria, para os casos em que ela não entra na conta. */
const SEM_SANGRIA = { larguraCm: 275, alturaCm: 275 }

test('reconhece as escalas de trabalho usuais', () => {
  assert.equal(escalaProvavel({ largura: 27.5, altura: 27.5 }, SEM_SANGRIA), 10)
  assert.equal(escalaProvavel({ largura: 68.75, altura: 68.75 }, SEM_SANGRIA), 4)
  assert.equal(escalaProvavel({ largura: 137.5, altura: 137.5 }, SEM_SANGRIA), 2)
})

test('o arquivo montado COM sangria é reconhecido — era o que reprovava', () => {
  // O caso que gerou a reclamação. O cartão da peça manda montar em
  // 130 × 295 cm; o designer montou exatamente isso, em 1:4, e entregou um PDF
  // de 31,7 × 73,3 cm. Comparado só com o corte (110 × 275), isso dá 3,75× —
  // fora da tolerância por pouco. Escala não reconhecida, arquivo lido como
  // tamanho real, 75 dpi, arte reprovada. E o cliente tinha feito tudo certo.
  assert.equal(escalaProvavel({ largura: 31.7, altura: 73.3 }, LONA, SANGRIA), 4)

  // As outras escalas, no mesmo arquivo montado com sangria.
  assert.equal(escalaProvavel({ largura: 13, altura: 29.5 }, LONA, SANGRIA), 10)
  assert.equal(escalaProvavel({ largura: 65, altura: 147.5 }, LONA, SANGRIA), 2)
})

test('o arquivo montado no corte continua sendo reconhecido', () => {
  // A mesma peça, de quem montou sem sangria. As duas leituras valem.
  assert.equal(escalaProvavel({ largura: 11, altura: 27.5 }, LONA, SANGRIA), 10)
  assert.equal(escalaProvavel({ largura: 27.5, altura: 68.75 }, LONA, SANGRIA), 4)
})

test('tamanho real não vira escala', () => {
  // O caso mais comum de todos não pode ser confundido com nada.
  assert.equal(escalaProvavel({ largura: 275, altura: 275 }, SEM_SANGRIA), null)
  assert.equal(escalaProvavel({ largura: 110, altura: 275 }, LONA, SANGRIA), null)
  assert.equal(escalaProvavel({ largura: 130, altura: 295 }, LONA, SANGRIA), null)
})

test('tolera o arredondamento de quem montou o arquivo', () => {
  // 27,5 cm vira 27 ou 28 na mão do designer, e continua sendo 1:10.
  assert.equal(escalaProvavel({ largura: 28, altura: 28 }, SEM_SANGRIA), 10)
  assert.equal(escalaProvavel({ largura: 27, altura: 27 }, SEM_SANGRIA), 10)
})

test('arquivo pequeno demais e fora de escala continua sendo problema', () => {
  // 1:7 não existe como escala de trabalho. Sem correspondência, a arte é
  // reprovada por tamanho — que é o certo.
  assert.equal(escalaProvavel({ largura: 39.3, altura: 39.3 }, SEM_SANGRIA), null)
  assert.equal(escalaProvavel({ largura: 5, altura: 5 }, SEM_SANGRIA), null)
})

test('arquivo maior que a peça nunca é escala', () => {
  // Sangria faz o arquivo passar da medida; reduzir é o oposto disso.
  assert.equal(escalaProvavel({ largura: 295, altura: 295 }, SEM_SANGRIA), null)
})

test('os dois lados precisam concordar com a mesma escala', () => {
  // A versão antiga olhava só a largura. Este arquivo tem a largura de um 1:10
  // e a altura de um 1:4 — é arte na proporção errada, não arte reduzida.
  // Aceitá-lo como 1:10 multiplicaria a resolução por dez e aprovaria, calado,
  // um arquivo pequeno demais. O erro só apareceria depois de impresso.
  assert.equal(escalaProvavel({ largura: 11, altura: 68.75 }, LONA, SANGRIA), null)
})

test('medida ausente ou zero não inventa escala', () => {
  for (const v of [null, 0, undefined, NaN]) {
    assert.equal(escalaProvavel({ largura: v, altura: 27.5 }, SEM_SANGRIA), null)
    assert.equal(escalaProvavel({ largura: 27.5, altura: v }, SEM_SANGRIA), null)
    assert.equal(escalaProvavel({ largura: 27.5, altura: 27.5 }, { larguraCm: v, alturaCm: v }), null)
  }
  assert.equal(escalaProvavel(null, SEM_SANGRIA), null)
})

test('a ferramenta adivinha todas as escalas que o seletor oferece', () => {
  // Uma escala que o cliente pode escolher à mão e a ferramenta não reconhece
  // sozinha é exatamente o buraco que gerou a reclamação: quem não sabe que o
  // campo existe não vai usá-lo.
  const tela = readFileSync(new URL('../src/components/Projeto.jsx', import.meta.url), 'utf8')
  const ofertadas = [...tela.matchAll(/<option value=\{(\d+)\}>1:\d+/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n !== 1) // 1:1 é a ausência de escala, não uma escala
  assert.ok(ofertadas.length, 'não achei o seletor de escala na tela')
  assert.deepEqual(
    [...ESCALAS].sort((a, b) => a - b),
    [...new Set(ofertadas)].sort((a, b) => a - b),
  )
})
