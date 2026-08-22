import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { carregarPerfis, carregarPolitica, carregarDetectorNitidez } from '../data/perfis.js'
import { POLITICA_PADRAO, especificacao } from '../core/regras.js'
import { cadastroDoProjeto, pecaNova, perfilPorTexto } from '../data/projeto.js'
import { resumoDoProjeto, situacaoDaPeca, AVISO_PRAZO, AVISO_EXTRA } from '../core/fluxo.js'
import { formatarData as fmtData, formatarDataHora as fmtDataHora } from '../core/datas.js'
import {
  carregarProjetoPublico, ouvirProjetoPublico, marcarEntrega, pedirNovaVersao,
  aceitarCustoExtra, responderProva, registrarReprovacao, registrarVisita,
} from '../services/projetos.js'
import { eventoDeReprovacao, chaveDaTentativa } from '../core/reprovacoes.js'
import { usarAnalise } from '../store/usarAnalise.js'
import Upload from './Upload.jsx'
import Resultado from './Resultado.jsx'
import Gabarito, { BotaoGabarito } from './Gabarito.jsx'
import Avulsos from './Avulsos.jsx'
import Conversa from './Conversa.jsx'
import Tutorial from './Tutorial.jsx'
import { jaViuTutorial, marcarTutorialVisto } from '../store/tutorial.js'

// A tela do cliente quando o projeto está cadastrado.
//
// Aqui está o ganho principal da inversão: o cliente NÃO digita medida. Ela
// vem do projeto do stand, feita por quem a conhece. Antes, uma medida errada
// digitada por ele fazia a ferramenta aprovar com confiança uma arte errada —
// o único jeito de ela ser pior do que não existir.
//
// Continua sem login, de propósito: o token do endereço é a credencial. Quem
// monta a arte quase nunca é o e-mail cadastrado, é a agência do cliente, e
// uma senha por pessoa deixaria justamente ela de fora.

const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))

