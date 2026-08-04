import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acessoDe, pode, alcancaFeira, feirasVisiveis, abasDe, telaInicial, PAPEIS,
} from '../src/core/permissoes.js'

// Permissão errada não dá erro na tela: dá um analista de cobrança aprovando
// arte, ou um analista completo que não enxerga a feira dele. Os dois passam
// despercebidos até doer, então valem teste.

test('registro antigo, sem papel, continua administrador', () => {
  // Quem foi cadastrado antes desta tela existir era admin de fato. Rebaixar
  // na migração trancaria o time inteiro para fora do painel de uma vez.
  const a = acessoDe({ nome: 'Cleiton' })
  assert.equal(a.papel, 'admin')
  assert.equal(a.todasAsFeiras, true)
  assert.equal(pode(a, 'gerenciarAnalistas'), true)
})

test('papel desconhecido não vira acesso vazio nem acesso total por acidente', () => {
  const a = acessoDe({ papel: 'inventado' })
  assert.equal(a.papel, 'admin', 'cai no padrão declarado, e não num papel sem permissão nenhuma')
})

test('cada papel pode exatamente o que promete', () => {
  const esperado = {
    admin: ['verArtes', 'cadastrarProjetos', 'cobrar', 'aprovar', 'gerenciarAnalistas'],
    completo: ['verArtes', 'cadastrarProjetos', 'cobrar', 'aprovar'],
    cadastro: ['verArtes', 'cadastrarProjetos'],
    cobranca: ['verArtes', 'cobrar'],
  }
  for (const [papel, permissoes] of Object.entries(esperado)) {
    assert.deepEqual(acessoDe({ papel }).permissoes, permissoes, papel)
  }
})

test('só o administrador mexe na lista de analistas', () => {
  for (const papel of Object.keys(PAPEIS)) {
    assert.equal(
      pode(acessoDe({ papel }), 'gerenciarAnalistas'),
      papel === 'admin',
      `${papel} não deveria promover ninguém`,
    )
  }
})

test('cobrança não aprova arte, cadastro não manda prova', () => {
  assert.equal(pode(acessoDe({ papel: 'cobranca' }), 'aprovar'), false)
  assert.equal(pode(acessoDe({ papel: 'cobranca' }), 'cadastrarProjetos'), false)
  assert.equal(pode(acessoDe({ papel: 'cadastro' }), 'aprovar'), false)
  assert.equal(pode(acessoDe({ papel: 'cadastro' }), 'cobrar'), false)
})

// ------------------------------------------------------------- escopo

test('o analista só alcança as feiras dele', () => {
  const a = acessoDe({ papel: 'completo', feiras: ['expo-sul-2026', 'petvet'] })
  assert.equal(a.todasAsFeiras, false)
  assert.equal(alcancaFeira(a, 'petvet'), true)
  assert.equal(alcancaFeira(a, 'outra-feira'), false)
})

test('o administrador alcança tudo, mesmo com lista de feiras gravada', () => {
  // O papel manda: gravar uma lista num admin não pode restringi-lo sem
  // ninguém perceber.
  const a = acessoDe({ papel: 'admin', feiras: ['so-esta'] })
  assert.equal(a.todasAsFeiras, true)
  assert.equal(alcancaFeira(a, 'qualquer-outra'), true)
})

test('"todas as feiras" pode ser dado a qualquer papel', () => {
  const a = acessoDe({ papel: 'cobranca', todasAsFeiras: true })
  assert.equal(alcancaFeira(a, 'feira-nova-de-amanha'), true)
  assert.equal(pode(a, 'aprovar'), false, 'ver todas as feiras não amplia o que ele faz')
})

test('feirasVisiveis filtra a lista do seletor', () => {
  const feiras = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const restrito = acessoDe({ papel: 'cadastro', feiras: ['a', 'c'] })
  assert.deepEqual(feirasVisiveis(restrito, feiras).map((f) => f.id), ['a', 'c'])
  assert.deepEqual(feirasVisiveis(acessoDe({}), feiras).map((f) => f.id), ['a', 'b', 'c'])
})

test('feira duplicada ou vazia não polui o escopo', () => {
  const a = acessoDe({ papel: 'completo', feiras: ['x', 'x', '', null, 'y'] })
  assert.deepEqual(a.feiras, ['x', 'y'])
})

// --------------------------------------------------------------- abas

test('as abas somem para quem não pode usá-las', () => {
  const abas = (papel) => abasDe(acessoDe({ papel })).map((x) => x.id)
  assert.deepEqual(abas('admin'), ['admin', 'projetos', 'analistas'])
  assert.deepEqual(abas('completo'), ['admin', 'projetos'])
  assert.deepEqual(abas('cadastro'), ['admin', 'projetos'])
  assert.deepEqual(abas('cobranca'), ['admin', 'projetos'])
})

test('a tela inicial é sempre uma que a pessoa consegue abrir', () => {
  for (const papel of Object.keys(PAPEIS)) {
    const acesso = acessoDe({ papel })
    const inicial = telaInicial(acesso)
    assert.ok(abasDe(acesso).some((a) => a.id === inicial), `${papel} abriria numa tela proibida`)
  }
})
