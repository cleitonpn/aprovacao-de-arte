import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarDaProducao, utilizavel, cruzarComExistentes, feirasDaProducao, pendenciasDe,
} from '../src/core/producao.js'
import { projetoNovo, normalizarProjeto } from '../src/data/projeto.js'

// A ponte com o app de produção. O erro caro aqui não é a tela ficar feia — é
// importar duas vezes o mesmo stand: o cliente recebe dois links, manda a arte
// num, e o time cobra pelo outro para sempre.

const daProducao = (extra = {}) => ({
  producaoId: 'conferencialuxo_12',
  fairName: 'Conferencia Luxo - ECBR',
  nome: 'After Click',
  local: 'A12',
  pavilhao: 'Pavilhão Azul',
  total_area: '36',
  produtor: 'Marcos',
  atendimento: 'Ana',
  project_link: 'https://drive.google.com/x',
  data_montagem: '20/08/2026',
  ...extra,
})

test('traduz o vocabulário do app para o daqui', () => {
  const c = normalizarDaProducao(daProducao())
  assert.equal(c.feira, 'Conferencia Luxo - ECBR')
  assert.equal(c.expositor, 'After Click', 'nome no app é o expositor aqui')
  assert.equal(c.stand, 'A12', '"local" no app é o stand aqui — não o nome da empresa')
  assert.equal(c.localizacao, 'Pavilhão Azul · A12')
  assert.equal(c.area, '36')
  assert.equal(c.linkDrive, 'https://drive.google.com/x')
})

test('sem stand na planta, o nome da empresa serve de stand', () => {
  const c = normalizarDaProducao(daProducao({ local: '' }))
  assert.equal(c.stand, 'After Click')
})

test('linha vazia da planilha não vira candidato a importação', () => {
  assert.equal(utilizavel(normalizarDaProducao(daProducao())), true)
  assert.equal(utilizavel(normalizarDaProducao({ fairName: 'X' })), false, 'sem id')
  assert.equal(utilizavel(normalizarDaProducao({ producaoId: 'x', nome: 'Y' })), false, 'sem feira')
  assert.equal(utilizavel(normalizarDaProducao({ producaoId: 'x', fairName: 'F' })), false, 'sem nome nem stand')
})

test('quem já foi importado não pode ser importado de novo', () => {
  const c = normalizarDaProducao(daProducao())
  const [linha] = cruzarComExistentes([c], [
    { token: 'tok1', feira: c.feira, stand: c.stand, producaoId: 'conferencialuxo_12' },
  ])
  assert.equal(linha.jaImportado, true)
  assert.equal(linha.vincula, false, 'já está ligado — não há o que vincular')
})

test('projeto cadastrado à mão antes da ponte é reconhecido pelo par feira + stand', () => {
  // Este é o caso que causaria a duplicata: o stand existe aqui, mas sem o id
  // da produção, então a comparação por id não o encontraria.
  const c = normalizarDaProducao(daProducao())
  const [linha] = cruzarComExistentes([c], [
    { token: 'tok1', feira: 'CONFERENCIA LUXO - ECBR', stand: 'a12', producaoId: '' },
  ])
  assert.equal(linha.jaImportado, true, 'acento, caixa e pontuação não podem separar o mesmo stand')
  assert.equal(linha.vincula, true, 'e vale oferecer a ligação, que é o que o app vai usar')
  assert.equal(linha.existente.token, 'tok1')
})

test('stand que ainda não existe aqui fica disponível para importar', () => {
  const c = normalizarDaProducao(daProducao())
  const [linha] = cruzarComExistentes([c], [
    { token: 'outro', feira: 'Outra Feira', stand: 'A12', producaoId: '' },
  ])
  assert.equal(linha.jaImportado, false, 'mesmo stand em OUTRA feira é outro stand')
  assert.equal(linha.existente, null)
})

test('as feiras saem com a contagem de expositores', () => {
  const clientes = [
    normalizarDaProducao(daProducao()),
    normalizarDaProducao(daProducao({ producaoId: 'b', nome: 'Appmax', local: 'A13' })),
    normalizarDaProducao(daProducao({ producaoId: 'c', fairName: 'Outra', nome: 'Wake' })),
  ]
  const feiras = feirasDaProducao(clientes)
  assert.equal(feiras.length, 2)
  assert.equal(feiras.find((f) => f.nome === 'Conferencia Luxo - ECBR').total, 2)
  assert.equal(feiras.find((f) => f.nome === 'Outra').total, 1)
})

test('o e-mail é a única pendência que bloqueia — peça não é', () => {
  const c = normalizarDaProducao(daProducao())
  assert.deepEqual(pendenciasDe(c, 'contato@cliente.com'), [])
  assert.deepEqual(pendenciasDe(c, ''), ['e-mail'])
  assert.deepEqual(pendenciasDe(c, 'não é e-mail'), ['e-mail'])
  // As peças não entram: elas são o trabalho do analista DEPOIS de importar.
  assert.equal(pendenciasDe(c, 'x@y.com').includes('peças'), false)
})

test('o elo com a produção sobrevive à gravação', () => {
  // `normalizarProjeto` é uma lista BRANCA: campo que não está nela é
  // descartado em silêncio na hora de gravar. Sem este teste, a importação
  // gravaria projetos sem `producaoId` e nada na tela denunciaria — o app
  // simplesmente nunca encontraria a prova nem o status.
  const p = projetoNovo({
    feira: 'Conferencia Luxo - ECBR',
    expositor: 'After Click',
    stand: 'A12',
    email: 'contato@cliente.com',
    producaoId: 'conferencialuxo_12',
    producaoFeira: 'Conferencia Luxo - ECBR',
  })
  assert.equal(p.producaoId, 'conferencialuxo_12')

  const gravado = normalizarProjeto(p)
  assert.equal(gravado.producaoId, 'conferencialuxo_12', 'o elo não pode se perder na gravação')
  assert.equal(gravado.producaoFeira, 'Conferencia Luxo - ECBR')
})

test('projeto sem elo com a produção continua válido', () => {
  const gravado = normalizarProjeto(projetoNovo({ feira: 'F', expositor: 'E', stand: 'S' }))
  assert.equal(gravado.producaoId, '', 'cadastro manual não ganha id de mentira')
})
