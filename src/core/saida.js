import { formatarDataHora as fmtData } from './datas.js'

// Levar os arquivos da feira para fora da ferramenta.
//
// Isto morava na aba "Artes recebidas", que saiu — a gestão passou a ser feita
// pela Visão geral e por Projetos. O que a aba tinha de insubstituível era
// justamente isto: baixar as artes em lote e exportar a planilha. Na semana da
// montagem alguém precisa levar setenta arquivos para a máquina de produção, e
// clicar em setenta links não é um caminho.

const ROTULO = { aprovado: 'Aprovada', ressalva: 'Com ressalva', reprovado: 'Reprovada' }

export async function baixarEmLote(itens, aoProgredir) {
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i]
    if (!item.link) continue
    const a = document.createElement('a')
    a.href = item.link
    a.download = item.nomeSugerido || ''
    a.target = '_blank'
    a.rel = 'noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    aoProgredir?.(i + 1, itens.length)
    await new Promise((r) => setTimeout(r, 900))
  }
}

export function paraCsv(envios) {
  const cabecalho = ['Protocolo', 'Tipo', 'Expositor', 'E-mail', 'Stand', 'Localizacao', 'Peca', 'Largura_cm', 'Altura_cm', 'Veredicto', 'Risco_aceito', 'Enviado_em', 'Arquivo', 'Link']
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const linhas = envios.map((e) => [
    e.protocolo, e.tipoEnvio === 'avulso' ? 'apoio' : 'arte',
    e.cadastro?.nome, e.cadastro?.email, e.cadastro?.stand, e.cadastro?.localizacao,
    e.pecaRotulo || e.perfil?.nome, e.peca?.larguraCm, e.peca?.alturaCm,
    ROTULO[e.veredicto] || e.veredicto || '—',
    e.riscoAceito ? 'sim' : 'nao', fmtData(e.criadoEm), e.arquivo?.nome, e.link,
  ].map(escapar).join(';'))
  // BOM para o Excel abrir os acentos corretamente
  return '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n')
}

export function baixarTexto(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