export default function Projeto({ token }) {
  // Lidos uma vez: são leituras de localStorage e não mudam nesta tela — o
  // painel técnico que os edita só existe na ferramenta aberta.
  const perfis = useMemo(carregarPerfis, [])
  const politica = useMemo(() => carregarPolitica(POLITICA_PADRAO), [])
  const detectorNitidez = useMemo(carregarDetectorNitidez, [])

  const [projeto, setProjeto] = useState(null)
  const [estado, setEstado] = useState('carregando') // carregando | pronto | ausente | erro
  const [erro, setErro] = useState(null)
  const [pecaAtivaId, setPecaAtivaId] = useState(null)
  const [extra, setExtra] = useState(null)
  // Abre sozinho só na primeira visita a ESTE stand, e num navegador que
  // nunca viu. Ver `store/tutorial.js` para o porquê de ser por stand.
  const [tutorial, setTutorial] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const p = await carregarProjetoPublico(token)
      if (!p) { setEstado('ausente'); return }
      setProjeto(p)
      setEstado('pronto')
    } catch (e) {
      console.error(e)
      setErro(e?.message || 'Não foi possível abrir este projeto.')
      setEstado('erro')
    }
  }, [token])

  useEffect(() => { setEstado('carregando'); carregar() }, [carregar])

  // Depois de o projeto abrir, não antes: um tutorial sobre uma tela que ainda
  // não carregou (ou cujo link está errado) só atrapalha quem já tem problema.
  useEffect(() => {
    if (estado === 'pronto' && !jaViuTutorial(token)) setTutorial(true)
  }, [estado, token])

  // Carimba que este stand foi aberto.
  //
  // O que o time ganha: hoje "0 de 5 artes" é o mesmo número para quem nunca
  // viu o link e para quem está com o designer trabalhando há uma semana — duas
  // situações que pedem ações opostas. A quatro dias do prazo, essa diferença
  // decide se alguém liga hoje ou não.
  //
  // A referência guarda o `acesso` que veio na primeira carga, e não o do
  // estado: a escuta em tempo real reescreve `projeto` a cada mudança, e ler
  // dali faria o efeito rodar de novo a cada gravação — inclusive a que ele
  // mesmo acabou de fazer.
  const acessoInicial = useRef(null)
  useEffect(() => {
    if (estado !== 'pronto') return
    if (acessoInicial.current === token) return
    acessoInicial.current = token
    registrarVisita(token, projeto?.acesso)
  }, [estado, token, projeto])

  // Baixar o gabarito é o sinal mais forte que a página produz: para desenhar a
  // arte o designer PRECISA dele, então quem não baixou não começou. Não é
  // palpite sobre intenção, é uma dependência do processo.
  const anotarGabarito = useCallback(() => {
    registrarVisita(token, projeto?.acesso, { gabarito: true })
  }, [token, projeto])

  const fecharTutorial = useCallback(() => {
    setTutorial(false)
    marcarTutorialVisto(token)
  }, [token])

  // "Me mostre onde fica": fechar e rolar até a caixa de apoio. Descrever a
  // localização em palavras funciona mal numa página que rola — e é o tipo de
  // instrução que a pessoa não segue, ela só fecha e desiste.
  const irParaApoio = useCallback(() => {
    fecharTutorial()
    setPecaAtivaId(null)
    setExtra(null)
    // Depois do fechamento, para o elemento existir e a rolagem do corpo já
    // estar destravada.
    setTimeout(() => {
      const alvo = document.getElementById('arquivos-de-apoio')
      if (!alvo) return
      alvo.scrollIntoView({ behavior: 'smooth', block: 'center' })
      alvo.classList.add('piscando')
      setTimeout(() => alvo.classList.remove('piscando'), 2400)
    }, 60)
  }, [fecharTutorial])

  // Depois da primeira carga, a tela passa a escutar: a prova de aprovação e o
  // status de impressão aparecem sem o cliente recarregar nada. É o mesmo
  // motivo do painel do analista — só que aqui o ganho é ele não desistir e
  // ligar para o atendimento perguntando "e aí?".
  useEffect(() => {
    if (estado !== 'pronto') return undefined
    let vivo = true
    let cancelar = null
    ouvirProjetoPublico(
      token,
      (p) => { if (vivo) setProjeto((atual) => ({ ...p, feira: atual?.feira || p.feira, prazoEnvio: atual?.prazoEnvio ?? p.prazoEnvio })) },
      (e) => console.warn('escuta do projeto interrompida', e),
    ).then((c) => { cancelar = c; if (!vivo) c?.() })
    return () => { vivo = false; cancelar?.() }
  }, [estado, token])

  const cadastro = useMemo(() => (projeto ? cadastroDoProjeto(projeto) : null), [projeto])
  const resumo = useMemo(() => (projeto ? resumoDoProjeto(projeto) : null), [projeto])

  const ativa = useMemo(() => {
    if (extra) return situacaoDaPeca(projeto, extra)
    if (!pecaAtivaId || !resumo) return null
    return resumo.pecas.find((s) => s.peca.id === pecaAtivaId) || null
  }, [extra, pecaAtivaId, resumo, projeto])

  if (estado === 'carregando') {
    return <div className="cartao"><p className="ajuda">Abrindo o projeto do seu stand…</p></div>
  }

  if (estado === 'ausente') {
    return (
      <div className="cartao">
        <h2>Link não encontrado</h2>
        <p className="ajuda">
          Este link não corresponde a nenhum projeto. Ele pode ter sido copiado
          pela metade, ou o projeto pode ter sido removido. Confira o endereço
          com quem enviou.
        </p>
        <p className="nota">
          Se precisa mandar uma arte agora e não tem o link certo, use a{' '}
          <a href="#/">ferramenta aberta</a> — nela você informa as medidas
          manualmente.
        </p>
      </div>
    )
  }

  if (estado === 'erro') {
    return (
      <div className="cartao erro">
        <strong>Não foi possível abrir este projeto</strong>
        <p>{erro}</p>
      </div>
    )
  }

  if (ativa) {
    return (
      <PainelDaPeca
        situacao={ativa}
        projeto={projeto}
        resumo={resumo}
        cadastro={cadastro}
        perfis={perfis}
        politica={politica}
        detectorNitidez={detectorNitidez}
        onVoltar={() => { setPecaAtivaId(null); setExtra(null); carregar() }}
        onEnviado={async (recibo) => {
          const peca = ativa.peca
          if (!String(peca.id).startsWith('extra_')) {
            await marcarEntrega(projeto.token, peca.id, {
              protocolo: recibo.protocolo,
              veredicto: recibo.veredicto,
              riscoAceito: recibo.riscoAceito,
              arquivo: recibo.nomeNoStorage,
              versao: ativa.proximaVersao,
            })
          }
          await carregar()
        }}
      />
    )
  }

  const provasAbertas = resumo.pecas
    .filter((s) => s.status === 'em_prova' && s.provaAtual)
    .reduce((mapa, s) => mapa.set(s.provaAtual.id, s.provaAtual), new Map())

  return (
    <>
      <Tutorial aberto={tutorial} onFechar={fecharTutorial} onVerApoio={irParaApoio} />

      <Capa projeto={projeto} resumo={resumo} onTutorial={() => setTutorial(true)} />

      <AvisoPrazo prazo={resumo.prazo} />

      {[...provasAbertas.values()].map((prova) => (
        <CartaoProva
          key={prova.id}
          prova={prova}
          projeto={projeto}
          onResponder={async (resposta) => {
            await responderProva(projeto.token, prova.id, resposta)
            await carregar()
          }}
        />
      ))}

      <div className="cartao">
        <div className="titulo-secao">
          <h3>Peças deste stand</h3>
          <span className="dica-campo">{resumo.total} {resumo.total === 1 ? 'peça' : 'peças'}</span>
        </div>
        <ul className="pecas-cartoes">
          {resumo.pecas.map((s) => (
            <CartaoPeca
              key={s.peca.id}
              situacao={s}
              perfis={perfis}
              politica={politica}
              projeto={projeto}
              onEscolher={() => setPecaAtivaId(s.peca.id)}
              onAtualizar={carregar}
              aoBaixarGabarito={anotarGabarito}
            />
          ))}
        </ul>
        <PecaForaDaLista bloqueado={resumo.prazo.vencido} onCriar={setExtra} />
      </div>

      {projeto.aceitaAvulsos !== false && <Avulsos projeto={projeto} cadastro={cadastro} />}

      <Conversa token={projeto.token} identidade={{ nome: '', email: '' }} />
    </>
  )
}

