import { useCallback, useEffect, useState } from 'react'
import { FIREBASE, firebaseConfigurado } from '../config.js'

// Painel interno. O Firebase SDK entra por import dinâmico: o expositor, que é
// a maioria absoluta dos acessos, nunca baixa esse peso.
//
// Quem entra aqui precisa estar autenticado E constar na coleção `admins` do
// Firestore — a regra de segurança está em firestore.rules. O cliente que
// envia arte não faz login nenhum; só esta tela exige.

const ROTULO = { aprovado: 'Aprovada', ressalva: 'Com ressalva', reprovado: 'Reprovada' }

let promessaFirebase = null
function carregarFirebase() {
  if (!promessaFirebase) {
    promessaFirebase = (async () => {
      const [{ initializeApp, getApps }, auth, firestore] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ])
      const app = getApps()[0] || initializeApp(FIREBASE)
      return { app, auth, firestore }
    })()
  }
  return promessaFirebase
}

export default function Admin() {
  const [fb, setFb] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  const [feiras, setFeiras] = useState([])
  const [feiraId, setFeiraId] = useState('')
  const [envios, setEnvios] = useState([])
  const [buscandoEnvios, setBuscandoEnvios] = useState(false)

  useEffect(() => {
    if (!firebaseConfigurado()) { setCarregando(false); return }
    let vivo = true
    carregarFirebase()
      .then((mod) => {
        if (!vivo) return
        setFb(mod)
        const autenticacao = mod.auth.getAuth(mod.app)
        return mod.auth.onAuthStateChanged(autenticacao, (u) => {
          if (!vivo) return
          setUsuario(u)
          setCarregando(false)
        })
      })
      .catch((e) => { if (vivo) { setErro(e.message); setCarregando(false) } })
    return () => { vivo = false }
  }, [])

  const entrar = async () => {
    setErro(null)
    try {
      const autenticacao = fb.auth.getAuth(fb.app)
      await fb.auth.signInWithPopup(autenticacao, new fb.auth.GoogleAuthProvider())
    } catch (e) {
      setErro(e?.message || 'Não foi possível entrar.')
    }
  }

  const sair = async () => {
    await fb.auth.signOut(fb.auth.getAuth(fb.app))
    setEnvios([])
    setFeiras([])
  }

  // Lista de feiras: mantida pela Cloud Function a cada envio, para o seletor
  // não precisar varrer a coleção inteira de envios.
  useEffect(() => {
    if (!fb || !usuario) return
    const { getFirestore, collection, getDocs, query, orderBy } = fb.firestore
    const bd = getFirestore(fb.app)
    getDocs(query(collection(bd, 'feiras'), orderBy('atualizadaEm', 'desc')))
      .then((snap) => {
        const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setFeiras(lista)
        if (lista.length && !feiraId) setFeiraId(lista[0].id)
      })
      .catch((e) => setErro(traduzirErro(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, usuario])

  const buscarEnvios = useCallback(async () => {
    if (!fb || !usuario || !feiraId) return
    setBuscandoEnvios(true)
    setErro(null)
    try {
      const { getFirestore, collection, getDocs, query, where, orderBy } = fb.firestore
      const bd = getFirestore(fb.app)
      const snap = await getDocs(query(
        collection(bd, 'envios'),
        where('feiraId', '==', feiraId),
        orderBy('criadoEm', 'desc'),
      ))
      setEnvios(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    } catch (e) {
      setErro(traduzirErro(e))
    } finally {
      setBuscandoEnvios(false)
    }
  }, [fb, usuario, feiraId])

  useEffect(() => { buscarEnvios() }, [buscarEnvios])

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

  const concluidos = envios.filter((e) => e.status === 'concluido')
  const porVeredicto = (v) => concluidos.filter((e) => e.veredicto === v).length

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

        <label className="campo">
          <span>Feira</span>
          <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
            {!feiras.length && <option value="">Nenhuma feira com envios ainda</option>}
            {feiras.map((f) => (
              <option key={f.id} value={f.id}>{f.nome} ({f.totalEnvios || 0})</option>
            ))}
          </select>
        </label>

        {erro && <p className="erro-envio">{erro}</p>}

        {concluidos.length > 0 && (
          <p className="ajuda resumo-admin">
            <strong>{concluidos.length}</strong> artes de{' '}
            <strong>{new Set(concluidos.map((e) => e.cadastro?.email)).size}</strong> expositores ·{' '}
            {porVeredicto('aprovado')} aprovadas · {porVeredicto('ressalva')} com ressalva
          </p>
        )}
      </div>

      <div className="cartao">
        {buscandoEnvios && <p className="ajuda">Buscando…</p>}
        {!buscandoEnvios && !concluidos.length && (
          <p className="ajuda">Nenhuma arte enviada para esta feira ainda.</p>
        )}
        {concluidos.length > 0 && (
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
                {concluidos.map((e) => (
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
                    <td>{e.criadoEm?.seconds ? new Date(e.criadoEm.seconds * 1000).toLocaleString('pt-BR') : '—'}</td>
                    <td>
                      {e.link
                        ? <a href={e.link} target="_blank" rel="noreferrer">Abrir no Drive</a>
                        : <em className="dica-campo">—</em>}
                      <br />
                      <em className="dica-campo">{e.protocolo}</em>
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
  if (codigo.includes('permission-denied')) {
    return 'Sua conta não está liberada para este painel. Peça para adicionarem seu e-mail na coleção "admins" do Firestore.'
  }
  if (codigo.includes('failed-precondition')) {
    return 'O Firestore precisa de um índice para esta consulta — o link para criá-lo aparece no console do navegador.'
  }
  return e?.message || 'Não foi possível carregar os envios.'
}
