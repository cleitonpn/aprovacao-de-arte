// A ponte com o app de produção.
//
// São dois projetos Firebase separados, com bases separadas, e vão continuar
// assim. O que existe aqui é um ESPELHO: uma ação agendada copia os
// expositores do app para uma coleção só de leitura deste projeto, e a tela de
// importação lê daqui. Nenhum navegador fala com o outro projeto — nem o do
// cliente, nem o do analista.
//
// O que o app tem e nós não: a feira, o expositor, o stand, a área, o produtor
// e as datas de montagem. Tudo isso hoje é redigitado à mão nesta ferramenta,
// a partir da mesma planilha, com os erros de digitação que isso implica.
//
// O que o app NÃO tem e nós precisamos: o e-mail do expositor e as peças de
// arte. O e-mail é o que o admin completa na importação; as peças, o analista
// cadastra depois — o app não as conhece e nunca vai conhecer.
//
// A chave que liga os dois lados é o `producaoId` (o `firestore_id` de lá).
// É ela que, mais adiante, deixa o app saber de qual projeto vem a prova e o
// status da arte. Sem a importação, essa chave não existe.

/** Campos do app que valem alguma coisa aqui. O resto fica de fora. */
export function normalizarDaProducao(doc = {}) {
  const t = (v) => String(v ?? '').trim()
  return {
    producaoId: t(doc.producaoId || doc.firestore_id || doc.id),
    feira: t(doc.fairName),
    expositor: t(doc.nome),
    // No app, "local" é o identificador do stand na planta — é o que a nossa
    // ferramenta chama de stand. `nome` é a empresa.
    stand: t(doc.local) || t(doc.nome),
    localizacao: [t(doc.pavilhao), t(doc.local)].filter(Boolean).join(' · '),
    area: t(doc.total_area) || t(doc.area),
    produtor: t(doc.produtor),
    atendimento: t(doc.atendimento),
    organizadora: t(doc.organizadora),
    linkDrive: t(doc.project_link) || t(doc.link_drive),
    dataMontagem: t(doc.data_montagem),
    dataEvento: t(doc.data_evento),
    dataDesmontagem: t(doc.data_desmontagem),
  }
}

/** Serve para alguma coisa? Sem feira e sem nome, é linha vazia da planilha. */
export const utilizavel = (c) => Boolean(c.producaoId && c.feira && (c.expositor || c.stand))

/**
 * Cruza o que veio da produção com o que já existe aqui.
 *
 * Reimportar não pode criar um segundo projeto do mesmo stand — o cliente
 * receberia dois links e o time veria a arte dividida entre duas fichas. A
 * comparação é pelo `producaoId` quando ele existe; para os projetos
 * cadastrados à mão antes desta ponte, cai para feira + stand, que é o par que
 * de fato identifica um stand na operação.
 *
 * O CASAMENTO POR NOME É O PERIGOSO, e por isso ele agora recusa dois casos.
 * Ele alimenta o botão "vincular", e vincular grava o `producaoId` — o elo pelo
 * qual o app de montagem descobre a prova daquele stand. Um elo errado não
 * aparece aqui: aparece lá, como o print de um cliente na ficha de outro.
 *
 * 1. STAND EM BRANCO não identifica nada. Vários expositores da mesma feira
 *    ficariam sob a chave "feira|", e o primeiro projeto sem nome de stand
 *    viraria o "existente" de todos eles.
 * 2. CHAVE REPETIDA é chute. Se dois projetos desta feira têm o mesmo nome de
 *    stand, nenhum dos dois é "o" correspondente — e escolher um pelo acaso da
 *    ordem do array é como o elo errado nasce. Sem correspondência, a linha
 *    aparece como novidade e a pessoa decide, que é o certo.
 */
export function cruzarComExistentes(daProducao, projetos = []) {
  const porId = new Map()
  const porNome = new Map()
  const ambiguos = new Set()
  const chaveNome = (feira, stand) => `${achatar(feira)}|${achatar(stand)}`

  for (const p of projetos) {
    if (p.producaoId) porId.set(p.producaoId, p)
    if (!achatar(p.stand)) continue
    const chave = chaveNome(p.feira, p.stand)
    if (porNome.has(chave)) ambiguos.add(chave)
    porNome.set(chave, p)
  }

  return daProducao.map((c) => {
    const chave = chaveNome(c.feira, c.stand)
    const porApelido = achatar(c.stand) && !ambiguos.has(chave) ? porNome.get(chave) : null
    const existente = porId.get(c.producaoId) || porApelido || null
    return {
      ...c,
      existente,
      // Já veio desta ponte, ou é um projeto antigo que ela reconheceu?
      jaImportado: Boolean(existente),
      // Cadastrado à mão antes e agora reconhecido: importar viraria duplicata,
      // mas vincular é útil — é o que dá ao app o elo com este projeto.
      vincula: Boolean(existente && !existente.producaoId),
    }
  })
}

