import test from 'node:test'
import assert from 'node:assert/strict'
import {
  avaliar, pxNecessarios, dpiEfetivo, especificacao, veredictoDe, exigencia,
  DPI_PISO_ABSOLUTO, DPI_MINIMO_GLOBAL, SANGRIA_MINIMA_MM, LIMIAR_BORDA_MM, exigeConferenciaHumana, conferenciaPendente,
} from '../src/core/regras.js'
import { PERFIS_PADRAO } from '../src/data/perfis.js'

const perfil = (id) => PERFIS_PADRAO.find((p) => p.id === id)
// Com o piso da empresa de 150 dpi, o mínimo efetivo de TODA peça é 150.
// O perfil só diferencia o ideal: lona 150, balcão 300.
const lona = perfil('lona-parede')
const balcao = perfil('adesivo-balcao')

const pecaLona = { larguraCm: 200, alturaCm: 290 }
const achado = (r, id) => r.achados.find((a) => a.id === id)

function medidasRaster(extra = {}) {
  return {
    formato: 'jpeg',
    formatoSuportado: true,
    // 12000 × 17400 numa peça 200 × 290 cm = ~152 dpi, acima do piso de 150
    larguraPx: 12000,
    alturaPx: 17400,
    temICC: true,
    cmyk: false,
    temAlfa: false,
    qualidadeJpeg: 92,
    blocagem: 1.1,
    inflacao: { fator: 1, confiavel: true },
    ...extra,
  }
}

test('a densidade tem dois patamares: o que reprova e o que é padrão da casa', () => {
  assert.equal(DPI_PISO_ABSOLUTO, 100)
  assert.equal(DPI_MINIMO_GLOBAL, 150)
  assert.equal(SANGRIA_MINIMA_MM, 100)

  // Lona pede 50 dpi no perfil e é vista a 2,5 m. O piso da empresa é LIMITADO
  // pela distância: a 2,5 m o olho separa 0,73 mm, e com a margem de 2× isso dá
  // 70 dpi. Era 100 — número escrito pensando em peça de perto, que reprovava
  // arte de parede que o time aprovava à mão.
  assert.equal(exigencia(lona).dpiPiso, 70)
  // O PADRÃO da casa não é tocado pela distância: 150 continua sendo o alvo, e
  // quem fica entre 70 e 150 passa com ressalva sabendo o que aceitou.
  assert.equal(exigencia(lona).dpiMin, 150)
  assert.equal(exigencia(lona).dpiIdeal, 150)

  // O balcão já pede 150 no perfil, porque é visto a 50 cm. Nenhuma política
  // de empresa afrouxa isso: o piso dele continua 150, não 100. E a distância
  // também não o afrouxa — a 0,5 m ela pediria 349 dpi, e o limite é de mão
  // única: só relaxa o que a distância justifica, nunca aperta o que valia.
  assert.equal(exigencia(balcao).dpiPiso, 150)
  assert.equal(exigencia(balcao).dpiIdeal, 300)

  // os pisos são configuráveis pelo time de CV
  assert.equal(exigencia(lona, { dpiMinimoGlobal: 200 }).dpiMin, 200)
  // O piso GERAL da empresa é distância-limitado mesmo quando configurado à
  // mão: um número único não tem como saber de que distância a peça é vista, e
  // foi exatamente essa pretensão que reprovou arte boa. Quem quiser ser mais
  // exigente numa peça específica levanta o `dpiMin` do PERFIL, que é absoluto.
  assert.equal(exigencia(lona, { dpiPisoAbsoluto: 120 }).dpiPiso, 70)
  assert.equal(exigencia({ ...lona, dpiMin: 120 }).dpiPiso, 120)
  assert.equal(exigencia(lona, { sangriaMinimaMm: 150 }).sangriaMm, 150)
  // e um piso mais frouxo nunca afrouxa um perfil mais exigente
  assert.equal(exigencia(lona, { dpiMinimoGlobal: 30 }).dpiMin, 50)
})

