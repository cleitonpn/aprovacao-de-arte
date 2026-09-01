import test from 'node:test'
import assert from 'node:assert/strict'
import { agruparAchados, chamadaDoVeredicto, TENTAR_DE_NOVO_E_LIVRE } from '../src/core/laudo.js'
import { avaliar } from '../src/core/regras.js'
import { PERFIS_PADRAO } from '../src/data/perfis.js'

// A tela do cliente, medida pelo que ela falhou em fazer numa feira real.
//
// O relato foi este, literal: "ele não entendeu o resultado, não soube o que
// fazer depois da recusa". Quem usou a ferramenta foi o cliente leigo, não a
// agência dele — e a tela terminava numa lista de oito itens, um botão de
// enviar desligado e três botões cinza iguais.
//
// Estes testes travam as duas coisas que mudaram: quantos problemas a pessoa
// conta ao olhar, e o que a primeira frase manda fazer.

const perfil = (id) => PERFIS_PADRAO.find((p) => p.id === id)

/** Uma reprovação de verdade: arte muito abaixo do piso, numa parede. */
function laudoReprovado() {
  const peca = { id: 'p', larguraCm: 100, alturaCm: 265 }
  return avaliar({
    peca,
    perfil: perfil('lona-parede'),
    medidas: {
      formato: 'jpg',
      formatoSuportado: true,
      larguraPx: 400,
      alturaPx: 1060,
      temAlfa: true,
      cmyk: false,
      temICC: false,
    },
    escalaFator: 1,
    politica: {},
    detectorNitidez: false,
  })
}

test('o que impede a impressão fica sozinho, separado do resto', () => {
  const laudo = laudoReprovado()
  const g = agruparAchados(laudo.achados)

  assert.equal(laudo.veredicto, 'reprovado')
  // O ponto inteiro da mudança: a arte tem UM impedimento, no meio de vários
  // achados. Antes eles vinham numa lista só, do mesmo tamanho.
  assert.ok(laudo.achados.length > g.impedem.length, 'o caso precisa ter achados além do bloqueio')
  assert.ok(g.impedem.length >= 1)
  assert.ok(g.impedem.every((a) => a.nivel === 'bloqueante'))
  assert.ok(g.conferir.every((a) => a.nivel === 'ressalva' || a.nivel === 'info'))
  assert.ok(g.certos.every((a) => a.nivel === 'ok'))

  // Nenhum achado se perde no caminho, e nenhum aparece duas vezes.
  const total = g.impedem.length + g.conferir.length + g.certos.length
  assert.equal(total, laudo.achados.length)
  const ids = [...g.impedem, ...g.conferir, ...g.certos].map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('dentro de cada grupo, o mais grave vem primeiro', () => {
  const { conferir } = agruparAchados([
    { id: 'a', nivel: 'info' },
    { id: 'b', nivel: 'ressalva' },
    { id: 'c', nivel: 'info' },
  ])
  assert.deepEqual(conferir.map((a) => a.id), ['b', 'a', 'c'])
})

test('a lista original não é modificada', () => {
  // `agruparAchados` roda a cada render. Se ordenasse no lugar, mexeria no
  // resultado da análise que outras telas — e o laudo em JSON — leem depois.
  const achados = [{ id: 'a', nivel: 'info' }, { id: 'b', nivel: 'ressalva' }]
  agruparAchados(achados)
  assert.deepEqual(achados.map((a) => a.id), ['a', 'b'])
})

test('a primeira frase manda fazer algo, em vez de dar uma nota', () => {
  const reprovado = chamadaDoVeredicto('reprovado', 1)
  // "Arte reprovada" continua existindo como etiqueta; o título, não.
  assert.ok(!/reprovad/i.test(reprovado.titulo), `o título ainda julga: ${reprovado.titulo}`)
  assert.match(reprovado.texto, /1 coisa precisa mudar/)

  const tres = chamadaDoVeredicto('reprovado', 3)
  assert.match(tres.texto, /3 coisas precisam mudar/)

  // Sem contagem confiável, o texto não pode dizer "0 coisas precisam mudar"
  // numa tela que acabou de reprovar a arte.
  assert.match(chamadaDoVeredicto('reprovado', 0).texto, /1 coisa precisa mudar/)
})

test('ressalva é apresentada como decisão do cliente, não como defeito', () => {
  const r = chamadaDoVeredicto('ressalva')
  assert.match(r.texto, /decida|você/i)
  assert.match(r.texto, /impede a impressão/)
})

test('aprovado diz qual é o próximo clique', () => {
  const a = chamadaDoVeredicto('aprovado')
  assert.match(a.texto, /enviar/i)
})

test('a tela promete que tentar de novo não custa nada', () => {
  // O cliente das dez tentativas achava que cada clique mandava arte ruim
  // para o time. Não mandava — arte reprovada nunca sobe. Ele parou de tentar
  // por medo de atrapalhar, que é o oposto do que a tela deveria provocar.
  assert.match(TENTAR_DE_NOVO_E_LIVRE, /nada é enviado/i)
  assert.match(TENTAR_DE_NOVO_E_LIVRE, /nada disso conta como entrega/i)
})

test('arte aprovada não tem grupo de impedimentos', () => {
  const laudo = avaliar({
    peca: { id: 'p', larguraCm: 100, alturaCm: 265 },
    perfil: perfil('lona-parede'),
    medidas: {
      formato: 'pdf',
      formatoSuportado: true,
      larguraPx: Math.round((200 * 100) / 2.54),
      alturaPx: Math.round((200 * 265) / 2.54),
    },
    escalaFator: 1,
    politica: {},
    detectorNitidez: false,
  })
  assert.equal(laudo.veredicto, 'aprovado')
  assert.equal(agruparAchados(laudo.achados).impedem.length, 0)
})
