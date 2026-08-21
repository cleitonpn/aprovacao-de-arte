import test from 'node:test'
import assert from 'node:assert/strict'
import { panorama, situacaoDoProjeto } from '../src/core/painel.js'
import {
  eventoDeReprovacao, motivosDeReprovacao, motivosMaisComuns,
  dificuldadeDoProjeto, chaveDaTentativa, LIMITE_REPROVACOES,
} from '../src/core/reprovacoes.js'
import { filtroDeFase } from '../src/core/fluxo.js'

const AGORA = Date.parse('2026-08-10T12:00:00Z')
const DIA = 24 * 60 * 60 * 1000

const lona = { id: 'p_lona', rotulo: 'Lona de fundo', larguraCm: 275, alturaCm: 275 }
const testeira = { id: 'p_test', rotulo: 'Testeira', larguraCm: 150, alturaCm: 50 }

const stand = (nome, extra = {}) => ({
  token: `tok_${nome}`,
  stand: nome,
  expositor: `Empresa ${nome}`,
  pecas: [lona, testeira],
  ...extra,
})

const envio = (pecaId) => ({ pecaId, tipoEnvio: 'arte', protocolo: `AP-${pecaId}` })

const linha = (projeto, envios = [], temMensagemNova = false) => ({
  projeto,
  sit: situacaoDoProjeto(projeto, envios),
  temMensagemNova,
})

// ---------------------------------------------------------------- panorama

test('o panorama separa a conta de stands da conta de artes', () => {
  // A confusão clássica deste tipo de painel: 75% das artes recebidas pode ser
  // um stand pronto e outro parado, ou dois pela metade. Trabalhos opostos.
  const p = panorama([
    linha(stand('A'), [envio('p_lona'), envio('p_test')]),
    linha(stand('B'), [envio('p_lona')]),
  ])
  assert.equal(p.stands, 2)
  assert.equal(p.artes.total, 4)
  assert.equal(p.artes.recebidas, 3)
  assert.equal(p.artes.pct, 75)
  assert.equal(p.completos, 1, 'só o stand A fechou a lista')
  assert.equal(p.incompletos.length, 1)
})

test('quem não mandou NADA é separado de quem mandou pela metade', () => {
  const p = panorama([
    linha(stand('A')),
    linha(stand('B'), [envio('p_lona')]),
  ])
  assert.equal(p.semNada.length, 1)
  assert.equal(p.semNada[0].projeto.stand, 'A')
  // Os dois estão incompletos, mas só um precisa de um telefonema diferente.
  assert.equal(p.incompletos.length, 2)
  assert.equal(p.incompletos[0].projeto.stand, 'A', 'o mais atrasado vem primeiro')
})

test('a esteira soma as peças por estado e omite os estados vazios', () => {
  const emProducao = stand('C', {
    entregas: {
      p_lona: { protocolo: 'AP-1', versao: 1, em: '2026-08-01T10:00:00Z' },
      p_test: { protocolo: 'AP-2', versao: 1, em: '2026-08-01T10:00:00Z' },
    },
    controle: { pecas: { p_lona: { status: 'em_impressao' } } },
  })
  const p = panorama([linha(emProducao, [envio('p_lona'), envio('p_test')])])
  const porId = Object.fromEntries(p.esteira.map((f) => [f.id, f.n]))
  assert.equal(porId.em_impressao, 1)
  assert.equal(porId.recebida, 1)
  assert.equal(porId.aguardando, undefined, 'estado sem nenhuma peça não vira faixa')
  assert.equal(p.pecasTotal, 2)
})

test('"precisa de você" é a fila do time, não um resumo do que existe', () => {
  const comPedido = stand('D', {
    entregas: { p_lona: { protocolo: 'AP-1', versao: 1, em: '2026-08-01T10:00:00Z' } },
    pedidos: { p_lona: { motivo: 'trocamos a foto', paraVersao: 2, em: '2026-08-02T10:00:00Z' } },
  })
  const p = panorama([
    linha(comPedido, [envio('p_lona')]),
    linha(stand('E'), [], true),
  ])
  assert.equal(p.acoes.pedidos.length, 1)
  assert.equal(p.acoes.mensagens.length, 1)
  assert.equal(p.aFazer, 2)
})

