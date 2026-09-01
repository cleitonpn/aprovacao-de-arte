import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHAVE_DO_TEMA, TEMAS, ROTULO_TEMA, temaGuardado, guardarTema, aplicarTema, proximoTema,
} from '../src/store/tema.js'

// localStorage de mentira, como em visto.test.mjs.
const memoria = new Map()
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
}

/** documentElement de mentira: só o que `aplicarTema` toca. */
function raizFalsa() {
  const attrs = new Map()
  return {
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    get: (k) => (attrs.has(k) ? attrs.get(k) : null),
  }
}

test('sem escolha guardada, quem manda é o sistema', () => {
  memoria.clear()
  assert.equal(temaGuardado(), 'sistema')

  // E "sistema" é a AUSÊNCIA do atributo, não um valor próprio: é assim que o
  // `color-scheme: light dark` do :root continua valendo.
  const raiz = raizFalsa()
  raiz.setAttribute('data-tema', 'escuro')
  aplicarTema('sistema', raiz)
  assert.equal(raiz.get('data-tema'), null)
})

test('a escolha sobrevive à recarga', () => {
  memoria.clear()
  guardarTema('escuro')
  assert.equal(temaGuardado(), 'escuro')
  guardarTema('claro')
  assert.equal(temaGuardado(), 'claro')
})

test('valor estranho no localStorage não pinta a tela de nada', () => {
  // Alguém editando o armazenamento à mão, ou uma versão futura gravando outro
  // nome: cair no sistema é o único padrão que não deixa a tela ilegível.
  memoria.clear()
  memoria.set(CHAVE_DO_TEMA, 'roxo')
  assert.equal(temaGuardado(), 'sistema')
  assert.equal(guardarTema('roxo'), 'sistema')
})

test('sem onde gravar, a troca ainda acontece nesta aba', () => {
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => { throw new Error('aba anônima') },
    setItem: () => { throw new Error('aba anônima') },
  }
  assert.equal(temaGuardado(), 'sistema')
  assert.doesNotThrow(() => guardarTema('escuro'), 'trocar o tema não pode quebrar a tela')
  globalThis.localStorage = real
})

test('o ciclo passa pelos três estados e volta', () => {
  let t = 'sistema'
  const visitados = []
  for (let i = 0; i < TEMAS.length; i++) {
    t = proximoTema(t)
    visitados.push(t)
  }
  assert.deepEqual(visitados, ['claro', 'escuro', 'sistema'])
  // Nenhum estado sem rótulo: o botão escreve o nome, e `undefined` no alto da
  // tela é pior que não ter botão.
  for (const tema of TEMAS) {
    assert.ok(ROTULO_TEMA[tema]?.curto, `sem rótulo para ${tema}`)
    assert.ok(ROTULO_TEMA[tema]?.icone, `sem ícone para ${tema}`)
  }
})

test('o index.html usa a MESMA chave do módulo', () => {
  // A chave está repetida porque tem de estar: o tema precisa ser aplicado
  // antes do primeiro pixel, e ali o módulo ainda não carregou. O que não pode
  // é derivar — se derivar, a escolha da pessoa é lida como inexistente e a
  // tela pisca branca a cada carregamento, sem erro nenhum no console.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.ok(html.includes(`'${CHAVE_DO_TEMA}'`), `o index.html não cita ${CHAVE_DO_TEMA}`)
  assert.ok(html.includes("setAttribute('data-tema'"), 'o index.html precisa aplicar o atributo')
})

test('o CSS define os dois temas para toda cor, sem esquecer nenhuma', () => {
  // O motivo de as cores estarem em `light-dark()` numa linha só. Um token com
  // valor fixo passaria despercebido até alguém abrir no escuro e achar um
  // retângulo branco no meio da tela.
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  const raiz = css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing'))
  const cores = [...raiz.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3,8});/gi)].map((m) => m[1])
  for (const token of new Set(cores)) {
    assert.match(
      raiz,
      new RegExp(`${token}:\\s*light-dark\\(`),
      `${token} tem valor só do tema claro`,
    )
  }
  assert.ok(cores.length >= 10, `esperava dezenas de cores, achei ${cores.length}`)
})
