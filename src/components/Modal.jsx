import { useEffect, useRef } from 'react'

/**
 * Uma caixa por cima da tela.
 *
 * Existe porque "enviar prova" não é um trecho da ficha: é uma tarefa com
 * começo, meio e fim — escolher as peças, escrever a observação, subir o
 * arquivo, mandar. Aberta no meio da ficha, ela empurrava a lista de peças
 * para baixo justamente enquanto o analista precisava consultar aquela lista
 * para saber o que marcar. Por cima, o fundo escurece e a tarefa fica sozinha.
 *
 * O que um `<div>` posicionado à mão erra e isto acerta:
 *
 * - Esc fecha. É a primeira coisa que se tenta, antes de procurar o X.
 * - Clicar no fundo fecha. A segunda coisa que se tenta.
 * - A rolagem da página trava. Sem isso, rolar dentro da caixa arrasta a
 *   página atrás quando a caixa chega ao fim — e o analista perde o lugar.
 * - O foco entra na caixa ao abrir e volta ao botão ao fechar. Quem navega por
 *   teclado, sem isso, continua tabulando pela ficha que está atrás.
 */
export default function Modal({ titulo, ajuda, aberto, onFechar, children }) {
  const caixa = useRef(null)
  const anterior = useRef(null)

  useEffect(() => {
    if (!aberto) return undefined
    anterior.current = document.activeElement
    const rolagem = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // O `setTimeout` espera a caixa existir no DOM. Focar o container, e não o
    // primeiro campo: focar um campo faz o leitor de tela começar pelo meio da
    // tarefa, sem ler o título que explica qual tarefa é.
    const t = setTimeout(() => caixa.current?.focus(), 0)

    const aoTeclar = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', aoTeclar)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = rolagem
      anterior.current?.focus?.()
    }
  }, [aberto, onFechar])

  if (!aberto) return null

  return (
    <div className="modal-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        ref={caixa}
        tabIndex={-1}
      >
        <header className="modal-topo">
          <div>
            <h3>{titulo}</h3>
            {ajuda && <p className="dica-campo">{ajuda}</p>}
          </div>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </header>
        <div className="modal-corpo">{children}</div>
      </section>
    </div>
  )
}
