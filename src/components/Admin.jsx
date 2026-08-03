import { useCallback, useEffect, useMemo, useState } from 'react'
import { firebaseConfigurado } from '../config.js'
import { carregarFirebase } from '../services/firebase.js'

// Painel do time de comunicação visual: escolhe a feira, vê quem já enviou e
// baixa as artes.
//
// Quem entra aqui precisa estar autenticado E constar na coleção `admins` do
// Firestore (ver firestore.rules). O expositor que envia arte não faz login
// nenhum — só esta tela exige.

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
  const cabecalho = ['Protocolo', 'Expositor', 'E-mail', 'Stand', 'Localizacao', 'Peca', 'Largura_cm', 'Altura_cm', 'Veredicto', 'Risco_aceito', 'Enviado_em', 'Arquivo', 'Link']
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const linhas = envios.map((e) => [
    e.protocolo, e.cadastro?.nome, e.cadastro?.email, e.cadastro?.stand, e.cadastro?.localizacao,
    e.perfil?.nome, e.peca?.larguraCm, e.peca?.alturaCm, ROTULO[e.veredicto] || e.veredicto,
    e.riscoAceito ? 'sim' : 'nao', fmtData(e.criadoEm), e.arquivo?.nome, e.link,
  ].map(escapar).join(';'))
  // BOM para o Excel abrir os acentos corretamente
  return '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n')
}

function baixarTexto(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function Admin() {
  const [fb, setFb] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  const [feiras, setFeiras] = useState([])
  const [feiraId, setFeiraId] = useState('')
  const [envios, setEnvios] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [baixando, setBaixando] = useState(null)

  useEffect(() => {
    if (!firebaseConfigurado()) { setCarregando(false); return }
    let vivo = true
    let cancelar = null
    carregarFirebase()
      .then((mod) => {
        if (!vivo) return
        setFb(mod)
        const autenticacao = mod.auth.getAuth(mod.app)
        cancelar = mod.auth.onAuthStateChanged(autenticacao, (u) => {
          if (!vivo) return
          // Sessões anônimas (do envio) não valem como acesso ao painel.
          setUsuario(u && !u.isAnonymous ? u : null)
          setCarregando(false)
        })
      })
      .catch((e) => { if (vivo) { setErro(e.message); setCarregando(false) } })
    return () => { vivo = false; cancelar?.() }
  }, [])

  const entrar = async () => {
    setErro(null)
    try {
      const autenticacao = fb.auth.getAuth(fb.app)
      const provedor = new fb.auth.GoogleAuthProvider()
      provedor.setCustomParameters({ prompt: 'select_account' })
      await fb.auth.signInWithPopup(autenticacao, provedor)
    } catch (e) {
      setErro(traduzirErro(e))
    }
  }

  const sair = async () => {
    await fb.auth.signOut(fb.auth.getAuth(fb.app))
    setEnvios([])
    setFeiras([])
  }

  useEffect(() => {
    if (!fb || !usuario) return
    const { getFirestore, collection, getDocs } = fb.firestore
    getDocs(collection(getFirestore(fb.app), 'feiras'))
      .then((snap) => {
        const lista = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.atualizadaEm?.seconds || 0) - (a.atualizadaEm?.seconds || 0))
        setFeiras(lista)
        setFeiraId((atual) => atual || lista[0]?.id || '')
      })
      .catch((e) => setErro(traduzirErro(e)))
  }, [fb, usuario])

  const buscar = useCallback(async () => {
    if (!fb || !usuario || !feiraId) { setEnvios([]); return }
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
      setErro(traduzirErro(e))
    } finally {
      setBuscando(false)
    }
  }, [fb, usuario, feiraId])

  useEffect(() => { buscar() }, [buscar])

  const visiveis = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    if (!t) return envios
    return envios.filter((e) => [
      e.cadastro?.nome, e.cadastro?.email, e.cadastro?.stand, e.cadastro?.localizacao,
      e.perfil?.nome, e.protocolo,
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

  if (!firebaseConfigurado()) {
    return (
      <div className="cartao">
        <h2>Painel do time</h2>
        <p className="ajuda">
          O Firebase ainda não está configurado nesta instalação. Preencha as
          variáveis <code>VITE_FIREBASE_*</code> e publique novamente.
        </p>
      </div>
    )
  }

  if (carregando) return <div className="cartao"><p className="ajuda">Carregando…</p></div>

  if (!usuario) {
    return (
      <div className="cartao">
        <h2>Painel do time</h2>
        <p className="ajuda">Acesso restrito ao time de comunicação visual.</p>
        <button className="btn" onClick={entrar}>Entrar com Google</button>
        {erro && <p className="erro-envio">{erro}</p>}
      </div>
    )
  }

  const porVeredicto = (v) => visiveis.filter((e) => e.veredicto === v).length
  const totalMb = visiveis.reduce((s, e) => s + (e.arquivo?.tamanho || 0), 0)

  return (
    <>
      <div className="cartao">
        <div className="admin-topo">
          <div>
            <h2>Artes recebidas</h2>
            <p className="ajuda">{usuario.email}</p>
          </div>
          <button className="btn btn-ghost" onClick={sair}>Sair</button>
        </div>

        <div className="linha">
          <label className="campo">
            <span>Feira</span>
            <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
              {!feiras.length && <option value="">Nenhuma feira com envios ainda</option>}
              {feiras.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Filtrar por expositor, stand ou peça</span>
            <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="digite para filtrar" />
          </label>
        </div>

        {erro && <p className="erro-envio">{erro}</p>}

        {visiveis.length > 0 && (
          <>
            <p className="ajuda resumo-admin">
              <strong>{visiveis.length}</strong> artes de{' '}
              <strong>{new Set(visiveis.map((e) => e.cadastro?.email)).size}</strong> expositores ·{' '}
              {porVeredicto('aprovado')} aprovadas · {porVeredicto('ressalva')} com ressalva ·{' '}
              {fmtMb(totalMb)} no total
            </p>

            <div className="acoes">
              <button className="btn" onClick={baixarTodas} disabled={Boolean(baixando)}>
                {baixando
                  ? `Baixando ${baixando.feito} de ${baixando.total}…`
                  : `Baixar as ${visiveis.length} artes`}
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
                  visiveis.map((e) => `${e.cadastro?.stand} — ${e.perfil?.nome}\n${e.link}\n`).join('\n'),
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
                      {e.perfil?.nome}
                      <br />
                      <em className="dica-campo">{e.peca?.larguraCm} × {e.peca?.alturaCm} cm</em>
                    </td>
                    <td>
                      <span className={`tag ${e.veredicto}`}>{ROTULO[e.veredicto] || e.veredicto}</span>
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

function traduzirErro(e) {
  const codigo = e?.code || ''
  if (codigo.includes('unauthorized-domain')) {
    return 'O endereço deste site não está nos domínios autorizados do Firebase. Adicione "cleitonpn.github.io" em Authentication → Settings → Domínios autorizados.'
  }
  if (codigo.includes('popup-blocked')) {
    return 'O navegador bloqueou a janela de login. Libere os pop-ups para este site e tente de novo.'
  }
  if (codigo.includes('permission-denied')) {
    return 'Sua conta não está liberada para este painel. É preciso um documento com o seu e-mail na coleção "admins" do Firestore.'
  }
  if (codigo.includes('failed-precondition')) {
    return 'O Firestore precisa de um índice para esta consulta — abra o console do navegador (F12) e clique no link que aparece no erro para criá-lo.'
  }
  return e?.message || 'Não foi possível carregar os envios.'
}
