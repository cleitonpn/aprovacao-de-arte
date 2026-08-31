import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { acharImagemNoPdf, amostrarImagemFlate } from '../src/core/imagemPdf.js'

// Ler a imagem embutida sem carregá-la inteira.
//
// O caso que forçou isto: uma parede de 120 × 320 cm a 300 dpi tem 14.682 ×
// 38.293 px — 562 megapixels, ~2,25 GB descomprimidos em CMYK. Nenhum
// navegador abre, e a arte seguia para a impressora sem ninguém ter visto como
// ela é. Era a arte BEM feita, na peça que mais custa reimprimir.
//
// Estes testes montam PDFs de mentira, byte a byte, porque o que precisa ser
// travado é o PARSER: ele lê dicionário cru, e cada engano dele é silencioso —
// devolve pixels embaralhados, e ruído mede como "cheio de detalhe", que é o
// pior erro possível numa ferramenta que existe para achar falta de detalhe.

/** Monta um PDF mínimo com uma imagem Flate. */
function pdfComImagem({ largura, altura, cores = 4, extras = '', dados }) {
  const fluxo = deflateSync(Buffer.from(dados))
  const cabecalho = `%PDF-1.4\n1 0 obj<</Type/XObject/Subtype/Image/Width ${largura}`
    + `/Height ${altura}/BitsPerComponent 8/Filter/FlateDecode`
    + `/DecodeParms<</Colors ${cores}/Columns ${largura}>>${extras}`
    + `/Length ${fluxo.length}>>stream\n`
  const rodape = '\nendstream endobj\n%%EOF'
  const buf = Buffer.concat([Buffer.from(cabecalho, 'latin1'), fluxo, Buffer.from(rodape, 'latin1')])
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
}

/** Uma imagem CMYK com metade clara e metade escura — uma borda vertical nítida. */
function metadeEMetade(largura, altura, cores = 4) {
  const d = new Uint8Array(largura * altura * cores)
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * cores
      // No PDF, DeviceCMYK conta TINTA: 0 é papel, 255 é chapado.
      const tinta = x < largura / 2 ? 0 : 255
      d[i + (cores - 1)] = tinta
    }
  }
  return d
}

test('acha a imagem e lê a geometria certa', () => {
  const buffer = pdfComImagem({ largura: 40, altura: 20, dados: metadeEMetade(40, 20) })
  const img = acharImagemNoPdf(buffer)
  assert.equal(img.largura, 40)
  assert.equal(img.altura, 20)
  assert.equal(img.cores, 4)
  assert.equal(img.bpc, 8)
  assert.equal(img.tipo, 'flate')
})

test('o BitsPerComponent de DENTRO de DecodeParms não vence o de fora', () => {
  // Este erro custou a primeira versão inteira. `/DecodeParms` é um dicionário
  // aninhado com um `/BitsPerComponent` próprio, de outro significado; lendo a
  // partir do `<<` mais próximo, um arquivo real de 8 bits era lido como 4 e
  // descartado em silêncio — a ferramenta dizia "não consigo abrir" sobre um
  // arquivo que ela sabia ler.
  const buffer = pdfComImagem({
    largura: 40,
    altura: 20,
    extras: '',
    dados: metadeEMetade(40, 20),
  })
  const texto = new TextDecoder('latin1').decode(new Uint8Array(buffer))
  assert.match(texto, /DecodeParms/, 'o teste só vale se o dicionário aninhado existir')
  assert.equal(acharImagemNoPdf(buffer).bpc, 8)
})

test('descomprime em fluxo e devolve a amostra em cinza', async () => {
  const buffer = pdfComImagem({ largura: 40, altura: 20, dados: metadeEMetade(40, 20) })
  const am = await amostrarImagemFlate(acharImagemNoPdf(buffer), { larguraAlvo: 40 })
  assert.equal(am.largura, 40)
  assert.equal(am.altura, 20)
  // Metade clara, metade escura — e na convenção certa: sem tinta é claro.
  assert.ok(am.cinza[0] > 200, `esquerda deveria ser clara, veio ${am.cinza[0]}`)
  assert.ok(am.cinza[39] < 60, `direita deveria ser escura, veio ${am.cinza[39]}`)
})

