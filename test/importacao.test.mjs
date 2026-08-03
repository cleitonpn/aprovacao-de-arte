import test from 'node:test'
import assert from 'node:assert/strict'
import {
  importarProjetos, separarCsv, detectarSeparador, mapearColunas, interpretarPeca, MODELO_CSV,
} from '../src/core/importacao.js'
import { interpretarMedida, interpretarEscala, perfilPorTexto } from '../src/data/projeto.js'

// A importação é o que decide se a ferramenta é usada na segunda feira ou
// abandonada: cadastrar 120 peças na mão, a cada evento, ninguém faz duas
// vezes. Por isso os testes aqui cobrem planilha real — com acento, vírgula
// decimal, coluna faltando e linha torta — e não só o caminho feliz.

test('separa CSV respeitando aspas, ponto e vírgula dentro do campo e "" escapado', () => {
  const linhas = separarCsv('a;b;c\r\n"x;1";"diz ""oi""";z\n', ';')
  assert.deepEqual(linhas, [['a', 'b', 'c'], ['x;1', 'diz "oi"', 'z']])
})

test('detecta o separador do Excel em português sem quebrar a vírgula decimal', () => {
  const texto = 'feira;stand;peca;medida\nExpo;A1;Lona;2,75x2,75 m'
  assert.equal(detectarSeparador(texto), ';')
  const { projetos } = importarProjetos(texto)
  assert.equal(projetos[0].pecas[0].larguraCm, 275)
})

test('reconhece cabeçalhos com acento, maiúscula e nome alternativo', () => {
  const { simples } = mapearColunas(['Feira', 'CLIENTE', 'E-mail', 'Estande', 'Localização', 'Peça', 'Largura', 'Altura'])
  assert.deepEqual(simples, {
    feira: 0, expositor: 1, email: 2, stand: 3, localizacao: 4, rotulo: 5, largura: 6, altura: 7,
  })
})

test('importa uma linha por peça e agrupa por stand', () => {
  const { projetos, erros, formato } = importarProjetos(MODELO_CSV)
  assert.deepEqual(erros, [])
  assert.equal(formato, 'uma linha por peça')
  assert.equal(projetos.length, 1)

  const p = projetos[0]
  assert.equal(p.expositor, 'Buddy Nutrition')
  assert.equal(p.email, 'contato@buddy.com.br')
  assert.equal(p.stand, 'Buddy Nutrition')
  assert.equal(p.localizacao, 'Rua 3, Pavilhão A')
  assert.equal(p.pecas.length, 3)
  assert.deepEqual(
    p.pecas.map((x) => [x.rotulo, x.perfilId, x.larguraCm, x.alturaCm]),
    [
      ['Lona de fundo', 'lona-parede', 275, 275],
      ['Adesivo do balcão', 'adesivo-balcao', 100, 100],
      ['Testeira', 'testeira', 150, 50],
    ],
  )
  // token é a credencial do link: precisa ser aleatório e não trivial
  assert.match(p.token, /^[a-z2-9]{12}$/)
})

test('importa uma linha por stand, com colunas Arte A / Arte B / Arte C', () => {
  const csv = [
    'Feira;Cliente;E-mail;Stand;Localização;Arte A;Arte B;Arte C',
    'Expo Sul;Buddy Nutrition;ana@buddy.com;Buddy;Rua 3;Lona de parede 275x275;Adesivo balcão 100x100;Testeira 150 x 50',
    'Expo Sul;Outra Marca;jo@outra.com;Outra;Rua 4;Lona 300x220;;',
  ].join('\n')

  const { projetos, erros, formato } = importarProjetos(csv)
  assert.deepEqual(erros, [])
  assert.equal(formato, 'uma linha por stand')
  assert.equal(projetos.length, 2)

  assert.deepEqual(
    projetos[0].pecas.map((p) => [p.rotulo, p.perfilId, p.larguraCm, p.alturaCm]),
    [
      ['Lona de parede', 'lona-parede', 275, 275],
      ['Adesivo balcão', 'adesivo-balcao', 100, 100],
      ['Testeira', 'testeira', 150, 50],
    ],
  )
  // coluna em branco não vira peça vazia
  assert.equal(projetos[1].pecas.length, 1)
})

