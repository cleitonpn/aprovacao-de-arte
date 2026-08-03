// Motor de regras: transforma medições em veredicto.
//
// Duas decisões de projeto que valem ser explicadas, porque são o que faz a
// ferramenta ser usável na operação em vez de virar mais um obstáculo:
//
// 1. O veredicto tem TRÊS níveis, não dois. Uma lona a 60 dpi vista a 4 m
//    fica perfeita; reprovar isso criaria uma volta desnecessária no ciclo.
//    A faixa amarela ("aprovado com ressalva") deixa o cliente assumir o
//    risco de forma consciente e registrada.
//
// 2. Toda mensagem é PRESCRITIVA. "Arte em baixa qualidade" é o que produz
//    o vaivém de semanas: o designer do cliente não sabe o que fazer com
//    isso. "Preciso de 4.200 × 1.800 px, você mandou 1.200 × 500" encerra a
//    conversa numa mensagem só.

export const NIVEL = { ok: 0, info: 1, ressalva: 2, bloqueante: 3 }
const POL_POR_CM = 1 / 2.54

// Piso da empresa: nenhuma arte entra abaixo disto, qualquer que seja a peça.
// Vale sobre o mínimo por tipo de peça — o perfil só pode ser MAIS exigente,
// nunca menos. Editável no painel do time de comunicação visual.
export const DPI_MINIMO_GLOBAL = 150

// Meio por cento de folga na comparação de densidade. Um arquivo de
// 11.811 px onde a conta pede 11.812 está pronto para impressão; sem esta
// tolerância ele cairia em ressalva por um pixel, e o cliente voltaria ao
// designer por nada — exatamente o ciclo que a ferramenta existe para cortar.
const TOLERANCIA = 0.995

/** Mínimo e ideal aplicáveis, já com o piso da empresa embutido. */
export function exigencia(perfil, dpiMinimoGlobal = DPI_MINIMO_GLOBAL) {
  const mim = Math.max(perfil.dpiMin || 0, dpiMinimoGlobal || 0)
  return { dpiMin: mim, dpiIdeal: Math.max(perfil.dpiIdeal || 0, mim) }
}

const nivelMax = (achados) =>
  achados.reduce((m, a) => (NIVEL[a.nivel] > NIVEL[m] ? a.nivel : m), 'ok')

export function veredictoDe(achados) {
  const pior = nivelMax(achados)
  if (pior === 'bloqueante') return 'reprovado'
  if (pior === 'ressalva') return 'ressalva'
  return 'aprovado'
}

export const ROTULO_VEREDICTO = {
  aprovado: 'Arte aprovada',
  ressalva: 'Aprovada com ressalva',
  reprovado: 'Arte reprovada',
}

const fmt = new Intl.NumberFormat('pt-BR')
const px = (n) => fmt.format(Math.round(n))
const num = (n, casas = 1) => fmt.format(Number(n.toFixed(casas)))

/** Pixels necessários para uma dada densidade sobre um tamanho em cm. */
export function pxNecessarios(cm, dpi) {
  return Math.ceil(cm * POL_POR_CM * dpi)
}

/** DPI efetivo: a única conta que importa. Metadado de DPI não entra aqui. */
export function dpiEfetivo(pixels, cm) {
  if (!cm || cm <= 0) return 0
  return pixels / (cm * POL_POR_CM)
}

/**
 * @param {object} ctx
 * @param {{larguraCm:number, alturaCm:number}} ctx.peca
 * @param {object} ctx.perfil  regra do tipo de peça
 * @param {object} ctx.medidas resultado das medições do arquivo
 */
