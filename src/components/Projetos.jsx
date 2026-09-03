import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PERFIS_PADRAO, ESCALAS } from '../data/perfis.js'
import {
  projetoNovo, pecaNova, validarProjeto, perfilPorTexto, listaDeEmails, MAXIMO_PECAS,
  tituloDoProjeto, localSemRepetirStand,
} from '../data/projeto.js'
import { importarProjetos, MODELO_CSV } from '../core/importacao.js'
import { situacaoDoProjeto } from '../core/painel.js'
import { formatarData as fmtData, paraInputData, fimDoDia } from '../core/datas.js'
import {
  salvarProjeto, salvarProjetos, apagarProjeto, salvarFeira, apagarFeira,
  ouvirProjetos, ouvirEnvios,
} from '../services/projetos.js'
import { vistoEm, marcarVisto, dataEmMs, assinarVisto } from '../store/visto.js'
import { enviarGabarito, EXTENSOES_GABARITO } from '../services/envio.js'
import { idDeFeira } from '../data/cadastro.js'
import { traduzirErroAuth } from '../services/sessao.js'
import { pode } from '../core/permissoes.js'
import { usarFeiras } from '../store/feiras.js'
import { baixarTexto, baixarEmLote, paraCsv } from '../core/saida.js'
import PainelProjeto from './PainelProjeto.jsx'
import ImportarProducao from './ImportarProducao.jsx'
import ListaDePecas from './ListaDePecas.jsx'

// Cadastro e acompanhamento dos projetos: quais peças cada stand precisa
// entregar, e em que pé está cada uma.
//
// Esta tela é a inversão do fluxo. Antes o cliente digitava a medida da peça e
// a análise inteira dependia daquele número; agora a medida vem daqui, de quem
// a conhece. O cliente só sobe o arquivo.
//
// O segundo ganho, que na operação vale tanto quanto: sabendo o que era para
// chegar, dá para dizer o que FALTA — e cobrar. Antes só existia a lista do
// que chegou.

