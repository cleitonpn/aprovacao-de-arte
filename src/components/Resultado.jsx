import { useState } from 'react'
import { ROTULO_VEREDICTO } from '../core/regras.js'
import { mensagemParaDesigner, laudoJson } from '../core/mensagem.js'
import Simulador from './Simulador.jsx'

const ICONE = { ok: '✓', info: 'i', ressalva: '!', bloqueante: '×' }
const ORDEM = { bloqueante: 0, ressalva: 1, info: 2, ok: 3 }
const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))

const RESUMO = {
  aprovado: 'A arte atende às exigências desta peça. Pode seguir para impressão.',
  ressalva: 'A arte imprime, mas com perda perceptível. Veja os pontos abaixo e decida se aceita seguir assim.',
  reprovado: 'A arte não pode ser impressa nesta peça sem os ajustes abaixo.',
}

function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function Resultado({ resultado, modoTecnico, onAceitarRisco, riscoAceito }) {
  const [copiado, setCopiado] = useState(false)
  const { veredicto, achados, medidas, peca, perfil } = resultado
  const ordenados = [...achados].sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel])

  const copiar = async () => {
    const texto = mensagemParaDesigner(resultado)
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      baixar('mensagem-para-o-designer.txt', texto, 'text/plain;charset=utf-8')
    }
  }

  return (
    <section className={`cartao resultado ${veredicto}`}>
      <header className="veredicto">
        <div className="selo" aria-hidden>{veredicto === 'aprovado' ? '✓' : veredicto === 'ressalva' ? '!' : '×'}</div>
        <div>
          <h2>{ROTULO_VEREDICTO[veredicto]}</h2>
          <p>{RESUMO[veredicto]}</p>
        </div>
      </header>

      {medidas.miniaturaUrl && (
        <div className="previa">
          <img src={medidas.miniaturaUrl} alt="Pré-visualização da arte enviada" />
          <dl className="numeros">
            <div><dt>Arquivo</dt><dd>{medidas.arquivo?.nome}</dd></div>
            <div><dt>Formato</dt><dd>{medidas.formatoRotulo || medidas.formato}</dd></div>
            {medidas.larguraPx ? (
              <div><dt>Pixels</dt><dd>{fmt(medidas.larguraPx)} × {fmt(medidas.alturaPx)}</dd></div>
            ) : (
              <div><dt>Conteúdo</dt><dd>Vetorial</dd></div>
            )}
            {resultado.resolucao?.dpi > 0 && !medidas.puroVetor && (
              <div><dt>No tamanho impresso</dt><dd>{fmt(resultado.resolucao.dpi)} dpi</dd></div>
            )}
            <div><dt>Peça</dt><dd>{fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm</dd></div>
            <div><dt>Tamanho</dt><dd>{medidas.arquivo?.tamanhoRotulo}</dd></div>
          </dl>
        </div>
      )}

      <ul className="achados">
        {ordenados.map((a) => (
          <li key={a.id} className={a.nivel}>
            <span className="marca" aria-hidden>{ICONE[a.nivel]}</span>
            <div>
              <strong>{a.titulo}</strong>
              {a.detalhe && <p>{a.detalhe}</p>}
              {a.acao && <p className="acao">→ {a.acao}</p>}
            </div>
          </li>
        ))}
      </ul>

      {veredicto === 'ressalva' && (
        <div className="risco">
          {riscoAceito ? (
            <p className="risco-ok">
              ✓ Risco aceito e registrado em {new Date(riscoAceito.em).toLocaleString('pt-BR')}.
              A peça segue para produção como está.
            </p>
          ) : (
            <>
              <p>
                Nada aqui impede a impressão. Se o resultado descrito acima é aceitável
                para você, registre a decisão e a peça segue para produção.
              </p>
              <button className="btn btn-risco" onClick={onAceitarRisco}>
                Aceito o risco e autorizo a impressão
              </button>
            </>
          )}
        </div>
      )}

      <div className="acoes">
        <button className="btn" onClick={copiar}>
          {copiado ? '✓ Copiado' : 'Copiar mensagem para o designer'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => baixar(
            `laudo-${(medidas.arquivo?.nome || 'arte').replace(/\.[^.]+$/, '')}.json`,
            JSON.stringify(laudoJson(resultado), null, 2),
            'application/json',
          )}
        >
          Baixar laudo (JSON)
        </button>
        <button className="btn btn-ghost" onClick={() => window.print()}>Imprimir / PDF</button>
      </div>

      {medidas.bitmap && !medidas.puroVetor && (
        <Simulador medidas={medidas} peca={peca} perfil={perfil} dpiMin={resultado.resolucao?.minimo?.dpi ?? perfil.dpiMin} />
      )}

      {modoTecnico && <PainelTecnico resultado={resultado} />}
    </section>
  )
}

