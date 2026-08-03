import test from 'node:test'
import assert from 'node:assert/strict'
import { avaliar, pxNecessarios, dpiEfetivo, especificacao, veredictoDe, exigencia, DPI_MINIMO_GLOBAL } from '../src/core/regras.js'
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

test('o piso da empresa se sobrepõe ao mínimo do perfil', () => {
  assert.equal(DPI_MINIMO_GLOBAL, 150)
  // lona tem dpiMin 50 no perfil, mas o piso manda
  assert.equal(exigencia(lona).dpiMin, 150)
  // e o ideal nunca fica abaixo do mínimo aplicável
  assert.equal(exigencia(lona).dpiIdeal, 150)
  // o balcão é mais exigente que o piso, então mantém o dele
  assert.equal(exigencia(balcao).dpiIdeal, 300)
  // o piso é configurável pelo time de CV
  assert.equal(exigencia(lona, 200).dpiMin, 200)
  assert.equal(exigencia(lona, 30).dpiMin, 50, 'piso menor não pode afrouxar o perfil')
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

test('abaixo do piso, reprova em qualquer peça', () => {
  const medidas = medidasRaster({ larguraPx: pxNecessarios(100, 120), alturaPx: pxNecessarios(100, 120) })
  const peca = { larguraCm: 100, alturaCm: 100 }
  for (const p of [lona, balcao, perfil('testeira')]) {
    assert.equal(avaliar({ peca, perfil: p, medidas }).veredicto, 'reprovado', p.nome)
  }
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

test('desvio pequeno de proporção vira ressalva, não reprovação', () => {
  // 3,6% fora da proporção: corta um pouco, mas não justifica travar a peça
  const r = avaliar({
    peca: pecaLona, perfil: lona,
    medidas: medidasRaster({ larguraPx: 12000, alturaPx: 16800 }),
  })
  assert.equal(achado(r, 'proporcao').nivel, 'ressalva')
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

test('especificação da peça inclui a sangria e respeita o piso', () => {
  const e = especificacao(pecaLona, lona)
  assert.equal(e.comSangria.larguraCm, 210) // 200 + 2*5cm
  assert.equal(e.minimo.largura, pxNecessarios(210, 150))
  assert.equal(e.ideal.dpi, 150)
  assert.equal(especificacao(pecaLona, balcao).ideal.dpi, 300)
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
