import { useCallback, useEffect, useState } from 'react'
import { listarAnalistas, criarAnalista, liberarAnalista, removerAnalista, traduzirErroAuth } from '../services/sessao.js'
import { EMAIL } from '../data/projeto.js'

// Cadastro dos analistas que têm acesso às telas internas.
//
// Duas formas de liberar alguém, porque existem dois casos reais:
//
// - **Criar conta com senha**: para quem não usa conta Google. A conta nasce
//   aqui e o e-mail de confirmação sai na hora.
// - **Só liberar o e-mail**: para quem vai entrar com Google. A conta já
//   existe no Google; aqui só entra a permissão.
//
// Vale saber: quem tem acesso a esta tela pode liberar qualquer pessoa,
// inclusive a si mesmo em outro endereço. É o preço de não ter um servidor
// nosso no meio — e por isso a lista deve ficar curta, com gente do time.

const fmtData = (t) => (t?.seconds ? new Date(t.seconds * 1000).toLocaleDateString('pt-BR') : '—')

function senhaSugerida() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(12)
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('')
}

export default function Usuarios({ sessao }) {
  const { fb, usuario } = sessao
  const [analistas, setAnalistas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [modo, setModo] = useState('conta') // conta | google
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState(senhaSugerida)
  const [salvando, setSalvando] = useState(false)
  const [criado, setCriado] = useState(null)

  const recarregar = useCallback(async () => {
    if (!fb) return
    setCarregando(true)
    try {
      setAnalistas(await listarAnalistas(fb))
      setErro(null)
    } catch (e) {
      setErro(traduzirErroAuth(e))
    } finally {
      setCarregando(false)
    }
  }, [fb])

  useEffect(() => { recarregar() }, [recarregar])

  const cadastrar = async (e) => {
    e.preventDefault()
    const limpo = email.trim().toLowerCase()
    if (!EMAIL.test(limpo)) { setErro('E-mail inválido.'); return }
    if (modo === 'conta' && senha.length < 6) { setErro('A senha precisa de pelo menos 6 caracteres.'); return }

    setSalvando(true)
    setErro(null)
    setCriado(null)
    try {
      if (modo === 'conta') {
        await criarAnalista(fb, { email: limpo, nome, senha, criadoPor: usuario?.email })
        setCriado({ email: limpo, senha })
      } else {
        await liberarAnalista(fb, { email: limpo, nome, criadoPor: usuario?.email })
        setCriado({ email: limpo, senha: null })
      }
      setNome('')
      setEmail('')
      setSenha(senhaSugerida())
      await recarregar()
    } catch (erroCriacao) {
      setErro(traduzirErroAuth(erroCriacao))
    } finally {
      setSalvando(false)
    }
  }

  const remover = async (alvo) => {
    if (alvo === usuario?.email) {
      window.alert('Você não pode remover o próprio acesso — pediria para outra pessoa te readmitir.')
      return
    }
    if (analistas.length <= 1) {
      window.alert('Este é o único acesso cadastrado. Removê-lo deixaria o painel sem ninguém.')
      return
    }
    if (!window.confirm(`Remover o acesso de ${alvo}? A conta continua existindo, mas perde o painel.`)) return
    try {
      await removerAnalista(fb, alvo)
      await recarregar()
    } catch (e) {
      setErro(traduzirErroAuth(e))
    }
  }

  return (
    <>
      <form className="cartao" onSubmit={cadastrar} noValidate>
        <h2>Liberar acesso a um analista</h2>

        <div className="escolha-modo">
          <label className={modo === 'conta' ? 'ativo' : ''}>
            <input type="radio" checked={modo === 'conta'} onChange={() => setModo('conta')} />
            <span>
              <strong>Criar conta com senha</strong>
              <em>Para quem não usa conta Google. A senha inicial aparece aqui para você repassar.</em>
            </span>
          </label>
          <label className={modo === 'google' ? 'ativo' : ''}>
            <input type="radio" checked={modo === 'google'} onChange={() => setModo('google')} />
            <span>
              <strong>Só liberar o e-mail</strong>
              <em>Para quem vai entrar com Google. A conta já existe; aqui entra só a permissão.</em>
            </span>
          </label>
        </div>

        <div className="linha">
          <label className="campo">
            <span>Nome</span>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
          </label>
          <label className="campo">
            <span>E-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
        </div>

        {modo === 'conta' && (
          <label className="campo">
            <span>Senha inicial</span>
            <div className="linha">
              <input type="text" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
              <button className="btn btn-ghost" type="button" onClick={() => setSenha(senhaSugerida())}>Gerar outra</button>
            </div>
            <em className="dica-campo">
              O analista pode trocar depois em “Esqueci a senha”, na tela de entrada.
            </em>
          </label>
        )}

        {erro && <p className="erro-envio">{erro}</p>}

        {criado && (
          <div className="bloco-avisos">
            <strong>✓ {criado.email} liberado.</strong>
            {criado.senha
              ? (
                <p>
                  Senha inicial: <code>{criado.senha}</code>. Antes de entrar, a
                  pessoa precisa <strong>confirmar o e-mail</strong> pelo link que
                  acabou de ser enviado — sem isso o painel continua barrado.
                </p>
              )
              : <p>Peça para entrar com o Google usando este mesmo endereço.</p>}
          </div>
        )}

        <div className="acoes">
          <button className="btn" type="submit" disabled={salvando}>
            {salvando ? 'Cadastrando…' : modo === 'conta' ? 'Criar conta e liberar' : 'Liberar acesso'}
          </button>
        </div>
      </form>

      <div className="cartao">
        <h2>Quem tem acesso</h2>
        {carregando && <p className="ajuda">Carregando…</p>}
        {!carregando && !analistas.length && <p className="ajuda">Nenhum analista cadastrado.</p>}
        {analistas.length > 0 && (
          <div className="tabela-rolagem">
            <table className="envios">
              <thead>
                <tr><th>Nome</th><th>E-mail</th><th>Desde</th><th>Liberado por</th><th /></tr>
              </thead>
              <tbody>
                {analistas.map((a) => (
                  <tr key={a.email}>
                    <td>{a.nome || <em className="dica-campo">—</em>}</td>
                    <td>
                      {a.email}
                      {a.email === usuario?.email && <em className="dica-campo"> (você)</em>}
                    </td>
                    <td>{fmtData(a.criadoEm)}</td>
                    <td><em className="dica-campo">{a.criadoPor || '—'}</em></td>
                    <td>
                      <button className="link perigo" onClick={() => remover(a.email)}>remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="nota">
          Remover daqui tira o acesso ao painel, mas não apaga a conta do
          Firebase. Para apagar a conta de vez, use o console do Firebase em
          Authentication → Usuários.
        </p>
      </div>
    </>
  )
}
