import test from 'node:test'
import assert from 'node:assert/strict'

// `visto.js` fala com o localStorage, que não existe no Node. Um dublê simples
// resolve — e vale a pena, porque o defeito que estes testes travam já chegou
// à operação: marcar como lido não apagava a bolinha da aba, e só sumia
// recarregando a página. Justamente o F5 que a escuta em tempo real veio
// eliminar.
const memoria = new Map()
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
}

const { vistoEm, marcarVisto, novosDesde, assinarVisto, dataEmMs } =
  await import('../src/store/visto.js')

const ANA = 'ana@empresa.com'
const JO = 'jo@empresa.com'

test('sem marca, tudo conta como novo', () => {
  assert.equal(vistoEm(ANA, 'envios:feira-x'), 0)
  const itens = [{ em: '2026-08-01T10:00:00Z' }, { em: '2026-08-02T10:00:00Z' }]
  assert.equal(novosDesde(itens, vistoEm(ANA, 'envios:feira-x')), 2)
})

test('marcar como visto zera a contagem daquele assunto', () => {
  const itens = [{ em: '2026-08-01T10:00:00Z' }, { em: '2026-08-02T10:00:00Z' }]
  marcarVisto(ANA, 'envios:feira-y', '2026-08-02T10:00:00Z')
  assert.equal(novosDesde(itens, vistoEm(ANA, 'envios:feira-y')), 0)

  // e o que chega DEPOIS volta a contar
  const comNovo = [...itens, { em: '2026-08-03T10:00:00Z' }]
  assert.equal(novosDesde(comNovo, vistoEm(ANA, 'envios:feira-y')), 1)
})

test('a marca nunca anda para trás', () => {
  marcarVisto(ANA, 'conversa:abc', '2026-08-10T10:00:00Z')
  marcarVisto(ANA, 'conversa:abc', '2026-08-01T10:00:00Z')
  assert.equal(vistoEm(ANA, 'conversa:abc'), Date.parse('2026-08-10T10:00:00Z'),
    'abrir uma tela antiga não pode "desver" o que já foi visto numa mais recente')
})

test('cada analista tem a própria marca', () => {
  marcarVisto(ANA, 'envios:feira-z', '2026-08-05T10:00:00Z')
  assert.equal(vistoEm(JO, 'envios:feira-z'), 0)
})

// O bug relatado: a bolinha da aba só sumia com F5. A contagem era feita dentro
// da escuta do Firestore, que não reexecuta quando alguém marca como lido —
// porque ler não muda documento nenhum. Daí o aviso.
test('marcar como visto avisa quem está desenhando bolinha', () => {
  let avisos = 0
  const cancelar = assinarVisto(() => { avisos += 1 })

  marcarVisto(ANA, 'envios:feira-w', '2026-08-06T10:00:00Z')
  assert.equal(avisos, 1)

  // marca que não avança não gera aviso à toa
  marcarVisto(ANA, 'envios:feira-w', '2026-08-01T10:00:00Z')
  assert.equal(avisos, 1)

  cancelar()
  marcarVisto(ANA, 'envios:feira-w', '2026-08-09T10:00:00Z')
  assert.equal(avisos, 1, 'depois de cancelar, ninguém mais é avisado')
})

test('a data aceita Timestamp do Firestore, Date e ISO', () => {
  const alvo = Date.parse('2026-08-20T00:00:00Z')
  assert.equal(dataEmMs({ seconds: alvo / 1000 }), alvo)
  assert.equal(dataEmMs(new Date(alvo)), alvo)
  assert.equal(dataEmMs('2026-08-20T00:00:00Z'), alvo)
  assert.equal(dataEmMs(null), 0)
})
