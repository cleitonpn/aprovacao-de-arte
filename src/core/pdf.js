// Inspeção de PDF (e de .ai, que quase sempre é PDF por dentro).
//
// Num PDF a pergunta "qual é o DPI?" não tem resposta única: o vetor é
// infinito e cada imagem embutida tem a sua própria resolução, que depende
// do tamanho em que foi COLOCADA na página. Por isso aqui rastreamos a matriz
// de transformação corrente para descobrir o tamanho real de cada imagem na
// página — é o que determina se vai imprimir nítida.

import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const PT_POR_POLEGADA = 72
const MM_POR_PT = 25.4 / 72

/** Concatenação de matrizes no sentido do PDF (m1 aplicada depois de m2). */
function multiplicar(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function obterObjeto(pagina, nome, prazo = 4000) {
  return new Promise((resolve) => {
    let concluido = false
    const t = setTimeout(() => {
      if (!concluido) { concluido = true; resolve(null) }
    }, prazo)
    try {
      pagina.objs.get(nome, (valor) => {
        if (!concluido) { concluido = true; clearTimeout(t); resolve(valor) }
      })
    } catch {
      clearTimeout(t)
      resolve(null)
    }
  })
}

export async function abrirPdf(arrayBuffer) {
  const tarefa = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    // sem rede: fontes e mapas de caractere padrão não são buscados
    disableFontFace: true,
    isEvalSupported: false,
  })
  return tarefa.promise
}

/**
 * Rasteriza a página num canvas. Serve tanto para a pré-visualização quanto
 * para rodar as métricas de imagem sobre PDFs que são só um JPG embrulhado.
 */
export async function renderizarPagina(doc, numero = 1, larguraAlvo = 1400) {
  const pagina = await doc.getPage(numero)
  const base = pagina.getViewport({ scale: 1 })
  const escala = Math.min(4, Math.max(0.2, larguraAlvo / base.width))
  const viewport = pagina.getViewport({ scale: escala })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await pagina.render({ canvasContext: ctx, viewport }).promise
  return { canvas, pagina, escala }
}

/**
 * Levanta a estrutura da página: tamanho, presença de vetor e texto, e a
 * resolução efetiva de cada imagem embutida no tamanho em que foi colocada.
 */