test('a sangria de 10 cm é da lona; o adesivo tem a dele', () => {
  // Os 10 cm existem para lona tensionada, que precisa de material para
  // grampear. Num adesivo isso seria 10 cm de vinil no lixo em cada lado.
  assert.equal(exigencia(lona).sangriaMm, 100)
  assert.equal(exigencia(balcao).sangriaMm, 50)
  // e a sangria própria não se deixa levantar pelo piso da empresa
  assert.equal(exigencia(balcao, { sangriaMinimaMm: 300 }).sangriaMm, 50)
})

test('conversões de resolução', () => {
  // 200 cm a 50 dpi -> ceil(200/2.54 * 50); arredonda para cima, nunca para baixo
  assert.equal(pxNecessarios(200, 50), 3938)
  assert.equal(Math.round(dpiEfetivo(3938, 200)), 50)
  assert.equal(dpiEfetivo(1000, 0), 0)
})

test('arte folgada é aprovada sem ressalva', () => {
  const r = avaliar({ peca: pecaLona, perfil: lona, medidas: medidasRaster() })
  assert.equal(r.veredicto, 'aprovado')
  assert.equal(achado(r, 'resolucao').nivel, 'ok')
})

test('arte abaixo do mínimo é reprovada com o número exato a pedir', () => {
  const r = avaliar({ peca: pecaLona, perfil: lona, medidas: medidasRaster({ larguraPx: 1200, alturaPx: 1740 }) })
  assert.equal(r.veredicto, 'reprovado')
  const a = achado(r, 'resolucao')
  assert.equal(a.nivel, 'bloqueante')
  // a ação precisa conter os pixels necessários — é isso que quebra o ciclo
  assert.match(a.acao, /11\.812/)
  assert.match(a.acao, /17\.126/)
  assert.equal(a.dados.minimo.largura, pxNecessarios(200, 150))
})

test('entre o mínimo e o ideal vira ressalva, não reprovação', () => {
  // balcão a 200 dpi: acima do piso (150), abaixo do ideal da peça (300)
  const peca = { larguraCm: 100, alturaCm: 100 }
  const r = avaliar({
    peca,
    perfil: balcao,
    medidas: medidasRaster({ larguraPx: pxNecessarios(100, 200), alturaPx: pxNecessarios(100, 200) }),
  })
  assert.equal(r.veredicto, 'ressalva')
  assert.equal(achado(r, 'resolucao').nivel, 'ressalva')
})

test('acima do piso, a mesma arte passa na lona e fica em ressalva no balcão', () => {
  // O piso é comum, mas o ideal ainda é por peça: 200 dpi basta a 2,5 m e
  // é pouco a 50 cm do olho.
  const medidas = medidasRaster({ larguraPx: pxNecessarios(100, 200), alturaPx: pxNecessarios(100, 200) })
  const peca = { larguraCm: 100, alturaCm: 100 }
  assert.equal(avaliar({ peca, perfil: lona, medidas }).veredicto, 'aprovado')
  assert.equal(avaliar({ peca, perfil: balcao, medidas }).veredicto, 'ressalva')
})

// A ferramenta estava reprovando arte que o time de CV aprovaria sem
// pestanejar — e ferramenta que reprova o que a pessoa aprova não é rigorosa,
// é ignorada. Daí os dois patamares.
test('entre o piso e o padrão da casa, passa com ressalva', () => {
  const peca = { larguraCm: 100, alturaCm: 100 }
  const em = (dpi) => medidasRaster({
    larguraPx: pxNecessarios(100, dpi), alturaPx: pxNecessarios(100, dpi),
  })

  // O piso da lona é 70 dpi (2,5 m de distância), não mais 100. 90 dpi passa
  // com ressalva — era reprovação, e era ela que mandava o time aprovar por
  // fora. Quem reprova agora é o que a distância não sustenta.
  const a90 = avaliar({ peca, perfil: lona, medidas: em(90) })
  assert.equal(a90.veredicto, 'ressalva', '90 dpi a 2,5 m é imperceptível')

  const a60 = avaliar({ peca, perfil: lona, medidas: em(60) })
  assert.equal(a60.veredicto, 'reprovado', 'abaixo de 70 dpi a granulação aparece')

  const a120 = avaliar({ peca, perfil: lona, medidas: em(120) })
  assert.equal(a120.veredicto, 'ressalva', '120 dpi imprime, mas fora do padrão')
  assert.match(achado(a120, 'resolucao').titulo, /abaixo do padr/i)
  // A ação precisa dizer que dá para seguir assim — senão a ressalva é lida
  // como reprovação e o cliente volta ao designer à toa.
  assert.match(achado(a120, 'resolucao').acao, /poss[ií]vel seguir/i)

  const a160 = avaliar({ peca, perfil: lona, medidas: em(160) })
  assert.equal(a160.veredicto, 'aprovado', 'acima de 150 está no padrão')
})