test('a linha com defeito não derruba a planilha inteira', () => {
  const csv = [
    'feira;cliente;email;stand;peca;medida',
    'Expo;Buddy;ana@buddy.com;Buddy;Lona;275x275',
    'Expo;Buddy;ana@buddy.com;Buddy;Adesivo;tamanho a definir',
    ';;;;Lona solta;100x100',
    'Expo;Terceiro;semarroba;Terceiro;Lona;200x200',
  ].join('\n')

  const { projetos, erros } = importarProjetos(csv)

  // o que dava para importar foi importado
  assert.equal(projetos.length, 2)
  assert.equal(projetos[0].pecas.length, 1)

  const linhas = erros.map((e) => e.linha)
  assert.ok(linhas.includes(3), 'peça sem medida legível precisa apontar a linha 3')
  assert.ok(linhas.includes(4), 'linha sem feira/stand precisa apontar a linha 4')
  assert.ok(erros.some((e) => /e-mail válido/i.test(e.mensagem)), 'e-mail inválido precisa virar erro')
})

test('medida pequena sem unidade vira aviso, nunca adivinhação', () => {
  const csv = 'feira;cliente;email;stand;peca;medida\nExpo;B;a@b.com;B;Adesivo;5x5'
  const { projetos, avisos } = importarProjetos(csv)
  assert.equal(projetos[0].pecas[0].larguraCm, 5)
  assert.equal(avisos.length, 1)
  assert.match(avisos[0].mensagem, /cent[ií]metros/i)
})

test('e-mail preenchido só na primeira linha do stand vale para as demais', () => {
  const csv = [
    'feira;cliente;email;stand;peca;medida',
    'Expo;Buddy;ana@buddy.com;Buddy;Lona;275x275',
    'Expo;;;Buddy;Testeira;150x50',
  ].join('\n')
  const { projetos, erros } = importarProjetos(csv)
  assert.deepEqual(erros, [])
  assert.equal(projetos.length, 1)
  assert.equal(projetos[0].email, 'ana@buddy.com')
  assert.equal(projetos[0].pecas.length, 2)
})

test('cabeçalho sem as colunas essenciais explica o que faltou', () => {
  const { erros, projetos } = importarProjetos('nome;telefone\nBuddy;1199999')
  assert.equal(projetos.length, 0)
  assert.match(erros[0].mensagem, /feira/)
})

test('interpreta medidas em m, mm e cm', () => {
  assert.deepEqual(interpretarMedida('2,75 x 2,75 m'), { larguraCm: 275, alturaCm: 275, unidadeInformada: true })
  assert.deepEqual(interpretarMedida('1000 x 500 mm'), { larguraCm: 100, alturaCm: 50, unidadeInformada: true })
  assert.deepEqual(interpretarMedida('275x275'), { larguraCm: 275, alturaCm: 275, unidadeInformada: false })
  assert.equal(interpretarMedida('sem medida'), null)
})

test('escala aceita 1:4, 1/4 e 4', () => {
  assert.equal(interpretarEscala('1:4'), 4)
  assert.equal(interpretarEscala('1/4'), 4)
  assert.equal(interpretarEscala('4'), 4)
  assert.equal(interpretarEscala(''), 1)
  assert.equal(interpretarEscala('qualquer coisa'), 1)
})

test('o tipo de peça sai do texto que o cliente escreve, e o específico vence o genérico', () => {
  assert.equal(perfilPorTexto('Lona de fundo'), 'lona-parede')
  assert.equal(perfilPorTexto('adesivo de painel'), 'adesivo-balcao', 'adesivo vence painel')
  assert.equal(perfilPorTexto('Testeira do stand'), 'testeira')
  assert.equal(perfilPorTexto('Vinil de piso'), 'vinil-piso')
  assert.equal(perfilPorTexto('Totem de sinalização'), 'placa')
  assert.equal(perfilPorTexto('coisa nova'), 'livre')
})

test('interpretarPeca separa a descrição da medida', () => {
  assert.deepEqual(interpretarPeca('Lona de parede 275x275'), {
    rotulo: 'Lona de parede', perfilId: 'lona-parede',
    larguraCm: 275, alturaCm: 275, unidadeInformada: false, temMedida: true,
  })
  assert.equal(interpretarPeca('  ')?.rotulo, undefined)
})
