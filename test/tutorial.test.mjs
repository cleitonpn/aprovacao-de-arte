import test from 'node:test'
import assert from 'node:assert/strict'
import { CONFERENCIA_DO_TIME, PASSOS, REQUISITOS, SUPORTE } from '../src/core/tutorial.js'
import { DPI_MINIMO_GLOBAL, SANGRIA_MINIMA_MM } from '../src/core/regras.js'

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
  // não escritos à mão. Se alguém mudar um número e esquecer do texto, o
  // cliente passa a ler uma instrução que a ferramenta não cumpre — foi o que
  // aconteceu quando o piso caiu de 150 para 100.
  const resolucao = REQUISITOS.find((r) => r.titulo === 'Resolução')
  assert.ok(resolucao.texto.includes(String(DPI_MINIMO_GLOBAL)), 'o padrão de ouro precisa aparecer')

  const sangria = REQUISITOS.find((r) => r.titulo === 'Sangria')
  assert.ok(sangria.texto.includes(String(SANGRIA_MINIMA_MM / 10)), 'a sangria em cm precisa aparecer')
})

test('o tutorial não promete um piso de dpi único, porque não existe mais', () => {
  // A versão anterior deste teste exigia o literal `DPI_PISO_ABSOLUTO` no
  // texto, e estava certa enquanto o piso era um número só. Desde que ele
  // passa a sair da distância da peça (`pisoPorDistancia`), citar 100 dpi faz
  // o cliente achar que uma parede de 82 dpi reprova — e ela passa. Um texto
  // que reprova o que a ferramenta aprova produz a mesma desconfiança que uma
  // ferramenta que reprova o que o time aprova.
  const resolucao = REQUISITOS.find((r) => r.titulo === 'Resolução')
  assert.match(resolucao.texto, /distância/i, 'precisa dizer de onde sai o mínimo')
  assert.ok(
    /cada peça|daquela peça|cartão de cada peça/i.test(resolucao.texto),
    'precisa mandar o cliente ler o mínimo da peça dele',
  )
})

test('o tutorial não manda o cliente fazer o que a ferramenta já faz', () => {
  // Custou dez reprovações seguidas a um expositor cuja arte estava correta,
  // em 1:10: o texto mandava informar a escala, o campo estava escondido na
  // tela de envio, e ele nunca soube que existia. A detecção automática já
  // resolve; o texto tinha ficado para trás.
  const escala = REQUISITOS.find((r) => r.titulo === 'Escala')
  assert.match(escala.texto, /reconhece a escala sozinha/i)
  assert.ok(
    !/só informe a escala|informe a escala na hora/i.test(escala.texto),
    'o texto não pode voltar a cobrar do cliente o que a análise detecta',
  )
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

// A fronteira da segunda análise é promessa contratual, não texto decorativo:
// o cliente que entende "o time confere a arte" como "o time revisa a arte"
// manda o material sem reler, e o telefone errado sai impresso em 40 stands.
// Estes testes travam os dois lados da lista para ninguém apagar o incômodo.

test('a segunda análise diz o que confere e o que não confere', () => {
  assert.ok(CONFERENCIA_DO_TIME.confere.length >= 3, 'precisa listar o que é conferido')
  assert.ok(CONFERENCIA_DO_TIME.naoConfere.length >= 3, 'precisa listar o que NÃO é conferido')
  for (const t of [...CONFERENCIA_DO_TIME.confere, ...CONFERENCIA_DO_TIME.naoConfere]) {
    assert.ok(t.length > 15, `item vago demais: ${t}`)
  }
})

test('os itens de responsabilidade do cliente estão nomeados', () => {
  const fora = CONFERENCIA_DO_TIME.naoConfere.join(' ').toLowerCase()
  for (const termo of ['ortografia', 'telefone', 'preços']) {
    assert.ok(fora.includes(termo), `o cliente precisa ler "${termo}" na lista do que não é conferido`)
  }
})

// O passo do tutorial não pode prometer uma conferência que o time não faz --
// foi o defeito da primeira versão deste texto, que citava "telefone
// desatualizado" como algo que a comunicação visual pegaria.
test('o passo da segunda análise não promete revisão de conteúdo', () => {
  const passo = PASSOS.find((p) => p.titulo.includes('palavra final'))
  assert.ok(passo, 'o passo da segunda camada precisa existir')
  const texto = passo.texto.toLowerCase()
  assert.ok(texto.includes('técnica'), 'precisa dizer que a segunda análise é técnica')
  for (const proibido of ['telefone', 'ortografia', 'revisão de texto']) {
    assert.ok(!texto.includes(proibido), `o passo não pode prometer conferir ${proibido}`)
  }
})
