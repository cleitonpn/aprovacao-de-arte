// Ler a imagem embutida de um PDF sem carregá-la inteira na memória.
//
// POR QUE ISTO EXISTE. A conferência de aparência depende de rasterizar a
// página, e o navegador se recusa quando a imagem é grande: uma parede de
// 120 × 320 cm a 300 dpi tem 14.682 × 38.293 px, ou seja 562 megapixels e
// ~2,25 GB descomprimidos em CMYK. O pdf.js devolve página em branco ou lança;
// nos dois casos a ferramenta ficava sem ver a arte.
//
// E o caso não é exótico: 300 dpi numa peça grande dá exatamente isso. Era a
// arte BEM feita, na peça que mais custa reimprimir, a que não era conferida.
//
// A saída é não pedir a imagem inteira. Os dados da imagem são um fluxo
// comprimido de linhas; dá para descomprimir em pedaços, guardar uma linha a
// cada N e uma coluna a cada N, e terminar com uma amostra de poucos megapixels
// que serve para medir nitidez. A memória fica em megabytes e nada precisa
// existir inteiro em lugar nenhum.
//
// LIMITES DELIBERADOS. Isto não é um leitor de PDF. Ele atende o caso que a
// operação de fato manda — uma imagem só, ocupando a página — e desiste em
// qualquer outro: várias imagens, filtro que não seja Flate ou JPEG, objeto
// dentro de fluxo de objetos, componentes de cor que não dê para determinar.
// Desistir é seguro: quem chama volta ao comportamento de hoje, e a arte cai na
// fila de conferência humana.

// `/Subtype` em bytes. A busca é feita no binário e não numa string.
//
// Decodificar o PDF inteiro para texto custa o dobro do arquivo em memória —
// numa arte de 145 MB seriam ~290 MB de string, num celular que já está
// segurando o arquivo. Aqui só a janela em volta de cada ocorrência é
// decodificada, e ela tem alguns quilobytes.
const MARCA = [0x2f, 0x53, 0x75, 0x62, 0x74, 0x79, 0x70, 0x65] // "/Subtype"
const JANELA_ANTES = 4096
const JANELA_DEPOIS = 512

function* ocorrencias(bytes) {
  const [primeiro, ...resto] = MARCA
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== primeiro) continue
    let bate = true
    for (let j = 0; j < resto.length; j++) {
      if (bytes[i + 1 + j] !== resto[j]) { bate = false; break }
    }
    if (bate) yield i
  }
}

/** Lê `/Chave 123` de um pedaço de dicionário. */
function inteiro(dicionario, chave) {
  const m = new RegExp(`/${chave}\\s+(\\d+)`).exec(dicionario)
  return m ? Number(m[1]) : null
}

/** Lê `/Chave /Nome` ou `/Chave [ ... ]`. */
function nome(dicionario, chave) {
  const m = new RegExp(`/${chave}\\s*(/[A-Za-z0-9]+|\\[[^\\]]*\\])`).exec(dicionario)
  return m ? m[1].trim() : null
}

/** Quantos componentes de cor por pixel. `null` quando não dá para saber. */
function componentes(dicionario) {
  // `/DecodeParms /Colors` é a resposta direta quando existe — e existe
  // justamente nos arquivos grandes, que são os que interessam aqui.
  const cores = inteiro(dicionario, 'Colors')
  if (cores) return cores

  const cs = nome(dicionario, 'ColorSpace') || ''
  if (/DeviceCMYK/.test(cs)) return 4
  if (/DeviceRGB/.test(cs)) return 3
  if (/DeviceGray|CalGray/.test(cs)) return 1
  // ICCBased e paletas apontam para outro objeto. Adivinhar aqui é como se
  // produz uma imagem deslocada meio pixel a cada linha — melhor não medir do
  // que medir errado.
  return null
}

/**
 * Acha a imagem principal e devolve o fluxo comprimido dela.
 *
 * Escolhe a MAIOR em pixels quando há mais de uma: é a que ocupa a peça, e as
 * outras costumam ser logo, selo ou máscara.
 */
