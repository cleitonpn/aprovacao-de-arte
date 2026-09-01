import { useState } from 'react'
import { firebaseConfigurado } from '../config.js'
import { SUPORTE_EMAIL } from '../core/tutorial.js'

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
      <div className="acesso">
        <form className="cartao" onSubmit={recuperar} noValidate>
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
      </div>
    )
  }

  return (
    <div className="acesso">
      <form className="cartao" onSubmit={entrar} noValidate>
        {/*
          Título e subtítulo centralizados, com um filete abaixo — é o desenho
          da designer, e ele acerta o que uma tela de login precisa fazer:
          dizer, na primeira linha, para quem ela é.
        */}
        <header className="acesso-topo">
          <h2>Aprovação de arte</h2>
          <p className="ajuda">Acesso ao time da organizadora e comunicação visual</p>
        </header>

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

        {/*
          O Google fica numa faixa SEPARADA, como ela desenhou, e não colado ao
          formulário por um "ou".

          São dois caminhos que não se misturam: quem entra por senha nunca
          toca no de baixo, e quem entra pelo Google nunca preenche o de cima.
          Com os dois na mesma caixa, o botão do Google lia como "confirmar"
          logo abaixo dos campos — e mais de um analista clicou nele com a
          senha já digitada.
        */}
        <div className="acesso-google">
          <button
            className="btn btn-ghost largo"
            type="button"
            disabled={ocupado}
            onClick={() => rodar(sessao.entrarComGoogle)}
          >
            <LogoGoogle />
            Entrar com Google
          </button>
        </div>
      </form>

      {/*
        Fora do cartão, e não como último parágrafo dentro dele. Dentro, a
        linha caía por cima da faixa do Google — e, pior que o desalinho, ela
        lia como parte do formulário: quem não conseguia entrar tentava o
        endereço de suporte no campo de e-mail.
      */}
      <p className="acesso-suporte">
        Para suporte, escreva para <a href={`mailto:${SUPORTE_EMAIL}`}>{SUPORTE_EMAIL}</a>
      </p>
    </div>
  )
}

/** O G do Google, em SVG: a marca é o que faz o botão ser reconhecido antes de lido. */
function LogoGoogle() {
  return (
    <svg className="logo-google" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.6-3.9-12.4-9.1H4.3v5.7C7.9 41 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.6 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C34.9 4.2 30 2 24 2 15.4 2 7.9 7 4.3 14.2l7.3 5.7c1.8-5.2 6.6-9.1 12.4-9.1z" />
    </svg>
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
