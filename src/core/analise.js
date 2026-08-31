// Orquestrador: lê o arquivo, mede, aplica as regras e devolve o laudo.
//
// Roda inteiramente no navegador. O arquivo do cliente nunca sai da máquina
// dele — o que, além de barato, resolve a conversa sobre confidencialidade
// de arte não divulgada antes do evento.

import { sha256, detectarFormato, extensao, lerJpeg, lerPng, formatarBytes } from './arquivo.js'
import { carregarBitmap, amostraReduzida, recortesNativos, fracaoChapada, miniatura, renderVazio, LADO_RECORTE } from './imagem.js'
import { paraCinza, blocagem, conteudoNaMargem, bordaUniforme, estatisticasCor, larguraDeBorda, bordaPorRegiao,
} from './metricas.js'
import { analisarEspectro, classificarDeficit } from './espectro.js'
import { avaliar } from './regras.js'
import { fonteDeBitmap, fonteDePdf } from './recorte.js'

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

/**
 * A arte foi montada reduzida?
 *
 * Compara o tamanho que o ARQUIVO declara com o da peça cadastrada. Uma lona de
 * 275 cm entregue num arquivo de 27,5 cm não é um erro de medida: é o designer
 * trabalhando a 1:10, que é praxe no grande formato.
 *
 * Exportada para poder ser testada — ela decide veredicto, e um falso positivo
 * aqui aprova uma arte que está de fato pequena demais.
 */
export function escalaProvavel(declaradoCm, pecaCm) {
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
  const politica = opcoes.politica || {}
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
    return { medidas, ...avaliar({ peca, perfil, medidas, escalaFator, politica, detectorNitidez }), peca, perfil, escalaFator, politica }
  }

  const medir = async (fator) => {
    if (formato === 'pdf' || formato === 'ai') return medirPdf(buffer, base, peca, perfil, fator, arquivo)

    const meta = formato === 'jpeg' ? lerJpeg(buffer) : lerPng(buffer)
    const r = await medirRaster(arquivo, formato, meta, peca, perfil)
    const declaradoCm = meta.densidade ? (r.largura / meta.densidade) * CM_POR_POL : null
    return {
      ...base,
      formatoSuportado: true,
      larguraPx: r.largura,
      alturaPx: r.altura,
      miniaturaUrl: r.miniaturaUrl,
      // A fonte do simulador de distância. Uniforme entre JPG e PDF de
      // propósito: era a divergência entre os dois que deixava a caixa de
      // zoom sem aparecer em PDF — ou seja, na maioria das artes.
      fonteVisual: fonteDeBitmap(r.bitmap, r.largura, r.altura),
      inflacao: r.inflacao,
      blocagem: r.blocagem,
      margem: r.margem,
      bordaUniforme: r.bordaUniforme,
      chapado: r.chapado,
      cor: r.cor,
      recortes: r.recortes,
      densidadeDeclarada: meta.densidade || null,
      tamanhoDeclaradoCm: declaradoCm ? { largura: declaradoCm, altura: (r.altura / meta.densidade) * CM_POR_POL } : null,
      escalaSugerida: fator === 1 ? escalaProvavel(declaradoCm, peca.larguraCm) : null,
      qualidadeJpeg: formato === 'jpeg' ? meta.qualidade : null,
      cmyk: formato === 'jpeg' ? meta.cmyk : false,
      temICC: meta.temICC,
      temAlfa: formato === 'png' ? meta.temAlfa : false,
      progressivo: formato === 'jpeg' ? meta.progressivo : false,
      profundidade: formato === 'png' ? meta.profundidade : 8,
    }
  }

  let medidas = await medir(escalaFator)

  // A escala que o cliente esqueceu de trocar.
  //
  // Arte em escala é praxe no grande formato: o designer monta a 1:10 a 300
  // dpi, o que dá 30 dpi no tamanho final e está correto. A ferramenta já
  // DETECTAVA isso — `escalaSugerida` é calculada desde sempre — e nunca disse
  // a ninguém: nenhuma tela lia o campo. Um cliente real levou DEZ reprovações
  // seguidas por causa de um seletor que ele não sabia que existia, enquanto a
  // ferramenta sabia a resposta e calava.
  //
  // Agora ela aplica sozinha. Custa uma segunda medição, e só no caso em que a
  // escala estava errada — o que hoje custa dez envios recusados.
  //
  // Aplicar em vez de sugerir é uma escolha: a alternativa é um aviso que o
  // cliente precisa entender e agir, e quem não sabia da existência da escala
  // é exatamente quem não vai saber o que fazer com o aviso. A decisão continua
  // reversível — o seletor está na tela e o laudo diz, com todas as letras,
  // qual escala foi considerada.
  const detectada = escalaFator === 1 ? medidas.escalaSugerida : null
  if (detectada) medidas = await medir(detectada)
  const escalaUsada = detectada || escalaFator

  const resultado = avaliar({ peca, perfil, medidas, escalaFator: escalaUsada, politica, detectorNitidez })
  return {
    medidas,
    ...resultado,
    peca,
    perfil,
    escalaFator: escalaUsada,
    // Só quando a ferramenta mudou por conta própria. É o que a tela usa para
    // contar ao cliente o que aconteceu — silêncio aqui seria trocar um erro
    // silencioso por outro.
    escalaAutomatica: detectada || null,
    politica,
  }
}

