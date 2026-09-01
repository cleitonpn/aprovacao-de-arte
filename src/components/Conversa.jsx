import { useEffect, useRef, useState } from 'react'
import {
  ouvirConversa, enviarMensagemDoCliente, enviarMensagemDoTime,
} from '../services/projetos.js'
import { marcarVisto } from '../store/visto.js'
import { chaveDaConversa } from '../core/conversa.js'

// A conversa entre o cliente e o time, dentro da ferramenta.
//
// A dúvida do cliente hoje sai para o WhatsApp de alguém e morre lá. Quando a
// peça dá problema três semanas depois, a decisão que resolveu a dúvida está
// numa conversa particular que ninguém acha — e a discussão vira palavra
// contra palavra. Aqui ela fica ao lado da peça, com data, autor e sem
// possibilidade de edição por nenhum dos dois lados (ver `firestore.rules`).
//
// É tempo real: quem está com a tela aberta vê a resposta chegar. Cheguei a
// deixar com botão de atualizar por receio do custo de manter uma conexão
// aberta, mas a conta não se sustenta — o Firestore cobra a leitura inicial e
// depois só o que muda, então uma tela aberta e parada custa o mesmo que
// abri-la uma vez. E um chat onde é preciso apertar "atualizar" para saber se
// responderam não é usado duas vezes.

const fmtQuando = (v) => {
  const ms = Date.parse(v || '')
  if (!Number.isFinite(ms)) return ''
  const agora = Date.now()
  const min = Math.round((agora - ms) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Conversa({ token, ehTime = false, sessao = null, identidade = null, embutida = false }) {
  const [mensagens, setMensagens] = useState([])
  const [aberta, setAberta] = useState(false)
  const [texto, setTexto] = useState('')
  const [nome, setNome] = useState(identidade?.nome || '')
  const [email, setEmail] = useState(identidade?.email || '')
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)
  const fim = useRef(null)

  useEffect(() => {
    let vivo = true
    let cancelar = null
    ouvirConversa(
      token,
      (lista) => {
        if (!vivo) return
        setMensagens(lista)
        setCarregando(false)
        setErro(null)
      },
      (e) => {
        if (!vivo) return
        console.error(e)
        setErro('Não foi possível carregar a conversa.')
        setCarregando(false)
      },
      ehTime ? sessao?.fb : null,
    ).then((c) => { cancelar = c; if (!vivo) c?.() })
    // Listener que sobrevive à tela vaza conexão e escreve estado em
    // componente que já saiu — daí o cancelamento nos dois caminhos.
    return () => { vivo = false; cancelar?.() }
  }, [token, ehTime, sessao?.fb])

  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }) }, [mensagens.length])

  // Estar com a conversa na tela É ter visto. Quem redesenha as bolinhas
  // descobre sozinho: `marcarVisto` avisa seus assinantes, e as telas que
  // pintam aviso estão inscritas nele.
  //
  // Vale para os DOIS lados desde que a conversa virou um popup com badge. Do
  // lado do cliente a marca fica sob `anon`, no navegador dele — que é a mesma
  // granularidade do resto: o link é a credencial, e quem tem o link tem a
  // tela. O preço é o de sempre: trocar de navegador reacende o aviso uma vez.
  useEffect(() => {
    if (!mensagens.length) return
    marcarVisto(
      ehTime ? sessao?.usuario?.email : null,
      chaveDaConversa(token),
      mensagens[mensagens.length - 1].em,
    )
  }, [ehTime, mensagens, token, sessao?.usuario?.email])

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
      // Sem recarregar: a escuta traz a mensagem nova sozinha.
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

  // Fechada até ter assunto.
  //
  // Aberta e vazia, a caixa foi lida como parte do formulário de envio: "achei
  // que tinha que digitar nele". Um campo de texto em branco no meio de uma
  // tela de tarefa parece obrigatório, e o cliente parava ali para descobrir o
  // que escrever. Convite fechado, o mesmo espaço passa a dizer o contrário —
  // é opcional, e está aqui se precisar. Basta uma mensagem existir, de
  // qualquer lado, e a conversa abre e fica aberta: aí ela é assunto pendente,
  // não decoração. Do lado do time isso não se aplica: o analista abre o painel
  // justamente para falar com o cliente.
  // Dentro do popup o convite não faz sentido: quem clicou na bolha já disse
  // que quer falar. Ele existia para a versão em cartão, no meio da página.
  if (!embutida && !ehTime && !aberta && !mensagens.length) {
    return (
      <div className="cartao conversa-convite">
        <div>
          <strong>Ficou com dúvida sobre alguma peça?</strong>
          <p className="ajuda">
            Medida, material, prazo — pergunte ao time por aqui. Fica registrado
            junto com as artes deste stand, sem precisar procurar depois quem
            falou o quê no WhatsApp.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setAberta(true)}>
          Falar com o time
        </button>
      </div>
    )
  }

  return (
    <div className={embutida ? 'conversa embutida' : 'cartao conversa'}>
      {!embutida && (
        <div className="titulo-secao">
          <h3>{ehTime ? 'Conversa com o cliente' : 'Dúvidas com o time'}</h3>
          <span className="dica-campo ao-vivo">ao vivo</span>
        </div>
      )}

      {!ehTime && !embutida && (
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
        {!ehTime && ' Se alguém do time estiver com o painel aberto, a mensagem aparece na hora; para algo urgente, o telefone continua sendo telefone.'}
      </p>
    </div>
  )
}
