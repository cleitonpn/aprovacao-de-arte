import test from 'node:test'
import assert from 'node:assert/strict'
import { PASSOS, REQUISITOS, SUPORTE } from '../src/core/tutorial.js'
import { DPI_PISO_ABSOLUTO, DPI_MINIMO_GLOBAL, SANGRIA_MINIMA_MM } from '../src/core/regras.js'

// localStorage de mentira, como em visto.test.mjs.
const memoria = new Map()
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
}
const { jaViuTutorial, marcarTutorialVisto } = await import('../src/store/tutorial.js')

test('o tutorial promete os números que o motor cobra', () => {
  // O ponto deste teste: os requisitos são CALCULADOS a partir de regras.js,
  // não escritos à mão. Se alguém mudar o piso de dpi e esquecer do texto, o
  // cliente passa a ler uma instrução que a ferramenta não cumpre — foi o que
  // aconteceu quando o piso caiu de 150 para 100.
  const resolucao = REQUISITOS.find((r) => r.titulo === 'Resolução')
  assert.ok(resolucao.texto.includes(String(DPI_PISO_ABSOLUTO)), 'o piso precisa aparecer')
  assert.ok(resolucao.texto.includes(String(DPI_MINIMO_GLOBAL)), 'o padrão de ouro precisa aparecer')

  const sangria = REQUISITOS.find((r) => r.titulo === 'Sangria')
  assert.ok(sangria.texto.includes(String(SANGRIA_MINIMA_MM / 10)), 'a sangria em cm precisa aparecer')
})

test('o horário de atendimento sai de um lugar só', () => {
  assert.equal(SUPORTE.texto, 'segunda a sexta, das 08:00 às 18:00')
})

test('todo passo e todo requisito têm título e texto', () => {
  for (const p of PASSOS) {
    assert.ok(p.titulo?.length > 3, `passo sem título: ${JSON.stringify(p)}`)
    assert.ok(p.texto?.length > 20, `passo sem texto: ${p.titulo}`)
  }
  for (const r of REQUISITOS) {
    assert.ok(r.titulo?.length > 2, `requisito sem título: ${JSON.stringify(r)}`)
    assert.ok(r.texto?.length > 20, `requisito sem texto: ${r.titulo}`)
  }
  assert.ok(PASSOS.length >= 5, 'o fluxo tem pelo menos cinco etapas reais')
})

test('a marca de "já viu" é por stand', () => {
  memoria.clear()
  assert.equal(jaViuTutorial('stand-a'), false)
  marcarTutorialVisto('stand-a')
  assert.equal(jaViuTutorial('stand-a'), true)
  // O link circula entre marketing, agência e diretoria. Ter visto num stand
  // não pode calar o tutorial no stand seguinte.
  assert.equal(jaViuTutorial('stand-b'), false)
})

test('sem onde gravar, o tutorial aparece — que é o lado certo para errar', () => {
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => { throw new Error('aba anônima') },
    setItem: () => { throw new Error('aba anônima') },
  }
  assert.equal(jaViuTutorial('stand-c'), false)
  assert.doesNotThrow(() => marcarTutorialVisto('stand-c'), 'gravar não pode quebrar a tela')
  globalThis.localStorage = real
})
