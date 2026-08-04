import test from 'node:test'
import assert from 'node:assert/strict'

// Espelho em JavaScript da regra `allow create` de `envios` (firestore.rules).
//
// Por que isto existe: quando o documento que o navegador monta e a regra que o
// servidor aplica saem de sincronia, o Firestore recusa a gravação e o cliente
// vê "envio recusado" — ou, pior, o arquivo sobe para o Storage e o registro
// não entra, e aí o arquivo existe sem aparecer em tela nenhuma. Já aconteceu
// duas vezes neste projeto. As regras de verdade não rodam fora do Firebase,
// então o espelho é o que dá para testar em cada commit.
//
// Ao mexer em `firestore.rules`, mexa aqui junto. Se os dois divergirem, este
// arquivo deixa de valer alguma coisa.

const GB = 1024 * 1024 * 1024
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/

const textoValido = (v, max) => typeof v === 'string' && v.length > 1 && v.length <= max
const emailValido = (v) => typeof v === 'string' && EMAIL.test(v)

const cadastroValido = (c) => Boolean(c)
  && ['nome', 'email', 'feira', 'stand'].every((k) => k in c)
  && textoValido(c.nome, 120)
  && textoValido(c.email, 160)
  && emailValido(c.email)
  && textoValido(c.feira, 160)
  && textoValido(c.stand, 160)

const veredictoPermiteEnvio = (d) => d.veredicto === 'aprovado'
  || (d.veredicto === 'ressalva' && d.riscoAceito != null)

const envioDeApoioValido = (d, projetosExistentes) => d.tipoEnvio === 'avulso'
  && typeof d.projetoId === 'string'
  && projetosExistentes.has(d.projetoId)

function podeCriar(protocolo, d, { autenticado = true, projetos = new Set() } = {}) {
  return autenticado
    && d.protocolo === protocolo
    && cadastroValido(d.cadastro)
    && d.status === 'concluido'
    && typeof d.arquivo?.tamanho === 'number'
    && d.arquivo.tamanho > 0
    && d.arquivo.tamanho < GB
    && (envioDeApoioValido(d, projetos) || veredictoPermiteEnvio(d))
}

const CADASTRO = {
  nome: 'Buddy Nutrition',
  email: 'ana@buddy.com.br',
  feira: 'Expo Sul 2026',
  stand: 'Buddy',
  localizacao: 'Rua 3',
}

const PROJETOS = new Set(['abc123abc123'])

// Espelha o documento montado por `enviarAvulso` em services/envio.js.
const registroDeApoio = (extra = {}) => ({
  protocolo: 'AP-260810-X1Y2Z',
  status: 'concluido',
  tipoEnvio: 'avulso',
  feiraId: 'expo-sul-2026',
  feira: 'Expo Sul 2026',
  projetoId: 'abc123abc123',
  pecaId: null,
  pecaRotulo: 'Logo vetorial da marca',
  cadastro: CADASTRO,
  arquivo: { nome: 'logo.svg', tamanho: 48_000, tipo: 'image/svg+xml', sha256: null },
  caminho: 'avulsos/expo-sul-2026/Buddy__apoio__AP-260810-X1Y2Z.svg',
  link: 'https://exemplo/logo.svg',
  ...extra,
})

// Espelha o documento montado por `enviarArte`.
const registroDeArte = (extra = {}) => ({
  protocolo: 'AP-260810-A1B2C',
  status: 'concluido',
  tipoEnvio: 'arte',
  feiraId: 'expo-sul-2026',
  feira: 'Expo Sul 2026',
  projetoId: 'abc123abc123',
  pecaId: 'p_lona',
  pecaRotulo: 'Lona de fundo',
  versao: 1,
  cadastro: CADASTRO,
  peca: { larguraCm: 275, alturaCm: 275 },
  perfil: { id: 'lona-parede', nome: 'Lona de parede / backdrop' },
  veredicto: 'aprovado',
  riscoAceito: null,
  arquivo: { nome: 'lona.pdf', tamanho: 12_000_000, tipo: 'application/pdf', sha256: 'abc' },
  caminho: 'envios/expo-sul-2026/…',
  link: 'https://exemplo/lona.pdf',
  ...extra,
})

const criar = (d, opcoes) => podeCriar(d.protocolo, d, { projetos: PROJETOS, ...opcoes })

// O caso do bug: o logo subia e não aparecia em lugar nenhum para o analista.
// O registro de apoio não tem veredicto — se a regra dependesse dele, a
// gravação seria recusada e o arquivo ficaria órfão no armazenamento.
test('o arquivo de apoio é aceito mesmo sem veredicto', () => {
  const doc = registroDeApoio()
  assert.equal('veredicto' in doc, false, 'apoio não tem veredicto, e é assim mesmo')
  assert.equal(criar(doc), true)
})

test('o apoio precisa apontar para um projeto que existe', () => {
  assert.equal(criar(registroDeApoio({ projetoId: null })), false)
  assert.equal(criar(registroDeApoio({ projetoId: 'token-que-nao-existe' })), false)
})

test('nada de arte se disfarçar de apoio para escapar do veredicto', () => {
  // Se `tipoEnvio` fosse aceito sem mais nada, bastaria mandar 'avulso' num
  // envio de arte reprovada para contornar a trava do negócio.
  const disfarcada = registroDeArte({ tipoEnvio: 'avulso', veredicto: 'reprovado' })
  assert.equal(criar(disfarcada, { projetos: new Set() }), false)
})

test('arte aprovada entra; reprovada não; com ressalva só com o risco aceito', () => {
  assert.equal(criar(registroDeArte()), true)
  assert.equal(criar(registroDeArte({ veredicto: 'reprovado' })), false)
  assert.equal(criar(registroDeArte({ veredicto: 'ressalva' })), false)
  assert.equal(criar(registroDeArte({ veredicto: 'ressalva', riscoAceito: { em: 'agora' } })), true)
})

test('o cadastro do projeto passa na validação de cadastro do envio', () => {
  // O cadastro do envio por projeto é montado por `cadastroDoProjeto`. Se um
  // campo mudar de nome lá, o envio inteiro passa a ser recusado aqui.
  assert.equal(cadastroValido(CADASTRO), true)
  assert.equal(criar(registroDeApoio({ cadastro: { ...CADASTRO, email: 'sem-arroba' } })), false)
  assert.equal(criar(registroDeApoio({ cadastro: { nome: 'X', email: 'a@b.com', feira: 'F' } })), false)
})

test('arquivo vazio, gigante ou sem tamanho é recusado nos dois tipos', () => {
  for (const montar of [registroDeApoio, registroDeArte]) {
    assert.equal(criar(montar({ arquivo: { nome: 'x', tamanho: 0 } })), false)
    assert.equal(criar(montar({ arquivo: { nome: 'x', tamanho: GB } })), false)
    assert.equal(criar(montar({ arquivo: { nome: 'x' } })), false)
  }
})

test('o protocolo do documento tem que bater com o ID', () => {
  const doc = registroDeApoio()
  assert.equal(podeCriar('OUTRO-ID', doc, { projetos: PROJETOS }), false)
})

test('sessão não autenticada não grava nada', () => {
  assert.equal(criar(registroDeArte(), { autenticado: false }), false)
})
