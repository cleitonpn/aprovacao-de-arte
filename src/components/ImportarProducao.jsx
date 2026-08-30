import { useCallback, useEffect, useMemo, useState } from 'react'
import { projetoNovo, pecaNova } from '../data/projeto.js'
import ListaDePecas from './ListaDePecas.jsx'
import { salvarProjetos } from '../services/projetos.js'
import { lerProducao, lerProjetosParaCruzar, vincularAProducao, desvincularDaProducao } from '../services/producao.js'
import { lerProducaoAoVivo } from '../services/producaoDireta.js'
import {
  cruzarComExistentes, feirasDaProducao, pendenciasDe, elosDuplicados, elosDesalinhados,
  eloParaGravar,
} from '../core/producao.js'
import { formatarDataHora } from '../core/datas.js'
import { traduzirErroAuth } from '../services/sessao.js'

// Importar da produção: escolher a feira, escolher os stands, completar o
// e-mail.
//
// Três decisões que valem explicar, porque são o que separa isto de um botão
// "sincronizar tudo":
//
// 1. **O admin escolhe.** Uma feira do app tem stands que não têm arte
//    nenhuma conosco — montagem só, ou cliente que trouxe a comunicação
//    visual pronta. Importar tudo encheria o painel de stands que nunca vão
//    receber arte, e o "faltam 12 artes" deixaria de significar coisa alguma.
// 2. **Nada é sobrescrito.** Quem já está cadastrado aparece marcado e fora
//    do alcance do clique. Reimportar um stand criaria um segundo link para o
//    mesmo cliente e dividiria a arte entre duas fichas.
// 3. **As peças são escolha do admin.** O app não sabe o que é lona nem
//    testeira, e nunca vai saber — então elas nascem aqui. Dá para definir um
//    conjunto que vale para todos os marcados (feira de stands padronizados) ou
//    stand a stand (feira de projetos únicos). Nada é obrigatório: importar sem
//    peça continua valendo, e o painel marca o stand em vermelho até alguém
//    cadastrá-las.

