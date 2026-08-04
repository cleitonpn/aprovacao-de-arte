import { especificacao } from '../core/regras.js'

// O gabarito é a peça preventiva do conjunto: entregar isso ANTES de o cliente
// desenhar evita a maior parte das reprovações, que nascem de o designer nunca
// ter recebido a medida exata, a sangria e a área segura.
//
// Ele é HÍBRIDO de propósito. O desenho gerado aqui resolve a parede
// retangular — que é a maioria das peças, e para a qual gerar na hora é melhor
// do que alguém redesenhar a cada stand. Mas recorte, curva, balcão em L e
// testeira com sanca não cabem num retângulo, e nesses casos quem tem o
// desenho certo é o projetista. Quando o time sobe um gabarito próprio, ele
// vence o gerado — e o cliente nunca vê os dois, para não ter que escolher.

const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))
const LARGURA_SAIDA = 2400

/** Desenha o gabarito da peça e devolve o canvas. */
function desenhar(peca, perfil, escalaFator, politica) {
  const spec = especificacao(peca, perfil, politica)
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

  const sangria = (spec.sangriaMm / 10) * escala
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
    `${peca.rotulo || perfil.nome}`,
    `Tamanho final: ${fmt(peca.larguraCm)} × ${fmt(peca.alturaCm)} cm` +
      (escalaFator > 1 ? `  ·  montar em escala 1:${escalaFator}` : ''),
    `Com sangria: ${fmt(totalL)} × ${fmt(totalA)} cm  ·  sangria ${spec.sangriaMm} mm  ·  área segura ${perfil.margemMm} mm`,
    `Resolução mínima deste arquivo (com sangria) ${fmt(spec.minimo.largura)} × ${fmt(spec.minimo.altura)} px (${spec.minimo.dpi} dpi)  ·  ideal ${fmt(spec.ideal.largura)} × ${fmt(spec.ideal.altura)} px (${spec.ideal.dpi} dpi)`,
  ]
  texto.forEach((t, i) => ctx.fillText(t, W / 2, H / 2 - fonte * 2 + i * fonte * 1.6))

  ctx.font = `${fonte * 0.85}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
  ctx.fillStyle = '#e06060'
  ctx.fillText('vermelho = sangria (será cortada)', W / 2, H / 2 + fonte * 4)
  ctx.fillStyle = '#2f7fe0'
  ctx.fillText('azul tracejado = área segura: não coloque logo nem texto fora dela', W / 2, H / 2 + fonte * 5.4)

  return canvas
}

/** Gera e baixa o gabarito da peça em PNG. */
export function baixarGabarito(peca, perfil, escalaFator, politica) {
  const canvas = desenhar(peca, perfil, escalaFator, politica)
  const nome = (peca.rotulo || perfil.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gabarito-${nome}-${fmt(peca.larguraCm)}x${fmt(peca.alturaCm)}cm.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, 'image/png')
}

/** Este projeto tem gabarito desenhado à mão para esta peça? */
export const temGabaritoProprio = (peca) => Boolean(peca?.gabarito?.url)

/**
 * O botão único de gabarito.
 *
 * O cliente não precisa saber se o gabarito foi desenhado pelo projetista ou
 * gerado na hora — ele quer o gabarito da peça dele. Um botão só, com o
 * comportamento certo por baixo, é o que evita a pergunta "qual dos dois eu
 * uso?" chegando ao time.
 */
export function BotaoGabarito({ peca, perfil, escalaFator, politica, className = 'btn btn-ghost', rotulo = 'Gabarito' }) {
  const proprio = peca?.gabarito

  if (proprio?.url) {
    return (
      <a className={className} href={proprio.url} target="_blank" rel="noreferrer" title={proprio.nome}>
        {rotulo}
      </a>
    )
  }

  return (
    <button
      className={className}
      onClick={() => baixarGabarito(peca, perfil, escalaFator, politica)}
      title="Gera um PNG com corte, sangria e área segura"
    >
      {rotulo}
    </button>
  )
}

export default function Gabarito({ peca, perfil, escalaFator, politica }) {
  const proprio = temGabaritoProprio(peca)
  return (
    <BotaoGabarito
      peca={peca}
      perfil={perfil}
      escalaFator={escalaFator}
      politica={politica}
      className="btn btn-ghost largo"
      rotulo={proprio ? 'Abrir o gabarito desta peça' : 'Baixar gabarito desta peça (PNG)'}
    />
  )
}
