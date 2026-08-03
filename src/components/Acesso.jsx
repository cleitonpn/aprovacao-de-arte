import { useState } from 'react'
import { firebaseConfigurado } from '../config.js'

// Porta de entrada do time interno. É a única tela da ferramenta que pede
// login — o expositor continua entrando sem nada, que é o ponto do projeto.
//
// Cada motivo de bloqueio tem tela própria, e isso é deliberado: "entre com
// sua conta", "confirme seu e-mail" e "sua conta não está liberada" pedem
// ações completamente diferentes. Juntar tudo num "acesso negado" genérico é o
// que transforma um problema de 30 segundos numa ligação para o suporte.

export default function Acesso({ sessao, children }) {
  const { usuario, carregando, liberado, verificado, erro } = sessao

  if (!firebaseConfigurado()) {
    return (
      <div className="cartao">
        <h2>Acesso do time</h2>
        <p className="ajuda">
          O Firebase ainda não está configurado nesta instalação. Preencha as
          variáveis <code>VITE_FIREBASE_*</code> e publique novamente.
        </p>
      </div>
    )
  }

  if (carregando) return <div className="cartao"><p className="ajuda">Carregando…</p></div>
  if (!usuario) return <FormularioDeEntrada sessao={sessao} />
  if (!verificado) return <ConfirmeSeuEmail sessao={sessao} />
  if (!liberado) {
    return (
      <div className="cartao">
        <h2>Conta ainda não liberada</h2>
        <p className="ajuda">
          Você entrou como <strong>{usuario.email}</strong>, mas esta conta não
          está na lista de analistas. Peça a alguém que já tem acesso para
          incluir o seu e-mail na tela <strong>Analistas</strong>.
        </p>
        {erro && <p className="erro-envio">{erro}</p>}
        <div className="acoes">
          <button className="btn btn-ghost" onClick={sessao.sair}>Sair</button>
        </div>
      </div>
    )
  }

  return children
}

function FormularioDeEntrada({ sessao }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  const rodar = async (acao) => {
    setOcupado(true)
    try { await acao() } catch { /* a mensagem já vem em sessao.erro */ } finally { setOcupado(false) }
  }

  const entrar = (e) => {
    e.preventDefault()
    rodar(() => sessao.entrarComEmail(email, senha))
  }

  const recuperar = (e) => {
    e.preventDefault()
    rodar(async () => {
      await sessao.redefinirSenha(email)
      setEnviado(true)
    })
  }

  if (recuperando) {
    return (
      <form className="cartao acesso" onSubmit={recuperar} noValidate>
        <h2>Redefinir a senha</h2>
        {enviado ? (
          <p className="ajuda">
            Se existe conta para <strong>{email}</strong>, o link de redefinição
            já está a caminho. Confira também a caixa de spam.
          </p>
        ) : (
          <>
            <p className="ajuda">Enviamos um link para você criar uma senha nova.</p>
            <label className="campo">
              <span>E-mail</span>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </>
        )}
        {sessao.erro && <p className="erro-envio">{sessao.erro}</p>}
        <div className="acoes">
          {!enviado && <button className="btn" type="submit" disabled={ocupado || !email}>Enviar link</button>}
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => { setRecuperando(false); setEnviado(false); sessao.setErro(null) }}
          >
            Voltar
          </button>
        </div>
      </form>
    )
  }

  return (
    <form className="cartao acesso" onSubmit={entrar} noValidate>
      <h2>Acesso do time</h2>
      <p className="ajuda">Restrito aos analistas de comunicação visual.</p>

      <label className="campo">
        <span>E-mail</span>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="campo">
        <span>Senha</span>
        <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
      </label>

      {sessao.erro && <p className="erro-envio">{sessao.erro}</p>}

      <div className="acoes">
        <button className="btn" type="submit" disabled={ocupado || !email || !senha}>Entrar</button>
        <button className="link" type="button" onClick={() => { setRecuperando(true); sessao.setErro(null) }}>
          Esqueci a senha
        </button>
      </div>

      <div className="separador"><span>ou</span></div>

      <button
        className="btn btn-ghost largo"
        type="button"
        disabled={ocupado}
        onClick={() => rodar(sessao.entrarComGoogle)}
      >
        Entrar com Google
      </button>
    </form>
  )
}

/**
 * Tela de quem já tem conta mas ainda não confirmou o e-mail.
 *
 * A confirmação não é formalidade: com o login por e-mail e senha ligado,
 * qualquer pessoa consegue criar uma conta com o endereço que quiser. Se
 * bastasse o endereço constar na lista de analistas, daria para se cadastrar
 * com o e-mail de um colega que ainda não criou conta e entrar no lugar dele.
 * Exigir a confirmação obriga a ter acesso à caixa de entrada.
 */
function ConfirmeSeuEmail({ sessao }) {
  const [reenviado, setReenviado] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const rodar = async (acao) => {
    setOcupado(true)
    try { await acao() } catch { /* mensagem em sessao.erro */ } finally { setOcupado(false) }
  }

  return (
    <div className="cartao">
      <h2>Confirme seu e-mail</h2>
      <p className="ajuda">
        Enviamos um link de confirmação para <strong>{sessao.usuario.email}</strong>.
        Abra o link e volte aqui. Se não achar, veja a caixa de spam.
      </p>
      {reenviado && <p className="ajuda">✓ E-mail reenviado.</p>}
      {sessao.erro && <p className="erro-envio">{sessao.erro}</p>}
      <div className="acoes">
        <button className="btn" disabled={ocupado} onClick={() => rodar(sessao.recarregarUsuario)}>
          Já confirmei
        </button>
        <button
          className="btn btn-ghost"
          disabled={ocupado}
          onClick={() => rodar(async () => { await sessao.reenviarVerificacao(); setReenviado(true) })}
        >
          Reenviar e-mail
        </button>
        <button className="btn btn-ghost" onClick={sessao.sair}>Sair</button>
      </div>
    </div>
  )
}
