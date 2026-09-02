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
// A chave que liga os dois lados é o `producaoId`. Ela era o `firestore_id` do
// app — que é a POSIÇÃO do expositor na planilha, e por isso trocava de dono a
// cada linha inserida ou apagada. Hoje é a `clientKey`, derivada de feira +
// nome do expositor, calculada igual dos dois lados (ver `chaveCliente.js`).
//
// Os dois convivem: projeto importado antes da mudança ainda guarda o id
// posicional, e a sincronização migra sozinha quando encontra a chave nova.

import { clientKeyFor } from './chaveCliente.js'

/** Campos do app que valem alguma coisa aqui. O resto fica de fora. */
export function normalizarDaProducao(doc = {}) {
  const t = (v) => String(v ?? '').trim()
  const feira = t(doc.fairName)
  const expositor = t(doc.nome)
  return {
    // O id do DOCUMENTO no app. Continua sendo lido porque é o elo antigo, que
    // ainda está gravado nos projetos importados antes desta mudança.
    producaoId: t(doc.producaoId || doc.firestore_id || doc.id),
    // A chave ESTÁVEL, que é o elo novo. Vem do campo publicado pelo app; na
    // falta dele — feira ainda não sincronizada depois da atualização —, é
    // calculada aqui pela mesma função, que é cópia verbatim da de lá. Preferir
    // o valor do app é deliberado: se um dia as duas discordarem, quem manda é
    // quem escreve o documento, e a divergência aparece no teste de paridade em
    // vez de virar uma chave fantasma.
    clientKey: t(doc.clientKey) || clientKeyFor(feira, expositor),
    feira,
    expositor,
    // No app, "local" é o identificador do stand na planta — é o que a nossa
    // ferramenta chama de stand. `nome` é a empresa.
    stand: t(doc.local) || expositor,
    // SÓ o pavilhão. `local` já virou `stand` na linha acima, e gravar os dois
    // aqui fazia o código do stand aparecer duas vezes na mesma linha da lista:
    // uma como título e outra no fim do endereço. Projetos importados antes
    // desta correção continuam com o valor antigo gravado — de quem cuida na
    // hora de mostrar é `localSemRepetirStand`, em `data/projeto.js`.
    localizacao: t(doc.pavilhao),
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

/**
 * O valor que deve ser gravado como `producaoId` de um projeto.
 *
 * A chave estável quando ela existe; o id do documento como último recurso —
 * feira que ainda não sincronizou depois da atualização do app, ou expositor
 * cujo nome não forma chave (vazio, só pontuação, ou repetido na feira).
 * Gravar o id posicional é aceitar a fragilidade antiga naquele stand; é
 * melhor do que não ter elo nenhum, e a sincronização migra sozinha assim que
 * a chave aparecer.
 */
export const eloParaGravar = (c) => c?.clientKey || c?.producaoId || ''

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
 * 1. VAZIO não identifica nada. Vários expositores da mesma feira ficariam sob
 *    a chave "feira|", e o primeiro projeto sem nome viraria o "existente" de
 *    todos eles.
 * 2. CHAVE REPETIDA é chute. Se dois projetos desta feira têm o mesmo nome,
 *    nenhum dos dois é "o" correspondente — e escolher um pelo acaso da ordem
 *    do array é como o elo errado nasce. Sem correspondência, a linha aparece
 *    como novidade e a pessoa decide, que é o certo.
 *
 * São DUAS chaves, stand e expositor, e a segunda não é luxo: há feira cuja
 * planilha vem com a coluna de local em branco — a Conferencia Luxo é uma —, e
 * nela o nome do expositor é a única coisa que resta para reconhecer o stand.
 * Sem ela, "vincular" não aparecia e reimportar criaria um segundo projeto do
 * mesmo cliente, com um segundo link.
 */
export function cruzarComExistentes(daProducao, projetos = []) {
  const porId = new Map()
  const chaveNome = (feira, nome) => `${achatar(feira)}|${achatar(nome)}`

  // Um índice por chave, cada um com o próprio conjunto de ambíguos: um nome de
  // stand repetido não pode calar o casamento por expositor, que talvez esteja
  // perfeitamente claro.
  const indices = [
    { mapa: new Map(), ambiguos: new Set(), doProjeto: (p) => p.stand, doCliente: (c) => c.stand },
    { mapa: new Map(), ambiguos: new Set(), doProjeto: (p) => p.expositor, doCliente: (c) => c.expositor },
  ]

  for (const p of projetos) {
    if (p.producaoId) porId.set(p.producaoId, p)
    for (const ix of indices) {
      const valor = achatar(ix.doProjeto(p))
      if (!valor) continue
      const chave = chaveNome(p.feira, valor)
      if (ix.mapa.has(chave)) ix.ambiguos.add(chave)
      ix.mapa.set(chave, p)
    }
  }

  const porApelidoDe = (c) => {
    for (const ix of indices) {
      const valor = achatar(ix.doCliente(c))
      if (!valor) continue
      const chave = chaveNome(c.feira, valor)
      if (ix.ambiguos.has(chave)) continue
      const achado = ix.mapa.get(chave)
      if (achado) return achado
    }
    return null
  }

  return daProducao.map((c) => {
    // Os dois elos convivem: o projeto guarda a `clientKey` quando foi
    // importado depois da mudança, e o id posicional quando veio antes.
    const existente = porId.get(c.clientKey) || porId.get(c.producaoId) || porApelidoDe(c) || null
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
 * Projetos cujo elo deixou de apontar para o cliente certo — e para onde ele
 * deveria apontar agora.
 *
 * Sem isto o analista fica sem saída. A tela de importação casa por
 * `producaoId` ANTES do nome, então um projeto com elo trocado aparece como
 * "já importado" na linha do cliente errado, e o botão de vincular — que só
 * nasce quando não há elo — nunca aparece. O conserto ficava no console do
 * Firebase, que é onde ninguém vai.
 *
 * A sugestão é o que evita dez religações à mão: procura, entre os clientes do
 * app, quem tem o mesmo nome de expositor. Só sugere quando encontra UM. Dois
 * candidatos é o momento de a pessoa escolher — sugerir no chute aqui seria
 * recriar o mesmo defeito com outro nome.
 */
export function elosDesalinhados(projetos = [], clientesDoApp = []) {
  const porId = new Map(clientesDoApp.map((c) => [c.producaoId, c]))

  const porNome = new Map()
  const nomesAmbiguos = new Set()
  for (const c of clientesDoApp) {
    const chave = achatar(c.expositor)
    if (!chave) continue
    if (porNome.has(chave)) nomesAmbiguos.add(chave)
    porNome.set(chave, c)
  }

  // Primeiro QUEM está fora, depois PARA ONDE cada um vai. A ordem importa: a
  // segunda pergunta depende de saber quem mais está se movendo.
  const fora = []
  for (const p of projetos) {
    if (!p?.producaoId) continue
    const atual = porId.get(p.producaoId) || null
    const veredicto = eloConfere(p, atual)
    if (!veredicto.confere) fora.push({ projeto: p, atual, motivo: veredicto.motivo, sugestao: null })
  }

  // Os ids que vão ficar livres — porque quem os segura hoje também está fora
  // do lugar e vai se mover.
  //
  // Esta distinção é o que faz o conserto existir. Um deslocamento de planilha
  // não espalha os elos ao acaso: ele os ROTACIONA. O id certo da Selia está
  // com o projeto da JadLog, o da JadLog está com o do J&T, e assim por diante,
  // num ciclo fechado. Recusar todo id "já usado" — que era a trava anterior,
  // escrita para evitar dois projetos no mesmo documento — bloqueava a fila
  // inteira justamente no caso para o qual ela foi feita.
  //
  // O que vale é o ESTADO FINAL. Depois de religar todo o ciclo, cada id tem um
  // dono só; durante, há sobreposição, e ela é inofensiva porque a
  // sincronização já se recusa a publicar qualquer id disputado.
  const vaoLiberar = new Set(fora.map((f) => f.projeto.producaoId))

  for (const item of fora) {
    const chave = achatar(item.projeto.expositor)
    if (!chave || nomesAmbiguos.has(chave)) continue
    const alvo = porNome.get(chave)
    if (!alvo) continue

    // Só barra quem segura o id e NÃO vai sair de lá: esse é o conflito de
    // verdade, e sugerir por cima dele criaria dois projetos no mesmo documento.
    const elo = eloParaGravar(alvo)
    const donoParado = projetos.some((o) => (
      o !== item.projeto && o.producaoId === elo && !vaoLiberar.has(o.producaoId)
    ))
    if (!donoParado) item.sugestao = alvo
  }

  return fora
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
export function statusParaProducao(projeto, resumo, provas, identidade = {}) {
  const estado = estadoDaArte(resumo)
  const prova = provaVigente(provas)
  return {
    producaoId: projeto.producaoId,
    // O CARIMBO DE IDENTIDADE. O app confere estes dois campos antes de usar um
    // documento: sem eles, ele aceita (documento antigo, escrito antes disto
    // existir); com eles e não batendo, ele RECUSA em vez de mostrar a prova de
    // outro stand. É o que torna a queda para o id posicional segura durante a
    // transição — e é por isso que o `clientName` importa tanto quanto a chave.
    // Só a chave ESTÁVEL entra aqui. Durante a transição o `producaoId` ainda
    // pode ser o id posicional, e carimbá-lo como `clientKey` seria mentir para
    // a conferência do outro lado: ele passaria a recusar por não bater com a
    // chave dele. Sem carimbo, o documento é tratado como antigo e aceito —
    // que é o comportamento certo enquanto a migração não chegou naquele stand.
    ...(identidade.clientKey ? { clientKey: identidade.clientKey } : {}),
    clientName: identidade.clientName || projeto.expositor || projeto.stand || '',
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
