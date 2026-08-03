import { useRef, useState } from 'react'
import { enviarAvulso, EXTENSOES_AVULSAS } from '../services/envio.js'
import { ENVIO, envioConfigurado } from '../config.js'

// Arquivos de apoio: logo, fontes, manual de marca.
//
// Vão sem análise, e é assim de propósito. Um logo em SVG não tem tamanho
// impresso nem resolução — reprová-lo por "menos de 150 dpi" seria absurdo. E
// obrigar o cliente a inventar uma medida só para conseguir mandar o logo é o
// tipo de atrito que faz o material voltar a chegar por WhatsApp, que é
// justamente o que queremos acabar.

export default function Avulsos({ projeto, cadastro }) {
  const [fila, setFila] = useState([])
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(null)
  const [erro, setErro] = useState(null)
  const entrada = useRef(null)

  if (!envioConfigurado()) return null

  const enviar = async (arquivos) => {
    const lista = [...(arquivos || [])]
    if (!lista.length) return
    setErro(null)
    for (const arquivo of lista) {
      setEnviando({ nome: arquivo.name, fracao: 0 })
      try {
        const recibo = await enviarAvulso(
          arquivo,
          { cadastro, projeto, descricao: descricao.trim() || arquivo.name },
          (fracao) => setEnviando({ nome: arquivo.name, fracao }),
        )
        setFila((f) => [...f, { nome: arquivo.name, protocolo: recibo.protocolo }])
      } catch (e) {
        setErro(`${arquivo.name}: ${e.message}`)
        break
      }
    }
    setEnviando(null)
    setDescricao('')
    if (entrada.current) entrada.current.value = ''
  }

  return (
    <div className="cartao">
      <h3>Arquivos de apoio</h3>
      <p className="ajuda">
        Logo, fontes, manual de marca, referências. Estes arquivos{' '}
        <strong>não passam pela análise</strong> — eles não são peça impressa,
        não têm tamanho final nem resolução a conferir. Vão direto para o time.
      </p>

      <label className="campo">
        <span>O que é este arquivo <em className="opcional">(opcional)</em></span>
        <input
          type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)}
          placeholder="Logo vetorial da marca"
        />
      </label>

      <input
        ref={entrada}
        type="file"
        multiple
        hidden
        accept={EXTENSOES_AVULSAS.map((e) => `.${e}`).join(',')}
        onChange={(e) => enviar(e.target.files)}
      />

      <div className="acoes">
        <button className="btn btn-ghost" disabled={Boolean(enviando)} onClick={() => entrada.current?.click()}>
          {enviando ? `Enviando ${enviando.nome}… ${Math.round(enviando.fracao * 100)}%` : 'Escolher arquivos'}
        </button>
      </div>

      {enviando && (
        <div className="barra" role="progressbar">
          <div style={{ width: `${Math.max(2, enviando.fracao * 100)}%` }} />
        </div>
      )}

      {fila.length > 0 && (
        <ul className="pecas-lista">
          {fila.map((f) => (
            <li key={f.protocolo} className="entregue">
              <span className="marca" aria-hidden>✓</span>
              <div><strong>{f.nome}</strong><p className="dica-campo">protocolo {f.protocolo}</p></div>
            </li>
          ))}
        </ul>
      )}

      {erro && <p className="erro-envio">{erro}</p>}

      <p className="nota">
        Aceita {EXTENSOES_AVULSAS.map((e) => `.${e}`).join(', ')} — até{' '}
        {ENVIO.tamanhoMaximoAvulsoMb} MB por arquivo. Vários logos de uma vez?
        Compacte num .zip.
      </p>
    </div>
  )
}
