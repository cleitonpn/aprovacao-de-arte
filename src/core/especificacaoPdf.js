// A folha de especificação que vai para quem monta a arte.
//
// Ela substitui o "Baixar laudo (JSON)". O JSON foi escrito pensando em
// integração — máquina lendo máquina — e nunca houve integração nenhuma: na
// prática o botão oferecia, ao cliente, um arquivo que ninguém no caminho dele
// sabe abrir. Quem recebe a arte de volta para corrigir é um designer, e o que
// ele precisa não é o laudo: é a MEDIDA.
//
// São duas páginas, e a divisão é entre ler e montar:
//
// 1. A ficha. Todas as medidas em números, e — quando a arte já foi analisada —
//    o que precisa mudar, com o texto exato do laudo. É a folha que se imprime
//    e se deixa do lado do monitor.
// 2. O gabarito, EM VETOR e no tamanho real da peça. É a diferença que
//    justifica ter trocado o PNG por PDF: um PNG é referência visual, este
//    arquivo o designer abre no Illustrator e monta a arte em cima, sem
//    redesenhar nada e sem errar de um milímetro.

import { especificacao } from './regras.js'
import { pagina, montarPdf, cmParaPt, LIMITE_PT } from './pdfSaida.js'

const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))
const A4 = { largura: 595.28, altura: 841.89 }
const MARGEM = 48

const TINTA = [0.09, 0.1, 0.12]
const SUAVE = [0.36, 0.39, 0.44]
const CORTE = [0, 0, 0]
const SANGRIA = [0.88, 0.38, 0.38]
const SEGURA = [0.16, 0.39, 0.79]

/**
 * A escala do desenho do gabarito.
 *
 * O PDF não aceita página maior que 200 polegadas (508 cm), e peça de stand
 * passa disso com frequência — uma parede de 6 m é rotina. Quando não cabe, o
 * desenho sai reduzido e a página DIZ em que escala saiu, porque um gabarito
 * reduzido sem aviso é pior que nenhum: o designer monta em cima dele e a arte
 * sai dez vezes menor.
 */
export function escalaDoGabarito(larguraCm, alturaCm) {
  const maior = Math.max(cmParaPt(larguraCm), cmParaPt(alturaCm))
  if (maior <= LIMITE_PT) return 1
  for (const fator of [2, 4, 5, 10, 20, 50]) {
    if (maior / fator <= LIMITE_PT) return fator
  }
  return 100
}

