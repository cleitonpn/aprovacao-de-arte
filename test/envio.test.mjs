import test from 'node:test'
import assert from 'node:assert/strict'
import { validar, normalizar, paraNomeArquivo, CADASTRO_VAZIO } from '../src/data/cadastro.js'
import { protocoloNovo, idDeFeira } from '../src/services/envio.js'

// A regra de negócio do envio, isolada da interface. Ela está duplicada de
// propósito em firestore.rules: a interface impede o clique, e a regra do
// Firestore impede quem chamar a API direto — interface se contorna, regra
// do servidor não.
function podeEnviar(veredicto, riscoAceito) {
  if (veredicto === 'aprovado') return true
  if (veredicto === 'ressalva') return Boolean(riscoAceito)
  return false
}

const completo = {
  nome: 'Ana Ribeiro',
  email: 'ana@expositor.com.br',
  feira: 'Fórum E-commerce Brasil 2026',
  stand: 'Acme Tecnologia',
  localizacao: 'Rua B, 42',
}

test('cadastro exige nome, e-mail, feira e stand', () => {
  assert.equal(validar(CADASTRO_VAZIO).valido, false)
  for (const campo of ['nome', 'email', 'feira', 'stand']) {
    const { valido, erros } = validar({ ...completo, [campo]: '' })
    assert.equal(valido, false, `${campo} deveria ser obrigatório`)
    assert.ok(erros[campo])
  }
})

test('localização é opcional', () => {
  assert.equal(validar({ ...completo, localizacao: '' }).valido, true)
})

test('e-mail malformado é recusado, e-mail incomum é aceito', () => {
  for (const ruim of ['ana', 'ana@', '@dominio.com', 'ana@dominio', 'a b@c.com']) {
    assert.equal(validar({ ...completo, email: ruim }).valido, false, ruim)
  }
  // domínios longos e subdomínios são legítimos — não podemos barrar o cliente
  for (const bom of ['ana@feira.com.br', 'a.b+tag@sub.dominio.expo', 'ANA@EMPRESA.COM']) {
    assert.equal(validar({ ...completo, email: bom }).valido, true, bom)
  }
})

test('normalização apara espaços e minúsculas o e-mail', () => {
  const n = normalizar({ ...completo, nome: '  Ana Ribeiro ', email: '  ANA@Expositor.COM.br ' })
  assert.equal(n.nome, 'Ana Ribeiro')
  assert.equal(n.email, 'ana@expositor.com.br')
})

test('nome de arquivo sai seguro para o Drive', () => {
  assert.equal(paraNomeArquivo('Acme Tecnologia & Cia / 2026'), 'Acme-Tecnologia-Cia-2026')
  assert.equal(paraNomeArquivo(''), 'sem-nome')
  assert.ok(paraNomeArquivo('x'.repeat(200)).length <= 40)
})

test('só sobe arte aprovada, ou com ressalva e risco aceito', () => {
  assert.equal(podeEnviar('aprovado', null), true)
  assert.equal(podeEnviar('aprovado', { em: 'agora' }), true)

  // o caso que impede o armazenamento de virar depósito de arte ruim
  assert.equal(podeEnviar('ressalva', null), false)
  assert.equal(podeEnviar('ressalva', { em: 'agora' }), true)

  assert.equal(podeEnviar('reprovado', null), false)
  assert.equal(podeEnviar('reprovado', { em: 'agora' }), false, 'reprovada não sobe nem com aceite')
})

test('protocolo é único e legível', () => {
  const p = protocoloNovo()
  assert.match(p, /^AP-\d{6}-[A-Z0-9]{5}$/)
  // 500 seguidos sem colisão: o protocolo vira o ID do documento no Firestore
  // e, como as regras só permitem CRIAR, uma colisão seria um envio recusado
  // na cara do cliente
  const vistos = new Set()
  for (let i = 0; i < 500; i++) vistos.add(protocoloNovo())
  assert.equal(vistos.size, 500)
})

test('id da feira agrupa variações de escrita da mesma feira', () => {
  const esperado = 'forum-e-commerce-brasil-2026'
  for (const escrito of [
    'Fórum E-commerce Brasil 2026',
    'FÓRUM E-COMMERCE BRASIL 2026',
    '  Forum E-commerce Brasil 2026  ',
  ]) {
    assert.equal(idDeFeira(escrito), esperado, escrito)
  }
  // feiras diferentes não podem colidir
  assert.notEqual(idDeFeira('Feira A'), idDeFeira('Feira B'))
})