test('o prazo do painel é o da feira, não o de um stand prorrogado', () => {
  const prorrogado = stand('F', { prorrogadoAte: '2026-09-30T23:59:59Z' })
  const p = panorama([linha(prorrogado)], {
    feira: { prazoEnvio: '2026-08-20T23:59:59Z' },
    agora: AGORA,
  })
  assert.equal(p.prazo.temPrazo, true)
  assert.equal(p.prazo.vencido, false)
  assert.equal(p.prazo.diasRestantes, Math.ceil((Date.parse('2026-08-20T23:59:59Z') - AGORA) / DIA))
  assert.equal(p.prazo.prorrogado, false, 'a exceção de um stand não move o prazo da feira')
})

test('feira sem projeto nenhum não quebra o painel', () => {
  const p = panorama([])
  assert.equal(p.stands, 0)
  assert.equal(p.artes.pct, 0)
  assert.equal(p.aFazer, 0)
  assert.deepEqual(p.esteira, [])
})

// ------------------------------------------------------------ reprovações

const resultadoReprovado = {
  veredicto: 'reprovado',
  achados: [
    { id: 'dpi', nivel: 'bloqueante', titulo: 'Resolução muito abaixo do mínimo', acao: 'Exporte com mais pixels.' },
    { id: 'cor', nivel: 'ressalva', titulo: 'Sem perfil de cor' },
    { id: 'ok', nivel: 'ok', titulo: 'Sangria correta' },
  ],
  medidas: { arquivo: { nome: 'lona.jpg', tamanho: 120000, hash: 'abc123' }, formato: 'jpeg' },
  resolucao: { dpi: 42.6, minimo: { dpi: 100 } },
}

test('só o que bloqueou entra no log — ressalva e informativo ficam de fora', () => {
  const motivos = motivosDeReprovacao(resultadoReprovado)
  assert.equal(motivos.length, 1)
  assert.equal(motivos[0].id, 'dpi')
})

test('o evento guarda o suficiente para o analista entender sem o arquivo', () => {
  const e = eventoDeReprovacao({ peca: lona, resultado: resultadoReprovado, versao: 2 })
  assert.equal(e.pecaId, 'p_lona')
  assert.equal(e.pecaRotulo, 'Lona de fundo')
  assert.equal(e.versao, 2)
  assert.equal(e.dpi, 43, 'arredondado — 42,6 dpi não ajuda ninguém')
  assert.equal(e.dpiExigido, 100)
  assert.equal(e.arquivo.nome, 'lona.jpg')
  assert.equal(e.arquivo.sha256, 'abc123')
  assert.equal(e.motivos.length, 1)
  assert.ok(Date.parse(e.em), 'a data precisa ser legível')
  // Nada de `undefined`: o Firestore recusa o documento inteiro por um só
  // campo assim, e o registro sumiria em silêncio.
  for (const [chave, valor] of Object.entries(e)) {
    assert.notEqual(valor, undefined, `${chave} veio undefined`)
  }
})

test('o mesmo arquivo na mesma peça é uma tentativa só', () => {
  const a = chaveDaTentativa('tok', 'p_lona', resultadoReprovado)
  const b = chaveDaTentativa('tok', 'p_lona', resultadoReprovado)
  const outraPeca = chaveDaTentativa('tok', 'p_test', resultadoReprovado)
  assert.equal(a, b)
  assert.notEqual(a, outraPeca)
})

test('sem hash, o nome e o tamanho servem de chave', () => {
  const semHash = { medidas: { arquivo: { nome: 'x.jpg', tamanho: 10 } } }
  const outro = { medidas: { arquivo: { nome: 'x.jpg', tamanho: 11 } } }
  assert.notEqual(chaveDaTentativa('t', 'p', semHash), chaveDaTentativa('t', 'p', outro))
})

test('o alerta sobe acima do limite, não nele', () => {
  const com = (n) => dificuldadeDoProjeto({ dificuldade: { reprovacoes: n } })
  assert.equal(com(LIMITE_REPROVACOES).alerta, false)
  assert.equal(com(LIMITE_REPROVACOES + 1).alerta, true)
  assert.equal(dificuldadeDoProjeto({}).total, 0)
  assert.equal(dificuldadeDoProjeto(null).alerta, false)
})

