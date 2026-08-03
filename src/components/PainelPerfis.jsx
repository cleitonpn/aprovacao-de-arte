import { useState } from 'react'
import { restaurarPerfis } from '../data/perfis.js'

// Painel do time de comunicação visual. Os limiares TÊM que ser editáveis por
// quem conhece a operação — a alternativa é a ferramenta ficar errada para
// sempre porque ninguém mexe em código para ajustar um dpi.

const CAMPOS = [
  { chave: 'distanciaM', rotulo: 'Distância (m)', passo: 0.5, min: 0.1 },
  { chave: 'dpiMin', rotulo: 'DPI mínimo', passo: 5, min: 5 },
  { chave: 'dpiIdeal', rotulo: 'DPI ideal', passo: 5, min: 5 },
  { chave: 'sangriaMm', rotulo: 'Sangria (mm)', passo: 1, min: 0 },
  { chave: 'margemMm', rotulo: 'Margem segura (mm)', passo: 5, min: 0 },
]

export default function PainelPerfis({ perfis, onSalvar, politica, onPolitica, detectorNitidez, onDetector }) {
  const [aberto, setAberto] = useState(false)

  const alterar = (id, chave, valor) => {
    onSalvar(perfis.map((p) => (p.id === id ? { ...p, [chave]: Number(valor) || 0 } : p)))
  }

  return (
    <section className="cartao">
      <button className="cabecalho-colapsa" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        <h2>Regras por tipo de peça</h2>
        <span aria-hidden>{aberto ? '−' : '+'}</span>
      </button>

      {aberto && (
        <>
          <div className="piso">
            <div className="linha">
              <label className="campo">
                <span>Piso de DPI (toda peça)</span>
                <input
                  type="number" min="10" step="10" value={politica.dpiMinimoGlobal}
                  onChange={(e) => onPolitica({ dpiMinimoGlobal: Math.max(10, Number(e.target.value) || 0) })}
                />
              </label>
              <label className="campo">
                <span>Sangria mínima (mm, cada lado)</span>
                <input
                  type="number" min="0" step="10" value={politica.sangriaMinimaMm}
                  onChange={(e) => onPolitica({ sangriaMinimaMm: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            </div>
            <p className="nota">
              Pisos da empresa: valem para toda peça. Os valores por tipo de peça
              na tabela abaixo só são aplicados quando forem <em>mais</em>
              exigentes que o piso.
            </p>
          </div>

          <p className="ajuda">
            Ajuste os limiares conforme a experiência de vocês com cada material.
            Fica salvo neste navegador.
          </p>
          <div className="tabela-rolagem">
            <table className="perfis">
              <thead>
                <tr>
                  <th>Peça</th>
                  {CAMPOS.map((c) => <th key={c.chave}>{c.rotulo}</th>)}
                </tr>
              </thead>
              <tbody>
                {perfis.map((p) => (
                  <tr key={p.id}>
                    <td className="nome">{p.nome}</td>
                    {CAMPOS.map((c) => (
                      <td key={c.chave}>
                        <input
                          type="number"
                          min={c.min}
                          step={c.passo}
                          value={p[c.chave]}
                          onChange={(e) => alterar(p.id, c.chave, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="alternador experimental">
            <input
              type="checkbox"
              checked={detectorNitidez}
              onChange={(e) => onDetector(e.target.checked)}
            />
            <span>
              <strong>Detector de nitidez real (experimental)</strong>
              <em>
                Avisa quando o arquivo não sustenta a resolução que declara — imagem
                pequena ampliada no editor. Vem desligado: nos testes com conteúdo real
                ele ainda oscila, e calibrá-lo exige rodar o acervo de artes já aprovadas
                e já recusadas de vocês. Os números aparecem no laudo técnico de qualquer
                forma. Ligue só depois de calibrar — ver README.
              </em>
            </span>
          </label>

          <button className="btn btn-ghost" onClick={() => onSalvar(restaurarPerfis())}>
            Restaurar valores padrão
          </button>
        </>
      )}
    </section>
  )
}
