import test from 'node:test'
import assert from 'node:assert/strict'
import { exigencia, avaliar, pisoPorDistancia, DPI_PISO_ABSOLUTO } from '../src/core/regras.js'
import { PERFIS_PADRAO } from '../src/data/perfis.js'

// O piso de densidade passa a sair da DISTÂNCIA em que a peça é vista, em vez
// de um número fixo para tudo.
//
// O caso que forçou isto: uma arte de 82 dpi numa parede de 100 × 265 cm foi
// REPROVADA aqui e aprovada à mão pelo time — que estava certo. A 2,5 m o ponto
// de 82 dpi mede 0,31 mm, menos da metade do que o olho distingue ali. E o
// próprio perfil `lona-parede` declara `dpiMin: 50`; quem reprovava era o piso
// fixo de 100 da empresa, escrito pensando em peça de perto.
//
// Ferramenta que reprova o que a pessoa aprova não é rigorosa — é contornada. E
// depois de contornada uma vez, para de ser lida.

const perfil = (id) => PERFIS_PADRAO.find((p) => p.id === id)
const medidasCom = (dpi, larguraCm, alturaCm) => ({
  formato: 'pdf',
  formatoSuportado: true,
  larguraPx: Math.round((dpi * larguraCm) / 2.54),
  alturaPx: Math.round((dpi * alturaCm) / 2.54),
})
const veredictoDe = (id, dpi, larguraCm, alturaCm) => avaliar({
  peca: { id: 'p', larguraCm, alturaCm },
  perfil: perfil(id),
  medidas: medidasCom(dpi, larguraCm, alturaCm),
  escalaFator: 1,
  politica: {},
  detectorNitidez: false,
}).veredicto

test('o caso real: 82 dpi numa parede deixa de ser reprovação', () => {
  assert.equal(veredictoDe('lona-parede', 82, 100, 265), 'ressalva')
})

test('a fronteira fica onde a distância manda, não onde a política mandava', () => {
  // 2,5 m → o olho separa 0,73 mm → com a margem de 2×, 70 dpi.
  assert.equal(exigencia(perfil('lona-parede'), {}).dpiPiso, 70)
  assert.equal(veredictoDe('lona-parede', 71, 100, 265), 'ressalva')
  assert.equal(veredictoDe('lona-parede', 69, 100, 265), 'reprovado')
})

test('peça vista de perto não é afrouxada', () => {
  // A 0,5 m a distância pediria 349 dpi, muito acima do piso da empresa. O
  // afrouxamento é de mão única: só relaxa o que a distância justifica, nunca
  // aperta o que já estava valendo.
  assert.equal(exigencia(perfil('adesivo-balcao'), {}).dpiPiso, 150)
  assert.equal(veredictoDe('adesivo-balcao', 120, 60, 40), 'reprovado')
})

test('nenhum perfil fica mais exigente do que era', () => {
  // A garantia que torna esta mudança segura de publicar: nada que passava
  // ontem começa a reprovar hoje. Sem ela, uma feira em andamento veria artes
  // já aceitas serem recusadas no reenvio.
  for (const p of PERFIS_PADRAO) {
    const antes = Math.max(p.dpiMin || 0, DPI_PISO_ABSOLUTO)
    const agora = exigencia(p, {}).dpiPiso
    assert.ok(agora <= antes, `${p.id}: piso subiu de ${antes} para ${agora}`)
    assert.ok(agora >= (p.dpiMin || 0), `${p.id}: piso ficou abaixo do que o próprio perfil pede`)
  }
})

test('o piso do perfil continua sendo intocável', () => {
  // "O piso do PERFIL nunca é afrouxado" é a promessa do desenho original, e
  // ela sobrevive: a distância limita o piso da EMPRESA, não o do perfil.
  const inventado = { distanciaM: 50, dpiMin: 120, dpiIdeal: 200 }
  assert.equal(exigencia(inventado, {}).dpiPiso, 120)
})

test('a conta de percepção bate com o que o simulador de distância diz', () => {
  // O simulador escreve "a 3,9 m o olho distingue detalhes a partir de 1,13 mm".
  // O piso é o dobro dessa densidade — ponto com metade do tamanho perceptível.
  const detalheMm = (d) => (25.4 / pisoPorDistancia(d)) * 2
  assert.ok(Math.abs(detalheMm(3.9) - 1.13) < 0.02, `deu ${detalheMm(3.9).toFixed(3)} mm`)
  assert.ok(Math.abs(detalheMm(2.5) - 0.73) < 0.02)
})

test('distância zero ou ausente não explode nem libera tudo', () => {
  // Perfil mal cadastrado não pode virar piso infinito (reprova tudo) nem zero
  // (aprova tudo). O chão de 10 cm mantém a conta num valor exigente e finito.
  for (const d of [0, null, undefined, -5]) {
    const piso = pisoPorDistancia(d)
    assert.ok(Number.isFinite(piso) && piso > 1000, `distância ${d} deu ${piso}`)
  }
})
