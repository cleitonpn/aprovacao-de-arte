import { especificacaoEmPdf, nomeDoArquivo } from '../core/especificacaoPdf.js'

// O gabarito é a peça preventiva do conjunto: entregar isso ANTES de o cliente
// desenhar evita a maior parte das reprovações, que nascem de o designer nunca
// ter recebido a medida exata, a sangria e a área segura.
//
// Ele é HÍBRIDO de propósito. O desenho gerado aqui resolve a parede
// retangular — que é a maioria das peças, e para a qual gerar na hora é melhor
// do que alguém redesenhar a cada stand. Mas recorte, curva, balcão em L e
// testeira com sanca não cabem num retângulo, e nesses casos quem tem o
// desenho certo é o projetista. Quando o time sobe um gabarito próprio, ele
// vence o gerado — e o cliente nunca vê os dois, para não ter que escolher.

/**
 * Gera e baixa a especificação da peça — ficha + gabarito, em PDF.
 *
 * Era um PNG. A troca importa porque muda o que o arquivo SERVE PARA FAZER: o
 * PNG é uma imagem que o designer olha e redesenha ao lado; o PDF sai no
 * tamanho exato da peça, com corte, sangria e área segura em vetor, e ele monta
 * a arte em cima — sem redesenhar e sem errar de um milímetro. De quebra, a
 * primeira página leva as medidas por escrito, que antes só existiam na tela.
 *
 * O desenho em canvas que existia aqui saiu junto: manter dois desenhos do
 * mesmo gabarito é garantir que um dos dois fique para trás numa mudança de
 * sangria, e o que ficasse para trás seria justamente o que o cliente baixa.
 */
export function baixarGabarito(peca, perfil, escalaFator, politica, extras = {}) {
  const bytes = especificacaoEmPdf({ peca, perfil, politica, escalaFator, ...extras })
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nomeDoArquivo(peca, perfil)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Este projeto tem gabarito desenhado à mão para esta peça? */
export const temGabaritoProprio = (peca) => Boolean(peca?.gabarito?.url)

/**
 * O botão único de gabarito.
 *
 * O cliente não precisa saber se o gabarito foi desenhado pelo projetista ou
 * gerado na hora — ele quer o gabarito da peça dele. Um botão só, com o
 * comportamento certo por baixo, é o que evita a pergunta "qual dos dois eu
 * uso?" chegando ao time.
 */
export function BotaoGabarito({
  peca, perfil, escalaFator, politica,
  className = 'btn btn-ghost', rotulo = 'Gabarito', aoBaixar,
}) {
  const proprio = peca?.gabarito

  // `aoBaixar` avisa a tela do cliente que o gabarito saiu — é o sinal de que
  // alguém começou de fato a produzir a arte, e nos dois caminhos vale igual:
  // o desenhado pelo projetista e o gerado na hora servem ao mesmo propósito.
  if (proprio?.url) {
    return (
      <a
        className={className}
        href={proprio.url}
        target="_blank"
        rel="noreferrer"
        title={proprio.nome}
        onClick={() => aoBaixar?.()}
      >
        {rotulo}
      </a>
    )
  }

  return (
    <button
      className={className}
      onClick={() => { baixarGabarito(peca, perfil, escalaFator, politica); aoBaixar?.() }}
      title="PDF com as medidas e o gabarito em vetor: corte, sangria e área segura"
    >
      {rotulo}
    </button>
  )
}

export default function Gabarito({ peca, perfil, escalaFator, politica }) {
  const proprio = temGabaritoProprio(peca)
  return (
    <BotaoGabarito
      peca={peca}
      perfil={perfil}
      escalaFator={escalaFator}
      politica={politica}
      className="btn btn-ghost largo"
      rotulo={proprio ? 'Abrir o gabarito desta peça' : 'Baixar a especificação desta peça (PDF)'}
    />
  )
}
