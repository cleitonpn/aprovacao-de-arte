import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { traduzirErroAuth } from '../services/sessao.js'
import { enviarProva, EXTENSOES_PROVA } from '../services/envio.js'
import { registrarProva } from '../services/projetos.js'

// Artes recebidas: escolhe a feira, vê o que chegou e baixa.
//
// A autenticação não mora mais aqui — quem cuida disso é `Acesso.jsx`, que
// envolve as três telas internas. Esta só recebe a sessão já liberada.

const ROTULO = { aprovado: 'Aprovada', ressalva: 'Com ressalva', reprovado: 'Reprovada' }
const fmtData = (t) => (t?.seconds ? new Date(t.seconds * 1000).toLocaleString('pt-BR') : '—')
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

/** Seletor de feira compartilhado pelas telas internas. */
export function usarFeiras(fb) {
  const [feiras, setFeiras] = useState([])
  const [feiraId, setFeiraId] = useState('')
  const [erro, setErro] = useState(null)

  useEffect(() => {
    if (!fb) return
    const { getFirestore, collection, getDocs } = fb.firestore
    getDocs(collection(getFirestore(fb.app), 'feiras'))
      .then((snap) => {
        const lista = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.atualizadaEm?.seconds || 0) - (a.atualizadaEm?.seconds || 0))
        setFeiras(lista)
        setFeiraId((atual) => atual || lista[0]?.id || '')
      })
      .catch((e) => setErro(traduzirErroAuth(e)))
  }, [fb])

  return { feiras, feiraId, setFeiraId, erro }
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
  const { feiras, feiraId, setFeiraId, erro: erroFeiras } = usarFeiras(fb)
  const [envios, setEnvios] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [baixando, setBaixando] = useState(null)
  const [erro, setErro] = useState(null)

  const buscar = useCallback(async () => {
    if (!fb || !feiraId) { setEnvios([]); return }
    setBuscando(true)
    setErro(null)
    try {
      // Filtra por feira no servidor, mas ORDENA aqui no navegador de
      // propósito. Combinar `where` com `orderBy` exigiria um índice composto
      // no Firestore — que só nasce rodando `firebase deploy` ou clicando num
      // link escondido no console do navegador. Como cada feira tem dezenas ou
      // poucas centenas de envios, ordenar em memória custa nada e poupa a
      // operação de um erro incompreensível no primeiro acesso.
      const { getFirestore, collection, getDocs, query, where } = fb.firestore
      const snap = await getDocs(query(
        collection(getFirestore(fb.app), 'envios'),
        where('feiraId', '==', feiraId),
      ))
      setEnvios(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0)),
      )
    } catch (e) {
      setErro(traduzirErroAuth(e))
    } finally {
      setBuscando(false)
    }
  }, [fb, feiraId])

  useEffect(() => { buscar() }, [buscar])

  const visiveis = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    if (!t) return envios
    return envios.filter((e) => [
      e.cadastro?.nome, e.cadastro?.email, e.cadastro?.stand, e.cadastro?.localizacao,
      e.pecaRotulo, e.perfil?.nome, e.protocolo,
    ].some((v) => String(v || '').toLowerCase().includes(t)))
  }, [envios, filtro])

  const nomeDaFeira = feiras.find((f) => f.id === feiraId)?.nome || feiraId

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
        <h2>Artes recebidas</h2>

        <div className="linha">
          <label className="campo">
            <span>Feira</span>
            <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
              {!feiras.length && <option value="">Nenhuma feira cadastrada ainda</option>}
              {feiras.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Filtrar por expositor, stand ou peça</span>
            <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="digite para filtrar" />
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
                </tr>
              </thead>
              <tbody>
                {visiveis.map((e) => (
                  <tr key={e.id}>
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