export function acharImagemNoPdf(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  // latin1 preserva byte a byte: o dicionário é ASCII, e o corpo binário que
  // vier junto não é interpretado, só pulado.
  const decodificador = new TextDecoder('latin1')

  let melhor = null
  for (const posicao of ocorrencias(bytes)) {
    const inicioJanela = Math.max(0, posicao - JANELA_ANTES)
    const texto = decodificador.decode(bytes.subarray(inicioJanela, posicao + JANELA_DEPOIS))
    const naJanela = posicao - inicioJanela
    if (!/^\/Subtype\s*\/Image/.test(texto.slice(naJanela))) continue
    const achado = { index: naJanela }
    // Começa no CABEÇALHO DO OBJETO, não no `<<` mais próximo.
    //
    // O `<<` mais próximo costuma ser o de `/DecodeParms`, que é um dicionário
    // aninhado — e ele tem um `/BitsPerComponent` próprio, com outro
    // significado. Lendo a partir dali, um arquivo real de 8 bits era lido como
    // 4 e descartado em silêncio. As chaves de fora precisam vir primeiro para
    // vencer as de dentro na busca.
    const inicioObj = texto.lastIndexOf(' obj', achado.index)
    const inicioFluxo = texto.indexOf('stream', achado.index)
    if (inicioObj < 0 || inicioFluxo < 0) continue

    const dicionario = texto.slice(inicioObj, inicioFluxo)
    const largura = inteiro(dicionario, 'Width')
    const altura = inteiro(dicionario, 'Height')
    if (!largura || !altura) continue

    const filtro = nome(dicionario, 'Filter') || ''
    const tipo = /FlateDecode/.test(filtro) ? 'flate' : (/DCTDecode/.test(filtro) ? 'jpeg' : null)
    // Um filtro em cadeia (`[/FlateDecode /DCTDecode]`) precisa ser desfeito em
    // ordem, e não vale a complexidade: é raro em arte de grande formato.
    if (!tipo || /\].*\//.test(filtro.replace(/\s/g, ''))) continue

    const cores = tipo === 'jpeg' ? 3 : componentes(dicionario)
    if (!cores) continue

    const bpc = inteiro(dicionario, 'BitsPerComponent') || 8
    if (tipo === 'flate' && bpc !== 8) continue

    const predictor = inteiro(dicionario, 'Predictor') || 1
    // Predictor TIFF (2) desfaz na horizontal, e não na vertical como o do PNG.
    // Não implementado por ser raro; desistir é melhor que ler embaralhado.
    if (predictor !== 1 && predictor < 10) continue

    // Pula o EOL que a especificação exige depois de `stream`.
    let corpo = inicioFluxo + 'stream'.length
    if (texto[corpo] === '\r') corpo += 1
    if (texto[corpo] === '\n') corpo += 1
    const corpoNoArquivo = inicioJanela + corpo

    let tamanho = inteiro(dicionario, 'Length')
    // `/Length 12 0 R` é referência indireta. Achar o `endstream` é mais barato
    // do que resolver a referência, e não depende da tabela de objetos.
    if (!tamanho || /\/Length\s+\d+\s+\d+\s+R/.test(dicionario)) {
      // Sem o `/Length` direto, o fim é onde `endstream` aparece — e ele pode
      // estar muito além da janela, então a procura é feita no binário.
      const fim = procurarEndstream(bytes, corpoNoArquivo)
      if (fim < 0) continue
      tamanho = fim - corpoNoArquivo
    }

    const pixels = largura * altura
    if (!melhor || pixels > melhor.largura * melhor.altura) {
      melhor = {
        tipo,
        largura,
        altura,
        cores,
        bpc,
        predictor,
        // CÓPIA, não fatia. O pdf.js transfere o buffer do arquivo para o
        // worker dele e o desanexa; uma fatia apontaria para memória que deixou
        // de existir, e o erro só aparece na hora de descomprimir.
        bytes: bytes.slice(corpoNoArquivo, corpoNoArquivo + tamanho),
      }
    }
  }

  return melhor
}

/** Onde termina o fluxo, procurando no binário. */
function procurarEndstream(bytes, de) {
  const alvo = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d] // "endstream"
  for (let i = de; i < bytes.length - alvo.length; i++) {
    if (bytes[i] !== alvo[0]) continue
    let bate = true
    for (let j = 1; j < alvo.length; j++) {
      if (bytes[i + j] !== alvo[j]) { bate = false; break }
    }
    if (bate) return i
  }
  return -1
}