test('a peça vista de perto mantém o piso alto dela', () => {
  const peca = { larguraCm: 100, alturaCm: 100 }
  const medidas = medidasRaster({
    larguraPx: pxNecessarios(100, 120), alturaPx: pxNecessarios(100, 120),
  })
  // 120 dpi passa com ressalva numa lona a 2,5 m e reprova num adesivo de
  // balcão, que o cliente lê a 50 cm. É a mesma arte; muda a distância.
  assert.equal(avaliar({ peca, perfil: lona, medidas }).veredicto, 'ressalva')
  assert.equal(avaliar({ peca, perfil: balcao, medidas }).veredicto, 'reprovado')
})

test('PDF vetorial não sofre restrição de resolução', () => {
  const r = avaliar({
    peca: pecaLona,
    perfil: balcao,
    medidas: {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
      larguraPx: null, alturaPx: null, temTexto: false,
      tamanhoDeclaradoCm: { largura: 200, altura: 290 },
    },
  })
  assert.equal(achado(r, 'resolucao').nivel, 'ok')
  assert.match(achado(r, 'resolucao').titulo, /vetorial/i)
  assert.equal(r.veredicto, 'aprovado')
})

test('formato ilegível reprova de imediato, com caminho de saída', () => {
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: { formato: 'cdr', formatoRotulo: 'CorelDRAW (.cdr)', formatoSuportado: false },
  })
  assert.equal(r.veredicto, 'reprovado')
  assert.equal(r.achados.length, 1)
  assert.match(r.achados[0].acao, /PDF/)
})

test('proporção divergente é medida em % de corte', () => {
  // arte quadrada numa peça 200x290
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: medidasRaster({ larguraPx: 15000, alturaPx: 15000 }),
  })
  const a = achado(r, 'proporcao')
  assert.equal(a.nivel, 'bloqueante')
  assert.ok(a.dados.cortePct > 30)
})

test('desvio moderado de proporção vira ressalva, não reprovação', () => {
  // 0,80 contra 0,690 (corte) e 0,710 (com sangria): ~13% fora da mais
  // próxima. Corta um pedaço, mas não justifica travar a peça sozinho.
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: medidasRaster({ larguraPx: 12000, alturaPx: 15000 }),
  })
  assert.equal(achado(r, 'proporcao').nivel, 'ressalva')
})

test('arte montada COM a sangria de 10 cm não é acusada de proporção errada', () => {
  // 220 × 310 cm (peça 200 × 290 + 10 cm de sangria por lado) tem proporção
  // 0,710 contra os 0,690 do tamanho de corte: 3% de diferença. Sem aceitar
  // as duas leituras, o arquivo montado corretamente seria reprovado.
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: medidasRaster({
      larguraPx: pxNecessarios(220, 150),
      alturaPx: pxNecessarios(310, 150),
    }),
  })
  assert.equal(achado(r, 'proporcao').nivel, 'ok')
  assert.equal(r.veredicto, 'aprovado')
})

test('desvio desprezível de proporção nem aparece como ressalva', () => {
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: medidasRaster({ larguraPx: 12000, alturaPx: 17250 }),
  })
  assert.equal(achado(r, 'proporcao').nivel, 'ok')
})

test('fonte não incorporada em PDF é bloqueante', () => {
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
      temTexto: true, fontesFaltando: ['HelveticaNeue-Bold'],
      tamanhoDeclaradoCm: { largura: 200, altura: 290 },
    },
  })
  assert.equal(r.veredicto, 'reprovado')
  assert.equal(achado(r, 'pdf-fontes').nivel, 'bloqueante')
})

