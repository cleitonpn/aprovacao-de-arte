import { useState } from 'react'
import { limpar } from '../store/historico.js'

const ROTULO = { aprovado: 'Aprovada', ressalva: 'Com ressalva', reprovado: 'Reprovada' }

export default function Historico({ registros, onMudar }) {
  const [aberto, setAberto] = useState(false)
  if (!registros.length) return null

  const total = registros.length
  const primeiraVez = registros.filter((r) => r.veredicto === 'aprovado').length

  return (
    <section className="cartao">
      <button className="cabecalho-colapsa" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        <h2>Histórico ({total})</h2>
        <span aria-hidden>{aberto ? '−' : '+'}</span>
      </button>

      {aberto && (
        <>
          <p className="ajuda">
            {primeiraVez} de {total} análises passaram sem ressalva
            ({Math.round((primeiraVez / total) * 100)}%). Acompanhar esse número ao
            longo do tempo é a medida real de o ciclo estar encurtando.
          </p>
          <ul className="historico">
            {registros.slice(0, 25).map((r) => (
              <li key={r.id} className={r.veredicto}>
                <span className="tag">{ROTULO[r.veredicto]}</span>
                <span className="arq">{r.nome}</span>
                <span className="meta">
                  {r.peca} · {new Date(r.registradoEm).toLocaleDateString('pt-BR')}
                  {r.riscoAceito && ' · risco aceito'}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn btn-ghost" onClick={() => onMudar(limpar())}>Limpar histórico</button>
        </>
      )}
    </section>
  )
}
