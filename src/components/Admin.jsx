import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { traduzirErroAuth } from '../services/sessao.js'
import { enviarProva, EXTENSOES_PROVA } from '../services/envio.js'
import { registrarProva, ouvirEnvios, arquivarEnvio, marcarConferido } from '../services/projetos.js'
import { conferenciaPendente } from '../core/regras.js'
import { vistoEm, marcarVisto, dataEmMs, assinarVisto } from '../store/visto.js'
import { feirasVisiveis } from '../core/permissoes.js'
import { formatarDataHora as fmtData } from '../core/datas.js'

// Artes recebidas: escolhe a feira, vê o que chegou e baixa.
//
// A autenticação não mora mais aqui — quem cuida disso é `Acesso.jsx`, que
// envolve as três telas internas. Esta só recebe a sessão já liberada.

const ROTULO = { aprovado: 'Aprovada', ressalva: 'Com ressalva', reprovado: 'Reprovada' }
const fmtMb = (n) => (Number.isFinite(n) ? `${(n / 1048576).toFixed(1)} MB` : '—')

// Baixar vários arquivos grandes de uma vez: o navegador não zipa nada (seria
// preciso carregar centenas de MB na memória), então disparamos um download
// por vez, espaçados. O Chrome pergunta uma vez se aceita vários e depois
// libera o resto.
async function baixarEmLote(itens, aoProgredir) {
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i]
    if (!item.link) continue
    const a = document.createElement('a')
    a.href = item.link
    a.download = item.nomeSugerido || ''
    a.target = '_blank'
    a.rel = 'noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    aoProgredir?.(i + 1, itens.length)
    await new Promise((r) => setTimeout(r, 900))
  }
}

function paraCsv(envios) {
  const cabecalho = ['Protocolo', 'Tipo', 'Expositor', 'E-mail', 'Stand', 'Localizacao', 'Peca', 'Largura_cm', 'Altura_cm', 'Veredicto', 'Risco_aceito', 'Enviado_em', 'Arquivo', 'Link']
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const linhas = envios.map((e) => [
    e.protocolo, e.tipoEnvio === 'avulso' ? 'apoio' : 'arte',
    e.cadastro?.nome, e.cadastro?.email, e.cadastro?.stand, e.cadastro?.localizacao,
    e.pecaRotulo || e.perfil?.nome, e.peca?.larguraCm, e.peca?.alturaCm,
    ROTULO[e.veredicto] || e.veredicto || '—',
    e.riscoAceito ? 'sim' : 'nao', fmtData(e.criadoEm), e.arquivo?.nome, e.link,
  ].map(escapar).join(';'))
  // BOM para o Excel abrir os acentos corretamente
  return '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n')
}

export function baixarTexto(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/**
 * Seletor de feira compartilhado pelas telas internas.
 *
 * `acesso` recorta a lista: um analista atribuído a duas feiras não deve nem
 * enxergar a terceira no seletor. Filtrar aqui, num lugar só, é o que impede a
 * lista completa de vazar por uma tela que alguém esqueceu de tratar.
 */
export function usarFeiras(fb, acesso, inicial = '') {
  const [feiras, setFeiras] = useState([])
  const [feiraId, setFeiraId] = useState('')
  const [erro, setErro] = useState(null)

  const recarregar = useCallback(async (selecionar) => {
    if (!fb) return
    try {
      const { getFirestore, collection, getDocs } = fb.firestore
      const snap = await getDocs(collection(getFirestore(fb.app), 'feiras'))
      const lista = feirasVisiveis(acesso, snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.atualizadaEm?.seconds || 0) - (a.atualizadaEm?.seconds || 0)))
      setFeiras(lista)
      // `inicial` só vale se a feira existir e a pessoa alcançar: um atalho
      // colado de outra feira não pode deixar a tela apontando para o vazio.
      const pedida = lista.some((f) => f.id === inicial) ? inicial : ''
      // A seleção atual só vale enquanto a feira existir. Sem esta conferência,
      // apagar a feira aberta deixa a tela apontando para um id que não existe
      // mais: seletor em branco, nenhum stand e nenhuma explicação. Vale também
      // para o dia em que alguém perder o acesso a uma feira.
      setFeiraId((atual) => {
        const valida = lista.some((f) => f.id === atual) ? atual : ''
        return selecionar || valida || pedida || lista[0]?.id || ''
      })
    } catch (e) {
      setErro(traduzirErroAuth(e))
    }
  }, [fb, acesso, inicial])

  useEffect(() => { recarregar() }, [recarregar])

  const feira = feiras.find((f) => f.id === feiraId) || null
  return { feiras, feira, feiraId, setFeiraId, recarregar, erro }
}

