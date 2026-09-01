import test from 'node:test'
import assert from 'node:assert/strict'
import { analisar, PISO_DA_ETAPA_MS } from '../src/core/analise.js'
import { PERFIS_PADRAO } from '../src/data/perfis.js'

// As etapas que a tela de espera mostra.
//
// Elas existem por um motivo que não é técnico: numa arte de 1,8 MB a análise
// inteira leva uns 200 ms, as cinco etapas passam antes de o navegador pintar a
// primeira, e o cliente vê a tela piscar e cuspir um veredicto. Isso não parece
// rápido — parece que nada foi conferido, e a desconfiança recai justamente
// sobre o "aprovado".
//
// O que estes testes travam é a honestidade do arranjo: o piso segura a etapa
// na tela, mas não inventa etapa, não muda a ordem e não soma tempo a quem já
// estava demorando.

const perfil = PERFIS_PADRAO.find((p) => p.id === 'lona-parede')
const peca = { id: 'p', larguraCm: 100, alturaCm: 200 }

/** Um arquivo que a ferramenta reconhece e recusa — sai antes de tocar no DOM. */
const arquivoNaoSuportado = () => {
  const blob = new Blob([new Uint8Array([0x43, 0x44, 0x52, 0x00, 1, 2, 3, 4])])
  blob.name = 'arte.cdr'
  return blob
}

async function etapasDe(opcoes = {}) {
  const vistas = []
  const r = await analisar(arquivoNaoSuportado(), peca, perfil, {
    pisoDaEtapaMs: 0,
    aoAndar: (e) => vistas.push(e),
    ...opcoes,
  })
  return { vistas, r }
}

test('as etapas são anunciadas na ordem em que acontecem', async () => {
  const { vistas } = await etapasDe()
  assert.deepEqual(vistas.slice(0, 2), ['lendo', 'abrindo'])
  // A última é sempre "pronto": é ela que fecha a lista com tudo marcado.
  assert.equal(vistas.at(-1), 'pronto')
  // Nenhuma etapa repetida — repetir faria a lista andar para trás na tela.
  assert.equal(new Set(vistas).size, vistas.length)
})

test('o piso segura cada etapa, e a conta bate', async () => {
  // Só o limite INFERIOR é afirmado: uma máquina lenta faz o número subir, e
  // isso não é defeito. O que quebraria de verdade — o piso não segurando
  // nada — faz o número cair, e é isso que a asserção pega.
  const piso = 40
  const inicio = Date.now()
  const { vistas } = await etapasDe({ pisoDaEtapaMs: piso })
  const gasto = Date.now() - inicio
  const minimo = piso * vistas.length * 0.7
  assert.ok(gasto >= minimo, `${gasto} ms é menos que o piso de ${vistas.length} etapas`)
})

test('piso zero não espera nada — é assim que os testes rodam', async () => {
  // Medido POR COMPARAÇÃO, e não contra um número de milissegundos.
  //
  // A primeira versão afirmava "menos de 150 ms" e falhou uma vez com a
  // máquina ocupada — sem nada de errado no código. Teste de relógio com
  // limite absoluto é o que ensina um time a rodar a suíte de novo até passar,
  // e a partir daí a suíte não reprova mais nada.
  const cronometrar = async (piso) => {
    const inicio = Date.now()
    await etapasDe({ pisoDaEtapaMs: piso })
    return Date.now() - inicio
  }
  const semPiso = await cronometrar(0)
  const comPiso = await cronometrar(80)
  assert.ok(comPiso > semPiso + 80, `com piso ${comPiso} ms, sem piso ${semPiso} ms`)
})

test('etapa que já demora ABSORVE o piso, em vez de somar a ele', async () => {
  // A garantia que torna isto aceitável numa arte pesada: o piso é um MÍNIMO de
  // exibição, não uma pausa. Sem ela, a arte de 138 MB — que já é a que mais
  // demora — seria também a mais penalizada.
  //
  // Medido por diferença, e não por tempo absoluto: um teste de relógio que
  // afirma "menos de 210 ms" quebra na primeira máquina lenta e ensina a
  // ignorá-lo. A conta aqui é estável porque compara a MESMA análise com e sem
  // trabalho no meio.
  //
  // O trabalho lento entra em `arrayBuffer()`, que é o que de fato acontece
  // entre "lendo" e "abrindo". Uma versão anterior deste teste punha a demora
  // dentro do próprio `aoAndar` e media a si mesma: ali o trabalho acontece
  // ANTES de a etapa ser marcada como mostrada, e o piso seguinte é cobrado
  // inteiro — com razão.
  const piso = 40
  const trabalho = 200
  const arquivo = (demora) => ({
    name: 'arte.cdr',
    size: 8,
    async arrayBuffer() {
      if (demora) await new Promise((r) => setTimeout(r, demora))
      return new Uint8Array([0x43, 0x44, 0x52, 0x00, 1, 2, 3, 4]).buffer
    },
  })
  const cronometrar = async (demora) => {
    const inicio = Date.now()
    await analisar(arquivo(demora), peca, perfil, { pisoDaEtapaMs: piso, aoAndar: () => {} })
    return Date.now() - inicio
  }

  const rapido = await cronometrar(0)
  const lento = await cronometrar(trabalho)

  // Se o piso somasse, a diferença seria o trabalho inteiro. Como ele é
  // absorvido, a diferença é o trabalho MENOS o piso que ele engoliu.
  assert.ok(
    lento - rapido < trabalho - piso / 2,
    `a diferença foi ${lento - rapido} ms para ${trabalho} ms de trabalho: o piso está somando`,
  )
  assert.ok(lento >= trabalho, `${lento} ms: o trabalho nem aconteceu`)
})

test('o piso padrão existe e é curto o bastante para não irritar', () => {
  // Cinco etapas: o cliente espera cerca de um segundo e meio no arquivo
  // pequeno. Acima disso a espera deixa de comunicar cuidado e passa a
  // comunicar lentidão.
  assert.ok(PISO_DA_ETAPA_MS >= 150 && PISO_DA_ETAPA_MS <= 450, `${PISO_DA_ETAPA_MS} ms`)
})

test('sem quem escute, a análise não quebra', async () => {
  // O painel do time e a ferramenta aberta chamam `analisar` sem `aoAndar`.
  const r = await analisar(arquivoNaoSuportado(), peca, perfil, { pisoDaEtapaMs: 0 })
  assert.equal(r.veredicto, 'reprovado')
})
