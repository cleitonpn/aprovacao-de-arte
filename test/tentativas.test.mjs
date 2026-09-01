import test from 'node:test'
import assert from 'node:assert/strict'

const memoria = new Map()
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
}
const {
  anotarReprovacao, reprovacoesDaPeca, limparPeca,
  conviteDispensado, dispensarConvite, TENTATIVAS_ATE_OFERECER,
} = await import('../src/store/tentativas.js')

// Quando a ferramenta se oferece para ajudar.
//
// O time já tinha o alerta de cliente travado; quem não tinha era o cliente. E
// o convite só vale se aparecer na hora certa: cedo demais é intromissão, e
// aparecer para quem só foi e voltou na tela ensina a ignorar tudo o que a
// página diz.

test('só conta arquivo diferente — vaivém do cliente não é dificuldade', () => {
  memoria.clear()
  assert.equal(anotarReprovacao('tok', 'p1', 'arquivo-a'), 1)
  // A mesma arte reanalisada (ele trocou a escala, ou voltou para a peça) não
  // é uma tentativa nova. Sem isto, sair e entrar na peça três vezes produzia
  // o convite sem o cliente ter mexido em nada.
  assert.equal(anotarReprovacao('tok', 'p1', 'arquivo-a'), 1)
  assert.equal(anotarReprovacao('tok', 'p1', 'arquivo-b'), 2)
  assert.equal(reprovacoesDaPeca('tok', 'p1'), 2)
})

test('a conta é por peça e por stand', () => {
  memoria.clear()
  anotarReprovacao('tok', 'p1', 'a')
  anotarReprovacao('tok', 'p1', 'b')
  // Penar na lona não é penar na testeira: quem resolveu uma e travou na outra
  // não deve receber o convite já na primeira tentativa da segunda.
  assert.equal(reprovacoesDaPeca('tok', 'p2'), 0)
  assert.equal(reprovacoesDaPeca('outro', 'p1'), 0)
})

test('quando a arte passa, a peça sai da conta', () => {
  memoria.clear()
  anotarReprovacao('tok', 'p1', 'a')
  anotarReprovacao('tok', 'p1', 'b')
  anotarReprovacao('tok', 'p1', 'c')
  assert.ok(reprovacoesDaPeca('tok', 'p1') >= TENTATIVAS_ATE_OFERECER)
  limparPeca('tok', 'p1')
  // O próximo problema começa do zero. Senão o convite apareceria na primeira
  // reprovação de uma peça que ele acabou de resolver.
  assert.equal(reprovacoesDaPeca('tok', 'p1'), 0)
})

test('dispensado uma vez, não volta', () => {
  memoria.clear()
  assert.equal(conviteDispensado('tok', 'p1'), false)
  dispensarConvite('tok', 'p1')
  assert.equal(conviteDispensado('tok', 'p1'), true)
  // E dispensar não apaga a conta: o time continua vendo as tentativas.
  anotarReprovacao('tok', 'p1', 'a')
  assert.equal(reprovacoesDaPeca('tok', 'p1'), 1)
  assert.equal(conviteDispensado('tok', 'p1'), true)
})

test('a conta não cresce sem limite', () => {
  memoria.clear()
  for (let i = 0; i < 60; i++) anotarReprovacao('tok', 'p1', `arq-${i}`)
  // Guardar cem hashes por peça encheria o localStorage de quem tem trinta
  // peças, e o número exato acima de vinte não muda decisão nenhuma.
  assert.ok(reprovacoesDaPeca('tok', 'p1') <= 20)
})

test('sem onde gravar, a tela não quebra — só não oferece ajuda', () => {
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => { throw new Error('aba anônima') },
    setItem: () => { throw new Error('aba anônima') },
  }
  assert.doesNotThrow(() => anotarReprovacao('tok', 'p1', 'a'))
  assert.equal(reprovacoesDaPeca('tok', 'p1'), 0)
  assert.equal(conviteDispensado('tok', 'p1'), false)
  globalThis.localStorage = real
})
