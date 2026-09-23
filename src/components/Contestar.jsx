import { useState } from 'react'
import {
  validarContestacao, contestacaoParaEnvio, MINIMO_MOTIVO,
} from '../core/contestacao.js'

/**
 * "Acho que esta arte está correta" — a quarta saída da caixa "E agora?".
 *
 * Ela morava embaixo do botão de enviar, como um link solto, e ficava invisível
 * justamente para quem precisa dela: o cliente convicto de que a arte está
 * certa lê a caixa azul, não a letra miúda do botão desligado. Aqui ela está
 * onde as outras saídas estão, com o mesmo peso — que é o certo, porque é uma
 * saída legítima e não um truque escondido.
 *
 * Continua sendo a ÚLTIMA da lista, e isso não é timidez. As três primeiras
 * resolvem o problema de verdade (corrigir o arquivo); esta pede o tempo de uma
 * pessoa do time. Oferecida antes das outras, ela viraria o primeiro clique de
 * quem só quer se livrar da tela — e aí a fila enche de caso que um arquivo
 * novo resolveria em dois minutos.
 *
 * O componente guarda o próprio formulário e entrega pronto: quem chama recebe
 * a contestação já validada e não precisa saber quais campos existem.
 */
export default function Contestar({ onEnviar, enviando }) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [erros, setErros] = useState({})

  if (!aberto) {
    return (
      <li>
        <strong>Você tem certeza de que esta arte está correta</strong>
        <p>
          Se você acha que a análise errou, mande o arquivo para o time avaliar.
          Uma pessoa abre a arte e responde por escrito, aceitando ou não.{' '}
          <strong>A peça não conta como entregue</strong> enquanto a resposta
          não sair.
        </p>
        <button className="btn btn-ghost" onClick={() => setAberto(true)}>
          Contestar a reprovação
        </button>
      </li>
    )
  }

  return (
    <li>
      <strong>Contestar a reprovação</strong>
      <p>
        O arquivo vai para o time junto com o que você escrever aqui. A resposta
        vem por escrito, com o motivo — aceitando ou não.
      </p>

      <label className="campo">
        <span>Por que você considera esta arte correta?</span>
        <textarea
          rows={4}
          maxLength={1000}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: a arte foi montada em 1:10 e tem 310 dpi na escala de trabalho — no tamanho final dá 31 dpi porque a ferramenta leu como tamanho real."
        />
        {erros.motivo && <em className="erro-campo">{erros.motivo}</em>}
        <em className="dica-campo">
          {motivo.trim().length}/{MINIMO_MOTIVO} mínimo — quanto mais concreto,
          mais rápido alguém consegue decidir.
        </em>
      </label>

      <div className="linha">
        <label className="campo">
          <span>Seu nome</span>
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
          {erros.nome && <em className="erro-campo">{erros.nome}</em>}
        </label>
        <label className="campo">
          <span>Seu e-mail <em className="opcional">(para avisarmos da resposta)</em></span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          {erros.email && <em className="erro-campo">{erros.email}</em>}
        </label>
      </div>

      <div className="acoes">
        <button
          className="btn btn-risco"
          disabled={enviando}
          onClick={() => {
            const { valido, erros: novos } = validarContestacao({ motivo, nome, email })
            setErros(novos)
            if (valido) onEnviar(contestacaoParaEnvio({ motivo, nome, email }))
          }}
        >
          {enviando ? 'Enviando…' : 'Enviar para o time avaliar'}
        </button>
        <button className="link" type="button" disabled={enviando} onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>

      <p className="nota">
        Fica registrado com o seu nome e não pode ser apagado — nem por você, nem
        pelo time. É o que faz dele um argumento no dia em que a peça for
        discutida.
      </p>
    </li>
  )
}
