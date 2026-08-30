import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarDaProducao, utilizavel, cruzarComExistentes, feirasDaProducao, pendenciasDe,
  elosDuplicados, eloConfere, elosDesalinhados,
} from '../src/core/producao.js'
import { projetoNovo, normalizarProjeto } from '../src/data/projeto.js'

// A ponte com o app de produção. O erro caro aqui não é a tela ficar feia — é
// importar duas vezes o mesmo stand: o cliente recebe dois links, manda a arte
// num, e o time cobra pelo outro para sempre.

const daProducao = (extra = {}) => ({
  producaoId: 'conferencialuxo_12',
  fairName: 'Conferencia Luxo - ECBR',
  nome: 'After Click',
  local: 'A12',
  pavilhao: 'Pavilhão Azul',
  total_area: '36',
  produtor: 'Marcos',
  atendimento: 'Ana',
  project_link: 'https://drive.google.com/x',
  data_montagem: '20/08/2026',
  ...extra,
})

test('traduz o vocabulário do app para o daqui', () => {
  const c = normalizarDaProducao(daProducao())
  assert.equal(c.feira, 'Conferencia Luxo - ECBR')
  assert.equal(c.expositor, 'After Click', 'nome no app é o expositor aqui')
  assert.equal(c.stand, 'A12', '"local" no app é o stand aqui — não o nome da empresa')
  assert.equal(c.localizacao, 'Pavilhão Azul · A12')
  assert.equal(c.area, '36')
  assert.equal(c.linkDrive, 'https://drive.google.com/x')
})

test('sem stand na planta, o nome da empresa serve de stand', () => {
  const c = normalizarDaProducao(daProducao({ local: '' }))
  assert.equal(c.stand, 'After Click')
})

test('linha vazia da planilha não vira candidato a importação', () => {
  assert.equal(utilizavel(normalizarDaProducao(daProducao())), true)
  assert.equal(utilizavel(normalizarDaProducao({ fairName: 'X' })), false, 'sem id')
  assert.equal(utilizavel(normalizarDaProducao({ producaoId: 'x', nome: 'Y' })), false, 'sem feira')
  assert.equal(utilizavel(normalizarDaProducao({ producaoId: 'x', fairName: 'F' })), false, 'sem nome nem stand')
})

test('quem já foi importado não pode ser importado de novo', () => {
  const c = normalizarDaProducao(daProducao())
  const [linha] = cruzarComExistentes([c], [
    { token: 'tok1', feira: c.feira, stand: c.stand, producaoId: 'conferencialuxo_12' },
  ])
  assert.equal(linha.jaImportado, true)
  assert.equal(linha.vincula, false, 'já está ligado — não há o que vincular')
})

test('projeto cadastrado à mão antes da ponte é reconhecido pelo par feira + stand', () => {
  // Este é o caso que causaria a duplicata: o stand existe aqui, mas sem o id
  // da produção, então a comparação por id não o encontraria.
  const c = normalizarDaProducao(daProducao())
  const [linha] = cruzarComExistentes([c], [
    { token: 'tok1', feira: 'CONFERENCIA LUXO - ECBR', stand: 'a12', producaoId: '' },
  ])
  assert.equal(linha.jaImportado, true, 'acento, caixa e pontuação não podem separar o mesmo stand')
  assert.equal(linha.vincula, true, 'e vale oferecer a ligação, que é o que o app vai usar')
  assert.equal(linha.existente.token, 'tok1')
})

test('stand que ainda não existe aqui fica disponível para importar', () => {
  const c = normalizarDaProducao(daProducao())
  const [linha] = cruzarComExistentes([c], [
    { token: 'outro', feira: 'Outra Feira', stand: 'A12', producaoId: '' },
  ])
  assert.equal(linha.jaImportado, false, 'mesmo stand em OUTRA feira é outro stand')
  assert.equal(linha.existente, null)
})

test('as feiras saem com a contagem de expositores', () => {
  const clientes = [
    normalizarDaProducao(daProducao()),
    normalizarDaProducao(daProducao({ producaoId: 'b', nome: 'Appmax', local: 'A13' })),
    normalizarDaProducao(daProducao({ producaoId: 'c', fairName: 'Outra', nome: 'Wake' })),
  ]
  const feiras = feirasDaProducao(clientes)
  assert.equal(feiras.length, 2)
  assert.equal(feiras.find((f) => f.nome === 'Conferencia Luxo - ECBR').total, 2)
  assert.equal(feiras.find((f) => f.nome === 'Outra').total, 1)
})