export async function inspecionarPagina(doc, numero = 1) {
  const pagina = await doc.getPage(numero)
  const [x0, y0, x1, y1] = pagina.view
  const larguraPt = Math.abs(x1 - x0)
  const alturaPt = Math.abs(y1 - y0)
  const rotacionada = ((pagina.rotate % 360) + 360) % 360 % 180 === 90

  const info = {
    larguraMm: (rotacionada ? alturaPt : larguraPt) * MM_POR_PT,
    alturaMm: (rotacionada ? larguraPt : alturaPt) * MM_POR_PT,
    rotacao: pagina.rotate,
    temVetor: false,
    temTexto: false,
    temTransparencia: false,
    temSombra: false,
    imagens: [],
  }

  // Renderizar antes de ler os objetos: é o render que resolve os XObjects
  // de imagem dentro do worker do pdf.js.
  try {
    await renderizarPagina(doc, numero, 400)
  } catch {
    /* uma página que não rasteriza ainda pode ter sua estrutura lida */
  }

  const { OPS } = pdfjsLib
  const lista = await pagina.getOperatorList()
  let ctm = [1, 0, 0, 1, 0, 0]
  const pilha = []

  for (let i = 0; i < lista.fnArray.length; i++) {
    const op = lista.fnArray[i]
    const args = lista.argsArray[i]

    if (op === OPS.save) {
      pilha.push(ctm.slice())
    } else if (op === OPS.restore) {
      ctm = pilha.pop() || [1, 0, 0, 1, 0, 0]
    } else if (op === OPS.transform) {
      ctm = multiplicar(ctm, args)
    } else if (op === OPS.constructPath) {
      info.temVetor = true
    } else if (op === OPS.showText || op === OPS.showSpacedText) {
      info.temTexto = true
    } else if (op === OPS.setGState) {
      for (const [chave, valor] of args?.[0] || []) {
        if (chave === 'ca' && valor < 1) info.temTransparencia = true
        if (chave === 'CA' && valor < 1) info.temTransparencia = true
        if (chave === 'SMask' && valor) info.temTransparencia = true
      }
    } else if (op === OPS.paintImageXObject || op === OPS.paintImageMaskXObject) {
      const largPt = Math.hypot(ctm[0], ctm[1])
      const altPt = Math.hypot(ctm[2], ctm[3])
      let px = Number(args?.[1])
      let py = Number(args?.[2])
      if (!Number.isFinite(px) || !Number.isFinite(py) || px <= 0 || py <= 0) {
        const obj = typeof args?.[0] === 'string' ? await obterObjeto(pagina, args[0]) : null
        px = obj?.width
        py = obj?.height
      }
      if (Number.isFinite(px) && Number.isFinite(py) && px > 0 && largPt > 1 && altPt > 1) {
        info.imagens.push({
          px,
          py,
          larguraMm: largPt * MM_POR_PT,
          alturaMm: altPt * MM_POR_PT,
          dpi: px / (largPt / PT_POR_POLEGADA),
          dpiV: py / (altPt / PT_POR_POLEGADA),
          mascara: op === OPS.paintImageMaskXObject,
        })
      }
    } else if (op === OPS.paintInlineImageXObject) {
      const img = args?.[0]
      const largPt = Math.hypot(ctm[0], ctm[1])
      if (img?.width && largPt > 1) {
        info.imagens.push({
          px: img.width,
          py: img.height,
          larguraMm: largPt * MM_POR_PT,
          alturaMm: Math.hypot(ctm[2], ctm[3]) * MM_POR_PT,
          dpi: img.width / (largPt / PT_POR_POLEGADA),
          dpiV: img.height / (Math.hypot(ctm[2], ctm[3]) / PT_POR_POLEGADA),
          embutida: true,
        })
      }
    }
  }

  if (!info.temTexto) {
    try {
      const texto = await pagina.getTextContent()
      info.temTexto = (texto.items || []).some((it) => (it.str || '').trim().length > 0)
    } catch {
      /* sem conteúdo de texto legível */
    }
  }

  // A imagem que cobre a maior área é a que manda na percepção de qualidade
  info.imagemPrincipal = info.imagens.reduce(
    (maior, img) => (!maior || img.larguraMm * img.alturaMm > maior.larguraMm * maior.alturaMm ? img : maior),
    null,
  )
  // Só-vetor: nenhum raster, ou raster ocupando área desprezível
  const areaPagina = info.larguraMm * info.alturaMm
  const areaRaster = info.imagens.reduce((s, im) => s + im.larguraMm * im.alturaMm, 0)
  info.fracaoRaster = areaPagina > 0 ? Math.min(1, areaRaster / areaPagina) : 0
  info.puroVetor = info.imagens.length === 0 && (info.temVetor || info.temTexto)

  return info
}

export async function fontesNaoIncorporadas(doc, numero = 1) {
  // pdf.js substitui fontes ausentes silenciosamente. Quando ele sinaliza a
  // substituição, dá para avisar; quando não sinaliza, ficamos calados em vez
  // de afirmar o que não sabemos.
  try {
    const pagina = await doc.getPage(numero)
    const lista = await pagina.getOperatorList()
    const { OPS } = pdfjsLib
    const faltando = new Set()
    for (let i = 0; i < lista.fnArray.length; i++) {
      if (lista.fnArray[i] !== OPS.setFont) continue
      const nome = lista.argsArray[i]?.[0]
      if (typeof nome !== 'string') continue
      let fonte = null
      try {
        fonte = pagina.commonObjs.has(nome) ? pagina.commonObjs.get(nome) : null
      } catch {
        fonte = null
      }
      if (fonte && (fonte.missingFile === true || fonte.data?.missingFile === true)) {
        faltando.add(fonte.name || fonte.fallbackName || nome)
      }
    }
    return [...faltando]
  } catch {
    return []
  }
}
