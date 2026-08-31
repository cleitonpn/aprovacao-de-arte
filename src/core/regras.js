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

// Política da empresa: pisos que valem para TODA peça. O perfil de cada tipo
// de peça só pode ser MAIS exigente que eles, nunca menos. Editáveis no painel
// do time de comunicação visual.
// A densidade tem DOIS patamares, e a diferença entre eles é o que separa
// "esta arte não imprime" de "esta arte imprime pior do que poderia".
//
// A versão anterior tinha um número só, 150, e reprovava tudo abaixo dele —
// inclusive arte que o time de CV aprovaria sem pestanejar. Uma ferramenta que
// reprova o que a pessoa aprovaria não é rigorosa: é ignorada, e aí não serve
// para nada. Agora 150 continua sendo o alvo, mas quem fica entre 100 e 150
// passa com ressalva, com o cliente sabendo o que está aceitando.
export const DPI_PISO_ABSOLUTO = 100
export const DPI_MINIMO_GLOBAL = 150

/**
 * Acuidade visual humana: um minuto de arco, em radianos.
 *
 * É a mesma constante que o simulador de distância usa para dizer "a 3,9 m o
 * olho distingue detalhes a partir de 1,13 mm". Ela já governava o que a
 * ferramenta EXPLICA; passa a governar também o que ela DECIDE.
 */
const UM_MINUTO_DE_ARCO = Math.PI / (180 * 60)

/**
 * Quantas vezes menor que o perceptível o ponto impresso precisa ser.
 *
 * 2× é margem, não física: no limite exato (1×) o ponto tem o tamanho do menor
 * detalhe que o olho separa, e qualquer coisa — a pessoa chegar mais perto, a
 * impressora abrir o ponto, o material espalhar a tinta — cruza a linha. Com
 * 2× o ponto tem metade do tamanho perceptível e a peça aguenta o mundo real.
 */
const MARGEM_DE_PERCEPCAO = 2

/**
 * A densidade abaixo da qual a peça de fato aparece granulada, na distância em
 * que ela é vista.
 *
 * Por que isto existe: o piso da empresa era um número só, 100 dpi, aplicado a
 * tudo. Numa parede vista a 2,5 m ele REPROVAVA arte que o próprio perfil
 * declara boa — `lona-parede` pede 50 dpi e tem ideal de 100. Aconteceu de
 * verdade: uma arte de 82 dpi numa parede de 100 × 265 cm foi reprovada aqui e
 * aprovada à mão pelo time, que estava certo. A 2,5 m o ponto de 82 dpi mede
 * 0,31 mm, menos da metade do que o olho distingue ali.
 *
 * E uma ferramenta que reprova o que a pessoa aprova não é rigorosa: é
 * contornada. Depois de contornada uma vez, ela para de ser lida.
 */
export function pisoPorDistancia(distanciaM) {
  const distanciaMm = Math.max(Number(distanciaM) || 0, 0.1) * 1000
  const detalheMm = distanciaMm * UM_MINUTO_DE_ARCO
  return (25.4 / detalheMm) * MARGEM_DE_PERCEPCAO
}
/**
 * Acima de quantos milímetros de borda a arte é considerada sem detalhe real.
 *
 * Calibrado com três arquivos desta operação, medidos a 50 dpi no tamanho
 * impresso: aprovados pelo time em 0,60 e 0,74 mm, reprovado em 1,50 mm. O
 * corte fica mais perto do reprovado de propósito — acusar arte boa custa a
 * confiança no laudo inteiro, e deixar passar cai na conferência do time.
 *
 * Três arquivos não são uma amostra. Este número deve ser revisto quando
 * houver mais casos reais dos dois lados.
 */
export const LIMIAR_BORDA_MM = 1.2

export const SANGRIA_MINIMA_MM = 100

export const POLITICA_PADRAO = {
  dpiPisoAbsoluto: DPI_PISO_ABSOLUTO,
  dpiMinimoGlobal: DPI_MINIMO_GLOBAL,
  sangriaMinimaMm: SANGRIA_MINIMA_MM,
}

// Meio por cento de folga na comparação de densidade. Um arquivo de
// 11.811 px onde a conta pede 11.812 está pronto para impressão; sem esta
// tolerância ele cairia em ressalva por um pixel, e o cliente voltaria ao
// designer por nada — exatamente o ciclo que a ferramenta existe para cortar.
const TOLERANCIA = 0.995

