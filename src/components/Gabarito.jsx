import { especificacao } from '../core/regras.js'

// O gabarito é a peça preventiva do conjunto: entregar isso ANTES de o cliente
// desenhar evita a maior parte das reprovações, que nascem de o designer nunca
// ter recebido a medida exata, a sangria e a área segura.

const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))
const LARGURA_SAIDA = 2400

export default function Gabarito({ peca, perfil, escalaFator, dpiMinimoGlobal }) {
  const spec = especificacao(peca, perfil, dpiMinimoGlobal)

  const gerar = () => {
    const totalL = spec.comSangria.larguraCm
    const totalA = spec.comSangria.alturaCm
    const escala = LARGURA_SAIDA / totalL
    const W = Math.round(totalL * escala)
    const H = Math.round(totalA * escala)

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    const sangria = (perfil.sangriaMm / 10) * escala
    const margem = (perfil.margemMm / 10) * escala
    const base = Math.max(2, Math.round(W / 600))

    // área de sangria (será cortada)
    ctx.fillStyle = '#ffe9e9'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(sangria, sangria, W - 2 * sangria, H - 2 * sangria)

    const linha = (x, y, w, h, cor, largura, tracejado) => {
      ctx.save()
      ctx.strokeStyle = cor
      ctx.lineWidth = largura
      ctx.setLineDash(tracejado || [])
      ctx.strokeRect(x, y, w, h)
      ctx.restore()
    }

    linha(0, 0, W, H, '#e06060', base, [base * 6, base * 4])            // limite da sangria
    linha(sangria, sangria, W - 2 * sangria, H - 2 * sangria, '#111', base * 1.5) // corte / tamanho final
    linha(sangria + margem, sangria + margem, W - 2 * (sangria + margem), H - 2 * (sangria + margem),
      '#2f7fe0', base, [base * 4, base * 3])                             // área segura

    // marcas de centro
    ctx.strokeStyle = '#c8c8c8'
    ctx.lineWidth = base
    ctx.beginPath()
    ctx.moveTo(W / 2, sangria); ctx.lineTo(W / 2, sangria + margem)
    ctx.moveTo(W / 2, H - sangria); ctx.lineTo(W / 2, H - sangria - margem)
    ctx.moveTo(sangria, H / 2); ctx.lineTo(sangria + margem, H / 2)
    ctx.moveTo(W - sangria, H / 2); ctx.lineTo(W - sangria - margem, H / 2)
    ctx.stroke()

    const fonte = Math.max(14, Math.round(W / 75))
    ctx.textAlign = 'center'
    ctx.fillStyle = '#111'
    ctx.font = `600 ${fonte}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    const texto = [
      `${perfil.nome}`,
      `Tamanho final: ${fmt(peca.larguraCm)} × ${fmt(peca.alturaCm)} cm` +
        (escalaFator > 1 ? `  ·  montar em escala 1:${escalaFator}` : ''),
      `Com sangria: ${fmt(totalL)} × ${fmt(totalA)} cm  ·  sangria ${perfil.sangriaMm} mm  ·  área segura ${perfil.margemMm} mm`,
      `Resolução mínima deste arquivo (com sangria) ${fmt(spec.minimo.largura)} × ${fmt(spec.minimo.altura)} px (${spec.minimo.dpi} dpi)  ·  ideal ${fmt(spec.ideal.largura)} × ${fmt(spec.ideal.altura)} px (${spec.ideal.dpi} dpi)`,
    ]
    texto.forEach((t, i) => ctx.fillText(t, W / 2, H / 2 - fonte * 2 + i * fonte * 1.6))

    ctx.font = `${fonte * 0.85}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    ctx.fillStyle = '#e06060'
    ctx.fillText('vermelho = sangria (será cortada)', W / 2, H / 2 + fonte * 4)
    ctx.fillStyle = '#2f7fe0'
    ctx.fillText('azul tracejado = área segura: não coloque logo nem texto fora dela', W / 2, H / 2 + fonte * 5.4)

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gabarito-${perfil.id}-${fmt(peca.larguraCm)}x${fmt(peca.alturaCm)}cm.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }, 'image/png')
  }

  return (
    <button className="btn btn-ghost largo" onClick={gerar}>
      Baixar gabarito desta peça (PNG)
    </button>
  )
}