/**
 * Atalho para mandar a prova de aprovação desta arte ao cliente.
 *
 * Cobre só ESTA peça, de propósito: é o caminho de quem acabou de conferir um
 * arquivo e quer fechar o ciclo sem sair da lista. A prova que cobre várias
 * peças de uma vez — o mockup do stand inteiro — está em Projetos → Abrir, que
 * é onde o analista tem as peças todas à vista para escolher.
 */
function BotaoProva({ envio, sessao }) {
  const [estado, setEstado] = useState('parado') // parado | enviando | pronto | erro
  const [erro, setErro] = useState(null)
  const entrada = useRef(null)

  if (envio.tipoEnvio === 'avulso') return <em className="dica-campo">—</em>
  if (!envio.projetoId || !envio.pecaId) {
    return <em className="dica-campo" title="A prova depende de um projeto cadastrado">sem projeto</em>
  }

  const enviar = async (arquivo) => {
    if (!arquivo) return
    setEstado('enviando')
    setErro(null)
    try {
      const prova = await enviarProva(
        arquivo,
        { feiraId: envio.feiraId, stand: envio.cadastro?.stand || 'stand' },
        () => {},
      )
      await registrarProva(sessao.fb, envio.projetoId, {
        id: prova.id,
        arquivo: prova.arquivo,
        pecaIds: [envio.pecaId],
        versoes: { [envio.pecaId]: envio.versao || 1 },
        observacao: '',
        por: sessao.usuario?.email,
      })
      setEstado('pronto')
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar a prova.')
      setEstado('erro')
    } finally {
      if (entrada.current) entrada.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={entrada} type="file" hidden
        accept={EXTENSOES_PROVA.map((x) => `.${x}`).join(',')}
        onChange={(e) => enviar(e.target.files?.[0])}
      />
      <button
        className="link"
        disabled={estado === 'enviando'}
        onClick={() => entrada.current?.click()}
      >
        {estado === 'enviando' ? 'enviando…' : estado === 'pronto' ? '✓ prova enviada' : 'enviar prova'}
      </button>
      {estado === 'pronto' && <><br /><em className="dica-campo">avise o cliente por e-mail</em></>}
      {erro && <><br /><em className="erro-campo">{erro}</em></>}
    </>
  )
}

export default function Admin({ sessao }) {
  const { fb } = sessao
  const { feiras, feiraId, setFeiraId, erro: erroFeiras } = usarFeiras(fb, sessao.acesso)
  const [envios, setEnvios] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [tipo, setTipo] = useState('todos') // todos | arte | avulso
  const [baixando, setBaixando] = useState(null)
  const [erro, setErro] = useState(null)

  // Escuta em vez de buscar: arte que chega enquanto o analista está com a
  // tela aberta aparece sozinha. A consulta filtra por feira no servidor e
  // ORDENA aqui, de propósito — combinar `where` com `orderBy` exigiria um
  // índice composto, que só nasce por linha de comando ou por um link escondido
  // dentro de uma mensagem de erro.
  const [marca, setMarca] = useState(0)
  const [mostrarArquivados, setMostrarArquivados] = useState(false)
  useEffect(() => {
    if (!fb || !feiraId) { setEnvios([]); return undefined }
    setBuscando(true)
    setErro(null)
    // A marca é lida UMA vez por feira, antes da escuta: se fosse relida a cada
    // atualização, o contador zeraria no mesmo instante em que acendesse.
    setMarca(vistoEm(sessao.usuario?.email, `envios:${feiraId}`))
    const parar = ouvirEnvios(fb, feiraId, (lista) => {
      setEnvios(lista)
      setBuscando(false)
    }, (e) => { setErro(traduzirErroAuth(e)); setBuscando(false) })
    return () => parar()
  }, [fb, feiraId, sessao.usuario?.email])

  // Se a marca for atualizada em outra tela (ou em outra aba do navegador), o
  // contador daqui acompanha sem recarregar.
  useEffect(() => assinarVisto(
    () => setMarca(vistoEm(sessao.usuario?.email, `envios:${feiraId}`)),
  ), [sessao.usuario?.email, feiraId])

  const novos = useMemo(
    () => envios.filter((e) => dataEmMs(e.criadoEm) > marca).length,
    [envios, marca],
  )

  const arquivados = useMemo(() => envios.filter((e) => e.arquivado).length, [envios])

  // Artes que a ferramenta NÃO CONSEGUIU abrir e ninguém olhou ainda.
  //
  // É a fila que faltava. O laudo dessas artes já prometia "nossa equipe vai
  // olhar manualmente", e a promessa dependia de alguém reparar numa ressalva
  // no meio de uma lista de cinquenta linhas. Não são raras: 300 dpi numa
  // parede grande dá uma imagem que nenhum navegador abre, então é a arte BEM
  // feita que cai aqui.
  const semConferir = useMemo(
    () => envios.filter((e) => !e.arquivado && conferenciaPendente(e)),
    [envios],
  )
  const [soSemConferir, setSoSemConferir] = useState(false)

  const visiveis = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    // `tipoEnvio` só existe nos registros novos: envio antigo sem o campo é
    // arte, que é tudo o que existia antes de os arquivos de apoio nascerem.
    const ehApoio = (e) => e.tipoEnvio === 'avulso'
    return envios
      .filter((e) => !soSemConferir || conferenciaPendente(e))
      .filter((e) => mostrarArquivados || !e.arquivado)
      .filter((e) => tipo === 'todos' || (tipo === 'avulso' ? ehApoio(e) : !ehApoio(e)))
      .filter((e) => !t || [
        e.cadastro?.nome, e.cadastro?.email, e.cadastro?.stand, e.cadastro?.localizacao,
        e.pecaRotulo, e.perfil?.nome, e.protocolo, e.arquivo?.nome,
      ].some((v) => String(v || '').toLowerCase().includes(t)))
  }, [envios, filtro, tipo, mostrarArquivados, soSemConferir])

  const totalApoio = useMemo(() => envios.filter((e) => e.tipoEnvio === 'avulso').length, [envios])

  const nomeDaFeira = feiras.find((f) => f.id === feiraId)?.nome || feiraId

  const marcarTudoVisto = useCallback(() => {
    const maisNovo = envios.reduce((m, e) => Math.max(m, dataEmMs(e.criadoEm)), 0)
    marcarVisto(sessao.usuario?.email, `envios:${feiraId}`, maisNovo || Date.now())
  }, [envios, feiraId, sessao.usuario?.email])

  /**
   * Estar com a lista na tela É ter visto.
   *
   * Antes disso a marcação só acontecia num clique em "marcar como visto", e o
   * contador ficava aceso mesmo depois de o analista olhar a tela inteira —
   * que é o oposto do que uma bolinha de aviso deve fazer. A marca só é
   * gravada com a lista já carregada e não vazia: marcar durante o
   * carregamento apagaria o aviso de arte que ainda nem apareceu.
   *
   * A leitura de `marca` continua sendo feita UMA vez por feira, antes da
   * escuta, senão o contador zeraria no mesmo instante em que acendesse.
   */
  useEffect(() => {
    if (buscando || !envios.length) return undefined
    const relogio = setTimeout(marcarTudoVisto, 1200)
    return () => clearTimeout(relogio)
  }, [buscando, envios, marcarTudoVisto])

  /**
   * O que chegou nas OUTRAS feiras que este analista alcança.
   *
   * O contador da aba soma todas as feiras, mas a marca é por feira — então,
   * sem isto, arte nova numa feira que ninguém abriu deixava a bolinha acesa
   * para sempre, e o analista não tinha como descobrir de onde vinha o número.
   */
  const [novosDeOutras, setNovosDeOutras] = useState(0)
  useEffect(() => {
    if (!fb || feiras.length < 2) { setNovosDeOutras(0); return undefined }
    const { getFirestore, collection, query, where, onSnapshot } = fb.firestore
    const outras = feiras.map((f) => f.id).filter((id) => id !== feiraId).slice(0, 30)
    if (!outras.length) { setNovosDeOutras(0); return undefined }
    return onSnapshot(
      query(collection(getFirestore(fb.app), 'envios'), where('feiraId', 'in', outras)),
      (snap) => setNovosDeOutras(snap.docs.filter((d) => {
        const e = d.data()
        return dataEmMs(e.criadoEm) > vistoEm(sessao.usuario?.email, `envios:${e.feiraId}`)
      }).length),
      () => setNovosDeOutras(0),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, feiras, feiraId, sessao.usuario?.email, marca])

  const marcarOutrasVistas = () => {
    for (const f of feiras) {
      if (f.id !== feiraId) marcarVisto(sessao.usuario?.email, `envios:${f.id}`, Date.now())
    }
    setNovosDeOutras(0)
  }

  const baixarTodas = async () => {
    const comArquivo = visiveis.filter((e) => e.link)
    if (!comArquivo.length) return
    setBaixando({ feito: 0, total: comArquivo.length })
    await baixarEmLote(
      comArquivo.map((e) => ({ link: e.link, nomeSugerido: e.arquivo?.nome })),
      (feito, total) => setBaixando({ feito, total }),
    )
    setBaixando(null)
  }

  const porVeredicto = (v) => visiveis.filter((e) => e.veredicto === v).length
  const totalMb = visiveis.reduce((s, e) => s + (e.arquivo?.tamanho || 0), 0)
  const mensagemErro = erro || erroFeiras

  return (
    <>
      <div className="cartao">
        <div className="titulo-secao">
          <h2>Artes recebidas</h2>
          <span className="dica-campo ao-vivo">ao vivo</span>
        </div>

        {novos > 0 && (
          <div className="faixa-novidade">
            <strong>{novos} {novos === 1 ? 'arquivo novo' : 'arquivos novos'}</strong> desde a sua última visita.
            <em className="dica-campo">marcado como visto automaticamente</em>
          </div>
        )}

        {semConferir.length > 0 && (
          <div className="faixa-novidade conferir">
            <strong>
              {semConferir.length === 1
                ? '1 arte que a ferramenta não conseguiu abrir'
                : `${semConferir.length} artes que a ferramenta não conseguiu abrir`}
            </strong>{' '}
            — os dados técnicos foram conferidos, a aparência não. Precisam de
            olho humano antes de imprimir.
            <button className="link" onClick={() => setSoSemConferir((v) => !v)}>
              {soSemConferir ? 'ver todas de novo' : 'ver só essas'}
            </button>
          </div>
        )}

        {arquivados > 0 && (
          <label className="alternador">
            <input
              type="checkbox" checked={mostrarArquivados}
              onChange={(ev) => setMostrarArquivados(ev.target.checked)}
            />
            <span>Mostrar os {arquivados} arquivados</span>
          </label>
        )}

        {novosDeOutras > 0 && (
          <div className="faixa-novidade outras">
            <strong>{novosDeOutras}</strong> {novosDeOutras === 1 ? 'arquivo novo' : 'arquivos novos'}{' '}
            em outras feiras — é o que mantém a bolinha da aba acesa.
            <button className="link" onClick={marcarOutrasVistas}>marcar todas como vistas</button>
          </div>
        )}

        <div className="linha">
          <label className="campo">
            <span>Feira</span>
            <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
              {!feiras.length && <option value="">Nenhuma feira cadastrada ainda</option>}
              {feiras.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Filtrar por expositor, stand, peça ou arquivo</span>
            <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="digite para filtrar" />
          </label>
          <label className="campo">
            <span>Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="todos">Tudo</option>
              <option value="arte">Só artes de peça</option>
              <option value="avulso">Só arquivos de apoio{totalApoio ? ` (${totalApoio})` : ''}</option>
            </select>
          </label>
        </div>

        {mensagemErro && <p className="erro-envio">{mensagemErro}</p>}

        {visiveis.length > 0 && (
          <>
            <p className="ajuda resumo-admin">
              <strong>{visiveis.length}</strong> arquivos de{' '}
              <strong>{new Set(visiveis.map((e) => e.cadastro?.email)).size}</strong> expositores ·{' '}
              {porVeredicto('aprovado')} aprovadas · {porVeredicto('ressalva')} com ressalva ·{' '}
              {fmtMb(totalMb)} no total
            </p>

            <div className="acoes">
              <button className="btn" onClick={baixarTodas} disabled={Boolean(baixando)}>
                {baixando
                  ? `Baixando ${baixando.feito} de ${baixando.total}…`
                  : `Baixar os ${visiveis.length} arquivos`}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => baixarTexto(`artes-${feiraId}.csv`, paraCsv(visiveis), 'text/csv;charset=utf-8')}
              >
                Exportar planilha (CSV)
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => baixarTexto(
                  `links-${feiraId}.txt`,
                  visiveis.map((e) => `${e.cadastro?.stand} — ${e.pecaRotulo || e.perfil?.nome}\n${e.link}\n`).join('\n'),
                  'text/plain;charset=utf-8',
                )}
              >
                Baixar lista de links
              </button>
            </div>
            <p className="nota">
              O navegador vai pedir permissão para baixar vários arquivos —
              aceite uma vez e o resto segue sozinho. Os arquivos caem na pasta
              de downloads com o nome original enviado pelo expositor.
            </p>
          </>
        )}
      </div>

      <div className="cartao">
        {buscando && <p className="ajuda">Buscando…</p>}
        {!buscando && !envios.length && (
          <p className="ajuda">Nenhuma arte enviada para {nomeDaFeira || 'esta feira'} ainda.</p>
        )}
        {!buscando && envios.length > 0 && !visiveis.length && (
          <p className="ajuda">Nenhum resultado para “{filtro}”.</p>
        )}
        {visiveis.length > 0 && (
          <div className="tabela-rolagem">
            <table className="envios">
              <thead>
                <tr>
                  <th>Expositor</th>
                  <th>Stand</th>
                  <th>Peça</th>
                  <th>Resultado</th>
                  <th>Enviada em</th>
                  <th>Arquivo</th>
                  <th>Prova de aprovação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((e) => (
                  <tr key={e.id} className={`${dataEmMs(e.criadoEm) > marca ? 'linha-nova' : ''} ${e.arquivado ? 'linha-arquivada' : ''}`}>
                    <td>
                      <strong>{e.cadastro?.nome}</strong>
                      <br />
                      <a href={`mailto:${e.cadastro?.email}`}>{e.cadastro?.email}</a>
                    </td>
                    <td>
                      {e.cadastro?.stand}
                      {e.cadastro?.localizacao && <><br /><em className="dica-campo">{e.cadastro.localizacao}</em></>}
                    </td>
                    <td>
                      {e.pecaRotulo || e.perfil?.nome}
                      {e.peca && <><br /><em className="dica-campo">{e.peca.larguraCm} × {e.peca.alturaCm} cm</em></>}
                    </td>
                    <td>
                      {e.tipoEnvio === 'avulso'
                        ? <span className="tag apoio">Arquivo de apoio</span>
                        : <span className={`tag ${e.veredicto}`}>{ROTULO[e.veredicto] || e.veredicto}</span>}
                      {e.riscoAceito && <><br /><em className="dica-campo">risco aceito</em></>}
                      {conferenciaPendente(e) && (
                        <><br /><strong className="destaque-pendencia">não conferida</strong></>
                      )}
                    </td>
                    <td>{fmtData(e.criadoEm)}</td>
                    <td>
                      {e.link
                        ? <a href={e.link} download={e.arquivo?.nome} target="_blank" rel="noreferrer">Baixar</a>
                        : <em className="dica-campo">—</em>}
                      <br />
                      <em className="dica-campo">{fmtMb(e.arquivo?.tamanho)} · {e.protocolo}</em>
                    </td>
                    <td>
                      <BotaoProva envio={e} sessao={sessao} />
                    </td>
                    <td>
                      {conferenciaPendente(e) && (
                        <>
                          <button
                            className="link perigo"
                            title="Registra que uma pessoa olhou esta arte — a ferramenta não conseguiu abri-la"
                            onClick={() => marcarConferido(sessao.fb, e.protocolo, sessao.usuario?.email)
                              .catch((erro) => setErro(traduzirErroAuth(erro, 'gravacao')))}
                          >
                            conferi esta arte
                          </button>
                          <br />
                        </>
                      )}
                      {e.conferencia?.em && (
                        <>
                          <em className="dica-campo" title={`Conferida por ${e.conferencia.por || 'alguém do time'}`}>
                            conferida à mão
                          </em>
                          <br />
                        </>
                      )}
                      <button
                        className="link"
                        title={e.arquivado
                          ? 'Volta a aparecer na lista'
                          : 'Tira da lista sem apagar o registro — para quando o arquivo já saiu do armazenamento'}
                        onClick={() => arquivarEnvio(sessao.fb, e.protocolo, sessao.usuario?.email, !e.arquivado)
                          .catch((erro) => setErro(traduzirErroAuth(erro, 'gravacao')))}
                      >
                        {e.arquivado ? 'restaurar' : 'arquivar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
