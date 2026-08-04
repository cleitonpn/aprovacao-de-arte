import { useCallback, useEffect, useRef, useState } from 'react'
import {
  lerConversaComoCliente, lerConversaComoTime,
  enviarMensagemDoCliente, enviarMensagemDoTime,
} from '../services/projetos.js'

// A conversa entre o cliente e o time, dentro da ferramenta.
//
// A dúvida do cliente hoje sai para o WhatsApp de alguém e morre lá. Quando a
// peça dá problema três semanas depois, a decisão que resolveu a dúvida está
// numa conversa particular que ninguém acha — e a discussão vira palavra
// contra palavra. Aqui ela fica ao lado da peça, com data, autor e sem
// possibilidade de edição por nenhum dos dois lados (ver `firestore.rules`).
//
// Não é chat de tempo real de propósito: fica com um botão de atualizar e
// relê ao abrir. Escuta contínua custaria uma conexão aberta por cliente com o
// link, o dia inteiro, para um volume de mensagens que é de algumas por
// semana.

const fmtQuando = (v) => {
  const ms = Date.parse(v || '')
  if (!Number.isFinite(ms)) return ''
  const agora = Date.now()
  const min = Math.round((agora - ms) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Conversa({ token, ehTime = false, sessao = null, identidade = null }) {
  const [mensagens, setMensagens] = useState([])
  const [texto, setTexto] = useState('')
  const [nome, setNome] = useState(identidade?.nome || '')
  const [email, setEmail] = useState(identidade?.email || '')
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)
  const fim = useRef(null)

  const carregar = useCallback(async () => {
    try {
      const lista = ehTime
        ? await lerConversaComoTime(sessao.fb, token)
        : await lerConversaComoCliente(token)
      setMensagens(lista)
      setErro(null)
    } catch (e) {
      console.error(e)
      setErro('Não foi possível carregar a conversa.')
    } finally {
      setCarregando(false)
    }
  }, [token, ehTime, sessao])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }) }, [mensagens.length])

  const enviar = async () => {
    const conteudo = texto.trim()
    if (!conteudo) return
    setEnviando(true)
    setErro(null)
    try {
      if (ehTime) {
        await enviarMensagemDoTime(sessao.fb, token, {
          texto: conteudo,
          autorEmail: sessao.usuario?.email,
          autorNome: sessao.usuario?.nome,
        })
      } else {
        await enviarMensagemDoCliente(token, { texto: conteudo, nome, email })
      }
      setTexto('')
      await carregar()
    } catch (e) {
      console.error(e)
      setErro(e?.message || 'Não foi possível enviar a mensagem.')
    } finally {
      setEnviando(false)
    }
  }

  // Do lado do cliente o nome é obrigatório pelo mesmo motivo do aceite de
  // ressalva: o link circula entre várias pessoas, e "alguém perguntou" não
  // ajuda ninguém a responder.
  const podeEnviar = texto.trim().length > 1 && (ehTime || nome.trim().length > 2)

  return (
    <div className="cartao conversa">
      <div className="titulo-secao">
        <h3>{ehTime ? 'Conversa com o cliente' : 'Dúvidas com o time'}</h3>
        <button className="link" onClick={carregar} disabled={carregando}>atualizar</button>
      </div>

      {!ehTime && (
        <p className="ajuda">
          Dúvida sobre medida, material ou prazo? Pergunte por aqui. Fica tudo
          registrado junto com as artes deste stand — sem precisar procurar
          depois quem falou o quê no WhatsApp.
        </p>
      )}

      <div className="conversa-linha">
        {carregando && <p className="ajuda">Carregando…</p>}
        {!carregando && !mensagens.length && (
          <p className="ajuda">
            {ehTime ? 'Nenhuma mensagem ainda.' : 'Nenhuma mensagem ainda. Pode perguntar à vontade.'}
          </p>
        )}
        {mensagens.map((m) => (
          <div key={m.id} className={`balao ${m.autor === 'time' ? 'time' : 'cliente'}`}>
            <div className="balao-topo">
              <strong>{m.autor === 'time' ? (m.nome || 'Comunicação visual') : (m.nome || 'Cliente')}</strong>
              <span className="dica-campo">{fmtQuando(m.em)}</span>
            </div>
            <p>{m.texto}</p>
          </div>
        ))}
        <div ref={fim} />
      </div>

      {!ehTime && (
        <div className="linha">
          <label className="campo">
            <span>Seu nome</span>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
          </label>
          <label className="campo">
            <span>Seu e-mail <em className="opcional">(opcional)</em></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
        </div>
      )}

      <label className="campo">
        <span>{ehTime ? 'Responder ao cliente' : 'Sua mensagem'}</span>
        <textarea
          rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={ehTime ? 'A resposta aparece na tela do cliente.' : 'Ex.: a lona de fundo tem alguma parte coberta pela estrutura?'}
        />
      </label>

      {erro && <p className="erro-envio">{erro}</p>}

      <div className="acoes">
        <button className="btn" disabled={!podeEnviar || enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar mensagem'}
        </button>
      </div>
      <p className="nota">
        As mensagens ficam registradas e não podem ser apagadas nem editadas —
        nem por você, nem pelo time. É o que faz delas um registro confiável.
        {!ehTime && ' O time não recebe aviso automático, então para algo urgente use também o telefone do atendimento.'}
      </p>
    </div>
  )
}
