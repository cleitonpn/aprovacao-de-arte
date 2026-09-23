import { useEffect, useRef, useState } from 'react'
import {
  ouvirConversa, enviarMensagemDoCliente, enviarMensagemDoTime,
} from '../services/projetos.js'
import { enviarFotoDaConversa, EXTENSOES_FOTO } from '../services/envio.js'
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
  // A foto escolhida, ainda no computador — ela só sobe quando a mensagem é
  // enviada. Subir no momento em que o arquivo é escolhido encheria o
  // armazenamento de fotos de mensagens que a pessoa desistiu de mandar.
  const [foto, setFoto] = useState(null)
  const [progresso, setProgresso] = useState(0)
  const fim = useRef(null)
  const campoDeFoto = useRef(null)

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
    // Texto OU foto. A foto sozinha é o caso mais comum: ela costuma dizer
    // sozinha o que três linhas de texto não diziam.
    if (!conteudo && !foto) return
    setEnviando(true)
    setErro(null)
    try {
      // A foto sobe AGORA, no envio, e não na hora de escolher o arquivo: sem
      // isso o armazenamento acumularia a foto de toda mensagem que alguém
      // começou e desistiu de mandar.
      const imagem = foto ? await enviarFotoDaConversa(foto.arquivo, token, setProgresso) : null

      if (ehTime) {
        await enviarMensagemDoTime(sessao.fb, token, {
          texto: conteudo,
          autorEmail: sessao.usuario?.email,
          autorNome: sessao.usuario?.nome,
          imagem,
        })
      } else {
        await enviarMensagemDoCliente(token, { texto: conteudo, nome, email, imagem })
      }
      setTexto('')
      descartarFoto()
      // Sem recarregar: a escuta traz a mensagem nova sozinha.
    } catch (e) {
      console.error(e)
      setErro(e?.message || 'Não foi possível enviar a mensagem.')
    } finally {
      setEnviando(false)
      setProgresso(0)
    }
  }

  /*
    A prévia vive num object URL, que precisa ser devolvido à mão.

    Sem `revokeObjectURL` cada foto trocada deixa a anterior presa na memória
    da aba — e a conversa é uma tela que fica aberta o dia inteiro durante a
    montagem, trocando foto atrás de foto.
  */
  const descartarFoto = () => {
    setFoto((atual) => {
      if (atual) URL.revokeObjectURL(atual.previa)
      return null
    })
    // Zerar o `<input type=file>` à mão: sem isso, escolher o MESMO arquivo de
    // novo depois de descartar não dispara `change`, e o botão parece morto.
    if (campoDeFoto.current) campoDeFoto.current.value = ''
  }

  const escolherFoto = (arquivo) => {
    if (!arquivo) return
    setErro(null)
    // O par, e não o `File` com um campo pendurado: mexer no objeto que o
    // navegador entregou funciona e surpreende quem vier ler depois.
    setFoto((atual) => {
      if (atual) URL.revokeObjectURL(atual.previa)
      return { arquivo, previa: URL.createObjectURL(arquivo) }
    })
  }

  // A última prévia, quando a tela fecha. As trocas no meio do caminho já são
  // devolvidas em `escolherFoto` e `descartarFoto`.
  useEffect(() => () => { if (foto) URL.revokeObjectURL(foto.previa) }, [foto])

  // Do lado do cliente o nome é obrigatório pelo mesmo motivo do aceite de
  // ressalva: o link circula entre várias pessoas, e "alguém perguntou" não
  // ajuda ninguém a responder.
  // Texto com alguma substância OU uma foto escolhida — e, do lado do cliente,
  // sempre o nome. O nome é obrigatório pelo mesmo motivo do aceite de
  // ressalva: o link circula entre várias pessoas, e "alguém perguntou" (ou
  // "alguém mandou esta foto") não ajuda ninguém a responder.
  const temConteudo = texto.trim().length > 1 || Boolean(foto)
  const podeEnviar = temConteudo && (ehTime || nome.trim().length > 2)

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
            {m.imagem?.link && (
              /*
                Abre em aba nova no tamanho original: a foto no balão é pequena
                de propósito — a conversa precisa continuar sendo lida como
                conversa —, mas quem manda foto de um risco na lona precisa
                poder aproximar.

                `loading="lazy"` porque uma conversa longa de montagem acumula
                dezenas de fotos, e carregar todas de uma vez trava a abertura
                no celular, que é onde ela é lida.
              */
              <a className="balao-foto" href={m.imagem.link} target="_blank" rel="noreferrer">
                <img src={m.imagem.link} alt={m.imagem.nome || 'Foto enviada na conversa'} loading="lazy" />
              </a>
            )}
            {m.texto && <p>{m.texto}</p>}
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

      {foto && (
        <div className="foto-escolhida">
          <img src={foto.previa} alt="Prévia da foto escolhida" />
          <div>
            <strong>{foto.arquivo.name}</strong>
            <em className="dica-campo">{(foto.arquivo.size / 1048576).toFixed(1)} MB</em>
            {enviando && progresso > 0 && progresso < 1 && (
              <em className="dica-campo"> · enviando {Math.round(progresso * 100)}%</em>
            )}
          </div>
          <button className="link" type="button" onClick={descartarFoto} disabled={enviando}>
            Remover
          </button>
        </div>
      )}

      {erro && <p className="erro-envio">{erro}</p>}

      <div className="acoes">
        <button className="btn" disabled={!podeEnviar || enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar mensagem'}
        </button>
        {/*
          O `<input type=file>` fica escondido atrás do botão porque o controle
          nativo é feio e, pior, não diz o que aceita. `capture` de propósito
          ausente: no celular a pessoa tanto tira a foto na hora quanto escolhe
          uma da galeria, e forçar a câmera tira metade dos casos.
        */}
        <button
          className="btn btn-ghost"
          type="button"
          disabled={enviando}
          onClick={() => campoDeFoto.current?.click()}
        >
          {foto ? 'Trocar a foto' : 'Anexar foto'}
        </button>
        <input
          ref={campoDeFoto}
          type="file"
          accept={EXTENSOES_FOTO.map((e) => `.${e}`).join(',')}
          hidden
          onChange={(e) => escolherFoto(e.target.files?.[0])}
        />
      </div>
      <p className="nota">
        As mensagens ficam registradas e não podem ser apagadas nem editadas —
        nem por você, nem pelo time. É o que faz delas um registro confiável.
        {' '}A conversa aceita <strong>foto</strong> (JPG, PNG ou WEBP){ehTime ? '' : ' — para mandar a ARTE, use o botão de enviar da peça, que é por onde ela é conferida'}.
        {!ehTime && ' Se alguém do time estiver com o painel aberto, a mensagem aparece na hora; para algo urgente, o telefone continua sendo telefone.'}
      </p>
    </div>
  )
}