function PainelTecnico({ resultado }) {
  const { medidas, resolucao } = resultado
  const linha = (rotulo, valor) =>
    valor === null || valor === undefined || valor === '' ? null : (
      <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>
    )

  return (
    <details className="tecnico" open>
      <summary>Detalhe técnico (time de comunicação visual)</summary>
      <dl>
        {linha('SHA-256', medidas.arquivo?.hash?.slice(0, 32) + '…')}
        {linha('Formato real (assinatura)', medidas.formato)}
        {linha('Piso da empresa', resolucao?.pisoEmpresa ? `${resolucao.pisoEmpresa} dpi` : null)}
        {linha('DPI na escala de trabalho', resolucao?.escala > 1 ? `${resolucao.dpiNaEscala.toFixed(1)} dpi (1:${resolucao.escala})` : null)}
        {linha('DPI horizontal / vertical', resolucao?.dpiH ? `${resolucao.dpiH.toFixed(1)} / ${resolucao.dpiV.toFixed(1)}` : null)}
        {linha('DPI declarado no arquivo', medidas.densidadeDeclarada)}
        {linha('Tamanho declarado', medidas.tamanhoDeclaradoCm
          ? `${medidas.tamanhoDeclaradoCm.largura.toFixed(1)} × ${medidas.tamanhoDeclaradoCm.altura.toFixed(1)} cm` : null)}
        {linha('Qualidade JPEG estimada', medidas.qualidadeJpeg)}
        {linha('Índice de blocagem', medidas.blocagem?.toFixed(3))}
        {linha('Queda espectral', medidas.inflacao?.quedaDb != null
          ? `${medidas.inflacao.quedaDb.toFixed(2)} dB — ${medidas.inflacao.confiavel ? 'não sustenta a resolução' : 'sem evidência de ampliação'}` : null)}
        {linha('Corte / ganho do ajuste', medidas.inflacao?.fCorte != null
          ? `f=${medidas.inflacao.fCorte.toFixed(3)} · ganho ${medidas.inflacao.ganho?.toFixed(2)} · α ${medidas.inflacao.alfa?.toFixed(2)}` : null)}
        {linha('Recortes analisados', medidas.inflacao?.amostras)}
        {linha('Área chapada', medidas.chapado != null ? `${(medidas.chapado * 100).toFixed(0)}%` : null)}
        {linha('Energia de borda na margem / miolo', medidas.margem
          ? `${medidas.margem.densidadeMargem.toFixed(4)} / ${medidas.margem.densidadeMiolo.toFixed(4)} (razão ${medidas.margem.razao.toFixed(2)})` : null)}
        {linha('Saturação média', medidas.cor ? medidas.cor.saturacaoMedia.toFixed(3) : null)}
        {linha('Perfil ICC', medidas.temICC === null ? null : medidas.temICC ? 'presente' : 'ausente')}
        {linha('Páginas (PDF)', medidas.paginas)}
        {linha('Fração raster (PDF)', medidas.fracaoRaster != null ? `${(medidas.fracaoRaster * 100).toFixed(0)}%` : null)}
        {medidas.dpiImagens?.length
          ? linha('Imagens embutidas', medidas.dpiImagens.map((i) => `${i.px}×${i.py} @ ${i.dpi.toFixed(0)} dpi`).join(' · '))
          : null}
      </dl>
    </details>
  )
}
