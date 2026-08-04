import { useRef, useState } from 'react'
import { STATUS, AVISO_EXTRA } from '../core/fluxo.js'
import {
  liberarNovaVersao, recusarNovaVersao, definirStatusDaPeca, registrarProva, prorrogarPrazo,
} from '../services/projetos.js'
import { enviarProva, EXTENSOES_PROVA } from '../services/envio.js'
import { traduzirErroAuth } from '../services/sessao.js'

// O que o analista faz com um projeto: responder pedidos, mandar a prova de
// aprovação, marcar o que entrou em impressão e prorrogar prazo caso a caso.
//
// A tela é organizada pela pergunta "o que precisa de mim agora?" — pedidos em
// aberto no topo, o resto abaixo. Uma lista de peças em ordem alfabética seria
// mais simples de programar e inútil na operação: o analista abre isto entre
// duas ligações e precisa ver a pendência, não o inventário.

const fmtDataHora = (v) => (v ? new Date(typeof v === 'string' ? v : v.seconds * 1000).toLocaleString('pt-BR') : '—')
const paraInputData = (v) => {
  if (!v) return ''
  const ms = typeof v === 'string' ? Date.parse(v) : v.seconds * 1000
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''
}
// O prazo vale até o FIM do dia escolhido. Guardar 00:00 faria "prazo dia 10"
// vencer na virada do dia 9 para o 10, e ninguém entende o prazo assim.
const fimDoDia = (aaaammdd) => (aaaammdd ? new Date(`${aaaammdd}T23:59:59`).toISOString() : null)

export default function PainelProjeto({ sessao, projeto, resumo, envios, onFechar, onMudou }) {
  const [erro, setErro] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const rodar = async (acao) => {
    setOcupado(true)
    setErro(null)
    try {
      await acao()
      await onMudou()
    } catch (e) {
      console.error(e)
      setErro(traduzirErroAuth(e))
    } finally {
      setOcupado(false)
    }
  }

  const enviosPorPeca = new Map()
  for (const e of envios) {
    if (!e.pecaId) continue
    if (!enviosPorPeca.has(e.pecaId)) enviosPorPeca.set(e.pecaId, [])
    enviosPorPeca.get(e.pecaId).push(e)
  }
  for (const lista of enviosPorPeca.values()) {
    lista.sort((a, b) => (a.versao || 1) - (b.versao || 1))
  }

  return (
    <>
      <div className="cartao">
        <div className="admin-topo">
          <div>
            <h2>{projeto.stand}</h2>
            <p className="ajuda">
              {projeto.expositor} · <a href={`mailto:${projeto.email}`}>{projeto.email}</a>
              {projeto.localizacao && ` · ${projeto.localizacao}`}
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onFechar}>← Todos os projetos</button>
        </div>

        {erro && <p className="erro-envio">{erro}</p>}

        <Prazo projeto={projeto} resumo={resumo} ocupado={ocupado} onProrrogar={(ate) => rodar(
          () => prorrogarPrazo(sessao.fb, projeto.token, ate, sessao.usuario?.email),
        )} />
      </div>

      {resumo.pedidosEmAberto.length > 0 && (
        <div className="cartao pedidos-abertos">
          <h3>Pedidos aguardando sua resposta ({resumo.pedidosEmAberto.length})</h3>
          {resumo.pedidosEmAberto.map((s) => (
            <Pedido
              key={s.peca.id}
              situacao={s}
              ocupado={ocupado}
              onLiberar={(observacao) => rodar(() => liberarNovaVersao(sessao.fb, projeto.token, s.peca.id, {
                ate: s.proximaVersao,
                observacao,
                por: sessao.usuario?.email,
                // Liberar arte nova numa peça que está na impressora é liberar
                // reimpressão: deixar o status como estava faria a tela dizer
                // que imprime a arte antiga e aceita a nova ao mesmo tempo.
                limparStatus: s.status === 'em_impressao' || s.status === 'impressa',
              }))}
              onRecusar={(motivo, exigeExtra) => rodar(() => recusarNovaVersao(sessao.fb, projeto.token, s.peca.id, {
                motivo, exigeExtra, por: sessao.usuario?.email,
              }))}
            />
          ))}
        </div>
      )}

      <NovaProva
        sessao={sessao}
        projeto={projeto}
        resumo={resumo}
        ocupado={ocupado}
        onEnviar={(dados) => rodar(() => registrarProva(sessao.fb, projeto.token, { ...dados, por: sessao.usuario?.email }))}
      />

      <ArquivosDeApoio apoio={resumo.apoio} />

      <div className="cartao">
        <h3>Peças</h3>
        {resumo.pecas.map((s) => (
          <PecaDoTime
            key={s.peca.id}
            situacao={s}
            envios={enviosPorPeca.get(s.peca.id) || []}
            ocupado={ocupado}
            onStatus={(status) => rodar(
              () => definirStatusDaPeca(sessao.fb, projeto.token, s.peca.id, status, sessao.usuario?.email),
            )}
            onLiberar={(limparStatus) => rodar(() => liberarNovaVersao(sessao.fb, projeto.token, s.peca.id, {
              ate: s.proximaVersao,
              observacao: limparStatus
                ? 'Reimpressão liberada pelo time — custo extra acertado com o atendimento.'
                : 'Liberado pelo time sem pedido do cliente.',
              por: sessao.usuario?.email,
              limparStatus,
            }))}
          />
        ))}
      </div>
    </>
  )
}