/**
 * A capa da tela do cliente.
 *
 * Ela aparece na lista de peças E na tela de envio, e isso não é enfeite
 * repetido: a tela de envio é onde o cliente passa mais tempo, e era
 * justamente ali que ele perdia de vista em que stand estava mexendo e quanto
 * ainda faltava. Na versão compacta some a frase de boas-vindas — ele já leu —
 * e entra a peça que está sendo enviada, com a saída para a lista.
 */
function Capa({ projeto, resumo, compacta = false, legenda = null, onVoltar = null, onTutorial = null }) {
  return (
    <section className={`capa ${compacta ? 'compacta' : ''}`}>
      <div className="capa-texto">
        <span className="capa-etiqueta">{projeto.feira}</span>
        <h2>{projeto.stand}</h2>
        {compacta
          ? legenda && <p className="capa-local">{legenda}</p>
          : (
            <>
              {projeto.localizacao && <p className="capa-local">{projeto.localizacao}</p>}
              <p className="capa-frase">
                As medidas de cada peça já vêm do projeto do seu stand — você
                não precisa informar tamanho nenhum. A conferência acontece no
                seu próprio navegador, e o arquivo só sai do seu computador
                quando você clicar em enviar.
              </p>
            </>
          )}

        {(onVoltar || onTutorial || projeto.linkDrive) && (
          <div className="capa-acoes">
            {onVoltar && (
              <button className="btn btn-ghost" onClick={onVoltar}>← Todas as peças</button>
            )}
            {/*
              Depois da primeira visita o tutorial vira isto: um botão discreto
              e sempre no mesmo lugar. Quem já sabe passa reto; quem esqueceu
              como aceitar uma ressalva não precisa ligar para perguntar.
            */}
            {onTutorial && (
              <button className="btn btn-ghost" onClick={onTutorial}>Como funciona</button>
            )}
            {projeto.linkDrive && (
              <a className="btn btn-drive" href={projeto.linkDrive} target="_blank" rel="noreferrer">
                Ver o projeto do stand
              </a>
            )}
          </div>
        )}
      </div>

      <div className="capa-medidor">
        <Anel feito={resumo.recebidas} total={resumo.total} />
        <p className="capa-medidor-texto">
          {resumo.completo
            ? 'Todas as artes enviadas'
            : `${resumo.recebidas} de ${resumo.total} artes enviadas`}
        </p>
        {resumo.emProducao > 0 && (
          <p className="dica-campo">{resumo.emProducao} já em produção</p>
        )}
      </div>
    </section>
  )
}

/**
 * Anel de progresso.
 *
 * Substitui a barra reta por um motivo simples: o cliente abre esta tela para
 * saber "quanto falta", e o anel responde isso de relance, sem ler. A diretoria
 * achou a tela técnica demais — o número continua lá, mas agora vem embrulhado
 * em algo que se entende antes de ler.
 */
function Anel({ feito, total }) {
  const fracao = total ? feito / total : 0
  const raio = 42
  const volta = 2 * Math.PI * raio
  return (
    <svg className="anel" viewBox="0 0 100 100" role="img" aria-label={`${feito} de ${total} artes enviadas`}>
      <circle className="anel-trilho" cx="50" cy="50" r={raio} />
      <circle
        className={`anel-marca ${fracao >= 1 ? 'completo' : ''}`}
        cx="50" cy="50" r={raio}
        strokeDasharray={`${volta * fracao} ${volta}`}
      />
      <text className="anel-numero" x="50" y="50" dominantBaseline="central" textAnchor="middle">
        {total ? Math.round(fracao * 100) : 0}%
      </text>
    </svg>
  )
}

