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
import { avaliar, exigencia } from './regras.js'
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
 * As escalas que a ferramenta reconhece sozinha.
 *
 * É a MESMA lista do seletor da tela, e um teste garante que continue sendo:
 * uma escala que o cliente pode escolher à mão e a ferramenta não sabe
 * adivinhar é exatamente o buraco que esta função existe para tapar.
 */
export const ESCALAS = [2, 4, 10]

/** Quanto o arquivo pode desviar do alvo e ainda ser aquela escala. */
const TOLERANCIA_ESCALA = 0.06

/**
 * A arte foi montada reduzida?
 *
 * Compara o tamanho que o ARQUIVO declara com o da peça cadastrada. Uma lona de
 * 275 cm entregue num arquivo de 27,5 cm não é um erro de medida: é o designer
 * trabalhando a 1:10, que é praxe no grande formato.
 *
 * Duas coisas que a primeira versão errava, e que custaram reprovação a quem
 * tinha feito tudo certo:
 *
 * 1. Ela comparava só com o tamanho de CORTE. Mas o cartão da peça manda
 *    montar COM SANGRIA — "Monte o arquivo neste tamanho: 130 × 295 cm" — e o
 *    designer que obedece entrega um arquivo que, na escala certa, bate com
 *    130 × 295 e não com 110 × 275. Num caso real de 110 × 275 com 10 cm de
 *    sangria, o arquivo 1:4 dava 3,75× o corte: fora da tolerância por pouco,
 *    escala não reconhecida, arte reprovada por tamanho. A ferramenta mandava
 *    fazer de um jeito e reprovava quem fizesse. Esta mesma lição já tinha
 *    sido aprendida DUAS vezes em `regras.js` (na proporção e na dimensão);
 *    esta função foi a única que não recebeu o recado.
 *
 * 2. Ela olhava só a LARGURA. Exigir que os dois lados concordem com o mesmo
 *    fator é teste bem mais forte — e aqui isso importa mais do que parece,
 *    porque um falso positivo não dá erro: ele APROVA silenciosamente uma arte
 *    que está de fato pequena demais, e o erro só aparece impresso.
 *
 * Exportada para poder ser testada: ela decide veredicto.
 *
 * @param {{largura:number, altura:number}|null} arquivoCm tamanho declarado
 * @param {{larguraCm:number, alturaCm:number}} peca tamanho de corte
 * @param {number} sangriaCm sangria por lado já exigida desta peça
 */
