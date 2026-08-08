import { useEffect, useRef } from 'react'
import { CONFERENCIA_DO_TIME, PASSOS, REQUISITOS, SUPORTE } from '../core/tutorial.js'

// O tutorial que abre sozinho na primeira visita.
//
// Ele existe porque a tela do cliente pede decisões que ninguém tomou antes:
// o que é ressalva, por que aceitar uma tem nome e e-mail, onde vai o logo,
// até quando dá para trocar a arte. Quem já trabalha com impressão sabe; quem
// abre o link é, na maioria das vezes, o marketing do expositor.
//
// Duas regras que valem para caixa que aparece sozinha, e que são o que separa
// ajuda de estorvo:
//
// - fecha por toda porta que a pessoa tentar — Esc, clique fora, o X, o botão.
//   Modal que prende é pior do que modal nenhum;
// - só interrompe UMA vez. Depois vira um botão discreto, que continua ali
//   para quem precisar reler.

export default function Tutorial({ aberto, onFechar, onVerApoio }) {
  const caixa = useRef(null)
  const focoAnterior = useRef(null)

  useEffect(() => {
    if (!aberto) return undefined

    // Devolver o foco ao sair é o que faz o teclado não voltar para o começo
    // da página — e é a diferença entre navegável e navegável só com mouse.
    focoAnterior.current = document.activeElement
    caixa.current?.focus()

    const aoTeclar = (e) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', aoTeclar)

    // Trava a rolagem do fundo: sem isto, rolar dentro do tutorial no celular
    // arrasta a página atrás dele e a pessoa perde o lugar onde estava.
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflowAnterior
      focoAnterior.current?.focus?.()
    }
  }, [aberto, onFechar])

  if (!aberto) return null

  return (
    <div className="tutorial-fundo" onClick={onFechar}>
      <div
        className="tutorial"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-titulo"
        tabIndex={-1}
        ref={caixa}
        // O clique de fechar é o do FUNDO. Sem parar a propagação aqui, clicar
        // em qualquer lugar do texto fecharia o tutorial.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tutorial-topo">
          <div>
            <h2 id="tutorial-titulo">Como funciona o envio</h2>
            <p className="ajuda">
              Dois minutos de leitura que evitam a maior parte das idas e
              voltas. Dá para reabrir quando quiser, no botão{' '}
              <strong>Como funciona</strong>.
            </p>
          </div>
          <button className="tutorial-fechar" onClick={onFechar} aria-label="Fechar o tutorial">×</button>
        </header>

        <div className="tutorial-corpo">
          <section>
            <h3>O caminho da arte</h3>
            <ol className="tutorial-passos">
              {PASSOS.map((p, i) => (
                <li key={p.titulo}>
                  <span className="tutorial-numero" aria-hidden>{i + 1}</span>
                  <div>
                    <strong>{p.titulo}</strong>
                    <p>{p.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3>O que o arquivo precisa ter</h3>
            <dl className="tutorial-requisitos">
              {REQUISITOS.map((r) => (
                <div key={r.titulo}>
                  <dt>{r.titulo}</dt>
                  <dd>{r.texto}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="tutorial-conferencia">
            <h3>Até onde vai a conferência do time</h3>
            <p>
              Depois desta tela, a comunicação visual faz uma segunda análise —{' '}
              <strong>técnica</strong>. Vale saber exatamente o que ela alcança, porque o
              que está fora dela continua sendo seu.
            </p>
            <div className="tutorial-fronteira">
              <div className="confere">
                <strong>O time confere</strong>
                <ul>
                  {CONFERENCIA_DO_TIME.confere.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </div>
              <div className="nao-confere">
                <strong>O time não confere</strong>
                <ul>
                  {CONFERENCIA_DO_TIME.naoConfere.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </div>
            </div>
            <p className="ajuda">{CONFERENCIA_DO_TIME.porque}</p>
            <p className="tutorial-responsabilidade">
              <strong>{CONFERENCIA_DO_TIME.responsabilidade}</strong>
            </p>
          </section>

          <section className="tutorial-apoio">
            <h3>Onde vai o seu logo</h3>
            <p>
              Logo, fontes e manual de marca <strong>não são peça impressa</strong> e
              não entram na lista acima — eles têm uma caixa própria,{' '}
              <strong>Arquivos de apoio</strong>, no fim desta página. Nada ali
              passa pela análise de arte, mas a ferramenta confere se o logo
              está <strong>vetorizado</strong>, que é o que decide se ele pode
              ser ampliado para uma testeira de 6 metros sem serrilhar.
            </p>
            {onVerApoio && (
              <button className="btn btn-ghost" onClick={onVerApoio}>
                Me mostre onde fica ↓
              </button>
            )}
          </section>

          <section className="tutorial-suporte">
            <h3>Falar com a gente</h3>
            <p>
              Dúvida de medida, material ou prazo: use a caixa{' '}
              <strong>Dúvidas com o time</strong>, no fim da página. A conversa
              fica registrada junto com as artes deste stand — sem precisar
              procurar depois quem falou o quê no WhatsApp.
            </p>
            <p className="tutorial-horario">
              Atendimento <strong>{SUPORTE.texto}</strong>. Fora desse horário a
              mensagem fica registrada e é respondida no próximo dia útil.
            </p>
          </section>
        </div>

        <footer className="tutorial-rodape">
          <button className="btn" onClick={onFechar}>Entendi, vamos começar</button>
        </footer>
      </div>
    </div>
  )
}
