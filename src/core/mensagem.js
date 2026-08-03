// Gera o texto pronto para o cliente encaminhar ao designer dele.
//
// Esta função é, provavelmente, a peça de maior retorno do projeto inteiro.
// O ciclo vicioso não se sustenta na dificuldade de avaliar a arte — se
// sustenta no e-mail "a arte está em baixa qualidade", que o designer do
// cliente não sabe traduzir em ação. Um texto com os pixels exatos encerra a
// conversa numa mensagem só.

import { especificacao, ROTULO_VEREDICTO } from './regras.js'

const fmt = new Intl.NumberFormat('pt-BR')
const n = (v, casas = 0) => fmt.format(Number(Number(v).toFixed(casas)))

export function mensagemParaDesigner(resultado) {
  const { peca, perfil, achados, veredicto, medidas, escalaFator } = resultado
  const spec = especificacao(peca, perfil, resultado.politica)
  const linhas = []

  linhas.push(`Peça: ${perfil.nome}`)
  linhas.push(`Tamanho final: ${n(peca.larguraCm)} × ${n(peca.alturaCm)} cm`)
  linhas.push(`Com sangria (${spec.sangriaMm} mm por lado): ${n(spec.comSangria.larguraCm)} × ${n(spec.comSangria.alturaCm)} cm`)
  linhas.push(`Margem de segurança: ${perfil.margemMm} mm (nada de logo ou texto nessa faixa)`)
  linhas.push(`Resolução mínima (no arquivo com sangria): ${n(spec.minimo.largura)} × ${n(spec.minimo.altura)} px (${spec.minimo.dpi} dpi)`)
  linhas.push(`Resolução ideal (no arquivo com sangria): ${n(spec.ideal.largura)} × ${n(spec.ideal.altura)} px (${spec.ideal.dpi} dpi)`)
  if (escalaFator > 1) linhas.push(`Arte montada em escala 1:${escalaFator}`)
  linhas.push('')

  linhas.push(`Arquivo avaliado: ${medidas.arquivo?.nome || '—'}`)
  if (medidas.larguraPx) linhas.push(`Enviado com: ${n(medidas.larguraPx)} × ${n(medidas.alturaPx)} px`)
  linhas.push(`Resultado: ${ROTULO_VEREDICTO[veredicto]}`)
  linhas.push('')

  const acionaveis = achados.filter((a) => a.nivel === 'bloqueante' || a.nivel === 'ressalva')
  if (!acionaveis.length) {
    linhas.push('Nenhum ajuste necessário — a arte está liberada para impressão.')
  } else {
    linhas.push('Ajustes necessários:')
    acionaveis.forEach((a, i) => {
      linhas.push(`${i + 1}. ${a.titulo}`)
      if (a.detalhe) linhas.push(`   ${a.detalhe}`)
      if (a.acao) linhas.push(`   → ${a.acao}`)
    })
  }

  const info = achados.filter((a) => a.nivel === 'info')
  if (info.length) {
    linhas.push('')
    linhas.push('Observações (não impedem a impressão):')
    info.forEach((a) => linhas.push(`- ${a.titulo}${a.acao ? ` → ${a.acao}` : ''}`))
  }

  return linhas.join('\n')
}

/** Laudo estruturado — é o que a fase 2 vai gravar no Firebase. */
export function laudoJson(resultado) {
  const { peca, perfil, achados, veredicto, medidas, escalaFator } = resultado
  const espec = especificacao(peca, perfil, resultado.politica)
  return {
    versao: 1,
    analisadoEm: medidas.analisadoEm,
    veredicto,
    arquivo: {
      nome: medidas.arquivo?.nome,
      tamanhoBytes: medidas.arquivo?.tamanho,
      sha256: medidas.arquivo?.hash,
      formato: medidas.formato,
    },
    peca: { ...peca, escalaFator },
    politica: resultado.politica ?? null,
    perfil: {
      id: perfil.id, nome: perfil.nome, dpiMin: perfil.dpiMin, dpiIdeal: perfil.dpiIdeal,
      sangriaMm: perfil.sangriaMm, margemMm: perfil.margemMm, distanciaM: perfil.distanciaM,
    },
    // Os valores do perfil acima são os brutos; os que valeram de fato na
    // análise — já com os pisos da empresa aplicados — estão aqui.
    especificacao: espec,
    medidas: {
      larguraPx: medidas.larguraPx ?? null,
      alturaPx: medidas.alturaPx ?? null,
      dpiEfetivo: resultado.resolucao?.dpi ?? null,
      puroVetor: medidas.puroVetor ?? false,
      qualidadeJpeg: medidas.qualidadeJpeg ?? null,
      blocagem: medidas.blocagem ?? null,
      detalheRealSustentado: medidas.inflacao?.confiavel ? medidas.inflacao.detalheReal : null,
      quedaEspectralDb: medidas.inflacao?.quedaDb ?? null,
      cmyk: medidas.cmyk ?? null,
      temICC: medidas.temICC ?? null,
      paginas: medidas.paginas ?? null,
    },
    // `?? null` em cada campo, e não só na desestruturação: nem todo achado
    // tem detalhe ou ação — o de arquivo vetorial, por exemplo, não tem ação.
    // A chave viria com `undefined`, e o Firestore recusa o documento inteiro
    // quando encontra um só campo assim.
    achados: achados.map(({ id, nivel, titulo, detalhe, acao }) => ({
      id: id ?? null,
      nivel: nivel ?? null,
      titulo: titulo ?? null,
      detalhe: detalhe ?? null,
      acao: acao ?? null,
    })),
  }
}

/**
 * Remove qualquer `undefined` de uma estrutura, trocando por null.
 *
 * O Firestore recusa o documento inteiro se encontrar um único campo
 * `undefined`, e a mensagem só diz em qual documento — não em qual campo.
 * Como o laudo cresce junto com as regras de análise, uma rede de segurança
 * aqui evita que um campo novo derrube o envio de um cliente lá na frente.
 */
export function semIndefinidos(valor) {
  if (valor === undefined) return null
  if (Array.isArray(valor)) return valor.map(semIndefinidos)
  // Só descemos em objeto simples. Reconstruir qualquer outra coisa seria
  // destrutivo: `serverTimestamp()` devolve um objeto sentinela do Firestore,
  // e copiar campo a campo o transformaria num objeto comum — o carimbo de
  // data do servidor viraria lixo sem ninguém perceber. Vale para Date,
  // Blob, referências e o que mais o SDK trouxer.
  if (!ehObjetoSimples(valor)) return valor
  const saida = {}
  for (const [chave, v] of Object.entries(valor)) saida[chave] = semIndefinidos(v)
  return saida
}

function ehObjetoSimples(v) {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}