export function escalaProvavel(arquivoCm, peca, sangriaCm = 0) {
  const l = Number(arquivoCm?.largura)
  const a = Number(arquivoCm?.altura)
  if (!(l > 0) || !(a > 0)) return null
  if (!(peca?.larguraCm > 0) || !(peca?.alturaCm > 0)) return null

  const s = Number(sangriaCm) > 0 ? Number(sangriaCm) : 0
  const alvos = [
    { l: peca.larguraCm, a: peca.alturaCm },
    { l: peca.larguraCm + 2 * s, a: peca.alturaCm + 2 * s },
  ]

  // O pior dos dois lados contra o melhor dos dois alvos: os dois lados
  // precisam bater, mas tanto faz se o arquivo veio no corte ou com sangria.
  const desvioDe = (f) => Math.min(...alvos.map((t) => Math.max(
    Math.abs(l * f - t.l) / t.l,
    Math.abs(a * f - t.a) / t.a,
  )))

  let melhor = null
  for (const f of ESCALAS) {
    const desvio = desvioDe(f)
    if (desvio <= TOLERANCIA_ESCALA && (!melhor || desvio < melhor.desvio)) {
      melhor = { f, desvio }
    }
  }
  return melhor?.f ?? null
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
  // Em que etapa a análise está. Quem escuta é a tela de espera; quem não
  // escuta não paga nada. Os nomes são ETAPAS REAIS, na ordem em que
  // acontecem — inventar uma barra que anda sozinha seria mentir sobre o que
  // está demorando, e o que demora aqui varia muito de arquivo para arquivo.
  const bruto = typeof opcoes.aoAndar === 'function' ? opcoes.aoAndar : () => {}
  // Quanto tempo cada etapa fica visível, no mínimo.
  //
  // Numa testeira de 1,8 MB a análise inteira leva uns 200 ms: as cinco etapas
  // passam antes de o navegador pintar a primeira, e o cliente vê a tela piscar
  // e cuspir um veredicto. Isso não parece rápido — parece que nada foi
  // conferido, e a desconfiança recai justamente sobre o "aprovado".
  //
  // O piso NÃO inventa etapa nem inverte a ordem: cada uma continua sendo
  // anunciada no ponto real em que acontece. O que ele faz é segurar a anterior
  // na tela tempo suficiente para ser lida. O custo é cerca de um segundo e meio
  // no arquivo pequeno, e zero no arquivo grande — ali o trabalho já demora
  // mais que o piso, e nada é somado.
  const piso = Number.isFinite(opcoes.pisoDaEtapaMs) ? opcoes.pisoDaEtapaMs : PISO_DA_ETAPA_MS
  let mostradaEm = 0
  const andar = async (etapa) => {
    const restante = mostradaEm ? piso - (Date.now() - mostradaEm) : 0
    if (restante > 0) await new Promise((pronto) => setTimeout(pronto, restante))
    bruto(etapa)
    mostradaEm = Date.now()
    // Devolve a thread para o navegador pintar a etapa nova ANTES de o trabalho
    // pesado começar. Sem isto o React agenda a pintura e ela só acontece
    // quando tudo já acabou — que é o mesmo que não existir.
    await new Promise((pronto) => setTimeout(pronto, 0))
  }
  /**
   * Fecha a lista de etapas e segura o "Pronto" na tela.
   *
   * Existe como função porque a análise tem DUAS saídas — o formato que não
   * sabemos ler sai cedo — e a primeira versão disto fechava só a saída longa.
   * O efeito no arquivo `.cdr` era a lista parando em "Abrindo a arte" e o
   * resultado tomando a tela por cima dela: exatamente o piscar que este piso
   * existe para acabar, e justo em quem já vai receber uma recusa.
   */
  const encerrar = async () => {
    await andar('pronto')
    if (piso > 0) await new Promise((pronto) => setTimeout(pronto, piso))
  }

  await andar('lendo')
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
  await andar('abrindo')

  if (formato !== 'jpeg' && formato !== 'png' && formato !== 'pdf' && formato !== 'ai') {
    const medidas = { ...base, formatoSuportado: false }
    await encerrar()
    return { medidas, ...avaliar({ peca, perfil, medidas, escalaFator, politica, detectorNitidez }), peca, perfil, escalaFator, politica }
  }

  // Aberto uma vez e reaproveitado. Ver a nota em `medirPdf`: reabrir não é só
  // caro, é impossível — o buffer já foi transferido para o worker.
  let docPdf = null
  const abrirDocPdf = async () => {
    if (!docPdf) {
      const { abrirPdf } = await import('./pdf.js')
      docPdf = await abrirPdf(buffer)
    }
    return docPdf
  }

  /**
   * O tamanho que o arquivo DECLARA, em cm, sem medir nada.
   *
   * No PDF sai do cabeçalho da página; no JPG/PNG, dos pixels e da densidade.
   * Nos dois casos é leitura de metadado — nada é rasterizado, descomprimido
   * nem percorrido. É isso que permite reconhecer a escala antes da medição,
   * em vez de medir, descobrir a escala e medir tudo de novo.
   */
  const tamanhoDeclarado = async () => {
    if (formato === 'pdf' || formato === 'ai') {
      const { tamanhoDaPagina } = await import('./pdf.js')
      const p = await tamanhoDaPagina(await abrirDocPdf(), 1)
      return { largura: p.larguraMm / 10, altura: p.alturaMm / 10 }
    }
    const meta = formato === 'jpeg' ? lerJpeg(buffer) : lerPng(buffer)
    if (!meta?.densidade || !meta.largura || !meta.altura) return null
    return {
      largura: (meta.largura / meta.densidade) * CM_POR_POL,
      altura: (meta.altura / meta.densidade) * CM_POR_POL,
    }
  }

  const medir = async (fator) => {
    if (formato === 'pdf' || formato === 'ai') {
      return medirPdf(await abrirDocPdf(), base, peca, perfil, fator, arquivo)
    }

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
      // A escala não é decidida aqui: ver `escalaDetectada` em `analisar`, que
      // é onde a sangria exigida desta peça é conhecida.
      qualidadeJpeg: formato === 'jpeg' ? meta.qualidade : null,
      cmyk: formato === 'jpeg' ? meta.cmyk : false,
      temICC: meta.temICC,
      temAlfa: formato === 'png' ? meta.temAlfa : false,
      progressivo: formato === 'jpeg' ? meta.progressivo : false,
      profundidade: formato === 'png' ? meta.profundidade : 8,
    }
  }

  // A escala que o cliente esqueceu de trocar.
  //
  // Arte em escala é praxe no grande formato: o designer monta a 1:10 a 300
  // dpi, o que dá 30 dpi no tamanho final e está correto. A ferramenta já
  // DETECTAVA isso desde sempre e nunca disse a ninguém: nenhuma tela lia o
  // campo. Um cliente real levou DEZ reprovações seguidas por causa de um
  // seletor que ele não sabia que existia, enquanto a ferramenta sabia a
  // resposta e calava.
  //
  // Aplicar em vez de sugerir é uma escolha: a alternativa é um aviso que o
  // cliente precisa entender e agir, e quem não sabia da existência da escala
  // é exatamente quem não vai saber o que fazer com o aviso. A decisão continua
  // reversível — o seletor está na tela e o laudo diz, com todas as letras,
  // qual escala foi considerada.
  //
  // A sangria entra na conta porque o cartão da peça manda montar COM ela.
  // Sem isso, o cliente que seguiu a instrução à risca era o que a detecção
  // não reconhecia — e levava a reprovação.
  //
  // A DETECÇÃO VEM ANTES DA MEDIÇÃO, e isso é a diferença entre segundos e
  // minutos. Antes a ferramenta media com a escala errada, descobria a certa
  // no resultado e MEDIA TUDO DE NOVO. A segunda passagem é a cara: a escala
  // multiplica o tamanho impresso, e com ele a resolução do render — num
  // arquivo 1:4 o segundo render tem dezesseis vezes mais pixels que o
  // primeiro. Pior no arquivo pesado, em que o render do navegador falha e a
  // ferramenta cai na leitura direta da imagem embutida: aquele caminho relê o
  // arquivo do disco e descomprime centenas de megabytes, e rodava DUAS vezes.
  //
  // O tamanho declarado não precisa de medição nenhuma para ser lido — está no
  // cabeçalho. Lendo ele primeiro, mede-se uma vez só, já na escala certa.
  const detectada = escalaFator === 1
    ? escalaProvavel(await tamanhoDeclarado(), peca, exigencia(perfil, politica).sangriaMm / 10)
    : null
  const escalaUsada = detectada || escalaFator
  if (detectada) await andar('escala')

  await andar('medindo')
  const medidas = await medir(escalaUsada)

  await andar('decidindo')
  const resultado = avaliar({ peca, perfil, medidas, escalaFator: escalaUsada, politica, detectorNitidez })
  // Fecha a lista com tudo marcado. Sem esta última passagem a etapa final
  // some no mesmo quadro em que aparece, e o passo mais importante — "comparei
  // com o que esta peça exige" — é o único que ninguém chega a ler.
  await encerrar()
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

