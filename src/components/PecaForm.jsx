import { ESCALAS } from '../data/perfis.js'
import { especificacao } from '../core/regras.js'

const fmt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n))

export default function PecaForm({ perfis, perfilId, peca, escalaFator, politica, onChange }) {
  const perfil = perfis.find((p) => p.id === perfilId) || perfis[0]
  const spec = especificacao(peca, perfil, politica)

  return (
    <section className="cartao">
      <h2>1. A peça</h2>
      <p className="ajuda">
        O critério de qualidade muda com a distância de onde a peça é vista.
        Uma testeira a 5 m aceita 30 dpi; um adesivo de balcão, não.
      </p>

      <label className="campo">
        <span>Tipo de peça</span>
        <select value={perfilId} onChange={(e) => onChange({ perfilId: e.target.value })}>
          {perfis.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
      </label>

      {perfil.obs && <p className="nota">{perfil.obs}</p>}

      <div className="linha">
        <label className="campo">
          <span>Largura (cm)</span>
          <input
            type="number" min="1" step="1" value={peca.larguraCm}
            onChange={(e) => onChange({ peca: { ...peca, larguraCm: Math.max(1, Number(e.target.value) || 0) } })}
          />
        </label>
        <label className="campo">
          <span>Altura (cm)</span>
          <input
            type="number" min="1" step="1" value={peca.alturaCm}
            onChange={(e) => onChange({ peca: { ...peca, alturaCm: Math.max(1, Number(e.target.value) || 0) } })}
          />
        </label>
      </div>

      <label className="campo">
        <span>Escala em que a arte foi montada</span>
        <select value={escalaFator} onChange={(e) => onChange({ escalaFator: Number(e.target.value) })}>
          {ESCALAS.map((e) => (
            <option key={e.id} value={e.fator}>{e.rotulo}</option>
          ))}
        </select>
      </label>
      <p className="nota">
        Montar a arte reduzida é praxe no grande formato. Informar a escala evita
        que um arquivo correto seja reprovado por engano.
      </p>

      <div className="spec">
        <div className="spec-titulo">O que pedir ao designer</div>
        <dl>
          <div>
            <dt>Tamanho final</dt>
            <dd>{fmt(peca.larguraCm)} × {fmt(peca.alturaCm)} cm</dd>
          </div>
          <div>
            <dt>Com sangria ({spec.sangriaMm} mm por lado)</dt>
            <dd>{fmt(spec.comSangria.larguraCm)} × {fmt(spec.comSangria.alturaCm)} cm</dd>
          </div>
          <div>
            <dt>Margem de segurança</dt>
            <dd>{perfil.margemMm} mm</dd>
          </div>
          <div className="destaque">
            <dt>Mínimo com sangria ({spec.minimo.dpi} dpi)</dt>
            <dd>{fmt(spec.minimo.largura)} × {fmt(spec.minimo.altura)} px</dd>
          </div>
          <div className="destaque">
            <dt>Ideal com sangria ({spec.ideal.dpi} dpi)</dt>
            <dd>{fmt(spec.ideal.largura)} × {fmt(spec.ideal.altura)} px</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