test('a subamostragem reduz sem perder a borda', async () => {
  const am = await amostrarImagemFlate(
    acharImagemNoPdf(pdfComImagem({ largura: 400, altura: 200, dados: metadeEMetade(400, 200) })),
    { larguraAlvo: 100 },
  )
  assert.equal(am.largura, 100)
  assert.ok(am.cinza[0] > 200 && am.cinza[99] < 60)
})

test('imagem em cinza e em RGB também são lidas', async () => {
  for (const cores of [1, 3]) {
    const buffer = pdfComImagem({ largura: 20, altura: 10, cores, dados: metadeEMetade(20, 10, cores) })
    const img = acharImagemNoPdf(buffer)
    assert.equal(img.cores, cores)
    const am = await amostrarImagemFlate(img, { larguraAlvo: 20 })
    assert.ok(am, `${cores} cores deveria amostrar`)
  }
})

test('desiste quando não dá para saber os componentes de cor', () => {
  // ICCBased aponta para outro objeto. Adivinhar produziria uma imagem
  // deslocada alguns bytes a cada linha — ruído puro, que mede como detalhe.
  const fluxo = deflateSync(Buffer.from(new Uint8Array(100)))
  const t = `%PDF-1.4\n1 0 obj<</Type/XObject/Subtype/Image/Width 10/Height 10`
    + `/BitsPerComponent 8/ColorSpace 5 0 R/Filter/FlateDecode/Length ${fluxo.length}>>stream\n`
  const buf = Buffer.concat([Buffer.from(t, 'latin1'), fluxo, Buffer.from('\nendstream endobj', 'latin1')])
  assert.equal(acharImagemNoPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), null)
})

test('desiste de predictor TIFF em vez de ler embaralhado', () => {
  const buffer = pdfComImagem({
    largura: 40, altura: 20, extras: '/Intent/RelativeColorimetric',
    dados: metadeEMetade(40, 20),
  })
  const texto = new TextDecoder('latin1').decode(new Uint8Array(buffer))
  // Injeta um Predictor 2 (TIFF) no dicionário, que não é implementado.
  const comTiff = texto.replace('/Columns 40', '/Columns 40/Predictor 2')
  const bytes = Uint8Array.from(comTiff, (c) => c.charCodeAt(0) & 0xff)
  assert.equal(acharImagemNoPdf(bytes.buffer), null)
})

test('PDF sem imagem nenhuma devolve null, sem explodir', () => {
  const t = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Page>>endobj\n%%EOF', 'latin1')
  assert.equal(acharImagemNoPdf(t.buffer.slice(t.byteOffset, t.byteOffset + t.length)), null)
})

test('entre duas imagens, fica com a maior', () => {
  // A grande é a arte; as pequenas costumam ser logo, selo ou máscara — e medir
  // nitidez num selo de 2 cm não diz nada sobre a peça.
  const pequena = pdfComImagem({ largura: 10, altura: 10, dados: metadeEMetade(10, 10) })
  const grande = pdfComImagem({ largura: 80, altura: 40, dados: metadeEMetade(80, 40) })
  const a = new Uint8Array(pequena)
  const b = new Uint8Array(grande)
  const junto = new Uint8Array(a.length + b.length)
  junto.set(a)
  junto.set(b, a.length)
  assert.equal(acharImagemNoPdf(junto.buffer).largura, 80)
})

test('fluxo truncado não vira amostra pela metade', async () => {
  // Metade de uma arte pode ser o fundo liso, e medir nitidez ali diria "sem
  // detalhe" sobre um arquivo perfeito. Melhor não medir.
  const buffer = pdfComImagem({ largura: 40, altura: 200, dados: metadeEMetade(40, 200) })
  const img = acharImagemNoPdf(buffer)
  img.bytes = img.bytes.subarray(0, Math.floor(img.bytes.length / 3))
  const am = await amostrarImagemFlate(img, { larguraAlvo: 40 }).catch(() => null)
  assert.equal(am, null)
})
