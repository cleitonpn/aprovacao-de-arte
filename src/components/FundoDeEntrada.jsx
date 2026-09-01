/**
 * As linhas finas nas bordas da tela de entrada.
 *
 * São o detalhe do desenho da designer que nenhum gradiente reproduz: traços
 * horizontais de comprimentos diferentes, agrupados nas duas margens, que dão
 * movimento ao fundo sem competir com o cartão no meio.
 *
 * SVG, e não `repeating-linear-gradient`: um gradiente repetido só sabe fazer
 * linhas TODAS do mesmo tamanho e igualmente espaçadas, e o que faz o desenho
 * dela funcionar é justamente a irregularidade. Com a régua perfeita a tela
 * lia como papel pautado.
 *
 * As posições são uma lista fixa, escrita à mão. Nada de `Math.random()`: um
 * fundo que se redesenha diferente a cada recarregamento pisca na troca de
 * tema e é impossível de conferir numa captura de tela.
 */

// Espaço normalizado 0–100 nos dois eixos. O SVG estica com a janela, e a
// espessura é presa em 1px pelo `vector-effect` — sem isso, numa tela larga as
// linhas engordariam junto com o resto.
const ESQUERDA = [
  { y: 2.5, c: 4.2 }, { y: 4.4, c: 5.6 }, { y: 6.6, c: 7.4 }, { y: 8.2, c: 2.1 },
  { y: 28.5, c: 7.0 }, { y: 51.5, c: 6.2 }, { y: 58.0, c: 5.0 }, { y: 63.5, c: 6.4 },
  { y: 69.5, c: 6.0 }, { y: 75.5, c: 7.2 }, { y: 82.5, c: 9.4 }, { y: 88.0, c: 5.2 },
]

const DIREITA = [
  { y: 46.5, c: 3.1 }, { y: 54.5, c: 2.2 }, { y: 61.5, c: 6.3 }, { y: 69.5, c: 4.1 },
  { y: 77.5, c: 7.4 }, { y: 84.5, c: 5.0 }, { y: 90.5, c: 9.2 }, { y: 95.5, c: 3.4 },
]

export default function FundoDeEntrada() {
  return (
    <svg
      className="fundo-entrada"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {ESQUERDA.map(({ y, c }) => (
        <line key={`e${y}`} x1="0" y1={y} x2={c} y2={y} vectorEffect="non-scaling-stroke" />
      ))}
      {DIREITA.map(({ y, c }) => (
        <line key={`d${y}`} x1={100 - c} y1={y} x2="100" y2={y} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}