/**
 * Aviso de prazo.
 *
 * O texto sobre taxa de urgência aparece ANTES do prazo vencer, não depois:
 * depois já não é aviso, é notificação de multa. É a diferença entre a
 * ferramenta ajudar o cliente a chegar no prazo e apenas registrar que ele não
 * chegou.
 */
function AvisoPrazo({ prazo }) {
  if (!prazo.temPrazo) return null

  if (prazo.vencido) {
    return (
      <div className="cartao aviso-prazo vencido">
        <strong>Prazo de envio encerrado em {fmtData(prazo.limite)}</strong>
        <p>{AVISO_PRAZO}</p>
        <p className="nota">
          Peças que o time pediu para corrigir continuam liberadas. Para as
          demais, é preciso uma liberação — fale com o atendimento.
        </p>
      </div>
    )
  }

  const apertado = prazo.diasRestantes <= 7
  return (
    <div className={`cartao aviso-prazo ${apertado ? 'perto' : ''}`}>
      <strong>
        Prazo para envio das artes: {fmtData(prazo.limite)}
        {prazo.diasRestantes >= 0 && ` — ${prazo.diasRestantes === 0 ? 'é hoje' : `faltam ${prazo.diasRestantes} dia(s)`}`}
        {prazo.prorrogado && ' (prazo prorrogado para o seu stand)'}
      </strong>
      <p>{AVISO_PRAZO}</p>
    </div>
  )
}

function CartaoProva({ prova, projeto, onResponder }) {
  const [decisao, setDecisao] = useState(null)
  const [reprovadas, setReprovadas] = useState([])
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)

  const pecas = (projeto.pecas || []).filter((p) => (prova.pecaIds || []).includes(p.id))
  const ehImagem = !String(prova.arquivo?.tipo || '').includes('pdf')
  const valido = decisao === 'aprovada' || decisao === 'reprovada'
    || (decisao === 'parcial' && reprovadas.length > 0)

  const enviar = async () => {
    setEnviando(true)
    setErro(null)
    try {
      await onResponder({ decisao, pecasReprovadas: reprovadas, observacao })
    } catch (e) {
      setErro(e?.message || 'Não foi possível registrar sua resposta.')
      setEnviando(false)
    }
  }

  return (
    <div className="cartao prova">
      <h3>Prova de aprovação</h3>
      <p className="ajuda">
        O time preparou a prova abaixo com {pecas.length === 1 ? 'a sua peça' : `${pecas.length} peças do seu stand`}.
        Confira e diga se pode seguir para impressão. Enviada em {fmtDataHora(prova.enviadaEm)}.
      </p>
      {prova.observacao && <p className="nota">{prova.observacao}</p>}

      {prova.arquivo?.link && (
        ehImagem
          ? (
            <a href={prova.arquivo.link} target="_blank" rel="noreferrer" className="prova-imagem">
              <img src={prova.arquivo.link} alt="Prova de aprovação" />
              <span className="dica-campo">Clique para abrir em tamanho real</span>
            </a>
          )
          : (
            <p>
              <a className="btn btn-ghost" href={prova.arquivo.link} target="_blank" rel="noreferrer">
                Abrir a prova (PDF)
              </a>
            </p>
          )
      )}

      <div className="escolha-modo">
        <label className={decisao === 'aprovada' ? 'ativo' : ''}>
          <input type="radio" checked={decisao === 'aprovada'} onChange={() => setDecisao('aprovada')} />
          <span>
            <strong>Aprovo tudo</strong>
            <em>As peças desta prova podem ser impressas como estão.</em>
          </span>
        </label>
        <label className={decisao === 'parcial' ? 'ativo' : ''}>
          <input type="radio" checked={decisao === 'parcial'} onChange={() => setDecisao('parcial')} />
          <span>
            <strong>Aprovo em partes</strong>
            <em>Algumas peças estão certas; outras precisam de arte nova.</em>
          </span>
        </label>
        <label className={decisao === 'reprovada' ? 'ativo' : ''}>
          <input type="radio" checked={decisao === 'reprovada'} onChange={() => { setDecisao('reprovada'); setReprovadas(pecas.map((p) => p.id)) }} />
          <span>
            <strong>Reprovo tudo</strong>
            <em>Vou enviar arte nova para todas as peças desta prova.</em>
          </span>
        </label>
      </div>

      {decisao === 'parcial' && (
        <div className="peca-editor">
          <p className="ajuda">Marque as peças que precisam de arte nova:</p>
          {pecas.map((p) => (
            <label className="alternador" key={p.id}>
              <input
                type="checkbox"
                checked={reprovadas.includes(p.id)}
                onChange={(e) => setReprovadas((atual) => (
                  e.target.checked ? [...atual, p.id] : atual.filter((x) => x !== p.id)
                ))}
              />
              <span>{p.rotulo} <em className="dica-campo">{fmt(p.larguraCm)} × {fmt(p.alturaCm)} cm</em></span>
            </label>
          ))}
        </div>
      )}

      {decisao && decisao !== 'aprovada' && (
        <label className="campo">
          <span>O que precisa mudar</span>
          <textarea
            rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: o telefone está errado; a cor do fundo ficou mais clara que a da marca."
          />
        </label>
      )}

      {erro && <p className="erro-envio">{erro}</p>}

      <div className="acoes">
        <button className="btn" disabled={!valido || enviando} onClick={enviar}>
          {enviando ? 'Registrando…' : 'Registrar minha resposta'}
        </button>
      </div>
      <p className="nota">
        Sua resposta fica registrada com data e hora. Depois de aprovada, a peça
        entra na fila de produção — trocar a arte a partir daí tem custo extra.
      </p>
    </div>
  )
}

