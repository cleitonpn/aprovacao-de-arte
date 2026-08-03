import { useRef, useState } from 'react'
import { FORMATOS_ACEITOS } from '../data/perfis.js'

export default function Upload({ onArquivo, analisando, nomeAtual }) {
  const inputRef = useRef(null)
  const [sobre, setSobre] = useState(false)

  const receber = (lista) => {
    const arquivo = lista?.[0]
    if (arquivo) onArquivo(arquivo)
  }

  return (
    <section className="cartao">
      <h2>2. A arte</h2>
      <div
        className={`solta ${sobre ? 'sobre' : ''} ${analisando ? 'ocupado' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSobre(true) }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); receber(e.dataTransfer.files) }}
        onClick={() => !analisando && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
      >
        {analisando ? (
          <>
            <div className="girando" aria-hidden />
            <strong>Analisando…</strong>
            <span>Medindo resolução, proporção e nitidez real.</span>
          </>
        ) : (
          <>
            <div className="icone" aria-hidden>⬆</div>
            <strong>{nomeAtual || 'Arraste a arte aqui ou clique para escolher'}</strong>
            <span>JPG, PNG, PDF ou AI · o arquivo não sai do seu computador</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={FORMATOS_ACEITOS.map((f) => `.${f}`).join(',')}
        onChange={(e) => { receber(e.target.files); e.target.value = '' }}
      />
    </section>
  )
}
