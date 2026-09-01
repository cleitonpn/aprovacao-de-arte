import { useState } from 'react'
import { enviarArte } from '../services/envio.js'
import { envioConfigurado } from '../config.js'
import { laudoJson } from '../core/mensagem.js'
import { TENTAR_DE_NOVO_E_LIVRE } from '../core/laudo.js'

// A trava: só sobe arte que passou. Reprovada nunca sobe, e "com ressalva" só
// sobe depois de o cliente assumir o risco de forma explícita e registrada.
// É isso que impede a pasta do Drive de virar de novo o depósito de arte ruim.
export function podeEnviar(veredicto, riscoAceito) {
  if (veredicto === 'aprovado') return true
  if (veredicto === 'ressalva') return Boolean(riscoAceito)
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

export default function Envio({ resultado, arquivo, cadastro, riscoAceito, projeto, onEnviado }) {
  const [estado, setEstado] = useState('parado') // parado | enviando | enviado | erro
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState(null)
  const [recibo, setRecibo] = useState(null)

  const liberado = podeEnviar(resultado.veredicto, riscoAceito)

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
        laudo: laudoJson(resultado),
        projeto,
      }, setProgresso)
      setRecibo(r)
      setEstado('enviado')
      // O aviso ao projeto é o que marca a peça como entregue na tela do
      // cliente. Se falhar, o envio continua válido — quem manda é o registro
      // em `envios`, que o time lê no painel.
      try {
        await onEnviado?.({ ...r, veredicto: resultado.veredicto, riscoAceito })
      } catch (falha) {
        console.warn('arte enviada, mas não foi possível atualizar o painel do cliente', falha)
      }
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar a arte.')
      setEstado('erro')
    }
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