test('detector de nitidez fica calado enquanto não estiver calibrado', () => {
  // Padrão de fábrica: mesmo havendo evidência, a ferramenta não acusa.
  // Só o time de CV liga o detector, depois de calibrá-lo com o acervo real.
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: medidasRaster({ inflacao: { detalheReal: false, confiavel: true, quedaDb: 14 } }),
  })
  assert.equal(achado(r, 'resolucao-real'), undefined)
  assert.equal(r.veredicto, 'aprovado')
})

test('detector ligado: falta de nitidez é ressalva, nunca reprovação isolada', () => {
  const r = avaliar({
    peca: pecaLona, perfil: lona, detectorNitidez: true,
    medidas: medidasRaster({ inflacao: { detalheReal: false, confiavel: true, quedaDb: 14 } }),
  })
  const a = achado(r, 'resolucao-real')
  assert.ok(a)
  assert.equal(a.nivel, 'ressalva')
  assert.equal(r.veredicto, 'ressalva')
  // e a mensagem não inventa um fator de ampliação que a medição não sustenta
  assert.doesNotMatch(a.detalhe, /\d+ ?[x×] (menor|ampliada)/i)
})

test('detector ligado, mas sem confiança na medição: silêncio', () => {
  const r = avaliar({
    peca: pecaLona, perfil: lona, detectorNitidez: true,
    medidas: medidasRaster({ inflacao: { detalheReal: false, confiavel: false } }),
  })
  assert.equal(achado(r, 'resolucao-real'), undefined)
  assert.equal(r.veredicto, 'aprovado')
})

// A medida certa passou a ser DITA, não só tolerada.
//
// Estes testes checavam a ausência do achado `dimensao`, e isso estava certo
// enquanto o PDF também recebia um "proporção compatível" da regra de
// proporção. Essa regra saiu do PDF — ela comparava a peça consigo mesma e
// aprovava a forma de qualquer arquivo —, e sem nenhuma linha sobre tamanho um
// arquivo na medida certa ficaria indistinguível de um que ninguém mediu.
// Agora `dimensao` aparece nos dois casos: `ok` quando bate, e o resto quando
// não bate. O que continua valendo é que `ok` não muda veredicto.
test('escala de trabalho não faz o arquivo ser reprovado por dimensão', () => {
  // arte montada a 1:10 de uma peça de 200x290 cm => página de 20x29 cm
  const medidas = {
    formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
    tamanhoDeclaradoCm: { largura: 200, altura: 290 },
  }
  const r = avaliar({ peca: pecaLona, perfil: lona, medidas, escalaFator: 10 })
  assert.equal(achado(r, 'dimensao').nivel, 'ok')
  assert.equal(r.veredicto, 'aprovado')
})

test('especificação da peça inclui a sangria e respeita os pisos', () => {
  const e = especificacao(pecaLona, lona)
  assert.equal(e.sangriaMm, 100)
  assert.equal(e.comSangria.larguraCm, 220) // 200 + 2 × 10 cm
  assert.equal(e.comSangria.alturaCm, 310)
  assert.equal(e.minimo.largura, pxNecessarios(220, 150))
  assert.equal(e.ideal.dpi, 150)
  assert.equal(especificacao(pecaLona, balcao).ideal.dpi, 300)

  // o adesivo tem sangria própria de 5 cm por lado
  const balcaoSpec = especificacao({ larguraCm: 100, alturaCm: 50 }, balcao)
  assert.equal(balcaoSpec.sangriaMm, 50)
  assert.equal(balcaoSpec.comSangria.larguraCm, 110)
  assert.equal(balcaoSpec.comSangria.alturaCm, 60)
})

test('a margem de segurança nunca reprova nem vira ressalva', () => {
  // Arte sangrada tem conteúdo até a borda por definição. Se esse aviso
  // pesasse no veredicto, dispararia em quase todo arquivo e o time
  // aprenderia a ignorar os avisos da ferramenta.
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: medidasRaster({
      bordaUniforme: 0.3,
      margem: { densidadeMargem: 0.09, densidadeMiolo: 0.08, razao: 1.12 },
    }),
  })
  assert.equal(achado(r, 'margem').nivel, 'info')
  assert.equal(r.veredicto, 'aprovado')
})