/** Exigências aplicáveis a uma peça, já com os pisos da empresa embutidos. */
export function exigencia(perfil, politica = {}) {
  const p = { ...POLITICA_PADRAO, ...politica }
  // O piso do PERFIL nunca é afrouxado: o adesivo de balcão pede 150 dpi
  // porque é visto a 50 cm, e nenhuma política de empresa muda essa física.
  // O piso da empresa só levanta o de peças mais tolerantes.
  // O piso da empresa não pode passar por cima da distância.
  //
  // A regra antiga era `max(piso do perfil, piso da empresa)`, e o comentário
  // acima ainda vale para a primeira metade: o piso do PERFIL nunca é
  // afrouxado. O que mudou é a segunda: o piso da empresa agora é LIMITADO
  // pelo que a distância justifica. Ele continua levantando peças tolerantes
  // demais, mas para de reprovar parede e testeira — que são vistas de longe e
  // cujos perfis pedem 50 e 30 dpi — por um número escrito para peça de perto.
  //
  // O efeito é sempre para o lado de afrouxar: o piso resultante nunca fica
  // acima do que era antes, então nada que passava hoje passa a reprovar.
  const pisoDaEmpresa = Math.min(p.dpiPisoAbsoluto || 0, pisoPorDistancia(perfil.distanciaM))
  // Arredondado aqui, e não na hora de escrever: este número aparece no laudo
  // do cliente ("acima de 70 dpi a peça imprime") e é a fronteira entre passar
  // e reprovar. Uma fronteira com catorze casas decimais não se explica para
  // ninguém, e a diferença entre 69,855 e 70 não decide arte nenhuma.
  const dpiPiso = Math.round(Math.max(perfil.dpiMin || 0, pisoDaEmpresa))
  const dpiMin = Math.max(perfil.dpiMin || 0, p.dpiMinimoGlobal || 0)
  return {
    dpiPiso,
    dpiMin,
    dpiIdeal: Math.max(perfil.dpiIdeal || 0, dpiMin),
    // Sangria própria vence o piso da empresa. Os 10 cm existem para lona
    // tensionada, que precisa de material para grampear; num adesivo de balcão
    // isso viraria 10 cm de vinil jogado fora em cada lado — e o designer, com
    // razão, ignoraria o gabarito.
    sangriaMm: perfil.sangriaPropria
      ? (perfil.sangriaMm || 0)
      : Math.max(perfil.sangriaMm || 0, p.sangriaMinimaMm || 0),
    margemMm: perfil.margemMm || 0,
  }
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
// Proporção sempre com duas casas: "2" no lugar de "2,00" fica com cara de
// número inteiro e confunde num documento que vai para o cliente.
const prop = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
  const politica = { ...POLITICA_PADRAO, ...(ctx.politica || {}) }
  const { dpiPiso, dpiMin, dpiIdeal, sangriaMm } = exigencia(perfil, politica)
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

  const necPisoL = pxNecessarios(peca.larguraCm, dpiPiso)
  const necPisoA = pxNecessarios(peca.alturaCm, dpiPiso)
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
    piso: { largura: necPisoL, altura: necPisoA, dpi: dpiPiso },
    minimo: { largura: necMinL, altura: necMinA, dpi: dpiMin },
    ideal: { largura: necIdealL, altura: necIdealA, dpi: dpiIdeal },
    enviado: { largura: larguraPx, altura: alturaPx },
    pisoEmpresa: politica.dpiMinimoGlobal,
    sangriaMm,
  }

  if (medidas.puroVetor) {
    add({
      id: 'resolucao',
      nivel: 'ok',
      titulo: 'Arquivo vetorial — resolução ilimitada',
      detalhe: 'A arte é composta por vetores, que podem ser ampliados a qualquer tamanho sem perda. Não há restrição de resolução.',
    })
  } else if (dpi < dpiPiso * TOLERANCIA) {
    const fator = dpiPiso / Math.max(dpi, 0.01)
    add({
      id: 'resolucao',
      nivel: 'bloqueante',
      titulo: `Resolução insuficiente — ${num(dpi)} dpi no tamanho impresso`,
      detalhe: `O mínimo que ainda imprime nesta peça é ${dpiPiso} dpi no tamanho final. A arte enviada tem ${px(larguraPx)} × ${px(alturaPx)} px, o que dá ${num(dpi)} dpi numa peça de ${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm${escala > 1 ? ` (${num(dpiNaEscala)} dpi na escala 1:${escala} em que foi montada)` : ''}.`,
      acao: `Peça ao designer o arquivo com no mínimo ${px(necPisoL)} × ${px(necPisoA)} px — cerca de ${num(fator)}× o que foi enviado. O ideal são ${px(necMinL)} × ${px(necMinA)} px (${dpiMin} dpi).`,
      dados: resumoResolucao,
    })
  } else if (dpi < dpiMin * TOLERANCIA) {
    // A faixa entre o piso e o padrão da casa. Imprime, e o time de CV
    // aprovaria — mas o cliente precisa saber que aceitou menos do que o alvo.
    add({
      id: 'resolucao',
      nivel: 'ressalva',
      titulo: `Resolução abaixo do padrão — ${num(dpi)} dpi no tamanho impresso`,
      detalhe: `Nosso padrão é ${dpiMin} dpi no tamanho final; esta arte tem ${num(dpi)} dpi. Acima de ${dpiPiso} dpi a peça imprime e fica aceitável a ${num(perfil.distanciaM)} m, mas de perto o detalhe fino aparece amaciado.`,
      acao: `Se der para conseguir o arquivo com ${px(necMinL)} × ${px(necMinA)} px, o resultado fica no padrão. Senão, é possível seguir assim.`,
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

    // A arte pode chegar no tamanho de corte OU já com a sangria. Com sangria
    // de 10 cm as duas proporções são visivelmente diferentes (200×290 dá
    // 0,69; 220×310 dá 0,71), então aceitamos as duas — comparar só com o
    // tamanho de corte reprovaria justamente o arquivo montado do jeito certo.
    const sangriaCm = sangriaMm / 10
    const arComSangria = (peca.larguraCm + 2 * sangriaCm) / (peca.alturaCm + 2 * sangriaCm)
    const desvio = Math.min(
      Math.abs(arArte - arPeca) / arPeca,
      Math.abs(arArte - arComSangria) / arComSangria,
    )
    if (desvio > 0.02) {
      // quanto sobra de um lado se encaixarmos preservando a proporção
      const cortePct = (1 - Math.min(arArte, arPeca) / Math.max(arArte, arPeca)) * 100
      const eixo = arArte > arPeca ? 'nas laterais' : 'no topo e na base'
      const nivel = desvio > 0.15 ? 'bloqueante' : 'ressalva'
      add({
        id: 'proporcao',
        nivel,
        titulo: `Proporção diferente da peça — sobra ${num(cortePct)}% da arte`,
        detalhe: `A peça é ${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm — proporção ${prop(arPeca)}, ou ${prop(arComSangria)} com a sangria. A arte está em ${prop(arArte)}. Encaixando sem distorcer, cerca de ${num(cortePct)}% será cortado ${eixo}.`,
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

    // DOIS tamanhos são certos, não um.
    //
    // O cadastro guarda a medida de CORTE — 110 × 275 é a peça que fica na
    // parede. Mas o gabarito que a ferramenta entrega já vem com sangria, e o
    // cartão da peça diz, com todas as letras, "com sangria 130 × 295 cm". O
    // designer que seguir a instrução manda 130 × 295, que é o certo.
    //
    // Comparar só contra o corte acusava justamente esse arquivo de estar na
    // medida errada. Com sangria grande em peça estreita o desvio passava de
    // 20% e virava bloqueante: a ferramenta mandava fazer de um jeito e
    // barrava quem fizesse. A regra de proporção logo acima já aceitava as
    // duas leituras; era esta que estava fora de passo.
    const sangriaCm = sangriaMm / 10
    const alvos = [
      { rotulo: 'no corte', l: peca.larguraCm, a: peca.alturaCm },
      { rotulo: 'com sangria', l: peca.larguraCm + 2 * sangriaCm, a: peca.alturaCm + 2 * sangriaCm },
    ]
    const desvioDe = (t) => Math.max(Math.abs(dl - t.l) / t.l, Math.abs(da - t.a) / t.a)
    const melhor = alvos.reduce((m, t) => (desvioDe(t) < desvioDe(m) ? t : m))
    const desvio = desvioDe(melhor)

    if (desvio > 0.03) {
      const comSangria = alvos[1]
      const aceitos = sangriaCm > 0
        ? `${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm (no corte) ou ${num(comSangria.l)} × ${num(comSangria.a)} cm (com a sangria de ${num(sangriaCm)} cm por lado)`
        : `${num(peca.larguraCm)} × ${num(peca.alturaCm)} cm`
      add({
        id: 'dimensao',
        nivel: desvio > 0.2 ? 'bloqueante' : 'ressalva',
        titulo: 'O tamanho do arquivo não bate com o da peça',
        detalhe: `O arquivo foi montado em ${num(dl)} × ${num(da)} cm${ctx.escalaFator > 1 ? ` (já considerando a escala 1:${ctx.escalaFator})` : ''}. Para esta peça vale ${aceitos}.`,
        acao: `Remonte o arquivo em ${aceitos} — ou confirme a escala de trabalho, se a arte foi feita reduzida.`,
        dados: {
          declarado: { largura: dl, altura: da },
          aceitos: alvos.map((t) => ({ rotulo: t.rotulo, largura: t.l, altura: t.a })),
        },
      })
    }
  }

  // -------------------------------------------------------------------- PDF
  if (medidas.formato === 'pdf' || medidas.formato === 'ai') {
    // Não conseguimos abrir a imagem: isto precisa APARECER.
    //
    // Antes, um arquivo cuja imagem o navegador não dava conta de decodificar
    // seguia como "aprovado", com a prévia em branco, o simulador em branco e
    // uma frase afirmando que a granulação não seria perceptível. Aprovar sem
    // ter visto é a única falha aqui que o cliente não tem como perceber
    // sozinho — todas as outras ele lê no laudo.
    //
    // Ressalva, e não bloqueio: o arquivo pode estar perfeito, e o que falta é
    // a nossa capacidade de conferir, não a qualidade dele. Mas quem envia
    // assume isso de olhos abertos, e fica registrado quem assumiu.
    if (medidas.visualIndisponivel) {
      add({
        id: 'visual-indisponivel',
        nivel: 'ressalva',
        titulo: 'Não conseguimos abrir a imagem deste PDF para conferir',
        detalhe: 'O arquivo tem uma imagem embutida grande demais para o navegador processar, então a pré-visualização e a simulação de distância não puderam ser geradas. Os dados técnicos acima (medida, resolução declarada, sangria) foram conferidos normalmente; o que não foi possível verificar é como a arte realmente se parece.',
        acao: 'Se puder, exporte o PDF com a imagem em resolução compatível com o tamanho da peça — arquivos muito acima do necessário não melhoram a impressão e impedem a conferência. Nossa equipe vai olhar esta arte manualmente antes de imprimir.',
        dados: { imagens: medidas.dpiImagens },
      })
    }
    // Nitidez REAL, que é outra pergunta que "quantos pixels tem".
    //
    // Um arquivo pode declarar 216 dpi e não carregar detalhe nenhum neles:
    // basta a arte ter sido montada com uma imagem pequena ampliada. Foi o que
    // passou aprovado com o personagem visivelmente borrado — e um dos
    // arquivos que o time aprova declara 150 dpi, menos que ele.
    //
    // O limiar está em milímetros impressos porque é assim que a coisa existe
    // no mundo: 1,2 mm é o ponto entre os aprovados (0,60 e 0,74 mm) e o
    // reprovado (1,50 mm), com folga maior para o lado de não acusar arte boa.
    // Errar reprovando destrói a confiança no laudo inteiro; errar aprovando
    // cai na conferência do time, que existe justamente para isso.
    if (medidas.nitidez?.medido && medidas.nitidez.bordaMm > LIMIAR_BORDA_MM) {
      add({
        id: 'nitidez-real',
        nivel: 'ressalva',
        titulo: 'A arte tem menos definição do que a resolução declarada sugere',
        detalhe: `As transições desta arte levam cerca de ${num(medidas.nitidez.bordaMm, 2)} mm para acontecer no tamanho impresso — uma arte com detalhe real fica abaixo de ${num(LIMIAR_BORDA_MM, 1)} mm. Isso acontece quando algum elemento foi ampliado dentro do arquivo: o PDF fica grande e declara a resolução certa, mas o detalhe não existe. Costuma aparecer primeiro em personagens, fotos e logos.`,
        acao: 'Peça ao designer os elementos na resolução original, sem ampliar, e remonte a arte. Trocar o arquivo por um maior não resolve — o que falta é detalhe, não pixel.',
        dados: { bordaMm: medidas.nitidez.bordaMm, bordaPx: medidas.nitidez.bordaPx, dpi: medidas.nitidez.dpi },
      })
    }

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
export function especificacao(peca, perfil, politica = {}) {
  const { dpiPiso, dpiMin, dpiIdeal, sangriaMm } = exigencia(perfil, politica)
  const sangriaCm = sangriaMm / 10
  const totalL = peca.larguraCm + 2 * sangriaCm
  const totalA = peca.alturaCm + 2 * sangriaCm
  return {
    visivel: { larguraCm: peca.larguraCm, alturaCm: peca.alturaCm },
    comSangria: { larguraCm: totalL, alturaCm: totalA },
    piso: {
      largura: pxNecessarios(totalL, dpiPiso),
      altura: pxNecessarios(totalA, dpiPiso),
      dpi: dpiPiso,
    },
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
    sangriaMm,
    margemMm: perfil.margemMm,
  }
}