function Prazo({ projeto, resumo, ocupado, onProrrogar }) {
  const [ate, setAte] = useState(() => paraInputData(projeto.prorrogadoAte))

  return (
    <div className="bloco-prazo">
      <div className="linha">
        <div>
          <strong>Prazo de envio: </strong>
          {resumo.prazo.temPrazo
            ? (
              <>
                {new Date(resumo.prazo.prazo).toLocaleDateString('pt-BR')}
                {resumo.prazo.vencido
                  ? <span className="tag reprovado"> vencido</span>
                  : <span className="tag aprovado"> faltam {resumo.prazo.diasRestantes} dia(s)</span>}
              </>
            )
            : <em className="dica-campo">nenhum prazo cadastrado para esta feira</em>}
        </div>
      </div>

      <div className="linha">
        <label className="campo">
          <span>Liberar este stand até (prorrogação)</span>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <div className="acoes">
          <button className="btn btn-ghost" disabled={ocupado || !ate} onClick={() => onProrrogar(fimDoDia(ate))}>
            Prorrogar
          </button>
          {projeto.prorrogadoAte && (
            <button className="btn btn-ghost perigo" disabled={ocupado} onClick={() => { setAte(''); onProrrogar(null) }}>
              Remover prorrogação
            </button>
          )}
        </div>
      </div>
      {projeto.prorrogadoAte && (
        <p className="nota">
          Prorrogado até {fmtDataHora(projeto.prorrogadoAte)} por {projeto.prorrogadoPor || '—'}.
        </p>
      )}
    </div>
  )
}

