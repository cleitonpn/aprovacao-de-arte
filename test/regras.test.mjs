import test from 'node:test'
import assert from 'node:assert/strict'
import {
  avaliar, pxNecessarios, dpiEfetivo, especificacao, veredictoDe, exigencia,
  DPI_PISO_ABSOLUTO, DPI_MINIMO_GLOBAL, SANGRIA_MINIMA_MM,
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

  // Lona pede 50 dpi no perfil. O piso da empresa levanta os dois números:
  // abaixo de 100 não imprime, abaixo de 150 imprime fora do padrão.
  assert.equal(exigencia(lona).dpiPiso, 100)
  assert.equal(exigencia(lona).dpiMin, 150)
  assert.equal(exigencia(lona).dpiIdeal, 150)

  // O balcão já pede 150 no perfil, porque é visto a 50 cm. Nenhuma política
  // de empresa afrouxa isso: o piso dele continua 150, não 100.
  assert.equal(exigencia(balcao).dpiPiso, 150)
  assert.equal(exigencia(balcao).dpiIdeal, 300)

  // os pisos são configuráveis pelo time de CV
  assert.equal(exigencia(lona, { dpiMinimoGlobal: 200 }).dpiMin, 200)
  assert.equal(exigencia(lona, { dpiPisoAbsoluto: 120 }).dpiPiso, 120)
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

  const a90 = avaliar({ peca, perfil: lona, medidas: em(90) })
  assert.equal(a90.veredicto, 'reprovado', 'abaixo de 100 dpi não imprime')

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

test('escala de trabalho não faz o arquivo ser reprovado por dimensão', () => {
  // arte montada a 1:10 de uma peça de 200x290 cm => página de 20x29 cm
  const medidas = {
    formato: 'pdf', formatoSuportado: true, puroVetor: true, paginas: 1,
    tamanhoDeclaradoCm: { largura: 200, altura: 290 },
  }
  const r = avaliar({ peca: pecaLona, perfil: lona, medidas, escalaFator: 10 })
  assert.equal(achado(r, 'dimensao'), undefined)
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
