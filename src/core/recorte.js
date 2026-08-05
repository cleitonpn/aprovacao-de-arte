// De onde o simulador tira os pixels.
//
// O simulador de distância mostra um trecho da arte no tamanho real. Para isso
// ele precisa de um pedaço da imagem — e "a imagem" é uma coisa diferente em
// cada formato:
//
// - JPG e PNG já estão rasterizados: o pedaço se recorta na hora, de graça.
// - PDF não tem pixel nenhum até alguém rasterizar. E rasterizar a página
//   inteira na resolução da arte é inviável (uma lona de 275 cm a 100 dpi dá
//   10.800 px de largura). O recorte tem que acontecer ANTES da rasterização.
//
// Era exatamente por causa dessa diferença que o simulador não aparecia em
// PDF: a tela pedia `medidas.bitmap`, que só existia no caminho do JPG. Como
// PDF é o formato normal em grande formato, na prática o recurso estava
// desligado para quase todo mundo — e a caixa simplesmente não desenhava, sem
// erro nenhum na tela.
//
// Aqui as duas fontes ganham a mesma cara. Quem desenha pede um retângulo em
// "pixels efetivos da arte" e recebe um canvas, sem saber de onde veio.

// Teto absoluto do recorte, em pixels de lado. Acima disto o canvas passa a
// custar memória séria em celular (4096² em RGBA são 64 MB) e o ganho é
// invisível: a saída tem 300 px de lado. Quem chama pede um teto menor quando
// sabe que menos resolve — o padrão é o suficiente para a maioria.
const LADO_MAXIMO = 4096
const TETO_PADRAO = 1024

/**
 * Fonte de um arquivo já rasterizado (JPG, PNG).
 * @param {ImageBitmap|HTMLCanvasElement} imagem
 */
export const fonteDeBitmap = (imagem, largura, altura) => ({
  tipo: 'bitmap', imagem, largura, altura,
})

/**
 * Fonte de um PDF: guarda o documento aberto e a largura da página em pontos,
 * que é o que permite converter "pixel efetivo da arte" em escala de render.
 */
export const fonteDePdf = (doc, larguraPt, largura, altura, pagina = 1) => ({
  tipo: 'pdf', doc, larguraPt, largura, altura, pagina,
})

/**
 * Recorta um retângulo da arte.
 *
 * As coordenadas são sempre em pixels efetivos — o mesmo sistema de
 * `medidas.larguraPx`/`alturaPx` —, independentemente de a origem ser um
 * bitmap ou um PDF.
 *
 * O corte de resolução nunca atrapalha o que o simulador serve para mostrar:
 * ele só entra em distâncias grandes, onde o recorte cobre mais de um metro de
 * peça e acaba espremido em 300 px de tela de qualquer forma. Nas distâncias
 * curtas — onde se julga a granulação — o trecho é de poucos centímetros e
 * cabe inteiro na resolução real.
 *
 * @returns {Promise<{canvas: HTMLCanvasElement, escala: number}>} `escala` é
 *   quanto o recorte foi reduzido para caber no teto (1 = resolução cheia).
 */
export async function recortar(fonte, { x, y, largura, altura, teto = TETO_PADRAO }) {
  if (!fonte) return null

  const lado = Math.max(1, Math.round(largura))
  const ladoY = Math.max(1, Math.round(altura))
  const limite = Math.min(LADO_MAXIMO, Math.max(64, Math.round(teto)))
  const escala = Math.min(1, limite / Math.max(lado, ladoY))
  const destinoX = Math.max(1, Math.round(lado * escala))
  const destinoY = Math.max(1, Math.round(ladoY * escala))

  if (fonte.tipo === 'pdf') {
    const { renderizarRecorte } = await import('./pdf.js')
    // Escala de render = quantos pixels efetivos há por ponto da página. Como
    // `fonte.largura` já vem calculada no tamanho FINAL da peça, a escala de
    // trabalho do arquivo (1:2, 1:10) já está embutida — não entra de novo.
    const escalaRender = (fonte.largura / fonte.larguraPt) * escala
    const canvas = await renderizarRecorte(fonte.doc, fonte.pagina, {
      escala: escalaRender,
      sx: x * escala,
      sy: y * escala,
      largura: destinoX,
      altura: destinoY,
    })
    return { canvas, escala }
  }

  const canvas = document.createElement('canvas')
  canvas.width = destinoX
  canvas.height = destinoY
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fonte.imagem, x, y, lado, ladoY, 0, 0, destinoX, destinoY)
  return { canvas, escala }
}