function Pedido({ situacao, ocupado, onLiberar, onRecusar }) {
  const [modo, setModo] = useState(null) // null | 'liberar' | 'recusar'
  const [texto, setTexto] = useState('')
  const [exigeExtra, setExigeExtra] = useState(false)
  const { peca, pedido, proximaVersao, status } = situacao

  // Se a peça já está na impressora, a recusa quase sempre é a resposta certa e
  // o custo extra quase sempre se aplica. Preencher isso sozinho poupa o
  // analista de escrever a mesma frase toda semana — e ele pode trocar o texto.
  const jaEmProducao = status === 'em_impressao' || status === 'impressa'
  const abrirRecusa = () => {
    setModo('recusar')
    setExigeExtra(jaEmProducao)
    setTexto(jaEmProducao
      ? `Esta peça já entrou em produção${status === 'impressa' ? ' e foi impressa' : ''}, então trocar a arte significa refazer a peça.`
      : '')
  }

  return (
    <div className="pedido">
      <div className="pedido-topo">
        <strong>{peca.rotulo}</strong>
        <span className="tag ressalva">quer enviar a versão {proximaVersao}</span>
      </div>
      <p className="motivo-cliente">“{pedido.motivo}”</p>
      <p className="dica-campo">
        Pedido em {fmtDataHora(pedido.em)}
        {pedido.aceiteExtra && (
          <> · <strong>o cliente já aceitou o custo extra</strong> em {fmtDataHora(pedido.aceiteExtra.em)}</>
        )}
      </p>

      {modo && (
        <label className="campo">
          <span>{modo === 'liberar' ? 'Observação para o cliente (opcional)' : 'Motivo da recusa — o cliente vai ler isto'}</span>
          <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
      )}

      {modo === 'recusar' && (
        <label className="alternador">
          <input type="checkbox" checked={exigeExtra} onChange={(e) => setExigeExtra(e.target.checked)} />
          <span>
            Esta troca tem <strong>custo extra</strong> — mostrar ao cliente a opção de aceitar
            <em className="dica-campo"> (o aviso não cita valor; manda falar com o atendimento)</em>
          </span>
        </label>
      )}

      <div className="acoes compactas">
        {modo !== 'recusar' && (
          <button className="btn" disabled={ocupado} onClick={() => (modo === 'liberar' ? onLiberar(texto) : setModo('liberar'))}>
            {modo === 'liberar' ? 'Confirmar liberação' : 'Liberar nova versão'}
          </button>
        )}
        {modo !== 'liberar' && (
          <button
            className="btn btn-ghost perigo"
            disabled={ocupado || (modo === 'recusar' && texto.trim().length < 10)}
            onClick={() => (modo === 'recusar' ? onRecusar(texto.trim(), exigeExtra) : abrirRecusa())}
          >
            {modo === 'recusar' ? 'Confirmar recusa' : 'Recusar'}
          </button>
        )}
        {modo && <button className="btn btn-ghost" disabled={ocupado} onClick={() => setModo(null)}>Cancelar</button>}
      </div>
      {modo === 'recusar' && exigeExtra && (
        <p className="nota">O cliente verá: “{AVISO_EXTRA}”</p>
      )}
    </div>
  )
}

/**
 * Envio da prova de aprovação.
 *
 * Uma prova cobre VÁRIAS peças de propósito: na prática ela é o mockup do stand
 * inteiro, e é isso que dá sentido a "reprovar em partes" — o cliente aprova a
 * lona e reprova a testeira dentro da mesma imagem.
 */
