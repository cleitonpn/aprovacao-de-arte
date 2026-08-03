// Calibração do detector de resolução real.
//
// Roda com `npm test` (node --test). Gera imagens sintéticas com espectro
// controlado e verifica que o classificador acerta a direção. A regra que
// governa os limiares: NA DÚVIDA, FICAR CALADO. Um falso positivo — acusar
// arte boa de ampliada — custa muito mais caro que deixar passar um caso
// difícil, porque destrói a confiança do time e do cliente na ferramenta.

import test from 'node:test'
import assert from 'node:assert/strict'
import { ampliarBilinear, blocagem, mascaraDetalhe } from '../src/core/metricas.js'
import { analisarEspectro, classificarDeficit } from '../src/core/espectro.js'

let semente = 12345
const rnd = () => {
  semente = (semente * 1664525 + 1013904223) >>> 0
  return semente / 4294967296
}
const reiniciar = () => { semente = 12345 }

const ruido = (w, h) => {
  const a = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) a[i] = rnd()
  return a
}

function normalizar(a) {
  let mn = Infinity
  let mx = -Infinity
  for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v }
  const d = mx - mn || 1
  const o = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) o[i] = (a[i] - mn) / d
  return o
}

/** Espectro ~1/f, que é o que fotografias reais têm. */
function natural(w, h, oitavas = 8) {
  const out = new Float32Array(w * h)
  for (let j = 0; j < oitavas; j++) {
    const nw = Math.max(2, w >> j)
    const nh = Math.max(2, h >> j)
    const up = ampliarBilinear(ruido(nw, nh), nw, nh, w, h)
    const peso = 2 ** j
    for (let i = 0; i < out.length; i++) out[i] += up[i] * peso
  }
  return normalizar(out)
}

/** Retângulos duros — simula texto, logo, arte vetorial rasterizada. */
function bordas(src, w, h, n = 40) {
  const o = Float32Array.from(src)
  for (let k = 0; k < n; k++) {
    const x0 = Math.floor(rnd() * w)
    const y0 = Math.floor(rnd() * h)
    const lw = Math.floor(2 + rnd() * 40)
    const lh = Math.floor(2 + rnd() * 40)
    const v = rnd() > 0.5 ? 1 : 0
    for (let y = y0; y < Math.min(h, y0 + lh); y++) {
      for (let x = x0; x < Math.min(w, x0 + lw); x++) o[y * w + x] = v
    }
  }
  return o
}

/** Ampliação "boa" (bicubic smoother e afins): passa-baixa antes de ampliar. */
function ampliarSuave(src, w, h, tw, th) {
  const up = ampliarBilinear(src, w, h, tw, th)
  const o = new Float32Array(tw * th)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(th - 1, Math.max(0, y + dy))
          const xx = Math.min(tw - 1, Math.max(0, x + dx))
          s += up[yy * tw + xx]
        }
      }
      o[y * tw + x] = s / 9
    }
  }
  return o
}

function comGrao(src, amp = 0.02) {
  const o = Float32Array.from(src)
  for (let i = 0; i < o.length; i++) o[i] = Math.min(1, Math.max(0, o[i] + (rnd() - 0.5) * amp * 2))
  return o
}

const N = 512
// true = o arquivo NÃO sustenta a resolução que declara
const acusou = (img) => classificarDeficit(analisarEspectro(img, N)).detalheReal === false

test('não acusa arte legítima de ampliada (falso positivo é o erro caro)', () => {
  const legitimas = {
    'foto nítida': () => natural(N, N),
    'foto nítida com grão de sensor': () => comGrao(natural(N, N)),
    'foto com bordas duras': () => bordas(natural(N, N), N, N),
    'vetor rasterizado (só bordas chapadas)': () => bordas(new Float32Array(N * N).fill(0.5), N, N, 160),
    'degradê suave sem detalhe fino': () => natural(N, N, 3),
    'foto levemente desfocada': () => ampliarSuave(natural(N, N), N, N, N, N),
  }
  for (const [nome, gerar] of Object.entries(legitimas)) {
    reiniciar()
    assert.equal(acusou(gerar()), false, `acusou indevidamente: ${nome}`)
  }
})

test('detecta arquivos ampliados artificialmente', () => {
  const ampliadas = {
    'ampliada 2x bilinear': () => ampliarBilinear(bordas(natural(256, 256), 256, 256, 20), 256, 256, N, N),
    'ampliada 2x suave': () => ampliarSuave(bordas(natural(256, 256), 256, 256, 20), 256, 256, N, N),
    'ampliada 2x sem bordas': () => ampliarSuave(natural(256, 256), 256, 256, N, N),
    'ampliada 4x': () => ampliarSuave(bordas(natural(128, 128), 128, 128, 10), 128, 128, N, N),
  }
  for (const [nome, gerar] of Object.entries(ampliadas)) {
    reiniciar()
    assert.ok(acusou(gerar()), `deixou passar: ${nome}`)
  }
})

// Os dois casos abaixo NÃO são detectados. Ficam registrados como teste para
// que a limitação seja fato verificado do código e não surpresa em produção —
// e para que qualquer tentativa futura de melhorar o detector tenha um alvo
// objetivo. Nos dois, o custo operacional do silêncio é baixo.
test('limitação conhecida: grão aplicado DEPOIS da ampliação escapa', () => {
  // Ruído posterior repõe energia na oitava superior e apaga a assinatura.
  reiniciar()
  const img = comGrao(ampliarSuave(natural(256, 256), 256, 256, N, N), 0.02)
  assert.equal(acusou(img), false)
})

test('limitação conhecida: ampliação extrema (8x) escapa ao detector', () => {
  // Com 8x, quase toda a banda analisada já é patamar de ruído e o ajuste em
  // dois segmentos degenera. Na prática não custa nada: um arquivo ampliado
  // 8x partiu de algo minúsculo e é barrado pelo cálculo de DPI, que é
  // aritmética simples e não erra.
  reiniciar()
  assert.equal(acusou(ampliarSuave(natural(64, 64), 64, 64, N, N)), false)
})

test('blocagem sobe em imagem com grade 8×8 de JPEG', () => {
  reiniciar()
  const limpa = natural(N, N)
  const comGrade = Float32Array.from(limpa)
  // degrau artificial nas fronteiras de bloco
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x % 8 === 0 || y % 8 === 0) comGrade[y * N + x] = Math.min(1, comGrade[y * N + x] + 0.06)
    }
  }
  assert.ok(blocagem(comGrade, N, N) > blocagem(limpa, N, N) * 1.5)
})

test('máscara de detalhe descarta área chapada (evita falso "borrado")', () => {
  // Uma lona com fundo sólido e um logo no canto é o caso que faz detectores
  // ingênuos gritarem "imagem borrada". A máscara existe para isso.
  const chapada = new Float32Array(N * N).fill(0.8)
  assert.equal(mascaraDetalhe(chapada, N, N).fracaoDetalhe, 0)

  reiniciar()
  const comLogo = new Float32Array(N * N).fill(0.8)
  const lw = 96
  const detalhe = bordas(natural(lw, lw), lw, lw, 25)
  for (let y = 0; y < lw; y++) for (let x = 0; x < lw; x++) comLogo[(y + 20) * N + (x + 20)] = detalhe[y * lw + x]
  const f = mascaraDetalhe(comLogo, N, N).fracaoDetalhe
  assert.ok(f > 0 && f < 0.15, `fração de detalhe fora do esperado: ${f}`)
})
