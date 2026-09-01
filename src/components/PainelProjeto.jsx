import { useEffect, useRef, useState } from 'react'
import { STATUS, AVISO_EXTRA } from '../core/fluxo.js'
import {
  liberarNovaVersao, recusarNovaVersao, definirStatusDaPeca, registrarProva, prorrogarPrazo,
  ouvirReprovacoes, devolverArte, desfazerDevolucao, registrarContato, desfazerContato,
  marcarConferido,
} from '../services/projetos.js'
import { enviarProva, EXTENSOES_PROVA } from '../services/envio.js'
import { traduzirErroAuth } from '../services/sessao.js'
import Modal from './Modal.jsx'
import CaixaDeAlerta from './CaixaDeAlerta.jsx'
import { formatarDataHora as fmtDataHora, paraInputData, fimDoDia } from '../core/datas.js'
import { motivosMaisComuns, LIMITE_REPROVACOES } from '../core/reprovacoes.js'
import { INICIO_DO_REGISTRO, DIAS_DE_SILENCIO_APOS_CONTATO } from '../core/contato.js'
import { conferenciaPendente } from '../core/regras.js'
import { marcarVisto } from '../store/visto.js'

// O que o analista faz com um projeto: responder pedidos, mandar a prova de
// aprovação, marcar o que entrou em impressão e prorrogar prazo caso a caso.
//
// A tela é organizada pela pergunta "o que precisa de mim agora?" — pedidos em
// aberto no topo, o resto abaixo. Uma lista de peças em ordem alfabética seria
// mais simples de programar e inútil na operação: o analista abre isto entre
// duas ligações e precisa ver a pendência, não o inventário.


