// Inspeção de PDF (e de .ai, que quase sempre é PDF por dentro).
//
// Num PDF a pergunta "qual é o DPI?" não tem resposta única: o vetor é
// infinito e cada imagem embutida tem a sua própria resolução, que depende
// do tamanho em que foi COLOCADA na página. Por isso aqui rastreamos a matriz
// de transformação corrente para descobrir o tamanho real de cada imagem na
// página — é o que determina se vai imprimir nítida.

import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { comPrazo } from './prazo.js'

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
/**
 * Quanto tempo a rasterização pode levar antes de ser abandonada.
 *
 * Existe porque `render().promise` não tem fim garantido: diante de uma arte
 * que o pdf.js não dá conta de desenhar, ele não falha — fica. E "fica" na
 * interface é a tela de análise parada no mesmo passo, sem erro, sem veredicto
 * e sem saída, enquanto o cliente espera. Houve relato de cinco minutos.
 *
 * O caminho de desistência JÁ EXISTE e é bom: sem rasterização a ferramenta lê
 * a imagem direto do PDF, ainda mede a nitidez, e a peça vai para conferência
 * humana sem miniatura. O que faltava era chegar nele — o código supunha que
 * a falha viria como exceção, e ela vem como espera infinita.
 *
 * 90 s é folgado de propósito. Uma parede grande e honesta leva dezenas de
 * segundos num notebook modesto, e cortar cedo demais custaria a miniatura de
 * quem não fez nada de errado.
 */
export const PRAZO_RENDER_MS = 90000

/**
 * O mesmo para ler a ESTRUTURA da página.
 *
 * Mais curto que o do render porque aqui não há nada bonito a perder: o render
 * entrega a miniatura que o cliente vê, e esperar por ela vale a pena; a
 * estrutura entrega o dpi das imagens, e sem ele a peça apenas vai para a
 * conferência humana — que é para onde ela iria de qualquer jeito num arquivo
 * que a ferramenta não consegue abrir.
 */
export const PRAZO_ESTRUTURA_MS = 45000


export async function renderizarPagina(doc, numero = 1, larguraAlvo = 1400, prazoMs = PRAZO_RENDER_MS) {
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

  const tarefa = pagina.render({ canvasContext: ctx, viewport })
  // O `catch` solto evita que a rejeição que chega DEPOIS do prazo vire uma
  // rejeição não tratada: a corrida abaixo já foi embora e ninguém mais escuta.
  tarefa.promise.catch(() => {})

  let relogio
  const prazo = new Promise((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error('prazo-de-render')), prazoMs)
  })

  try {
    await Promise.race([tarefa.promise, prazo])
  } catch (erro) {
    // Pedir o cancelamento importa: sem ele o pdf.js continua desenhando em
    // segundo plano, numa thread que a interface precisa para responder.
    try { tarefa.cancel() } catch { /* já terminou */ }
    canvas.width = 0
    canvas.height = 0
    throw erro
  } finally {
    clearTimeout(relogio)
  }

  return { canvas, pagina, escala }
}

/** Largura da página em pontos, já considerando a rotação. */
export async function larguraEmPontos(doc, numero = 1) {
  const pagina = await doc.getPage(numero)
  return pagina.getViewport({ scale: 1 }).width
}

/**
 * O tamanho que a página DECLARA, em milímetros. Nada é desenhado nem lido.
 *
 * Existe para a detecção de escala poder acontecer ANTES da medição. É a mesma
 * conta que `inspecionarPagina` faz nas suas primeiras linhas, mas sem o resto:
 * aquela função percorre a lista de operadores da página para achar as imagens,
 * e aqui não há nada que precise disso. A diferença é entre ler o cabeçalho e
 * abrir o arquivo inteiro — e é ela que evita medir a arte duas vezes.
 */
export async function tamanhoDaPagina(doc, numero = 1) {
  const pagina = await doc.getPage(numero)
  const [x0, y0, x1, y1] = pagina.view
  const rotacionada = ((pagina.rotate % 360) + 360) % 360 % 180 === 90
  const larguraPt = Math.abs(x1 - x0)
  const alturaPt = Math.abs(y1 - y0)
  return {
    larguraMm: (rotacionada ? alturaPt : larguraPt) * MM_POR_PT,
    alturaMm: (rotacionada ? larguraPt : alturaPt) * MM_POR_PT,
  }
}

/**
 * Rasteriza só um PEDAÇO da página, na resolução que se pedir.
 *
 * Existe por causa do simulador de distância, e é a única forma de ele não
 * mentir. O simulador mostra um trecho da arte na resolução REAL — é o ponto
 * dele: ver se o ponto impresso aparece de perto. Rasterizar a página inteira
 * nessa resolução é impossível: uma lona de 275 cm a 100 dpi dá 10.800 px de
 * largura, quase meio gigabyte de canvas. Recortando ANTES de rasterizar, o
 * mesmo trecho custa poucos megabytes.
 *
 * `sx`/`sy` e o tamanho vêm em pixels da página já na escala pedida.
 */
