// Um escritor de PDF mínimo, escrito à mão.
//
// Por que não uma biblioteca: as que fazem isto pesam de 300 kB a 1 MB, e
// entram no pacote que o cliente baixa numa página que ele abre uma vez, do
// celular, na semana da feira. O que precisamos aqui é texto em Helvetica,
// retângulos e linhas — o subconjunto do PDF que cabe em duzentas linhas e não
// muda mais, porque o formato tem trinta anos.
//
// O que este arquivo entrega e um PNG não entregaria: VETOR e MEDIDA. O
// gabarito em PNG é uma imagem que o designer usa como referência visual; um
// PDF no tamanho exato da peça, com as marcas de corte e sangria em vetor, é um
// arquivo que ele abre no Illustrator e monta a arte em cima — sem redesenhar
// nada e sem errar de um milímetro.

const PT_POR_CM = 72 / 2.54

/** O maior lado que o formato aceita: 200 polegadas. */
export const LIMITE_PT = 14400

const latin1 = (texto) => {
  const s = String(texto)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff
  return bytes
}

/**
 * O que WinAnsiEncoding tem e o latin-1 não.
 *
 * A faixa 0x80–0x9F é onde o CP1252 põe travessão, aspas curvas e reticências —
 * justamente a pontuação que este projeto usa em todo texto. Sem este mapa, o
 * filtro de baixo os descarta e a folha de especificação sai com "Parede A ?
 * Kemin" no lugar do travessão. Foi o que apareceu no primeiro arquivo gerado.
 */
const WIN_ANSI = {
  '\u2014': '\x97', // travessão
  '\u2013': '\x96', // meia-risca
  '\u2018': '\x91',
  '\u2019': '\x92',
  '\u201c': '\x93',
  '\u201d': '\x94',
  '\u2022': '\x95', // bolinha
  '\u2026': '\x85', // reticências
  // A seta não existe em WinAnsi. Trocar por ">>" ficaria com cara de citação;
  // o guilemet duplo é a marca de direção que a fonte de fato tem.
  '\u2192': '\xbb',
}

/**
 * Texto dentro de um parêntese de PDF.
 *
 * Os três primeiros escapes não são zelo: um nome de stand com parêntese —
 * "Kemin (Brasil)" — fecha a string no meio e produz um arquivo que nenhum
 * leitor abre. E nome de expositor com parêntese é comum.
 */
const escapar = (texto) => String(texto ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)')
  .replace(/[\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u2192]/g, (c) => WIN_ANSI[c])
  // O resto dos acentos é latin-1 puro. O que sobrar vira "?" em vez de
  // derrubar o arquivo inteiro.
  .replace(/[^\x20-\x7e\x85\x91-\x97\xa0-\xff]/g, '?')

