// Carregamento de imagem no navegador e extração de amostras para análise.
//
// Detalhe que parece pequeno e não é: a análise espectral TEM que rodar sobre
// os pixels nativos. Se reduzirmos a imagem para "caber na memória" antes de
// medir, destruímos exatamente a evidência que estamos procurando. Por isso
// aqui trabalhamos com dois níveis: uma amostra reduzida para as estatísticas
// globais e recortes em resolução nativa para a análise de frequência.

import { paraCinza, mascaraDetalhe } from './metricas.js'

export const LADO_RECORTE = 512 // potência de 2, exigência da FFT
export const MAX_LADO_AMOSTRA = 1400

function criarCanvas(largura, altura) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(largura, altura)
  const c = document.createElement('canvas')
  c.width = largura
  c.height = altura
  return c
}

export async function carregarBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      /* alguns navegadores falham com CMYK ou arquivos muito grandes */
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Não foi possível decodificar a imagem.'))
      el.src = url
    })
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

function desenhar(fonte, largura, altura, sx = 0, sy = 0, sw = null, sh = null) {
  const canvas = criarCanvas(largura, altura)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(fonte, sx, sy, sw ?? fonte.width, sh ?? fonte.height, 0, 0, largura, altura)
  return ctx.getImageData(0, 0, largura, altura)
}

/** Versão reduzida para estatísticas globais (cor, bordas na margem, blocagem grosseira). */
export function amostraReduzida(bitmap, maxLado = MAX_LADO_AMOSTRA) {
  const w = bitmap.width
  const h = bitmap.height
  const escala = Math.min(1, maxLado / Math.max(w, h))
  const lw = Math.max(1, Math.round(w * escala))
  const lh = Math.max(1, Math.round(h * escala))
  const dados = desenhar(bitmap, lw, lh)
  return { dados, largura: lw, altura: lh, escala }
}

/**
 * Escolhe as regiões com mais detalhe e devolve recortes em resolução NATIVA.
 * Analisar regiões chapadas não diz nada sobre a resolução do arquivo — o
 * detalhe é que revela se há informação real na última oitava.
 */
export function recortesNativos(bitmap, amostra, quantidade = 3, lado = LADO_RECORTE) {
  const w = bitmap.width
  const h = bitmap.height
  if (w < lado || h < lado) return []

  const cinzaAmostra = paraCinza(amostra.dados.data, amostra.largura, amostra.altura)
  const passo = Math.max(8, Math.round((lado * amostra.escala) / 2))
  const candidatos = []

  for (let by = 0; by + passo <= amostra.altura; by += passo) {
    for (let bx = 0; bx + passo <= amostra.largura; bx += passo) {
      let soma = 0
      let soma2 = 0
      let n = 0
      for (let y = by; y < by + passo; y++) {
        for (let x = bx; x < bx + passo; x++) {
          const v = cinzaAmostra[y * amostra.largura + x]
          soma += v
          soma2 += v * v
          n++
        }
      }
      const dp = Math.sqrt(Math.max(0, soma2 / n - (soma / n) ** 2))
      candidatos.push({ dp, x: Math.round(bx / amostra.escala), y: Math.round(by / amostra.escala) })
    }
  }

  candidatos.sort((a, b) => b.dp - a.dp)

  const escolhidos = []
  const distanciaMin = lado * 0.75
  for (const c of candidatos) {
    if (escolhidos.length >= quantidade) break
    if (c.dp < 0.02) break // só há região chapada daqui em diante
    const x = Math.min(Math.max(0, c.x - lado / 4), w - lado)
    const y = Math.min(Math.max(0, c.y - lado / 4), h - lado)
    if (escolhidos.some((e) => Math.hypot(e.x - x, e.y - y) < distanciaMin)) continue
    escolhidos.push({ x: Math.round(x), y: Math.round(y) })
  }

  return escolhidos.map(({ x, y }) => {
    const dados = desenhar(bitmap, lado, lado, x, y, lado, lado)
    return { x, y, lado, cinza: paraCinza(dados.data, lado, lado), dados }
  })
}

/** Fração da imagem que é área chapada — usada para contextualizar os avisos. */
export function fracaoChapada(amostra) {
  const cinza = paraCinza(amostra.dados.data, amostra.largura, amostra.altura)
  return 1 - mascaraDetalhe(cinza, amostra.largura, amostra.altura).fracaoDetalhe
}

/** Data URL para pré-visualização, já reduzida — não seguramos o arquivo cheio na tela. */
export async function miniatura(bitmap, maxLado = 900) {
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
  const lw = Math.max(1, Math.round(bitmap.width * escala))
  const lh = Math.max(1, Math.round(bitmap.height * escala))
  const canvas = criarCanvas(lw, lh)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, lw, lh)
  if (canvas.convertToBlob) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    return URL.createObjectURL(blob)
  }
  return canvas.toDataURL('image/jpeg', 0.85)
}
