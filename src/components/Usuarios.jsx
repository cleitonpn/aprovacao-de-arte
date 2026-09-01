import { useCallback, useEffect, useState } from 'react'
import { listarAnalistas, criarAnalista, liberarAnalista, removerAnalista, traduzirErroAuth } from '../services/sessao.js'
import { EMAIL } from '../data/projeto.js'
import { LISTA_DE_PAPEIS, PAPEIS, acessoDe, ROTULO_PERMISSAO } from '../core/permissoes.js'
import { usarFeiras } from '../store/feiras.js'
import { formatarData as fmtData } from '../core/datas.js'

// Cadastro dos analistas que têm acesso às telas internas.
//
// Duas formas de liberar alguém, porque existem dois casos reais:
//
// - **Criar conta com senha**: para quem não usa conta Google. A conta nasce
//   aqui e o e-mail de confirmação sai na hora.
// - **Só liberar o e-mail**: para quem vai entrar com Google. A conta já
//   existe no Google; aqui só entra a permissão.
//
// Só o ADMINISTRADOR chega aqui, e isso é lei no servidor, não só na tela: sem
// essa trava qualquer analista se promoveria, e os níveis abaixo virariam
// decoração.
//
// Duas perguntas independentes por pessoa, e o formulário as separa de
// propósito: o que ela PODE fazer (o papel) e ONDE ela pode (as feiras). Um
// analista de cobrança com acesso a todas as feiras continua sem aprovar nada;
// um analista completo só opera as feiras dele.


function senhaSugerida() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(12)
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('')
}