function NovaProva({ sessao, projeto, resumo, ocupado, onEnviar }) {
  const [aberto, setAberto] = useState(false)
  const [selecionadas, setSelecionadas] = useState([])
  const [observacao, setObservacao] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [progresso, setProgresso] = useState(null)
  const [erro, setErro] = useState(null)
  const entrada = useRef(null)

  const candidatas = resumo.pecas.filter((s) => s.status !== 'aguardando')

  const enviar = async () => {
    setErro(null)
    setProgresso(0)
    try {
      const prova = await enviarProva(arquivo, { feiraId: projeto.feiraId, stand: projeto.stand }, setProgresso)
      const versoes = Object.fromEntries(
        resumo.pecas
          .filter((s) => selecionadas.includes(s.peca.id))
          .map((s) => [s.peca.id, s.versaoRecebida || 1]),
      )
      await onEnviar({ id: prova.id, arquivo: prova.arquivo, pecaIds: selecionadas, versoes, observacao })
      setAberto(false)
      setArquivo(null)
      setSelecionadas([])
      setObservacao('')
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar a prova.')
    } finally {
      setProgresso(null)
    }
  }

  if (!aberto) {
    return (
      <div className="cartao">
        <div className="admin-topo">
          <div>
            <h3>Prova de aprovação</h3>
            <p className="ajuda">
              Suba o print/mockup e escolha quais peças ele cobre. O cliente
              recebe na tela dele e responde aprovando, reprovando ou reprovando
              em partes.
            </p>
          </div>
          <button className="btn" disabled={!candidatas.length} onClick={() => setAberto(true)}>
            Enviar prova
          </button>
        </div>
        {!candidatas.length && (
          <p className="nota">Nenhuma arte recebida ainda — não há o que provar.</p>
        )}
        <HistoricoProvas projeto={projeto} />
      </div>
    )
  }

  return (
    <div className="cartao">
      <h3>Enviar prova de aprovação</h3>

      <p className="ajuda">Quais peças esta prova cobre?</p>
      {candidatas.map((s) => (
        <label className="alternador" key={s.peca.id}>
          <input
            type="checkbox"
            checked={selecionadas.includes(s.peca.id)}
            onChange={(e) => setSelecionadas((atual) => (
              e.target.checked ? [...atual, s.peca.id] : atual.filter((x) => x !== s.peca.id)
            ))}
          />
          <span>{s.peca.rotulo} <em className="dica-campo">— {s.rotulo}</em></span>
        </label>
      ))}

      <label className="campo">
        <span>Observação para o cliente <em className="opcional">(opcional)</em></span>
        <textarea rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </label>

      <input
        ref={entrada} type="file" hidden
        accept={EXTENSOES_PROVA.map((e) => `.${e}`).join(',')}
        onChange={(e) => setArquivo(e.target.files?.[0] || null)}
      />

      <div className="acoes">
        <button className="btn btn-ghost" onClick={() => entrada.current?.click()}>
          {arquivo ? `Arquivo: ${arquivo.name}` : 'Escolher o print da prova'}
        </button>
      </div>

      {progresso !== null && (
        <div className="barra"><div style={{ width: `${Math.max(2, progresso * 100)}%` }} /></div>
      )}
      {erro && <p className="erro-envio">{erro}</p>}

      <div className="acoes">
        <button
          className="btn"
          disabled={!arquivo || !selecionadas.length || ocupado || progresso !== null}
          onClick={enviar}
        >
          {progresso !== null ? `Enviando… ${Math.round(progresso * 100)}%` : 'Enviar prova ao cliente'}
        </button>
        <button className="btn btn-ghost" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
      <p className="nota">
        Aceita {EXTENSOES_PROVA.map((e) => `.${e}`).join(', ')}. Depois de enviar,
        avise o cliente — ele não recebe e-mail automático.
      </p>
    </div>
  )
}

