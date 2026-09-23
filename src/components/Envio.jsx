import { useEffect, useRef, useState } from 'react'
import { enviarArte } from '../services/envio.js'
import { envioConfigurado } from '../config.js'
import { laudoJson } from '../core/mensagem.js'
import { TENTAR_DE_NOVO_E_LIVRE } from '../core/laudo.js'

// A trava: só sobe arte que passou. Reprovada nunca sobe, e "com ressalva" só
// sobe depois de o cliente assumir o risco de forma explícita e registrada.
// É isso que impede a pasta do Drive de virar de novo o depósito de arte ruim.
//
// A CONTESTAÇÃO é a terceira porta, e a única por onde arte reprovada sobe.
// Ela não afrouxa a trava: o veredicto continua 'reprovado', a peça NÃO conta
// como entregue, e o arquivo só chega marcado, com a alegação assinada, para
// uma pessoa do time decidir. O que ela resolve é o impasse que não tinha
// saída — o cliente convicto de que a arte está certa e o time sem como
// conferir, porque o arquivo nunca chegava.
export function podeEnviar(veredicto, riscoAceito, contestacao = null) {
  if (veredicto === 'aprovado') return true
  if (veredicto === 'ressalva') return Boolean(riscoAceito)
  if (veredicto === 'reprovado') return Boolean(contestacao)
  return false
}

// O botão desligado precisa dizer o que o LIGA.
//
// "A arte precisa dos ajustes acima antes de ser enviada" descreve o estado e
// para por aí — quem chegou aqui já sabia que estava travado. O que faltava era
// a frase seguinte: e nada do que você tentar até lá é enviado ao time.
const MOTIVO = {
  reprovado: `Este botão liga sozinho assim que uma versão da arte passar na conferência. ${TENTAR_DE_NOVO_E_LIVRE}`,
  ressalva: 'Para liberar o envio, aceite o risco na caixa amarela acima — ou troque o arquivo, se preferir corrigir.',
}

