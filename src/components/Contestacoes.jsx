import { useEffect, useMemo, useState } from 'react'
import { ouvirContestacoes, decidirContestacao } from '../services/projetos.js'
import { traduzirErroAuth } from '../services/sessao.js'
import {
  casosDeContestacao, placarPorMotivo, validarDecisao, MINIMO_MOTIVO,
} from '../core/contestacao.js'
import { formatarDataHora as fmtDataHora } from '../core/datas.js'

// O log das contestações — e a fila de quem ainda espera decisão.
//
// Esta tela tem DOIS trabalhos, e o segundo é o que justifica ela existir
// separada do resto do painel.
//
// O primeiro é operacional: alguém precisa olhar a arte que o cliente
// contestou e responder, por escrito, aceitando ou não. Sem isso a
// contestação vira um buraco — o cliente manda e nada acontece, que é pior do
// que o impasse que ela veio resolver.
//
// O segundo é de calibragem, e é o motivo de os três textos ficarem juntos na
// mesma linha: o que a FERRAMENTA reprovou, o que o CLIENTE alegou e o que a
// PESSOA decidiu. Separados, ninguém cruza. Juntos, o padrão aparece — um
// achado que o time aceita quase sempre é um limiar apertado demais; um que
// ele recusa quase sempre está calibrado e o que falta é explicação melhor na
// tela do cliente.
//
// Sem recorte de feira, e isso é deliberado: limiar mal calibrado não é
// problema de uma feira só, e olhar feira a feira esconderia justamente o
// padrão que se veio procurar.

export default function Contestacoes({ sessao }) {
  const [envios, setEnvios] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [filtro, setFiltro] = useState('abertas')

  useEffect(() => {
    if (!sessao?.fb) return undefined
    setCarregando(true)
    return ouvirContestacoes(sessao.fb, (lista) => {
      setEnvios(lista)
      setCarregando(false)
      setErro(null)
    }, (e) => {
      console.error(e)
      setErro(traduzirErroAuth(e))
      setCarregando(false)
    })
  }, [sessao?.fb])

  const casos = useMemo(() => casosDeContestacao(envios), [envios])
  const placar = useMemo(() => placarPorMotivo(casos), [casos])
  const abertas = casos.filter((c) => c.estado === 'aguardando')

  const mostrar = filtro === 'abertas' ? abertas : casos

  return (
    <>
      <div className="cartao">
        <div className="admin-topo">
          <div>
            <h2>Contestações</h2>
            <p className="ajuda">
              Artes que a análise reprovou e que o cliente afirmou, por escrito
              e assinado, estarem corretas. Cada uma precisa de uma decisão
              — com motivo escrito, aceitando ou não.
            </p>
          </div>
          <span className="dica-campo ao-vivo">ao vivo</span>
        </div>

        {erro && <p className="erro-envio">{erro}</p>}

        <div className="acoes compactas">
          <button
            className={`btn ${filtro === 'abertas' ? '' : 'btn-ghost'}`}
            onClick={() => setFiltro('abertas')}
          >
            Aguardando decisão ({abertas.length})
          </button>
          <button
            className={`btn ${filtro === 'todas' ? '' : 'btn-ghost'}`}
            onClick={() => setFiltro('todas')}
          >
            Todas ({casos.length})
          </button>
        </div>

        <Placar placar={placar} />
      </div>

      {carregando && <div className="cartao"><p className="ajuda">Carregando…</p></div>}

      {!carregando && !mostrar.length && (
        <div className="cartao">
          <p className="ajuda">
            {filtro === 'abertas'
              ? 'Nenhuma contestação esperando decisão.'
              : 'Nenhuma contestação registrada ainda.'}
          </p>
        </div>
      )}

      {mostrar.map((caso) => (
        <Caso
          key={caso.protocolo}
          caso={caso}
          sessao={sessao}
        />
      ))}
    </>
  )
}

/**
 * O placar por motivo — a leitura que calibra a ferramenta.
 *
 * Um número sozinho ("12 contestações") não diz nada de acionável. O que diz é
 * a PROPORÇÃO por achado: "dimensão — 7 aceitas, 1 recusada" é a ferramenta
 * reprovando arte boa, e o lugar de consertar isso é o limiar, não a fila.
 */
