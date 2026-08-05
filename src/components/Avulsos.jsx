import { useRef, useState } from 'react'
import { enviarAvulso, EXTENSOES_AVULSAS } from '../services/envio.js'
import { conferirApoio, APOIO } from '../core/apoio.js'
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
      // A conferência acontece ANTES do envio e não bloqueia nada: o arquivo
      // sobe de qualquer jeito. O objetivo é o cliente descobrir agora que o
      // logo não está vetorizado, e não o time descobrir na véspera da feira.
      let conferencia = null
      try {
        conferencia = await conferirApoio(arquivo)
      } catch { /* conferência é bônus; nunca impede o envio */ }
      try {
        const recibo = await enviarAvulso(
          arquivo,
          { cadastro, projeto, descricao: descricao.trim() || arquivo.name },
          (fracao) => setEnviando({ nome: arquivo.name, fracao }),
        )
        setFila((f) => [...f, { nome: arquivo.name, protocolo: recibo.protocolo, conferencia }])
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
    // O id é o alvo do "me mostre onde fica" do tutorial. Descrever a
    // localização em palavras não funciona numa página que rola.
    <div className="cartao apoio-destaque" id="arquivos-de-apoio">
      <div className="titulo-secao">
        <h3>Arquivos de apoio</h3>
        <span className="dica-campo">logo, fontes, manual de marca</span>
      </div>
      <p className="ajuda">
        Estes arquivos <strong>não passam pela análise de arte</strong> — não
        são peça impressa e não têm resolução a conferir. Mas a ferramenta
        confere <strong>se o logo está vetorizado</strong>, que é o que decide
        se ele pode ser ampliado para uma testeira de 6 metros.
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
          {fila.map((f) => {
            const c = f.conferencia
            const marca = c ? APOIO[c.situacao] : null
            return (
              <li key={f.protocolo} className="entregue">
                <span className="marca" aria-hidden>✓</span>
                <div>
                  <strong>{f.nome}</strong>
                  {marca && <span className={`tag ${marca.cor}`}> {marca.rotulo}</span>}
                  {c?.detalhe && <p className="dica-campo">{c.detalhe}</p>}
                  {c?.acao && <p className="acao">→ {c.acao}</p>}
                  <p className="dica-campo">Recebido · protocolo {f.protocolo}</p>
                </div>
              </li>
            )
          })}
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
