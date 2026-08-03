// Orquestrador: lê o arquivo, mede, aplica as regras e devolve o laudo.
//
// Roda inteiramente no navegador. O arquivo do cliente nunca sai da máquina
// dele — o que, além de barato, resolve a conversa sobre confidencialidade
// de arte não divulgada antes do evento.

import { sha256, detectarFormato, extensao, lerJpeg, lerPng, formatarBytes } from './arquivo.js'
import { carregarBitmap, amostraReduzida, recortesNativos, fracaoChapada, miniatura, LADO_RECORTE } from './imagem.js'
import { paraCinza, blocagem, conteudoNaMargem, bordaUniforme, estatisticasCor } from './metricas.js'
import { analisarEspectro, classificarDeficit } from './espectro.js'
import { avaliar } from './regras.js'

const CM_POR_POL = 2.54

const ROTULO_FORMATO = {
  cdr: 'CorelDRAW (.cdr)', psd: 'Photoshop (.psd)', tiff: 'TIFF', eps: 'EPS',
  svg: 'SVG', webp: 'WebP', gif: 'GIF', bmp: 'BMP', zip: 'compactado',
  desconhecido: 'deste tipo',
}

const mediana = (v) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Espectro sobre vários recortes nativos. A mediana de cada grandeza evita
 * que um trecho atípico — um céu chapado, uma faixa de texto — decida
 * sozinho o resultado da imagem inteira.
 */
function analisarRecortes(recortes) {
  const medidas = recortes
    .map((r) => analisarEspectro(r.cinza, r.lado))
    .filter(Boolean)

  if (!medidas.length) return { detalheReal: true, confiavel: false, quedaDb: null, amostras: 0 }

  const c = classificarDeficit({
    fCorte: mediana(medidas.map((m) => m.fCorte)),
    quedaDb: mediana(medidas.map((m) => m.quedaDb)),
    ganho: mediana(medidas.map((m) => m.ganho)),
    alfa: mediana(medidas.map((m) => m.alfa)),
  })
  return { ...c, amostras: medidas.length }
}

function escalaProvavel(declaradoCm, pecaCm) {
  if (!declaradoCm || declaradoCm <= 0 || !pecaCm || pecaCm <= 0) return null
  const razao = pecaCm / declaradoCm
  for (const f of [10, 4, 2]) {
    if (Math.abs(razao - f) / f < 0.06) return f
  }
  return null
}

async function medirRaster(blob, formato, meta, peca, perfil) {
  const bitmap = await carregarBitmap(blob)
  const largura = bitmap.width
  const altura = bitmap.height
  if (!largura || !altura) throw new Error('A imagem foi lida com dimensões vazias.')

  const amostra = amostraReduzida(bitmap)
  const cinzaAmostra = paraCinza(amostra.dados.data, amostra.largura, amostra.altura)

  // faixa de margem convertida para pixels da AMOSTRA
  const pxPorCmAmostra = amostra.largura / peca.larguraCm
  const faixaX = ((perfil.margemMm || 0) / 10) * pxPorCmAmostra
  const faixaY = ((perfil.margemMm || 0) / 10) * (amostra.altura / peca.alturaCm)

  const recortes = recortesNativos(bitmap, amostra, 3, LADO_RECORTE)
  const inflacao = analisarRecortes(recortes)

  // blocagem em pixel nativo — na amostra reduzida a grade 8×8 desaparece
  const blocagens = recortes.map((r) => blocagem(r.cinza, r.lado, r.lado))
  const cor = estatisticasCor(amostra.dados.data)

  return {
    bitmap,
    largura,
    altura,
    miniaturaUrl: await miniatura(bitmap),
    inflacao,
    blocagem: blocagens.length ? mediana(blocagens) : null,
    margem: conteudoNaMargem(cinzaAmostra, amostra.largura, amostra.altura, faixaX, faixaY),
    bordaUniforme: bordaUniforme(cinzaAmostra, amostra.largura, amostra.altura, Math.max(2, Math.round(faixaX / 3))),
    chapado: fracaoChapada(amostra),
    cor,
    recortes: recortes.map(({ x, y, lado }) => ({ x, y, lado })),
  }
}

/**
 * @param {File|Blob} arquivo
 * @param {{larguraCm:number, alturaCm:number}} peca dimensões REAIS da peça
 * @param {object} perfil regra do tipo de peça
 * @param {{escalaFator?:number}} opcoes
 */
