import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  podeContestar, validarContestacao, validarDecisao, contestacaoParaEnvio,
  decisaoParaEnvio, estadoDaContestacao, contaComoEntrega, casosDeContestacao,
  placarPorMotivo, MINIMO_MOTIVO,
} from '../src/core/contestacao.js'
import { resumoDoProjeto } from '../src/core/fluxo.js'
import { estadoDaArte } from '../src/core/producao.js'

/*
  A contestação: a única porta por onde arte reprovada sobe.

  Ela existe porque a trava produzia um impasse sem saída — o cliente dizendo
  "minha arte está certa e a ferramenta reprova", e o time sem como conferir,
  porque o arquivo nunca chegava. O risco de introduzi-la é virar um
  desligador da análise, e é isso que a maior parte destes testes guarda.
*/

const reprovado = (achados) => ({ veredicto: 'reprovado', achados })

test('só arte reprovada pode ser contestada', () => {
  assert.equal(podeContestar({ veredicto: 'aprovado', achados: [] }).pode, false)
  assert.equal(podeContestar({ veredicto: 'ressalva', achados: [] }).pode, false)
  assert.equal(
    podeContestar(reprovado([{ id: 'dimensao', nivel: 'bloqueante', titulo: 'x' }])).pode,
    true,
  )
})

test('fonte não incorporada NÃO é contestável', () => {
  /*
    Não é questão de opinião nem de calibragem: o texto sai com outra fonte na
    produção, ou não sai. Abrir contestação aqui venderia esperança falsa e
    adiaria a descoberta para o dia da impressão, que é quando custa caro.
  */
  const r = podeContestar(reprovado([{ id: 'pdf-fontes', nivel: 'bloqueante', titulo: 'Fontes' }]))
  assert.equal(r.pode, false)
  assert.equal(r.motivo, 'insuperavel')
  // E a tela precisa ter o que dizer no lugar do caminho fechado.
  assert.match(r.explicacao, /incorporadas|curvas/)
})

test('um achado insuperável trava a contestação inteira', () => {
  // Mesmo que o time aceitasse o resto, o arquivo continuaria não podendo ser
  // impresso — contestar não levaria a lugar nenhum.
  const r = podeContestar(reprovado([
    { id: 'dimensao', nivel: 'bloqueante', titulo: 'Tamanho' },
    { id: 'pdf-fontes', nivel: 'bloqueante', titulo: 'Fontes' },
  ]))
  assert.equal(r.pode, false)
})

test('ressalva no meio não transforma aprovado em contestável', () => {
  assert.equal(podeContestar({ veredicto: 'reprovado', achados: [{ nivel: 'ressalva' }] }).pode, false)
})

// ------------------------------------------------ o que o cliente escreve

test('contestação exige texto com substância e nome', () => {
  // Sem mínimo, o campo vira um "ok" despachado no automático — e o log, que
  // existe para calibrar a ferramenta depois, não ensina nada a quem o ler.
  assert.equal(validarContestacao({ motivo: 'ok', nome: 'Ana' }).valido, false)
  assert.equal(validarContestacao({ motivo: 'x'.repeat(MINIMO_MOTIVO), nome: '' }).valido, false)
  assert.equal(validarContestacao({ motivo: 'x'.repeat(MINIMO_MOTIVO), nome: 'Ana' }).valido, true)
})

test('e-mail é opcional, mas não pode ser lixo', () => {
  const base = { motivo: 'x'.repeat(MINIMO_MOTIVO), nome: 'Ana' }
  assert.equal(validarContestacao({ ...base, email: '' }).valido, true)
  assert.equal(validarContestacao({ ...base, email: 'nao-e-email' }).valido, false)
  assert.equal(validarContestacao({ ...base, email: 'ana@x.com.br' }).valido, true)
})

test('a contestação nasce SEM decisão', () => {
  /*
    A linha que impede a porta virar bypass. Se o cliente pudesse mandar a
    decisão junto, ele se aprovaria sozinho e a contestação seria um jeito
    educado de desligar a análise. As regras do Firestore recusam a criação com
    `decisao` preenchida; aqui garantimos que o cliente nunca chega a montar uma.
  */
  const c = contestacaoParaEnvio({ motivo: 'x'.repeat(30), nome: 'Ana', email: 'A@X.com' })
  assert.equal('decisao' in c, false)
  assert.equal(c.email, 'a@x.com', 'e-mail normalizado')
})