function CartaoPeca({ situacao, perfis, politica, projeto, onEscolher, onAtualizar, aoBaixarGabarito }) {
  const { peca, status, rotulo, cor, entrega, bloqueio } = situacao
  const perfil = perfis.find((p) => p.id === peca.perfilId) || perfis[0]
  const spec = especificacao(peca, perfil, politica)
  const [painel, setPainel] = useState(null) // null | 'pedido' | 'extra'

  return (
    <li className={`peca-cartao estado-${cor}`}>
      <div className="peca-cartao-info">
        <div className="peca-cartao-topo">
          <strong>{peca.rotulo}</strong>
          <span className={`tag ${cor}`}>{rotulo}</span>
        </div>
        <p className="dica-campo">
          {fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm · com sangria{' '}
          {fmt(spec.comSangria.larguraCm)} × {fmt(spec.comSangria.alturaCm)} cm
          {peca.escalaFator > 1 && ` · pode vir em escala 1:${peca.escalaFator}`}
        </p>

        {entrega
          ? (
            <p className="dica-campo">
              Versão {situacao.versaoRecebida} enviada em {fmtDataHora(entrega.em)} · protocolo {entrega.protocolo}
              {entrega.veredicto === 'ressalva' && ' · com ressalva'}
            </p>
          )
          : <p className="dica-campo">Mínimo {fmt(spec.minimo.largura)} × {fmt(spec.minimo.altura)} px ({spec.minimo.dpi} dpi)</p>}

        {/* A devolução não é bloqueio — é o contrário, ela destrava o envio.
            Por isso tem bloco próprio: o cliente precisa ler o motivo e ver o
            botão de enviar logo abaixo, não um aviso que parece uma parede. */}
        {situacao.devolucao && (
          <div className="bloqueio devolvida">
            <strong>O time recusou esta arte</strong>
            <p>“{situacao.devolucao.motivo}”</p>
            <p className="dica-campo">
              Recusada em {fmtDataHora(situacao.devolucao.em)}. Envie a versão{' '}
              {situacao.proximaVersao} corrigida — não precisa pedir liberação, e o prazo
              não conta contra você nesta correção.
            </p>
          </div>
        )}

        {bloqueio && (
          <div className={`bloqueio ${bloqueio.tipo}`}>
            <strong>{bloqueio.titulo}</strong>
            <p>{bloqueio.texto}</p>
          </div>
        )}

        {painel === 'pedido' && (
          <FormularioPedido
            peca={peca}
            proximaVersao={situacao.proximaVersao}
            onCancelar={() => setPainel(null)}
            onEnviar={async (motivo) => {
              await pedirNovaVersao(projeto.token, peca.id, { motivo, paraVersao: situacao.proximaVersao })
              setPainel(null)
              await onAtualizar()
            }}
          />
        )}

        {painel === 'extra' && (
          <FormularioExtra
            motivoDaRecusa={bloqueio?.texto}
            onCancelar={() => setPainel(null)}
            onAceitar={async () => {
              await aceitarCustoExtra(projeto.token, peca.id, {
                texto: AVISO_EXTRA,
                motivoDaRecusa: bloqueio?.texto,
              })
              setPainel(null)
              await onAtualizar()
            }}
          />
        )}
      </div>

      <div className="peca-cartao-acao">
        {/*
          O gabarito fica AQUI, ao lado de enviar, e não escondido dentro da
          tela de envio. O designer precisa dele ANTES de desenhar — obrigá-lo
          a clicar em "enviar arte" para achar o gabarito é pedir que ele entre
          na fila para descobrir a medida.
        */}
        <BotaoGabarito
          peca={peca}
          perfil={perfil}
          escalaFator={peca.escalaFator || 1}
          politica={politica}
          className="btn btn-ghost"
          aoBaixar={aoBaixarGabarito}
        />
        {situacao.podeEnviar && (
          <button
            className={`btn ${entrega && status !== 'devolvida' ? 'btn-ghost' : ''}`}
            onClick={onEscolher}
          >
            {status === 'reprovada' || status === 'devolvida'
              ? `Enviar arte corrigida (v${situacao.proximaVersao})`
              : entrega ? 'Enviar versão nova' : 'Enviar arte'}
          </button>
        )}
        {!situacao.podeEnviar && bloqueio?.podePedir && !painel && (
          <button className="btn btn-ghost" onClick={() => setPainel('pedido')}>
            {bloqueio.tipo === 'em_producao' ? 'Pedir troca mesmo assim'
              : bloqueio.tipo === 'prazo' ? 'Pedir liberação'
                : 'Pedir para trocar a arte'}
          </button>
        )}
        {!situacao.podeEnviar && bloqueio?.podeAceitarExtra && !painel && (
          <button className="btn btn-ghost" onClick={() => setPainel('extra')}>Aceitar o custo extra</button>
        )}
      </div>
    </li>
  )
}

/**
 * Pedido de troca de arte.
 *
 * A justificativa é obrigatória por um motivo prático: sem ela o analista
 * decide no escuro — não sabe se é correção de telefone ou troca de conceito, e
 * essas duas respostas são diferentes. De quebra, o histórico dos motivos diz,
 * daqui a três feiras, POR QUE as artes voltam.
 */
function FormularioPedido({ peca, proximaVersao, onEnviar, onCancelar }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)

  const enviar = async () => {
    setEnviando(true)
    setErro(null)
    try {
      await onEnviar(motivo.trim())
    } catch (e) {
      setErro(e?.message || 'Não foi possível registrar o pedido.')
      setEnviando(false)
    }
  }

  return (
    <div className="peca-editor">
      <p className="ajuda">
        A arte de <strong>{peca.rotulo}</strong> já está com o time. Para trocar
        pela versão {proximaVersao}, conte o que mudou — a peça pode já estar na
        fila de produção, e é isso que o analista precisa saber para responder.
      </p>
      <label className="campo">
        <span>O que mudou na arte</span>
        <textarea
          rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: o telefone do rodapé estava errado e o cliente aprovou uma foto nova."
        />
      </label>
      {erro && <p className="erro-envio">{erro}</p>}
      <div className="acoes">
        <button className="btn" disabled={motivo.trim().length < 10 || enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar pedido'}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
      {motivo.trim().length < 10 && motivo.length > 0 && (
        <em className="dica-campo">Escreva um pouco mais — o analista precisa entender o motivo.</em>
      )}
    </div>
  )
}

/**
 * Aceite do custo extra.
 *
 * Sem valor na tela, de propósito. Parte dos expositores paga pela organizadora
 * do evento, que aplica margem própria sobre o nosso preço — publicar um número
 * aqui criaria uma expectativa que a fatura não confirma. O texto manda falar
 * com o atendimento, que é onde o número existe.
 */
function FormularioExtra({ motivoDaRecusa, onAceitar, onCancelar }) {
  const [confirmado, setConfirmado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)

  const aceitar = async () => {
    setEnviando(true)
    setErro(null)
    try {
      await onAceitar()
    } catch (e) {
      setErro(e?.message || 'Não foi possível registrar o aceite.')
      setEnviando(false)
    }
  }

  return (
    <div className="peca-editor destaque-extra">
      {motivoDaRecusa && <p className="ajuda">Resposta do time: <em>{motivoDaRecusa}</em></p>}
      <p>{AVISO_EXTRA}</p>
      <label className="alternador">
        <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
        <span>
          Li o aviso acima, entendo que esta troca tem <strong>custo extra</strong> e
          autorizo o time a seguir com a nova arte.
        </span>
      </label>
      {erro && <p className="erro-envio">{erro}</p>}
      <div className="acoes">
        <button className="btn" disabled={!confirmado || enviando} onClick={aceitar}>
          {enviando ? 'Registrando…' : 'Aceito o custo extra'}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar}>Voltar</button>
      </div>
      <p className="nota">
        O aceite é registrado com data e hora. O time ainda precisa liberar o
        envio depois disso — você recebe um aviso quando isso acontecer.
      </p>
    </div>
  )
}

