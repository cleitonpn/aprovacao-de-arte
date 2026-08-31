import test from 'node:test'
import assert from 'node:assert/strict'
import { bordaPorRegiao } from '../src/core/metricas.js'


// ------------------------------------------------ a borda região a região
//
// A mediana da peça inteira responde "esta arte é mole?" e é CEGA para "esta
// arte tem uma parte mole" — que é a pergunta que a operação faz. Um logo
// ampliado dentro de uma arte boa ocupa 1% da área e não move mediana nenhuma.
//
// Medido na parede da CRM Bonus (120 × 320 cm, lida direto do PDF e amostrada a
// 104 dpi): mediana das regiões 1,00 px e a pior 2,06 px — a 55 cm da esquerda,
// 258 cm do topo. Pelo limiar absoluto de 1,2 mm nada aparecia; pela RAZÃO,
// aparece.

// Listras verticais com uma transição de largura conhecida. Uma borda só não
// serve de modelo: numa arte real toda região tem detalhe, e é a LARGURA da
// transição — não a existência dela — que separa nítido de amaciado.
const listras = (w, h, larguraDaBorda, periodo = 80) => {
  const g = new Float32Array(w * h)
  const lb = larguraDaBorda
  for (let x = 0; x < w; x++) {
    // Sobe e desce com a MESMA largura. A primeira versão deste fixture só
    // fazia a subida, e a volta ao começo do período criava um degrau de 1
    // pixel — a métrica media aquele degrau artificial e devolvia 1 para
    // qualquer borrão. O fixture é que estava errado, não ela.
    const d = x % periodo
    const meio = periodo / 2
    const t = d < meio
      ? Math.max(0, Math.min(1, (d - meio / 2 + lb / 2) / lb))
      : 1 - Math.max(0, Math.min(1, (d - meio - meio / 2 + lb / 2) / lb))
    const valor = 20 + t * 215
    for (let y = 0; y < h; y++) g[y * w + x] = valor
  }
  return g
}

test('a região mole aparece na razão, não no valor absoluto', () => {
  // Uma tira nítida com um pedaço borrado no meio: é a forma do defeito real.
  const w = 600
  const h = 600
  const nitida = listras(w, h, 1)
  const mole = listras(w, h, 9)
  const mistura = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const fonte = (y >= 200 && y < 300) ? mole : nitida
    for (let x = 0; x < w; x++) mistura[y * w + x] = fonte[y * w + x]
  }

  const r = bordaPorRegiao(mistura, w, h, { celulaPx: 100, minimoDeRegioes: 4 })
  assert.ok(r, 'deveria medir')
  assert.ok(r.razao > 2, `a região borrada deveria destoar; razão ${r.razao?.toFixed(2)}`)
  assert.equal(r.piorEm.linha, 2, 'a pior região é a faixa borrada')
})

test('arte uniforme não inventa região ruim', () => {
  const w = 600
  const r = bordaPorRegiao(listras(w, w, 1), w, w, { celulaPx: 100, minimoDeRegioes: 4 })
  assert.ok(r.razao < 1.6, `arte homogênea não deveria destoar; razão ${r.razao?.toFixed(2)}`)
})

test('arte quase toda lisa não produz razão nenhuma', () => {
  // Fundo chapado com um detalhe só: uma razão calculada sobre três células não
  // diz nada sobre a peça, e um número frágil vira alarme falso.
  const w = 400
  const liso = new Float32Array(w * w).fill(240)
  assert.equal(bordaPorRegiao(liso, w, w, { celulaPx: 100 }), null)
})

test('imagem pequena demais para dividir devolve null', () => {
  const g = listras(50, 50, 1)
  assert.equal(bordaPorRegiao(g, 50, 50, { celulaPx: 100 }), null)
})
