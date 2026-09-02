import { useEffect, useMemo, useState } from 'react'
import { panorama, situacaoDoProjeto } from '../core/painel.js'
import { ouvirProjetos, ouvirEnvios } from '../services/projetos.js'
import { traduzirErroAuth } from '../services/sessao.js'
import { vistoEm, assinarVisto } from '../store/visto.js'
import { temMensagemNova, chaveDaConversa } from '../core/conversa.js'
import { formatarData } from '../core/datas.js'
import { LIMITE_REPROVACOES } from '../core/reprovacoes.js'
import { usarFeiras } from '../store/feiras.js'
// A EMPRESA é o título de um stand em toda a ferramenta; o código na planta
// ("A25") é o endereço dela. Aqui as duas viviam trocadas, como na lista de
// projetos — e as telas ficariam se contradizendo se só uma mudasse.
import { tituloDoProjeto } from '../data/projeto.js'
import CaixaDeAlerta from './CaixaDeAlerta.jsx'

/**
 * O código do stand como texto de apoio, já com o separador.
 *
 * Devolve string vazia quando não há código a mostrar — projeto sem empresa
 * cadastrada, em que o próprio código virou o título. Sem esta guarda a linha
 * saía com dois pontinhos colados ("·  · 3"), que é o tipo de sujeira que
 * ninguém reporta e todo mundo vê.
 */
const apoioDoStand = (projeto) => {
  const { apoio } = tituloDoProjeto(projeto)
  return apoio ? ` · ${apoio}` : ''
}

// A feira inteira numa tela.
//
// Esta tela não tem nenhum dado próprio: é uma leitura diferente dos mesmos
// documentos que a lista de projetos já carrega. A diferença é a pergunta. A
// lista responde "como está ESTE stand?", uma linha por vez; aqui a pergunta é
// "como está a feira?", e ela não era respondível sem ler trezentas linhas e
// somar de cabeça.
//
// O que ela deliberadamente NÃO é: um relatório. Não tem gráfico de evolução
// nem comparação entre feiras — nada que sirva para contemplar depois. Cada
// bloco daqui termina num stand em que dá para clicar, porque o painel existe
// para virar ação na mesma manhã.

/** Endereço da ficha de um stand, para os atalhos daqui. */
const linkDaFicha = (feiraId, token) => `#/projetos/${feiraId}/${token}`

