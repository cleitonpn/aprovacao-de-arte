// Estado da análise de um arquivo.
//
// Vive num hook porque duas telas precisam do mesmo comportamento: a
// ferramenta aberta (o cliente digita a medida) e a tela do projeto (a medida
// vem cadastrada). Duplicar isso significaria, na prática, duas ferramentas
// que envelhecem em ritmos diferentes.

import { useCallback, useEffect, useState } from 'react'
import { analisar } from '../core/analise.js'
import { listar, registrar, marcarRiscoAceito } from './historico.js'

// Espera antes de reanalisar. Digitar "275" na largura dispara três mudanças
// de estado, e cada análise relê o arquivo inteiro (decodifica a imagem, roda
// a FFT). Numa arte de centenas de MB isso travaria a página a cada tecla.
const ESPERA_MS = 450

export function usarAnalise({ peca, perfil, escalaFator = 1, politica, detectorNitidez }) {
  const [arquivo, setArquivo] = useState(null)
  const [analisando, setAnalisando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [registroAtual, setRegistroAtual] = useState(null)
  const [registros, setRegistros] = useState(listar)

  const rodar = useCallback(async (arq) => {
    setAnalisando(true)
    setErro(null)
    setResultado(null)
    setRegistroAtual(null)
    try {
      const r = await analisar(arq, peca, perfil, { escalaFator, politica, detectorNitidez })
      setResultado(r)
      const reg = registrar({
        hash: r.medidas.arquivo?.hash,
        nome: r.medidas.arquivo?.nome,
        veredicto: r.veredicto,
        peca: `${perfil.nome} ${peca.larguraCm}×${peca.alturaCm} cm`,
        dpi: r.resolucao?.dpi ?? null,
      })
      setRegistroAtual(reg)
      setRegistros(listar())
    } catch (e) {
      console.error(e)
      setErro(e?.message || 'Não foi possível ler este arquivo.')
    } finally {
      setAnalisando(false)
    }
  }, [peca, perfil, escalaFator, politica, detectorNitidez])

  // Trocar a peça ou a escala muda o veredicto — reanalisa sem novo upload.
  useEffect(() => {
    if (!arquivo) return undefined
    const t = setTimeout(() => rodar(arquivo), ESPERA_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.id, peca?.larguraCm, peca?.alturaCm, escalaFator, politica, detectorNitidez])

  const receberArquivo = useCallback((arq) => {
    setArquivo(arq)
    rodar(arq)
  }, [rodar])

  const aceitarRisco = useCallback(() => {
    if (!registroAtual) return
    setRegistros(marcarRiscoAceito(registroAtual.id))
    setRegistroAtual((r) => ({ ...r, riscoAceito: { em: new Date().toISOString() } }))
  }, [registroAtual])

  const limpar = useCallback(() => {
    setArquivo(null)
    setResultado(null)
    setErro(null)
    setRegistroAtual(null)
  }, [])

  return {
    arquivo, analisando, resultado, erro,
    registroAtual, riscoAceito: registroAtual?.riscoAceito,
    registros, setRegistros,
    receberArquivo, aceitarRisco, limpar,
  }
}
