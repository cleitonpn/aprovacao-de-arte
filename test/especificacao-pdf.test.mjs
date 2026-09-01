import test from 'node:test'
import assert from 'node:assert/strict'
import { especificacaoEmPdf, nomeDoArquivo, escalaDoGabarito } from '../src/core/especificacaoPdf.js'
import { LIMITE_PT, cmParaPt } from '../src/core/pdfSaida.js'
import { PERFIS_PADRAO } from '../src/data/perfis.js'

// A folha de especificação, aberta por um leitor de PDF de verdade.
//
// Estes testes carregam o arquivo gerado no pdf.js — o mesmo motor que o
// navegador usa — em vez de conferir a string. É a única forma de pegar o erro
// que este gerador pode cometer: a tabela `xref` guarda deslocamentos em BYTES,
// e um acento contado como caractere onde ele ocupa um byte desloca a tabela
// inteira. O arquivo continua parecendo certo e nenhum leitor abre.

const perfil = (id) => PERFIS_PADRAO.find((p) => p.id === id)
const lona = perfil('lona-parede')

async function abrir(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
  const paginas = []
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i)
    const vp = pg.getViewport({ scale: 1 })
    const texto = (await pg.getTextContent()).items.map((t) => t.str).join(' ')
    paginas.push({ larguraPt: vp.width, alturaPt: vp.height, texto })
  }
  return paginas
}

const gerar = (extra = {}) => especificacaoEmPdf({
  peca: { id: 'p', rotulo: 'Parede A', larguraCm: 110, alturaCm: 275 },
  perfil: lona,
  politica: {},
  ...extra,
})

test('o arquivo abre num leitor de PDF de verdade', async () => {
  const paginas = await abrir(gerar())
  assert.equal(paginas.length, 2, 'ficha + gabarito')
})

test('a página do gabarito sai no tamanho EXATO da peça com sangria', async () => {
  // É a razão de o gabarito ter deixado de ser PNG. Se a página não sair na
  // medida, o designer monta a arte em cima de um desenho errado — e o erro só
  // aparece com a peça impressa.
  const [, gabarito] = await abrir(gerar())
  assert.ok(Math.abs(gabarito.larguraPt - cmParaPt(130)) < 0.5, `largura ${gabarito.larguraPt}`)
  assert.ok(Math.abs(gabarito.alturaPt - cmParaPt(295)) < 0.5, `altura ${gabarito.alturaPt}`)
})

test('os acentos sobrevivem ao arquivo', async () => {
  // Não é estética: é o teste de que os deslocamentos da `xref` foram contados
  // em bytes. Se estiverem em caracteres, o pdf.js nem chega a ler o texto.
  const [ficha] = await abrir(gerar())
  assert.match(ficha.texto, /Especificação da peça/)
  assert.match(ficha.texto, /Área segura/)
  assert.match(ficha.texto, /Distância/)
})

test('travessão e seta viram os caracteres certos, não "?"', async () => {
  // O primeiro arquivo gerado saiu com "Parede A ? Kemin" — o travessão vive na
  // faixa 0x80–0x9F do WinAnsi, que o filtro de latin-1 descartava.
  const [ficha] = await abrir(gerar({
    resultado: {
      medidas: { arquivo: { nome: 'arte.pdf' } },
      achados: [{ nivel: 'bloqueante', titulo: 'Resolução — 82 dpi', detalhe: 'x', acao: 'trocar' }],
    },
  }))
  assert.match(ficha.texto, /Resolução — 82 dpi/)
  assert.ok(!ficha.texto.includes('Resolução ? 82'), 'o travessão virou "?"')
})

test('parêntese no nome do stand não quebra o arquivo', async () => {
  // "Kemin (Brasil)" fecha a string do PDF no meio e produz um arquivo que
  // nenhum leitor abre — e nome de expositor com parêntese é comum.
  const paginas = await abrir(gerar({ cadastro: { stand: 'Kemin (Brasil)', feira: 'ECBR', nome: 'Cleiton' } }))
  assert.match(paginas[0].texto, /Kemin \(Brasil\)/)
})

test('o que precisa mudar entra na ficha; o que já está certo não', async () => {
  const [ficha] = await abrir(gerar({
    resultado: {
      medidas: { arquivo: { nome: 'arte.pdf' } },
      achados: [
        { nivel: 'bloqueante', titulo: 'Resolução insuficiente', detalhe: 'faltam pixels', acao: 'peça maior' },
        { nivel: 'ok', titulo: 'Proporção compatível', detalhe: 'tudo certo' },
      ],
    },
  }))
  assert.match(ficha.texto, /Resolução insuficiente/)
  assert.match(ficha.texto, /peça maior/)
  // Esta folha vai para quem vai CORRIGIR. O que já está certo é ruído no meio
  // da lista de tarefas dele — e está na tela, para quem quiser ver.
  assert.ok(!ficha.texto.includes('Proporção compatível'))
})

test('sem análise, a ficha é a especificação limpa', async () => {
  // É o caso de baixar o gabarito ANTES de desenhar, que é quando ele mais
  // vale: não há arte, não há o que apontar.
  const [ficha] = await abrir(gerar())
  assert.match(ficha.texto, /Montar o arquivo neste tamanho/)
  assert.ok(!ficha.texto.includes('O QUE A CONFERÊNCIA APONTOU'))
})

test('peça maior que o formato aceita sai reduzida, e avisa', async () => {
  // O PDF não passa de 200 polegadas (508 cm). Uma parede de 6 m é rotina, e
  // um gabarito reduzido sem aviso é pior que nenhum: o designer monta em cima
  // e a arte sai dez vezes menor.
  assert.equal(escalaDoGabarito(130, 295), 1)
  assert.ok(escalaDoGabarito(600, 300) > 1)

  const bytes = especificacaoEmPdf({
    peca: { id: 'p', rotulo: 'Parede longa', larguraCm: 900, alturaCm: 300 },
    perfil: lona,
    politica: {},
  })
  const [, gabarito] = await abrir(bytes)
  assert.ok(gabarito.larguraPt <= LIMITE_PT, `${gabarito.larguraPt} pt passa do limite do formato`)
  assert.match(gabarito.texto, /SAIU EM 1:/)
})

test('o nome do arquivo não carrega acento nem espaço', () => {
  const nome = nomeDoArquivo({ rotulo: 'Parede A (frente) — Ação', larguraCm: 110, alturaCm: 275 }, lona)
  assert.match(nome, /^especificacao-[a-z0-9-]+-110x275cm\.pdf$/, nome)
})
