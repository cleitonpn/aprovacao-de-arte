import test from 'node:test'
import assert from 'node:assert/strict'
import { larguraParaAnalise } from '../src/core/analise.js'

// O custo da análise, que é o que fazia a página parar de responder.
//
// Cada pixel do render custa 4 bytes no `getImageData` e mais 1 no mapa de
// cinza — e tudo isso vive na mesma thread que precisa desenhar a tela de
// espera. Estes testes travam os dois lados do compromisso: não estourar a
// memória do celular do cliente, e não deixar a peça grande sem medida.

const px = (cm, dpi = 50) => Math.round((cm / 2.54) * dpi)
const TETO = 18e6

test('a peça grande desta operação continua medida na resolução calibrada', () => {
  // Uma parede de 130 × 295 cm com sangria é o caso real, e a calibração de
  // `LIMIAR_BORDA_MM` foi feita a 50 dpi: reduzir ESTE caso invalidaria o
  // limiar que decide se a arte tem detalhe.
  assert.equal(larguraParaAnalise(130, 295), px(130))
})

test('a peça enorme reduz até caber, em vez de ficar sem medida', () => {
  // Antes isto devolvia `null` e quem chama caía num render de 900 px — 8 dpi
  // numa peça de 3 m, resolução em que toda arte parece nítida. A peça MAIOR
  // do stand, a que mais custa reimprimir, era a única sem medida de nitidez.
  const larg = larguraParaAnalise(300, 400)
  assert.ok(larg > 0 && larg < px(300), `deveria reduzir, veio ${larg}`)

  const alt = Math.round(larg * (400 / 300))
  assert.ok(larg * alt <= TETO * 1.02, `${(larg * alt / 1e6).toFixed(1)} MP passa do teto`)
  // E continua proporcional: reduzir só um lado distorceria a arte e a medida.
  assert.ok(Math.abs((larg / alt) - (300 / 400)) < 0.01)
})

test('nenhuma peça passa do teto de memória', () => {
  for (const [l, a] of [[130, 295], [300, 400], [600, 300], [1200, 400], [50, 30]]) {
    const larg = larguraParaAnalise(l, a)
    const altu = Math.round(larg * (a / l))
    assert.ok(larg * altu <= TETO * 1.02, `${l}×${a} cm deu ${(larg * altu / 1e6).toFixed(1)} MP`)
  }
})

test('medida ausente não vira render de tamanho aleatório', () => {
  for (const [l, a] of [[0, 100], [100, 0], [null, null], [-5, 10]]) {
    assert.equal(larguraParaAnalise(l, a), null, `${l}×${a} deveria recusar`)
  }
})