const nomeDoPerfil = (id) => PERFIS_PADRAO.find((p) => p.id === id)?.nome || id
export function linkDoProjeto(token) {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/p/${token}`
}

const situacao = (projeto, enviosPorProjeto) =>
  situacaoDoProjeto(projeto, enviosPorProjeto.get(projeto.token) || [])

/**
 * De onde vem o resto da bolinha.
 *
 * A marca de "visto" é por feira; a bolinha da aba soma todas. Sem esta linha,
 * arte que chega numa feira que o analista não abre naquele dia deixa o número
 * aceso para sempre, e ele fica olhando uma lista sem nenhuma arte nova
 * tentando entender de onde saiu o "2". Foi o que aconteceu aqui.
 *
 * Não tem botão de "marcar todas como vistas", e é de propósito: apagar em lote
 * um aviso sem olhar o que ele apontava é a forma mais rápida de a bolinha
 * perder a confiança do time. O caminho é ir na feira — um clique, e a marca
 * acontece por ter visto de verdade.
 */
function ArteEmOutrasFeiras({ novosPorFeira, feiras, feiraId, onIr }) {
  const outras = feiras
    .filter((f) => f.id !== feiraId && novosPorFeira[f.id] > 0)
    .map((f) => ({ ...f, novas: novosPorFeira[f.id] }))
  if (!outras.length) return null

  return (
    <p className="ajuda">
      Arte nova em outra feira:{' '}
      {outras.map((f, i) => (
        <span key={f.id}>
          {i > 0 && ' · '}
          <button className="link" type="button" onClick={() => onIr(f.id)}>
            {f.nome} ({f.novas})
          </button>
        </span>
      ))}
    </p>
  )
}

function textoDeCobranca(projeto, sit) {
  const prazo = fmtData(sit.prazo.limite, null)
  const linhas = [
    `Olá, ${projeto.expositor}!`,
    '',
    `Estamos finalizando a produção do stand ${projeto.stand} para ${projeto.feira} e ainda faltam ${sit.pendentes.length} ${sit.pendentes.length === 1 ? 'arte' : 'artes'}:`,
    '',
    ...sit.pendentes.map(({ peca }) => `• ${peca.rotulo} — ${peca.larguraCm} × ${peca.alturaCm} cm`),
    '',
  ]
  if (prazo) {
    linhas.push(
      `O prazo para envio é ${prazo}. Artes enviadas depois disso podem ter taxa de urgência e acabamento comprometido — se precisar de mais tempo, fale com a gente antes do prazo.`,
      '',
    )
  }
  linhas.push(
    'Para enviar, use o link abaixo. Ele já vem com as medidas certas de cada peça, confere a qualidade do arquivo na hora e diz o que ajustar caso algo não passe:',
    '',
    linkDoProjeto(projeto.token),
    '',
    'Não precisa de login nem de senha — pode encaminhar direto para quem cuida da arte.',
  )
  return linhas.join('\n')
}

export default function Projetos({ sessao, feiraInicial = '', tokenInicial = '', novosPorFeira = {} }) {
  const { fb, usuario } = sessao
  const { feiras, feira, feiraId, setFeiraId, recarregar: recarregarFeiras, erro: erroFeiras } = usarFeiras(fb, sessao.acesso, feiraInicial)
  const podeCadastrar = pode(sessao.acesso, 'cadastrarProjetos')
  const podeCobrar = pode(sessao.acesso, 'cobrar')
  const podeAprovar = pode(sessao.acesso, 'aprovar')
  const [editandoFeira, setEditandoFeira] = useState(null) // null | 'editar' | 'nova'
  const [projetos, setProjetos] = useState([])
  const [envios, setEnvios] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  // Chegando por #/projetos/FEIRA/TOKEN — o atalho da visão geral — a tela já
  // abre na ficha daquele stand, sem obrigar o analista a achar de novo na
  // lista o stand em que ele acabou de clicar.
  const [painel, setPainel] = useState(tokenInicial ? { detalhe: tokenInicial } : null)
  const [filtro, setFiltro] = useState('')

  // A escuta substitui o F5. O analista deixa esta tela aberta o dia inteiro
  // durante a montagem; obrigá-lo a recarregar para saber se chegou arte é
  // transformar o painel num lugar que ele evita abrir.
  useEffect(() => {
    if (!fb || !feiraId) { setProjetos([]); setEnvios([]); return undefined }
    setCarregando(true)
    setErro(null)
    const falhou = (e) => setErro(traduzirErroAuth(e))
    const pararProjetos = ouvirProjetos(fb, feiraId, (lista) => {
      setProjetos(lista)
      setCarregando(false)
    }, falhou)
    const pararEnvios = ouvirEnvios(fb, feiraId, setEnvios, falhou)
    return () => { pararProjetos(); pararEnvios() }
  }, [fb, feiraId])

  // Depois de gravar, não é preciso reler: a escuta já traz o que mudou.
  const recarregar = useCallback(async () => {}, [])

  const enviosPorProjeto = useMemo(() => {
    const mapa = new Map()
    for (const e of envios) {
      if (!e.projetoId) continue
      if (!mapa.has(e.projetoId)) mapa.set(e.projetoId, [])
      mapa.get(e.projetoId).push(e)
    }
    return mapa
  }, [envios])

  // Abrir a conversa marca como lida, e isso precisa apagar a etiqueta aqui na
  // hora. Sem esta assinatura a lista só reagia a mudança vinda do servidor —
  // e ler uma mensagem não muda documento nenhum.
  const [versaoDoVisto, setVersaoDoVisto] = useState(0)
  useEffect(() => assinarVisto(() => setVersaoDoVisto((v) => v + 1)), [])

  /**
   * Estar com a lista da feira na tela É ter visto a arte que chegou nela.
   *
   * Esta marcação existia na aba "Artes recebidas" e foi apagada junto com ela.
   * O CONTADOR sobreviveu — passou a somar na bolinha de Projetos —, mas quem o
   * zerava não: nenhuma tela gravava mais `envios:{feira}`. O resultado é uma
   * bolinha que acende e nunca mais apaga, nem recarregando, porque a marca que
   * ela compara nunca avança. Foi assim que o painel passou a mostrar "2" com o
   * analista olhando as duas artes na tela.
   *
   * A marca é POR FEIRA, e é de propósito: abrir a SUMMIT não pode apagar o
   * aviso de arte que chegou na ECBR. Por isso a bolinha da aba continua
   * somando todas as feiras que a pessoa alcança, e vai baixando conforme ela
   * passa por cada uma.
   *
   * Só grava com a lista já carregada e não vazia: marcar durante o
   * carregamento apagaria o aviso de uma arte que ainda nem apareceu na tela.
   * A espera de 1,2 s é o que separa "abriu a tela" de "passou por ela" — sem
   * ela, trocar de feira no seletor apagaria os avisos de todas as feiras que
   * o cursor atravessou.
   */
  useEffect(() => {
    if (carregando || !feiraId || !envios.length) return undefined
    const relogio = setTimeout(() => {
      const maisNovo = envios.reduce((m, e) => Math.max(m, dataEmMs(e.criadoEm)), 0)
      marcarVisto(usuario?.email, `envios:${feiraId}`, maisNovo || Date.now())
    }, 1200)
    return () => clearTimeout(relogio)
  }, [carregando, envios, feiraId, usuario?.email])

  const marcaConversa = (token) => vistoEm(usuario?.email, `conversa:${token}`)

  // Duas etapas de propósito: o texto e a feira definem o UNIVERSO desta tela,
  // e é sobre ele que as fatias são contadas. Contar depois do filtro de fase
  // daria a cada botão o seu próprio número e zero em todos os outros — que é
  // o oposto de um painel.
  const universo = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    // O prazo vem da feira, não da cópia guardada no projeto. É a mesma leitura
    // que a tela do cliente faz — se as duas divergissem, o time veria um prazo
    // e o cliente outro.
    const comPrazo = (p) => (feira && 'prazoEnvio' in feira ? { ...p, prazoEnvio: feira.prazoEnvio } : p)
    return projetos
      .map((p) => ({
        projeto: p,
        sit: situacao(comPrazo(p), enviosPorProjeto),
        // Bolinha só quando a última palavra é do CLIENTE e é mais nova que a
        // última vez que este analista abriu a conversa. Marcar por autor evita
        // o painel acender por causa da própria resposta do time.
        temMensagemNova: p.conversa?.ultimoAutor === 'cliente'
          && dataEmMs(p.conversa?.ultimaEm) > marcaConversa(p.token),
      }))
      .filter(({ projeto }) => !t || [projeto.stand, projeto.expositor, projeto.email]
        .some((v) => String(v || '').toLowerCase().includes(t)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projetos, enviosPorProjeto, filtro, feira, usuario?.email, versaoDoVisto])

  // `universo` e `linhas` eram diferentes enquanto existiam as pílulas de fase:
  // as contagens saíam do universo (todos os stands da feira) e a lista, do
  // recorte da fase escolhida. Sem as pílulas, é a mesma coisa — e manter dois
  // nomes para o mesmo valor é um convite a filtrar por um e contar pelo outro.
  const linhas = universo

  const resumo = useMemo(() => {
    const total = linhas.reduce((s, l) => s + l.sit.total, 0)
    const recebidas = linhas.reduce((s, l) => s + l.sit.recebidas, 0)
    return {
      stands: linhas.length,
      total,
      recebidas,
      faltam: total - recebidas,
      completos: linhas.filter((l) => l.sit.completo).length,
      pedidos: linhas.reduce((s, l) => s + l.sit.pedidosEmAberto.length, 0),
      provas: linhas.reduce((s, l) => s + l.sit.provasAguardando, 0),
      mensagens: linhas.filter((l) => l.temMensagemNova).length,
    }
  }, [linhas])

  const guardar = async (projeto) => {
    await salvarProjeto(fb, projeto, usuario?.email)
    setPainel(null)
    await recarregar()
  }

  const remover = async (projeto, sit) => {
    const aviso = sit.recebidas
      ? `O stand ${projeto.stand} já tem ${sit.recebidas} arquivo(s) recebido(s). Apagar o projeto NÃO apaga os arquivos, mas o link do cliente para de funcionar. Continuar?`
      : `Apagar o projeto do stand ${projeto.stand}?`
    if (!window.confirm(aviso)) return
    await apagarProjeto(fb, projeto.token)
    await recarregar()
  }

  if (painel === 'producao') {
    return (
      <ImportarProducao
        sessao={sessao}
        onPronto={async () => { setPainel(null); await recarregar() }}
        onCancelar={() => setPainel(null)}
      />
    )
  }
  if (painel === 'importar') {
    return <Importacao sessao={sessao} onPronto={async () => { setPainel(null); await recarregar() }} onCancelar={() => setPainel(null)} />
  }
  if (painel?.projeto) {
    return <FormularioProjeto sessao={sessao} inicial={painel.projeto} onSalvar={guardar} onCancelar={() => setPainel(null)} />
  }
  if (painel?.detalhe) {
    const bruto = projetos.find((p) => p.token === painel.detalhe)
    const atual = bruto && feira && 'prazoEnvio' in feira
      ? { ...bruto, prazoEnvio: feira.prazoEnvio }
      : bruto
    if (atual) {
      const sit = situacao(atual, enviosPorProjeto)
      return (
        <PainelProjeto
          sessao={sessao}
          projeto={atual}
          resumo={sit}
          envios={sit.envios}
          podeAprovar={podeAprovar}
          onFechar={() => setPainel(null)}
          onMudou={recarregar}
        />
      )
    }
  }

  return (
    <>
      <div className="cartao">
        <h2>Projetos cadastrados</h2>
        <p className="ajuda">
          Cadastre aqui as peças de cada stand. O cliente recebe um link, abre e
          já encontra as medidas certas — ele não digita tamanho nenhum, que era
          de onde vinha a maior parte dos erros.
        </p>

        <div className="linha">
          <label className="campo">
            <span>Feira</span>
            <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
              {!feiras.length && <option value="">Nenhuma feira cadastrada ainda</option>}
              {feiras.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Filtrar por stand, cliente ou e-mail</span>
            <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="digite para filtrar" />
          </label>
        </div>

        {/*
          As pílulas de fase saíram.
          
          Elas respondiam "quem ainda não mandou nada?" com um clique, e isso
          continua respondido — na Visão geral, pela grade de estados, que faz
          a mesma pergunta sobre a feira inteira e leva ao stand. Duas telas
          respondendo a mesma coisa é uma a mais para manter em pé, e era esta
          que ficava desatualizada: os estados aqui eram uma lista própria,
          escrita antes de a esteira existir.
          
          O filtro por texto fica: procurar "After Click" é outra pergunta.
        */}

        {podeCadastrar && (
          <div className="acoes">
            <button className="btn" onClick={() => setPainel('importar')}>Importar planilha</button>
            <button className="btn btn-ghost" onClick={() => setPainel('producao')}>
              Importar da produção
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setPainel({ projeto: projetoNovo({ feira: feiras.find((f) => f.id === feiraId)?.nome || '' }) })}
            >
              Novo projeto
            </button>
          </div>
        )}

        {(erro || erroFeiras) && <p className="erro-envio">{erro || erroFeiras}</p>}

        {editandoFeira
          ? (
            <FeiraEmEdicao
              sessao={sessao}
              feira={feira}
              feiraId={feiraId}
              novaFeira={editandoFeira === 'nova'}
              projetos={projetos}
              envios={envios}
              onPronto={async (id) => {
                setEditandoFeira(null)
                await recarregarFeiras(id)
                await recarregar()
              }}
              onCancelar={() => setEditandoFeira(null)}
            />
          )
          : (
            <ResumoDaFeira
              feira={feira}
              podeEditar={podeCadastrar}
              onEditar={() => setEditandoFeira('editar')}
              onNova={() => setEditandoFeira('nova')}
            />
          )}

        {linhas.length > 0 && (
          <>
            <p className="ajuda resumo-admin">
              <strong>{resumo.stands}</strong> stands · <strong>{resumo.recebidas}</strong> de{' '}
              <strong>{resumo.total}</strong> artes recebidas ·{' '}
              {resumo.faltam > 0
                ? <><strong>{resumo.faltam}</strong> pendentes</>
                : 'nada pendente'}{' '}
              · {resumo.completos} stands completos
              {resumo.pedidos > 0 && <> · <strong className="destaque-pendencia">{resumo.pedidos} pedido(s) aguardando resposta</strong></>}
              {resumo.mensagens > 0 && <> · <strong className="destaque-pendencia">{resumo.mensagens} conversa(s) com mensagem nova</strong></>}
              {resumo.provas > 0 && <> · {resumo.provas} prova(s) com o cliente</>}
            </p>
            <ArteEmOutrasFeiras
              novosPorFeira={novosPorFeira}
              feiras={feiras}
              feiraId={feiraId}
              onIr={setFeiraId}
            />
            {/*
              "Exportar links (CSV)" e "Copiar e-mails com pendência" saíram.
              
              Os dois existiam para alimentar um cliente de e-mail por fora: a
              planilha de links era para montar o disparo à mão, e a lista de
              endereços para colar no campo "para". A ferramenta passou a mandar
              os e-mails sozinha — boas-vindas, prazo, prova pronta, arte
              devolvida e resposta no chat —, e um atalho que leva a fazer à mão
              o que já é feito sozinho não é conveniência: é um jeito de duas
              cobranças chegarem ao mesmo cliente no mesmo dia.
            */}
          </>
        )}
      </div>

      <div className="cartao">
        {carregando && <p className="ajuda">Carregando…</p>}
        {!carregando && !projetos.length && (
          <p className="ajuda">
            Nenhum projeto cadastrado para esta feira. Comece por
            <strong> Importar planilha</strong> — é o caminho que se paga.
          </p>
        )}
        {!carregando && projetos.length > 0 && !linhas.length && (
          <p className="ajuda">
            Nenhum resultado para “{filtro}”.
          </p>
        )}
        {linhas.map(({ projeto, sit, temMensagemNova }) => (
          <LinhaProjeto
            key={projeto.token}
            projeto={projeto}
            sit={sit}
            temMensagemNova={temMensagemNova}
            podeCadastrar={podeCadastrar}
            podeCobrar={podeCobrar}
            onAbrir={() => setPainel({ detalhe: projeto.token })}
            onEditar={() => setPainel({ projeto })}
            onRemover={() => remover(projeto, sit)}
          />
        ))}
      </div>
    </>
  )
}

/**
 * Cadastro da feira: nome e prazo final de envio.
 *
 * A feira é a dona do prazo, e os projetos leem dela. A versão anterior
 * copiava a data para dentro de cada projeto num clique de "aplicar a todos" —
 * e todo stand cadastrado DEPOIS nascia sem prazo nenhum, sem ninguém
 * perceber, porque a tela continuava mostrando a data. Lendo da origem, a
 * ordem de cadastro deixa de importar e não há o que reaplicar.
 */
function FeiraEmEdicao({ sessao, feira, feiraId, novaFeira, projetos, envios, onPronto, onCancelar }) {
  const podeExcluir = pode(sessao.acesso, 'excluirFeiras')
  const [nome, setNome] = useState(novaFeira ? '' : (feira?.nome || ''))
  const [data, setData] = useState(() => paraInputData(feira?.prazoEnvio))
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState(null)

  const salvar = async () => {
    setErro(null)
    setGravando(true)
    try {
      const id = await salvarFeira(sessao.fb, {
        id: novaFeira ? null : feiraId,
        nome,
        prazoEnvio: fimDoDia(data),
      }, sessao.usuario?.email)
      await onPronto(id)
    } catch (e) {
      setErro(traduzirErroAuth(e, 'gravacao'))
      setGravando(false)
    }
  }

  return (
    <div className="bloco-prazo">
      <div className="linha">
        <label className="campo">
          <span>Nome da feira</span>
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Expo Sul 2026" />
        </label>
        <label className="campo">
          <span>Prazo final de envio das artes</span>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>
      {erro && <p className="erro-envio">{erro}</p>}
      <div className="acoes">
        <button className="btn" disabled={nome.trim().length < 2 || gravando} onClick={salvar}>
          {gravando ? 'Salvando…' : novaFeira ? 'Criar feira' : 'Salvar'}
        </button>
        {data && !novaFeira && (
          <button
            className="btn btn-ghost perigo"
            disabled={gravando}
            onClick={() => { setData(''); }}
          >
            Limpar prazo
          </button>
        )}
        <button className="btn btn-ghost" disabled={gravando} onClick={onCancelar}>Cancelar</button>
      </div>
      <p className="nota">
        O prazo vale para todos os stands desta feira, inclusive os que você
        cadastrar depois — não é preciso reaplicar. Vencido o prazo, o envio de
        peça nova fica bloqueado e o cliente vê o aviso sobre taxa de urgência.
        Correções que o time pediu continuam liberadas: quem foi reprovado numa
        prova não é punido pela nossa volta. Para abrir exceção a um stand, use{' '}
        <strong>Abrir</strong> e prorrogue só para ele.
      </p>

      <ArquivosDaFeira envios={envios} feiraId={feiraId} podeBaixar={pode(sessao.acesso, 'verArtes')} />

      {/*
        Só administrador. Cadastro e analista completo criam e editam feiras —
        apagar é outra coisa: leva junto os stands, os arquivos e as conversas,
        e não tem desfazer. É a segunda permissão do sistema que também é lei no
        servidor, ao lado de mexer na lista de analistas, pelo mesmo motivo: são
        as duas em que o erro não se conserta depois.
      */}
      {!novaFeira && podeExcluir && (
        <ApagarFeira
          sessao={sessao}
          feira={feira}
          feiraId={feiraId}
          projetos={projetos}
          envios={envios}
          onApagou={onPronto}
        />
      )}
    </div>
  )
}

/**
 * Levar os arquivos da feira para fora da ferramenta.
 *
 * Estava na aba "Artes recebidas", que saiu. Era o único recurso dela que a
 * ficha do stand não cobre: baixar uma arte por vez resolve o caso do dia a
 * dia, mas na semana da montagem alguém precisa levar setenta arquivos para a
 * máquina de produção, e clicar em setenta links não é um caminho.
 *
 * Fica recolhido porque é operação de fim de feira, feita uma ou duas vezes —
 * e três botões de download permanentes no alto da tela competem com o
 * trabalho de todo dia, que é abrir stand.
 */
function ArquivosDaFeira({ envios, feiraId, podeBaixar }) {
  const [aberto, setAberto] = useState(false)
  const [baixando, setBaixando] = useState(null)

  const artes = envios.filter((e) => !e.arquivado && e.link)
  if (!podeBaixar || !artes.length) return null

  const baixarTudo = async () => {
    setBaixando(`0 de ${artes.length}`)
    await baixarEmLote(
      artes.map((e) => ({
        link: e.link,
        nomeSugerido: `${e.cadastro?.stand || 'stand'} - ${e.pecaRotulo || e.perfil?.nome || 'peca'} - ${e.arquivo?.nome || e.protocolo}`,
      })),
      (feitos, total) => setBaixando(`${feitos} de ${total}`),
    )
    setBaixando(null)
  }

  if (!aberto) {
    return (
      <p className="nota">
        <button className="link" onClick={() => setAberto(true)}>
          Baixar os arquivos desta feira
        </button>
        {' '}— {artes.length} arte(s) recebida(s), em lote ou em planilha.
      </p>
    )
  }

  return (
    <div className="peca-editor">
      <p className="ajuda">
        São {artes.length} arquivo(s). O navegador vai pedir permissão para
        baixar vários de uma vez — é preciso aceitar, senão só o primeiro desce.
      </p>
      <div className="acoes">
        <button className="btn" disabled={Boolean(baixando)} onClick={baixarTudo}>
          {baixando ? `Baixando ${baixando}…` : `Baixar os ${artes.length} arquivos`}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => baixarTexto(`artes-${feiraId}.csv`, paraCsv(artes), 'text/csv;charset=utf-8')}
        >
          Exportar planilha (CSV)
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => baixarTexto(
            `links-${feiraId}.txt`,
            artes.map((e) => `${e.cadastro?.stand} — ${e.pecaRotulo || e.perfil?.nome}\n${e.link}\n`).join('\n'),
            'text/plain;charset=utf-8',
          )}
        >
          Lista de links
        </button>
        <button className="btn btn-ghost" disabled={Boolean(baixando)} onClick={() => setAberto(false)}>
          Fechar
        </button>
      </div>
    </div>
  )
}

/**
 * Apagar a feira inteira.
 *
 * Existe porque feira de teste ficava para sempre na lista, e uma lista com
 * lixo é uma lista em que se erra a seleção — cadastrar um stand real na
 * "Teste 2" é o tipo de engano que só aparece quando o cliente reclama.
 *
 * Três decisões sobre a confirmação:
 *
 * 1. DIGITAR O NOME, e não um "tem certeza?". A caixa de confirmação é clicada
 *    sem ser lida; digitar "Petvet 2026" obriga a olhar QUAL feira está
 *    prestes a sumir. É a diferença entre confirmar e conferir.
 * 2. A CONTA VEM ANTES. "6 stands e 14 artes serão apagados" é a informação
 *    que muda a decisão, e ela precisa estar visível no momento de digitar,
 *    não escondida numa tela anterior.
 * 3. SEM DESFAZER, e dito com todas as letras. Não existe lixeira aqui; fingir
 *    que existe seria pior do que a ausência.
 */
function ApagarFeira({ sessao, feira, feiraId, projetos, envios, onApagou }) {
  const [aberto, setAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState('')
  const [apagando, setApagando] = useState(false)
  const [andamento, setAndamento] = useState(null)
  const [erro, setErro] = useState(null)

  const nome = feira?.nome || feiraId
  const confere = confirmacao.trim().toLowerCase() === String(nome).trim().toLowerCase()

  const apagar = async () => {
    setErro(null)
    setApagando(true)
    try {
      await apagarFeira(sessao.fb, feiraId, projetos.map((p) => p.token), (feitos, total) => {
        setAndamento(`${feitos} de ${total} stands…`)
      })
      await onApagou(null)
    } catch (e) {
      setErro(traduzirErroAuth(e, 'gravacao'))
      setApagando(false)
      setAndamento(null)
    }
  }

  if (!aberto) {
    return (
      <p className="nota">
        <button className="link perigo" onClick={() => setAberto(true)}>Excluir esta feira</button>
        {' '}— apaga a feira, os stands e os arquivos. Serve para limpar testes.
      </p>
    )
  }

  return (
    <div className="zona-perigo">
      <strong>Excluir “{nome}” definitivamente</strong>
      <p className="dica-campo">
        Vão junto <strong>{projetos.length} stand(s)</strong>,{' '}
        <strong>{envios.length} arquivo(s) recebido(s)</strong>, as conversas, o
        histórico de reprovações e as provas de aprovação. Os links que os
        clientes têm param de funcionar. <strong>Não há como desfazer.</strong>
      </p>
      <label className="campo">
        <span>Para confirmar, digite o nome da feira: <strong>{nome}</strong></span>
        <input
          type="text"
          value={confirmacao}
          disabled={apagando}
          onChange={(e) => setConfirmacao(e.target.value)}
          placeholder={nome}
        />
      </label>
      {erro && <p className="erro-envio">{erro}</p>}
      <div className="acoes">
        <button className="btn perigo" disabled={!confere || apagando} onClick={apagar}>
          {apagando ? (andamento || 'Apagando…') : 'Excluir a feira'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={apagando}
          onClick={() => { setAberto(false); setConfirmacao(''); setErro(null) }}
        >
          Cancelar
        </button>
      </div>
      <p className="dica-campo">
        Os arquivos guardados são apagados logo em seguida, por uma rotina no
        servidor — o navegador não tem permissão para isso, e é de propósito:
        registro de envio não se apaga de dentro de uma sessão.
      </p>
    </div>
  )
}

function ResumoDaFeira({ feira, podeEditar, onEditar, onNova }) {
  const prazo = fmtData(feira?.prazoEnvio, null)
  return (
    <div className="bloco-prazo">
      <div className="linha">
        <div>
          <strong>Prazo final de envio: </strong>
          {prazo
            ? <span className="tag alerta">{prazo}</span>
            : <em className="dica-campo">não cadastrado — nenhum envio será bloqueado</em>}
          <p className="nota">
            Vale para todos os stands desta feira, inclusive os cadastrados
            depois. Exceção individual: <strong>Abrir</strong> → prorrogar.
          </p>
        </div>
        {podeEditar && (
          <div className="acoes">
            <button className="btn btn-ghost" onClick={onEditar}>Editar feira</button>
            <button className="btn btn-ghost" onClick={onNova}>Nova feira</button>
          </div>
        )}
      </div>
    </div>
  )
}

function LinhaProjeto({ projeto, sit, temMensagemNova, podeCadastrar, podeCobrar, onAbrir, onEditar, onRemover }) {
  const [aberto, setAberto] = useState(false)
  const [copiado, setCopiado] = useState(null)

  const copiar = async (texto, marca) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(marca)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      window.prompt('Copie o texto abaixo:', texto)
    }
  }

  const assunto = `Artes do stand ${projeto.stand} — ${projeto.feira}`
  // Todos os decisores no mesmo e-mail: mandar só para o primeiro é quase o
  // mesmo que não mandar — alguém responde "não sou eu que vejo isso".
  const destinatarios = (projeto.emails?.length ? projeto.emails : [projeto.email]).filter(Boolean)
  const mailto = `mailto:${encodeURIComponent(destinatarios.join(','))}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(textoDeCobranca(projeto, sit))}`
  const { titulo, apoio } = tituloDoProjeto(projeto)
  const local = localSemRepetirStand(projeto.localizacao, projeto.stand)

  return (
    <div className={`projeto ${sit.completo ? 'completo' : ''}`}>
      <div className="projeto-topo">
        <div>
          {/*
            A EMPRESA em negrito, o código do stand ao lado em cinza — e não o
            contrário, como estava. Numa lista de duzentos stands ninguém
            procura por "A25": procura pela LW, pela Dealer Net. O código é o
            endereço da empresa, não o nome dela.
          */}
          <strong>{titulo}</strong>
          {apoio && <span className="dica-campo"> · {apoio}</span>}
          <br />
          <a href={`mailto:${destinatarios.join(',')}`}>{destinatarios.join(', ')}</a>
          {local && <em className="dica-campo"> · {local}</em>}
        </div>
        <div className="projeto-progresso">
          <span className={`tag ${sit.completo ? 'aprovado' : sit.recebidas ? 'ressalva' : ''}`}>
            {sit.recebidas} de {sit.total}
          </span>
          {sit.pedidosEmAberto.length > 0 && (
            <span className="tag reprovado">{sit.pedidosEmAberto.length} pedido(s)</span>
          )}
          {temMensagemNova && <span className="tag aviso">mensagem nova</span>}
          {/*
            O cliente que tenta e é reprovado some do painel: a arte não sobe,
            então ele fica igualzinho a quem nem abriu o link. Esta etiqueta é
            a diferença entre mandar mais uma cobrança e ligar para ajudar.
          */}
          {sit.dificuldade.alerta && (
            <span className="tag aviso" title={sit.dificuldade.ultimoMotivo || ''}>
              {sit.dificuldade.total} reprovações
            </span>
          )}
          {sit.provasAguardando > 0 && <em className="dica-campo">{sit.provasAguardando} em prova</em>}
          {sit.emProducao > 0 && <em className="dica-campo">{sit.emProducao} em produção</em>}
          {sit.apoio.length > 0 && <em className="dica-campo">{sit.apoio.length} arquivo(s) de apoio</em>}
          {sit.prazo.prorrogado && <em className="dica-campo">prazo prorrogado</em>}
          {/*
            Projeto importado da produção nasce sem peça: o app de produção não
            conhece as artes do stand. Enquanto estiver assim, o link do cliente
            abre uma lista vazia — e é por isso que o aviso é vermelho, não uma
            nota discreta.
          */}
          {sit.total === 0 && <span className="tag reprovado">sem peças cadastradas</span>}
        </div>
      </div>

      <div className="acoes compactas">
        {/* "Detalhes ›", como no desenho da designer: a seta diz que leva a
            outro lugar, e "Abrir" ao lado de "Editar" e "Apagar" não dizia. */}
        <button className={`btn ${temMensagemNova ? 'pulsa' : ''}`} onClick={onAbrir}>
          Detalhes{temMensagemNova && ' ·'} <span aria-hidden>›</span>
        </button>
        <button className="btn btn-ghost" onClick={() => copiar(linkDoProjeto(projeto.token), 'link')}>
          {copiado === 'link' ? '✓ Link copiado' : 'Copiar link do cliente'}
        </button>
        {podeCobrar && sit.pendentes.length > 0 && (
          <a className="btn btn-ghost" href={mailto}>Cobrar por e-mail ({sit.pendentes.length})</a>
        )}
        <button className="btn btn-ghost" onClick={() => setAberto((v) => !v)}>
          {aberto ? 'Ocultar peças' : `Ver as ${sit.total} peças`}
        </button>
        {podeCadastrar && <button className="btn btn-ghost" onClick={onEditar}>Editar</button>}
        {podeCadastrar && <button className="btn btn-ghost perigo" onClick={onRemover}>Apagar</button>}
      </div>

      {aberto && (
        <ul className="pecas-lista">
          {sit.apoio.map((e) => (
            <li key={e.protocolo} className="entregue">
              <span className="marca" aria-hidden>↓</span>
              <div>
                <strong>{e.pecaRotulo || e.arquivo?.nome || 'Arquivo de apoio'}</strong>
                <em className="dica-campo"> · logo, fonte ou referência</em>
                <p className="dica-campo">
                  {e.arquivo?.nome} · {e.protocolo}
                  {e.link && <> · <a href={e.link} download={e.arquivo?.nome} target="_blank" rel="noreferrer">baixar</a></>}
                </p>
              </div>
            </li>
          ))}
          {sit.extras.map((e) => (
            <li key={e.id} className="entregue">
              <span className="marca" aria-hidden>+</span>
              <div>
                <strong>{e.pecaRotulo || 'Peça sem nome'}</strong>
                <em className="dica-campo"> · fora da lista do projeto</em>
                <p className="dica-campo">
                  {e.peca ? `${e.peca.larguraCm} × ${e.peca.alturaCm} cm — medida informada pelo cliente · ` : ''}
                  {e.protocolo}
                  {e.link && <> · <a href={e.link} target="_blank" rel="noreferrer">baixar</a></>}
                </p>
              </div>
            </li>
          ))}
          {sit.pecas.map((s) => (
            <li key={s.peca.id} className={s.envios.length ? 'entregue' : 'pendente'}>
              <span className="marca" aria-hidden>{s.envios.length ? '✓' : '·'}</span>
              <div>
                <strong>{s.peca.rotulo}</strong>
                <em className="dica-campo">
                  {' '}{s.peca.larguraCm} × {s.peca.alturaCm} cm · {nomeDoPerfil(s.peca.perfilId)}
                  {s.peca.escalaFator > 1 && ` · escala 1:${s.peca.escalaFator}`}
                </em>
                <p className="dica-campo">
                  <span className={`tag ${s.cor}`}>{s.rotulo}</span>
                  {s.envios.length > 0 && ` · ${s.envios.length} versão(ões)`}
                  {s.envios.length > 0 && s.envios[s.envios.length - 1].link && (
                    <> · <a href={s.envios[s.envios.length - 1].link} target="_blank" rel="noreferrer">baixar a mais recente</a></>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------- importação

function Importacao({ sessao, onPronto, onCancelar }) {
  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState(null)
  const [gravando, setGravando] = useState(null)
  const [erro, setErro] = useState(null)
  const entrada = useRef(null)

  const analisar = (conteudo) => {
    setTexto(conteudo)
    setErro(null)
    setResultado(conteudo.trim() ? importarProjetos(conteudo) : null)
  }

  const lerArquivo = async (arquivo) => {
    if (!arquivo) return
    // Excel em português costuma salvar CSV em Windows-1252. Lido como UTF-8,
    // "Buddy Nutrição" vira "Buddy Nutriï¿½ï¿½o" — texto que o cliente recebe
    // no e-mail de cobrança. Testamos o UTF-8 e caímos para o latino quando ele
    // acusa byte inválido.
    const buffer = await arquivo.arrayBuffer()
    let conteudo
    try {
      conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      conteudo = new TextDecoder('windows-1252').decode(buffer)
    }
    analisar(conteudo)
  }

  const gravar = async () => {
    if (!resultado?.projetos.length) return
    setErro(null)
    setGravando({ feito: 0, total: resultado.projetos.length })
    try {
      await salvarProjetos(sessao.fb, resultado.projetos, sessao.usuario?.email,
        (feito, total) => setGravando({ feito, total }))
      await onPronto()
    } catch (e) {
      setErro(traduzirErroAuth(e, 'gravacao'))
      setGravando(null)
    }
  }

  const semEmail = resultado?.erros.filter((e) => /e-mail válido/i.test(e.mensagem)).length || 0

  return (
    <div className="cartao">
      <h2>Importar planilha</h2>
      <p className="ajuda">
        Aceita os dois formatos que a operação usa: <strong>uma linha por peça</strong>{' '}
        (recomendado) ou <strong>uma linha por stand</strong> com colunas
        “Arte A”, “Arte B”, “Arte C”. Colunas essenciais: feira, stand, e-mail e
        a descrição das peças com a medida.
      </p>
      {/*
        Esta frase existe porque a regra foi lida ao contrário na prática: o
        modelo tem três linhas do MESMO stand, e o que se entendeu foi três
        clientes com uma peça cada. Dizer "uma linha por peça" não basta — o
        que falta é como se juntam de volta.
      */}
      <p className="nota">
        <strong>Stand com várias peças: repita a linha</strong>, não crie
        colunas. Copie feira, cliente, e-mail e stand igualzinho e mude só a
        peça, o tipo e a medida — o que tem o mesmo stand na mesma feira vira um
        projeto só, com todas as peças. Deixe a coluna <em>escala</em> vazia
        quando a arte é em tamanho real.
      </p>

      <div className="acoes">
        <button className="btn btn-ghost" onClick={() => entrada.current?.click()}>Escolher arquivo CSV</button>
        <button
          className="btn btn-ghost"
          onClick={() => baixarTexto('modelo-projetos.csv', '﻿' + MODELO_CSV, 'text/csv;charset=utf-8')}
        >
          Baixar planilha modelo
        </button>
        <input
          ref={entrada} type="file" accept=".csv,text/csv,text/plain" hidden
          onChange={(e) => lerArquivo(e.target.files?.[0])}
        />
      </div>

      <label className="campo">
        <span>…ou cole aqui o conteúdo da planilha</span>
        <textarea
          rows={6} value={texto} onChange={(e) => analisar(e.target.value)}
          placeholder={'feira;cliente;email;stand;peca;medida\nExpo 2026;Buddy;ana@buddy.com;Buddy;Lona de fundo;275x275'}
        />
      </label>

      {resultado && (
        <div className="previa-importacao">
          <p className="ajuda">
            Formato lido: <strong>{resultado.formato}</strong> · separador{' '}
            <code>{resultado.separador === '\t' ? 'tabulação' : resultado.separador}</code> ·{' '}
            <strong>{resultado.projetos.length}</strong> stands ·{' '}
            <strong>{resultado.projetos.reduce((s, p) => s + p.pecas.length, 0)}</strong> peças
          </p>

          {resultado.erros.length > 0 && (
            <div className="bloco-erros">
              <strong>{resultado.erros.length} linha(s) com problema — o resto pode ser importado assim mesmo:</strong>
              <ul>
                {resultado.erros.slice(0, 12).map((e, i) => (
                  <li key={i}>Linha {e.linha}: {e.mensagem}</li>
                ))}
                {resultado.erros.length > 12 && <li>…e mais {resultado.erros.length - 12}.</li>}
              </ul>
            </div>
          )}

          {resultado.avisos.length > 0 && (
            <div className="bloco-avisos">
              <strong>Confira antes de cadastrar:</strong>
              <ul>
                {resultado.avisos.slice(0, 8).map((a, i) => <li key={i}>Linha {a.linha}: {a.mensagem}</li>)}
                {resultado.avisos.length > 8 && <li>…e mais {resultado.avisos.length - 8}.</li>}
              </ul>
            </div>
          )}

          {resultado.projetos.length > 0 && (
            <div className="tabela-rolagem">
              <table className="envios">
                <thead><tr><th>Stand</th><th>Cliente</th><th>E-mail</th><th>Peças</th></tr></thead>
                <tbody>
                  {resultado.projetos.slice(0, 30).map((p) => (
                    <tr key={p.token}>
                      <td>{p.stand}</td>
                      <td>{p.expositor}</td>
                      <td>{p.email || <em className="erro-campo">faltando</em>}</td>
                      <td>
                        {p.pecas.map((peca) => (
                          <div key={peca.id}>
                            {peca.rotulo} <em className="dica-campo">{peca.larguraCm} × {peca.alturaCm} cm · {nomeDoPerfil(peca.perfilId)}</em>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {resultado.projetos.length > 30 && (
                <p className="nota">Mostrando os 30 primeiros de {resultado.projetos.length}.</p>
              )}
            </div>
          )}
        </div>
      )}

      {erro && <p className="erro-envio">{erro}</p>}
      {semEmail > 0 && (
        <p className="nota">
          {semEmail} stand(s) estão sem e-mail válido. Eles podem ser cadastrados,
          mas o link de cobrança por e-mail só funciona depois de você corrigir o
          endereço em <strong>Editar</strong>.
        </p>
      )}

      <div className="acoes">
        <button className="btn" disabled={!resultado?.projetos.length || Boolean(gravando)} onClick={gravar}>
          {gravando
            ? `Cadastrando ${gravando.feito} de ${gravando.total}…`
            : `Cadastrar ${resultado?.projetos.length || 0} projeto(s)`}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

// -------------------------------------------------------- cadastro manual

/**
 * Gabarito próprio da peça: arquivo ou link.
 *
 * Os dois existem porque a operação tem os dois casos. Às vezes o desenho está
 * num PDF que o projetista acabou de exportar — sobe o arquivo. Às vezes ele
 * já vive numa pasta do Drive versionada, e copiar para cá criaria uma segunda
 * cópia que envelhece sozinha — cola o link.
 */
function EditorGabarito({ sessao, feira, stand, peca, onMudar }) {
  const [enviando, setEnviando] = useState(null)
  const [erro, setErro] = useState(null)
  const entrada = useRef(null)
  const gabarito = peca.gabarito

  const subir = async (arquivo) => {
    if (!arquivo) return
    setErro(null)
    setEnviando(0)
    try {
      const r = await enviarGabarito(
        arquivo,
        { feiraId: idDeFeira(feira), stand: stand || 'stand', peca: peca.rotulo },
        setEnviando,
      )
      onMudar({ tipo: 'arquivo', url: r.arquivo.link, nome: r.arquivo.nome })
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar o gabarito.')
    } finally {
      setEnviando(null)
      if (entrada.current) entrada.current.value = ''
    }
  }

  return (
    <div className="gabarito-editor">
      <div className="linha">
        <label className="campo cresce">
          <span>Gabarito próprio <em className="opcional">(opcional — sem isto, a ferramenta gera um)</em></span>
          <input
            type="url"
            value={gabarito?.tipo === 'link' ? gabarito.url : ''}
            disabled={gabarito?.tipo === 'arquivo'}
            placeholder={gabarito?.tipo === 'arquivo' ? gabarito.nome : 'cole um link, ou envie um arquivo →'}
            onChange={(e) => onMudar(e.target.value.trim() ? { tipo: 'link', url: e.target.value, nome: 'Gabarito do projeto' } : null)}
          />
        </label>
        <div className="acoes">
          <input
            ref={entrada} type="file" hidden
            accept={EXTENSOES_GABARITO.map((x) => `.${x}`).join(',')}
            onChange={(e) => subir(e.target.files?.[0])}
          />
          <button className="btn btn-ghost" type="button" disabled={enviando !== null} onClick={() => entrada.current?.click()}>
            {enviando !== null ? `Enviando… ${Math.round(enviando * 100)}%` : 'Enviar arquivo'}
          </button>
          {gabarito && (
            <button className="btn btn-ghost perigo" type="button" onClick={() => onMudar(null)}>
              Remover
            </button>
          )}
        </div>
      </div>
      {gabarito?.tipo === 'arquivo' && (
        <em className="dica-campo">
          ✓ <a href={gabarito.url} target="_blank" rel="noreferrer">{gabarito.nome}</a> — é este que o cliente vai abrir.
        </em>
      )}
      {gabarito?.tipo === 'link' && (
        <em className="dica-campo">O cliente abre este link no lugar do gabarito gerado.</em>
      )}
      {erro && <em className="erro-campo">{erro}</em>}
    </div>
  )
}

function FormularioProjeto({ sessao, inicial, onSalvar, onCancelar }) {
  const [dados, setDados] = useState(() => projetoNovo(inicial))
  const [erros, setErros] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [falha, setFalha] = useState(null)

  const alterar = (campo, valor) => setDados((d) => ({ ...d, [campo]: valor }))
  const alterarPeca = (i, mudanca) => setDados((d) => ({
    ...d,
    pecas: d.pecas.map((p, j) => (j === i ? { ...p, ...mudanca } : p)),
  }))

  const enviar = async (e) => {
    e.preventDefault()
    const { valido, erros: novos } = validarProjeto(dados)
    setErros(novos)
    if (!valido) return
    setSalvando(true)
    setFalha(null)
    try {
      await onSalvar(dados)
    } catch (erro) {
      setFalha(traduzirErroAuth(erro, 'gravacao'))
      setSalvando(false)
    }
  }

  return (
    <form className="cartao" onSubmit={enviar} noValidate>
      <h2>{inicial?.pecas?.length ? 'Editar projeto' : 'Novo projeto'}</h2>

      <div className="linha">
        <label className="campo">
          <span>Feira</span>
          <input type="text" value={dados.feira} onChange={(e) => alterar('feira', e.target.value)} />
          {erros.feira && <em className="erro-campo">{erros.feira}</em>}
        </label>
        <label className="campo">
          <span>Cliente / expositor</span>
          <input type="text" value={dados.expositor} onChange={(e) => alterar('expositor', e.target.value)} />
          {erros.expositor && <em className="erro-campo">{erros.expositor}</em>}
        </label>
      </div>

      <div className="linha">
        <label className="campo">
          <span>Nome do stand</span>
          <input type="text" value={dados.stand} onChange={(e) => alterar('stand', e.target.value)} />
          {erros.stand && <em className="erro-campo">{erros.stand}</em>}
        </label>
        <label className="campo">
          <span>E-mails do cliente</span>
          <input
            type="text"
            value={(dados.emails?.length ? dados.emails : [dados.email].filter(Boolean)).join('; ')}
            onChange={(e) => {
              const lista = listaDeEmails(e.target.value)
              setDados((d) => ({ ...d, emails: lista, email: lista[0] || e.target.value.trim() }))
            }}
            placeholder="ana@cliente.com; agencia@parceira.com"
          />
          {erros.email
            ? <em className="erro-campo">{erros.email}</em>
            : (
              <em className="dica-campo">
                Separe por ponto e vírgula. Decisão de arte raramente é de uma
                pessoa só — a cobrança vai para todos.
              </em>
            )}
        </label>
      </div>

      <label className="campo">
        <span>Localização do stand <em className="opcional">(opcional)</em></span>
        <input type="text" value={dados.localizacao} onChange={(e) => alterar('localizacao', e.target.value)} placeholder="rua, número, pavilhão" />
      </label>

      <label className="campo">
        <span>Link da pasta do projeto no Drive <em className="opcional">(opcional)</em></span>
        <input
          type="url" value={dados.linkDrive}
          onChange={(e) => alterar('linkDrive', e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
        />
        <em className="dica-campo">
          Aparece em destaque na tela do cliente. Confira se a pasta está
          compartilhada — o cliente abre sem login na nossa ferramenta, mas o
          Drive tem as permissões dele.
        </em>
      </label>

      <h3>Peças do stand</h3>
      {erros.pecas && <p className="erro-campo">{erros.pecas}</p>}

      <ListaDePecas
        pecas={dados.pecas}
        onMudar={(pecas) => setDados((d) => ({ ...d, pecas }))}
        erros={erros}
        Gabarito={({ peca, onMudar }) => (
          <EditorGabarito
            sessao={sessao}
            feira={dados.feira}
            stand={dados.stand}
            peca={peca}
            onMudar={onMudar}
          />
        )}
      />

      <label className="alternador">
        <input
          type="checkbox" checked={dados.aceitaAvulsos !== false}
          onChange={(e) => alterar('aceitaAvulsos', e.target.checked)}
        />
        <span>Aceitar arquivos de apoio (logo, fontes, manual de marca)</span>
      </label>

      {falha && <p className="erro-envio">{falha}</p>}

      <div className="acoes">
        <button className="btn" type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar projeto'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  )
}
