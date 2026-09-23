import { useState } from 'react'
import { enviarArte } from '../services/envio.js'
import { envioConfigurado } from '../config.js'
import { laudoJson } from '../core/mensagem.js'
import { TENTAR_DE_NOVO_E_LIVRE } from '../core/laudo.js'
import {
  podeContestar, validarContestacao, contestacaoParaEnvio, MINIMO_MOTIVO,
} from '../core/contestacao.js'

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

export default function Envio({ resultado, arquivo, cadastro, riscoAceito, projeto, onEnviado }) {
  const [estado, setEstado] = useState('parado') // parado | enviando | enviado | erro
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState(null)
  const [recibo, setRecibo] = useState(null)

  // A contestação em preparo. `null` enquanto o cliente não abriu o caminho —
  // e ele fica fechado de propósito: é uma saída, não o caminho normal.
  const [contestando, setContestando] = useState(false)
  const [alegacao, setAlegacao] = useState('')
  const [quem, setQuem] = useState(cadastro?.nome || '')
  const [contato, setContato] = useState(cadastro?.email || '')
  const [errosDaContestacao, setErrosDaContestacao] = useState({})

  const cabimento = podeContestar(resultado)
  const contestacao = contestando && validarContestacao({ motivo: alegacao, nome: quem, email: contato }).valido
    ? contestacaoParaEnvio({ motivo: alegacao, nome: quem, email: contato })
    : null
  const liberado = podeEnviar(resultado.veredicto, riscoAceito, contestacao)

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
      <div className="envio enviado contestado">
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

      {/*
        A saída para quem tem certeza de que a arte está certa.

        Fechada por padrão e abaixo do botão desligado, de propósito: é uma
        SAÍDA, não o caminho normal. Oferecida com o mesmo destaque do envio,
        ela viraria o botão que se aperta quando a análise incomoda — e aí a
        ferramenta teria um desligador, não uma conferência.
      */}
      {resultado.veredicto === 'reprovado' && estado !== 'enviando' && (
        cabimento.pode ? (
          <div className="contestar">
            {!contestando ? (
              <button className="link" type="button" onClick={() => setContestando(true)}>
                Acho que esta arte está correta — quero que o time avalie
              </button>
            ) : (
              <div className="contestar-forma">
                <strong>Contestar a reprovação</strong>
                <p className="ajuda">
                  O arquivo vai para o time junto com o que você escrever aqui, e
                  uma pessoa decide. <strong>A peça não conta como entregue</strong>{' '}
                  enquanto a resposta não sair — e a resposta vem por escrito,
                  com o motivo, aceitando ou não.
                </p>

                <label className="campo">
                  <span>Por que você considera esta arte correta?</span>
                  <textarea
                    rows={4}
                    value={alegacao}
                    maxLength={1000}
                    onChange={(e) => setAlegacao(e.target.value)}
                    placeholder="Ex.: a arte foi montada em 1:10 e a ferramenta leu como tamanho real; o arquivo tem 3.000 dpi na escala de trabalho."
                  />
                  {errosDaContestacao.motivo && <em className="erro-campo">{errosDaContestacao.motivo}</em>}
                  <em className="dica-campo">
                    {alegacao.trim().length}/{MINIMO_MOTIVO} mínimo — quanto mais
                    concreto, mais rápido alguém consegue decidir.
                  </em>
                </label>

                <div className="linha">
                  <label className="campo">
                    <span>Seu nome</span>
                    <input type="text" value={quem} onChange={(e) => setQuem(e.target.value)} autoComplete="name" />
                    {errosDaContestacao.nome && <em className="erro-campo">{errosDaContestacao.nome}</em>}
                  </label>
                  <label className="campo">
                    <span>Seu e-mail <em className="opcional">(para avisarmos da resposta)</em></span>
                    <input type="email" value={contato} onChange={(e) => setContato(e.target.value)} autoComplete="email" />
                    {errosDaContestacao.email && <em className="erro-campo">{errosDaContestacao.email}</em>}
                  </label>
                </div>

                <div className="acoes">
                  <button
                    className="btn btn-risco"
                    type="button"
                    onClick={() => {
                      const { valido, erros } = validarContestacao({ motivo: alegacao, nome: quem, email: contato })
                      setErrosDaContestacao(erros)
                      if (valido) enviar()
                    }}
                  >
                    Enviar para o time avaliar
                  </button>
                  <button className="link" type="button" onClick={() => setContestando(false)}>
                    Cancelar
                  </button>
                </div>
                <p className="nota">
                  Fica registrado com o seu nome e não pode ser apagado — nem por
                  você, nem pelo time. É o que faz dele um argumento no dia em
                  que a peça for discutida.
                </p>
              </div>
            )}
          </div>
        ) : cabimento.motivo === 'insuperavel' && (
          /*
            Há reprovação que uma segunda opinião não muda. Oferecer contestação
            aqui seria vender uma esperança falsa e adiar a descoberta para o dia
            da impressão, que é quando custa caro — então a tela diz o que fazer
            em vez de abrir um caminho que não leva a lugar nenhum.
          */
          <p className="nota">{cabimento.explicacao}</p>
        )
      )}
    </div>
  )
}