/**
 * O elo com o app ainda aponta para o mesmo cliente?
 *
 * A pergunta existe porque a chave da ponte é FRÁGIL por construção. Do lado do
 * app, o id do expositor é `nomeDaFeira_númeroDaLinha` — a posição dele na
 * planilha, e não um identificador dele. Inserir uma linha, apagar outra ou
 * reordenar a planilha reescreve o id de todo mundo abaixo, e cada cliente
 * herda o id que era do vizinho.
 *
 * O estrago é invisível dos dois lados: aqui o projeto continua certo, lá o
 * cartão continua certo — o que troca é a correspondência entre eles. Foi assim
 * que o print de um cliente foi parar na ficha de outro.
 *
 * A conferência é deliberadamente FROUXA: basta o nome do expositor OU o do
 * stand ainda baterem. Nome de empresa muda na planilha ("Selia" vira "Selia
 * Cosméticos") e stand é renumerado sem que a correspondência tenha se perdido;
 * exigir os dois transformaria toda correção de digitação num alarme. Quando
 * NENHUM dos dois bate, não é mais o mesmo cliente.
 */
export function eloConfere(projeto, clienteDoApp) {
  if (!clienteDoApp) return { confere: false, motivo: 'sumiu' }

  const expositor = achatar(projeto?.expositor)
  const stand = achatar(projeto?.stand)
  const nomeLa = achatar(clienteDoApp.expositor ?? clienteDoApp.nome)
  const standLa = achatar(clienteDoApp.stand ?? clienteDoApp.local)

  // Sem nada com que comparar, não dá para afirmar que está errado — e barrar
  // por falta de dado calaria stands que estão perfeitos.
  if (!expositor && !stand) return { confere: true, motivo: 'sem_referencia' }
  if (!nomeLa && !standLa) return { confere: true, motivo: 'sem_referencia' }

  const bateNome = Boolean(expositor && nomeLa && expositor === nomeLa)
  const bateStand = Boolean(stand && standLa && stand === standLa)
  if (bateNome || bateStand) return { confere: true, motivo: bateNome ? 'nome' : 'stand' }

  return {
    confere: false,
    motivo: 'trocado',
    esperado: `${projeto?.expositor || '?'} / ${projeto?.stand || '?'}`,
    encontrado: `${clienteDoApp.expositor ?? clienteDoApp.nome ?? '?'} / ${clienteDoApp.stand ?? clienteDoApp.local ?? '?'}`,
  }
}

/**
 * Projetos que disputam o mesmo expositor do app de montagem.
 *
 * O `producaoId` é a única ponte entre as duas bases, e ela é 1 para 1: o app
 * guarda um documento por expositor. Dois projetos com o mesmo elo escrevem no
 * mesmo lugar, e vence o último — sem erro, sem aviso, alternando a cada
 * sincronização.
 *
 * O sintoma nasce longe da causa: o print de um cliente abre na ficha de outro
 * NO APP, enquanto na ferramenta cada um mostra o seu, corretamente. Quem vê o
 * problema não tem como adivinhar que a causa é um elo aqui — por isso ele
 * precisa aparecer nesta tela, escrito.
 */
export function elosDuplicados(projetos = []) {
  const porId = new Map()
  for (const p of projetos) {
    if (!p?.producaoId) continue
    porId.set(p.producaoId, [...(porId.get(p.producaoId) || []), p])
  }
  return [...porId.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([producaoId, lista]) => ({ producaoId, projetos: lista }))
}

const achatar = (v) => String(v || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '')