test('o e-mail é a única pendência que bloqueia — peça não é', () => {
  const c = normalizarDaProducao(daProducao())
  assert.deepEqual(pendenciasDe(c, 'contato@cliente.com'), [])
  assert.deepEqual(pendenciasDe(c, ''), ['e-mail'])
  assert.deepEqual(pendenciasDe(c, 'não é e-mail'), ['e-mail'])
  // As peças não entram: elas são o trabalho do analista DEPOIS de importar.
  assert.equal(pendenciasDe(c, 'x@y.com').includes('peças'), false)
})

test('o elo com a produção sobrevive à gravação', () => {
  // `normalizarProjeto` é uma lista BRANCA: campo que não está nela é
  // descartado em silêncio na hora de gravar. Sem este teste, a importação
  // gravaria projetos sem `producaoId` e nada na tela denunciaria — o app
  // simplesmente nunca encontraria a prova nem o status.
  const p = projetoNovo({
    feira: 'Conferencia Luxo - ECBR',
    expositor: 'After Click',
    stand: 'A12',
    email: 'contato@cliente.com',
    producaoId: 'conferencialuxo_12',
    producaoFeira: 'Conferencia Luxo - ECBR',
  })
  assert.equal(p.producaoId, 'conferencialuxo_12')

  const gravado = normalizarProjeto(p)
  assert.equal(gravado.producaoId, 'conferencialuxo_12', 'o elo não pode se perder na gravação')
  assert.equal(gravado.producaoFeira, 'Conferencia Luxo - ECBR')
})

test('projeto sem elo com a produção continua válido', () => {
  const gravado = normalizarProjeto(projetoNovo({ feira: 'F', expositor: 'E', stand: 'S' }))
  assert.equal(gravado.producaoId, '', 'cadastro manual não ganha id de mentira')
})

// ------------------------------- o que o app de produção vê de cada stand

import { estadoDaArte, provaVigente, statusParaProducao, ESTADOS_ARTE } from '../src/core/producao.js'
import { resumoDoProjeto } from '../src/core/fluxo.js'

const lona = { id: 'p1', rotulo: 'Lona', larguraCm: 275, alturaCm: 275 }
const test2 = { id: 'p2', rotulo: 'Testeira', larguraCm: 150, alturaCm: 50 }
const entregue = (em = '2026-08-01T10:00:00Z') => ({ protocolo: 'AP', versao: 1, em })

const estado = (extra) => estadoDaArte(resumoDoProjeto({
  token: 't', producaoId: 'x', pecas: [lona, test2], ...extra,
}))

test('uma peça esperando o cliente segura o stand inteiro', () => {
  // A regra que o produtor precisa: quatro impressas e uma sem arte NÃO é 80%
  // pronto, é esperando o cliente. É a diferença entre ele contar com a arte
  // no dia da montagem e descobrir na hora que ela não existe.
  assert.equal(estado({
    entregas: { p1: entregue() },
    controle: { pecas: { p1: { status: 'impressa' } } },
  }), 'aguardando', 'a testeira nunca chegou')
})

test('arte recebida sem prova é bola com a CV, não com o cliente', () => {
  // Chamar isto de "aguardando cliente" faria a produção cobrar quem já
  // entregou — e ninguém cobraria a gente, que é quem está devendo a prova.
  assert.equal(estado({ entregas: { p1: entregue(), p2: entregue() } }), 'em_analise')
})

test('tudo aprovado, nada na impressora ainda', () => {
  const prova = { pr1: { pecaIds: ['p1', 'p2'], versoes: { p1: 1, p2: 1 }, enviadaEm: '2026-08-02T10:00:00Z' } }
  assert.equal(estado({
    entregas: { p1: entregue(), p2: entregue() },
    controle: { provas: prova },
    respostasProva: { pr1: { decisao: 'aprovada', em: '2026-08-03T10:00:00Z' } },
  }), 'aprovada')
})

