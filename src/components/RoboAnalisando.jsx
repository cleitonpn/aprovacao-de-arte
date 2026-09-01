/**
 * O robô que confere a arte.
 *
 * Não tem função técnica nenhuma, e ainda assim resolve um problema real: numa
 * testeira de 1,8 MB a conferência acaba em 200 ms, e uma tela que pisca e
 * cospe um veredicto não parece rápida — parece que nada foi olhado. A
 * desconfiança recai justamente sobre o "aprovado", que é o resultado em que
 * mais precisamos ser acreditados.
 *
 * Desenhado em SVG inline, e não em GIF ou Lottie: são 2 kB dentro do pacote em
 * vez de um arquivo a baixar, ele acompanha o tema claro e escuro sozinho
 * (as cores saem das variáveis do CSS) e continua nítido em qualquer tela.
 *
 * Tudo que se mexe está em `styles.css` e para inteiro sob
 * `prefers-reduced-motion` — quem pediu ao sistema para não ver animação tem
 * motivo, e costuma ser um motivo de saúde.
 */
export default function RoboAnalisando() {
  return (
    <svg
      className="robo"
      viewBox="0 0 148 104"
      role="img"
      aria-label="Conferindo a arte"
      focusable="false"
    >
      {/* ------------------------------------------------------------ a folha */}
      <g className="robo-folha">
        <rect x="86" y="14" width="50" height="72" rx="4" className="robo-papel" />
        {[24, 34, 44, 54, 64, 74].map((y, i) => (
          <rect
            key={y}
            x="94"
            y={y}
            width={i % 3 === 2 ? 22 : 34}
            height="3.5"
            rx="1.75"
            className="robo-linha"
          />
        ))}
        {/* A varredura: é ela que diz "estou lendo isto agora". */}
        <rect x="86" y="14" width="50" height="7" className="robo-varredura" />
      </g>

      {/* ------------------------------------------------------------- o robô */}
      <g className="robo-corpo">
        <line x1="38" y1="26" x2="38" y2="14" className="robo-traco" />
        <circle cx="38" cy="11" r="4.5" className="robo-antena" />

        <rect x="14" y="26" width="48" height="38" rx="11" className="robo-cabeca" />
        <g className="robo-olhos">
          <circle cx="30" cy="45" r="4.5" />
          <circle cx="46" cy="45" r="4.5" />
        </g>

        {/* Um pouco mais largo que o desenho original: com 28 contra os 48 da
            cabeça, o robô lia como uma cabeça flutuando sobre uma caixinha. */}
        <rect x="21" y="68" width="34" height="20" rx="6" className="robo-cabeca" />
        {/* O braço aponta para a folha: sem ele, são dois desenhos soltos lado
            a lado em vez de alguém conferindo alguma coisa. */}
        <line x1="55" y1="76" x2="84" y2="66" className="robo-traco robo-braco" />
      </g>
    </svg>
  )
}
