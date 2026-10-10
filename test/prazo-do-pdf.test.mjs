import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/*
  Nenhuma etapa do PDF pode esperar para sempre.

  O relato foi uma tela de análise parada cinco minutos no mesmo passo. A causa
  não era lentidão: era espera sem fim. Diante de uma arte que ele não dá conta
  de processar, o pdf.js não falha — fica. E "fica" na interface não tem saída:
  sem erro, sem veredicto, sem botão.

  São DUAS as etapas que podem ficar, e por muito tempo só uma delas tinha
  prazo:

  - desenhar a página (`render`), que entrega a miniatura;
  - ler a estrutura (`getOperatorList`), que entrega o dpi das imagens. Esta
    não é leitura de índice: o pdf.js interpreta a página inteira para montá-la,
    decodificando as imagens no caminho, e num arquivo pesado custa tanto
    quanto desenhar.

  Desistir não deixa o cliente sem resposta — deixa a peça sem miniatura ou sem
  dpi, e nos dois casos ela vai para a conferência humana. É um resultado pior
  que o ideal, e incomparavelmente melhor que uma tela parada.

  `comPrazo` é testada de verdade, com promessas que resolvem e que nunca
  resolvem. O resto do arranjo é verificado na fonte: montar o pdf.js inteiro
  aqui custaria mais do que o teste vale.
*/

// `comPrazo` mora fora do `pdf.js` justamente para ser testável sem DOM.
import { comPrazo } from '../src/core/prazo.js'

// Os prazos continuam no `pdf.js`, que exige navegador; aqui eles são lidos da
// fonte. Ler número de arquivo é feio, e é melhor que o teste do prazo ser
// PULADO fora do navegador — que foi como esta suíte nasceu, verde e cega.
const numeroDe = (nome) => {
  const m = fonte.match(new RegExp(`export const ${nome} = (\\d+)`))
  assert.ok(m, `não achei ${nome} em pdf.js`)
  return Number(m[1])
}

const fonte = readFileSync(new URL('../src/core/pdf.js', import.meta.url), 'utf8')

test('a promessa que resolve a tempo passa intacta', async () => {
  const valor = await comPrazo(Promise.resolve('pronto'), 1000, 'nao-deveria')
  assert.equal(valor, 'pronto')
})

test('a promessa que nunca resolve é abandonada no prazo', async () => {
  const eterna = new Promise(() => {})
  await assert.rejects(() => comPrazo(eterna, 30, 'prazo-de-teste'), /prazo-de-teste/)
})

test('a rejeição tardia não vira erro não tratado', async () => {
  // Depois do prazo ninguém mais escuta aquela promessa. Sem o `catch` solto,
  // a rejeição que chega atrasada vira ruído no console do cliente — bem no
  // momento em que ele já está com um problema.
  const avulsos = []
  const ouvir = (e) => avulsos.push(e)
  process.on('unhandledRejection', ouvir)

  let falhar
  const lenta = new Promise((_, rejeitar) => { falhar = rejeitar })
  await assert.rejects(() => comPrazo(lenta, 20, 'prazo-de-teste'), /prazo-de-teste/)
  falhar(new Error('cheguei tarde'))
  await new Promise((r) => setTimeout(r, 60))

  process.off('unhandledRejection', ouvir)
  assert.deepEqual(avulsos, [])
})

test('o prazo da estrutura é mais curto que o do render', () => {
  // O render entrega a miniatura que o cliente vê, e vale esperar por ela. A
  // estrutura entrega o dpi, e sem ele a peça vai para a conferência humana —
  // que é para onde ela iria de qualquer jeito num arquivo que não abre.
  assert.ok(numeroDe('PRAZO_ESTRUTURA_MS') < numeroDe('PRAZO_RENDER_MS'))
  assert.ok(numeroDe('PRAZO_RENDER_MS') >= 60000, 'prazo curto demais tira a miniatura de quem não fez nada de errado')
})

test('as duas etapas que podem travar têm prazo', () => {
  assert.match(fonte, /Promise\.race\(\[tarefa\.promise, prazo\]\)/, 'o render ficou sem prazo')
  const comPrazoNaEstrutura = [...fonte.matchAll(/comPrazo\(\s*pagina\.getOperatorList\(\)/g)]
  assert.equal(
    comPrazoNaEstrutura.length, 2,
    'toda chamada a `getOperatorList` precisa de prazo: o pdf.js guarda a lista '
    + 'por página, então a segunda herda a espera da primeira',
  )
})

test('estrutura não lida nunca é confundida com arte só de vetor', () => {
  // "Nenhuma imagem encontrada" e "não deu tempo de procurar" são a mesma coisa
  // na lista vazia, e coisas opostas no veredicto: tratar a segunda como pureza
  // vetorial aprovaria por resolução uma arte cujo raster ninguém viu.
  const bloco = fonte.slice(fonte.indexOf('function finalizar'))
  assert.match(bloco, /puroVetor = !info\.estruturaIncompleta/)
})