/** Acumula os comandos de desenho de uma página. */
export function pagina(larguraPt, alturaPt) {
  const ops = []
  const n = (v) => (Math.round(v * 1000) / 1000).toString()

  const api = {
    larguraPt,
    alturaPt,
    /** Retângulo preenchido. */
    caixa(x, y, w, h, [r, g, b]) {
      ops.push(`${n(r)} ${n(g)} ${n(b)} rg`, `${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`)
      return api
    },
    /** Retângulo só de contorno, opcionalmente tracejado. */
    contorno(x, y, w, h, [r, g, b], espessura = 1, tracejado = null) {
      ops.push('q', `${n(r)} ${n(g)} ${n(b)} RG`, `${n(espessura)} w`)
      if (tracejado) ops.push(`[${tracejado.map(n).join(' ')}] 0 d`)
      ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`, 'Q')
      return api
    },
    linha(x1, y1, x2, y2, [r, g, b], espessura = 1, tracejado = null) {
      ops.push('q', `${n(r)} ${n(g)} ${n(b)} RG`, `${n(espessura)} w`)
      if (tracejado) ops.push(`[${tracejado.map(n).join(' ')}] 0 d`)
      ops.push(`${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`, 'Q')
      return api
    },
    /**
     * Texto. `y` é a linha de base, como no PDF — e não o topo, como no
     * canvas: converter aqui esconderia a diferença e faria toda medida de
     * entrelinha ficar um pouco errada.
     */
    texto(x, y, conteudo, { tamanho = 10, negrito = false, cor = [0, 0, 0], centro = false, direita = false } = {}) {
      const fonte = negrito ? '/F2' : '/F1'
      const largura = api.larguraDoTexto(conteudo, tamanho, negrito)
      const px = centro ? x - largura / 2 : direita ? x - largura : x
      ops.push(
        'BT', `${fonte} ${n(tamanho)} Tf`,
        `${n(cor[0])} ${n(cor[1])} ${n(cor[2])} rg`,
        `1 0 0 1 ${n(px)} ${n(y)} Tm`,
        `(${escapar(conteudo)}) Tj`, 'ET',
      )
      return api
    },
    /**
     * Largura aproximada de um texto.
     *
     * Aproximada de propósito: carregar as métricas reais da Helvetica seria
     * uma tabela de 300 números para centralizar títulos numa folha. O erro de
     * alguns por cento não é visível num texto centralizado, e nada aqui
     * depende de justificação.
     */
    larguraDoTexto(conteudo, tamanho, negrito = false) {
      return String(conteudo).length * tamanho * (negrito ? 0.56 : 0.5)
    },
    /** Quebra o texto em linhas que cabem na largura dada. */
    paragrafo(x, y, conteudo, { largura, tamanho = 10, entrelinha = 1.35, negrito = false, cor = [0, 0, 0] } = {}) {
      const palavras = String(conteudo).split(/\s+/).filter(Boolean)
      const linhas = []
      let atual = ''
      for (const palavra of palavras) {
        const teste = atual ? `${atual} ${palavra}` : palavra
        if (api.larguraDoTexto(teste, tamanho, negrito) > largura && atual) {
          linhas.push(atual)
          atual = palavra
        } else {
          atual = teste
        }
      }
      if (atual) linhas.push(atual)
      linhas.forEach((linha, i) => api.texto(x, y - i * tamanho * entrelinha, linha, { tamanho, negrito, cor }))
      return y - (linhas.length - 1) * tamanho * entrelinha
    },
    conteudo: () => ops.join('\n'),
  }
  return api
}

/**
 * Monta o arquivo a partir das páginas.
 *
 * A tabela `xref` guarda o deslocamento em BYTES de cada objeto, e é por isso
 * que tudo aqui é montado em bytes e não em texto: um único acento contado como
 * um caractere onde ele ocupa um byte desloca a tabela inteira, e o leitor
 * recusa o arquivo sem dizer por quê.
 */
export function montarPdf(paginas, { titulo = 'Especificação da peça' } = {}) {
  const objetos = []
  const add = (corpo) => { objetos.push(corpo); return objetos.length }

  // 1 catálogo, 2 páginas — reservados agora para os filhos poderem apontar.
  const idCatalogo = add(null)
  const idPaginas = add(null)
  const idFonte = add('<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>')
  const idFonteNegrito = add('<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>')

  const idsDePagina = []
  for (const p of paginas) {
    const fluxo = p.conteudo()
    const idFluxo = add(`<</Length ${latin1(fluxo).length}>>\nstream\n${fluxo}\nendstream`)
    const idPagina = add(
      `<</Type/Page/Parent ${idPaginas} 0 R`
      + `/MediaBox[0 0 ${p.larguraPt.toFixed(3)} ${p.alturaPt.toFixed(3)}]`
      + `/Resources<</Font<</F1 ${idFonte} 0 R/F2 ${idFonteNegrito} 0 R>>>>`
      + `/Contents ${idFluxo} 0 R>>`,
    )
    idsDePagina.push(idPagina)
  }

  objetos[idCatalogo - 1] = `<</Type/Catalog/Pages ${idPaginas} 0 R>>`
  objetos[idPaginas - 1] =
    `<</Type/Pages/Kids[${idsDePagina.map((id) => `${id} 0 R`).join(' ')}]/Count ${idsDePagina.length}>>`

  const idInfo = add(`<</Title(${escapar(titulo)})/Producer(Aprovacao de Arte)>>`)

  const partes = []
  let deslocamento = 0
  const escrever = (texto) => {
    const bytes = latin1(texto)
    partes.push(bytes)
    deslocamento += bytes.length
  }

  escrever('%PDF-1.4\n')
  const posicoes = []
  objetos.forEach((corpo, i) => {
    posicoes[i] = deslocamento
    escrever(`${i + 1} 0 obj\n${corpo}\nendobj\n`)
  })

  const inicioXref = deslocamento
  const linhas = ['xref', `0 ${objetos.length + 1}`, '0000000000 65535 f ']
  for (const pos of posicoes) linhas.push(`${String(pos).padStart(10, '0')} 00000 n `)
  escrever(`${linhas.join('\n')}\n`)
  escrever(
    `trailer\n<</Size ${objetos.length + 1}/Root ${idCatalogo} 0 R/Info ${idInfo} 0 R>>\n`
    + `startxref\n${inicioXref}\n%%EOF`,
  )

  const total = partes.reduce((s, p) => s + p.length, 0)
  const saida = new Uint8Array(total)
  let i = 0
  for (const parte of partes) { saida.set(parte, i); i += parte.length }
  return saida
}

export const cmParaPt = (cm) => cm * PT_POR_CM
