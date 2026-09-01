import { useEffect, useReducer } from 'react'
import Conversa from './Conversa.jsx'
import { temMensagemNova, chaveDaConversa } from '../core/conversa.js'
import { assinarVisto, vistoEm } from '../store/visto.js'
import { SUPORTE } from '../core/tutorial.js'

// A conversa deixa de ser uma seção no fim da página e vira um canto da tela.
//
// Dois motivos, um de cada lado. Do lado do cliente: ele passa a maior parte do
// tempo DENTRO de uma peça, enviando arquivo — e a conversa vivia na lista,
// duas telas atrás. Quem trava no meio de um envio não navega para trás
// procurando onde perguntar; ele liga, que é o telefonema que a ferramenta
// existe para evitar. Do lado do time: a resposta do cliente chegava e nada
// mudava na tela até alguém rolar até o fim do painel.
//
// A bolha fica, a badge acende, e a conversa abre por cima sem tirar ninguém de
// onde estava. Ela não abre sozinha quando chega mensagem: roubar a tela de
// quem está no meio de um envio é o caminho mais curto para o popup ser fechado
// sem ser lido.

export default function ConversaFlutuante({
  token, conversa, ehTime = false, sessao = null, identidade = null,
  aberta, onMudarAberta,
}) {
  // A badge é desenhada a partir do localStorage, que não avisa quando muda.
  // Sem esta inscrição, abrir a conversa marcava como visto e a bolinha
  // continuava acesa até um F5 — o mesmo F5 que a escuta em tempo real veio
  // eliminar. É o defeito que já apareceu uma vez nas abas do painel.
  const [, redesenhar] = useReducer((n) => n + 1, 0)
  useEffect(() => assinarVisto(redesenhar), [])

  const quem = ehTime ? sessao?.usuario?.email : null
  const novidade = temMensagemNova({
    conversa,
    ehTime,
    vistoEmMs: vistoEm(quem, chaveDaConversa(token)),
  })

  // Esc fecha. Numa caixa que cobre parte da tela isso não é refinamento: é a
  // saída que a pessoa tenta primeiro quando o botão de fechar não está óbvio.
  useEffect(() => {
    if (!aberta) return undefined
    const aoTeclar = (e) => { if (e.key === 'Escape') onMudarAberta(false) }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberta, onMudarAberta])

  return (
    <div className={`conversa-flutuante ${aberta ? 'aberta' : ''}`}>
      {aberta && (
        <section className="conversa-painel" role="dialog" aria-label={ehTime ? 'Conversa com o cliente' : 'Conversa com a equipe'}>
          <header className="conversa-painel-topo">
            <div>
              <strong>{ehTime ? 'Conversa com o cliente' : 'Falar com a equipe'}</strong>
              {/*
                O horário aparece na abertura, não no rodapé. Quem escreve às
                22h de domingo precisa saber ANTES de esperar resposta — e é
                justamente quem está travado no envio que escreve fora de hora.
              */}
              <span className="dica-campo">
                {ehTime ? 'A resposta aparece na tela do cliente.' : `A equipe responde ${SUPORTE.texto}.`}
              </span>
            </div>
            <button
              className="conversa-fechar"
              onClick={() => onMudarAberta(false)}
              aria-label="Fechar a conversa"
            >
              ×
            </button>
          </header>
          <div className="conversa-painel-corpo">
            <Conversa token={token} ehTime={ehTime} sessao={sessao} identidade={identidade} embutida />
          </div>
        </section>
      )}

      <button
        className={`conversa-bolha ${novidade && !aberta ? 'com-novidade' : ''}`}
        onClick={() => onMudarAberta(!aberta)}
        aria-expanded={aberta}
      >
        <span className="conversa-bolha-icone" aria-hidden>{aberta ? '×' : '💬'}</span>
        <span className="conversa-bolha-texto">
          {aberta ? 'Fechar' : ehTime ? 'Conversa' : 'Falar com a equipe'}
        </span>
        {/*
          Ponto, e não número. O aviso vem do resumo gravado no projeto, que
          guarda a última mensagem e o autor dela — não uma contagem. Escrever
          "1" ali seria inventar um número que ninguém apurou, e três mensagens
          novas apareceriam como uma.
        */}
        {novidade && !aberta && (
          <span className="badge-nova" role="status">
            <span className="so-leitor">mensagem nova {ehTime ? 'do cliente' : 'da equipe'}</span>
          </span>
        )}
      </button>
    </div>
  )
}