export async function renderizarRecorte(doc, numero, { escala, sx, sy, largura, altura }) {
  const pagina = await doc.getPage(numero)
  const viewport = pagina.getViewport({ scale: escala })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(largura))
  canvas.height = Math.max(1, Math.round(altura))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // A translação É o recorte: a página inteira é desenhada, mas com a origem
  // deslocada — o canvas pequeno recebe só a janela que interessa.
  await pagina.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -Math.round(sx), -Math.round(sy)],
  }).promise
  return canvas
}

/**
 * Levanta a estrutura da página: tamanho, presença de vetor e texto, e a
 * resolução efetiva de cada imagem embutida no tamanho em que foi colocada.
 */
export async function inspecionarPagina(doc, numero = 1, { rasterizar = true } = {}) {
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
    // Verdadeiro quando a leitura da página não terminou no prazo. Quem usa o
    // resultado precisa saber a diferença entre "não há imagem" e "não deu
    // tempo de olhar".
    estruturaIncompleta: false,
  }

  // Renderizar antes de ler os objetos: é o render que resolve os XObjects
  // de imagem dentro do worker do pdf.js.
  //
  // `rasterizar: false` existe para quem JÁ rasterizou a página. É o caso da
  // análise, e a diferença é enorme: rasterizar um PDF não custa pelo tamanho
  // do canvas, custa por decodificar a imagem embutida — centenas de megabytes
  // de pixel, independentemente de a saída ter 400 px ou 2.559. Fazer isso
  // duas vezes na mesma medição era o que deixava a tela parada em "Medindo".
  if (rasterizar) {
    try {
      await renderizarPagina(doc, numero, 400)
    } catch {
      /* uma página que não rasteriza ainda pode ter sua estrutura lida */
    }
  }

  const { OPS } = pdfjsLib

  // A lista de operadores também tem prazo.
  //
  // Pôr prazo só na rasterização tapava metade do buraco. `getOperatorList`
  // não é leitura de índice: o pdf.js interpreta a página inteira para montá-la
  // — e decodifica as imagens no caminho. Num arquivo de dezenas de megabytes
  // com texto, vetor e foto grande junto, ela demora tanto quanto o desenho, e
  // também não tem fim garantido.
  //
  // Sem estrutura a ferramenta não fica sem resposta: fica sem o dpi das
  // imagens embutidas, o que já leva a peça para a conferência humana. É um
  // resultado pior, e é muito melhor que uma tela parada.
  const lista = await comPrazo(
    pagina.getOperatorList(),
    PRAZO_ESTRUTURA_MS,
    'prazo-da-estrutura',
  ).catch(() => null)

  if (!lista) {
    info.estruturaIncompleta = true
    return finalizar(info)
  }

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

  return finalizar(info)
}

/**
 * Os números derivados da lista de imagens.
 *
 * Separado porque a inspeção pode terminar por dois caminhos — a leitura
 * completa e o estouro de prazo — e os dois precisam devolver um objeto com
 * a mesma forma. Quem lê o resultado não deveria ter que saber por onde ele
 * veio; o que muda é `estruturaIncompleta`, e só.
 */
function finalizar(info) {
  // A imagem que cobre a maior área é a que manda na percepção de qualidade
  info.imagemPrincipal = info.imagens.reduce(
    (maior, img) => (!maior || img.larguraMm * img.alturaMm > maior.larguraMm * maior.alturaMm ? img : maior),
    null,
  )
  // Só-vetor: nenhum raster, ou raster ocupando área desprezível
  const areaPagina = info.larguraMm * info.alturaMm
  const areaRaster = info.imagens.reduce((s, im) => s + im.larguraMm * im.alturaMm, 0)
  info.fracaoRaster = areaPagina > 0 ? Math.min(1, areaRaster / areaPagina) : 0
  // Sem estrutura lida, "nenhuma imagem" não significa "só vetor": significa
  // que não se olhou. Afirmar pureza vetorial aqui faria a ferramenta aprovar
  // por resolução uma arte cujo raster ela nunca viu.
  info.puroVetor = !info.estruturaIncompleta
    && info.imagens.length === 0
    && (info.temVetor || info.temTexto)

  return info
}

export async function fontesNaoIncorporadas(doc, numero = 1) {
  // pdf.js substitui fontes ausentes silenciosamente. Quando ele sinaliza a
  // substituição, dá para avisar; quando não sinaliza, ficamos calados em vez
  // de afirmar o que não sabemos.
  try {
    const pagina = await doc.getPage(numero)
    // Mesmo prazo, pelo mesmo motivo — e por um a mais: o pdf.js guarda a
    // lista de operadores por página, então esta chamada pega a MESMA promessa
    // que a inspeção já esperou. Se aquela estourou, esta herdaria a espera
    // inteira, e o prazo da outra não teria servido de nada.
    const lista = await comPrazo(pagina.getOperatorList(), PRAZO_ESTRUTURA_MS, 'prazo-das-fontes')
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