function HistoricoProvas({ projeto }) {
  const provas = Object.entries((projeto.controle?.provas) || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => Date.parse(b.enviadaEm || 0) - Date.parse(a.enviadaEm || 0))
  if (!provas.length) return null

  const ROTULO = { aprovada: 'Aprovada', reprovada: 'Reprovada', parcial: 'Aprovada em partes' }
  const COR = { aprovada: 'aprovado', reprovada: 'reprovado', parcial: 'ressalva' }

  return (
    <ul className="pecas-lista">
      {provas.map((p) => {
        const r = projeto.respostasProva?.[p.id]
        return (
          <li key={p.id} className={r ? 'entregue' : 'pendente'}>
            <span className="marca" aria-hidden>{r ? '✓' : '·'}</span>
            <div>
              <strong>{(p.pecaIds || []).length} peça(s)</strong>
              <em className="dica-campo"> · enviada em {fmtDataHora(p.enviadaEm)} por {p.enviadaPor || '—'}</em>
              {p.arquivo?.link && <> · <a href={p.arquivo.link} target="_blank" rel="noreferrer">ver prova</a></>}
              <p className="dica-campo">
                {r
                  ? (
                    <>
                      <span className={`tag ${COR[r.decisao]}`}>{ROTULO[r.decisao] || r.decisao}</span>
                      {' '}em {fmtDataHora(r.em)}
                      {r.observacao && <> — “{r.observacao}”</>}
                    </>
                  )
                  : 'Aguardando a resposta do cliente'}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Logo, fontes, manual de marca.
 *
 * Estes arquivos ficavam invisíveis para o analista: não são peça, então não
 * apareciam na lista de peças; e como não têm veredicto, passavam despercebidos
 * no meio das artes. O cliente mandava o logo e o time nunca ficava sabendo —
 * exatamente o ruído de comunicação que a ferramenta existe para cortar.
 */
function ArquivosDeApoio({ apoio }) {
  if (!apoio.length) return null
  const fmtMb = (n) => (Number.isFinite(n) ? `${(n / 1048576).toFixed(1)} MB` : '—')

  return (
    <div className="cartao">
      <h3>Arquivos de apoio ({apoio.length})</h3>
      <p className="ajuda">
        Logo, fontes, manual de marca e referências enviados pelo cliente. Não
        passam pela análise — não são peça impressa.
      </p>
      <ul className="pecas-lista">
        {apoio.map((e) => (
          <li key={e.protocolo} className="entregue">
            <span className="marca" aria-hidden>↓</span>
            <div>
              <strong>{e.pecaRotulo || e.arquivo?.nome || 'Arquivo de apoio'}</strong>
              <p className="dica-campo">
                {e.arquivo?.nome} · {fmtMb(e.arquivo?.tamanho)} · {fmtDataHora(e.criadoEm)} · {e.protocolo}
                {e.link && <> · <a href={e.link} download={e.arquivo?.nome} target="_blank" rel="noreferrer">baixar</a></>}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PecaDoTime({ situacao, envios, ocupado, onStatus, onLiberar }) {
  const { peca, status, rotulo, cor, controle } = situacao
  const emProducao = status === 'em_impressao' || status === 'impressa'

  return (
    <div className="peca-time">
      <div className="pedido-topo">
        <strong>{peca.rotulo}</strong>
        <span className={`tag ${cor}`}>{rotulo}</span>
      </div>
      <p className="dica-campo">
        {peca.larguraCm} × {peca.alturaCm} cm
        {envios.length > 0 && ` · ${envios.length} versão(ões) recebida(s)`}
      </p>

      {envios.length > 0 && (
        <ul className="versoes">
          {envios.map((e) => (
            <li key={e.protocolo}>
              <strong>v{e.versao || 1}</strong> · {fmtDataHora(e.criadoEm)} ·{' '}
              <span className={`tag ${e.veredicto}`}>{e.veredicto}</span>
              {e.link && <> · <a href={e.link} download={e.arquivo?.nome} target="_blank" rel="noreferrer">baixar</a></>}
            </li>
          ))}
        </ul>
      )}

      {controle?.recusa && (
        <p className="nota">
          Recusado em {fmtDataHora(controle.recusa.em)}: “{controle.recusa.motivo}”
          {controle.recusa.exigeExtra && ' (com custo extra)'}
        </p>
      )}

      <div className="acoes compactas">
        {status !== 'aguardando' && status !== 'em_impressao' && status !== 'impressa' && (
          <button className="btn btn-ghost" disabled={ocupado} onClick={() => onStatus('em_impressao')}>
            Marcar “em impressão”
          </button>
        )}
        {status === 'em_impressao' && (
          <button className="btn btn-ghost" disabled={ocupado} onClick={() => onStatus('impressa')}>
            Marcar “impressa”
          </button>
        )}
        {(status === 'em_impressao' || status === 'impressa') && (
          <button className="btn btn-ghost perigo" disabled={ocupado} onClick={() => onStatus(null)}>
            Desfazer status
          </button>
        )}
        {/*
          Liberar vale em QUALQUER bloqueio, inclusive com a peça na impressora.
          Antes eu excluía a produção daqui, e o resultado era um beco sem
          saída: o acerto do custo extra acontece por telefone com o
          atendimento, e não havia como isso virar ação na ferramenta — o
          cliente não conseguia pedir e o analista não conseguia liberar.
        */}
        {!situacao.podeEnviar && (
          <button className="btn btn-ghost" disabled={ocupado} onClick={() => onLiberar(emProducao)}>
            {emProducao ? 'Liberar reimpressão (custo extra combinado)' : 'Liberar envio de nova versão'}
          </button>
        )}
      </div>
      {emProducao && (
        <p className="nota">
          Liberar aqui é para quando a reimpressão já foi acertada com o cliente
          pelo atendimento. A peça sai de “em impressão” e volta a aceitar arte
          nova — o combinado de valor segue fora do sistema.
        </p>
      )}
      {STATUS[status] && status !== 'aguardando' && controle?.statusEm && (
        <p className="dica-campo">Status alterado em {fmtDataHora(controle.statusEm)} por {controle.statusPor || '—'}.</p>
      )}
    </div>
  )
}