test('em impressão só quando nada mais está atrás', () => {
  const base = {
    entregas: { p1: entregue(), p2: entregue() },
    controle: { provas: { pr1: { pecaIds: ['p1', 'p2'], versoes: { p1: 1, p2: 1 }, enviadaEm: '2026-08-02T10:00:00Z' } } },
    respostasProva: { pr1: { decisao: 'aprovada', em: '2026-08-03T10:00:00Z' } },
  }
  assert.equal(estado({
    ...base,
    controle: { ...base.controle, pecas: { p1: { status: 'em_impressao' } } },
  }), 'aprovada', 'a outra peça ainda está só aprovada — o estado mais atrasado vence')

  assert.equal(estado({
    ...base,
    controle: { ...base.controle, pecas: { p1: { status: 'em_impressao' }, p2: { status: 'em_impressao' } } },
  }), 'em_impressao')

  assert.equal(estado({
    ...base,
    controle: { ...base.controle, pecas: { p1: { status: 'impressa' }, p2: { status: 'impressa' } } },
  }), 'impressa')
})

test('stand importado e ainda sem peças não mente "aguardando cliente"', () => {
  // Importado da produção, o projeto nasce sem peça. Dizer "aguardando
  // cliente" acusaria o cliente de um atraso que é nosso: ninguém pediu arte
  // nenhuma a ele ainda.
  assert.equal(estadoDaArte(resumoDoProjeto({ token: 't', pecas: [] })), 'sem_pecas')
  assert.equal(estadoDaArte(null), 'sem_pecas')
})

test('todo estado tem rótulo — o app não inventa texto', () => {
  for (const id of Object.keys(ESTADOS_ARTE)) {
    assert.ok(ESTADOS_ARTE[id].rotulo?.length > 3, id)
    assert.ok(ESTADOS_ARTE[id].cor?.length > 2, id)
  }
})

test('a prova que vale é a mais recente com arquivo', () => {
  assert.equal(provaVigente([]), null)
  assert.equal(provaVigente([{ id: 'a', enviadaEm: '2026-08-05T10:00:00Z' }]), null, 'prova sem arquivo não serve de link')
  const p = provaVigente([
    { id: 'nova', enviadaEm: '2026-08-06T10:00:00Z', arquivo: { link: 'https://x/nova.png' } },
    { id: 'velha', enviadaEm: '2026-08-01T10:00:00Z', arquivo: { link: 'https://x/velha.png' } },
  ])
  assert.equal(p.link, 'https://x/nova.png')
})

test('o documento publicado leva o que o app precisa e nada de token do cliente', () => {
  const projeto = {
    token: 'abc123', producaoId: 'feira_12', producaoFeira: 'Conferencia Luxo - ECBR',
    pecas: [lona, test2], entregas: { p1: entregue() },
  }
  const doc = statusParaProducao(projeto, resumoDoProjeto(projeto), [])
  assert.equal(doc.producaoId, 'feira_12')
  assert.equal(doc.fairName, 'Conferencia Luxo - ECBR', 'a feira é a DA PRODUÇÃO, que é como o app consulta')
  assert.equal(doc.estado, 'aguardando')
  assert.equal(doc.rotulo, 'Aguardando cliente')
  assert.equal(doc.total, 2)
  assert.equal(doc.recebidas, 1)
  assert.equal(doc.linkProva, '')
})

// ------------------------------------------------ o elo que troca os clientes
//
// O `producaoId` é a única ponte entre as duas bases, e ela é 1 para 1: o app
// guarda UM documento por expositor. Um elo errado não dá erro em lugar nenhum
// daqui — o estrago aparece no app de montagem, como o print de um cliente na
// ficha de outro, enquanto nesta ferramenta os dois continuam certos. Foi
// exatamente esse o defeito relatado, e são estes os dois pontos onde ele
// nasce.

const projetoDe = (extra = {}) => ({ token: 't1', feira: 'Expo Sul', stand: 'A12', producaoId: '', ...extra })

test('stand em branco não casa com ninguém', () => {
  // Vários expositores da mesma feira ficariam sob a chave "feira|", e o
  // primeiro projeto sem nome de stand viraria o "existente" de todos eles —
  // um convite a vincular o cliente errado.
  const projetos = [projetoDe({ token: 'sem_nome', stand: '' })]
  const [linha] = cruzarComExistentes([
    { producaoId: 'p1', feira: 'Expo Sul', stand: '' },
  ], projetos)
  assert.equal(linha.existente, null)
  assert.equal(linha.jaImportado, false)
})

