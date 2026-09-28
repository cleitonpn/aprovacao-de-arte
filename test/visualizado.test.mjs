import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ultimaMensagemVista, vistoAteQuando, temMensagemNova, CAMPO_VISTO,
} from '../src/core/conversa.js'

/*
  O "visualizado".

  Antes, "já vi" era uma marca no localStorage de quem olhava — serve para
  apagar a bolinha e nada mais. O outro lado não tem acesso a ela, e é
  justamente essa falta que faz alguém ligar perguntando "você viu o que eu
  mandei?". Agora a marca vai para o documento do projeto, uma por lado.
*/

const conversa = (msgs) => msgs.map((m, i) => ({ id: `m${i}`, ...m }))

const TROCA = conversa([
  { autor: 'cliente', texto: 'a lona tem parte coberta?', em: '2026-09-28T10:00:00Z' },
  { autor: 'time', texto: 'tem 12 cm atrás da estrutura', em: '2026-09-28T10:05:00Z' },
  { autor: 'time', texto: 'mandei o gabarito novo', em: '2026-09-28T10:06:00Z' },
])

test('o time vê "visualizado" quando o cliente abriu', () => {
  const vista = ultimaMensagemVista({
    mensagens: TROCA,
    ehTime: true,
    conversa: { [CAMPO_VISTO.cliente]: '2026-09-28T10:06:00Z' },
  })
  assert.equal(vista, 'm2', 'a última mensagem do time que o cliente viu')
})

test('só a ÚLTIMA vista recebe o recibo', () => {
  // Repetido embaixo de cada balão vira ruído. Embaixo da última, é a
  // informação que a pessoa procura: daqui para cima, ele leu.
  const vista = ultimaMensagemVista({
    mensagens: TROCA,
    ehTime: true,
    conversa: { [CAMPO_VISTO.cliente]: '2026-09-28T10:05:30Z' },
  })
  assert.equal(vista, 'm1', 'a de 10:06 ainda não foi vista')
})

test('sem marca do outro lado, não há recibo nenhum', () => {
  assert.equal(ultimaMensagemVista({ mensagens: TROCA, ehTime: true, conversa: {} }), null)
  assert.equal(ultimaMensagemVista({ mensagens: TROCA, ehTime: true, conversa: null }), null)
})

test('o recibo é sobre as MINHAS mensagens, nunca as do outro', () => {
  // Do lado do cliente, o que interessa é se o TIME leu o que ele escreveu.
  const vista = ultimaMensagemVista({
    mensagens: TROCA,
    ehTime: false,
    conversa: { [CAMPO_VISTO.time]: '2026-09-28T23:00:00Z' },
  })
  assert.equal(vista, 'm0', 'a única mensagem do cliente')
})

test('a marca é a hora da última mensagem DO OUTRO, não a do olhar', () => {
  /*
    A diferença aparece quando chega mensagem nova com a tela aberta: gravando
    o instante do olhar, a mensagem que chegou meio segundo depois contaria
    como vista sem ninguém ter lido — e o outro lado ficaria esperando uma
    resposta que ninguém sabe que precisa dar.
  */
  assert.equal(vistoAteQuando({ mensagens: TROCA, ehTime: false }), '2026-09-28T10:06:00Z')
  assert.equal(vistoAteQuando({ mensagens: TROCA, ehTime: true }), '2026-09-28T10:00:00Z')
})

test('conversa só com mensagens minhas não gera escrita', () => {
  // Sem nada do outro lado para ver, não há o que marcar — e gravar assim
  // mesmo custaria uma escrita por abertura, em toda conversa que começa com a
  // primeira pergunta do cliente.
  const so = conversa([{ autor: 'cliente', texto: 'oi', em: '2026-09-28T10:00:00Z' }])
  assert.equal(vistoAteQuando({ mensagens: so, ehTime: false }), null)
})

test('o recibo NÃO substitui a bolinha de novidade', () => {
  // São duas perguntas diferentes: "ele leu o meu?" e "chegou coisa nova para
  // mim?". A segunda continua saindo do localStorage de quem olha, porque é
  // por analista — e dois analistas não compartilham o "já vi".
  const resumo = { ultimoAutor: 'cliente', ultimaEm: '2026-09-28T11:00:00Z', [CAMPO_VISTO.cliente]: '2026-09-28T10:06:00Z' }
  assert.equal(temMensagemNova({ conversa: resumo, ehTime: true, vistoEmMs: 0 }), true)
})

test('gravar o resumo NÃO apaga a marca do outro lado', () => {
  /*
    O defeito que este teste existe para impedir, e ele seria sutil: gravar
    `conversa: {…}` substitui o mapa inteiro, então o recibo sumiria a cada
    mensagem nova — exatamente quando alguém responde, que é quando ninguém
    está olhando para ele.

    Caminhos pontuados mesclam; o mapa inteiro substitui.
  */
  const servico = readFileSync(new URL('../src/services/projetos.js', import.meta.url), 'utf8')
  const bloco = servico.slice(servico.indexOf('function resumirConversa'))
  // Sem os comentários: eles citam a forma proibida de propósito, para
  // explicar por que ela é proibida.
  const ate = bloco.slice(0, bloco.indexOf('\n}'))
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  assert.match(ate, /'conversa\.ultimaEm':/)
  assert.match(ate, /'conversa\.ultimoAutor':/)
  assert.doesNotMatch(ate, /conversa: \{/, 'gravar o mapa inteiro apagaria o visualizado')
})

test('a marca cabe no que as regras deixam o cliente escrever', () => {
  // O cliente é anônimo e só alcança alguns campos do projeto. `conversa` já
  // estava na lista — o recibo vive dentro dela de propósito, e não num campo
  // novo que exigiria afrouxar a regra.
  const regras = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const bloco = regras.slice(regras.indexOf('match /projetos/{token}'))
  const ate = bloco.slice(0, bloco.indexOf('match /projetos/{token}/reprovacoes'))
  assert.match(ate, /hasOnly\(\['entregas', 'pedidos', 'respostasProva', 'conversa'/)
})