export default function Visao({ sessao }) {
  const { fb, usuario } = sessao
  const { feiras, feira, feiraId, setFeiraId, erro: erroFeiras } = usarFeiras(fb, sessao.acesso)
  const [projetos, setProjetos] = useState([])
  const [envios, setEnvios] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [versaoDoVisto, setVersaoDoVisto] = useState(0)

  useEffect(() => assinarVisto(() => setVersaoDoVisto((v) => v + 1)), [])

  useEffect(() => {
    if (!fb || !feiraId) { setProjetos([]); setEnvios([]); return undefined }
    setCarregando(true)
    setErro(null)
    const falhou = (e) => setErro(traduzirErroAuth(e))
    const pararProjetos = ouvirProjetos(fb, feiraId, (lista) => {
      setProjetos(lista)
      setCarregando(false)
    }, falhou)
    const pararEnvios = ouvirEnvios(fb, feiraId, setEnvios, falhou)
    return () => { pararProjetos(); pararEnvios() }
  }, [fb, feiraId])

  const enviosPorProjeto = useMemo(() => {
    const mapa = new Map()
    for (const e of envios) {
      if (!e.projetoId) continue
      if (!mapa.has(e.projetoId)) mapa.set(e.projetoId, [])
      mapa.get(e.projetoId).push(e)
    }
    return mapa
  }, [envios])

  const cenario = useMemo(() => {
    // O prazo vem da feira, como em todas as outras telas.
    const comPrazo = (p) => (feira && 'prazoEnvio' in feira ? { ...p, prazoEnvio: feira.prazoEnvio } : p)
    const linhas = projetos.map((p) => ({
      projeto: p,
      sit: situacaoDoProjeto(comPrazo(p), enviosPorProjeto.get(p.token) || []),
      // A mesma conta da badge do popup, e por isso vem de `core/conversa.js`:
      // duas cópias derivariam, e o jeito de a bolinha perder a confiança do
      // time é acender quando não devia.
      temMensagemNova: temMensagemNova({
        conversa: p.conversa,
        ehTime: true,
        vistoEmMs: vistoEm(usuario?.email, chaveDaConversa(p.token)),
      }),
    }))
    return panorama(linhas, { feira })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projetos, enviosPorProjeto, feira, usuario?.email, versaoDoVisto])

  return (
    <>
      <div className="cartao">
        <div className="admin-topo">
          <div>
            <h2>Visão geral</h2>
            <p className="ajuda">
              A feira inteira de uma olhada. Tudo aqui é clicável e leva ao
              stand — o painel serve para virar ação, não para contemplar.
            </p>
          </div>
          <span className="dica-campo ao-vivo">ao vivo</span>
        </div>

        <label className="campo">
          <span>Feira</span>
          <select value={feiraId} onChange={(e) => setFeiraId(e.target.value)}>
            {!feiras.length && <option value="">Nenhuma feira cadastrada ainda</option>}
            {feiras.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>

        {(erro || erroFeiras) && <p className="erro-envio">{erro || erroFeiras}</p>}
        <Prazo prazo={cenario.prazo} incompletos={cenario.incompletos.length} />
      </div>

      {carregando && <div className="cartao"><p className="ajuda">Carregando…</p></div>}

      {!carregando && !projetos.length && (
        <div className="cartao">
          <p className="ajuda">
            Nenhum projeto cadastrado nesta feira. Comece por{' '}
            <a href="#/projetos">Projetos → Importar planilha</a>.
          </p>
        </div>
      )}

      {!carregando && projetos.length > 0 && (
        <>
          {/*
            A ordem é a da urgência, não a do raciocínio.

            Antes vinha a esteira — que é contexto, e responde "como a feira
            está indo" — e só depois as duas listas que pedem alguém agora.
            Num painel que existe para virar ação na mesma manhã, contexto
            antes de ação empurra a ação para baixo da dobra: quem abre às oito
            lê a barra bonita e rola até o café esfriar.

            Agora: os números, o que exige uma PESSOA hoje (ligar, ajudar), o
            que exige um CLIQUE do time, e por último o panorama e a cobrança.
          */}
          {/*
            Os números e a grade de estados moram no MESMO cartão. São duas
            leituras da mesma pergunta — "como está a feira?" — e em caixas
            separadas o olho fazia a viagem duas vezes: contava 87% num
            retângulo branco e ia procurar, noutro retângulo branco, de que
            87% se tratava.
          */}
          <Panorama cenario={cenario} feiraId={feiraId} />
          <Intervencao linhas={cenario.acoes.intervencao} feiraId={feiraId} />
          <Dificuldade linhas={cenario.acoes.dificuldade} feiraId={feiraId} />
          <PrecisaDeVoce cenario={cenario} feiraId={feiraId} />
          <QuemFalta cenario={cenario} feiraId={feiraId} />
        </>
      )}
    </>
  )
}

function Prazo({ prazo, incompletos }) {
  if (!prazo.temPrazo) {
    return (
      <p className="nota">
        Esta feira não tem prazo de envio cadastrado — nenhum envio será
        bloqueado e o cliente não vê aviso de urgência.{' '}
        <a href="#/projetos">Cadastrar o prazo</a>.
      </p>
    )
  }
  if (prazo.vencido) {
    return (
      <div className="bloco-prazo vencido">
        <strong>Prazo encerrado em {formatarData(prazo.limite)}.</strong>{' '}
        {incompletos > 0
          ? `${incompletos} stand(s) ainda estão incompletos e precisam de liberação caso a caso.`
          : 'Todos os stands estão completos.'}
      </div>
    )
  }
  return (
    <div className={`bloco-prazo ${prazo.diasRestantes <= 7 ? 'perto' : ''}`}>
      <strong>
        Prazo de envio: {formatarData(prazo.limite)} —{' '}
        {prazo.diasRestantes === 0 ? 'é hoje' : `faltam ${prazo.diasRestantes} dia(s)`}.
      </strong>{' '}
      {incompletos > 0 && `${incompletos} stand(s) ainda não fecharam a lista.`}
    </div>
  )
}

/**
 * Os quatro números que respondem "como está a feira?".
 *
 * Stands e artes são contas diferentes de propósito, e confundi-las é o erro
 * clássico deste tipo de painel: 80% das artes recebidas pode significar
 * quinze stands prontos e um parado, ou dezesseis pela metade. São duas
 * situações que pedem trabalhos opostos.
 */
function Numeros({ cenario }) {
  const { artes } = cenario
  return (
    <div className="numeros-painel">
      <Cartao
        valor={`${artes.pct}%`}
        rotulo="das artes recebidas"
        detalhe={`${artes.recebidas} de ${artes.total}`}
        cor={artes.pct >= 100 ? 'ok' : artes.pct >= 50 ? 'neutro' : 'alerta'}
      />
      <Cartao
        valor={cenario.completos}
        rotulo={`de ${cenario.stands} stands completos`}
        detalhe={cenario.stands - cenario.completos > 0
          ? `${cenario.stands - cenario.completos} ainda em aberto`
          : 'todos fechados'}
        cor={cenario.completos === cenario.stands ? 'ok' : 'neutro'}
      />
      <Cartao
        valor={cenario.semNada.length}
        rotulo="stands sem nenhuma arte"
        detalhe={cenario.semNada.length ? 'não mandaram nada ainda' : 'todo mundo começou'}
        cor={cenario.semNada.length ? 'ruim' : 'ok'}
      />
      <Cartao
        valor={cenario.aFazer}
        rotulo="coisas esperando o time"
        detalhe={cenario.aFazer ? 'pedidos, provas, mensagens e ajuda' : 'nada parado com a gente'}
        cor={cenario.aFazer ? 'alerta' : 'ok'}
      />
      {/*
        O quinto número, e o único que fala de RISCO em vez de andamento.

        Os outros quatro dizem quanto falta; este diz quanto já passou sem
        ninguém ter olhado. São artes cujo laudo promete conferência humana
        porque a ferramenta não conseguiu abrir a imagem — e elas não estão
        paradas: estão liberadas, andando para a impressora. Um número que fica
        em zero na maioria dos dias e, quando não fica, é a coisa mais urgente
        da tela.
      */}
      <Cartao
        valor={cenario.artesSemConferir}
        rotulo="artes esperando olho humano"
        detalhe={cenario.artesSemConferir
          ? `em ${cenario.acoes.conferencia.length} stand(s) — a ferramenta não abriu`
          : 'nenhuma pendente'}
        cor={cenario.artesSemConferir ? 'ruim' : 'ok'}
      />
    </div>
  )
}

function Cartao({ valor, rotulo, detalhe, cor }) {
  return (
    <div className={`numero-cartao ${cor}`}>
      <strong>{valor}</strong>
      <span>{rotulo}</span>
      {detalhe && <em className="dica-campo">{detalhe}</em>}
    </div>
  )
}

/**
 * O panorama da feira: os cinco números e onde estão as peças.
 *
 * Um cartão só, e não dois. São duas leituras da mesma pergunta, e separadas
 * o olho fazia a viagem duas vezes — lia "87% das artes recebidas" num
 * retângulo branco e ia procurar, noutro retângulo branco igual, de que 87% se
 * tratava.
 *
 * A grade de estados era uma barra proporcional. A proporção respondia "está
 * tudo empilhado ou já foi para a impressora?", e falhava no que o time mais
 * olha: com um estado em 59 e outro em 2, o segundo virava um risco de dois
 * pixels com o número ilegível dentro — e era o estado pequeno que pedia ação.
 * Os cartões trocam proporção por leitura.
 */
function Panorama({ cenario, feiraId }) {
  // Um estado aberto de cada vez. Abrir vários empurraria o resto do painel
  // para fora da tela, e ele vale justamente por caber numa olhada.
  const [aberta, setAberta] = useState(null)

  const faixa = cenario.esteira.find((f) => f.id === aberta) || null
  const alternar = (id) => setAberta((atual) => (atual === id ? null : id))

  return (
    <div className="cartao painel-panorama">
      <Numeros cenario={cenario} />

      {cenario.pecasTotal > 0 && (
        <>
          <div className="titulo-secao com-linha">
            <h3>Onde estão as peças</h3>
            <span className="dica-campo">{cenario.pecasTotal} peças no total</span>
          </div>

          <div className="grade-estados">
            {cenario.esteira.map((f) => (
              <button
                type="button"
                key={f.id}
                className={`estado-cartao ${f.cor}${aberta === f.id ? ' aberto' : ''}${f.n ? '' : ' vazio'}`}
                onClick={() => alternar(f.id)}
                aria-expanded={aberta === f.id}
                disabled={!f.n}
              >
                {/*
                  Dois dígitos sempre. Não é enfeite: com "9" e "59" lado a lado
                  os números dançam de largura e a linha inteira precisa ser
                  relida. Com "09" e "59" a coluna fica estável e o olho compara
                  sozinho.
                */}
                <span className="estado-numero">{String(f.n).padStart(2, '0')}</span>
                <span className="estado-rotulo">{f.curto}</span>
                <span className="estado-acao" aria-hidden>
                  {f.n ? (aberta === f.id ? 'FECHAR' : 'VER STANDS') : '—'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {faixa && (
        <div className="esteira-detalhe">
          <div className="titulo-secao">
            <h4>{faixa.rotulo}</h4>
            <button type="button" className="btn btn-ghost" onClick={() => setAberta(null)}>
              Fechar
            </button>
          </div>
          <p className="ajuda">
            {faixa.n} {faixa.n === 1 ? 'peça' : 'peças'} em {faixa.stands.length}{' '}
            {faixa.stands.length === 1 ? 'stand' : 'stands'}, do que tem mais para o que tem menos.
          </p>
          <ul className="pecas-lista">
            {faixa.stands.map(({ projeto, pecas }) => (
              <li key={projeto.token} className="pendente">
                <div>
                  <strong>
                    <a href={linkDaFicha(feiraId, projeto.token)}>{tituloDoProjeto(projeto).titulo}</a>
                  </strong>
                  <em className="dica-campo">{apoioDoStand(projeto)} · {pecas.length}</em>
                  <p className="dica-campo">{pecas.join(' · ')}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** A fila de trabalho do time: só o que não anda sem alguém daqui. */
function PrecisaDeVoce({ cenario, feiraId }) {
  const { pedidos, provas, mensagens, conferencia } = cenario.acoes
  if (!pedidos.length && !provas.length && !mensagens.length && !conferencia.length) {
    return (
      <div className="cartao">
        <h3>Precisa de você</h3>
        <p className="ajuda">Nada parado esperando o time. O que falta está com os clientes.</p>
      </div>
    )
  }
  return (
    <div className="cartao">
      <h3>Precisa de você</h3>
      <div className="grade-pendencias">
        <Pendencia titulo="Pedidos de nova versão" linhas={pedidos} feiraId={feiraId}
          vazio="nenhum pedido em aberto"
          detalhe={(sit) => `${sit.pedidosEmAberto.length} peça(s)`} />
        <Pendencia titulo="Provas com o cliente" linhas={provas} feiraId={feiraId}
          vazio="nenhuma prova aguardando"
          detalhe={(sit) => `${sit.provasAguardando} peça(s)`} />
        <Pendencia titulo="Mensagens novas" linhas={mensagens} feiraId={feiraId}
          vazio="nenhuma mensagem nova"
          detalhe={() => 'respondeu no chat'} />
        {/* Esta não espera resposta de ninguém de fora: espera alguém daqui
            abrir o arquivo. E ela não segura a peça — a arte já seguiu. */}
        <Pendencia titulo="Conferir à mão" linhas={conferencia} feiraId={feiraId}
          vazio="nada esperando conferência"
          detalhe={(sit) => `${sit.semConferir.length} arte(s) que não abrimos`} />
      </div>
    </div>
  )
}

function Pendencia({ titulo, linhas, feiraId, vazio, detalhe }) {
  return (
    <div className="pendencia">
      <div className="pendencia-topo">
        <strong>{titulo}</strong>
        <span className={`tag ${linhas.length ? 'reprovado' : 'aprovado'}`}>{linhas.length}</span>
      </div>
      {!linhas.length
        ? <p className="dica-campo">{vazio}</p>
        : (
          <ul className="lista-simples">
            {linhas.slice(0, 6).map(({ projeto, sit }) => (
              <li key={projeto.token}>
                <a href={linkDaFicha(feiraId, projeto.token)}>{tituloDoProjeto(projeto).titulo}</a>
                <em className="dica-campo"> · {detalhe(sit)}</em>
              </li>
            ))}
            {linhas.length > 6 && <li className="dica-campo">e mais {linhas.length - 6}…</li>}
          </ul>
        )}
    </div>
  )
}

/**
 * Clientes que estão penando.
 *
 * O bloco mais novo do painel e o que mais muda a operação: até agora, o
 * cliente que tentava e era reprovado ficava invisível. A arte reprovada não
 * sobe — é o ponto da ferramenta —, então para o painel ele era idêntico ao
 * cliente que nem abriu o link. Cobrança não resolve o primeiro caso.
 */
function Dificuldade({ linhas, feiraId }) {
  return (
    <CaixaDeAlerta
      titulo="Clientes que precisam de ajuda"
      quantos={linhas.length}
      etiqueta={`mais de ${LIMITE_REPROVACOES} reprovações`}
      ajuda={'Estes clientes tentaram enviar e a análise recusou o arquivo — arte reprovada não '
        + 'chega até nós, então no resto do painel eles parecem apenas atrasados. Não estão '
        + 'parados: estão travados. Abra a ficha para ver em que ponto.'}
    >
      <ul className="pecas-lista">
        {linhas.map(({ projeto, sit }) => (
          <li key={projeto.token} className="pendente">
            <span className="marca" aria-hidden>!</span>
            <div>
              <strong>
                <a href={linkDaFicha(feiraId, projeto.token)}>{tituloDoProjeto(projeto).titulo}</a>
              </strong>
              <em className="dica-campo">{apoioDoStand(projeto)} · {sit.recebidas} de {sit.total} artes</em>
              <p className="dica-campo">
                <strong className="destaque-pendencia">{sit.dificuldade.total} tentativas reprovadas</strong>
                {sit.dificuldade.ultimaPeca && ` · última em ${sit.dificuldade.ultimaPeca}`}
                {sit.dificuldade.ultimoMotivo && <> · {sit.dificuldade.ultimoMotivo}</>}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </CaixaDeAlerta>
  )
}

/**
 * Quem precisa de um telefonema hoje.
 *
 * Todo o resto do painel aponta para dentro: um clique do analista resolve.
 * Esta lista aponta para fora — são os stands em que nenhum clique adianta
 * porque o cliente não está no processo. Duas portas de entrada:
 *
 * - o e-mail voltou. O canal está quebrado e vai continuar quebrado: o aviso da
 *   prova pronta, mais adiante, também não vai chegar. Só uma pessoa conserta.
 * - silêncio com o prazo em cima. A quatro dias do fim, quem nunca abriu o link
 *   não tem como ter começado — o gabarito só existe na página.
 *
 * Deliberadamente curta. Uma lista de trinta nomes vira parede e ninguém liga
 * para ninguém; é por isso que "nunca abriu" com trinta dias pela frente não
 * entra aqui.
 */
function Intervencao({ linhas, feiraId }) {
  return (
    <CaixaDeAlerta
      titulo="Ligar hoje"
      quantos={linhas.length}
      etiqueta="o sistema não resolve sozinho"
      // Esta abre por padrão: é a única lista do painel que aponta para FORA do
      // sistema, e o custo de não ver é um cliente que não chega a tempo.
      abertaPorPadrao
      ajuda={(
        <>
          Nestes stands o problema não é falta de cobrança automática — é que o
          cliente não está no processo. O e-mail voltou, ou ninguém abriu o link
          até agora e o prazo está perto. Depois de falar com ele, use{' '}
          <strong>Já falei com o cliente</strong> na ficha do stand: o aviso sai
          desta lista para o time inteiro.
        </>
      )}
    >
      <ul className="pecas-lista">
        {linhas.map(({ projeto, sit }) => (
          <li key={projeto.token} className="pendente">
            <span className="marca" aria-hidden>!</span>
            <div>
              <strong>
                <a href={linkDaFicha(feiraId, projeto.token)}>{tituloDoProjeto(projeto).titulo}</a>
              </strong>
              <em className="dica-campo">{apoioDoStand(projeto)} · {sit.recebidas} de {sit.total} artes</em>
              <p className="dica-campo">
                {sit.correio.estado === 'voltou' || sit.correio.estado === 'reclamou'
                  ? (
                    <>
                      <strong className="destaque-pendencia">{sit.correio.rotulo}</strong>
                      {sit.correio.para && <> · {sit.correio.para}</>}
                      {' · '}{sit.correio.acao}
                    </>
                  )
                  : (
                    <>
                      <strong className="destaque-pendencia">{sit.sinal.rotulo}</strong>
                      {' · '}{sit.sinal.acao}
                    </>
                  )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </CaixaDeAlerta>
  )
}

/** Quem ainda deve arte, do mais atrasado para o menos. */
function QuemFalta({ cenario, feiraId }) {
  const lista = cenario.incompletos
  if (!lista.length) {
    return (
      <div className="cartao">
        <h3>Quem ainda falta</h3>
        <p className="ajuda">Nenhum. Todas as artes desta feira já chegaram.</p>
      </div>
    )
  }
  return (
    <div className="cartao">
      <div className="titulo-secao">
        <h3>Quem ainda falta ({lista.length})</h3>
        <a className="link" href="#/projetos">Ir para a cobrança</a>
      </div>
      <ul className="pecas-lista">
        {lista.slice(0, 12).map(({ projeto, sit }) => (
          <li key={projeto.token} className={sit.recebidas ? 'entregue' : 'pendente'}>
            <span className="marca" aria-hidden>{sit.recebidas ? '·' : '×'}</span>
            <div>
              <strong>
                <a href={linkDaFicha(feiraId, projeto.token)}>{tituloDoProjeto(projeto).titulo}</a>
              </strong>
              <em className="dica-campo">{apoioDoStand(projeto)}</em>
              <p className="dica-campo">
                {sit.recebidas} de {sit.total} artes · faltam{' '}
                {sit.pendentes.map(({ peca }) => peca.rotulo).slice(0, 3).join(', ')}
                {sit.pendentes.length > 3 && ` e mais ${sit.pendentes.length - 3}`}
                {/*
                  Por que ainda falta. Sem isto a linha diz o tamanho do atraso
                  e nada sobre a causa — e a causa é o que decide se a próxima
                  ação é cobrar, ligar ou ajudar.
                */}
                {sit.sinal.id !== 'enviando' && <> · <span className={`sinal ${sit.sinal.cor}`}>{sit.sinal.rotulo}</span></>}
                {/*
                  Quem já foi atendido continua na lista — ele ainda deve arte —
                  mas com a marca de que alguém do time já falou. Sem isso, o
                  próximo analista liga de novo e o cliente ouve a mesma cobrança
                  duas vezes no mesmo dia.
                */}
                {sit.contato?.houve && <> · <span className="sinal bom">time já falou</span></>}
              </p>
            </div>
            <div className="barra-mini" aria-hidden>
              <div style={{ width: `${sit.total ? (sit.recebidas / sit.total) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {lista.length > 12 && (
        <p className="dica-campo">e mais {lista.length - 12} stands — a lista completa está em <a href="#/projetos">Projetos</a>.</p>
      )}
    </div>
  )
}