function fichaDeMedidas({ peca, perfil, spec, escalaFator, cadastro, resultado }) {
  const p = pagina(A4.largura, A4.altura)
  const largura = A4.largura - MARGEM * 2
  let y = A4.altura - MARGEM

  p.caixa(0, A4.altura - 6, A4.largura, 6, SEGURA)

  p.texto(MARGEM, y - 14, 'Especificação da peça', { tamanho: 19, negrito: true, cor: TINTA })
  y -= 34

  const identificacao = [cadastro?.stand, cadastro?.feira, cadastro?.nome]
    .filter(Boolean).join('  ·  ')
  if (identificacao) {
    p.texto(MARGEM, y, identificacao, { tamanho: 9.5, cor: SUAVE })
    y -= 14
  }
  p.texto(MARGEM, y, `${peca.rotulo || perfil.nome}  ·  ${perfil.nome}`, { tamanho: 12, negrito: true, cor: TINTA })
  y -= 22

  p.linha(MARGEM, y, A4.largura - MARGEM, y, [0.85, 0.87, 0.9], 1)
  y -= 22

  // ---------------------------------------------------------- as medidas
  const linhas = [
    ['Tamanho final (corte)', `${fmt(peca.larguraCm)} × ${fmt(peca.alturaCm)} cm`, true],
    ['Montar o arquivo neste tamanho', `${fmt(spec.comSangria.larguraCm)} × ${fmt(spec.comSangria.alturaCm)} cm`, true],
    ['Sangria', `${spec.sangriaMm} mm por lado`],
    ['Área segura (margem)', `${perfil.margemMm} mm a partir do corte`],
    ['Resolução mínima', `${fmt(spec.minimo.largura)} × ${fmt(spec.minimo.altura)} px  (${spec.minimo.dpi} dpi)`, true],
    ['Distância de leitura da peça', `${new Intl.NumberFormat('pt-BR').format(perfil.distanciaM)} m`],
  ]
  // Em boa parte das peças o ideal do perfil fica abaixo do piso da casa, e aí
  // `especificacao` iguala os dois. Duas linhas com o mesmo número não
  // informam nada e fazem o leitor procurar a diferença que não existe.
  if (spec.ideal.dpi > spec.minimo.dpi) {
    linhas.splice(5, 0, ['Resolução ideal', `${fmt(spec.ideal.largura)} × ${fmt(spec.ideal.altura)} px  (${spec.ideal.dpi} dpi)`])
  }
  if (escalaFator > 1) linhas.push(['Escala de trabalho', `1:${escalaFator}`, true])

  p.texto(MARGEM, y, 'MEDIDAS DO ARQUIVO', { tamanho: 8.5, negrito: true, cor: SUAVE })
  y -= 16

  for (const [rotulo, valor, destaque] of linhas) {
    if (destaque) p.caixa(MARGEM - 6, y - 5, largura + 12, 18, [0.96, 0.97, 0.99])
    p.texto(MARGEM, y, rotulo, { tamanho: 10, cor: SUAVE })
    p.texto(A4.largura - MARGEM, y, valor, {
      tamanho: 10, negrito: Boolean(destaque), cor: TINTA, direita: true,
    })
    y -= 20
  }

  y -= 6
  y = p.paragrafo(MARGEM, y, 'A sangria é arte além do corte, para o acabamento não deixar filete branco. '
    + 'Nada essencial — logo, texto, telefone — pode ficar dentro da área segura: perfis, calhas e a '
    + 'estrutura do stand comem essa faixa.', { largura, tamanho: 9, cor: SUAVE })
  y -= 26

  // ------------------------------------------------ o que precisa mudar
  const acionaveis = (resultado?.achados || [])
    .filter((a) => a.nivel === 'bloqueante' || a.nivel === 'ressalva')

  if (resultado) {
    p.linha(MARGEM, y, A4.largura - MARGEM, y, [0.85, 0.87, 0.9], 1)
    y -= 22
    p.texto(MARGEM, y, 'O QUE A CONFERÊNCIA APONTOU', { tamanho: 8.5, negrito: true, cor: SUAVE })
    y -= 16

    const arq = resultado.medidas?.arquivo
    if (arq?.nome) {
      p.texto(MARGEM, y, `Arquivo analisado: ${arq.nome}`, { tamanho: 9, cor: SUAVE })
      y -= 16
    }

    if (!acionaveis.length) {
      p.texto(MARGEM, y, 'Nada a corrigir — a arte atende ao que esta peça exige.', { tamanho: 10, cor: TINTA })
      y -= 18
    }

    acionaveis.forEach((a, i) => {
      const bloqueia = a.nivel === 'bloqueante'
      p.caixa(MARGEM - 6, y - 4, 3, 14, bloqueia ? SANGRIA : [0.85, 0.6, 0.15])
      y = p.paragrafo(MARGEM, y, `${i + 1}. ${a.titulo}`, {
        largura, tamanho: 10, negrito: true, cor: TINTA,
      })
      y -= 15
      if (a.detalhe) {
        y = p.paragrafo(MARGEM, y, a.detalhe, { largura, tamanho: 9, cor: SUAVE })
        y -= 14
      }
      if (a.acao) {
        y = p.paragrafo(MARGEM, y, `→ ${a.acao}`, { largura, tamanho: 9, cor: TINTA })
        y -= 14
      }
      y -= 6
    })
  }

  p.texto(MARGEM, MARGEM - 14, `Gerado em ${new Date().toLocaleString('pt-BR')} · a página 2 traz o gabarito em vetor`, {
    tamanho: 8, cor: SUAVE,
  })

  return p
}

