import test from 'node:test'
import assert from 'node:assert/strict'
import { laudoJson, semIndefinidos } from '../src/core/mensagem.js'
import { avaliar } from '../src/core/regras.js'
import { PERFIS_PADRAO } from '../src/data/perfis.js'

// O Firestore recusa o documento INTEIRO se encontrar um único campo com
// valor `undefined`, e a mensagem de erro só diz em qual documento — não em
// qual campo. Como o laudo cresce junto com as regras de análise, estes
// testes existem para que um campo novo não derrube o envio de um cliente.

function caminhosIndefinidos(valor, caminho = '') {
  if (valor === undefined) return [caminho || '(raiz)']
  if (valor === null || typeof valor !== 'object') return []
  if (Array.isArray(valor)) {
    return valor.flatMap((v, i) => caminhosIndefinidos(v, `${caminho}[${i}]`))
  }
  return Object.entries(valor).flatMap(([k, v]) => caminhosIndefinidos(v, caminho ? `${caminho}.${k}` : k))
}

function resultadoDe(medidas, perfilId = 'lona-parede', peca = { larguraCm: 275, alturaCm: 275 }) {
  const perfil = PERFIS_PADRAO.find((p) => p.id === perfilId)
  const base = {
    arquivo: { nome: 'arte.pdf', tamanho: 1153433, hash: 'abc123' },
    analisadoEm: new Date().toISOString(),
    ...medidas,
  }
  return { ...avaliar({ peca, perfil, medidas: base }), peca, perfil, medidas: base, escalaFator: 1, politica: {} }
}

test('o laudo nunca leva campos indefinidos, em nenhum tipo de arte', () => {
  const cenarios = {
    // Este é o caso que derrubou o primeiro envio real: o achado de arquivo
    // vetorial tem detalhe mas NÃO tem ação.
    'PDF vetorial com transparência': {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
      temTransparencia: true, tamanhoDeclaradoCm: { largura: 320, altura: 320 },
    },
    'JPG reprovado por resolução': {
      formato: 'jpeg', formatoSuportado: true, larguraPx: 900, alturaPx: 900,
      temICC: true, qualidadeJpeg: 92,
    },
    'formato ilegível': { formato: 'cdr', formatoRotulo: 'CorelDRAW (.cdr)', formatoSuportado: false },
    'PDF com fonte faltando': {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 2,
      temTexto: true, fontesFaltando: ['Helvetica'],
      tamanhoDeclaradoCm: { largura: 275, altura: 275 },
    },
    'arte aprovada sem nenhuma ressalva': {
      formato: 'jpeg', formatoSuportado: true, larguraPx: 20000, alturaPx: 20000,
      temICC: true, qualidadeJpeg: 95, cmyk: true,
    },
  }

  for (const [nome, medidas] of Object.entries(cenarios)) {
    const laudo = laudoJson(resultadoDe(medidas))
    const problemas = caminhosIndefinidos(laudo)
    assert.deepEqual(problemas, [], `${nome}: campos indefinidos em ${problemas.join(', ')}`)
  }
})

test('semIndefinidos troca undefined por null, inclusive dentro de listas', () => {
  const limpo = semIndefinidos({
    a: undefined,
    b: { c: undefined, d: 1 },
    e: [1, undefined, { f: undefined }],
    g: null,
    h: 'texto',
  })
  assert.deepEqual(limpo, {
    a: null,
    b: { c: null, d: 1 },
    e: [1, null, { f: null }],
    g: null,
    h: 'texto',
  })
})

test('semIndefinidos NÃO reconstrói objetos que não sejam simples', () => {
  // serverTimestamp() devolve um objeto sentinela do Firestore. Copiá-lo
  // campo a campo o transformaria num objeto comum, e o carimbo de data do
  // servidor viraria lixo silenciosamente.
  class Sentinela { constructor() { this._metodo = 'serverTimestamp' } }
  const sentinela = new Sentinela()
  const data = new Date('2026-08-03T19:32:00Z')

  const limpo = semIndefinidos({ criadoEm: sentinela, quando: data, x: undefined })
  assert.equal(limpo.criadoEm, sentinela, 'o sentinela precisa sair intacto, não copiado')
  assert.equal(limpo.quando, data)
  assert.equal(limpo.x, null)
})
