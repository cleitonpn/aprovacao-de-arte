import test from 'node:test'
import assert from 'node:assert/strict'
import {
  projetoNovo, pecaNova, validarProjeto, normalizarProjeto, cadastroDoProjeto,
  tokenNovo, chave, listaDeEmails, MAXIMO_PECAS,
} from '../src/data/projeto.js'
import { avaliar } from '../src/core/regras.js'
import { PERFIS_PADRAO } from '../src/data/perfis.js'

const projetoBom = () => projetoNovo({
  feira: 'Expo Sul 2026',
  expositor: 'Buddy Nutrition',
  email: 'ana@buddy.com.br',
  stand: 'Buddy',
  localizacao: 'Rua 3',
  pecas: [pecaNova({ rotulo: 'Lona de fundo', perfilId: 'lona-parede', larguraCm: 275, alturaCm: 275 })],
})

test('o token do link é aleatório e não se repete', () => {
  const tokens = new Set(Array.from({ length: 500 }, () => tokenNovo()))
  assert.equal(tokens.size, 500)
  for (const t of tokens) assert.match(t, /^[a-z2-9]{12}$/)
})

test('projeto sem peça, sem e-mail ou sem stand não é válido', () => {
  assert.equal(validarProjeto(projetoBom()).valido, true)

  assert.match(validarProjeto({ ...projetoBom(), pecas: [] }).erros.pecas, /pelo menos uma peça/)
  assert.ok(validarProjeto({ ...projetoBom(), email: 'sem-arroba' }).erros.email)
  assert.ok(validarProjeto({ ...projetoBom(), stand: '' }).erros.stand)

  const semMedida = { ...projetoBom(), pecas: [pecaNova({ rotulo: 'Lona', larguraCm: 0, alturaCm: 100 })] }
  assert.equal(validarProjeto(semMedida).erros.porPeca[0], 'Largura e altura em cm')
})

test('o limite de peças por projeto é aplicado', () => {
  const muitas = { ...projetoBom(), pecas: Array.from({ length: MAXIMO_PECAS + 1 }, () => pecaNova({ rotulo: 'X', larguraCm: 10, alturaCm: 10 })) }
  assert.match(validarProjeto(muitas).erros.pecas, /Máximo/)
})

test('normalizar limpa espaços, baixa o e-mail e arredonda as medidas', () => {
  const limpo = normalizarProjeto({
    ...projetoBom(),
    email: '  ANA@Buddy.com.BR ',
    stand: '  Buddy  ',
    pecas: [pecaNova({ rotulo: ' Lona ', larguraCm: 275.456, alturaCm: 275, escalaFator: 0 })],
  })
  assert.equal(limpo.email, 'ana@buddy.com.br')
  assert.equal(limpo.stand, 'Buddy')
  assert.equal(limpo.pecas[0].rotulo, 'Lona')
  assert.equal(limpo.pecas[0].larguraCm, 275.46)
  assert.equal(limpo.pecas[0].escalaFator, 1, 'escala inválida cai para 1:1, nunca para 0')
})

test('normalizar não deixa passar campo indefinido para o Firestore', () => {
  const limpo = normalizarProjeto({ token: 'abc123abc123', pecas: [{ rotulo: 'Lona', larguraCm: 10, alturaCm: 10 }] })
  for (const [k, v] of Object.entries(limpo)) assert.notEqual(v, undefined, `campo ${k} indefinido`)
  for (const [k, v] of Object.entries(limpo.pecas[0])) assert.notEqual(v, undefined, `peça.${k} indefinido`)
})

test('o cadastro gravado no envio sai do projeto, não do cliente', () => {
  assert.deepEqual(cadastroDoProjeto(projetoBom()), {
    nome: 'Buddy Nutrition',
    email: 'ana@buddy.com.br',
    emails: ['ana@buddy.com.br'],
    feira: 'Expo Sul 2026',
    stand: 'Buddy',
    localizacao: 'Rua 3',
  })
})

// Decisão de arte raramente cai numa pessoa só: tem o marketing, tem a
// agência, tem quem assina. Cobrar um endereço só é quase o mesmo que não
// cobrar — alguém responde "não sou eu que vejo isso".
test('o cliente pode ter vários e-mails, e o primeiro continua sendo o principal', () => {
  const p = normalizarProjeto({
    ...projetoBom(),
    emails: ['ANA@buddy.com.br', 'jo@agencia.com', 'ana@buddy.com.br', 'invalido'],
  })
  assert.deepEqual(p.emails, ['ana@buddy.com.br', 'jo@agencia.com'],
    'baixa a caixa, tira duplicado e descarta o que não é e-mail')
  assert.equal(p.email, 'ana@buddy.com.br', 'o primeiro é o que as regras validam')
})

test('lista de e-mails aceita o formato que vem da planilha', () => {
  assert.deepEqual(listaDeEmails('ana@buddy.com; jo@agencia.com'), ['ana@buddy.com', 'jo@agencia.com'])
  assert.deepEqual(listaDeEmails('ana@buddy.com, jo@agencia.com'), ['ana@buddy.com', 'jo@agencia.com'])
  assert.deepEqual(listaDeEmails('so-um@buddy.com'), ['so-um@buddy.com'])
  assert.deepEqual(listaDeEmails(''), [])
})

test('chave() compara textos ignorando acento, caixa e pontuação', () => {
  assert.equal(chave('Buddy Nutrição'), chave('BUDDY  nutricao'))
  assert.equal(chave('Rua 3, Pav. A'), 'rua 3 pav a')
})

// O ponto do cadastro é este: com a medida vinda do projeto, a mesma arte que
// passaria por um erro de digitação do cliente é reprovada como deve ser.
test('a medida do projeto é a que vale na análise', () => {
  const perfil = PERFIS_PADRAO.find((p) => p.id === 'lona-parede')
  const medidas = { formato: 'jpeg', formatoSuportado: true, larguraPx: 4000, alturaPx: 4000 }

  const pecaCadastrada = { larguraCm: 275, alturaCm: 275 }
  const pecaDigitadaErrada = { larguraCm: 60, alturaCm: 60 }

  assert.equal(avaliar({ peca: pecaCadastrada, perfil, medidas }).veredicto, 'reprovado')
  assert.equal(avaliar({ peca: pecaDigitadaErrada, perfil, medidas }).veredicto, 'aprovado')
})
