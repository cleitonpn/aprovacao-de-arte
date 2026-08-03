import { useState } from 'react'
import { enviarArte } from '../services/envio.js'
import { envioConfigurado } from '../config.js'
import { laudoJson } from '../core/mensagem.js'

// A trava: só sobe arte que passou. Reprovada nunca sobe, e "com ressalva" só
// sobe depois de o cliente assumir o risco de forma explícita e registrada.
// É isso que impede a pasta do Drive de virar de novo o depósito de arte ruim.
export function podeEnviar(veredicto, riscoAceito) {
  if (veredicto === 'aprovado') return true
  if (veredicto === 'ressalva') return Boolean(riscoAceito)
  return false
}

const MOTIVO = {
  reprovado: 'A arte precisa dos ajustes acima antes de ser enviada.',
  ressalva: 'Aceite o risco acima para liberar o envio.',
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
          Protocolo <strong>{recibo.protocolo}</strong>. O time de comunicação
          visual já recebeu o arquivo e o laudo desta análise.
        </p>
        <p className="nota">Guarde o protocolo para qualquer conversa sobre esta peça.</p>
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
