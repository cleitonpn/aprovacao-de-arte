// Conferência dos arquivos de apoio: logo, fonte, manual de marca.
//
// Eles não passam pela análise de arte, e é assim que tem que ser — um logo
// não tem tamanho impresso nem resolução a conferir. Mas uma pergunta vale
// muito ser respondida na hora do envio: **este logo está vetorizado?**
//
// É a diferença entre poder ampliar o logo para a testeira de 6 metros e
// descobrir, no dia da montagem, que só existe um PNG de 400 px. Descobrir
// isso enquanto o cliente ainda está na tela custa um pedido; descobrir na
// véspera custa a peça.
//
// O que dá e o que não dá para afirmar, com honestidade:
//
// - **SVG**: é vetor por definição do formato. Certeza.
// - **PDF e AI**: dá para abrir e olhar o conteúdo da página. Se não houver
//   nenhuma imagem embutida, é vetor de verdade. Se houver, é um raster
//   embrulhado — o caso clássico do "logo em PDF" que é só um JPG dentro.
// - **EPS**: quase sempre vetor, mas não conseguimos abrir no navegador para
//   confirmar. Dizemos que provavelmente é, sem afirmar.
// - **PNG, JPG**: não é vetor, e ponto.
// - **ZIP**: não dá para olhar dentro sem descompactar. Fica sem veredicto.

import { detectarFormato, extensao } from './arquivo.js'

export const APOIO = {
  vetor: { rotulo: 'Vetorial', cor: 'ok' },
  raster: { rotulo: 'Não é vetor', cor: 'alerta' },
  provavel: { rotulo: 'Provavelmente vetorial', cor: 'ok' },
  desconhecido: { rotulo: 'Não conferido', cor: 'neutro' },
}

/**
 * @param {File} arquivo
 * @returns {Promise<{situacao:keyof APOIO, formato:string, detalhe:string, acao?:string}>}
 */
export async function conferirApoio(arquivo) {
  const buffer = await arquivo.arrayBuffer()
  const formato = detectarFormato(buffer)
  const ext = extensao(arquivo.name)

  if (formato === 'svg') {
    return {
      situacao: 'vetor',
      formato: 'svg',
      detalhe: 'SVG é vetorial por definição — amplia para qualquer tamanho sem perder nitidez.',
    }
  }

  if (formato === 'png' || formato === 'jpeg' || formato === 'gif' || formato === 'webp' || formato === 'bmp') {
    return {
      situacao: 'raster',
      formato,
      detalhe: 'Este arquivo é uma imagem de pixels, não um vetor. Ampliar para uma peça grande vai perder nitidez.',
      acao: 'Peça ao designer o logo em .svg, .ai, .eps ou PDF vetorial — o arquivo original, não uma exportação em imagem.',
    }
  }

  if (formato === 'eps' || ext === 'eps' || ext === 'ai') {
    // O .ai moderno é PDF por dentro e cai no ramo de baixo; este aqui é o .ai
    // antigo e o .eps de verdade, que o navegador não abre.
    if (formato !== 'pdf') {
      return {
        situacao: 'provavel',
        formato: formato === 'eps' ? 'eps' : ext,
        detalhe: 'Formato quase sempre vetorial, mas não conseguimos abri-lo no navegador para confirmar.',
      }
    }
  }

  if (formato === 'pdf') {
    try {
      const { abrirPdf, inspecionarPagina } = await import('./pdf.js')
      const doc = await abrirPdf(buffer)
      const pagina = await inspecionarPagina(doc, 1)
      if (pagina.puroVetor) {
        return {
          situacao: 'vetor',
          formato: 'pdf',
          detalhe: 'PDF sem nenhuma imagem embutida: é vetor de verdade e amplia sem perder nitidez.',
        }
      }
      return {
        situacao: 'raster',
        formato: 'pdf',
        detalhe: 'Este PDF tem imagem de pixels dentro — é o caso clássico do "logo em PDF" que na verdade é um JPG embrulhado. Ampliar vai perder nitidez.',
        acao: 'Peça ao designer o arquivo original em curvas (.ai, .eps ou .svg), não o PDF de uma imagem.',
      }
    } catch {
      return {
        situacao: 'desconhecido',
        formato: 'pdf',
        detalhe: 'Não foi possível abrir este PDF para conferir. O arquivo foi guardado assim mesmo.',
      }
    }
  }

  if (formato === 'zip' || ext === 'zip') {
    return {
      situacao: 'desconhecido',
      formato: 'zip',
      detalhe: 'Arquivo compactado: não dá para olhar dentro sem descompactar. Confira você mesmo se o logo está em vetor.',
    }
  }

  return {
    situacao: 'desconhecido',
    formato: formato || ext || 'desconhecido',
    detalhe: 'Não conseguimos identificar o conteúdo deste arquivo. Ele foi guardado assim mesmo.',
  }
}
