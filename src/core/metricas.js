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

/**
 * Quantos pixels uma borda leva para trocar de tom.
 *
 * É a medida que separa arte nítida de arte ampliada, e ela funciona onde a
 * densidade declarada engana. Medido em três arquivos reais desta operação, a
 * 50 dpi no tamanho impresso:
 *
 *   Infracommerce, aprovado pelo time, 300 dpi nominal   →  1,1 px
 *   JadLog,        aprovado pelo time, 150 dpi nominal   →  1,4 px
 *   J&T,           reprovado pelo time, 216 dpi nominal  →  3,4 px
 *
 * Repare no que a tabela desmonta: o arquivo reprovado tinha densidade nominal
 * MAIOR que um dos aprovados. Contar pixel não diz nada sobre haver detalhe
 * neles; medir a borda diz.
 *
 * O método: numa transição forte, a altura do degrau dividida pela inclinação
 * máxima dá a largura da rampa. Borda real vira em um ou dois pixels; borda de
 * imagem ampliada arrasta por dez ou vinte, porque os pixels do meio foram
 * inventados por interpolação.
 *
 * Devolve a MEDIANA, não o pior caso. Arte boa tem regiões moles legítimas —
 * fundo desfocado, céu, gradiente — e o JadLog aprovado tem várias. O que
 * separa não é existir região mole, é a peça inteira ser mole.
 */
export function larguraDeBorda(gray, w, h, { maxAmostras = 20000 } = {}) {
  if (w < 8 || h < 8) return null

  // Percentil por histograma: ordenar quinze milhões de gradientes custaria
  // mais que toda a análise junta.
  const hist = new Uint32Array(256)
  let total = 0
  for (let y = 0; y < h; y++) {
    const base = y * w
    for (let x = 0; x < w - 1; x++) {
      hist[Math.abs(gray[base + x + 1] - gray[base + x]) | 0]++
      total++
    }
  }
  if (!total) return null

  const alvo = total * 0.995
  let acum = 0
  let limiar = 255
  for (let v = 0; v < 256; v++) {
    acum += hist[v]
    if (acum >= alvo) { limiar = v; break }
  }
  if (limiar < 6) return null // nada com contraste suficiente para medir

  const JANELA = 30
  const PASSO_MIN = 30
  const larguras = []
  const salto = Math.max(1, Math.floor(h / 600))

  for (let y = 0; y < h && larguras.length < maxAmostras; y += salto) {
    const base = y * w
    for (let x = 1; x < w - 2 && larguras.length < maxAmostras; x++) {
      if (Math.abs(gray[base + x + 1] - gray[base + x]) < limiar) continue

      const i0 = Math.max(0, x - JANELA)
      const i1 = Math.min(w - 1, x + JANELA)
      let min = 255
      let max = 0
      let inclinacao = 0
      for (let i = i0; i <= i1; i++) {
        const v = gray[base + i]
        if (v < min) min = v
        if (v > max) max = v
        if (i < i1) {
          const g = Math.abs(gray[base + i + 1] - v)
          if (g > inclinacao) inclinacao = g
        }
      }
      const degrau = max - min
      if (degrau >= PASSO_MIN && inclinacao > 0) larguras.push(degrau / inclinacao)
      x = i1 // não medir a mesma borda dezenas de vezes
    }
  }

  if (larguras.length < 12) return null
  larguras.sort((a, b) => a - b)
  const m = larguras.length >> 1
  return larguras.length % 2 ? larguras[m] : (larguras[m - 1] + larguras[m]) / 2
}

/**
 * A borda medida REGIÃO A REGIÃO, e não numa mediana só.
 *
 * A mediana da peça inteira responde "esta arte é mole?" e é cega para "esta
 * arte tem uma parte mole". São perguntas diferentes, e a segunda é a que a
 * operação faz: um logo ampliado dentro de uma arte boa ocupa 1% da área e não
 * move mediana nenhuma.
 *
 * Medido na parede da CRM Bonus (120 × 320 cm, amostrada a 104 dpi, células de
 * 10 cm): a mediana das regiões deu 0,25 mm e um bloco em x≈40-90 cm, y≈210-260
 * cm deu 0,55 mm — 2,2× o resto. Pelo limiar absoluto de 1,2 mm nada aparecia;
 * pela RAZÃO, aparece.
 *
 * Por isso o que sai daqui é a razão, não o valor. Arte fotográfica inteira é
 * mais mole que arte vetorial inteira, e comparar uma peça com um número fixo
 * confunde estilo com defeito. Comparar a peça consigo mesma, não.
 */
export function bordaPorRegiao(cinza, largura, altura, { celulaPx = 100, minimoDeRegioes = 12 } = {}) {
  const colunas = Math.max(1, Math.floor(largura / celulaPx))
  const linhas = Math.max(1, Math.floor(altura / celulaPx))
  const cw = Math.floor(largura / colunas)
  const ch = Math.floor(altura / linhas)
  if (cw < 30 || ch < 30) return null

  const medidas = []
  const bloco = new Float32Array(cw * ch)
  for (let l = 0; l < linhas; l++) {
    for (let c = 0; c < colunas; c++) {
      for (let y = 0; y < ch; y++) {
        const origem = (l * ch + y) * largura + c * cw
        for (let x = 0; x < cw; x++) bloco[y * cw + x] = cinza[origem + x]
      }
      const v = larguraDeBorda(bloco, cw, ch)
      if (v != null) medidas.push({ px: v, coluna: c, linha: l })
    }
  }

  // Poucas regiões com borda é arte quase toda lisa — fundo chapado, cor sólida.
  // Uma razão calculada sobre três células não diz nada sobre a peça.
  if (medidas.length < minimoDeRegioes) return null

  const ordenadas = [...medidas].sort((a, b) => a.px - b.px)
  const mediana = ordenadas[Math.floor(ordenadas.length / 2)].px
  const pior = ordenadas[ordenadas.length - 1]
  return {
    regioes: medidas.length,
    medianaPx: mediana,
    piorPx: pior.px,
    razao: mediana > 0 ? pior.px / mediana : null,
    piorEm: { coluna: pior.coluna, linha: pior.linha, colunas, linhas },
  }
}