function Placar({ placar }) {
  if (!placar.length) return null
  return (
    <div className="placar-contestacao">
      <span className="dica-campo">
        O que o time decidiu, por motivo da reprovação — quanto mais aceitas,
        mais suspeito o limiar:
      </span>
      <ul className="pecas-lista">
        {placar.map((p) => {
          // Só vira alerta com base suficiente. Duas decisões não são padrão,
          // são duas decisões — e tratar isso como sinal levaria a mexer num
          // limiar por causa de um caso atípico.
          const suspeito = p.total >= 3 && p.aceitas > p.recusadas
          return (
            <li key={p.id} className={suspeito ? 'pendente' : 'entregue'}>
              <span className="marca" aria-hidden>{suspeito ? '!' : '·'}</span>
              <div>
                <strong>{p.titulo || p.id}</strong>
                <em className="dica-campo">
                  {' · '}{p.aceitas} aceita(s) · {p.recusadas} recusada(s)
                </em>
                {suspeito && (
                  <p className="dica-campo destaque-pendencia">
                    A ferramenta reprovou mais arte boa que ruim neste motivo.
                    Vale rever o limiar.
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Caso({ caso, sessao }) {
  const [aceita, setAceita] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [erros, setErros] = useState({})
  const [ocupado, setOcupado] = useState(false)
  const [falha, setFalha] = useState(null)

  const decidir = async () => {
    const { valido, erros: novos } = validarDecisao({ aceita, motivo })
    setErros(novos)
    if (!valido) return
    setOcupado(true)
    setFalha(null)
    try {
      await decidirContestacao(sessao.fb, caso.protocolo, {
        aceita,
        motivo,
        por: sessao.usuario?.email,
      })
      // Sem limpar o formulário: a escuta traz o caso já decidido e ele troca
      // de forma sozinho.
    } catch (e) {
      console.error(e)
      setFalha(traduzirErroAuth(e, 'gravacao'))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className={`cartao caso-contestacao ${caso.estado}`}>
      <div className="admin-topo">
        <div>
          <h3>{caso.expositor} · {caso.stand}</h3>
          <p className="ajuda">
            {caso.peca} · {fmtDataHora(caso.em)} · protocolo <strong>{caso.protocolo}</strong>
          </p>
        </div>
        <span className={`tag ${caso.estado === 'aguardando' ? 'alerta' : caso.estado === 'aceita' ? 'aprovado' : 'reprovado'}`}>
          {caso.estado === 'aguardando' ? 'aguardando decisão' : caso.estado === 'aceita' ? 'aceita' : 'recusada'}
        </span>
      </div>

      <div className="tres-lados">
        <div>
          <span className="spec-titulo">O que a ferramenta reprovou</span>
          <ul className="achados">
            {caso.motivosDaFerramenta.length
              ? caso.motivosDaFerramenta.map((m, i) => <li key={`${caso.protocolo}-${i}`}>{m.titulo}</li>)
              : <li className="dica-campo">— sem motivo bloqueante registrado</li>}
          </ul>
        </div>

        <div>
          <span className="spec-titulo">O que o cliente alegou</span>
          <p className="alegacao">{caso.alegacao}</p>
          <em className="dica-campo">— {caso.quemContestou}</em>
        </div>
      </div>

      {/*
        O arquivo é o ponto: contestação sem abrir o arquivo é palpite. Foi
        justamente para ele chegar aqui que este caminho existe.
      */}
      {caso.arquivo && (
        <p className="dica-campo">
          Arquivo: <strong>{caso.arquivo.nome}</strong>
          {caso.arquivo.tamanho ? ` · ${(caso.arquivo.tamanho / 1048576).toFixed(1)} MB` : ''}
          {caso.arquivo.link && <> · <a href={caso.arquivo.link} target="_blank" rel="noreferrer">abrir</a></>}
        </p>
      )}

      {caso.decisao ? (
        <div className={`decisao ${caso.decisao.aceita ? 'aceita' : 'recusada'}`}>
          <strong>
            {caso.decisao.aceita ? '✓ Aceita pelo time' : '× Recusada pelo time'}
          </strong>
          <p>{caso.decisao.motivo}</p>
          <em className="dica-campo">
            {caso.decisao.por || 'time'} · {fmtDataHora(caso.decisao.em)}
          </em>
        </div>
      ) : (
        <div className="decidir">
          <div className="escolha-modo">
            <label className={aceita === true ? 'ativo' : ''}>
              <input type="radio" checked={aceita === true} onChange={() => setAceita(true)} />
              <span>
                <strong>Aceitar — o cliente tem razão</strong>
                <em>A peça passa a contar como entregue. O caso fica no log como reprovação indevida da ferramenta.</em>
              </span>
            </label>
            <label className={aceita === false ? 'ativo' : ''}>
              <input type="radio" checked={aceita === false} onChange={() => setAceita(false)} />
              <span>
                <strong>Recusar — a reprovação está certa</strong>
                <em>A peça continua pendente. O cliente vê o motivo que você escrever e sabe o que corrigir.</em>
              </span>
            </label>
          </div>
          {erros.aceita && <em className="erro-campo">{erros.aceita}</em>}

          <label className="campo">
            <span>Motivo da decisão <strong>(obrigatório nos dois casos)</strong></span>
            <textarea
              rows={3}
              maxLength={1000}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: a arte estava em 1:10 e a ferramenta leu como tamanho real — resolução real é de 300 dpi no tamanho final. Aceito."
            />
            {erros.motivo && <em className="erro-campo">{erros.motivo}</em>}
            <em className="dica-campo">
              {motivo.trim().length}/{MINIMO_MOTIVO} mínimo. Este texto vai
              inteiro para a tela do cliente e fica no log — é dele que sai a
              calibragem depois.
            </em>
          </label>

          {falha && <p className="erro-envio">{falha}</p>}

          <div className="acoes">
            <button className="btn" disabled={ocupado} onClick={decidir}>
              {ocupado ? 'Gravando…' : 'Registrar decisão'}
            </button>
            <em className="dica-campo">A decisão é definitiva e não pode ser reescrita.</em>
          </div>
        </div>
      )}
    </section>
  )
}
