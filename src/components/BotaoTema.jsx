import { useEffect, useState } from 'react'
import { temaGuardado, guardarTema, proximoTema, aplicarTema, ROTULO_TEMA } from '../store/tema.js'

/**
 * Botão de tema, no alto de toda tela.
 *
 * Um botão que cicla, e não três opções lado a lado: são três estados, mas a
 * pessoa clica no máximo duas vezes para chegar em qualquer um, e o alto da
 * tela não é lugar para um seletor de configuração. O estado atual fica
 * escrito no próprio botão — sem isso, "automático" e "claro" ficam idênticos
 * num computador claro, e o clique vira adivinhação.
 */
export default function BotaoTema() {
  const [tema, setTema] = useState(temaGuardado)

  // Rede de segurança: o `index.html` já aplicou o tema antes do primeiro
  // pixel (é o que evita a piscada de branco). Isto cobre o caso de a
  // aplicação montar num documento que não passou por lá.
  useEffect(() => { aplicarTema(tema) }, [tema])

  const proximo = proximoTema(tema)
  const atual = ROTULO_TEMA[tema]

  return (
    <button
      className="btn btn-ghost botao-tema"
      onClick={() => setTema(guardarTema(proximo))}
      aria-label={`${atual.nome}. Trocar para ${ROTULO_TEMA[proximo].nome.toLowerCase()}.`}
      title={`${atual.nome} — clique para ${ROTULO_TEMA[proximo].nome.toLowerCase()}`}
    >
      <span className="botao-tema-icone" aria-hidden>{atual.icone}</span>
      <span className="botao-tema-texto">{atual.curto}</span>
    </button>
  )
}
