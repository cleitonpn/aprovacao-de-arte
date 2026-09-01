import { useRef, useState } from 'react'
import { FORMATOS_ACEITOS } from '../data/perfis.js'
import RoboAnalisando from './RoboAnalisando.jsx'

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
export default function Upload({ onArquivo, analisando, etapa, nomeAtual, titulo = '2. A arte' }) {
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
          <Analisando etapa={etapa} />
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

/**
 * A espera, contada como ela realmente acontece.
 *
 * O que havia antes era um disco girando e a palavra "Analisando…", parada. Num
 * PDF de 138 MB o navegador fica quieto por dezenas de segundos, e um aviso que
 * não muda é indistinguível de uma página travada — a reação treinada é
 * recarregar, e recarregar recomeça tudo do zero.
 *
 * As etapas são as REAIS, emitidas por `analisar()` na ordem em que acontecem.
 * Nada de barra que anda sozinha: o tempo de cada etapa varia demais entre um
 * JPG de 4 MB e um PDF com uma imagem de 562 megapixels, e uma barra que promete
 * 80% e para ali é pior que nenhuma. Aqui o que muda é o passo — a pessoa vê
 * que ALGO está acontecendo, sem que a tela finja saber quanto falta.
 */
const ETAPAS = [
  { id: 'lendo', texto: 'Lendo o arquivo' },
  { id: 'abrindo', texto: 'Abrindo a arte' },
  { id: 'medindo', texto: 'Medindo resolução, proporção e nitidez' },
  { id: 'escala', texto: 'Refazendo a conta na escala que reconhecemos' },
  { id: 'decidindo', texto: 'Comparando com o que esta peça exige' },
  { id: 'pronto', texto: 'Pronto' },
]

function Analisando({ etapa }) {
  // A etapa de escala só existe quando a ferramenta detecta uma; fora desse
  // caso ela nem aparece na lista, para ninguém ficar esperando um passo que
  // não vai acontecer.
  //
  // "Pronto" também some enquanto não chega: ele é o fecho, e anunciar o fim
  // antes do fim é a única coisa nesta lista que seria mentira.
  const visiveis = ETAPAS
    .filter((e) => e.id !== 'escala' || etapa === 'escala')
    .filter((e) => e.id !== 'pronto' || etapa === 'pronto')
  const atual = Math.max(visiveis.findIndex((e) => e.id === etapa), 0)

  return (
    <>
      <RoboAnalisando />
      <strong>Analisando a sua arte…</strong>
      <ol className="etapas-analise" aria-live="polite">
        {visiveis.map((e, i) => (
          <li key={e.id} className={i < atual ? 'feita' : i === atual ? 'agora' : ''}>
            <span className="etapa-marca" aria-hidden>{i < atual ? '✓' : '·'}</span>
            {e.texto}
          </li>
        ))}
      </ol>
      <span>Tudo isto acontece no seu computador — o arquivo ainda não saiu daqui.</span>
    </>
  )
}
