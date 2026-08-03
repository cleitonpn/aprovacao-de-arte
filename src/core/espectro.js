// Análise espectral — é aqui que se descobre a resolução REAL de um arquivo.
//
// O caso que mais custa tempo à operação: o cliente pega um JPG de 800 px,
// amplia para 4000 px no editor e manda dizendo que está em 300 dpi. O
// arquivo *declara* 300 dpi e imprime como papa. Nenhuma leitura de metadado
// pega isso — só olhar o conteúdo pega.
//
// A ideia: imagens naturais têm espectro de potência que decai como uma lei
// de potência (P ∝ f^-α), e esse decaimento é notavelmente constante ao longo
// de todas as oitavas. Uma imagem ampliada perde as oitavas superiores: o
// espectro segue a lei até a Nyquist do arquivo ORIGINAL e depois despenca.
// Ajustando a lei na faixa baixa/média e extrapolando para o topo, o déficit
// medido em dB revela quanta resolução é ilusória.

/** FFT radix-2 no lugar. `re` e `im` precisam ter comprimento potência de 2. */
export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const meio = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < meio; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const jr = re[i + k + meio]
        const ji = im[i + k + meio]
        const vr = jr * cr - ji * ci
        const vi = jr * ci + ji * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + meio] = ur - vr
        im[i + k + meio] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/**
 * Espectro de potência com média radial de um bloco quadrado n×n
 * (n potência de 2). Retorna potência média por raio, índice = raio em bins.
 */
export function espectroRadial(gray, n) {
  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)

  // Janela de Hann. Sem ela, a descontinuidade entre a borda esquerda e a
  // direita do recorte vira energia falsa em alta frequência e mascara
  // justamente o que queremos medir.
  const jan = new Float64Array(n)
  for (let i = 0; i < n; i++) jan[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))

  let media = 0
  for (let i = 0; i < gray.length; i++) media += gray[i]
  media /= gray.length

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) re[y * n + x] = (gray[y * n + x] - media) * jan[y] * jan[x]
  }

  const lr = new Float64Array(n)
  const li = new Float64Array(n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) { lr[x] = re[y * n + x]; li[x] = im[y * n + x] }
    fft(lr, li)
    for (let x = 0; x < n; x++) { re[y * n + x] = lr[x]; im[y * n + x] = li[x] }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { lr[y] = re[y * n + x]; li[y] = im[y * n + x] }
    fft(lr, li)
    for (let y = 0; y < n; y++) { re[y * n + x] = lr[y]; im[y * n + x] = li[y] }
  }

  const nb = n >> 1
  const soma = new Float64Array(nb)
  const cont = new Float64Array(nb)
  for (let y = 0; y < n; y++) {
    const fy = y > nb ? y - n : y
    for (let x = 0; x < n; x++) {
      const fx = x > nb ? x - n : x
      const r = Math.round(Math.hypot(fx, fy))
      if (r < 1 || r >= nb) continue
      soma[r] += re[y * n + x] ** 2 + im[y * n + x] ** 2
      cont[r]++
    }
  }
  const p = new Float64Array(nb)
  for (let r = 0; r < nb; r++) p[r] = cont[r] ? soma[r] / cont[r] : 0
  return p
}

const F_MIN = 0.012
const F_MAX = 0.47

function ajusteLinear(pts) {
  const n = pts.length
  let mx = 0
  let my = 0
  for (const p of pts) { mx += p.x; my += p.y }
  mx /= n
  my /= n
  let num = 0
  let den = 0
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my)
    den += (p.x - mx) ** 2
  }
  const a = den > 1e-12 ? num / den : 0
  const b = my - a * mx
  let sse = 0
  for (const p of pts) sse += (p.y - (a * p.x + b)) ** 2
  return { a, b, sse, em: (x) => a * x + b }
}

function ajusteConstante(pts) {
  let m = 0
  for (const p of pts) m += p.y
  m /= pts.length
  let sse = 0
  for (const p of pts) sse += (p.y - m) ** 2
  return { nivel: m, sse }
}