/** As feiras presentes no espelho, com quantos expositores cada uma tem. */
export function feirasDaProducao(clientes = []) {
  const mapa = new Map()
  for (const c of clientes) {
    if (!c.feira) continue
    const atual = mapa.get(c.feira) || { nome: c.feira, total: 0, datas: null }
    atual.total += 1
    if (!atual.datas && (c.dataMontagem || c.dataEvento)) {
      atual.datas = { montagem: c.dataMontagem, evento: c.dataEvento, desmontagem: c.dataDesmontagem }
    }
    mapa.set(c.feira, atual)
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * O que falta para este expositor virar projeto utilizável.
 *
 * O e-mail é o único bloqueio real: sem ele não há para quem mandar o link, e
 * a cobrança não tem destinatário. As peças ficam de fora da lista de
 * impedimentos de propósito — elas são o trabalho do analista DEPOIS de
 * importar, e exigir que existam na importação seria pedir que ele cadastrasse
 * 40 stands antes de conseguir salvar o primeiro.
 */
export function pendenciasDe(cliente, email) {
  const faltas = []
  if (!EMAIL_SIMPLES.test(String(email || '').trim())) faltas.push('e-mail')
  if (!cliente.stand) faltas.push('stand')
  return faltas
}

const EMAIL_SIMPLES = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// ------------------------------------------- o que o app de produção vê
//
// A ferramenta controla a arte PEÇA a peça; o app precisa de uma linha por
// stand. Quem lê no app é o produtor no meio da montagem, e a pergunta dele é
// uma só: "posso contar com essa arte?".
//
// Por isso o agregado é o estado MAIS ATRASADO, não o mais avançado nem uma
// média. Um stand com quatro peças impressas e uma sem arte nenhuma não está
// 80% pronto — está esperando o cliente, e é isso que o produtor precisa
// enxergar. O contador ao lado é o que separa "falta uma" de "falta tudo".

export const ESTADOS_ARTE = {
  sem_pecas: { rotulo: 'Artes não cadastradas', cor: 'cinza' },
  aguardando: { rotulo: 'Aguardando cliente', cor: 'vermelho' },
  em_analise: { rotulo: 'Em análise na CV', cor: 'laranja' },
  aprovada: { rotulo: 'Aprovada', cor: 'verde' },
  em_impressao: { rotulo: 'Em impressão', cor: 'azul' },
  impressa: { rotulo: 'Impressa', cor: 'verde' },
}

/**
 * O estado da arte de um stand, do jeito que o app mostra.
 *
 * `resumo` é o de `resumoDoProjeto` — passado de fora para esta função ficar
 * pura e o script de sincronização usar exatamente o mesmo motor que a tela do
 * analista. Duas implementações do mesmo estado divergiriam em uma semana, e o
 * produtor veria no app um status que o analista não reconhece.
 */
export function estadoDaArte(resumo) {
  if (!resumo || !resumo.total) return 'sem_pecas'
  // A ordem É a regra: o primeiro que casar vence, e eles estão do mais
  // atrasado para o mais adiantado.
  if (resumo.aguardandoCliente > 0) return 'aguardando'
  const recebidasSemProva = resumo.pecas.filter((p) => p.status === 'recebida').length
  if (recebidasSemProva > 0) return 'em_analise'
  if (resumo.impressas === resumo.total) return 'impressa'
  const aprovadasParadas = resumo.pecas.filter((p) => p.status === 'aprovada').length
  if (aprovadasParadas > 0) return 'aprovada'
  if (resumo.emImpressao > 0) return 'em_impressao'
  return 'aprovada'
}

/** A prova mais recente que tem arquivo — é ela que vale no app. */
export function provaVigente(provas = []) {
  const comArquivo = provas.filter((p) => p?.arquivo?.link)
  if (!comArquivo.length) return null
  const p = comArquivo[0] // `provasDoProjeto` já vem da mais nova para a mais velha
  return { link: p.arquivo.link, em: p.enviadaEm || null, id: p.id }
}

/** O documento que a ferramenta publica para o app ler. */
export function statusParaProducao(projeto, resumo, provas) {
  const estado = estadoDaArte(resumo)
  const prova = provaVigente(provas)
  return {
    producaoId: projeto.producaoId,
    fairName: projeto.producaoFeira || projeto.feira || '',
    token: projeto.token,
    estado,
    rotulo: ESTADOS_ARTE[estado].rotulo,
    recebidas: resumo?.recebidas ?? 0,
    total: resumo?.total ?? 0,
    linkProva: prova?.link || '',
    provaEm: prova?.em || '',
  }
}