// --------------------------------------------------- nitidez real do PDF
//
// A densidade declarada não prediz qualidade. Medido em três arquivos reais
// desta operação: o que o time REPROVOU tinha 216 dpi nominais, e um dos
// aprovados tinha 150. Contar pixel não diz se há detalhe dentro deles.
//
// O que decide é a largura da borda, e ela precisa de resolução para ser
// vista: o borrão do arquivo reprovado mede 1,5 mm impressos, então abaixo de
// uns 35 dpi ele cabe dentro de um pixel e some. Medir numa resolução em que
// o defeito não aparece é pior do que não medir — devolve "está tudo certo"
// justamente nos arquivos que a checagem existe para pegar.

/** dpi da análise, no tamanho impresso. Calibrado com arquivos reais. */
const DPI_ANALISE = 50

// A leitura direta do PDF pode mirar mais alto que o render, e PRECISA.
//
// Medido na parede da CRM Bonus: a 52 dpi toda região dá exatamente 1 pixel de
// borda — o piso da métrica — e nenhuma diferença aparece. A 104 dpi o bloco
// mole se separa do resto por 2,2×. Subamostrar demais apaga justamente a
// evidência que se foi buscar.
const DPI_ANALISE_DIRETA = 100

// O tamanho da região em que a peça é dividida. 10 cm porque um logo ampliado
// tem essa ordem de grandeza numa parede: célula muito maior dilui o defeito na
// média do que está em volta, muito menor mede ruído.
const CELULA_REGIAO_CM = 10
/** Abaixo disto a medida mente para o lado de aprovar. */
const DPI_MINIMO_ANALISE = 35
/** Teto de memória: acima disso o navegador do cliente é que paga a conta. */
const MAX_PIXELS_ANALISE = 40e6

function larguraParaAnalise(larguraCm, alturaCm) {
  if (!(larguraCm > 0) || !(alturaCm > 0)) return null
  const largura = Math.round((larguraCm / CM_POR_POL) * DPI_ANALISE)
  const altura = Math.round((alturaCm / CM_POR_POL) * DPI_ANALISE)
  if (largura * altura > MAX_PIXELS_ANALISE) return null
  return largura
}

function medirNitidez(dadosRGBA, largura, altura, larguraCm) {
  if (!(larguraCm > 0)) return { medido: false, motivo: 'sem_medida' }

  // A resolução OBTIDA, não a pedida: `renderizarPagina` limita a escala em 4,
  // e uma arte montada em 1:10 bate nesse teto. Confiar no valor pedido faria
  // a medida ser lida na escala errada.
  const dpi = largura / (larguraCm / CM_POR_POL)
  if (dpi < DPI_MINIMO_ANALISE) return { medido: false, motivo: 'resolucao_baixa', dpi }

  const cinza = paraCinza(dadosRGBA, largura, altura)
  const borda = larguraDeBorda(cinza, largura, altura)
  if (borda == null) return { medido: false, motivo: 'sem_bordas', dpi }

  return {
    medido: true,
    dpi,
    bordaPx: borda,
    // Em milímetros impressos: é a única forma que não depende da resolução em
    // que medimos, e a única que quer dizer alguma coisa para quem lê.
    bordaMm: (borda / dpi) * 25.4,
  }
}

