import { PERFIS_PADRAO, ESCALAS } from '../data/perfis.js'
import { pecaNova, perfilPorTexto, MAXIMO_PECAS } from '../data/projeto.js'

// O editor de peças de um stand.
//
// Extraído do formulário de projeto para a importação da produção poder usar o
// MESMO editor. Uma segunda cópia divergiria na primeira mudança de regra — e
// aqui divergir significa cadastrar a peça de um jeito na tela de edição e de
// outro na importação, com o cliente recebendo medidas diferentes conforme o
// caminho que o analista tomou.
//
// O gabarito é opcional porque nem todo contexto tem stand: no modelo de peças
// aplicado a vários stands de uma vez, um gabarito só faria sentido se fosse o
// mesmo desenho para todos, o que quase nunca é verdade.

export default function ListaDePecas({
  pecas,
  onMudar,
  erros = {},
  Gabarito = null,
  vazio = 'Nenhuma peça ainda.',
}) {
  const alterar = (i, mudanca) => onMudar(pecas.map((p, j) => (j === i ? { ...p, ...mudanca } : p)))
  const remover = (i) => onMudar(pecas.filter((_, j) => j !== i))
  const adicionar = () => onMudar([...pecas, pecaNova()])

  return (
    <>
      {!pecas.length && <p className="dica-campo">{vazio}</p>}

      {pecas.map((peca, i) => (
        <div className="peca-editor" key={peca.id}>
          <div className="linha">
            <label className="campo cresce">
              <span>Nome da peça</span>
              <input
                type="text" value={peca.rotulo}
                placeholder="Lona de fundo"
                onChange={(e) => alterar(i, {
                  rotulo: e.target.value,
                  // Enquanto o tipo não for escolhido à mão, ele acompanha o
                  // nome: quem digita "adesivo de balcão" não deveria precisar
                  // repetir a informação no seletor ao lado.
                  ...(peca.tipoManual ? {} : { perfilId: perfilPorTexto(e.target.value) }),
                })}
              />
            </label>
            <label className="campo">
              <span>Tipo</span>
              <select
                value={peca.perfilId}
                onChange={(e) => alterar(i, { perfilId: e.target.value, tipoManual: true })}
              >
                {PERFIS_PADRAO.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
          </div>
          <div className="linha">
            <label className="campo">
              <span>Largura (cm)</span>
              <input
                type="number" min="1" step="0.1" value={peca.larguraCm || ''}
                onChange={(e) => alterar(i, { larguraCm: Number(e.target.value) })}
              />
            </label>
            <label className="campo">
              <span>Altura (cm)</span>
              <input
                type="number" min="1" step="0.1" value={peca.alturaCm || ''}
                onChange={(e) => alterar(i, { alturaCm: Number(e.target.value) })}
              />
            </label>
            <label className="campo">
              <span>Escala aceita</span>
              <select value={peca.escalaFator} onChange={(e) => alterar(i, { escalaFator: Number(e.target.value) })}>
                {ESCALAS.map((s) => <option key={s.id} value={s.fator}>{s.rotulo}</option>)}
              </select>
            </label>
            <button className="btn btn-ghost perigo" type="button" onClick={() => remover(i)}>
              Remover
            </button>
          </div>
          {Gabarito && <Gabarito peca={peca} onMudar={(gabarito) => alterar(i, { gabarito })} />}
          {erros.porPeca?.[i] && <em className="erro-campo">{erros.porPeca[i]}</em>}
        </div>
      ))}

      <div className="acoes">
        <button
          className="btn btn-ghost"
          type="button"
          disabled={pecas.length >= MAXIMO_PECAS}
          onClick={adicionar}
        >
          Adicionar peça
        </button>
      </div>
    </>
  )
}