export default function ImportarProducao({ sessao, onPronto, onCancelar }) {
  const [dados, setDados] = useState(null)
  const [projetos, setProjetos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [feira, setFeira] = useState('')
  const [filtro, setFiltro] = useState('')
  const [marcados, setMarcados] = useState(() => new Set())
  const [emails, setEmails] = useState({})
  const [gravando, setGravando] = useState(null)
  // Como as peças entram: iguais para todos os marcados, ou uma lista por
  // stand. A escolha é do admin porque a operação tem os dois casos — feira de
  // stands padronizados (mesma lona, mesma testeira) e feira de projetos
  // únicos —, e adivinhar erraria metade das vezes.
  const [modoPecas, setModoPecas] = useState('todos') // 'todos' | 'individual'
  const [modelo, setModelo] = useState([])
  const [pecasPorStand, setPecasPorStand] = useState({})
  const [atualizando, setAtualizando] = useState(false)

  /**
   * Os expositores da produção, o mais fresco possível.
   *
   * Tenta a leitura AO VIVO primeiro e só cai para o espelho se ela falhar. A
   * ordem é essa porque o espelho depende do agendamento do GitHub, que na
   * medição real levou de 23 minutos a 2h23 entre uma execução e outra — quem
   * está cadastrando uma feira não pode esperar isso por um stand que já
   * existe no app.
   *
   * O espelho não é inútil: ele é a reserva para quando o outro projeto não
   * responder, e continua sendo o que a sincronização agendada mantém para o
   * caminho de volta (o status da arte indo para o app).
   */
  const buscar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCarregando(true)
    try {
      const [aoVivo, existentes] = await Promise.all([
        lerProducaoAoVivo().catch((e) => {
          console.warn('leitura ao vivo da produção falhou; usando o espelho', e)
          return null
        }),
        lerProjetosParaCruzar(sessao.fb),
      ])
      const p = aoVivo || await lerProducao(sessao.fb)
      setDados(p)
      setProjetos(existentes)
      setFeira((atual) => atual || feirasDaProducao(p.clientes)[0]?.nome || '')
      setErro(null)
      return p
    } catch (e) {
      setErro(traduzirErroAuth(e))
      return null
    } finally {
      setCarregando(false)
    }
  }, [sessao.fb])

  useEffect(() => { buscar() }, [buscar])

  const atualizarAgora = async () => {
    setAtualizando(true)
    try { await buscar({ silencioso: true }) } finally { setAtualizando(false) }
  }

  const feiras = useMemo(() => feirasDaProducao(dados?.clientes || []), [dados])

  // De TODOS os projetos, não só os desta feira: um elo trocado costuma cruzar
  // feiras, e é justamente esse o caso que ninguém encontra à mão.
  const duplicados = useMemo(() => elosDuplicados(projetos), [projetos])

  // Elos que deixaram de apontar para o cliente certo. Comparado com TODOS os
  // clientes do app, não só os da feira escolhida: um deslocamento de linhas
  // atinge a feira inteira de uma vez, e filtrar esconderia justamente o
  // conjunto que se quer ver junto.
  const desalinhados = useMemo(
    () => elosDesalinhados(projetos, dados?.clientes || []),
    [projetos, dados],
  )

  const linhas = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    return cruzarComExistentes(
      (dados?.clientes || []).filter((c) => c.feira === feira),
      projetos,
    ).filter((c) => !t || [c.expositor, c.stand, c.produtor]
      .some((v) => String(v || '').toLowerCase().includes(t)))
  }, [dados, projetos, feira, filtro])

  const novos = linhas.filter((c) => !c.jaImportado)
  const selecionados = linhas.filter((c) => marcados.has(c.producaoId) && !c.jaImportado)

  const alternar = (id) => setMarcados((atual) => {
    const novo = new Set(atual)
    if (novo.has(id)) novo.delete(id); else novo.add(id)
    return novo
  })

  const importar = async () => {
    if (!selecionados.length) return
    setErro(null)
    setGravando({ feito: 0, total: selecionados.length })
    try {
      const paraCriar = selecionados.map((c) => ({
        ...projetoNovo({
          feira: c.feira,
          expositor: c.expositor,
          email: (emails[c.producaoId] || '').trim(),
          stand: c.stand,
          localizacao: c.localizacao,
          linkDrive: c.linkDrive,
          pecas: pecasDe(c.producaoId),
        }),
        // A chave que liga os dois sistemas. É por causa dela que o app vai
        // conseguir, depois, saber de qual projeto vem a prova e o status.
        // `eloParaGravar` prefere a chave estável (feira + expositor) ao id do
        // documento, que é posicional e troca de dono quando a planilha muda.
        producaoId: eloParaGravar(c),
        producaoFeira: c.feira,
        importadoEm: new Date().toISOString(),
        importadoPor: sessao.usuario?.email || null,
      }))
      await salvarProjetos(sessao.fb, paraCriar, sessao.usuario?.email,
        (feito, total) => setGravando({ feito, total }))
      await onPronto(paraCriar.length)
    } catch (e) {
      setErro(traduzirErroAuth(e, 'gravacao'))
      setGravando(null)
    }
  }

  /**
   * As peças que este stand recebe.
   *
   * No modo "todos", cada stand ganha uma CÓPIA do modelo, com ids próprios.
   * Compartilhar os ids entre projetos faria dois stands diferentes gravarem
   * entrega e status na mesma chave — cada projeto tem seu próprio mapa de
   * `entregas` e `controle`, e ids repetidos confundem quem for ler o
   * histórico depois.
   */
  const pecasDe = (producaoId) => {
    const base = modoPecas === 'todos' ? modelo : (pecasPorStand[producaoId] || [])
    return base
      .filter((p) => p.rotulo?.trim() && p.larguraCm > 0 && p.alturaCm > 0)
      .map((p) => pecaNova({ ...p, id: '' }))
  }

  const vincular = async (linha) => {
    try {
      await vincularAProducao(sessao.fb, linha.existente.token, eloParaGravar(linha), sessao.usuario?.email)
      setProjetos((atual) => atual.map((p) => (
        p.token === linha.existente.token ? { ...p, producaoId: linha.producaoId } : p
      )))
    } catch (e) {
      setErro(traduzirErroAuth(e, 'gravacao'))
    }
  }

  if (carregando) {
    return <div className="cartao"><p className="ajuda">Lendo os dados da produção…</p></div>
  }

  return (
    <div className="cartao">
      <div className="admin-topo">
        <div>
          <h2>Importar da produção</h2>
          <p className="ajuda">
            Feira, expositor, stand e localização vêm do app de produção — os
            mesmos dados, sem redigitar. O que o app não tem, e você define
            aqui: o <strong>e-mail</strong> do expositor e as{' '}
            <strong>peças de arte</strong> de cada stand.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>

      {erro && <p className="erro-envio">{erro}</p>}

      <ElosDesalinhados
        linhas={desalinhados}
        onReligar={async (token, producaoId) => {
          await vincularAProducao(sessao.fb, token, producaoId, sessao.usuario?.email)
          setProjetos((atual) => atual.map((p) => (p.token === token ? { ...p, producaoId } : p)))
        }}
        onDesvincular={async (token) => {
          await desvincularDaProducao(sessao.fb, token, sessao.usuario?.email)
          setProjetos((atual) => atual.map((p) => (p.token === token ? { ...p, producaoId: '' } : p)))
        }}
      />

      <ElosEmConflito
        duplicados={duplicados}
        onDesvincular={async (token) => {
          await desvincularDaProducao(sessao.fb, token, sessao.usuario?.email)
          setProjetos((atual) => atual.map((p) => (p.token === token ? { ...p, producaoId: '' } : p)))
        }}
      />

      {!feiras.length && !erro && (
        <p className="nota">
          Nenhum expositor veio da produção. Tente <strong>Atualizar agora</strong>;
          se continuar vazio, o projeto da produção pode estar fora do ar ou o
          domínio deste site pode não estar autorizado nele.
        </p>
      )}

      {feiras.length > 0 && (
        <>
          <div className="linha">
            <label className="campo">
              <span>Feira na produção</span>
              <select value={feira} onChange={(e) => { setFeira(e.target.value); setMarcados(new Set()) }}>
                {feiras.map((f) => (
                  <option key={f.nome} value={f.nome}>{f.nome} ({f.total})</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Filtrar por cliente, stand ou produtor</span>
              <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="digite para filtrar" />
            </label>
          </div>

          <p className="ajuda resumo-admin">
            <strong>{linhas.length}</strong> expositores nesta feira ·{' '}
            <strong>{novos.length}</strong> ainda não cadastrados ·{' '}
            {linhas.length - novos.length} já existem aqui ·{' '}
            {/*
              De onde vieram os dados, sempre à vista. Sem isto, uma leitura
              que caiu para o espelho pareceria igual a uma ao vivo — e o
              analista cadastraria achando que viu tudo, sem o stand que
              entrou no app há dez minutos.
            */}
            {dados?.aoVivo
              ? <span className="dica-campo ao-vivo">direto do app de produção</span>
              : (
                <em className="dica-campo destaque-pendencia">
                  do espelho{dados?.estado?.atualizadoEm && `, de ${formatarDataHora(dados.estado.atualizadoEm)}`}
                  {' '}— o app de produção não respondeu
                </em>
              )}
          </p>

          <div className="acoes">
            <button className="btn btn-ghost" onClick={atualizarAgora} disabled={atualizando}>
              {atualizando ? 'Atualizando…' : 'Atualizar agora'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setMarcados(new Set(novos.map((c) => c.producaoId)))}
              disabled={!novos.length}
            >
              Marcar os {novos.length} novos
            </button>
            <button className="btn btn-ghost" onClick={() => setMarcados(new Set())} disabled={!marcados.size}>
              Desmarcar tudo
            </button>
          </div>

          <ul className="pecas-lista lista-producao">
            {linhas.map((c) => (
              <LinhaDaProducao
                key={c.producaoId}
                cliente={c}
                marcado={marcados.has(c.producaoId)}
                email={emails[c.producaoId] || ''}
                onMarcar={() => alternar(c.producaoId)}
                onEmail={(v) => setEmails((a) => ({ ...a, [c.producaoId]: v }))}
                onVincular={() => vincular(c)}
                pecas={modoPecas === 'individual' ? (pecasPorStand[c.producaoId] || []) : null}
                onPecas={(pecas) => setPecasPorStand((a) => ({ ...a, [c.producaoId]: pecas }))}
              />
            ))}
          </ul>

          <EscolhaDasPecas
            modo={modoPecas}
            onModo={setModoPecas}
            modelo={modelo}
            onModelo={setModelo}
            quantos={selecionados.length}
          />

          <Rodape
            selecionados={selecionados}
            emails={emails}
            pecasDe={pecasDe}
            gravando={gravando}
            onImportar={importar}
          />
        </>
      )}
    </div>
  )
}

function LinhaDaProducao({ cliente, marcado, email, onMarcar, onEmail, onVincular, pecas, onPecas }) {
  const faltas = marcado ? pendenciasDe(cliente, email) : []

  return (
    <li className={cliente.jaImportado ? 'entregue' : 'pendente'}>
      <span className="marca" aria-hidden>{cliente.jaImportado ? '✓' : marcado ? '+' : '·'}</span>
      <div>
        {cliente.jaImportado
          ? <strong>{cliente.expositor}</strong>
          : (
            <label className="alternador linha-producao-topo">
              <input type="checkbox" checked={marcado} onChange={onMarcar} />
              <span><strong>{cliente.expositor}</strong></span>
            </label>
          )}
        <p className="dica-campo">
          Stand {cliente.stand}
          {cliente.area && ` · ${cliente.area} m²`}
          {cliente.produtor && ` · produtor ${cliente.produtor}`}
          {cliente.atendimento && ` · atendimento ${cliente.atendimento}`}
        </p>

        {cliente.jaImportado && (
          <p className="dica-campo">
            Já cadastrado aqui
            {cliente.vincula
              ? (
                <>
                  {' '}— mas sem ligação com a produção.{' '}
                  <button className="link" onClick={onVincular}>Vincular a este stand</button>
                </>
              )
              : ' e ligado à produção.'}
          </p>
        )}

        {marcado && (
          <>
            <label className="campo campo-email-producao">
              <span>E-mail do expositor <em className="opcional">(o app de produção não tem este dado)</em></span>
              <input
                type="email" value={email} onChange={(e) => onEmail(e.target.value)}
                placeholder="contato@cliente.com.br" autoComplete="off"
              />
            </label>
            {faltas.length > 0 && (
              <em className="dica-campo destaque-pendencia">Falta: {faltas.join(', ')}</em>
            )}

            {pecas && (
              <div className="pecas-do-stand">
                <span className="dica-campo">Peças deste stand</span>
                <ListaDePecas
                  pecas={pecas}
                  onMudar={onPecas}
                  vazio="Sem peças — este stand será importado vazio."
                />
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

/**
 * Como as peças entram nos stands escolhidos.
 *
 * Os dois modos existem porque a operação tem os dois casos, e adivinhar
 * erraria metade das vezes: feira de stands padronizados, onde 20 stands de
 * 9 m² levam a mesma lona e a mesma testeira; e feira de projetos únicos, onde
 * cada stand tem a sua lista.
 *
 * Vale dizer o caminho que a tela não força mas permite: para uma feira com
 * dois padrões, importe em duas rodadas — marque os de 9 m², defina o conjunto
 * deles, importe; depois os de 3 m². A área aparece na linha de cada stand
 * justamente para isso.
 */
function EscolhaDasPecas({ modo, onModo, modelo, onModelo, quantos }) {
  return (
    <div className="cartao bloco-pecas-importacao">
      <div className="titulo-secao">
        <h3>Peças destes stands</h3>
        {quantos > 0 && <span className="dica-campo">{quantos} selecionado(s)</span>}
      </div>

      <div className="escolha-modo">
        <label className={modo === 'todos' ? 'ativo' : ''}>
          <input type="radio" checked={modo === 'todos'} onChange={() => onModo('todos')} />
          <span>
            <strong>As mesmas para todos os selecionados</strong>
            <em>Stands padronizados: cada um recebe uma cópia da lista abaixo.</em>
          </span>
        </label>
        <label className={modo === 'individual' ? 'ativo' : ''}>
          <input type="radio" checked={modo === 'individual'} onChange={() => onModo('individual')} />
          <span>
            <strong>Definir stand a stand</strong>
            <em>Projetos diferentes: a lista de peças abre dentro de cada stand marcado.</em>
          </span>
        </label>
      </div>

      {modo === 'todos'
        ? (
          <>
            <ListaDePecas
              pecas={modelo}
              onMudar={onModelo}
              vazio="Nenhuma peça no conjunto. Sem peças, os stands são importados vazios e o cliente não tem o que enviar."
            />
            <p className="nota">
              Cada stand recebe uma <strong>cópia</strong> desta lista, com
              medidas próprias a partir daí — editar um depois não mexe nos
              outros. Peça sem nome ou sem medida é ignorada.
            </p>
          </>
        )
        : (
          <p className="ajuda">
            Marque um stand na lista acima e a lista de peças dele aparece ali
            mesmo, abaixo do e-mail.
          </p>
        )}
    </div>
  )
}

function Rodape({ selecionados, emails, pecasDe, gravando, onImportar }) {
  const semEmail = selecionados.filter((c) => pendenciasDe(c, emails[c.producaoId]).length)
  const semPecas = selecionados.filter((c) => !pecasDe(c.producaoId).length)

  if (gravando) {
    return (
      <p className="ajuda">
        Importando… {gravando.feito} de {gravando.total}
      </p>
    )
  }

  return (
    <>
      {semEmail.length > 0 && (
        <p className="nota">
          {semEmail.length} dos selecionados estão sem e-mail válido. Eles são
          importados assim mesmo — o cadastro fica pronto e o link existe —, mas
          a cobrança por e-mail não funciona até alguém preencher. Aparecem no
          painel com o aviso.
        </p>
      )}
      <div className="acoes">
        <button className="btn" disabled={!selecionados.length} onClick={onImportar}>
          Importar {selecionados.length || ''} {selecionados.length === 1 ? 'stand' : 'stands'}
        </button>
      </div>
      {semPecas.length > 0 && (
        <p className="nota">
          {semPecas.length} dos selecionados ficam <strong>sem peça nenhuma</strong>.
          Podem ser importados assim — o cadastro existe e o link funciona —, mas
          o cliente abre uma lista vazia e não tem o que enviar. O painel marca
          esses stands em vermelho até alguém cadastrar as peças.
        </p>
      )}
    </>
  )
}

/**
 * Dois projetos disputando o mesmo expositor do app.
 *
 * O `producaoId` é a ponte com o app de montagem e ela é 1 para 1 — o app
 * guarda um documento por expositor. Com dois projetos apontando para o mesmo,
 * a sincronização escreve os dois no mesmo lugar e vence o último: sem erro,
 * sem aviso, alternando a cada execução.
 *
 * O sintoma nasce longe da causa, e é isso que torna este aviso necessário: o
 * print de um cliente abre na ficha de OUTRO no app, enquanto aqui na
 * ferramenta cada um mostra o seu, corretamente. Quem vê o problema no galpão
 * não tem como adivinhar que a causa é um elo trocado nesta tela.
 *
 * Enquanto o conflito existir, a sincronização não publica nada para esse
 * expositor — o app volta ao link da planilha. Mostrar nada é ruim; mostrar o
 * cliente errado é pior, porque ninguém desconfia.
 */
function ElosEmConflito({ duplicados, onDesvincular }) {
  const [ocupado, setOcupado] = useState('')
  if (!duplicados.length) return null

  const desvincular = async (token) => {
    setOcupado(token)
    try { await onDesvincular(token) } finally { setOcupado('') }
  }

  return (
    <div className="zona-perigo">
      <strong>
        {duplicados.length === 1
          ? 'Um expositor do app está ligado a dois projetos'
          : `${duplicados.length} expositores do app estão ligados a mais de um projeto`}
      </strong>
      <p className="dica-campo">
        Cada expositor do app aceita um projeto só. Com dois, o app de montagem
        pode mostrar o print de um cliente na ficha do outro — e aqui na
        ferramenta os dois continuam certos, que é o que torna isso difícil de
        achar. Desfaça o elo do projeto errado: nada se perde, o projeto
        continua inteiro e só a ponte com o app é desligada.
      </p>
      {duplicados.map(({ producaoId, projetos }) => (
        <div key={producaoId} className="conflito-elo">
          <p className="dica-campo">Expositor <code>{producaoId}</code> está em:</p>
          <ul className="lista-simples">
            {projetos.map((p) => (
              <li key={p.token}>
                <strong>{p.stand || '(sem nome de stand)'}</strong>
                <em className="dica-campo"> · {p.feira || 'sem feira'}</em>
                {' '}
                <button className="link perigo" disabled={Boolean(ocupado)} onClick={() => desvincular(p.token)}>
                  {ocupado === p.token ? 'desfazendo…' : 'desfazer o elo deste'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/**
 * Elos que deixaram de apontar para o cliente certo.
 *
 * O caminho de conserto que faltava. A tela casa por `producaoId` antes do
 * nome, então um projeto com elo trocado aparece como "já importado" na linha
 * do cliente ERRADO, e o botão de vincular — que só nasce quando não há elo —
 * nunca aparece. Sem este bloco, o conserto ficava no console do Firebase.
 *
 * "Religar" em vez de "desvincular e vincular de novo" porque um deslocamento
 * de planilha atinge a feira inteira: dez stands corrigidos em dois cliques
 * cada é uma tarde; em um clique cada, é um minuto. E a sugestão é sempre
 * mostrada por extenso — quem confirma precisa ver o nome, não confiar.
 */
function ElosDesalinhados({ linhas, onReligar, onDesvincular }) {
  const [ocupado, setOcupado] = useState('')
  if (!linhas.length) return null

  const comSugestao = linhas.filter((l) => l.sugestao)

  const rodar = async (token, acao) => {
    setOcupado(token)
    try { await acao() } finally { setOcupado('') }
  }

  return (
    <div className="zona-perigo">
      <strong>
        {linhas.length === 1
          ? 'Um projeto perdeu o elo com o app de montagem'
          : `${linhas.length} projetos perderam o elo com o app de montagem`}
      </strong>
      <p className="dica-campo">
        O app identifica cada expositor pela POSIÇÃO dele na planilha. Quando
        linhas são inseridas, apagadas ou reordenadas, todo mundo abaixo herda o
        id do vizinho — e o elo passa a apontar para outro cliente. Enquanto
        estiver assim, nada é publicado para esses stands: o app não mostra o
        print, em vez de mostrar o do cliente errado.
      </p>

      {comSugestao.length > 1 && (
        <div className="acoes compactas">
          <button
            className="btn"
            disabled={Boolean(ocupado)}
            onClick={() => rodar('todos', async () => {
              for (const l of comSugestao) {
                await onReligar(l.projeto.token, eloParaGravar(l.sugestao))
              }
            })}
          >
            {ocupado === 'todos'
              ? 'Religando…'
              : `Religar os ${comSugestao.length} com correspondência clara`}
          </button>
        </div>
      )}

      <ul className="lista-simples">
        {linhas.map(({ projeto, atual, motivo, sugestao }) => (
          <li key={projeto.token}>
            <strong>{projeto.expositor || projeto.stand || projeto.token}</strong>
            <em className="dica-campo">
              {' · '}
              {motivo === 'sumiu'
                ? 'o expositor apontado não existe mais no app'
                : `hoje o elo aponta para “${atual?.expositor || '?'}”`}
            </em>
            {' '}
            {sugestao
              ? (
                <button
                  className="link"
                  disabled={Boolean(ocupado)}
                  onClick={() => rodar(projeto.token, () => onReligar(projeto.token, eloParaGravar(sugestao)))}
                >
                  {ocupado === projeto.token ? 'religando…' : `religar a “${sugestao.expositor}”`}
                </button>
              )
              : (
                <button
                  className="link perigo"
                  disabled={Boolean(ocupado)}
                  onClick={() => rodar(projeto.token, () => onDesvincular(projeto.token))}
                >
                  {ocupado === projeto.token ? 'desfazendo…' : 'desfazer o elo'}
                </button>
              )}
          </li>
        ))}
      </ul>
      <p className="dica-campo">
        Sem correspondência clara — dois expositores com o mesmo nome, ou nome
        que mudou — sobra desfazer o elo e vincular pela lista abaixo, onde o
        stand volta a aparecer como novidade.
      </p>
    </div>
  )
}