export default function Usuarios({ sessao }) {
  const { fb, usuario } = sessao
  // Sem recorte: para atribuir feiras a alguém é preciso ver todas elas.
  const { feiras } = usarFeiras(fb, { todasAsFeiras: true, permissoes: [], feiras: [] })
  const [analistas, setAnalistas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [modo, setModo] = useState('conta') // conta | google
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState(senhaSugerida)
  const [papel, setPapel] = useState('completo')
  const [todasAsFeiras, setTodasAsFeiras] = useState(false)
  const [feirasEscolhidas, setFeirasEscolhidas] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [criado, setCriado] = useState(null)
  const [editando, setEditando] = useState(null)

  const definicao = PAPEIS[papel]
  const escopoTravado = Boolean(definicao?.sempreTodasAsFeiras)

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

    if (!escopoTravado && !todasAsFeiras && !feirasEscolhidas.length) {
      setErro('Escolha pelo menos uma feira, ou marque "todas as feiras".')
      return
    }

    setSalvando(true)
    setErro(null)
    setCriado(null)
    const acessoNovo = {
      papel,
      feiras: feirasEscolhidas,
      todasAsFeiras: escopoTravado || todasAsFeiras,
      criadoPor: usuario?.email,
    }
    try {
      if (modo === 'conta' && !editando) {
        await criarAnalista(fb, { email: limpo, nome, senha, ...acessoNovo })
        setCriado({ email: limpo, senha })
      } else {
        await liberarAnalista(fb, { email: limpo, nome, ...acessoNovo })
        setCriado({ email: limpo, senha: null })
      }
      setNome('')
      setEmail('')
      setSenha(senhaSugerida())
      setEditando(null)
      setFeirasEscolhidas([])
      setTodasAsFeiras(false)
      await recarregar()
    } catch (erroCriacao) {
      setErro(traduzirErroAuth(erroCriacao, 'gravacao'))
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
      setErro(traduzirErroAuth(e, 'gravacao'))
    }
  }

  return (
    <>
      <form className="cartao" onSubmit={cadastrar} noValidate>
        <h2>{editando ? `Alterar acesso de ${editando}` : 'Liberar acesso'}</h2>
        <p className="ajuda">
          Duas decisões por pessoa: <strong>o que ela pode fazer</strong> e{' '}
          <strong>em quais feiras</strong>. Elas são independentes — dar todas as
          feiras a alguém não amplia o que ele faz nelas.
        </p>

        {!editando && <div className="escolha-modo">
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
        </div>}

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

        {modo === 'conta' && !editando && (
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

        <div className="escolha-modo">
          {LISTA_DE_PAPEIS.map((p) => (
            <label key={p.id} className={papel === p.id ? 'ativo' : ''}>
              <input type="radio" checked={papel === p.id} onChange={() => setPapel(p.id)} />
              <span>
                <strong>{p.rotulo}</strong>
                <em>{p.descricao}</em>
              </span>
            </label>
          ))}
        </div>

        <div className="peca-editor">
          <p className="ajuda">
            <strong>Em quais feiras?</strong>{' '}
            {escopoTravado
              ? 'O administrador alcança todas, sempre — não há o que escolher.'
              : 'Ele só enxerga, no seletor, as feiras marcadas aqui.'}
          </p>
          {!escopoTravado && (
            <>
              <label className="alternador">
                <input type="checkbox" checked={todasAsFeiras} onChange={(e) => setTodasAsFeiras(e.target.checked)} />
                <span>Todas as feiras, inclusive as que forem criadas depois</span>
              </label>
              {!todasAsFeiras && (
                <div className="grade-feiras">
                  {!feiras.length && <em className="dica-campo">Nenhuma feira cadastrada ainda.</em>}
                  {feiras.map((f) => (
                    <label className="alternador" key={f.id}>
                      <input
                        type="checkbox"
                        checked={feirasEscolhidas.includes(f.id)}
                        onChange={(e) => setFeirasEscolhidas((atual) => (
                          e.target.checked ? [...atual, f.id] : atual.filter((x) => x !== f.id)
                        ))}
                      />
                      <span>{f.nome}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          <ul className="lista-permissoes">
            {definicao.permissoes.map((x) => <li key={x}>{ROTULO_PERMISSAO[x]}</li>)}
          </ul>
        </div>

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
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : modo === 'conta' ? 'Criar conta e liberar' : 'Liberar acesso'}
          </button>
          {editando && (
            <button
              className="btn btn-ghost" type="button"
              onClick={() => { setEditando(null); setNome(''); setEmail(''); setFeirasEscolhidas([]); setTodasAsFeiras(false); setPapel('completo') }}
            >
              Cancelar
            </button>
          )}
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
                <tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Feiras</th><th>Desde</th><th /></tr>
              </thead>
              <tbody>
                {analistas.map((a) => (
                  <tr key={a.email}>
                    <td>{a.nome || <em className="dica-campo">—</em>}</td>
                    <td>
                      {a.email}
                      {a.email === usuario?.email && <em className="dica-campo"> (você)</em>}
                    </td>
                    <td><span className="tag neutro">{acessoDe(a).rotulo}</span></td>
                    <td>
                      {acessoDe(a).todasAsFeiras
                        ? <em className="dica-campo">todas</em>
                        : (
                          <em className="dica-campo">
                            {acessoDe(a).feiras
                              .map((id) => feiras.find((f) => f.id === id)?.nome || id)
                              .join(', ') || '— nenhuma'}
                          </em>
                        )}
                    </td>
                    <td>{fmtData(a.criadoEm)}</td>
                    <td>
                      <button
                        className="link"
                        onClick={() => {
                          const ac = acessoDe(a)
                          setEditando(a.email)
                          setNome(a.nome || '')
                          setEmail(a.email)
                          setPapel(ac.papel)
                          setTodasAsFeiras(ac.todasAsFeiras)
                          setFeirasEscolhidas(ac.feiras)
                          setCriado(null)
                          setErro(null)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        alterar
                      </button>
                      {' · '}
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
        <p className="nota">
          Só quem é <strong>Administrador</strong> abre esta tela e altera
          papéis — e isso está nas regras do Firestore, não só aqui. Sem essa
          trava, qualquer analista se promoveria e os níveis abaixo virariam
          decoração.
        </p>
      </div>
    </>
  )
}
