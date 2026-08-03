import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PERFIS_PADRAO, ESCALAS } from '../data/perfis.js'
import {
  projetoNovo, pecaNova, validarProjeto, perfilPorTexto, MAXIMO_PECAS,
} from '../data/projeto.js'
import { importarProjetos, MODELO_CSV } from '../core/importacao.js'
import { salvarProjeto, salvarProjetos, listarProjetos, apagarProjeto } from '../services/projetos.js'
import { traduzirErroAuth } from '../services/sessao.js'
import { usarFeiras, baixarTexto } from './Admin.jsx'

// Cadastro dos projetos: quais peças cada stand precisa entregar.
//
// Esta tela é a inversão do fluxo. Antes o cliente digitava a medida da peça e
// a análise inteira dependia daquele número; agora a medida vem daqui, de quem
// a conhece. O cliente só sobe o arquivo.
//
// O segundo ganho, que na operação vale tanto quanto: sabendo o que era para
// chegar, dá para dizer o que FALTA — e cobrar. Antes só existia a lista do
// que chegou.

const nomeDoPerfil = (id) => PERFIS_PADRAO.find((p) => p.id === id)?.nome || id

export function linkDoProjeto(token) {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/p/${token}`
}

/** Casa cada peça cadastrada com o envio correspondente. */
function situacao(projeto, enviosPorProjeto) {
  const envios = enviosPorProjeto.get(projeto.token) || []
  const porPeca = new Map()
  for (const e of envios) {
    if (!e.pecaId) continue
    const anterior = porPeca.get(e.pecaId)
    // Vale o envio mais recente: o cliente pode reenviar depois de corrigir.
    if (!anterior || (e.criadoEm?.seconds || 0) > (anterior.criadoEm?.seconds || 0)) porPeca.set(e.pecaId, e)
  }
  const pecas = (projeto.pecas || []).map((p) => ({ ...p, envio: porPeca.get(p.id) || null }))
  const recebidas = pecas.filter((p) => p.envio).length
  return {
    pecas,
    recebidas,
    total: pecas.length,
    pendentes: pecas.filter((p) => !p.envio),
    apoio: envios.filter((e) => e.tipoEnvio === 'avulso'),
    // Arte que o cliente mandou por fora da lista: ele digitou a medida à mão.
    // Precisa aparecer com destaque justamente porque é o único caso em que a
    // medida voltou a ser palpite dele.
    extras: envios.filter((e) => e.tipoEnvio !== 'avulso' && !e.pecaId),
    completo: pecas.length > 0 && recebidas === pecas.length,
  }
}

function textoDeCobranca(projeto, sit) {
  const linhas = [
    `Olá, ${projeto.expositor}!`,
    '',
    `Estamos finalizando a produção do stand ${projeto.stand} para ${projeto.feira} e ainda faltam ${sit.pendentes.length} ${sit.pendentes.length === 1 ? 'arte' : 'artes'}:`,
    '',
    ...sit.pendentes.map((p) => `• ${p.rotulo} — ${p.larguraCm} × ${p.alturaCm} cm`),
    '',
    'Para enviar, use o link abaixo. Ele já vem com as medidas certas de cada peça, confere a qualidade do arquivo na hora e diz o que ajustar caso algo não passe:',
    '',
    linkDoProjeto(projeto.token),
    '',
    'Não precisa de login nem de senha — pode encaminhar direto para quem cuida da arte.',
  ]
  return linhas.join('\n')
}

export default function Projetos({ sessao }) {
  const { fb, usuario } = sessao
  const { feiras, feiraId, setFeiraId, erro: erroFeiras } = usarFeiras(fb)
  const [projetos, setProjetos] = useState([])
  const [envios, setEnvios] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [painel, setPainel] = useState(null) // null | 'importar' | {projeto}
  const [filtro, setFiltro] = useState('')

  const recarregar = useCallback(async () => {
    if (!fb || !feiraId) { setProjetos([]); setEnvios([]); return }
    setCarregando(true)
    setErro(null)
    try {
      const { getFirestore, collection, getDocs, query, where } = fb.firestore
      const [lista, snap] = await Promise.all([
        listarProjetos(fb, feiraId),
        getDocs(query(collection(getFirestore(fb.app), 'envios'), where('feiraId', '==', feiraId))),
      ])
      setProjetos(lista)
      setEnvios(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    } catch (e) {
      setErro(traduzirErroAuth(e))
    } finally {
      setCarregando(false)
    }
  }, [fb, feiraId])

  useEffect(() => { recarregar() }, [recarregar])

  const enviosPorProjeto = useMemo(() => {
    const mapa = new Map()
    for (const e of envios) {
      if (!e.projetoId) continue
      if (!mapa.has(e.projetoId)) mapa.set(e.projetoId, [])
      mapa.get(e.projetoId).push(e)
    }
    return mapa
  }, [envios])

  const linhas = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    return projetos
      .map((p) => ({ projeto: p, sit: situacao(p, enviosPorProjeto) }))
      .filter(({ projeto }) => !t || [projeto.stand, projeto.expositor, projeto.email]
        .some((v) => String(v || '').toLowerCase().includes(t)))
  }, [projetos, enviosPorProjeto, filtro])

  const resumo = useMemo(() => {
    const total = linhas.reduce((s, l) => s + l.sit.total, 0)
    const recebidas = linhas.reduce((s, l) => s + l.sit.recebidas, 0)
    const completos = linhas.filter((l) => l.sit.completo).length
    return { stands: linhas.length, total, recebidas, faltam: total - recebidas, completos }
  }, [linhas])

  const guardar = async (projeto) => {
    await salvarProjeto(fb, projeto, usuario?.email)
    setPainel(null)
    await recarregar()
  }

  const remover = async (projeto) => {
    const sit = situacao(projeto, enviosPorProjeto)
    const aviso = sit.recebidas
      ? `O stand ${projeto.stand} já tem ${sit.recebidas} arquivo(s) recebido(s). Apagar o projeto NÃO apaga os arquivos, mas o link do cliente para de funcionar. Continuar?`
      : `Apagar o projeto do stand ${projeto.stand}?`
    if (!window.confirm(aviso)) return
    await apagarProjeto(fb, projeto.token)
    await recarregar()
  }

  if (painel === 'importar') {
    return <Importacao sessao={sessao} onPronto={async () => { setPainel(null); await recarregar() }} onCancelar={() => setPainel(null)} />
  }
  if (painel?.projeto) {
    return <FormularioProjeto inicial={painel.projeto} onSalvar={guardar} onCancelar={() => setPainel(null)} />
  }

  return (
    <>
      <div className="cartao">
        <h2>Projetos cadastrados</h2>
        <p className="ajuda">
          Cadastre aqui as peças de cada stand. O cliente recebe um link, abre e
          já encontra as medidas certas — ele não digita tamanho nenhum, que era
          de onde vinha a maior parte dos erros.
        </p>

        <div className="linha">
          <label className="campo">
            <span>Feira</span>
            <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
              {!feiras.length && <option value="">Nenhuma feira cadastrada ainda</option>}
              {feiras.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Filtrar por stand, cliente ou e-mail</span>
            <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="digite para filtrar" />
          </label>
        </div>

        <div className="acoes">
          <button className="btn" onClick={() => setPainel('importar')}>Importar planilha</button>
          <button
            className="btn btn-ghost"
            onClick={() => setPainel({ projeto: projetoNovo({ feira: feiras.find((f) => f.id === feiraId)?.nome || '' }) })}
          >
            Novo projeto
          </button>
        </div>

        {(erro || erroFeiras) && <p className="erro-envio">{erro || erroFeiras}</p>}

        {linhas.length > 0 && (
          <>
            <p className="ajuda resumo-admin">
              <strong>{resumo.stands}</strong> stands · <strong>{resumo.recebidas}</strong> de{' '}
              <strong>{resumo.total}</strong> artes recebidas ·{' '}
              {resumo.faltam > 0
                ? <><strong>{resumo.faltam}</strong> pendentes</>
                : 'nada pendente'}{' '}
              · {resumo.completos} stands completos
            </p>
            <div className="acoes">
              <button
                className="btn btn-ghost"
                onClick={() => baixarTexto(
                  `links-${feiraId}.csv`,
                  '﻿' + ['Stand;Cliente;Email;Link;Recebidas;Total'].concat(
                    linhas.map(({ projeto, sit }) => [
                      projeto.stand, projeto.expositor, projeto.email,
                      linkDoProjeto(projeto.token), sit.recebidas, sit.total,
                    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')),
                  ).join('\r\n'),
                  'text/csv;charset=utf-8',
                )}
              >
                Exportar links (CSV)
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => navigator.clipboard?.writeText(
                  linhas.filter(({ sit }) => sit.pendentes.length).map(({ projeto }) => projeto.email).join('; '),
                )}
              >
                Copiar e-mails com pendência
              </button>
            </div>
          </>
        )}
      </div>

      <div className="cartao">
        {carregando && <p className="ajuda">Carregando…</p>}
        {!carregando && !projetos.length && (
          <p className="ajuda">
            Nenhum projeto cadastrado para esta feira. Comece por
            <strong> Importar planilha</strong> — é o caminho que se paga.
          </p>
        )}
        {!carregando && projetos.length > 0 && !linhas.length && (
          <p className="ajuda">Nenhum resultado para “{filtro}”.</p>
        )}
        {linhas.map(({ projeto, sit }) => (
          <LinhaProjeto
            key={projeto.token}
            projeto={projeto}
            sit={sit}
            onEditar={() => setPainel({ projeto })}
            onRemover={() => remover(projeto)}
          />
        ))}
      </div>
    </>
  )
}

function LinhaProjeto({ projeto, sit, onEditar, onRemover }) {
  const [aberto, setAberto] = useState(false)
  const [copiado, setCopiado] = useState(null)

  const copiar = async (texto, marca) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(marca)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      window.prompt('Copie o texto abaixo:', texto)
    }
  }

  const assunto = `Artes do stand ${projeto.stand} — ${projeto.feira}`
  const mailto = `mailto:${encodeURIComponent(projeto.email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(textoDeCobranca(projeto, sit))}`

  return (
    <div className={`projeto ${sit.completo ? 'completo' : ''}`}>
      <div className="projeto-topo">
        <div>
          <strong>{projeto.stand}</strong>
          <span className="dica-campo"> · {projeto.expositor}</span>
          <br />
          <a href={`mailto:${projeto.email}`}>{projeto.email}</a>
          {projeto.localizacao && <em className="dica-campo"> · {projeto.localizacao}</em>}
        </div>
        <div className="projeto-progresso">
          <span className={`tag ${sit.completo ? 'aprovado' : sit.recebidas ? 'ressalva' : ''}`}>
            {sit.recebidas} de {sit.total}
          </span>
          {sit.apoio.length > 0 && <em className="dica-campo">{sit.apoio.length} arquivo(s) de apoio</em>}
        </div>
      </div>

      <div className="acoes compactas">
        <button className="btn btn-ghost" onClick={() => copiar(linkDoProjeto(projeto.token), 'link')}>
          {copiado === 'link' ? '✓ Link copiado' : 'Copiar link do cliente'}
        </button>
        {sit.pendentes.length > 0 && (
          <a className="btn btn-ghost" href={mailto}>Cobrar por e-mail ({sit.pendentes.length})</a>
        )}
        <button className="btn btn-ghost" onClick={() => setAberto((v) => !v)}>
          {aberto ? 'Ocultar peças' : `Ver as ${sit.total} peças`}
        </button>
        <button className="btn btn-ghost" onClick={onEditar}>Editar</button>
        <button className="btn btn-ghost perigo" onClick={onRemover}>Apagar</button>
      </div>

      {aberto && (
        <ul className="pecas-lista">
          {sit.extras.map((e) => (
            <li key={e.id} className="entregue">
              <span className="marca" aria-hidden>+</span>
              <div>
                <strong>{e.pecaRotulo || 'Peça sem nome'}</strong>
                <em className="dica-campo"> · fora da lista do projeto</em>
                <p className="dica-campo">
                  {e.peca ? `${e.peca.larguraCm} × ${e.peca.alturaCm} cm — medida informada pelo cliente · ` : ''}
                  {e.protocolo}
                  {e.link && <> · <a href={e.link} target="_blank" rel="noreferrer">baixar</a></>}
                </p>
              </div>
            </li>
          ))}
          {sit.pecas.map((p) => (
            <li key={p.id} className={p.envio ? 'entregue' : 'pendente'}>
              <span className="marca" aria-hidden>{p.envio ? '✓' : '·'}</span>
              <div>
                <strong>{p.rotulo}</strong>
                <em className="dica-campo">
                  {' '}{p.larguraCm} × {p.alturaCm} cm · {nomeDoPerfil(p.perfilId)}
                  {p.escalaFator > 1 && ` · escala 1:${p.escalaFator}`}
                </em>
                {p.envio
                  ? (
                    <p className="dica-campo">
                      {p.envio.veredicto === 'ressalva' ? 'Recebida com ressalva' : 'Recebida'}
                      {p.envio.riscoAceito ? ' (risco aceito)' : ''} · {p.envio.protocolo}
                      {p.envio.link && <> · <a href={p.envio.link} target="_blank" rel="noreferrer">baixar</a></>}
                    </p>
                  )
                  : <p className="dica-campo">Aguardando o cliente</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------- importação

function Importacao({ sessao, onPronto, onCancelar }) {
  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState(null)
  const [gravando, setGravando] = useState(null)
  const [erro, setErro] = useState(null)
  const entrada = useRef(null)

  const analisar = (conteudo) => {
    setTexto(conteudo)
    setErro(null)
    setResultado(conteudo.trim() ? importarProjetos(conteudo) : null)
  }

  const lerArquivo = async (arquivo) => {
    if (!arquivo) return
    // Excel em português costuma salvar CSV em Windows-1252. Lido como UTF-8,
    // "Buddy Nutrição" vira "Buddy Nutriï¿½ï¿½o" — texto que o cliente recebe
    // no e-mail de cobrança. Testamos o UTF-8 e caímos para o latino quando ele
    // acusa byte inválido.
    const buffer = await arquivo.arrayBuffer()
    let conteudo
    try {
      conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      conteudo = new TextDecoder('windows-1252').decode(buffer)
    }
    analisar(conteudo)
  }

  const gravar = async () => {
    if (!resultado?.projetos.length) return
    setErro(null)
    setGravando({ feito: 0, total: resultado.projetos.length })
    try {
      await salvarProjetos(sessao.fb, resultado.projetos, sessao.usuario?.email,
        (feito, total) => setGravando({ feito, total }))
      await onPronto()
    } catch (e) {
      setErro(traduzirErroAuth(e))
      setGravando(null)
    }
  }

  const semEmail = resultado?.erros.filter((e) => /e-mail válido/i.test(e.mensagem)).length || 0

  return (
    <div className="cartao">
      <h2>Importar planilha</h2>
      <p className="ajuda">
        Aceita os dois formatos que a operação usa: <strong>uma linha por peça</strong>{' '}
        (recomendado) ou <strong>uma linha por stand</strong> com colunas
        “Arte A”, “Arte B”, “Arte C”. Colunas essenciais: feira, stand, e-mail e
        a descrição das peças com a medida.
      </p>

      <div className="acoes">
        <button className="btn btn-ghost" onClick={() => entrada.current?.click()}>Escolher arquivo CSV</button>
        <button
          className="btn btn-ghost"
          onClick={() => baixarTexto('modelo-projetos.csv', '﻿' + MODELO_CSV, 'text/csv;charset=utf-8')}
        >
          Baixar planilha modelo
        </button>
        <input
          ref={entrada} type="file" accept=".csv,text/csv,text/plain" hidden
          onChange={(e) => lerArquivo(e.target.files?.[0])}
        />
      </div>

      <label className="campo">
        <span>…ou cole aqui o conteúdo da planilha</span>
        <textarea
          rows={6} value={texto} onChange={(e) => analisar(e.target.value)}
          placeholder={'feira;cliente;email;stand;peca;medida\nExpo 2026;Buddy;ana@buddy.com;Buddy;Lona de fundo;275x275'}
        />
      </label>

      {resultado && (
        <div className="previa-importacao">
          <p className="ajuda">
            Formato lido: <strong>{resultado.formato}</strong> · separador{' '}
            <code>{resultado.separador === '\t' ? 'tabulação' : resultado.separador}</code> ·{' '}
            <strong>{resultado.projetos.length}</strong> stands ·{' '}
            <strong>{resultado.projetos.reduce((s, p) => s + p.pecas.length, 0)}</strong> peças
          </p>

          {resultado.erros.length > 0 && (
            <div className="bloco-erros">
              <strong>{resultado.erros.length} linha(s) com problema — o resto pode ser importado assim mesmo:</strong>
              <ul>
                {resultado.erros.slice(0, 12).map((e, i) => (
                  <li key={i}>Linha {e.linha}: {e.mensagem}</li>
                ))}
                {resultado.erros.length > 12 && <li>…e mais {resultado.erros.length - 12}.</li>}
              </ul>
            </div>
          )}

          {resultado.avisos.length > 0 && (
            <div className="bloco-avisos">
              <strong>Confira antes de cadastrar:</strong>
              <ul>
                {resultado.avisos.slice(0, 8).map((a, i) => <li key={i}>Linha {a.linha}: {a.mensagem}</li>)}
                {resultado.avisos.length > 8 && <li>…e mais {resultado.avisos.length - 8}.</li>}
              </ul>
            </div>
          )}

          {resultado.projetos.length > 0 && (
            <div className="tabela-rolagem">
              <table className="envios">
                <thead><tr><th>Stand</th><th>Cliente</th><th>E-mail</th><th>Peças</th></tr></thead>
                <tbody>
                  {resultado.projetos.slice(0, 30).map((p) => (
                    <tr key={p.token}>
                      <td>{p.stand}</td>
                      <td>{p.expositor}</td>
                      <td>{p.email || <em className="erro-campo">faltando</em>}</td>
                      <td>
                        {p.pecas.map((peca) => (
                          <div key={peca.id}>
                            {peca.rotulo} <em className="dica-campo">{peca.larguraCm} × {peca.alturaCm} cm · {nomeDoPerfil(peca.perfilId)}</em>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {resultado.projetos.length > 30 && (
                <p className="nota">Mostrando os 30 primeiros de {resultado.projetos.length}.</p>
              )}
            </div>
          )}
        </div>
      )}

      {erro && <p className="erro-envio">{erro}</p>}
      {semEmail > 0 && (
        <p className="nota">
          {semEmail} stand(s) estão sem e-mail válido. Eles podem ser cadastrados,
          mas o link de cobrança por e-mail só funciona depois de você corrigir o
          endereço em <strong>Editar</strong>.
        </p>
      )}

      <div className="acoes">
        <button className="btn" disabled={!resultado?.projetos.length || Boolean(gravando)} onClick={gravar}>
          {gravando
            ? `Cadastrando ${gravando.feito} de ${gravando.total}…`
            : `Cadastrar ${resultado?.projetos.length || 0} projeto(s)`}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

// -------------------------------------------------------- cadastro manual

function FormularioProjeto({ inicial, onSalvar, onCancelar }) {
  const [dados, setDados] = useState(() => projetoNovo(inicial))
  const [erros, setErros] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [falha, setFalha] = useState(null)

  const alterar = (campo, valor) => setDados((d) => ({ ...d, [campo]: valor }))
  const alterarPeca = (i, mudanca) => setDados((d) => ({
    ...d,
    pecas: d.pecas.map((p, j) => (j === i ? { ...p, ...mudanca } : p)),
  }))

  const enviar = async (e) => {
    e.preventDefault()
    const { valido, erros: novos } = validarProjeto(dados)
    setErros(novos)
    if (!valido) return
    setSalvando(true)
    setFalha(null)
    try {
      await onSalvar(dados)
    } catch (erro) {
      setFalha(traduzirErroAuth(erro))
      setSalvando(false)
    }
  }

  return (
    <form className="cartao" onSubmit={enviar} noValidate>
      <h2>{inicial?.pecas?.length ? 'Editar projeto' : 'Novo projeto'}</h2>

      <div className="linha">
        <label className="campo">
          <span>Feira</span>
          <input type="text" value={dados.feira} onChange={(e) => alterar('feira', e.target.value)} />
          {erros.feira && <em className="erro-campo">{erros.feira}</em>}
        </label>
        <label className="campo">
          <span>Cliente / expositor</span>
          <input type="text" value={dados.expositor} onChange={(e) => alterar('expositor', e.target.value)} />
          {erros.expositor && <em className="erro-campo">{erros.expositor}</em>}
        </label>
      </div>

      <div className="linha">
        <label className="campo">
          <span>Nome do stand</span>
          <input type="text" value={dados.stand} onChange={(e) => alterar('stand', e.target.value)} />
          {erros.stand && <em className="erro-campo">{erros.stand}</em>}
        </label>
        <label className="campo">
          <span>E-mail do cliente</span>
          <input type="email" value={dados.email} onChange={(e) => alterar('email', e.target.value)} />
          {erros.email && <em className="erro-campo">{erros.email}</em>}
        </label>
      </div>

      <label className="campo">
        <span>Localização do stand <em className="opcional">(opcional)</em></span>
        <input type="text" value={dados.localizacao} onChange={(e) => alterar('localizacao', e.target.value)} placeholder="rua, número, pavilhão" />
      </label>

      <h3>Peças do stand</h3>
      {erros.pecas && <p className="erro-campo">{erros.pecas}</p>}

      {dados.pecas.map((peca, i) => (
        <div className="peca-editor" key={peca.id}>
          <div className="linha">
            <label className="campo cresce">
              <span>Nome da peça</span>
              <input
                type="text" value={peca.rotulo}
                placeholder="Lona de fundo"
                onChange={(e) => alterarPeca(i, {
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
                onChange={(e) => alterarPeca(i, { perfilId: e.target.value, tipoManual: true })}
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
                onChange={(e) => alterarPeca(i, { larguraCm: Number(e.target.value) })}
              />
            </label>
            <label className="campo">
              <span>Altura (cm)</span>
              <input
                type="number" min="1" step="0.1" value={peca.alturaCm || ''}
                onChange={(e) => alterarPeca(i, { alturaCm: Number(e.target.value) })}
              />
            </label>
            <label className="campo">
              <span>Escala aceita</span>
              <select value={peca.escalaFator} onChange={(e) => alterarPeca(i, { escalaFator: Number(e.target.value) })}>
                {ESCALAS.map((s) => <option key={s.id} value={s.fator}>{s.rotulo}</option>)}
              </select>
            </label>
            <button
              className="btn btn-ghost perigo"
              type="button"
              onClick={() => setDados((d) => ({ ...d, pecas: d.pecas.filter((_, j) => j !== i) }))}
            >
              Remover
            </button>
          </div>
          {erros.porPeca?.[i] && <em className="erro-campo">{erros.porPeca[i]}</em>}
        </div>
      ))}

      <div className="acoes">
        <button
          className="btn btn-ghost"
          type="button"
          disabled={dados.pecas.length >= MAXIMO_PECAS}
          onClick={() => setDados((d) => ({ ...d, pecas: [...d.pecas, pecaNova()] }))}
        >
          Adicionar peça
        </button>
      </div>

      <label className="alternador">
        <input
          type="checkbox" checked={dados.aceitaAvulsos !== false}
          onChange={(e) => alterar('aceitaAvulsos', e.target.checked)}
        />
        <span>Aceitar arquivos de apoio (logo, fontes, manual de marca)</span>
      </label>

      {falha && <p className="erro-envio">{falha}</p>}

      <div className="acoes">
        <button className="btn" type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar projeto'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  )
}
