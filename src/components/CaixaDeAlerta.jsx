import { useState } from 'react'

/**
 * Um bloco de informação recolhido até alguém querer vê-lo.
 *
 * Nasceu para as duas listas vermelhas do painel — as mais importantes da tela
 * e as que mais poluíam: abertas, dezoito linhas de vermelho empurravam o resto
 * para fora, e uma tela em que tudo é urgente não tem urgência nenhuma.
 * Recolhida, sobra o que decide se vale abrir: o título, a contagem e o motivo.
 *
 * A contagem fica NO título, e não só numa bolinha. "Ligar hoje" com um ponto
 * ao lado exige um clique para saber se são dois ou trinta stands, e essa
 * diferença muda a manhã de quem está lendo.
 *
 * `cor` existe porque a ficha do stand reusa isto para coisas que não são
 * alarme — o histórico de contato, por exemplo. Vermelho em tudo é o mesmo que
 * vermelho em nada.
 */
export default function CaixaDeAlerta({
  titulo, quantos, etiqueta, ajuda, children, abertaPorPadrao = false,
  cor = 'alerta', mostrarZero = false,
}) {
  const [aberta, setAberta] = useState(abertaPorPadrao)
  if (!quantos && !mostrarZero) return null

  return (
    <div className={`cartao caixa-alerta cor-${cor} ${aberta ? 'aberta' : ''}`}>
      <button
        type="button"
        className="caixa-alerta-topo"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
      >
        <span className="caixa-alerta-titulo">
          {quantos != null && <span className="badge-alerta">{quantos}</span>}
          <strong>{titulo}</strong>
        </span>
        <span className="caixa-alerta-lado">
          {etiqueta && <span className="tag aviso">{etiqueta}</span>}
          <span className="caixa-alerta-mais" aria-hidden>{aberta ? '−' : '+'}</span>
        </span>
      </button>

      {aberta && (
        <div className="caixa-alerta-corpo">
          {ajuda && <p className="ajuda">{ajuda}</p>}
          {children}
        </div>
      )}
    </div>
  )
}