export async function analisar(arquivo, peca, perfil, opcoes = {}) {
  const escalaFator = opcoes.escalaFator || 1
  const dpiMinimoGlobal = opcoes.dpiMinimoGlobal
  const detectorNitidez = opcoes.detectorNitidez === true
  const buffer = await arquivo.arrayBuffer()
  const formatoReal = detectarFormato(buffer)
  const ext = extensao(arquivo.name || '')
  // .ai é, na esmagadora maioria dos casos, um PDF por dentro
  const formato = formatoReal === 'pdf' && ext === 'ai' ? 'ai' : formatoReal

  const base = {
    arquivo: {
      nome: arquivo.name || 'arte',
      tamanho: arquivo.size,
      tamanhoRotulo: formatarBytes(arquivo.size),
      hash: await sha256(buffer),
      extensao: ext,
    },
    formato,
    formatoRotulo: ROTULO_FORMATO[formato] || formato?.toUpperCase(),
    analisadoEm: new Date().toISOString(),
  }

  if (formato !== 'jpeg' && formato !== 'png' && formato !== 'pdf' && formato !== 'ai') {
    const medidas = { ...base, formatoSuportado: false }
    return { medidas, ...avaliar({ peca, perfil, medidas, escalaFator, dpiMinimoGlobal, detectorNitidez }), peca, perfil, escalaFator, dpiMinimoGlobal }
  }

  let medidas
  if (formato === 'pdf' || formato === 'ai') {
    medidas = await medirPdf(buffer, base, peca, perfil, escalaFator)
  } else {
    const meta = formato === 'jpeg' ? lerJpeg(buffer) : lerPng(buffer)
    const r = await medirRaster(arquivo, formato, meta, peca, perfil)
    const declaradoCm = meta.densidade ? (r.largura / meta.densidade) * CM_POR_POL : null
    medidas = {
      ...base,
      formatoSuportado: true,
      larguraPx: r.largura,
      alturaPx: r.altura,
      miniaturaUrl: r.miniaturaUrl,
      bitmap: r.bitmap,
      inflacao: r.inflacao,
      blocagem: r.blocagem,
      margem: r.margem,
      bordaUniforme: r.bordaUniforme,
      chapado: r.chapado,
      cor: r.cor,
      recortes: r.recortes,
      densidadeDeclarada: meta.densidade || null,
      tamanhoDeclaradoCm: declaradoCm ? { largura: declaradoCm, altura: (r.altura / meta.densidade) * CM_POR_POL } : null,
      escalaSugerida: escalaFator === 1 ? escalaProvavel(declaradoCm, peca.larguraCm) : null,
      qualidadeJpeg: formato === 'jpeg' ? meta.qualidade : null,
      cmyk: formato === 'jpeg' ? meta.cmyk : false,
      temICC: meta.temICC,
      temAlfa: formato === 'png' ? meta.temAlfa : false,
      progressivo: formato === 'jpeg' ? meta.progressivo : false,
      profundidade: formato === 'png' ? meta.profundidade : 8,
    }
  }

  const resultado = avaliar({ peca, perfil, medidas, escalaFator, dpiMinimoGlobal, detectorNitidez })
  return { medidas, ...resultado, peca, perfil, escalaFator, dpiMinimoGlobal }
}

async function medirPdf(buffer, base, peca, perfil, escalaFator) {
  // import dinâmico: o pdf.js é pesado e só entra em cena quando é PDF
  const { abrirPdf, inspecionarPagina, renderizarPagina, fontesNaoIncorporadas } = await import('./pdf.js')
  const doc = await abrirPdf(buffer)
  const info = await inspecionarPagina(doc, 1)
  const fontesFaltando = await fontesNaoIncorporadas(doc, 1)

  const declaradoLarguraCm = (info.larguraMm / 10) * escalaFator
  const declaradoAlturaCm = (info.alturaMm / 10) * escalaFator

  let larguraPx
  let alturaPx
  let dpiImagens = null

  if (info.puroVetor) {
    larguraPx = null
    alturaPx = null
  } else if (info.imagemPrincipal) {
    // DPI da imagem embutida no tamanho FINAL: a escala de trabalho divide.
    const dpiFinalH = info.imagemPrincipal.dpi / escalaFator
    const dpiFinalV = info.imagemPrincipal.dpiV / escalaFator
    larguraPx = Math.round((dpiFinalH * peca.larguraCm) / CM_POR_POL)
    alturaPx = Math.round((dpiFinalV * peca.alturaCm) / CM_POR_POL)
    dpiImagens = info.imagens.map((im) => ({
      dpi: im.dpi / escalaFator,
      px: im.px,
      py: im.py,
      larguraCm: (im.larguraMm / 10) * escalaFator,
    }))
  }

  let miniaturaUrl = null
  try {
    const { canvas } = await renderizarPagina(doc, 1, 900)
    miniaturaUrl = canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    /* pré-visualização é opcional */
  }

  return {
    ...base,
    formatoSuportado: true,
    paginas: doc.numPages,
    puroVetor: info.puroVetor,
    temVetor: info.temVetor,
    temTexto: info.temTexto,
    temTransparencia: info.temTransparencia,
    fontesFaltando,
    fracaoRaster: info.fracaoRaster,
    dpiImagens,
    larguraPx,
    alturaPx,
    miniaturaUrl,
    tamanhoDeclaradoCm: { largura: declaradoLarguraCm, altura: declaradoAlturaCm },
    escalaSugerida: escalaFator === 1 ? escalaProvavel(info.larguraMm / 10, peca.larguraCm) : null,
    cmyk: false,
    temICC: null,
    temAlfa: false,
  }
}