test('nome de stand repetido não escolhe um pelo acaso da ordem', () => {
  // Dois projetos com o mesmo nome de stand na mesma feira: nenhum dos dois é
  // "o" correspondente. Escolher um seria criar o elo errado em silêncio.
  const projetos = [
    projetoDe({ token: 'a', stand: 'A12' }),
    projetoDe({ token: 'b', stand: 'A12' }),
  ]
  const [linha] = cruzarComExistentes([{ producaoId: 'p1', feira: 'Expo Sul', stand: 'A12' }], projetos)
  assert.equal(linha.existente, null, 'na dúvida, deixa a pessoa decidir')
})

test('o casamento por id continua vencendo o nome', () => {
  const projetos = [
    projetoDe({ token: 'certo', stand: 'B03', producaoId: 'p1' }),
    projetoDe({ token: 'homonimo', stand: 'A12' }),
  ]
  const [linha] = cruzarComExistentes([{ producaoId: 'p1', feira: 'Expo Sul', stand: 'A12' }], projetos)
  assert.equal(linha.existente.token, 'certo')
})

test('nome único e sem id continua casando — é o que "vincular" serve', () => {
  const projetos = [projetoDe({ token: 'antigo', stand: 'A12' })]
  const [linha] = cruzarComExistentes([{ producaoId: 'p1', feira: 'Expo Sul', stand: 'A12' }], projetos)
  assert.equal(linha.existente.token, 'antigo')
  assert.equal(linha.vincula, true)
})

test('encontra dois projetos disputando o mesmo expositor do app', () => {
  const conflitos = elosDuplicados([
    projetoDe({ token: 'selia', stand: 'Selia', producaoId: 'x9' }),
    projetoDe({ token: 'jadlog', stand: 'JadLog', producaoId: 'x9' }),
    projetoDe({ token: 'outro', stand: 'Outro', producaoId: 'z1' }),
    projetoDe({ token: 'solto', stand: 'Solto', producaoId: '' }),
  ])
  assert.equal(conflitos.length, 1)
  assert.equal(conflitos[0].producaoId, 'x9')
  assert.deepEqual(conflitos[0].projetos.map((p) => p.token), ['selia', 'jadlog'])
})

test('projeto sem elo nunca conta como conflito', () => {
  // Vários projetos sem `producaoId` são o normal — cadastro à mão. Contá-los
  // encheria a tela de um alarme falso e o aviso deixaria de ser lido.
  assert.deepEqual(elosDuplicados([
    projetoDe({ token: 'a', producaoId: '' }),
    projetoDe({ token: 'b', producaoId: '' }),
  ]), [])
})

// --------------------------------------------- a chave frágil do outro lado
//
// A causa do defeito relatado não era duplicação: é que o id do expositor no
// app é `nomeDaFeira_númeroDaLinha` — a POSIÇÃO na planilha, não uma identidade.
// Reordenar a planilha reescreve o id de todo mundo abaixo, e cada cliente
// herda o id que era do vizinho. `cv_status/feira_12` foi escrito quando a
// linha 12 era a JadLog; hoje a linha 12 é a Selia, e o app lê aquele
// documento para ela.
//
// Nenhum dos dois lados parece errado sozinho — o que se perdeu é a
// correspondência. Só uma conferência explícita acha isso.

test('elo que virou outro cliente é recusado', () => {
  const v = eloConfere(
    { expositor: 'Selia', stand: 'B14' },
    { nome: 'JadLog', local: 'A02' },
  )
  assert.equal(v.confere, false)
  assert.equal(v.motivo, 'trocado')
  assert.match(v.esperado, /Selia/)
  assert.match(v.encontrado, /JadLog/)
})

test('expositor que sumiu do app não publica nada', () => {
  assert.deepEqual(eloConfere({ expositor: 'Selia', stand: 'B14' }, null), { confere: false, motivo: 'sumiu' })
})

test('basta o nome OU o stand baterem', () => {
  // Frouxo de propósito: nome de empresa muda na planilha e stand é renumerado
  // sem que a correspondência tenha se perdido. Exigir os dois transformaria
  // toda correção de digitação num alarme — e alarme falso se aprende a ignorar.
  assert.equal(eloConfere({ expositor: 'Selia', stand: 'B14' }, { nome: 'Selia Cosméticos', local: 'B14' }).confere, true)
  assert.equal(eloConfere({ expositor: 'Selia', stand: 'C01' }, { nome: 'Selia', local: 'B14' }).confere, true)
})

test('acento e caixa não separam o mesmo cliente', () => {
  assert.equal(eloConfere({ expositor: 'INFRACOMMERCE', stand: 'a12' }, { nome: 'Infracommerce', local: 'A-12' }).confere, true)
})

