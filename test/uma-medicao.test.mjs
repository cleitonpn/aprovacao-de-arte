import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/*
  A arte é medida UMA vez.

  Durante um tempo foram duas. A ferramenta media com a escala que o cliente
  tinha deixado no seletor, descobria no resultado que a arte estava reduzida,
  e media tudo de novo na escala certa. Funcionava — e custava caro no lugar
  errado.

  Caro porque a segunda passagem é a pesada. A escala multiplica o tamanho
  impresso, e com ele a resolução em que a página é rasterizada: num arquivo
  1:4 o segundo render tem dezesseis vezes mais pixels que o primeiro. E no
  arquivo que mais demora — aquele cuja imagem embutida é grande demais para o
  navegador abrir, em que a ferramenta cai na leitura direta do PDF — a segunda
  passagem relê o arquivo inteiro do disco e descomprime centenas de megabytes
  outra vez.

  O conserto não foi otimizar a medição: foi parar de medir duas vezes. O
  tamanho que o arquivo declara está no cabeçalho e não exige medição nenhuma,
  então a escala é reconhecida antes, e a medição acontece uma vez só, já na
  escala certa.

  Estes testes existem para que a segunda medição não volte sem querer — ela
  voltaria calada, como uma lentidão que ninguém liga à mudança que a causou.
*/

const fonte = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8')

/** O corpo de `analisar`, sem os comentários — que descrevem o defeito antigo. */
function corpoDeAnalisar() {
  const texto = fonte('../src/core/analise.js')
  const inicio = texto.indexOf('export async function analisar')
  assert.notEqual(inicio, -1, 'não achei `analisar` — o teste precisa ser atualizado')
  const fim = texto.indexOf('\n}\n', inicio)
  return texto
    .slice(inicio, fim)
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

test('a arte é medida uma vez só', () => {
  const chamadas = [...corpoDeAnalisar().matchAll(/await medir\(/g)]
  assert.equal(
    chamadas.length, 1,
    'mais de uma chamada a `medir` em `analisar`: a medição voltou a acontecer '
    + 'duas vezes, e é ela que leva minutos no arquivo pesado',
  )
})

test('a escala é reconhecida antes da medição', () => {
  const corpo = corpoDeAnalisar()
  const escala = corpo.indexOf("escalaProvavel(")
  const medida = corpo.indexOf('await medir(')
  assert.ok(escala > -1 && medida > -1, 'não achei a detecção de escala ou a medição')
  assert.ok(
    escala < medida,
    'a escala está sendo decidida depois de medir — é esse arranjo que obrigava '
    + 'a medir de novo',
  )
})

test('a detecção de escala não depende de nada que precise ser medido', () => {
  // O tamanho declarado sai do cabeçalho do arquivo. Se a detecção voltar a ler
  // `medidas`, ela volta a precisar de uma medição antes de si — e a segunda
  // medição volta junto.
  const corpo = corpoDeAnalisar()
  const linha = corpo.split('\n').find((l) => l.includes('escalaProvavel('))
  assert.ok(linha, 'não achei a chamada de `escalaProvavel`')
  assert.ok(
    !linha.includes('medidas'),
    `a detecção de escala voltou a depender da medição: ${linha.trim()}`,
  )
})

/** O corpo de `medirPdf`, sem comentários. */
function corpoDeMedirPdf() {
  const texto = fonte('../src/core/analise.js')
  const inicio = texto.indexOf('async function medirPdf')
  assert.notEqual(inicio, -1, 'não achei `medirPdf` — o teste precisa ser atualizado')
  const fim = texto.indexOf('\n}\n', inicio)
  return texto
    .slice(inicio, fim)
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

test('a página é rasterizada uma vez por medição', () => {
  // Rasterizar um PDF não custa pelo tamanho do canvas: custa por decodificar
  // a imagem embutida, que é a mesma para 400 px e para 2.559. Era o trabalho
  // mais caro da análise, feito duas vezes — uma na inspeção, outra na medida.
  const chamadas = [...corpoDeMedirPdf().matchAll(/renderizarPagina\(/g)]
  assert.equal(chamadas.length, 1, 'mais de uma rasterização em `medirPdf`')
})

test('a inspeção não rasteriza por conta própria', () => {
  const corpo = corpoDeMedirPdf()
  const linha = corpo.split('\n').find((l) => l.includes('inspecionarPagina('))
  assert.ok(linha, 'não achei a chamada de `inspecionarPagina`')
  assert.match(
    linha, /rasterizar:\s*false/,
    'a inspeção voltou a rasterizar a página por conta própria — é a segunda '
    + 'decodificação da imagem embutida, e ela não aparece em lugar nenhum',
  )
})

test('a inspeção vem depois do render que ela aproveita', () => {
  const corpo = corpoDeMedirPdf()
  assert.ok(
    corpo.indexOf('renderizarPagina(') < corpo.indexOf('inspecionarPagina('),
    'a inspeção está antes do render: sem a rasterização feita, ela não tem '
    + 'os XObjects resolvidos para ler',
  )
})

test('a rasterização tem prazo para terminar', () => {
  // `render().promise` não tem fim garantido. Sem prazo, uma arte que o pdf.js
  // não dá conta de desenhar deixa a tela parada no mesmo passo para sempre —
  // sem erro, sem veredicto e sem saída. Houve relato de cinco minutos.
  const pdf = fonte('../src/core/pdf.js')
  assert.match(pdf, /PRAZO_RENDER_MS/, 'o prazo de render sumiu')
  assert.match(pdf, /Promise\.race\(\[tarefa\.promise, prazo\]\)/, 'o render voltou a esperar sem prazo')
  assert.match(pdf, /tarefa\.cancel\(\)/, 'o render estourado não é mais cancelado')
})

test('a tela anuncia a escala antes de medir', () => {
  // A lista de etapas promete ser a ordem REAL. Se ela mentir, a etapa some da
  // tela no instante em que aparece, ou a lista anda para trás.
  const tela = fonte('../src/components/Upload.jsx')
  const ids = [...tela.matchAll(/\{ id: '(\w+)', texto:/g)].map((m) => m[1])
  assert.ok(ids.includes('escala') && ids.includes('medindo'))
  assert.ok(
    ids.indexOf('escala') < ids.indexOf('medindo'),
    'na tela a escala aparece depois de medir, mas no código vem antes',
  )

  const corpo = corpoDeAnalisar()
  assert.ok(
    corpo.indexOf("andar('escala')") < corpo.indexOf("andar('medindo')"),
    'a ordem anunciada não é a ordem em que as etapas acontecem',
  )
})
