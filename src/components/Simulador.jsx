import { useEffect, useRef, useState } from 'react'
import { dpiEfetivo } from '../core/regras.js'
import { recortar } from '../core/recorte.js'

// Acuidade visual de referência: o olho humano resolve cerca de 1 minuto de
// arco. A 3 m isso equivale a ~0,87 mm — por isso uma lona a 50 dpi (pixel de
// 0,5 mm) fica impecável de longe e sofrível de perto.
const RAD_POR_ARCMIN = Math.PI / (180 * 60)
const CSS_PX_POR_POL = 96
const DIST_REFERENCIA_M = 0.5 // distância típica do olho à tela

const LADO_CANVAS = 300

// Arrastar a barra dispara um recorte por parada do dedo, não por pixel: num
// PDF cada recorte é uma rasterização de verdade, e trinta delas por segundo
// travariam a página.
const ESPERA_MS = 140

export default function Simulador({ medidas, peca, perfil, dpiMin }) {
  const [distancia, setDistancia] = useState(perfil.distanciaM)
  const [erro, setErro] = useState(false)
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
    const fonte = medidas.fonteVisual
    if (!fonte) return undefined

    let vivo = true
    const tarefa = setTimeout(async () => {
      // Quanto de peça (em cm) cabe no quadro, na distância simulada
      const cssPxPorCm = (CSS_PX_POR_POL / 2.54) * (DIST_REFERENCIA_M / distancia)
      const regiaoCm = Math.min(peca.larguraCm, LADO_CANVAS / cssPxPorCm)
      const artePxPorCm = medidas.larguraPx / peca.larguraCm
      const origemLado = Math.max(4, Math.round(regiaoCm * artePxPorCm))
      const origemLadoY = Math.min(origemLado, medidas.alturaPx)

      // Centraliza no trecho com mais detalhe, que é onde a diferença aparece.
      // Num PDF não há recortes medidos — aí vale o centro da peça, que é onde
      // a arte costuma ter o assunto.
      const foco = medidas.recortes?.[0]
      const cx = foco ? foco.x + foco.lado / 2 : medidas.larguraPx / 2
      const cy = foco ? foco.y + foco.lado / 2 : medidas.alturaPx / 2
      const x = Math.max(0, Math.min(medidas.larguraPx - origemLado, Math.round(cx - origemLado / 2)))
      const y = Math.max(0, Math.min(medidas.alturaPx - origemLadoY, Math.round(cy - origemLadoY / 2)))

      // Quanto o quadro de referência precisa: os pixels que a peça teria se
      // estivesse exatamente no mínimo exigido. O recorte não pode vir mais
      // pobre que isso, senão os dois quadros ficariam iguais e a comparação —
      // que é o motivo da caixa existir — não mostraria diferença nenhuma.
      const ladoRef = Math.max(2, Math.round((regiaoCm / 2.54) * dpiMin))
      const teto = temReferencia ? Math.round(ladoRef * 1.2) : LADO_CANVAS * 2

      let recorte
      try {
        recorte = await recortar(fonte, { x, y, largura: origemLado, altura: origemLadoY, teto })
      } catch (e) {
        console.warn('não foi possível recortar a arte para a simulação', e)
        if (vivo) setErro(true)
        return
      }
      if (!vivo || !recorte) return
      setErro(false)

      const pintar = (canvas, dpiAlvo) => {
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.clearRect(0, 0, LADO_CANVAS, LADO_CANVAS)

        // Reamostrar para uma resolução MAIOR que a do recorte seria inventar
        // detalhe: o resultado é um borrão que faz o mínimo exigido parecer
        // pior do que é. Nesse caso não há o que reamostrar — desenha direto.
        if (dpiAlvo && ladoRef < recorte.canvas.width) {
          // Reamostra para o DPI de referência antes de exibir — é o que a
          // gráfica receberia se a arte estivesse exatamente no mínimo.
          const tmp = document.createElement('canvas')
          tmp.width = ladoRef
          tmp.height = ladoRef
          const tctx = tmp.getContext('2d')
          tctx.imageSmoothingEnabled = true
          tctx.drawImage(recorte.canvas, 0, 0, ladoRef, ladoRef)
          ctx.drawImage(tmp, 0, 0, ladoRef, ladoRef, 0, 0, LADO_CANVAS, LADO_CANVAS)
        } else {
          ctx.drawImage(recorte.canvas, 0, 0, LADO_CANVAS, LADO_CANVAS)
        }
      }

      pintar(canvasArte.current, null)
      if (temReferencia) pintar(canvasRef.current, dpiMin)
    }, ESPERA_MS)

    return () => { vivo = false; clearTimeout(tarefa) }
  }, [distancia, medidas, peca, dpiMin, temReferencia])

  return (
    <div className="simulador">
      <h3>Como vai ficar impresso</h3>
      <p className="ajuda">
        Um trecho da peça no tamanho real, como ele apareceria aos olhos de
        quem está a esta distância do stand.
      </p>

      {erro && (
        <p className="nota">
          Não foi possível montar a simulação para este arquivo. O laudo acima
          continua valendo — ele não depende desta caixa.
        </p>
      )}

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