function folhaDoGabarito({ peca, perfil, spec, escalaFator }) {
  const escalaDesenho = escalaDoGabarito(spec.comSangria.larguraCm, spec.comSangria.alturaCm)
  const W = cmParaPt(spec.comSangria.larguraCm) / escalaDesenho
  const H = cmParaPt(spec.comSangria.alturaCm) / escalaDesenho
  const p = pagina(W, H)

  const sangria = cmParaPt(spec.sangriaMm / 10) / escalaDesenho
  const margem = cmParaPt(perfil.margemMm / 10) / escalaDesenho
  const traco = Math.max(0.5, Math.min(W, H) / 400)

  // A faixa de sangria pintada: é o que faz "isto vai ser cortado" ser
  // entendido sem ler a legenda.
  p.caixa(0, 0, W, H, [1, 0.93, 0.93])
  p.caixa(sangria, sangria, W - 2 * sangria, H - 2 * sangria, [1, 1, 1])

  p.contorno(0, 0, W, H, SANGRIA, traco, [traco * 6, traco * 4])
  p.contorno(sangria, sangria, W - 2 * sangria, H - 2 * sangria, CORTE, traco * 1.6)
  p.contorno(
    sangria + margem, sangria + margem,
    W - 2 * (sangria + margem), H - 2 * (sangria + margem),
    SEGURA, traco, [traco * 4, traco * 3],
  )

  // Marcas de centro nos quatro lados — é por elas que se alinha a arte.
  const meio = [0.78, 0.78, 0.78]
  p.linha(W / 2, sangria, W / 2, sangria + margem, meio, traco)
  p.linha(W / 2, H - sangria, W / 2, H - sangria - margem, meio, traco)
  p.linha(sangria, H / 2, sangria + margem, H / 2, meio, traco)
  p.linha(W - sangria, H / 2, W - sangria - margem, H / 2, meio, traco)

  const fonte = Math.max(6, Math.min(W, H) / 46)
  const centro = W / 2
  let y = H / 2 + fonte * 3

  const escrever = (texto, opcoes = {}) => {
    p.texto(centro, y, texto, { tamanho: fonte, centro: true, cor: TINTA, ...opcoes })
    y -= fonte * 1.7
  }

  escrever(peca.rotulo || perfil.nome, { tamanho: fonte * 1.3, negrito: true })
  escrever(`Tamanho final ${fmt(peca.larguraCm)} × ${fmt(peca.alturaCm)} cm`
    + (escalaFator > 1 ? `  ·  montar em escala 1:${escalaFator}` : ''))
  escrever(`Com sangria ${fmt(spec.comSangria.larguraCm)} × ${fmt(spec.comSangria.alturaCm)} cm`
    + `  ·  sangria ${spec.sangriaMm} mm  ·  área segura ${perfil.margemMm} mm`)
  escrever(`Mínimo ${fmt(spec.minimo.largura)} × ${fmt(spec.minimo.altura)} px (${spec.minimo.dpi} dpi)`
    + (spec.ideal.dpi > spec.minimo.dpi
      ? `  ·  ideal ${fmt(spec.ideal.largura)} × ${fmt(spec.ideal.altura)} px (${spec.ideal.dpi} dpi)`
      : ''), { cor: SUAVE })

  y -= fonte * 0.6
  escrever('vermelho = sangria, será cortada', { cor: SANGRIA, tamanho: fonte * 0.9 })
  escrever('azul tracejado = área segura: nada essencial fora dela', { cor: SEGURA, tamanho: fonte * 0.9 })

  // O aviso de escala é o mais importante da folha quando ela sai reduzida.
  if (escalaDesenho > 1) {
    y -= fonte * 0.8
    escrever(`ESTA FOLHA SAIU EM 1:${escalaDesenho} — a peça passa do tamanho máximo de um PDF.`,
      { negrito: true, tamanho: fonte * 1.05 })
    escrever(`Multiplique tudo por ${escalaDesenho} ao montar em tamanho real.`, { cor: SUAVE, tamanho: fonte * 0.9 })
  }

  return p
}

/**
 * Gera a folha de especificação da peça.
 *
 * `resultado` é opcional: com ele a ficha traz o que a conferência apontou;
 * sem ele é a especificação limpa, que serve para começar a arte.
 */
export function especificacaoEmPdf({ peca, perfil, politica, escalaFator = 1, cadastro = null, resultado = null }) {
  const spec = especificacao(peca, perfil, politica)
  return montarPdf(
    [
      fichaDeMedidas({ peca, perfil, spec, escalaFator, cadastro, resultado }),
      folhaDoGabarito({ peca, perfil, spec, escalaFator }),
    ],
    { titulo: `Especificação — ${peca.rotulo || perfil.nome}` },
  )
}

/** Nome de arquivo estável e reconhecível na pasta de downloads do designer. */
export function nomeDoArquivo(peca, perfil) {
  const base = String(peca.rotulo || perfil.nome || 'peca')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')
  return `especificacao-${base}-${fmt(peca.larguraCm)}x${fmt(peca.alturaCm)}cm.pdf`
}