export function avaliar(ctx) {
  const { peca, perfil, medidas } = ctx
  const { dpiMin, dpiIdeal } = exigencia(perfil, ctx.dpiMinimoGlobal)
  const escala = ctx.escalaFator || 1
  const achados = []
  const add = (a) => achados.push(a)

  // ---------------------------------------------------------------- formato
  if (medidas.formatoSuportado === false) {
    add({
      id: 'formato',
      nivel: 'bloqueante',
      titulo: `Não conseguimos ler arquivos ${medidas.formatoRotulo || medidas.formato}`,
      detalhe: medidas.formato === 'cdr'
        ? 'Arquivos do CorelDRAW (.cdr) são um formato fechado e nenhum navegador abre.'
        : 'Este formato não pode ser analisado automaticamente.',
      acao: 'Exporte a arte em PDF (preferencial) ou em JPG/PNG no tamanho final e envie novamente.',
    })
    return { achados, veredicto: 'reprovado' }
  }

  // ------------------------------------------------------------- resolução
  const { larguraPx, alturaPx } = medidas
  const dpiH = dpiEfetivo(larguraPx, peca.larguraCm)
  const dpiV = dpiEfetivo(alturaPx, peca.alturaCm)
  const dpi = Math.min(dpiH, dpiV)

  const necMinL = pxNecessarios(peca.larguraCm, dpiMin)
  const necMinA = pxNecessarios(peca.alturaCm, dpiMin)
  const necIdealL = pxNecessarios(peca.larguraCm, dpiIdeal)
  const necIdealA = pxNecessarios(peca.alturaCm, dpiIdeal)

  // Quando a arte é montada reduzida, o mesmo arquivo tem duas leituras de
  // densidade. Reportamos as duas: a que vale para a impressão é a do
  // tamanho final; a da escala é a que o designer vê no editor dele.
  const dpiNaEscala = dpi * escala

  const resumoResolucao = {
    dpi, dpiH, dpiV, dpiNaEscala, escala,
    minimo: { largura: necMinL, altura: necMinA, dpi: dpiMin },
    ideal: { largura: necIdealL, altura: necIdealA, dpi: dpiIdeal },
    enviado: { largura: larguraPx, altura: alturaPx },
    pisoEmpresa: ctx.dpiMinimoGlobal ?? DPI_MINIMO_GLOBAL,
  }

  if (medidas.puroVetor) {
    add({
      id: 'resolucao',
      nivel: 'ok',
      titulo: 'Arquivo vetorial — resolução ilimitada',
      detalhe: 'A arte é composta por vetores, que podem ser ampliados a qualquer tamanho sem perda. Não há restrição de resolução.',
    })
  } else if (dpi < dpiMin * TOLERANCIA) {
    const fator = dpiMin / Math.max(dpi, 0.01)
    add({
      id: 'resolucao',
      nivel: 'bloqueante',
      titulo: `Resolução insuficiente — ${num(dpi)} dpi no tamanho impresso`,
      detalhe: `O mínimo aceito é ${dpiMin} dpi no tamanho final. A arte enviada tem ${px(larguraPx)} × ${px(alturaPx)} px, o que dá ${num(dpi)} dpi numa peça de ${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm${escala > 1 ? ` (${num(dpiNaEscala)} dpi na escala 1:${escala} em que foi montada)` : ''}.`,
      acao: `Peça ao designer o arquivo com no mínimo ${px(necMinL)} × ${px(necMinA)} px — cerca de ${num(fator)}× o que foi enviado.`,
      dados: resumoResolucao,
    })
  } else if (dpi < dpiIdeal * TOLERANCIA) {
    add({
      id: 'resolucao',
      nivel: 'ressalva',
      titulo: `Resolução no limite — ${num(dpi)} dpi no tamanho impresso`,
      detalhe: `Atende ao mínimo de ${dpiMin} dpi, mas está abaixo do ideal de ${dpiIdeal} dpi para esta peça, que é vista a cerca de ${num(perfil.distanciaM)} m. De perto, o detalhe fino aparece amaciado.`,
      acao: `Se conseguir o arquivo com ${px(necIdealL)} × ${px(necIdealA)} px, o resultado fica visivelmente melhor.`,
      dados: resumoResolucao,
    })
  } else {
    add({
      id: 'resolucao',
      nivel: 'ok',
      titulo: `Resolução adequada — ${num(dpi)} dpi no tamanho impresso`,
      detalhe: `Acima do mínimo de ${dpiMin} dpi e do ideal de ${dpiIdeal} dpi para esta peça.`,
      dados: resumoResolucao,
    })
  }

  // --------------------------------------------------- resolução real x declarada
  //
  // DESLIGADO POR PADRÃO, de propósito. A análise espectral acerta bem em
  // imagens sintéticas de laboratório, mas nos testes com conteúdo real ela
  // ainda oscila: em parte das ampliações o ajuste degenera e a evidência
  // some. Calibrar isso exige o acervo real de artes já aprovadas e já
  // recusadas da empresa — sem esse corpus, qualquer limiar aqui é chute.
  //
  // Enquanto não estiver calibrado, os números continuam visíveis no painel
  // técnico (é o material bruto para calibrar), mas a ferramenta não acusa
  // ninguém. Acusar arte boa de ampliada é o erro que destrói a confiança do
  // time e devolve a operação ao ciclo de e-mails.
  if (ctx.detectorNitidez && medidas.inflacao?.confiavel && medidas.inflacao.detalheReal === false) {
    add({
      id: 'resolucao-real',
      nivel: 'ressalva',
      titulo: 'O arquivo tem menos nitidez do que o tamanho em pixels sugere',
      detalhe: `A arte mede ${px(larguraPx)} × ${px(alturaPx)} px, mas a análise de frequência mostra que ela não carrega detalhe real nessa resolução. Isso acontece quando uma imagem pequena é ampliada no editor — o arquivo fica grande, a nitidez não — ou quando a foto original já estava desfocada.`,
      acao: 'Peça o arquivo original, na resolução em que foi fotografado ou criado, em vez de uma versão ampliada.',
      dados: { quedaDb: medidas.inflacao.quedaDb },
    })
  }

  // ------------------------------------------------------------- proporção
  if (peca.larguraCm > 0 && peca.alturaCm > 0 && larguraPx && alturaPx) {
    const arPeca = peca.larguraCm / peca.alturaCm
    const arArte = larguraPx / alturaPx
    const desvio = Math.abs(arArte - arPeca) / arPeca
    if (desvio > 0.02) {
      // quanto sobra de um lado se encaixarmos preservando a proporção
      const cortePct = (1 - Math.min(arArte, arPeca) / Math.max(arArte, arPeca)) * 100
      const eixo = arArte > arPeca ? 'nas laterais' : 'no topo e na base'
      const nivel = desvio > 0.15 ? 'bloqueante' : 'ressalva'
      add({
        id: 'proporcao',
        nivel,
        titulo: `Proporção diferente da peça — sobra ${num(cortePct)}% da arte`,
        detalhe: `A peça é ${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm (proporção ${num(arPeca, 2)}) e a arte está em ${num(arArte, 2)}. Encaixando sem distorcer, cerca de ${num(cortePct)}% será cortado ${eixo}.`,
        acao: `Remonte a arte na proporção da peça, ou confirme por escrito que o corte ${eixo} é aceitável.`,
        dados: { arPeca, arArte, cortePct },
      })
    } else {
      add({
        id: 'proporcao',
        nivel: 'ok',
        titulo: 'Proporção compatível com a peça',
        detalhe: `A arte encaixa no formato ${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm sem corte relevante.`,
      })
    }
  }

  // -------------------------------------------------------------- compressão
  if (medidas.qualidadeJpeg != null && medidas.qualidadeJpeg < 70) {
    add({
      id: 'compressao',
      nivel: medidas.qualidadeJpeg < 55 ? 'ressalva' : 'info',
      titulo: `Compressão JPEG agressiva (qualidade ~${medidas.qualidadeJpeg})`,
      detalhe: 'Compressão alta cria manchas e "quadradinhos" em áreas de céu, degradê e fundo chapado — defeitos que a impressão em grande formato amplia junto com o resto.',
      acao: 'Reexporte o JPG em qualidade 10/12 (ou 90%+), ou envie em PNG/PDF.',
    })
  } else if (medidas.blocagem != null && medidas.blocagem > 1.6) {
    add({
      id: 'compressao',
      nivel: 'ressalva',
      titulo: 'Marcas de compressão visíveis na imagem',
      detalhe: 'A análise encontrou a grade de blocos 8×8 típica de JPEG muito comprimido.',
      acao: 'Peça ao designer o arquivo original, sem recompressão.',
    })
  }

  // ------------------------------------------------------------------- cor
  if (medidas.cmyk) {
    add({
      id: 'cor',
      nivel: 'ok',
      titulo: 'Arquivo em CMYK',
      detalhe: 'Modo de cor adequado para impressão.',
    })
  } else if (medidas.temICC === false && medidas.formato !== 'pdf') {
    add({
      id: 'cor',
      nivel: 'info',
      titulo: 'Arquivo em RGB, sem perfil de cor embutido',
      detalhe: 'Sem perfil, a conversão para CMYK na impressão é um chute — cores saturadas (azuis, laranjas e verdes vivos) tendem a sair mais apagadas do que na tela.',
      acao: 'Se a fidelidade de cor for crítica (cor de marca), envie em CMYK ou com o perfil sRGB embutido.',
    })
  }

  // ---------------------------------------------------- margem de segurança
  //
  // Cuidado deliberado aqui. Medir energia de borda diz que EXISTE conteúdo
  // na faixa das extremidades, mas não diz se aquilo é um logo ou é o fundo
  // da foto — e arte sangrada, que é a maioria, sempre tem conteúdo até a
  // borda. Tratar isso como ressalva faria o aviso disparar em quase todo
  // arquivo e, em duas semanas, ninguém mais leria os avisos da ferramenta.
  // Então: nível informativo, e só quando a borda não é chapada.
  if (medidas.margem && perfil.margemMm > 0 && medidas.bordaUniforme != null) {
    const bordaChapada = medidas.bordaUniforme < 0.04
    if (bordaChapada) {
      add({
        id: 'margem',
        nivel: 'ok',
        titulo: 'Bordas limpas',
        detalhe: 'As extremidades da arte são uniformes, o que facilita o corte e o acabamento.',
      })
    } else if (medidas.margem.densidadeMargem > 0.01) {
      add({
        id: 'margem',
        nivel: 'info',
        titulo: `Confira os ${perfil.margemMm} mm das extremidades`,
        detalhe: `A arte tem conteúdo desenhado até a borda. A faixa de ${perfil.margemMm} mm costuma ser comida por perfis, calhas e pelo acabamento da peça — e a análise automática não sabe distinguir um fundo de foto (que pode ser cortado à vontade) de um logo ou telefone (que não pode).`,
        acao: `Baixe o gabarito desta peça e confirme que nenhum elemento essencial cai fora da área segura.`,
      })
    }
  }

  // ------------------------------------------------------------- transparência
  if (medidas.temAlfa) {
    add({
      id: 'transparencia',
      nivel: 'info',
      titulo: 'Arquivo com fundo transparente',
      detalhe: 'Áreas transparentes não são impressas — elas saem na cor do material (branco da lona, por exemplo).',
      acao: 'Se o fundo deveria ter cor, achate a arte sobre o fundo desejado antes de enviar.',
    })
  }

  // ------------------------------------------------ tamanho declarado x peça
  // Só vale para arquivos que carregam tamanho físico de verdade (PDF, ou
  // raster com pHYs/JFIF confiável). Num JPG solto o "tamanho" é ficção.
  if (medidas.tamanhoDeclaradoCm && (medidas.formato === 'pdf' || medidas.formato === 'ai')) {
    const dl = medidas.tamanhoDeclaradoCm.largura
    const da = medidas.tamanhoDeclaradoCm.altura
    const desvio = Math.max(
      Math.abs(dl - peca.larguraCm) / peca.larguraCm,
      Math.abs(da - peca.alturaCm) / peca.alturaCm,
    )
    if (desvio > 0.03) {
      add({
        id: 'dimensao',
        nivel: desvio > 0.2 ? 'bloqueante' : 'ressalva',
        titulo: 'O tamanho do arquivo não bate com o da peça',
        detalhe: `A peça é ${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm e o arquivo foi montado em ${num(dl)} × ${num(da)} cm${ctx.escalaFator > 1 ? ` (já considerando a escala 1:${ctx.escalaFator})` : ''}.`,
        acao: `Remonte o arquivo em ${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm — ou confirme a escala de trabalho, se a arte foi feita reduzida.`,
        dados: { declarado: { largura: dl, altura: da } },
      })
    }
  }

  // -------------------------------------------------------------------- PDF
  if (medidas.formato === 'pdf' || medidas.formato === 'ai') {
    if (medidas.dpiImagens?.length) {
      const pior = medidas.dpiImagens.reduce((m, i) => (i.dpi < m.dpi ? i : m))
      if (pior.dpi < dpiMin) {
        add({
          id: 'pdf-imagens',
          nivel: 'ressalva',
          titulo: `Imagem dentro do PDF com apenas ${num(pior.dpi)} dpi`,
          detalhe: `O PDF pode ser vetorial, mas as fotos coladas dentro dele têm resolução própria. A de menor resolução tem ${px(pior.px)} × ${px(pior.py)} px ocupando ${num(pior.larguraCm)} cm.`,
          acao: `Substitua as imagens embutidas por versões com pelo menos ${dpiMin} dpi no tamanho em que aparecem.`,
          dados: { imagens: medidas.dpiImagens },
        })
      }
    }
    if (medidas.paginas > 1) {
      add({
        id: 'pdf-paginas',
        nivel: 'ressalva',
        titulo: `PDF com ${medidas.paginas} páginas`,
        detalhe: 'Analisamos apenas a primeira página. Uma peça deve corresponder a um arquivo de uma página.',
        acao: 'Envie um PDF por peça, com uma página cada.',
      })
    }
    if (medidas.temTexto) {
      add({
        id: 'pdf-texto',
        nivel: 'info',
        titulo: 'O PDF contém texto editável',
        detalhe: 'Texto vivo depende de a fonte estar corretamente incorporada. Se não estiver, a gráfica substitui por outra fonte e o layout quebra.',
        acao: 'Converta os textos em curvas (outline) antes de fechar o arquivo — é a forma segura.',
      })
    }
    if (medidas.fontesFaltando?.length) {
      add({
        id: 'pdf-fontes',
        nivel: 'bloqueante',
        titulo: 'Fontes não incorporadas no PDF',
        detalhe: `As fontes ${medidas.fontesFaltando.slice(0, 4).join(', ')} não estão dentro do arquivo. Na impressão elas serão trocadas por outras e o layout vai mudar.`,
        acao: 'Reexporte o PDF com as fontes incorporadas, ou converta todo o texto em curvas.',
      })
    }
    if (medidas.temTransparencia) {
      add({
        id: 'pdf-transparencia',
        nivel: 'info',
        titulo: 'O PDF usa transparências',
        detalhe: 'Transparências e sombras podem se comportar de forma diferente no RIP da impressora.',
        acao: 'Se possível, achate as transparências ao exportar (PDF/X-1a resolve isso).',
      })
    }
  }

  // ------------------------------------------------- escala provável do arquivo
  if (medidas.escalaSugerida && medidas.escalaSugerida !== 1) {
    add({
      id: 'escala',
      nivel: 'info',
      titulo: `O arquivo parece estar em escala 1:${medidas.escalaSugerida}`,
      detalhe: `O tamanho declarado no arquivo é cerca de ${medidas.escalaSugerida}× menor que a peça — prática normal em grande formato.`,
      acao: `Confirme a escala no campo acima para a conta de resolução sair correta.`,
    })
  }

  return { achados, veredicto: veredictoDe(achados), resolucao: resumoResolucao }
}

/** Dimensões-alvo da peça, com e sem sangria. Base do gabarito. */
export function especificacao(peca, perfil, dpiMinimoGlobal = DPI_MINIMO_GLOBAL) {
  const { dpiMin, dpiIdeal } = exigencia(perfil, dpiMinimoGlobal)
  const sangriaCm = (perfil.sangriaMm || 0) / 10
  const totalL = peca.larguraCm + 2 * sangriaCm
  const totalA = peca.alturaCm + 2 * sangriaCm
  return {
    visivel: { larguraCm: peca.larguraCm, alturaCm: peca.alturaCm },
    comSangria: { larguraCm: totalL, alturaCm: totalA },
    minimo: {
      largura: pxNecessarios(totalL, dpiMin),
      altura: pxNecessarios(totalA, dpiMin),
      dpi: dpiMin,
    },
    ideal: {
      largura: pxNecessarios(totalL, dpiIdeal),
      altura: pxNecessarios(totalA, dpiIdeal),
      dpi: dpiIdeal,
    },
    sangriaMm: perfil.sangriaMm,
    margemMm: perfil.margemMm,
  }
}
