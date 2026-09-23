import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dificuldadeDoProjeto } from '../src/core/reprovacoes.js'

// ------------------------------------------- a saída do alerta de dificuldade
//
// O alerta sumia quando alguém ABRIA a ficha, e isso era local do navegador:
// voltava para o resto do time no dia seguinte. O stand ficava marcado para
// sempre, mesmo depois de o analista ter resolvido por telefone — e alerta que
// não se apaga vira paisagem, até o próximo caso de verdade passar batido.

test('conversa registrada cala o alerta de dificuldade', () => {
  const p = { dificuldade: { reprovacoes: 6 }, controle: { contato: { reprovacoesAte: 6 } } }
  const d = dificuldadeDoProjeto(p)
  assert.equal(d.alerta, false)
  assert.equal(d.atendido, true)
  assert.equal(d.total, 6, 'o número continua visível na ficha; o que cala é o alerta')
})

test('o alerta volta na tentativa reprovada seguinte', () => {
  // Por CONTAGEM, e não por tempo: aqui existe um evento novo capaz de dizer
  // que a conversa não resolveu — o cliente tentar de novo e ser recusado de
  // novo. Enquanto ele não tentar, não há notícia nenhuma.
  const p = { dificuldade: { reprovacoes: 7 }, controle: { contato: { reprovacoesAte: 6 } } }
  const d = dificuldadeDoProjeto(p)
  assert.equal(d.alerta, true)
  assert.equal(d.atendido, false)
})

test('conversa em stand que ainda não passou do limite não inventa alerta', () => {
  const p = { dificuldade: { reprovacoes: 2 }, controle: { contato: { reprovacoesAte: 2 } } }
  assert.equal(dificuldadeDoProjeto(p).alerta, false)
})

test('sem conversa registrada, nada muda no comportamento antigo', () => {
  assert.equal(dificuldadeDoProjeto({ dificuldade: { reprovacoes: 4 } }).alerta, true)
  assert.equal(dificuldadeDoProjeto({ dificuldade: { reprovacoes: 4 } }).atendido, false)
})

// --------------------------------- a medida que o cliente tentou mandar
//
// A conversa que motivou o campo, e que não tinha como ser ganha: o cliente
// liga dizendo "a arte está em alta, tem qualidade, por que reprovou?" — e
// tem razão sobre o dpi, que era a única coisa que o registro mostrava. O
// motivo real aparecia como frase, sem os números que a sustentam.

import { eventoDeReprovacao } from '../src/core/reprovacoes.js'

/** Uma lona de 570 × 275 cm que o cliente mandou no DOBRO do tamanho. */
const dobro = () => eventoDeReprovacao({
  peca: { id: 'p1', rotulo: 'Lona parede fundo', larguraCm: 570, alturaCm: 275 },
  resultado: {
    escalaFator: 1,
    medidas: {
      formato: 'pdf',
      arquivo: { nome: 'AUTO-AVALIAR-LONA.pdf', tamanho: 12345, hash: 'abc' },
      tamanhoDeclaradoCm: { largura: 1140, altura: 550 },
      // Em PDF estes DOIS são coisas diferentes, e é o segundo que vale.
      larguraPx: 6732, alturaPx: 3248,
      pixelsDaImagem: { largura: 13464, altura: 6496 },
    },
    resolucao: { dpi: 300, minimo: { dpi: 150 }, sangriaMm: 100 },
    achados: [{ id: 'dimensao', nivel: 'bloqueante', titulo: 'O tamanho do arquivo não bate com o da peça' }],
  },
})

test('a reprovação guarda o tamanho enviado e o tamanho da peça', () => {
  const r = dobro()
  assert.deepEqual(r.medida.arquivoCm, { largura: 1140, altura: 550 }, 'o que o cliente mandou')
  assert.deepEqual(r.medida.pecaCm, { largura: 570, altura: 275 }, 'o que a peça pedia')
  // Com estes dois números o analista tem o argumento concreto. Sem eles, a
  // frase "não bate com o da peça" é palavra contra palavra.
})

test('o dpi ótimo continua gravado — é o que o cliente vai alegar', () => {
  const r = dobro()
  assert.equal(r.dpi, 300)
  assert.equal(r.dpiExigido, 150)
  // E é justamente por 300 > 150 que o tamanho precisava aparecer: olhando só
  // o dpi, a reprovação parece injusta.
})

