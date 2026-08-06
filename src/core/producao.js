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
 */
export function cruzarComExistentes(daProducao, projetos = []) {
  const porId = new Map()
  const porNome = new Map()
  const chaveNome = (feira, stand) => `${achatar(feira)}|${achatar(stand)}`

  for (const p of projetos) {
    if (p.producaoId) porId.set(p.producaoId, p)
    porNome.set(chaveNome(p.feira, p.stand), p)
  }

  return daProducao.map((c) => {
    const existente = porId.get(c.producaoId) || porNome.get(chaveNome(c.feira, c.stand)) || null
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