/**
 * Localiza a frequência de corte do arquivo por ajuste em dois segmentos.
 *
 * Uma imagem íntegra segue uma única lei de potência da baixa frequência até
 * a Nyquist. Uma imagem ampliada segue a lei até a Nyquist do arquivo
 * ORIGINAL e depois desaba num patamar plano — o ruído de fundo da
 * interpolação e da compressão. Testar todos os pontos de quebra possíveis e
 * ficar com o melhor localiza esse joelho diretamente.
 *
 * Extrapolar uma lei ajustada só na faixa baixa NÃO funciona: numa ampliação
 * de 4× ou mais o joelho cai dentro da própria faixa de ajuste, o ajuste
 * aprende a queda e o método fica cego justamente nos piores casos.
 */
export function analisarEspectro(gray, n) {
  const p = espectroRadial(gray, n)
  const nb = p.length

  const pontos = []
  for (let r = 1; r < nb; r++) {
    const f = r / (2 * nb)
    if (f < F_MIN || f > F_MAX) continue
    if (!(p[r] > 0)) continue
    pontos.push({ f, x: Math.log10(f), y: Math.log10(p[r]) })
  }
  if (pontos.length < 20) return null

  // média móvel curta: o espectro radial é ruidoso nos raios pequenos
  const suave = pontos.map((pt, i) => {
    const a = pontos[Math.max(0, i - 1)].y
    const b = pontos[Math.min(pontos.length - 1, i + 1)].y
    return { ...pt, y: (a + pt.y + b) / 3 }
  })

  const global = ajusteLinear(suave)
  const MARGEM = 6
  let melhor = null
  for (let c = MARGEM; c < suave.length - MARGEM; c++) {
    const A = ajusteLinear(suave.slice(0, c + 1))
    const B = ajusteConstante(suave.slice(c + 1))
    const sse = A.sse + B.sse
    if (!melhor || sse < melhor.sse) melhor = { c, sse, A, B }
  }
  if (!melhor) return null

  const fCorte = suave[melhor.c].f
  // quanto o patamar plano está abaixo da tendência, no topo da banda
  const quedaDb = 10 * (melhor.A.em(Math.log10(F_MAX)) - melhor.B.nivel)
  const ganho = global.sse > 1e-12 ? 1 - melhor.sse / global.sse : 0

  return {
    fCorte,
    quedaDb,
    ganho,
    alfa: melhor.A.a,
    fatorBruto: 0.5 / fCorte,
  }
}

// Limiares deliberadamente folgados. O erro caro aqui é o falso positivo:
// acusar arte boa de ampliada destrói a confiança na ferramenta inteira e
// devolve a operação ao ciclo de e-mails. Na dúvida, a ferramenta se cala.
//
// Sobre a medição: os testes mostram que a QUEDA separa muito bem (arte
// legítima fica em torno de 0 dB ou negativa; arte ampliada passa de 10 dB),
// mas a frequência de corte estimada NÃO é confiável como medida de quanto
// o arquivo foi ampliado — num aumento de 2× ela costuma apontar bem acima
// do corte verdadeiro. Por isso o resultado é qualitativo: dizemos que o
// arquivo não sustenta a própria resolução, sem cravar um fator inventado.
const GANHO_MIN = 0.30
const QUEDA_MIN_DB = 8

export function classificarDeficit(d) {
  if (!d) return { detalheReal: true, confiavel: false, quedaDb: null }
  const insuficiente = d.ganho >= GANHO_MIN && d.quedaDb >= QUEDA_MIN_DB && d.alfa < -0.5
  return {
    // false = o arquivo não carrega detalhe real na resolução que declara
    detalheReal: !insuficiente,
    confiavel: insuficiente,
    quedaDb: d.quedaDb,
    fCorte: d.fCorte,
    ganho: d.ganho,
    alfa: d.alfa,
  }
}
