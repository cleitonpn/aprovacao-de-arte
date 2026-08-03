// Métricas de imagem — matemática pura, sem dependência de DOM.
//
// Tudo aqui opera sobre luminância em Float32Array normalizada em 0..1,
// para poder ser testado fora do navegador.

export function paraCinza(dados, largura, altura) {
  const g = new Float32Array(largura * altura)
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    // Rec. 601: aproxima a percepção de brilho melhor que a média simples
    g[i] = (dados[p] * 0.299 + dados[p + 1] * 0.587 + dados[p + 2] * 0.114) / 255
  }
  return g
}

export function reduzirMetade(src, w, h) {
  const nw = Math.max(1, w >> 1)
  const nh = Math.max(1, h >> 1)
  const out = new Float32Array(nw * nh)
  for (let y = 0; y < nh; y++) {
    const y0 = 2 * y
    const y1 = Math.min(y0 + 1, h - 1)
    for (let x = 0; x < nw; x++) {
      const x0 = 2 * x
      const x1 = Math.min(x0 + 1, w - 1)
      out[y * nw + x] = (src[y0 * w + x0] + src[y0 * w + x1] + src[y1 * w + x0] + src[y1 * w + x1]) / 4
    }
  }
  return { dados: out, largura: nw, altura: nh }
}

export function ampliarBilinear(src, w, h, tw, th) {
  const out = new Float32Array(tw * th)
  const ex = w / tw
  const ey = h / th
  for (let y = 0; y < th; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * ey - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(h - 1, y0 + 1)
    const dy = fy - y0
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * ex - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(w - 1, x0 + 1)
      const dx = fx - x0
      const a = src[y0 * w + x0]
      const b = src[y0 * w + x1]
      const c = src[y1 * w + x0]
      const d = src[y1 * w + x1]
      out[y * tw + x] = a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy
    }
  }
  return out
}

/**
 * Marca os blocos que têm detalhe real. Regiões chapadas (fundo sólido,
 * degradê suave) são excluídas de toda análise de nitidez — senão uma lona
 * com fundo liso e um logo seria acusada de "borrada", que é o falso
 * negativo clássico desse tipo de ferramenta.
 */
export function mascaraDetalhe(gray, w, h, bloco = 8, limiar = 0.02) {
  const mascara = new Uint8Array(w * h)
  let cobertos = 0
  for (let by = 0; by < h; by += bloco) {
    for (let bx = 0; bx < w; bx += bloco) {
      const fy = Math.min(by + bloco, h)
      const fx = Math.min(bx + bloco, w)
      let soma = 0
      let soma2 = 0
      let n = 0
      for (let y = by; y < fy; y++) {
        for (let x = bx; x < fx; x++) {
          const v = gray[y * w + x]
          soma += v
          soma2 += v * v
          n++
        }
      }
      const dp = Math.sqrt(Math.max(0, soma2 / n - (soma / n) ** 2))
      if (dp >= limiar) {
        for (let y = by; y < fy; y++) for (let x = bx; x < fx; x++) mascara[y * w + x] = 1
        cobertos += n
      }
    }
  }
  return { mascara, fracaoDetalhe: cobertos / (w * h) }
}

/**
 * Detecta a grade 8×8 do JPEG. Se as diferenças nas fronteiras dos blocos são
 * bem maiores que as diferenças internas, a compressão está aparecendo.
 */
export function blocagem(gray, w, h) {
  let fronteira = 0
  let nF = 0
  let interior = 0
  let nI = 0

  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const d = Math.abs(gray[y * w + x] - gray[y * w + x - 1])
      if (x % 8 === 0) { fronteira += d; nF++ } else { interior += d; nI++ }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 1; y < h; y++) {
      const d = Math.abs(gray[y * w + x] - gray[(y - 1) * w + x])
      if (y % 8 === 0) { fronteira += d; nF++ } else { interior += d; nI++ }
    }
  }
  if (!nF || !nI) return 1
  const mI = interior / nI
  if (mI < 1e-5) return 1
  return (fronteira / nF) / mI
}

/** Magnitude de borda (Sobel) normalizada em 0..1. */
export function mapaBordas(gray, w, h) {
  const out = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]
      out[i] = Math.min(1, Math.hypot(gx, gy) / 4)
    }
  }
  return out
}

/**
 * Compara a energia gráfica dentro da faixa de margem de segurança com a do
 * miolo. Não sabe *o que* está lá — mas sabe dizer "tem coisa desenhada na
 * área que a estrutura come", que é o aviso que interessa.
 */
export function conteudoNaMargem(gray, w, h, faixaX, faixaY) {
  const bordas = mapaBordas(gray, w, h)
  const bx = Math.max(1, Math.round(faixaX))
  const by = Math.max(1, Math.round(faixaY))
  if (bx * 2 >= w || by * 2 >= h) return null

  let faixa = 0
  let nFaixa = 0
  let miolo = 0
  let nMiolo = 0
  for (let y = 1; y < h - 1; y++) {
    const naFaixaY = y < by || y >= h - by
    for (let x = 1; x < w - 1; x++) {
      const naFaixa = naFaixaY || x < bx || x >= w - bx
      const v = bordas[y * w + x]
      if (naFaixa) { faixa += v; nFaixa++ } else { miolo += v; nMiolo++ }
    }
  }
  if (!nFaixa || !nMiolo) return null
  const mFaixa = faixa / nFaixa
  const mMiolo = miolo / nMiolo
  return {
    densidadeMargem: mFaixa,
    densidadeMiolo: mMiolo,
    razao: mMiolo > 1e-6 ? mFaixa / mMiolo : 0,
  }
}

/** Fração de pixels da borda externa que é uniforme — indica sangria pronta. */
export function bordaUniforme(gray, w, h, espessura = 4) {
  const e = Math.max(1, Math.min(espessura, Math.floor(Math.min(w, h) / 8)))
  const amostras = []
  for (let y = 0; y < e; y++) for (let x = 0; x < w; x++) amostras.push(gray[y * w + x], gray[(h - 1 - y) * w + x])
  for (let x = 0; x < e; x++) for (let y = 0; y < h; y++) amostras.push(gray[y * w + x], gray[y * w + (w - 1 - x)])
  let soma = 0
  let soma2 = 0
  for (const v of amostras) { soma += v; soma2 += v * v }
  const n = amostras.length
  return Math.sqrt(Math.max(0, soma2 / n - (soma / n) ** 2))
}

/** Estatísticas gerais de cor: presença real de cor e uso da faixa tonal. */
export function estatisticasCor(dados) {
  let maxSat = 0
  let somaSat = 0
  let n = 0
  let minL = 1
  let maxL = 0
  for (let p = 0; p < dados.length; p += 4) {
    const r = dados[p] / 255
    const g = dados[p + 1] / 255
    const b = dados[p + 2] / 255
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const sat = mx > 0 ? (mx - mn) / mx : 0
    somaSat += sat
    if (sat > maxSat) maxSat = sat
    const l = (r + g + b) / 3
    if (l < minL) minL = l
    if (l > maxL) maxL = l
    n++
  }
  return { saturacaoMedia: somaSat / n, saturacaoMax: maxSat, minLuma: minL, maxLuma: maxL, cinza: maxSat < 0.04 }
}