export default function PainelProjeto({ sessao, projeto, resumo, envios, podeAprovar = true, onFechar, onMudou }) {
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
      setErro(traduzirErroAuth(e, 'gravacao'))
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
      <div className="cartao ficha-topo">
        {/*
          O nome do stand em tamanho de título, como no desenho da designer.
          Numa tela em que se entra e se sai o dia inteiro, o primeiro segundo
          é gasto respondendo "de quem é esta ficha?" — e com o nome do mesmo
          tamanho do resto, essa resposta custava uma leitura.
        */}
        <button className="btn btn-ghost btn-voltar" onClick={onFechar}>← Todos os projetos</button>

        <div className="admin-topo">
          <div>
            <h2 className="ficha-nome">{projeto.stand}</h2>
            <p className="ajuda">
              {projeto.expositor} · <a href={`mailto:${projeto.email}`}>{projeto.email}</a>
              {projeto.localizacao && ` · ${projeto.localizacao}`}
            </p>
          </div>
          <div className="ficha-marcas">
            {resumo.recebidas > 0 && (
              <span className="tag aprovado">{resumo.recebidas} recebida(s)</span>
            )}
            {resumo.pendentes.length > 0 && (
              <span className="tag alerta">{resumo.pendentes.length} pendente(s)</span>
            )}
          </div>
        </div>

        {erro && <p className="erro-envio">{erro}</p>}

        <Contato
          sinal={resumo.sinal}
          correio={resumo.correio}
          contato={resumo.contato}
          dificuldade={resumo.dificuldade}
          ocupado={ocupado}
          podeAprovar={podeAprovar}
          onRegistrar={(observacao) => rodar(() => registrarContato(sessao.fb, projeto.token, {
            por: sessao.usuario?.email,
            reprovacoes: resumo.dificuldade?.total || 0,
            observacao,
          }))}
          onDesfazer={() => rodar(() => desfazerContato(sessao.fb, projeto.token))}
        />

        <Prazo projeto={projeto} resumo={resumo} ocupado={ocupado} podeAprovar={podeAprovar} onProrrogar={(ate) => rodar(
          () => prorrogarPrazo(sessao.fb, projeto.token, ate, sessao.usuario?.email),
        )} />
      </div>

      {podeAprovar && resumo.pedidosEmAberto.length > 0 && (
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

      {podeAprovar && <NovaProva
        sessao={sessao}
        projeto={projeto}
        resumo={resumo}
        ocupado={ocupado}
        onEnviar={(dados) => rodar(() => registrarProva(sessao.fb, projeto.token, { ...dados, por: sessao.usuario?.email }))}
      />}

      {/*
        As peças vêm ANTES do apoio e do log, e não depois.

        A ordem anterior punha duas referências — os arquivos que o cliente
        mandou por fora e o histórico de tentativas reprovadas — entre a prova
        e a lista de peças. As duas são material de consulta: úteis quando se
        procura algo, ruído quando se está trabalhando. E o trabalho é a lista
        de peças: é ali que se devolve arte, se marca "em impressão" e agora se
        confere o arquivo que a ferramenta não abriu.

        Um analista abre esta ficha entre duas ligações. O que ele faz fica no
        alto; o que ele consulta fica embaixo.
      */}
      <div className="cartao">
        <h3>Peças</h3>
        {resumo.pecas.map((s) => (
          <PecaDoTime
            key={s.peca.id}
            situacao={s}
            envios={enviosPorPeca.get(s.peca.id) || []}
            ocupado={ocupado}
            podeAprovar={podeAprovar}
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
            onDevolver={(motivo) => rodar(() => devolverArte(sessao.fb, projeto.token, s.peca.id, {
              motivo,
              paraVersao: s.versaoRecebida,
              por: sessao.usuario?.email,
            }))}
            onDesfazerDevolucao={() => rodar(
              () => desfazerDevolucao(sessao.fb, projeto.token, s.peca.id),
            )}
            onConferir={(protocolo) => rodar(
              () => marcarConferido(sessao.fb, protocolo, sessao.usuario?.email),
            )}
          />
        ))}
      </div>

      <ArquivosDeApoio apoio={resumo.apoio} />

      <LogDeReprovacoes sessao={sessao} projeto={projeto} />

      {/*
        A bolha de conversa saiu daqui: ela agora acompanha TODAS as telas do
        time (ver `ConversaDoTime`, montada em `App.jsx`), com a lista de quem
        falou. Duas bolhas na mesma tela seriam dois caminhos para a mesma
        conversa, e a de baixo esconderia a de cima.
      */}
    </>
  )
}

/**
 * Em que pé está o contato com este cliente.
 *
 * Fica no alto da ficha, ao lado do prazo, porque é a primeira pergunta antes
 * de qualquer cobrança: cobrar quem nunca soube do link é ruído, e cobrar quem
 * já está com o designer trabalhando é gastar o telefonema que faria falta em
 * outro stand.
 */
function Contato({ sinal, correio, contato, dificuldade, ocupado, podeAprovar, onRegistrar, onDesfazer }) {
  const [aberto, setAberto] = useState(false)
  const [observacao, setObservacao] = useState('')
  if (!sinal) return null

  const visitas = sinal.visitas > 1 ? ` · ${sinal.visitas} visitas` : ''
  const quando = sinal.desde ? ` · desde ${fmtDataHora(sinal.desde)}` : ''

  return (
    <div className="bloco-contato">
      <p>
        <span className={`sinal ${sinal.cor}`}>{sinal.rotulo}</span>
        {sinal.id !== 'nunca_abriu' && <span className="dica-campo">{quando}{visitas}</span>}
        {sinal.gabaritoEm && <span className="dica-campo"> · gabarito baixado em {fmtDataHora(sinal.gabaritoEm)}</span>}
      </p>

      {/*
        A honestidade que evita o telefonema errado: num stand cadastrado antes
        de o registro existir, "nunca abriu" pode ser só a nossa cegueira.
        Dizer isso na tela custa uma linha; não dizer custa a confiança da
        equipe no sinal inteiro, logo na primeira semana.
      */}
      {sinal.semHistorico && (
        <p className="dica-campo">
          Nenhum acesso registrado — mas o registro começou em{' '}
          {new Date(INICIO_DO_REGISTRO).toLocaleDateString('pt-BR')}. Num stand
          mais antigo, isso pode significar que ele abriu antes disso.
        </p>
      )}

      {correio?.estado !== 'desconhecido' && (
        <p className="dica-campo">
          <span className={`sinal ${correio.cor}`}>{correio.rotulo}</span>
          {correio.para && ` · ${correio.para}`}
          {correio.em && ` · ${fmtDataHora(correio.em)}`}
          {correio.motivo && <> · {correio.motivo}</>}
          {correio.estado === 'voltou' && (
            <> — corrigir o e-mail no cadastro tira este aviso sozinho.</>
          )}
        </p>
      )}

      {/*
        A saída do alerta. Sem ela, o stand que o analista já resolveu por
        telefone fica marcado para sempre — e alerta que não se apaga vira
        paisagem, até o próximo caso de verdade passar batido junto.

        É registro, não apagamento: guarda quem falou, quando e o que combinou.
        A próxima pessoa que abrir esta ficha precisa saber o que já foi
        tentado antes de ligar de novo.
      */}
      {contato?.houve ? (
        <p className="dica-campo">
          <strong>Time já falou com o cliente</strong> em {fmtDataHora(contato.em)}
          {contato.por && ` · ${contato.por}`}
          {contato.observacao && <> · “{contato.observacao}”</>}
          {podeAprovar && (
            <>
              {' '}
              <button className="link" disabled={ocupado} onClick={onDesfazer}>desfazer</button>
            </>
          )}
        </p>
      ) : podeAprovar && (aberto ? (
        <div className="contato-registro">
          <label className="campo">
            <span>O que ficou combinado <em className="opcional">(opcional)</em></span>
            <input
              type="text"
              value={observacao}
              placeholder="Ex.: agência vai mandar até sexta; e-mail novo é compras@…"
              onChange={(e) => setObservacao(e.target.value)}
            />
          </label>
          <div className="acoes compactas">
            <button
              className="btn"
              disabled={ocupado}
              onClick={() => { onRegistrar(observacao); setAberto(false); setObservacao('') }}
            >
              Registrar a conversa
            </button>
            <button className="btn btn-ghost" disabled={ocupado} onClick={() => setAberto(false)}>Cancelar</button>
          </div>
          <p className="dica-campo">
            Isto silencia o aviso deste stand para o time inteiro.{' '}
            {dificuldade?.total > 0
              ? 'Ele volta se o cliente tentar enviar e for reprovado de novo.'
              : `Ele volta depois de ${DIAS_DE_SILENCIO_APOS_CONTATO} dias, se nada mudar.`}
          </p>
        </div>
      ) : (
        <button className="link" disabled={ocupado} onClick={() => setAberto(true)}>
          Já falei com o cliente
        </button>
      ))}
    </div>
  )
}

function Prazo({ projeto, resumo, ocupado, podeAprovar, onProrrogar }) {
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

      {podeAprovar && <div className="linha">
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
      </div>}
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
    <Modal
      aberto
      titulo="Enviar prova para aprovação"
      ajuda="Quais peças esta prova cobre?"
      onFechar={() => setAberto(false)}
    >
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
        Aceita {EXTENSOES_PROVA.map((e) => `.${e}`).join(', ')}. O cliente recebe
        um e-mail avisando que a prova está pronta.
      </p>
    </Modal>
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

/**
 * O log de tentativas reprovadas — a ficha de dificuldade do cliente.
 *
 * O que ele responde, e nenhuma outra tela respondia: por que este stand está
 * há dez dias com zero artes. Sem isto, o cliente que tentou oito vezes e
 * desistiu era indistinguível do que nem abriu o link — os dois apareciam como
 * "0 de 5", e o time mandava para ambos o mesmo e-mail de cobrança, que é
 * exatamente o que não ajuda o primeiro.
 *
 * A lista vem da subcoleção, que ninguém altera. O contador do documento serve
 * para a lista de projetos e para o painel; aqui, com o stand já aberto, dá
 * para ler os fatos.
 */
function LogDeReprovacoes({ sessao, projeto }) {
  const [lista, setLista] = useState([])
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    if (!sessao?.fb || !projeto.token) return undefined
    return ouvirReprovacoes(sessao.fb, projeto.token, setLista, (e) => {
      console.warn('não foi possível ler o log de reprovações', e)
    })
  }, [sessao?.fb, projeto.token])

  // Marca como visto assim que o analista abre a ficha: o alerta é uma
  // chamada para agir, e quem já veio ver o caso não precisa continuar sendo
  // chamado. Uma tentativa nova depois disso acende de novo.
  useEffect(() => {
    if (lista.length) marcarVisto(sessao?.usuario?.email, `dificuldade:${projeto.token}`, lista[0].em)
  }, [lista, projeto.token, sessao?.usuario?.email])

  if (!lista.length) return null

  const comuns = motivosMaisComuns(lista)
  const alerta = lista.length > LIMITE_REPROVACOES
  const mostrar = aberto ? lista : lista.slice(0, 3)

  return (
    <CaixaDeAlerta
      titulo="Tentativas reprovadas"
      quantos={lista.length}
      cor={alerta ? 'alerta' : 'neutra'}
      etiqueta={alerta ? 'precisa de ajuda' : null}
      // Só abre sozinha quando o cliente está de fato travado. Fora disso é
      // histórico: útil quando se procura, ruído quando se está trabalhando —
      // e eram dezoito linhas ocupando a ficha inteira.
      abertaPorPadrao={alerta}
      ajuda={alerta
        ? (
          <>
            Este cliente já teve <strong>{lista.length} arquivos reprovados</strong> pela
            análise — e arte reprovada não chega até nós. Do lado dele, a tela
            só diz o que está errado; se ele não souber resolver, o stand fica
            em zero sem que ninguém perceba. Vale uma ligação antes de mandar
            outra cobrança.
          </>
        )
        : 'Arquivos que a análise recusou no navegador do cliente e que, por isso, nunca chegaram. Servem para entender onde ele está travando.'}
    >

      {comuns.length > 0 && (
        <div className="motivo-cliente">
          <strong>Mais frequente:</strong> {comuns[0].titulo} ({comuns[0].vezes}×)
          {comuns[0].acao && <> — {comuns[0].acao}</>}
        </div>
      )}

      <ul className="pecas-lista">
        {mostrar.map((r) => (
          <li key={r.id} className="pendente">
            <span className="marca" aria-hidden>×</span>
            <div>
              <strong>{r.pecaRotulo}</strong>
              <em className="dica-campo"> · {fmtDataHora(r.em)}</em>
              <p className="dica-campo">
                {r.arquivo?.nome || 'arquivo sem nome'}
                {r.dpi != null && <> · {r.dpi} dpi{r.dpiExigido ? ` (mínimo ${r.dpiExigido})` : ''}</>}
                {r.versao > 1 && ` · tentando a versão ${r.versao}`}
              </p>
              {(r.motivos || []).map((m, i) => (
                <p className="dica-campo" key={`${r.id}-${i}`}>→ {m.titulo}</p>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {lista.length > 3 && (
        <button className="link" onClick={() => setAberto((v) => !v)}>
          {aberto ? 'Mostrar só as três últimas' : `Ver todas as ${lista.length} tentativas`}
        </button>
      )}
    </CaixaDeAlerta>
  )
}

/**
 * A arte que a ferramenta não conseguiu abrir.
 *
 * O laudo dessas artes promete, com todas as letras, que a equipe vai olhar o
 * arquivo manualmente antes de imprimir. Até agora a promessa dependia de
 * alguém reparar numa ressalva no meio da aba de envios — e a peça segue para
 * produção do mesmo jeito, porque a ferramenta não desaprovou nada: ela só não
 * enxergou.
 *
 * E não é caso raro. Uma parede de 120 × 320 cm a 300 dpi tem 562 megapixels e
 * ~2,25 GB descomprimidos; nenhum navegador abre. Quem cai aqui é a arte BEM
 * feita, na peça que mais custa reimprimir.
 *
 * Fica na versão, e não no topo da peça, porque é de UM arquivo que se trata:
 * a v2 pode abrir normalmente e a v1 não.
 */
function ConferirAMao({ envio, ocupado, podeAprovar, onConferir }) {
  return (
    <div className="conferir-a-mao">
      <strong>Ninguém viu esta arte ainda</strong>
      <p>
        A imagem embutida é grande demais para o navegador abrir, então a
        pré-visualização e a medição de nitidez não puderam ser feitas — a
        conferência de medida, sangria e resolução declarada aconteceu normal.
        Baixe o arquivo, abra e confira se a arte se sustenta no tamanho da
        peça.
      </p>
      {podeAprovar && (
        <button
          className="btn btn-ghost"
          disabled={ocupado}
          onClick={() => onConferir?.(envio.protocolo)}
        >
          Conferi este arquivo
        </button>
      )}
    </div>
  )
}

function PecaDoTime({
  situacao, envios, ocupado, podeAprovar, onStatus, onLiberar, onDevolver, onDesfazerDevolucao,
  onConferir,
}) {
  const { peca, status, rotulo, cor, controle, devolucao } = situacao
  const emProducao = status === 'em_impressao' || status === 'impressa'
  const [devolvendo, setDevolvendo] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Só faz sentido devolver o que já chegou. Sem arte não há o que recusar.
  const podeDevolver = podeAprovar && situacao.versaoRecebida >= 1 && !devolucao

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
              {conferenciaPendente(e) && (
                <ConferirAMao envio={e} ocupado={ocupado} podeAprovar={podeAprovar} onConferir={onConferir} />
              )}
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

      {devolucao && (
        <div className="bloqueio devolvida">
          <strong>Arte devolvida ao cliente (v{devolucao.paraVersao})</strong>
          <p>“{devolucao.motivo}”</p>
          <p className="dica-campo">
            Em {fmtDataHora(devolucao.em)} por {devolucao.por || '—'}. O cliente está vendo
            este motivo e pode enviar a v{situacao.proximaVersao} sem pedir liberação.
          </p>
          {podeAprovar && (
            <button className="btn btn-ghost" disabled={ocupado} onClick={onDesfazerDevolucao}>
              Desfazer devolução
            </button>
          )}
        </div>
      )}

      {devolvendo && (
        <>
          <label className="campo">
            <span>Motivo da recusa — o cliente vai ler isto</span>
            <textarea
              rows={3}
              maxLength={800}
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: o texto do rodapé está a 3 cm da borda e some atrás do perfil de alumínio. Suba pelo menos 8 cm."
            />
          </label>
          <p className="dica-campo">
            Escreva o que ele precisa corrigir, não o nome técnico do problema — é este
            texto, exatamente, que aparece na tela dele. A devolução aqui é por{' '}
            <strong>motivo técnico</strong> da peça; conteúdo (texto, telefone, preço) é
            responsabilidade do cliente e o tutorial diz isso a ele.
          </p>
          <div className="acoes compactas">
            <button
              className="btn btn-primario"
              disabled={ocupado || !motivo.trim()}
              onClick={() => {
                onDevolver(motivo.trim())
                setMotivo('')
                setDevolvendo(false)
              }}
            >
              Devolver a arte ao cliente
            </button>
            <button
              className="btn btn-ghost"
              disabled={ocupado}
              onClick={() => { setDevolvendo(false); setMotivo('') }}
            >
              Cancelar
            </button>
          </div>
        </>
      )}

      <div className="acoes compactas">
        {podeDevolver && !devolvendo && (
          <button className="btn btn-ghost perigo" disabled={ocupado} onClick={() => setDevolvendo(true)}>
            Recusar arte (devolver ao cliente)
          </button>
        )}
        {podeAprovar && status !== 'aguardando' && status !== 'em_impressao' && status !== 'impressa' && (
          <button className="btn btn-ghost" disabled={ocupado} onClick={() => onStatus('em_impressao')}>
            Marcar “em impressão”
          </button>
        )}
        {podeAprovar && status === 'em_impressao' && (
          <button className="btn btn-ghost" disabled={ocupado} onClick={() => onStatus('impressa')}>
            Marcar “impressa”
          </button>
        )}
        {podeAprovar && (status === 'em_impressao' || status === 'impressa') && (
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
        {podeAprovar && !situacao.podeEnviar && (
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
