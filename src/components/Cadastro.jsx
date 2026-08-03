import { useState } from 'react'
import { CAMPOS, CADASTRO_VAZIO, validar, normalizar } from '../data/cadastro.js'

// Porta de entrada da ferramenta. Fica curto de propósito: cada campo a mais
// aqui é um expositor a menos chegando até a análise.

export default function Cadastro({ inicial, onConfirmar, compacto = false, onCancelar }) {
  const [dados, setDados] = useState(inicial || CADASTRO_VAZIO)
  const [erros, setErros] = useState({})
  const [tentou, setTentou] = useState(false)

  const alterar = (chave, valor) => {
    const novo = { ...dados, [chave]: valor }
    setDados(novo)
    if (tentou) setErros(validar(novo).erros)
  }

  const enviar = (e) => {
    e.preventDefault()
    setTentou(true)
    const { valido, erros: novos } = validar(dados)
    setErros(novos)
    if (valido) onConfirmar(normalizar(dados))
  }

  return (
    <form className={`cartao cadastro ${compacto ? 'compacto' : ''}`} onSubmit={enviar} noValidate>
      {!compacto && (
        <>
          <h2>Antes de começar</h2>
          <p className="ajuda">
            Precisamos saber de qual stand é a arte, para que ela chegue ao time
            certo. É rápido e fica salvo — nas próximas peças você já entra direto.
          </p>
        </>
      )}

      {CAMPOS.map((campo) => (
        <label className="campo" key={campo.chave}>
          <span>
            {campo.rotulo}
            {!campo.obrigatorio && <em className="opcional"> (opcional)</em>}
          </span>
          <input
            type={campo.tipo}
            value={dados[campo.chave] || ''}
            autoComplete={campo.autoComplete}
            aria-invalid={Boolean(erros[campo.chave])}
            onChange={(e) => alterar(campo.chave, e.target.value)}
          />
          {erros[campo.chave]
            ? <em className="erro-campo">{erros[campo.chave]}</em>
            : campo.dica && <em className="dica-campo">{campo.dica}</em>}
        </label>
      ))}

      <div className="acoes">
        <button className="btn" type="submit">{compacto ? 'Salvar' : 'Continuar'}</button>
        {onCancelar && (
          <button className="btn btn-ghost" type="button" onClick={onCancelar}>Cancelar</button>
        )}
      </div>

      {!compacto && (
        <p className="nota">
          Usamos esses dados apenas para identificar a arte e falar com você
          sobre ela. O arquivo só sai do seu computador se você clicar em
          enviar, depois da análise.
        </p>
      )}
    </form>
  )
}
