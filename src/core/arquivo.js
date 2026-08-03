// Leitura de metadados direto dos bytes do arquivo.
//
// Nada aqui confia na extensão do arquivo: cliente renomeia .png para .jpg,
// exporta .ai que na verdade é PDF, manda .pdf que é só um JPG embrulhado.
// A assinatura binária é a única fonte confiável.

export async function sha256(arrayBuffer) {
  if (!globalThis.crypto?.subtle) return null
  const hash = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function extensao(nome = '') {
  const m = /\.([a-z0-9]+)$/i.exec(nome.trim())
  return m ? m[1].toLowerCase() : ''
}

/** Identifica o formato real pela assinatura dos primeiros bytes. */
export function detectarFormato(buffer) {
  const b = new Uint8Array(buffer)
  const casa = (offset, ...bytes) => bytes.every((v, i) => b[offset + i] === v)

  if (casa(0, 0xff, 0xd8, 0xff)) return 'jpeg'
  if (casa(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (casa(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf' // %PDF
  if (casa(0, 0x25, 0x21, 0x50, 0x53)) return 'eps' // %!PS
  if (casa(0, 0x49, 0x49, 0x2a, 0x00) || casa(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'tiff'
  if (casa(0, 0x38, 0x42, 0x50, 0x53)) return 'psd' // 8BPS
  if (casa(0, 0x52, 0x49, 0x46, 0x46) && casa(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  if (casa(0, 0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (casa(0, 0x42, 0x4d)) return 'bmp'
  // CorelDRAW: contêiner RIFF com "CDR" em 8..10
  if (casa(0, 0x52, 0x49, 0x46, 0x46) && casa(8, 0x43, 0x44, 0x52)) return 'cdr'
  // .cdr recente é um ZIP
  if (casa(0, 0x50, 0x4b, 0x03, 0x04)) return 'zip'
  const inicio = new TextDecoder('latin1').decode(b.subarray(0, 400))
  if (/^\s*<(\?xml|svg)/i.test(inicio)) return 'svg'
  return 'desconhecido'
}

/**
 * Metadados de JPEG lidos dos marcadores: dimensão, nº de componentes
 * (3 = RGB/YCbCr, 4 = CMYK), perfil ICC, densidade declarada e uma
 * estimativa de qualidade a partir da tabela de quantização.
 */
export function lerJpeg(buffer) {
  const b = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  const info = {
    largura: 0, altura: 0, componentes: 0, progressivo: false,
    temICC: false, adobe: false, transformAdobe: null,
    densidade: null, unidadeDensidade: null, qualidade: null,
  }
  const tabelasQuant = []
  let i = 2

  while (i < b.length - 1) {
    if (b[i] !== 0xff) { i++; continue }
    let marcador = b[i + 1]
    if (marcador === 0xff) { i++; continue }
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue }
    if (marcador === 0xda || marcador === 0xd9) break // início dos dados comprimidos
    const tamanho = dv.getUint16(i + 2)
    if (tamanho < 2) break
    const inicio = i + 4
    const fim = i + 2 + tamanho

    // SOF0..SOF15 (menos DHT/JPG/DAC)
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      info.progressivo = marcador === 0xc2 || marcador === 0xc6 || marcador === 0xca || marcador === 0xce
      info.altura = dv.getUint16(inicio + 1)
      info.largura = dv.getUint16(inicio + 3)
      info.componentes = b[inicio + 5]
    } else if (marcador === 0xdb) { // DQT
      let p = inicio
      while (p < fim) {
        const precisao = b[p] >> 4
        const tabela = []
        p += 1
        for (let k = 0; k < 64; k++) {
          tabela.push(precisao ? dv.getUint16(p + k * 2) : b[p + k])
        }
        p += precisao ? 128 : 64
        tabelasQuant.push(tabela)
      }
    } else if (marcador === 0xe0) { // APP0 / JFIF
      const tag = new TextDecoder('latin1').decode(b.subarray(inicio, inicio + 4))
      if (tag === 'JFIF') {
        const unidades = b[inicio + 7]
        const x = dv.getUint16(inicio + 8)
        if (unidades === 1 && x > 0) { info.densidade = x; info.unidadeDensidade = 'dpi' }
        else if (unidades === 2 && x > 0) { info.densidade = Math.round(x * 2.54); info.unidadeDensidade = 'dpi' }
      }
    } else if (marcador === 0xe2) { // APP2 / ICC
      const tag = new TextDecoder('latin1').decode(b.subarray(inicio, inicio + 11))
      if (tag === 'ICC_PROFILE') info.temICC = true
    } else if (marcador === 0xee) { // APP14 / Adobe
      const tag = new TextDecoder('latin1').decode(b.subarray(inicio, inicio + 5))
      if (tag === 'Adobe') { info.adobe = true; info.transformAdobe = b[fim - 1] }
    }
    i = fim
  }

  if (tabelasQuant.length) info.qualidade = estimarQualidadeJpeg(tabelasQuant[0])
  info.cmyk = info.componentes === 4
  return info
}

// Tabela de quantização de luminância do padrão JPEG (Anexo K) a q=50.
const QUANT_BASE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]

/**
 * Estima o parâmetro de qualidade a partir da tabela de quantização.
 * Inverte a fórmula de escala do libjpeg sobre os coeficientes de baixa
 * frequência, que são os que mais pesam na percepção.
 */
function estimarQualidadeJpeg(tabela) {
  let soma = 0
  let n = 0
  for (let k = 0; k < 64; k++) {
    const base = QUANT_BASE[k]
    if (base <= 0) continue
    const escala = (tabela[k] * 100) / base
    soma += escala
    n++
  }
  if (!n) return null
  const escalaMedia = soma / n
  const q = escalaMedia <= 100 ? (200 - escalaMedia) / 2 : 5000 / escalaMedia
  return Math.max(1, Math.min(100, Math.round(q)))
}

/** Metadados de PNG lidos dos chunks: dimensão, tipo de cor, pHYs e ICC. */
export function lerPng(buffer) {
  const b = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  const info = {
    largura: 0, altura: 0, profundidade: 0, tipoCor: 0,
    temICC: false, sRGB: false, densidade: null, entrelacado: false, temAlfa: false,
  }
  let i = 8
  while (i < b.length - 8) {
    const tamanho = dv.getUint32(i)
    const tipo = new TextDecoder('latin1').decode(b.subarray(i + 4, i + 8))
    const dados = i + 8
    if (tipo === 'IHDR') {
      info.largura = dv.getUint32(dados)
      info.altura = dv.getUint32(dados + 4)
      info.profundidade = b[dados + 8]
      info.tipoCor = b[dados + 9]
      info.entrelacado = b[dados + 12] === 1
      info.temAlfa = info.tipoCor === 4 || info.tipoCor === 6
    } else if (tipo === 'pHYs') {
      const x = dv.getUint32(dados)
      if (b[dados + 8] === 1 && x > 0) info.densidade = Math.round(x * 0.0254) // px/m -> dpi
    } else if (tipo === 'iCCP') {
      info.temICC = true
    } else if (tipo === 'sRGB') {
      info.sRGB = true
    } else if (tipo === 'IDAT' || tipo === 'IEND') {
      break // metadados relevantes vêm antes dos dados de imagem
    }
    i = dados + tamanho + 4
    if (tamanho < 0 || !Number.isFinite(tamanho)) break
  }
  return info
}

export function formatarBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