/**
 * Saída para a peça que não estava no projeto.
 *
 * Sempre aparece uma. Sem esta porta, o cliente trava e liga para o time — que
 * é exatamente o telefonema que a ferramenta existe para evitar. Aqui ele volta
 * a informar a medida à mão, como no fluxo aberto, e o envio chega marcado como
 * fora da lista para o time conferir.
 */
function PecaForaDaLista({ bloqueado, onCriar }) {
  const [aberto, setAberto] = useState(false)
  const [rotulo, setRotulo] = useState('')
  const [largura, setLargura] = useState('')
  const [altura, setAltura] = useState('')

  const valido = rotulo.trim().length > 1 && Number(largura) > 0 && Number(altura) > 0

  if (bloqueado) {
    return (
      <p className="nota">
        O prazo de envio encerrou, então não é possível incluir uma peça nova
        por aqui. Fale com o atendimento.
      </p>
    )
  }

  if (!aberto) {
    return (
      <button className="link" onClick={() => setAberto(true)}>
        Preciso enviar uma peça que não está nesta lista
      </button>
    )
  }

  return (
    <div className="peca-editor">
      <p className="ajuda">
        Informe a peça e as medidas finais dela. Como esta não veio do projeto,
        confira o tamanho com o seu contato antes de enviar.
      </p>
      <label className="campo">
        <span>O que é a peça</span>
        <input type="text" value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Adesivo da vitrine" />
      </label>
      <div className="linha">
        <label className="campo">
          <span>Largura (cm)</span>
          <input type="number" min="1" step="0.1" value={largura} onChange={(e) => setLargura(e.target.value)} />
        </label>
        <label className="campo">
          <span>Altura (cm)</span>
          <input type="number" min="1" step="0.1" value={altura} onChange={(e) => setAltura(e.target.value)} />
        </label>
      </div>
      <div className="acoes">
        <button
          className="btn"
          disabled={!valido}
          onClick={() => onCriar(pecaNova({
            id: `extra_${Date.now()}`,
            rotulo: rotulo.trim(),
            perfilId: perfilPorTexto(rotulo),
            larguraCm: Number(largura),
            alturaCm: Number(altura),
          }))}
        >
          Continuar
        </button>
        <button className="btn btn-ghost" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </div>
  )
}