test('sem referência de um dos lados, não acusa', () => {
  // Barrar por falta de dado calaria stands que estão perfeitos — e o silêncio
  // aqui custa o print que o montador precisa ver.
  assert.equal(eloConfere({ expositor: '', stand: '' }, { nome: 'JadLog', local: 'A02' }).confere, true)
  assert.equal(eloConfere({ expositor: 'Selia', stand: 'B14' }, { nome: '', local: '' }).confere, true)
})

test('o app usa `nome`/`local`; o espelho usa `expositor`/`stand`', () => {
  // Os dois vocabulários chegam aqui, e trocar um pelo outro faria a
  // conferência acusar todo mundo.
  assert.equal(eloConfere({ expositor: 'Selia', stand: 'B14' }, { expositor: 'Selia', stand: 'B14' }).confere, true)
})

// ------------------------------------------------ o caminho de conserto
//
// Sem isto o analista fica sem saída: a tela casa por `producaoId` ANTES do
// nome, então um projeto com elo trocado aparece como "já importado" na linha
// do cliente errado, e o botão de vincular — que só nasce quando não há elo —
// nunca aparece. O conserto ficava no console do Firebase.

const noApp = (extra = {}) => ({ producaoId: 'f_13', feira: 'Expo', expositor: 'JadLog', stand: '', ...extra })

test('acha o elo trocado e sugere o cliente certo pelo nome', () => {
  // O caso real: a planilha perdeu duas linhas e todo mundo subiu duas
  // posições. O projeto da Selia continua apontando para o id que hoje é da
  // Tray.
  const projetos = [{ token: 'selia', expositor: 'Selia', stand: 'Selia', producaoId: 'f_17' }]
  const clientes = [noApp({ producaoId: 'f_17', expositor: 'Tray' }), noApp({ producaoId: 'f_15', expositor: 'Selia' })]

  const [fora] = elosDesalinhados(projetos, clientes)
  assert.equal(fora.projeto.token, 'selia')
  assert.equal(fora.atual.expositor, 'Tray')
  assert.equal(fora.sugestao.producaoId, 'f_15', 'o id que hoje é da Selia')
})

test('elo certo não aparece na lista de conserto', () => {
  const projetos = [{ token: 'a', expositor: 'Selia', stand: '', producaoId: 'f_15' }]
  assert.deepEqual(elosDesalinhados(projetos, [noApp({ producaoId: 'f_15', expositor: 'Selia' })]), [])
})

test('não sugere um elo que outro projeto já usa', () => {
  // Seria trocar o desalinhamento por um conflito: dois projetos escrevendo no
  // mesmo documento, que é o defeito vizinho.
  const projetos = [
    { token: 'selia', expositor: 'Selia', stand: '', producaoId: 'f_17' },
    { token: 'outro', expositor: 'Outro', stand: '', producaoId: 'f_15' },
  ]
  const clientes = [noApp({ producaoId: 'f_17', expositor: 'Tray' }), noApp({ producaoId: 'f_15', expositor: 'Selia' })]
  const [fora] = elosDesalinhados(projetos, clientes)
  assert.equal(fora.sugestao, null, 'sem sugestão; a pessoa desfaz e decide')
})

test('nome repetido no app não vira sugestão', () => {
  const projetos = [{ token: 'x', expositor: 'Selia', stand: '', producaoId: 'f_99' }]
  const clientes = [
    noApp({ producaoId: 'f_99', expositor: 'Tray' }),
    noApp({ producaoId: 'f_15', expositor: 'Selia' }),
    noApp({ producaoId: 'f_16', expositor: 'Selia' }),
  ]
  assert.equal(elosDesalinhados(projetos, clientes)[0].sugestao, null)
})

test('expositor que sumiu do app entra com motivo próprio', () => {
  const projetos = [{ token: 'x', expositor: 'Selia', stand: '', producaoId: 'f_404' }]
  const [fora] = elosDesalinhados(projetos, [noApp({ producaoId: 'f_15', expositor: 'Selia' })])
  assert.equal(fora.motivo, 'sumiu')
  assert.equal(fora.sugestao.producaoId, 'f_15')
})

test('projeto sem elo não é problema de elo', () => {
  assert.deepEqual(elosDesalinhados([{ token: 'x', expositor: 'Selia', producaoId: '' }], []), [])
})
