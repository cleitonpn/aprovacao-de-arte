import { useEffect, useRef, useState } from 'react'
import { dpiEfetivo } from '../core/regras.js'

// Acuidade visual de referência: o olho humano resolve cerca de 1 minuto de
// arco. A 3 m isso equivale a ~0,87 mm — por isso uma lona a 50 dpi (pixel de
// 0,5 mm) fica impecável de longe e sofrível de perto.
const RAD_POR_ARCMIN = Math.PI / (180 * 60)
const CSS_PX_POR_POL = 96
const DIST_REFERENCIA_M = 0.5 // distância típica do olho à tela

const LADO_CANVAS = 300

export default function Simulador({ medidas, peca, perfil, dpiMin }) {
  const [distancia, setDistancia] = useState(perfil.distanciaM)
  const canvasArte = useRef(null)
  const canvasRef = useRef(null)

  const dpi = Math.min(
    dpiEfetivo(medidas.larguraPx, peca.larguraCm),
    dpiEfetivo(medidas.alturaPx, peca.alturaCm),
  )
  const temReferencia = dpi > dpiMin * 1.05

  const pixelImpressoMm = dpi > 0 ? 25.4 / dpi : Infinity
  const resolvivelMm = distancia * RAD_POR_ARCMIN * 1000
  const perceptivel = pixelImpressoMm > resolvivelMm

  useEffect(() => {
    const fonte = medidas.bitmap
    if (!fonte) return

    // Quanto de peça (em cm) cabe no quadro, na distância simulada
    const cssPxPorCm = (CSS_PX_POR_POL / 2.54) * (DIST_REFERENCIA_M / distancia)
    const regiaoCm = Math.min(peca.larguraCm, LADO_CANVAS / cssPxPorCm)
    const artePxPorCm = medidas.larguraPx / peca.larguraCm
    const origemLado = Math.max(4, Math.round(regiaoCm * artePxPorCm))

    // centraliza no trecho com mais detalhe, que é onde a diferença aparece
    const foco = medidas.recortes?.[0]
    const cx = foco ? foco.x + foco.lado / 2 : medidas.larguraPx / 2
    const cy = foco ? foco.y + foco.lado / 2 : medidas.alturaPx / 2
    const sx = Math.max(0, Math.min(medidas.larguraPx - origemLado, Math.round(cx - origemLado / 2)))
    const sy = Math.max(0, Math.min(medidas.alturaPx - origemLado, Math.round(cy - origemLado / 2)))
    const origemLadoY = Math.min(origemLado, medidas.alturaPx)

    const pintar = (canvas, dpiAlvo) => {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, LADO_CANVAS, LADO_CANVAS)

      if (dpiAlvo) {
        // reamostra para o DPI de referência antes de exibir — é o que a
        // gráfica receberia se a arte estivesse exatamente no mínimo
        const ladoRef = Math.max(2, Math.round((regiaoCm / 2.54) * dpiAlvo))
        const tmp = document.createElement('canvas')
        tmp.width = ladoRef
        tmp.height = ladoRef
        const tctx = tmp.getContext('2d')
        tctx.imageSmoothingEnabled = true
        tctx.drawImage(fonte, sx, sy, origemLado, origemLadoY, 0, 0, ladoRef, ladoRef)
        ctx.drawImage(tmp, 0, 0, ladoRef, ladoRef, 0, 0, LADO_CANVAS, LADO_CANVAS)
      } else {
        ctx.drawImage(fonte, sx, sy, origemLado, origemLadoY, 0, 0, LADO_CANVAS, LADO_CANVAS)
      }
    }

    pintar(canvasArte.current, null)
    if (temReferencia) pintar(canvasRef.current, dpiMin)
  }, [distancia, medidas, peca, dpiMin, temReferencia])

  return (
    <div className="simulador">
      <h3>Como vai ficar impresso</h3>
      <p className="ajuda">
        Um trecho da peça no tamanho real, como ele apareceria aos olhos de
        quem está a esta distância do stand.
      </p>

      <div className="quadros">
        <figure>
          <canvas ref={canvasArte} width={LADO_CANVAS} height={LADO_CANVAS} />
          <figcaption>Sua arte {dpi > 0 && `— ${dpi.toFixed(0)} dpi`}</figcaption>
        </figure>
        {temReferencia && (
          <figure>
            <canvas ref={canvasRef} width={LADO_CANVAS} height={LADO_CANVAS} />
            <figcaption>No mínimo exigido — {dpiMin} dpi</figcaption>
          </figure>
        )}
      </div>

      <label className="campo distancia">
        <span>Distância de quem olha: <strong>{distancia.toFixed(1)} m</strong></span>
        <input
          type="range" min="0.3" max="8" step="0.1" value={distancia}
          onChange={(e) => setDistancia(Number(e.target.value))}
        />
      </label>

      <p className={`acuidade ${perceptivel ? 'ruim' : 'boa'}`}>
        {dpi > 0 && (
          <>
            Cada ponto impresso mede <strong>{pixelImpressoMm.toFixed(2)} mm</strong>.
            A {distancia.toFixed(1)} m, o olho distingue detalhes a partir de{' '}
            <strong>{resolvivelMm.toFixed(2)} mm</strong> —{' '}
            {perceptivel
              ? 'a granulação é perceptível a esta distância.'
              : 'a granulação não é perceptível a esta distância.'}
          </>
        )}
      </p>
    </div>
  )
}