// ------------------------------------------------ o que o time decide

test('a decisão exige motivo escrito NOS DOIS SENTIDOS', () => {
  /*
    É o que faz o log valer. Uma recusa sem motivo vira "não deu" na tela do
    cliente — exatamente a resposta que gerou a contestação — e não ensina nada
    a quem for ler os casos para calibrar a ferramenta.
  */
  assert.equal(validarDecisao({ aceita: false, motivo: 'não' }).valido, false)
  assert.equal(validarDecisao({ aceita: true, motivo: 'ok' }).valido, false)
  assert.equal(validarDecisao({ aceita: true, motivo: 'x'.repeat(MINIMO_MOTIVO) }).valido, true)
  assert.equal(validarDecisao({ aceita: false, motivo: 'x'.repeat(MINIMO_MOTIVO) }).valido, true)
})

test('decidir sem escolher aceitar ou recusar não vale', () => {
  assert.equal(validarDecisao({ motivo: 'x'.repeat(MINIMO_MOTIVO) }).valido, false)
  assert.equal(validarDecisao({ aceita: 'talvez', motivo: 'x'.repeat(MINIMO_MOTIVO) }).valido, false)
})

test('o estado da contestação sai do documento', () => {
  assert.equal(estadoDaContestacao({}), null)
  assert.equal(estadoDaContestacao({ contestacao: { motivo: 'a' } }), 'aguardando')
  assert.equal(estadoDaContestacao({ contestacao: { decisao: { aceita: true } } }), 'aceita')
  assert.equal(estadoDaContestacao({ contestacao: { decisao: { aceita: false } } }), 'recusada')
})

// ------------------------------- a peça contestada NÃO fecha o stand

test('contestada aguardando não conta como entrega', () => {
  // Se contasse, o stand apareceria "5 de 5" com uma peça que ninguém do time
  // olhou ainda — e a hora de descobrir isso seria a da montagem.
  assert.equal(contaComoEntrega({ contestacao: { motivo: 'a' } }), false)
  assert.equal(contaComoEntrega({ contestacao: { decisao: { aceita: true } } }), true)
  assert.equal(contaComoEntrega({ contestacao: { decisao: { aceita: false } } }), false)
  assert.equal(contaComoEntrega({}), true, 'envio sem contestação é o de sempre')
})

const comPecaContestada = () => ({
  token: 't',
  pecas: [{ id: 'p1', rotulo: 'Lona', larguraCm: 100, alturaCm: 100 }],
  entregas: {
    p1: { protocolo: 'AP-1', versao: 1, em: '2026-09-23T10:00:00Z', contestacao: { motivo: 'a', nome: 'Ana' } },
  },
})

test('o resumo do projeto NÃO conta a peça contestada como recebida', () => {
  const r = resumoDoProjeto(comPecaContestada())
  assert.equal(r.pecas[0].status, 'contestada')
  assert.equal(r.recebidas, 0, 'o arquivo chegou, mas nada foi aceito')
  assert.equal(r.contestadas, 1)
  assert.equal(r.completo, false, 'o stand não pode fechar com uma contestação aberta')
})

test('contestada também não vira cobrança do cliente', () => {
  // A bola está com o time. Cobrar o cliente por uma peça contestada é cobrá-lo
  // por algo que está com a gente — o jeito mais rápido de a contestação virar
  // briga.
  const r = resumoDoProjeto(comPecaContestada())
  assert.equal(r.aguardandoCliente, 0)
  assert.equal(r.pendentes.length, 0)
})

test('aceita a contestação, a peça passa a contar', () => {
  const p = comPecaContestada()
  p.entregas.p1.contestacao.decisao = { aceita: true, motivo: 'x'.repeat(30), em: '2026-09-23T12:00:00Z' }
  const r = resumoDoProjeto(p)
  assert.equal(r.pecas[0].status, 'recebida')
  assert.equal(r.recebidas, 1)
})

test('recusada a contestação, a peça volta a esperar arte nova', () => {
  const p = comPecaContestada()
  p.entregas.p1.contestacao.decisao = { aceita: false, motivo: 'x'.repeat(30), em: '2026-09-23T12:00:00Z' }
  const r = resumoDoProjeto(p)
  assert.equal(r.pecas[0].status, 'aguardando', 'o cliente precisa mandar outra versão')
  assert.equal(r.recebidas, 0)
})