test('o veredicto é sempre o pior achado', () => {
  assert.equal(veredictoDe([{ nivel: 'ok' }, { nivel: 'info' }]), 'aprovado')
  assert.equal(veredictoDe([{ nivel: 'ok' }, { nivel: 'ressalva' }]), 'ressalva')
  assert.equal(veredictoDe([{ nivel: 'ressalva' }, { nivel: 'bloqueante' }]), 'reprovado')
})

// ------------------------------------------------- dois tamanhos certos
//
// O cadastro guarda a medida de CORTE, mas o gabarito e o cartão da peça
// mandam o designer montar COM a sangria. Aceitar só o corte era a ferramenta
// mandar fazer de um jeito e barrar quem fizesse.

test('arquivo montado com a sangria não é acusado de medida errada', () => {
  // Peça de 110 × 275 com 10 cm de sangria por lado = 130 × 295.
  const peca = { larguraCm: 110, alturaCm: 275 }
  const r = avaliar({
    peca,
    perfil: lona,
    medidas: {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
      tamanhoDeclaradoCm: { largura: 130, altura: 295 },
    },
  })
  assert.equal(achado(r, 'dimensao').nivel, 'ok')
  assert.equal(r.veredicto, 'aprovado')
})

test('arquivo montado no corte continua aceito', () => {
  const peca = { larguraCm: 110, alturaCm: 275 }
  const r = avaliar({
    peca,
    perfil: lona,
    medidas: {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
      tamanhoDeclaradoCm: { largura: 110, altura: 275 },
    },
  })
  assert.equal(achado(r, 'dimensao').nivel, 'ok')
})

// A sangria não pode virar desculpa para qualquer medida passar: o que não é
// nem o corte nem o corte + sangria continua sendo erro.
test('medida que não é nem corte nem sangria segue reprovando', () => {
  const peca = { larguraCm: 110, alturaCm: 275 }
  const r = avaliar({
    peca,
    perfil: lona,
    medidas: {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
      tamanhoDeclaradoCm: { largura: 200, altura: 400 },
    },
  })
  const a = achado(r, 'dimensao')
  assert.ok(a, 'medida fora das duas referências precisa ser apontada')
  assert.equal(a.nivel, 'bloqueante')
  // A mensagem precisa dizer os DOIS tamanhos aceitos — senão o designer
  // remonta no corte e recebe a mesma ressalva de volta.
  assert.match(a.detalhe, /110 × 275/)
  assert.match(a.detalhe, /130 × 295/)
  assert.equal(a.dados.aceitos.length, 2)
})

// O caso que tornava o defeito grave: sangria grande em peça estreita passava
// de 20% de desvio e o envio virava bloqueante.
test('sangria grande em peça estreita não bloqueia o envio', () => {
  const peca = { larguraCm: 60, alturaCm: 200 }
  const r = avaliar({
    peca,
    perfil: lona,
    medidas: {
      formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
      tamanhoDeclaradoCm: { largura: 80, altura: 220 },
    },
  })
  assert.equal(achado(r, 'dimensao').nivel, 'ok')
  assert.notEqual(r.veredicto, 'reprovado')
})

// ------------------------------------------- quando não foi possível conferir
//
// O pdf.js diante de imagem gigante não lança erro: devolve a página em
// branco. O laudo seguia "aprovado", com prévia e simulador vazios e a frase
// "a granulação não é perceptível a esta distância" — sobre uma arte que a
// ferramenta nunca abriu. Aprovar sem ter visto é a única falha aqui que o
// cliente não tem como perceber sozinho.

const pdfGrande = (extra = {}) => ({
  formato: 'pdf', formatoSuportado: true, paginas: 1, puroVetor: false,
  tamanhoDeclaradoCm: { largura: 200, altura: 290 },
  dpiImagens: [{ dpi: 216, px: 21571, py: 28912, larguraCm: 254 }],
  larguraPx: 17008, alturaPx: 24662,
  ...extra,
})