export default function Envio({ resultado, arquivo, cadastro, riscoAceito, projeto, contestacao = null, onEnviado }) {
  const [estado, setEstado] = useState('parado') // parado | enviando | enviado | erro
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState(null)
  const [recibo, setRecibo] = useState(null)
  const caixa = useRef(null)

  /*
    A confirmação da contestação aparece AQUI, e o cliente clicou lá em cima,
    na caixa "E agora?". Sem rolar, ele fica olhando um botão escrito
    "Enviando…" com a resposta fora da tela — e a reação natural é clicar de
    novo.
  */
  useEffect(() => {
    if (estado === 'enviado' && recibo?.contestada) {
      caixa.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [estado, recibo])


  const liberado = podeEnviar(resultado.veredicto, riscoAceito, contestacao)

  const enviar = async () => {
    setEstado('enviando')
    setErro(null)
    setProgresso(0)
    try {
      const r = await enviarArte(arquivo, {
        cadastro,
        peca: resultado.peca,
        perfil: resultado.perfil,
        veredicto: resultado.veredicto,
        riscoAceito,
        contestacao,
        laudo: laudoJson(resultado),
        projeto,
      }, setProgresso)
      setRecibo({ ...r, contestada: Boolean(contestacao) })
      setEstado('enviado')
      // O aviso ao projeto é o que marca a peça como entregue na tela do
      // cliente. Se falhar, o envio continua válido — quem manda é o registro
      // em `envios`, que o time lê no painel.
      try {
        await onEnviado?.({ ...r, veredicto: resultado.veredicto, riscoAceito, contestacao })
      } catch (falha) {
        console.warn('arte enviada, mas não foi possível atualizar o painel do cliente', falha)
      }
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar a arte.')
      setEstado('erro')
    }
  }

  // Declarado ANTES dos `return` antecipados de propósito: o efeito abaixo o
  // chama, e num render que sai cedo ele nunca chegaria a ser atribuído —
  // `const` em zona morta temporal, que quebraria com um ReferenceError sem
  // relação aparente com o que a pessoa clicou.

  /*
    A contestação chega PRONTA, de dentro da caixa "E agora?".

    O formulário morava aqui embaixo, como um link solto sob o botão desligado,
    e ficava invisível para quem mais precisava dele. Agora ele é a quarta
    saída da caixa azul, junto das outras três — e quando o cliente conclui, a
    contestação desce como prop e este efeito dispara o envio.

    A guarda de `estado` é o que impede envio duplo: sem ela, qualquer
    re-render com a mesma contestação mandaria o arquivo de novo.
  */
  useEffect(() => {
    if (contestacao && estado === 'parado') enviar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestacao])

  if (!envioConfigurado()) {
    return (
      <div className="envio nao-configurado">
        <p>
          O envio automático ainda não está configurado nesta instalação. Use
          <strong> Baixar laudo</strong> e mande a arte pelo caminho de sempre.
        </p>
      </div>
    )
  }

  // A confirmação de uma CONTESTAÇÃO não pode ser a de um envio comum.
  //
  // "Arte enviada — você não precisa fazer mais nada" seria mentira aqui: a
  // peça não está entregue, ela está esperando uma pessoa decidir. Dizer o
  // contrário faria o cliente parar de acompanhar justamente o caso que mais
  // precisa de acompanhamento.
  if (estado === 'enviado' && recibo?.contestada) {
    return (
      <div className="envio enviado contestado" ref={caixa}>
        <h3>Contestação enviada ao time</h3>
        <p>
          O arquivo e o seu argumento chegaram ao time de comunicação visual.
          <strong> Esta peça ainda não está entregue</strong> — ela fica
          aguardando a avaliação de uma pessoa.
        </p>
        <ol className="depois-do-envio">
          <li>Alguém do time abre o arquivo e lê o que você escreveu.</li>
          <li>A resposta vem por escrito, com o motivo — tanto se for aceita quanto se não for.</li>
          <li>Se for aceita, a peça passa a contar como entregue. Se não for, você verá exatamente o que precisa mudar.</li>
        </ol>
        <p className="nota">
          O número deste envio é <strong>{recibo.protocolo}</strong>. Se precisar
          falar sobre ele antes da resposta, use a conversa com o time nesta
          mesma página.
        </p>
      </div>
    )
  }

  if (estado === 'enviado') {
    return (
      <div className="envio enviado">
        <h3>✓ Arte enviada</h3>
        <p>
          O time de comunicação visual já recebeu o arquivo e o laudo desta
          análise. <strong>Você não precisa fazer mais nada agora.</strong>
        </p>
        {/* O que vem depois, em ordem. Sem isto, "arte enviada" é o fim da
            informação: o cliente não sabe se falta algo dele, e volta a ligar
            para perguntar em que pé está. */}
        <ol className="depois-do-envio">
          <li>O time confere a arte.</li>
          <li>Se algo precisar mudar, você recebe um e-mail e a peça volta a aceitar arte nova aqui.</li>
          <li>Quando a prova de impressão estiver pronta, ela aparece nesta página e você recebe um e-mail para aprovar. Nada é impresso antes desse seu aceite.</li>
        </ol>
        <p className="nota">
          O número deste envio é <strong>{recibo.protocolo}</strong> — é por ele
          que o time acha esta arte se você precisar falar sobre ela. Ele também
          fica guardado no cartão da peça, então não precisa anotar.
        </p>
      </div>
    )
  }

  return (
    <div className="envio">
      <button
        className="btn btn-enviar largo"
        disabled={!liberado || estado === 'enviando'}
        onClick={enviar}
      >
        {estado === 'enviando'
          ? `Enviando… ${Math.round(progresso * 100)}%`
          : estado === 'erro' ? 'Tentar enviar novamente' : 'Enviar arte para produção'}
      </button>

      {estado === 'enviando' && (
        <div className="barra" role="progressbar" aria-valuenow={Math.round(progresso * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${Math.max(2, progresso * 100)}%` }} />
        </div>
      )}

      {!liberado && <p className="nota">{MOTIVO[resultado.veredicto]}</p>}
      {erro && <p className="erro-envio">{erro}</p>}

    </div>
  )
}