test('o app de montagem NÃO vê contestada como aprovada', () => {
  /*
    O pior erro que esta ponte pode cometer. `estadoDaArte` casa condição a
    condição e cai em 'aprovada' no fim; sem uma linha para 'contestada', o
    produtor veria arte aprovada onde ninguém decidiu nada — e contaria com
    ela no dia da montagem.
  */
  assert.equal(estadoDaArte(resumoDoProjeto(comPecaContestada())), 'em_analise')
})

// ------------------------------------------------ o log que calibra

const caso = (id, aceita) => ({
  protocolo: `AP-${id}`,
  contestacao: { motivo: 'm', nome: 'Ana', em: `2026-09-2${id}T10:00:00Z`, decisao: { aceita, motivo: 'd' } },
  laudo: { achados: [{ id: 'dimensao', nivel: 'bloqueante', titulo: 'Tamanho não bate' }] },
  cadastro: { stand: 'A1', nome: 'LW' },
})

test('o log junta os TRÊS textos na mesma linha', () => {
  // Separados, ninguém cruza. Juntos, o padrão aparece — e achar o padrão é a
  // única razão de o log existir.
  const [c] = casosDeContestacao([caso(1, true)])
  assert.equal(c.motivosDaFerramenta[0].titulo, 'Tamanho não bate')
  assert.equal(c.alegacao, 'm')
  assert.equal(c.decisao.motivo, 'd')
})

test('o log ignora envios sem contestação', () => {
  assert.equal(casosDeContestacao([{ protocolo: 'x' }, caso(1, true)]).length, 1)
})

test('o placar aponta o limiar suspeito', () => {
  // Um achado que o time aceita quase sempre é limiar apertado demais. É esse
  // cruzamento que transforma a lista numa decisão de calibragem.
  const p = placarPorMotivo(casosDeContestacao([caso(1, true), caso(2, true), caso(3, false)]))
  assert.equal(p[0].id, 'dimensao')
  assert.equal(p[0].aceitas, 2)
  assert.equal(p[0].recusadas, 1)
  assert.equal(p[0].total, 3)
})

test('caso ainda sem decisão não entra no placar', () => {
  // Contar o indeciso inflaria um dos lados e faria alguém mexer num limiar
  // por causa de um caso que ninguém julgou.
  const aberto = { ...caso(1, true) }
  aberto.contestacao = { motivo: 'm', nome: 'Ana', em: '2026-09-21T10:00:00Z' }
  assert.deepEqual(placarPorMotivo(casosDeContestacao([aberto])), [])
})

// ------------------------------------------------ as regras do servidor

test('as regras só deixam subir arte reprovada COM contestação assinada', () => {
  const r = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const bloco = r.slice(r.indexOf('function veredictoPermiteEnvio'), r.indexOf('function envioDeApoioValido'))

  assert.match(bloco, /veredicto == 'reprovado' && contestacaoValida\(d\)/)
  assert.match(bloco, /motivo\.size\(\) >= 20/, 'texto com substância é exigido no servidor')
  assert.match(bloco, /nome\.size\(\) >= 3/, 'a assinatura é exigida no servidor')
  // A linha que impede o desvio virar bypass.
  assert.match(bloco, /!\('decisao' in d\.contestacao\)/)
})

test('a decisão não pode ser reescrita depois de tomada', () => {
  // Um histórico que uma das partes reescreve não resolve a discussão que
  // originou a contestação — que é o problema de origem.
  const r = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const bloco = r.slice(r.indexOf('match /envios/{protocolo}'), r.indexOf('match /projetos/{token}'))
  assert.match(bloco, /contestacao\.decisao == resource\.data\.contestacao\.decisao/)
})

test('o veredicto continua intocável, mesmo com contestação aceita', () => {
  /*
    Regravá-lo como aprovado apagaria o fato de que a análise reprovou — e é
    esse fato acumulado que o log existe para ler depois, atrás de limiar mal
    calibrado. A lista de campos alteráveis não pode conter `veredicto`.
  */
  const r = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const bloco = r.slice(r.indexOf('match /envios/{protocolo}'), r.indexOf('match /projetos/{token}'))
  const alteraveis = bloco.slice(bloco.indexOf('hasOnly(['), bloco.indexOf('])', bloco.indexOf('hasOnly([')))
  assert.doesNotMatch(alteraveis, /veredicto|laudo|cadastro|criadoEm/)
  assert.match(alteraveis, /contestacao/)
})