/** CMYK/RGB/cinza → luminância 0-255, na convenção do PDF (0 = sem tinta). */
function paraCinzaPixel(amostra, cores) {
  if (cores === 1) return amostra[0]
  if (cores === 3) return 0.299 * amostra[0] + 0.587 * amostra[1] + 0.114 * amostra[2]
  if (cores === 4) {
    const k = amostra[3] / 255
    const r = 255 * (1 - amostra[0] / 255) * (1 - k)
    const g = 255 * (1 - amostra[1] / 255) * (1 - k)
    const b = 255 * (1 - amostra[2] / 255) * (1 - k)
    return 0.299 * r + 0.587 * g + 0.114 * b
  }
  return amostra[0]
}

/**
 * Descomprime a imagem em fluxo e devolve uma amostra em tons de cinza.
 *
 * Nunca materializa a imagem inteira: lê os bytes conforme saem do
 * descompressor, monta uma linha por vez e guarda só as linhas e colunas
 * sorteadas. Uma arte de 2,25 GB vira uma amostra de poucos megabytes.
 *
 * `DecompressionStream` é nativo do navegador e do Node — não entra biblioteca
 * nova no pacote que o cliente baixa, o que importa numa página aberta no
 * celular, no saguão da feira.
 */
export async function amostrarImagemFlate(imagem, { larguraAlvo = 1200 } = {}) {
  const { largura, altura, cores, predictor, bytes } = imagem
  const passo = Math.max(1, Math.floor(largura / larguraAlvo))
  const larguraAmostra = Math.ceil(largura / passo)
  const alturaAmostra = Math.ceil(altura / passo)
  // Um byte por pixel, não um float. A amostra de uma parede grande tem uns 15
  // megapixels; em `Float32Array` seriam 60 MB só dela, num celular que já está
  // segurando o arquivo de 145 MB. Luminância cabe em 0-255 sem perder nada que
  // a medida de borda use.
  const cinza = new Uint8Array(larguraAmostra * alturaAmostra)

  const bytesPorLinha = largura * cores
  const comFiltro = predictor >= 10
  const linhaBruta = new Uint8Array(bytesPorLinha)
  const linhaAnterior = new Uint8Array(bytesPorLinha)

  let noBuffer = 0
  let byteDeFiltro = -1
  let linha = 0
  let linhaGravada = 0

  const gravarLinha = () => {
    if (linha % passo === 0 && linhaGravada < alturaAmostra) {
      const base = linhaGravada * larguraAmostra
      for (let i = 0; i < larguraAmostra; i++) {
        const x = Math.min(i * passo, largura - 1) * cores
        cinza[base + i] = paraCinzaPixel(linhaBruta.subarray(x, x + cores), cores)
      }
      linhaGravada += 1
    }
    linha += 1
  }

  // O predictor do PNG: cada linha vem filtrada em relação à anterior, e é
  // preciso desfazer antes de ler pixel. Sem isso a imagem sai como ruído — e
  // ruído mede como "cheio de detalhe", que é o pior erro possível aqui.
  const desfiltrar = () => {
    if (!comFiltro) return
    const bpp = cores
    for (let i = 0; i < bytesPorLinha; i++) {
      const a = i >= bpp ? linhaBruta[i - bpp] : 0
      const b = linhaAnterior[i]
      const c = i >= bpp ? linhaAnterior[i - bpp] : 0
      let v = linhaBruta[i]
      if (byteDeFiltro === 1) v += a
      else if (byteDeFiltro === 2) v += b
      else if (byteDeFiltro === 3) v += (a + b) >> 1
      else if (byteDeFiltro === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      linhaBruta[i] = v & 0xff
    }
  }

  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  const leitor = fluxo.getReader()

  for (;;) {
    const { value, done } = await leitor.read()
    if (done) break
    for (let i = 0; i < value.length && linhaGravada < alturaAmostra; i++) {
      if (comFiltro && byteDeFiltro < 0) {
        byteDeFiltro = value[i]
        continue
      }
      linhaBruta[noBuffer] = value[i]
      noBuffer += 1
      if (noBuffer === bytesPorLinha) {
        desfiltrar()
        gravarLinha()
        linhaAnterior.set(linhaBruta)
        noBuffer = 0
        byteDeFiltro = -1
      }
    }
    if (linhaGravada >= alturaAmostra) {
      await leitor.cancel().catch(() => {})
      break
    }
  }

  // Uma amostra pela metade não é amostra: metade de uma arte pode ser o fundo
  // liso, e medir nitidez ali diria "sem detalhe" sobre um arquivo perfeito.
  if (linhaGravada < alturaAmostra * 0.9) return null

  return { cinza, largura: larguraAmostra, altura: linhaGravada }
}