// Tentativas já registradas nesta visita.
//
// Fora do componente de propósito: o cliente vai e volta da lista de peças o
// tempo todo, e um `useRef` seria zerado a cada volta — a mesma tentativa
// entraria no log de novo, e o alerta de "cliente com dificuldade" acenderia
// por causa do vaivém dele, não do problema dele.
const tentativasRegistradas = new Set()

/**
 * Registra a tentativa que a análise reprovou.
 *
 * Este é o único ponto da ferramenta em que grava-se algo de uma arte que NÃO
 * foi enviada — e é o ponto inteiro do log. Como a arte reprovada nunca sobe,
 * o cliente que tentou oito vezes e desistiu não deixava rastro: no painel ele
 * era idêntico ao que nem tinha começado.
 *
 * Falha em silêncio, sempre. O log serve ao time; o cliente está no meio de um
 * problema e não pode receber por cima dele um erro sobre um registro que não
 * é da conta dele.
 */
function usarLogDeReprovacao(token, peca, versao, resultado) {
  useEffect(() => {
    if (!token || !resultado || resultado.veredicto !== 'reprovado') return
    const chave = chaveDaTentativa(token, peca.id, resultado)
    if (tentativasRegistradas.has(chave)) return
    tentativasRegistradas.add(chave)
    registrarReprovacao(token, eventoDeReprovacao({ peca, resultado, versao }))
      .catch((e) => {
        tentativasRegistradas.delete(chave)
        console.warn('não foi possível registrar a tentativa reprovada', e)
      })
  }, [token, peca, versao, resultado])
}