test('render vazio vira ressalva, não aprovação silenciosa', () => {
  const r = avaliar({ peca: pecaLona, perfil: lona, medidas: pdfGrande({ visualIndisponivel: true }) })
  const a = achado(r, 'visual-indisponivel')
  assert.ok(a, 'a falha de leitura precisa aparecer no laudo')
  assert.equal(a.nivel, 'ressalva')
  assert.equal(r.veredicto, 'ressalva', 'não pode sair como aprovado')
  assert.match(a.detalhe, /não puderam ser geradas/)
})

test('PDF que abriu normalmente não ganha o aviso', () => {
  const r = avaliar({ peca: pecaLona, perfil: lona, medidas: pdfGrande() })
  assert.equal(achado(r, 'visual-indisponivel'), undefined)
})

// -------------------------------------------------- nitidez real (PDF)
//
// A densidade declarada não prediz qualidade. Nos três arquivos reais desta
// operação, o que o time REPROVOU tinha 216 dpi nominais e um dos aprovados
// tinha 150. O que separa é a largura da borda, medida em mm impressos.

const pdfComNitidez = (bordaMm) => ({
  formato: 'pdf', formatoSuportado: true, paginas: 1, puroVetor: false,
  tamanhoDeclaradoCm: { largura: 200, altura: 290 },
  dpiImagens: [{ dpi: 216, px: 21571, py: 28912, larguraCm: 200 }],
  larguraPx: 17008, alturaPx: 24662,
  nitidez: { medido: true, dpi: 50, bordaPx: bordaMm / 25.4 * 50, bordaMm },
})

test('arte ampliada vira ressalva mesmo com dpi declarado alto', () => {
  // 1,50 mm foi o medido no arquivo J&T, aprovado pela ferramenta e reprovado
  // pelo time por causa do personagem borrado.
  const r = avaliar({ peca: pecaLona, perfil: lona, medidas: pdfComNitidez(1.50) })
  const a = achado(r, 'nitidez-real')
  assert.ok(a, 'o arquivo que o time reprovou precisa sair com ressalva')
  assert.equal(a.nivel, 'ressalva')
  assert.equal(r.veredicto, 'ressalva')
  assert.match(a.acao, /não resolve/, 'mandar arquivo maior não conserta falta de detalhe')
})

test('os dois arquivos que o time aprova passam limpos', () => {
  for (const mm of [0.60, 0.74]) {   // Infracommerce e JadLog, medidos
    const r = avaliar({ peca: pecaLona, perfil: lona, medidas: pdfComNitidez(mm) })
    assert.equal(achado(r, 'nitidez-real'), undefined, `${mm} mm não pode ser acusado`)
  }
})

test('o limiar tem folga dos dois lados', () => {
  // Errar reprovando destrói a confiança no laudo; errar aprovando cai na
  // conferência do time. Por isso o corte fica mais perto do reprovado.
  assert.ok(LIMIAR_BORDA_MM > 0.74 * 1.4, 'folga sobre o pior aprovado')
  assert.ok(LIMIAR_BORDA_MM < 1.50 * 0.9, 'ainda pega o reprovado')
})

test('sem medição confiável, nenhum achado — silêncio, não aprovação', () => {
  for (const nitidez of [
    { medido: false, motivo: 'resolucao_baixa' },
    { medido: false, motivo: 'vetor' },
    undefined,
  ]) {
    const r = avaliar({ peca: pecaLona, perfil: lona, medidas: { ...pdfComNitidez(9), nitidez } })
    assert.equal(achado(r, 'nitidez-real'), undefined)
  }
})

// ------------------------------------- o que a ferramenta não conseguiu ver
//
// A diferença entre "não aprovo" e "não consegui olhar" é tudo. Numa ressalva
// comum a ferramenta OLHOU e tem opinião; o cliente aceita o risco com
// conhecimento de causa e está encerrado. Quando ela não conseguiu abrir a
// imagem, o "assumo o risco" do cliente encerra uma pergunta que ninguém fez.
//
// Aconteceu com uma parede de 120 × 320 cm — 562 megapixels, ~2,25 GB
// descomprimidos, nenhum navegador abre. E não é caso raro: 300 dpi numa peça
// desse tamanho dá exatamente isso, então é a arte BEM feita que cai aqui.