test('em PDF, os pixels gravados são os REAIS, não a projeção', () => {
  /*
    `larguraPx` de um PDF não é a dimensão do arquivo: é quantos pixels ele
    TERIA no tamanho da peça, na densidade da imagem embutida. Gravar essa
    projeção daria ao analista um número que o cliente não encontra em lugar
    nenhum se for conferir no editor dele — e a conversa, que o campo existe
    para resolver, ficaria pior do que antes.
  */
  const r = dobro()
  assert.deepEqual(r.medida.arquivoPx, { largura: 13464, altura: 6496 })
  assert.notEqual(r.medida.arquivoPx.largura, 6732, 'a projeção não pode vazar para o registro')
})

test('a sangria gravada é a que a REGRA aplicou', () => {
  // A política da casa pode sobrepor a do perfil, e é o valor aplicado que
  // explica qual alvo era aceito. Vem de `resolucao`, que é o que `avaliar`
  // devolveu — não de uma segunda leitura do perfil.
  assert.equal(dobro().medida.sangriaMm, 100)
})

test('JPG sem tamanho declarado grava os pixels e não inventa centímetros', () => {
  // Num JPG solto o "tamanho físico" é ficção, e a própria regra de dimensão
  // não roda. Gravar um número ali seria colocar na mão do analista uma medida
  // que a ferramenta não usou para decidir nada.
  const r = eventoDeReprovacao({
    peca: { id: 'p2', rotulo: 'Testeira', larguraCm: 150, alturaCm: 50 },
    resultado: {
      medidas: { formato: 'jpeg', arquivo: { nome: 'arte.jpg' }, larguraPx: 800, alturaPx: 260 },
      resolucao: { dpi: 13, minimo: { dpi: 100 } },
      achados: [],
    },
  })
  assert.equal(r.medida.arquivoCm, null)
  assert.deepEqual(r.medida.arquivoPx, { largura: 800, altura: 260 })
  assert.deepEqual(r.medida.pecaCm, { largura: 150, altura: 50 })
})

test('arte reduzida registra a escala que foi lida', () => {
  // Sem isto, o analista veria "57 × 27,5 cm" contra uma peça de 570 × 275 e
  // concluiria que o cliente errou feio — quando na verdade a ferramenta
  // reconheceu 1:10 e o arquivo estava certo.
  const r = eventoDeReprovacao({
    peca: { id: 'p3', rotulo: 'Lona', larguraCm: 570, alturaCm: 275 },
    resultado: {
      escalaFator: 10,
      medidas: { formato: 'pdf', arquivo: { nome: 'x.pdf' }, tamanhoDeclaradoCm: { largura: 570, altura: 275 } },
      resolucao: { dpi: 40, minimo: { dpi: 100 } },
      achados: [],
    },
  })
  assert.equal(r.medida.escala, 10)
})

test('tentativa antiga, sem o bloco de medida, não quebra nada', () => {
  // As reprovações gravadas antes desta mudança não têm `medida`. A tela tem
  // de simplesmente não mostrar a linha — inventar número para elas seria pior
  // que a linha não existir, porque é em cima destes valores que alguém vai
  // discutir com o cliente.
  const antiga = { id: 'r1', pecaRotulo: 'Lona', dpi: 300, motivos: [], em: '2026-09-01T10:00:00Z' }
  assert.equal(antiga.medida, undefined)

  const tela = readFileSync(new URL('../src/components/PainelProjeto.jsx', import.meta.url), 'utf8')
  assert.match(tela, /function MedidaDaTentativa\(\{ medida \}\) \{\s*\n\s*if \(!medida\) return null/)
})

test('sem medida nenhuma aproveitável, a linha não aparece', () => {
  const r = eventoDeReprovacao({
    peca: { id: 'p4', rotulo: 'X' },
    resultado: { medidas: { formato: 'cdr', arquivo: { nome: 'a.cdr' } }, resolucao: {}, achados: [] },
  })
  assert.equal(r.medida.arquivoCm, null)
  assert.equal(r.medida.arquivoPx, null)
  assert.equal(r.medida.pecaCm, null)
})