function PainelDaPeca({ situacao, projeto, resumo, cadastro, perfis, politica, detectorNitidez, onVoltar, onEnviado }) {
  const peca = situacao.peca
  const perfil = perfis.find((p) => p.id === peca.perfilId) || perfis[0]
  const alvo = { larguraCm: peca.larguraCm, alturaCm: peca.alturaCm }

  // A escala continua sendo escolha de quem montou o arquivo: ela descreve o
  // ARQUIVO, não a peça. O projeto só sugere a escala aceita.
  const [escalaFator, setEscalaFator] = useState(peca.escalaFator || 1)

  const analise = usarAnalise({ peca: alvo, perfil, escalaFator, politica, detectorNitidez })
  const spec = especificacao(alvo, perfil, politica)
  const ehExtra = String(peca.id).startsWith('extra_')

  usarLogDeReprovacao(projeto.token, peca, situacao.proximaVersao, analise.resultado)

  return (
    <>
      <Capa
        projeto={projeto}
        resumo={resumo}
        compacta
        legenda={`Enviando: ${peca.rotulo}`}
        onVoltar={onVoltar}
      />

      <div className="cartao">
        <div className="admin-topo">
          <div>
            <h2>{peca.rotulo}</h2>
            <p className="ajuda">
              {perfil.nome} · {fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm
              {situacao.proximaVersao > 1 && ` · enviando a versão ${situacao.proximaVersao}`}
            </p>
          </div>
        </div>

        {situacao.status === 'reprovada' && (
          <p className="nota destaque-correcao">
            Esta peça foi reprovada na prova de aprovação. Envie a arte
            corrigida — o prazo não conta contra você nesta correção.
            {situacao.resposta?.observacao && <> Observação do seu retorno: <em>{situacao.resposta.observacao}</em></>}
          </p>
        )}

        {/* O motivo tem que estar visível ENQUANTO ele monta o arquivo novo.
            Deixá-lo só no cartão anterior obrigaria a voltar para reler. */}
        {situacao.status === 'devolvida' && (
          <p className="nota destaque-correcao">
            O time recebeu esta arte e recusou: <em>“{situacao.devolucao.motivo}”</em> Envie a
            versão corrigida — o prazo não conta contra você nesta correção.
          </p>
        )}
      </div>

      <div className="colunas">
        <div className="coluna">
          <div className="cartao">
            <div className="spec">
              <div className="spec-titulo">O que o arquivo precisa ter</div>
              <dl>
                <div>
                  <dt>Tamanho final</dt>
                  <dd>{fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm</dd>
                </div>
                <div>
                  <dt>Com sangria ({spec.sangriaMm} mm por lado)</dt>
                  <dd>{fmt(spec.comSangria.larguraCm)} × {fmt(spec.comSangria.alturaCm)} cm</dd>
                </div>
                <div>
                  <dt>Margem de segurança</dt>
                  <dd>{perfil.margemMm} mm</dd>
                </div>
                <div className="destaque">
                  <dt>Mínimo com sangria ({spec.minimo.dpi} dpi)</dt>
                  <dd>{fmt(spec.minimo.largura)} × {fmt(spec.minimo.altura)} px</dd>
                </div>
                <div className="destaque">
                  <dt>Ideal com sangria ({spec.ideal.dpi} dpi)</dt>
                  <dd>{fmt(spec.ideal.largura)} × {fmt(spec.ideal.altura)} px</dd>
                </div>
              </dl>
            </div>

            <label className="campo">
              <span>Em que escala a arte foi montada</span>
              <select value={escalaFator} onChange={(e) => setEscalaFator(Number(e.target.value))}>
                <option value={1}>1:1 — tamanho real</option>
                <option value={2}>1:2 — metade do tamanho</option>
                <option value={4}>1:4 — um quarto</option>
                <option value={10}>1:10 — um décimo</option>
              </select>
            </label>
            <p className="nota">
              Montar a arte reduzida é praxe no grande formato. Informar a escala
              evita que um arquivo correto seja reprovado por engano.
            </p>
          </div>

          <Gabarito peca={alvo} perfil={perfil} escalaFator={escalaFator} politica={politica} />
        </div>

        <div className="coluna">
          <Upload onArquivo={analise.receberArquivo} analisando={analise.analisando} nomeAtual={analise.arquivo?.name} />

          {analise.erro && (
            <div className="cartao erro">
              <strong>Não foi possível analisar este arquivo</strong>
              <p>{analise.erro}</p>
              <p className="acao">→ Tente exportar a arte em PDF, JPG ou PNG e enviar novamente.</p>
            </div>
          )}

          {analise.resultado && (
            <Resultado
              resultado={analise.resultado}
              onAceitarRisco={analise.aceitarRisco}
              riscoAceito={analise.riscoAceito}
              arquivo={analise.arquivo}
              cadastro={cadastro}
              projeto={{
                token: projeto.token,
                pecaId: ehExtra ? null : peca.id,
                pecaRotulo: peca.rotulo,
                versao: situacao.proximaVersao,
              }}
              onEnviado={onEnviado}
            />
          )}
        </div>
      </div>
    </>
  )
}