test('o motivo mais frequente é o que o analista vai falar ao telefone', () => {
  const comuns = motivosMaisComuns([
    { motivos: [{ titulo: 'Resolução baixa', acao: 'Exporte maior.' }] },
    { motivos: [{ titulo: 'Resolução baixa' }, { titulo: 'Formato não aceito' }] },
    { motivos: [{ titulo: 'Resolução baixa' }] },
  ])
  assert.equal(comuns[0].titulo, 'Resolução baixa')
  assert.equal(comuns[0].vezes, 3)
  assert.equal(comuns[0].acao, 'Exporte maior.', 'a ação sobrevive mesmo vindo de outra tentativa')
  assert.equal(comuns[1].vezes, 1)
})

test('o stand que penou entra na fatia "precisam de ajuda" e no painel', () => {
  const penando = stand('G', { dificuldade: { reprovacoes: 5, ultimaEm: '2026-08-09T10:00:00Z' } })
  const sit = situacaoDoProjeto(penando, [])
  assert.equal(sit.dificuldade.alerta, true)
  assert.equal(filtroDeFase('dificuldade')(sit), true)

  const p = panorama([linha(penando), linha(stand('H'))])
  assert.equal(p.acoes.dificuldade.length, 1)
  assert.equal(p.acoes.dificuldade[0].projeto.stand, 'G')
  assert.equal(p.aFazer, 1, 'ajudar um cliente travado é trabalho do time como outro qualquer')
})

test('quem tentou e foi reprovado não se confunde com quem não começou', () => {
  // Os dois têm zero artes. Só um precisa de ajuda; o outro, de cobrança.
  const travado = stand('I', { dificuldade: { reprovacoes: 6, ultimaEm: '2026-08-09T10:00:00Z' } })
  const parado = stand('J')
  const p = panorama([linha(travado), linha(parado)])

  assert.equal(p.semNada.length, 2, 'no número cru eles são idênticos')
  assert.equal(p.acoes.dificuldade.length, 1, 'e o painel sabe distinguir os dois')
  assert.equal(p.acoes.dificuldade[0].projeto.stand, 'I')
})

// ------------------------------------------- a esteira como ponto de partida
//
// A barra respondia "quantas" e parava aí. "De quem?" é sempre a pergunta
// seguinte, e ela levava a abrir a lista inteira e conferir stand por stand.

test('cada faixa carrega os stands que a compõem, do maior para o menor', () => {
  const entregue = { protocolo: 'AP', versao: 1, em: '2026-08-01T10:00:00Z' }
  const umaPeca = stand('A', { entregas: { p_lona: entregue } })
  const duasPecas = stand('B', { entregas: { p_lona: entregue, p_test: entregue } })

  const p = panorama([
    linha(umaPeca, [envio('p_lona')]),
    linha(duasPecas, [envio('p_lona'), envio('p_test')]),
  ])
  const recebida = p.esteira.find((f) => f.id === 'recebida')

  assert.equal(recebida.n, 3)
  assert.equal(recebida.stands.length, 2)
  assert.equal(recebida.stands[0].projeto.stand, 'B', 'quem tem mais peças vem primeiro')
  assert.deepEqual(recebida.stands[0].pecas, ['Lona de fundo', 'Testeira'])
  assert.deepEqual(recebida.stands[1].pecas, ['Lona de fundo'])

  // Um stand só entra na faixa em que de fato tem peça.
  const aguardando = p.esteira.find((f) => f.id === 'aguardando')
  assert.deepEqual(aguardando.stands.map((s) => s.projeto.stand), ['A'])
})

// O rótulo do cliente diz "sua aprovação" — no painel do time isso apontaria
// para o analista, que é o contrário de quem está sendo esperado.
test('a esteira usa o rótulo do time, não o do cliente', () => {
  const comProva = stand('E', {
    entregas: { p_lona: { protocolo: 'AP-1', versao: 1, em: '2026-08-01T10:00:00Z' } },
    controle: {
      provas: { pr1: { pecaIds: ['p_lona'], versoes: { p_lona: 1 }, enviadaEm: '2026-08-02T10:00:00Z' } },
    },
  })
  const p = panorama([linha(comProva, [envio('p_lona')])], { agora: AGORA })
  const faixa = p.esteira.find((f) => f.id === 'em_prova')

  assert.equal(faixa.rotulo, 'Prova aguardando o cliente')
  assert.doesNotMatch(faixa.rotulo, /sua/i, 'no painel, "sua" apontaria para o analista')
})
