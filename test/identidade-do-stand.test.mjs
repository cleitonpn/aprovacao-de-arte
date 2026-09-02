import test from 'node:test'
import assert from 'node:assert/strict'
import { tituloDoProjeto, localSemRepetirStand } from '../src/data/projeto.js'
import { normalizarDaProducao } from '../src/core/producao.js'

// As duas identidades de um stand: a EMPRESA ("LW") e o CÓDIGO na planta
// ("A25"). Elas viviam trocadas na tela — o código em negrito, a empresa em
// cinza pequeno ao lado —, e o código ainda aparecia uma segunda vez dentro do
// endereço, porque a importação da produção gravava `local` em dois campos.

test('o título é a empresa; o código do stand fica de apoio', () => {
  const { titulo, apoio } = tituloDoProjeto({ expositor: 'LW', stand: 'A25' })
  assert.equal(titulo, 'LW')
  assert.equal(apoio, 'A25')
})

test('sem empresa, o código vira o título — e não se repete ao lado', () => {
  // Documento da produção sem `nome`, ou cadastro às pressas só com o stand.
  // Um título vazio é pior que um código; o que não pode é "A25 · A25".
  const { titulo, apoio } = tituloDoProjeto({ expositor: '  ', stand: 'A25' })
  assert.equal(titulo, 'A25')
  assert.equal(apoio, '')
})

test('sem nada, o título não fica vazio', () => {
  assert.equal(tituloDoProjeto({}).titulo, 'Sem nome')
  assert.equal(tituloDoProjeto().titulo, 'Sem nome')
})

test('o endereço não repete o código que já está ao lado', () => {
  // O valor gravado pelos projetos importados antes da correção.
  assert.equal(localSemRepetirStand('SP EXPO · A25', 'A25'), 'SP EXPO')
  // Digitado à mão, com o código no meio.
  assert.equal(localSemRepetirStand('Rua 3 · A25 · Pavilhão Azul', 'A25'), 'Rua 3 · Pavilhão Azul')
  // Sem repetição, nada muda.
  assert.equal(localSemRepetirStand('SP EXPO', 'A25'), 'SP EXPO')
})

test('o corte compara trecho inteiro, nunca pedaço de palavra', () => {
  // O caso que um `includes` estragaria: pavilhão "A25" e stand "A2". Cortar
  // por substring deixaria o endereço como "5", que não é lugar nenhum.
  assert.equal(localSemRepetirStand('A25', 'A2'), 'A25')
  // E o inverso: pavilhão "A" com stand "A" — aí SÃO iguais, e some mesmo.
  assert.equal(localSemRepetirStand('A', 'A'), '')
  // Diferença de caixa não impede o corte: o app da produção não padroniza.
  assert.equal(localSemRepetirStand('SP EXPO · a25', 'A25'), 'SP EXPO')
})

test('entradas vazias não inventam separador', () => {
  assert.equal(localSemRepetirStand('', 'A25'), '')
  assert.equal(localSemRepetirStand('SP EXPO', ''), 'SP EXPO')
  assert.equal(localSemRepetirStand(null, null), '')
})

test('a importação da produção não grava mais o código dentro do endereço', () => {
  // A causa raiz. `local` já vira `stand`; repeti-lo em `localizacao` é o que
  // fazia "A25" aparecer duas vezes na mesma linha da lista.
  const c = normalizarDaProducao({
    fairName: 'SP EXPO', nome: 'LW', local: 'A25', pavilhao: 'Pavilhão Azul',
  })
  assert.equal(c.stand, 'A25')
  assert.equal(c.expositor, 'LW')
  assert.equal(c.localizacao, 'Pavilhão Azul')
})

test('sem pavilhão, o endereço fica vazio em vez de virar o código do stand', () => {
  const c = normalizarDaProducao({ fairName: 'SP EXPO', nome: 'LW', local: 'A25' })
  assert.equal(c.localizacao, '')
})