/**
 * Tempo mínimo de cada etapa na tela.
 *
 * Ver a nota em `analisar`. Exposto como constante para os testes poderem
 * zerá-lo: uma suíte que espera um segundo e meio por análise é uma suíte que
 * as pessoas param de rodar.
 */
export const PISO_DA_ETAPA_MS = 300

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
/**
 * Teto de memória.
 *
 * Cada pixel do render custa 4 bytes no `getImageData`, mais 1 no mapa de
 * cinza. A 40 milhões isso era 200 MB de arrays vivos na thread da interface —
 * e a interface é a mesma que precisa desenhar a tela de espera. Num celular
 * com a página de um stand aberta, é onde ela deixava de responder.
 *
 * 18 milhões cobre a peça grande de verdade desta operação (uma parede de
 * 130 × 295 cm com sangria dá 14,9 MP a 50 dpi) e corta o extremo.
 */
const MAX_PIXELS_ANALISE = 18e6

export function larguraParaAnalise(larguraCm, alturaCm) {
  if (!(larguraCm > 0) || !(alturaCm > 0)) return null
  const largura = Math.round((larguraCm / CM_POR_POL) * DPI_ANALISE)
  const altura = Math.round((alturaCm / CM_POR_POL) * DPI_ANALISE)
  const pixels = largura * altura
  if (pixels <= MAX_PIXELS_ANALISE) return largura

  // Reduz até caber, em vez de desistir.
  //
  // Desistir devolvia `null`, e quem chama caía num render de 900 px — que numa
  // peça de 3 m dá 8 dpi, resolução em que toda arte parece nítida. Ou seja: a
  // peça MAIOR do stand, a que mais custa reimprimir, era exatamente a que
  // ficava sem medida de nitidez. Reduzido proporcionalmente, o que sobra ainda
  // mede; e se cair abaixo de `DPI_MINIMO_ANALISE`, `medirNitidez` recusa a
  // medida pelo motivo certo, em vez de por falta de tentativa.
  return Math.max(1, Math.round(largura * Math.sqrt(MAX_PIXELS_ANALISE / pixels)))
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

/**
 * @param {object} doc documento já aberto — ver `analisar`, que o abre uma vez.
 *
 * Receber o documento em vez do buffer conserta um erro que só aparecia quando
 * a ferramenta detectava escala: o pdf.js TRANSFERE o ArrayBuffer para o worker
 * dele, e o buffer fica destacado no fim da primeira abertura. A segunda
 * medição — a que refaz a conta na escala reconhecida — reabria um buffer
 * morto. Justamente o caminho do cliente que montou a arte em 1:10.
 *
 * De quebra é a maior economia da análise: abrir e rasterizar um PDF de 138 MB
 * duas vezes é o que fazia a página parecer travada.
 */
async function medirPdf(doc, base, peca, perfil, escalaFator, arquivo = null) {
  // import dinâmico: o pdf.js é pesado e só entra em cena quando é PDF
  const {
    inspecionarPagina, renderizarPagina, fontesNaoIncorporadas, larguraEmPontos,
  } = await import('./pdf.js')
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
    // O canvas de análise pode passar de 15 megapixels — 60 MB que o navegador
    // segura enquanto houver referência a ele. A miniatura já foi extraída e a
    // medida já foi feita: zerar as dimensões devolve a memória agora, em vez
    // de na próxima coleta de lixo, que numa análise seguida da outra chega
    // tarde demais.
    canvas.width = 0
    canvas.height = 0
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
      const cru = arquivo ? await arquivo.arrayBuffer() : null
      if (!cru) throw new Error('sem arquivo para reler')
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
    // ATENÇÃO ao ler estes dois num PDF: eles NÃO são as dimensões do arquivo.
    // São uma projeção — quantos pixels ele teria se tivesse o tamanho da peça,
    // na densidade da imagem embutida (ver o cálculo acima). Servem para a
    // conta de resolução, que é a pergunta "o detalhe se sustenta no tamanho
    // impresso?", e para mais nada. Quem quiser a forma do arquivo usa
    // `proporcaoArquivo`, logo abaixo.
    larguraPx,
    alturaPx,
    // A maior imagem de verdade dentro do PDF, em pixels dela mesma. É o que
    // se mostra ao cliente: dizer "2.925 × 2.925 px" sobre um arquivo que não
    // tem essa dimensão é inventar um número que ele não encontra em lugar
    // nenhum se for conferir.
    pixelsDaImagem: info.imagemPrincipal
      ? { largura: info.imagemPrincipal.px, altura: info.imagemPrincipal.py }
      : null,
    // A forma do arquivo, medida onde ela existe de verdade: o tamanho
    // declarado na página. Não muda com a escala de trabalho — 1:10 encolhe os
    // dois lados igualmente — então entra sem o fator.
    proporcaoArquivo: info.alturaMm > 0 ? info.larguraMm / info.alturaMm : null,
    miniaturaUrl,
    fonteVisual,
    visualIndisponivel,
    nitidez,
    // A borda medida região a região. Fica no laudo técnico e no painel, e por
    // enquanto NÃO decide veredicto — ver a nota em `regras.js`.
    nitidezRegioes: regioes,
    tamanhoDeclaradoCm: { largura: declaradoLarguraCm, altura: declaradoAlturaCm },
    // Idem: quem decide a escala é `analisar`.
    cmyk: false,
    temICC: null,
    temAlfa: false,
  }
}