async function medirPdf(buffer, base, peca, perfil, escalaFator, arquivo = null) {
  // import dinâmico: o pdf.js é pesado e só entra em cena quando é PDF
  const {
    abrirPdf, inspecionarPagina, renderizarPagina, fontesNaoIncorporadas, larguraEmPontos,
  } = await import('./pdf.js')
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

  // UM render, usado para três coisas: detectar que ele falhou, medir a
  // nitidez real e gerar a miniatura. Antes eram dois (400 px na inspeção,
  // 900 px na prévia) e nenhum servia para medir — 900 px numa peça de 120 cm
  // dão 19 dpi, resolução em que TODA arte parece nítida, inclusive a
  // ampliada. Medido: a 19 dpi o arquivo ruim aparece mais nítido que o bom.
  const larguraAnalise = larguraParaAnalise(declaradoLarguraCm, declaradoAlturaCm)
  let miniaturaUrl = null
  let visualIndisponivel = false
  let nitidez = { medido: false, motivo: 'nao_tentado' }
  let regioes = null

  try {
    const { canvas } = await renderizarPagina(doc, 1, larguraAnalise || 900)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // A prévia é opcional; saber que ela FALHOU não é. Diante de uma imagem
    // embutida grande demais o pdf.js não lança erro: devolve a página em
    // branco. O `catch` de antes tratava isso como "sem pré-visualização", e o
    // laudo seguia descrevendo uma arte que a ferramenta nunca abriu.
    visualIndisponivel = renderVazio(data)

    if (!visualIndisponivel) {
      miniaturaUrl = await miniatura(canvas, 900)
      nitidez = medirNitidez(data, canvas.width, canvas.height, declaradoLarguraCm)
    }
  } catch {
    visualIndisponivel = true
  }

  // O NAVEGADOR DESISTIU; a ferramenta ainda não precisa desistir.
  //
  // Quando o render falha é quase sempre pelo mesmo motivo: a imagem embutida é
  // grande demais para o navegador abrir de uma vez. Uma parede de 120 × 320 cm
  // a 300 dpi tem 562 megapixels e ~2,25 GB descomprimidos — e 300 dpi numa
  // peça desse tamanho é o que um designer competente entrega. Ou seja, era a
  // arte BEM FEITA, na peça que mais custa reimprimir, a que ninguém conferia.
  //
  // Aqui a imagem é lida direto do PDF, descomprimida em fluxo e amostrada:
  // nada existe inteiro em lugar nenhum, e sobra uma amostra de poucos
  // megapixels que serve para medir. Não devolve a PRÉVIA — para isso é preciso
  // desenhar a página, com fontes e vetores por cima —, então o cliente
  // continua sem miniatura e a arte continua indo para a conferência humana.
  // O que muda é que a nitidez deixa de ser um vazio.
  if (visualIndisponivel && dpiImagens?.length) {
    try {
      const { acharImagemNoPdf, amostrarImagemFlate } = await import('./imagemPdf.js')
      // Relê do arquivo: o pdf.js já transferiu `buffer` para o worker dele e o
      // desanexou. Guardar uma segunda cópia desde o início custaria outros
      // 145 MB de memória numa arte grande — e só serviria neste caminho, que
      // é a exceção.
      const cru = arquivo ? await arquivo.arrayBuffer() : buffer
      const embutida = acharImagemNoPdf(cru)
      if (embutida?.tipo === 'flate') {
        const alvo = Math.round((declaradoLarguraCm / CM_POR_POL) * DPI_ANALISE_DIRETA)
        const amostra = await amostrarImagemFlate(embutida, { larguraAlvo: alvo })
        if (amostra) {
          const dpi = amostra.largura / (declaradoLarguraCm / CM_POR_POL)
          const borda = larguraDeBorda(amostra.cinza, amostra.largura, amostra.altura)
          nitidez = borda == null
            ? { medido: false, motivo: 'sem_bordas', dpi, direto: true }
            : { medido: true, dpi, direto: true, bordaPx: borda, bordaMm: (borda / dpi) * 25.4 }
          regioes = bordaPorRegiao(amostra.cinza, amostra.largura, amostra.altura, {
            celulaPx: Math.round(dpi * (CELULA_REGIAO_CM / CM_POR_POL)),
          })
        }
      }
    } catch (erro) {
      // Ler o PDF na unha é palpite educado sobre um formato que aceita muita
      // variação. Falhar aqui devolve o comportamento de antes, que já é
      // seguro: a arte vai para a conferência humana.
      console.warn('não foi possível ler a imagem embutida direto do PDF', erro)
    }
  }

  // Página só de vetor pode ser legitimamente clara e uniforme — aí "vazio"
  // não significa falha. O sintoma só vale quando havia raster para aparecer.
  visualIndisponivel = visualIndisponivel && Boolean(dpiImagens?.length)
  // A leitura direta, quando deu certo, vale mais que o render que falhou.
  if (visualIndisponivel && !nitidez.direto) nitidez = { medido: false, motivo: 'render_vazio' }
  // Peça inteiramente vetorial não tem o que medir: vetor não tem resolução.
  if (info.puroVetor) nitidez = { medido: false, motivo: 'vetor' }

  // O documento fica aberto para o simulador recortar depois, na resolução
  // real. Nada disso vai para o Firestore: o laudo gravado é montado campo a
  // campo em `laudoJson`, e este não está na lista.
  const larguraPt = await larguraEmPontos(doc, 1)
  // Sem render não há recorte: oferecer o simulador aqui desenhava dois
  // quadrados brancos legendados com dpi, o que é pior que não oferecer nada.
  const fonteVisual = larguraPx && larguraPt && !visualIndisponivel
    ? fonteDePdf(doc, larguraPt, larguraPx, alturaPx)
    : null

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
    fonteVisual,
    visualIndisponivel,
    nitidez,
    // A borda medida região a região. Fica no laudo técnico e no painel, e por
    // enquanto NÃO decide veredicto — ver a nota em `regras.js`.
    nitidezRegioes: regioes,
    tamanhoDeclaradoCm: { largura: declaradoLarguraCm, altura: declaradoAlturaCm },
    escalaSugerida: escalaFator === 1 ? escalaProvavel(info.larguraMm / 10, peca.larguraCm) : null,
    cmyk: false,
    temICC: null,
    temAlfa: false,
  }
}
