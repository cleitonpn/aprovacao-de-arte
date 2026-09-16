import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projetoNovo, normalizarProjeto } from '../src/data/projeto.js'

/*
  O recado que o time escreve para UM stand e o cliente lê em destaque.

  O caso que motivou o campo: um stand em que só o balcão leva arte impressa e
  todas as demais peças são logo em acrílico com LED. Ali o cliente não deve
  mandar arte, e sim o logo em vetor — e sem um lugar para dizer isso, ou ele
  manda arte que ninguém vai usar, ou trava e liga para o atendimento.
*/

const recado = 'Só o balcão leva arte impressa.\nAs demais peças são logo em acrílico com LED: mande o logo em vetor.'

test('o recado sobrevive à gravação', () => {
  /*
    `normalizarProjeto` é uma lista BRANCA: campo que não está nela é descartado
    em SILÊNCIO na hora de gravar. É o modo de falha mais caro deste arquivo —
    o analista escreve o recado, salva, a tela não reclama de nada, e o cliente
    nunca vê. Já aconteceu antes com o elo da produção.
  */
  const gravado = normalizarProjeto(projetoNovo({
    feira: 'F', expositor: 'E', stand: 'S', aviso: recado,
  }))
  assert.equal(gravado.aviso, recado)
})

test('as quebras de linha sobrevivem — a lista não pode virar parágrafo', () => {
  // Quem escreve isso digita um item por linha. Perder as quebras transforma a
  // lista num bloco corrido, que é exatamente o que ninguém lê.
  const gravado = normalizarProjeto(projetoNovo({ feira: 'F', stand: 'S', aviso: recado }))
  assert.equal(gravado.aviso.split('\n').length, 2)
})

test('projeto sem recado grava string vazia, não `undefined`', () => {
  // `undefined` num campo faz o Firestore recusar a gravação inteira — o
  // projeto não salva e o erro não diz qual campo causou.
  const gravado = normalizarProjeto(projetoNovo({ feira: 'F', stand: 'S' }))
  assert.equal(gravado.aviso, '')
  assert.notEqual(gravado.aviso, undefined)
})

test('o recado tem teto, e o teto corta em vez de recusar', () => {
  // 600 caracteres cabe um parágrafo de verdade e não cabe um manual. Cortar é
  // melhor que recusar: um cadastro que falha na hora de salvar por causa do
  // tamanho de um campo opcional é pior que um recado truncado.
  const gravado = normalizarProjeto(projetoNovo({ feira: 'F', stand: 'S', aviso: 'x'.repeat(900) }))
  assert.equal(gravado.aviso.length, 600)
})

test('as duas telas que mostram o recado usam o mesmo campo', () => {
  /*
    Guarda de fiação, não de lógica. O campo só serve para alguma coisa se as
    três pontas concordarem: o formulário que escreve, a tela do cliente que
    mostra e a ficha do time que espelha. Uma ponta com outro nome não quebra
    teste nenhum de função pura — simplesmente não aparece.
  */
  const arquivo = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8')

  assert.match(
    arquivo('../src/components/Projetos.jsx'), /alterar\('aviso'/,
    'o formulário do time precisa escrever em `aviso`',
  )
  assert.match(
    arquivo('../src/components/Projeto.jsx'), /AvisoDoTime texto=\{projeto\.aviso\}/,
    'a tela do cliente precisa mostrar `projeto.aviso`',
  )
  assert.match(
    arquivo('../src/components/PainelProjeto.jsx'), /projeto\.aviso/,
    'a ficha do time precisa espelhar o recado para o analista não contradizê-lo',
  )
})

test('o recado do cliente aparece ANTES do prazo na tela', () => {
  // A ordem é a regra: o recado muda o que o cliente deve FAZER, e lê-lo
  // depois de já ter descido até a lista de peças é lê-lo tarde demais — a
  // essa altura ele abriu o gabarito da peça que não leva arte.
  const tela = readFileSync(new URL('../src/components/Projeto.jsx', import.meta.url), 'utf8')
  const aviso = tela.indexOf('<AvisoDoTime')
  const prazo = tela.indexOf('<AvisoPrazo')
  assert.ok(aviso > 0 && prazo > 0, 'os dois blocos precisam existir')
  assert.ok(aviso < prazo, 'o recado do time vem antes do aviso de prazo')
})
