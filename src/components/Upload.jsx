import { useRef, useState } from 'react'
import { FORMATOS_ACEITOS } from '../data/perfis.js'

/**
 * A área de soltar o arquivo.
 *
 * O `id` no elemento raiz não é enfeite: é para onde o "Escolher outro
 * arquivo" da tela de resultado rola. Depois de uma reprovação o cliente está
 * no fim da página, longe daqui, e "arraste o arquivo novo lá em cima" é o tipo
 * de instrução que ninguém segue — a pessoa fecha a aba.
 *
 * O título é parâmetro porque o "2." só faz sentido na ferramenta aberta, onde
 * existe um "1. A peça" logo acima. Na tela do cliente a peça já veio do
 * projeto do stand, e um passo 2 sem passo 1 é uma pergunta a mais.
 */
export default function Upload({ onArquivo, analisando, nomeAtual, titulo = '2. A arte' }) {
  const inputRef = useRef(null)
  const [sobre, setSobre] = useState(false)

  const receber = (lista) => {
    const arquivo = lista?.[0]
    if (arquivo) onArquivo(arquivo)
  }

  return (
    <section className="cartao" id="area-de-envio">
      <h2>{titulo}</h2>
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
            <span>
              {nomeAtual
                ? 'Clique para trocar por outro arquivo — pode repetir quantas vezes precisar'
                : 'JPG, PNG, PDF ou AI · o arquivo não sai do seu computador'}
            </span>
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