test('arte que não pôde ser aberta exige olho humano', () => {
  const laudo = { achados: [{ id: 'visual-indisponivel', nivel: 'ressalva' }] }
  assert.equal(exigeConferenciaHumana(laudo), true)
  assert.equal(conferenciaPendente({ laudo }), true)
})

test('ressalva comum não vai para a fila de conferência', () => {
  // Resolução abaixo do padrão é opinião formada, não cegueira. Mandar isso
  // para a fila entupiria a lista e ninguém olharia o que importa.
  const laudo = { achados: [{ id: 'resolucao', nivel: 'ressalva' }, { id: 'cor', nivel: 'ressalva' }] }
  assert.equal(exigeConferenciaHumana(laudo), false)
  assert.equal(conferenciaPendente({ laudo }), false)
})

test('depois de alguém conferir, sai da fila', () => {
  const laudo = { achados: [{ id: 'visual-indisponivel', nivel: 'ressalva' }] }
  assert.equal(conferenciaPendente({ laudo, conferencia: { em: '2026-08-31T12:00:00Z', por: 'ana@x' } }), false)
  // Marca vazia não conta: `conferencia: {}` seria um documento pela metade.
  assert.equal(conferenciaPendente({ laudo, conferencia: {} }), true)
})

test('envio sem laudo não inventa pendência', () => {
  // Arquivo de apoio não tem laudo — não é peça impressa, não tem o que olhar.
  assert.equal(conferenciaPendente({ tipoEnvio: 'avulso' }), false)
  assert.equal(conferenciaPendente(null), false)
})

// O caso real, do print de uma peça de 90 × 90 cm.
//
// O laudo dizia, na mesma tela: "O tamanho do arquivo não bate com o da peça —
// foi montado em 130 × 295 cm" e, oito linhas abaixo, "Proporção compatível com
// a peça — a arte encaixa no formato 90 × 90 cm sem corte relevante".
//
// Não era um erro de arredondamento: num PDF, `larguraPx`/`alturaPx` são
// derivados da MEDIDA DA PEÇA (ver `medirPdf`), então a regra de proporção
// comparava a peça consigo mesma e respondia "compatível" em todo PDF que já
// passou por aqui. Um laudo que se contradiz não é lido pela metade — ele para
// de ser lido.
test('em PDF, a proporção não é mais respondida com a medida da peça', () => {
  const peca = { larguraCm: 90, alturaCm: 90 }
  // Exatamente o que `medirPdf` entrega: px projetados na forma da peça.
  const px = Math.round((82.6 * 90) / 2.54)
  const r = avaliar({
    peca,
    perfil: balcao,
    medidas: {
      formato: 'pdf', formatoSuportado: true, paginas: 1,
      larguraPx: px, alturaPx: px,
      tamanhoDeclaradoCm: { largura: 130, altura: 295 },
    },
  })
  assert.equal(achado(r, 'proporcao'), undefined, 'PDF não pode responder sobre proporção pelos px projetados')
  const dim = achado(r, 'dimensao')
  assert.ok(dim && dim.nivel !== 'ok', 'o tamanho errado continua sendo apontado')
  // E nada no laudo pode afirmar que este arquivo encaixa na peça.
  for (const a of r.achados) {
    assert.ok(
      !/encaixa no formato/i.test(a.detalhe || ''),
      `um achado ainda diz que a arte encaixa: ${a.titulo}`,
    )
  }
})

test('em JPG a proporção continua sendo medida — ali os pixels são o arquivo', () => {
  // A regra não foi desligada: num raster `larguraPx` é o arquivo de verdade,
  // e é o único lugar onde essa pergunta tem resposta.
  const r = avaliar({
    peca: { larguraCm: 90, alturaCm: 90 },
    perfil: balcao,
    medidas: { formato: 'jpg', formatoSuportado: true, larguraPx: 4000, alturaPx: 1000 },
  })
  const a = achado(r, 'proporcao')
  assert.ok(a, 'raster desproporcional precisa ser apontado')
  assert.equal(a.nivel, 'bloqueante')
})
