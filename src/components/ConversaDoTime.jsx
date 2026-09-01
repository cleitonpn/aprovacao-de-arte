import { useEffect, useMemo, useReducer, useState } from 'react'
import Conversa from './Conversa.jsx'
import { temMensagemNova, chaveDaConversa } from '../core/conversa.js'
import { assinarVisto, vistoEm, dataEmMs } from '../store/visto.js'

// A conversa do time, em qualquer tela.
//
// Antes ela vivia dentro da ficha do stand, e isso escondia o começo de tudo:
// para responder uma mensagem era preciso saber de qual cliente ela era,
// escolher a feira, achar o stand na lista e abrir a ficha. Quem chega de manhã
// com quatro respostas para dar fazia esse caminho quatro vezes — e a resposta
// que demora um dia é a mesma coisa que a resposta que não veio.
//
// Aqui a ordem se inverte: a bolha lista quem falou, e o clique abre a conversa.
// O stand vem junto da mensagem, que é como a informação existe na cabeça de
// quem está lendo — "o pessoal da After Click perguntou" e não "preciso abrir a
// ficha da After Click para ver se perguntaram".

const naoLidas = (projetos, email) => projetos
  .filter((p) => temMensagemNova({
    conversa: p.conversa,
    ehTime: true,
    vistoEmMs: vistoEm(email, chaveDaConversa(p.token)),
  }))
  .sort((a, b) => dataEmMs(b.conversa?.ultimaEm) - dataEmMs(a.conversa?.ultimaEm))

/** Projetos que já têm alguma conversa, do mais recente para o mais antigo. */
const comHistorico = (projetos) => projetos
  .filter((p) => p.conversa?.ultimaEm)
  .sort((a, b) => dataEmMs(b.conversa?.ultimaEm) - dataEmMs(a.conversa?.ultimaEm))

export default function ConversaDoTime({ sessao, projetos = [], feiras = [] }) {
  const [aberta, setAberta] = useState(false)
  const [token, setToken] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [feiraId, setFeiraId] = useState('')

  // O localStorage não avisa quando muda; sem esta inscrição, ler uma conversa
  // deixaria a badge acesa até um F5 — o mesmo F5 que a escuta em tempo real
  // veio eliminar.
  const [, redesenhar] = useReducer((n) => n + 1, 0)
  useEffect(() => assinarVisto(redesenhar), [])

  useEffect(() => {
    if (!aberta) return undefined
    const aoTeclar = (e) => { if (e.key === 'Escape') { if (token) setToken(null); else setAberta(false) } }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberta, token])

  const email = sessao?.usuario?.email
  const novas = useMemo(() => naoLidas(projetos, email), [projetos, email])

  const lista = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    const base = t || feiraId ? projetos : comHistorico(projetos)
    return base
      .filter((p) => !feiraId || p.feiraId === feiraId)
      .filter((p) => !t || [p.stand, p.expositor, p.email].some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => String(a.stand || '').localeCompare(String(b.stand || ''), 'pt-BR'))
      .slice(0, 40)
  }, [projetos, filtro, feiraId])

  const ativo = token ? projetos.find((p) => p.token === token) : null

  return (
    <div className={`conversa-flutuante ${aberta ? 'aberta' : ''}`}>
      {aberta && (
        <section className="conversa-painel" role="dialog" aria-label="Conversas com os clientes">
          <header className="conversa-painel-topo">
            <div>
              {ativo ? (
                <>
                  <button className="link" onClick={() => setToken(null)}>← Todas as conversas</button>
                  <strong>{ativo.stand}</strong>
                  <span className="dica-campo">{ativo.expositor}</span>
                </>
              ) : (
                <>
                  <strong>Conversas</strong>
                  <span className="dica-campo">
                    {novas.length
                      ? `${novas.length} com mensagem nova`
                      : 'Escolha um stand para falar com o cliente'}
                  </span>
                </>
              )}
            </div>
            <button className="conversa-fechar" onClick={() => setAberta(false)} aria-label="Fechar">×</button>
          </header>

          <div className="conversa-painel-corpo">
            {ativo ? (
              <Conversa token={ativo.token} ehTime sessao={sessao} embutida />
            ) : (
              <>
                {/*
                  As não lidas primeiro, sem depender de busca. É o caso do dia:
                  chegou mensagem, quem respondo agora. Procurar um stand para
                  iniciar uma conversa é o caso raro, e fica abaixo.
                */}
                {novas.length > 0 && (
                  <div className="conversa-novas">
                    <p className="dica-campo">Esperando resposta</p>
                    <ul className="lista-conversas">
                      {novas.map((p) => (
                        <li key={p.token}>
                          <button onClick={() => setToken(p.token)}>
                            <span className="ponto-novo" aria-hidden />
                            <span className="conversa-nome">
                              <strong>{p.stand}</strong>
                              <em className="dica-campo">{p.expositor}</em>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <label className="campo">
                  <span>Feira</span>
                  <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
                    <option value="">Todas</option>
                    {feiras.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </label>
                <label className="campo">
                  <span>Stand ou cliente</span>
                  <input
                    type="text"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                    placeholder="digite para procurar"
                  />
                </label>

                <ul className="lista-conversas">
                  {lista.map((p) => (
                    <li key={p.token}>
                      <button onClick={() => setToken(p.token)}>
                        <span className="conversa-nome">
                          <strong>{p.stand}</strong>
                          <em className="dica-campo">
                            {p.expositor}
                            {p.conversa?.ultimaEm && ` · última em ${new Date(p.conversa.ultimaEm).toLocaleDateString('pt-BR')}`}
                          </em>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!lista.length && (
                  <p className="ajuda">
                    {filtro || feiraId
                      ? 'Nenhum stand com esse nome.'
                      : 'Nenhuma conversa ainda. Procure um stand acima para começar uma.'}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <button
        className={`conversa-bolha ${novas.length && !aberta ? 'com-novidade' : ''}`}
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
      >
        <span className="conversa-bolha-icone" aria-hidden>{aberta ? '×' : '💬'}</span>
        <span className="conversa-bolha-texto">{aberta ? 'Fechar' : 'Conversas'}</span>
        {/*
          Aqui a badge é NÚMERO, e não ponto.

          Na tela do cliente ela é um ponto porque o resumo do projeto não
          guarda contagem — inventar um número ali seria mentira. Aqui a conta
          existe: são os projetos com mensagem nova, e essa lista está na mão.
          "3" e "12" pedem manhãs diferentes.
        */}
        {novas.length > 0 && !aberta && (
          <span className="badge-nova com-numero" role="status">{novas.length > 9 ? '9+' : novas.length}</span>
        )}
      </button>
    </div>
  )
}
