import test from 'node:test'
import assert from 'node:assert/strict'
import { tituloDoProjeto, localSemRepetirStand, projetoNovo, listaDeEmails } from '../src/data/projeto.js'
import { normalizarDaProducao, pendenciasDe } from '../src/core/producao.js'
import { listaDeEmails as listaDeEmailsDoNucleo } from '../src/core/emails.js'

// As duas identidades de um stand: a EMPRESA ("LW") e o CÓDIGO na planta
// ("A25"). Elas viviam trocadas na tela — o código em negrito, a empresa em
// cinza pequeno ao lado —, e o código ainda aparecia uma segunda vez dentro do
// endereço, porque a importação da produção gravava `local` em dois campos.

test('o título é a empresa; o código do stand fica de apoio', () => {
  const { titulo, apoio } = tituloDoProjeto({ expositor: 'LW', stand: 'A25' })
  assert.equal(titulo, 'LW')
  assert.equal(apoio, 'A25')
})

test('sem empresa, o código vira o título — e não se repete ao lado', () => {
  // Documento da produção sem `nome`, ou cadastro às pressas só com o stand.
  // Um título vazio é pior que um código; o que não pode é "A25 · A25".
  const { titulo, apoio } = tituloDoProjeto({ expositor: '  ', stand: 'A25' })
  assert.equal(titulo, 'A25')
  assert.equal(apoio, '')
})

test('sem nada, o título não fica vazio', () => {
  assert.equal(tituloDoProjeto({}).titulo, 'Sem nome')
  assert.equal(tituloDoProjeto().titulo, 'Sem nome')
})

test('o endereço não repete o código que já está ao lado', () => {
  // O valor gravado pelos projetos importados antes da correção.
  assert.equal(localSemRepetirStand('SP EXPO · A25', 'A25'), 'SP EXPO')
  // Digitado à mão, com o código no meio.
  assert.equal(localSemRepetirStand('Rua 3 · A25 · Pavilhão Azul', 'A25'), 'Rua 3 · Pavilhão Azul')
  // Sem repetição, nada muda.
  assert.equal(localSemRepetirStand('SP EXPO', 'A25'), 'SP EXPO')
})

test('o corte compara trecho inteiro, nunca pedaço de palavra', () => {
  // O caso que um `includes` estragaria: pavilhão "A25" e stand "A2". Cortar
  // por substring deixaria o endereço como "5", que não é lugar nenhum.
  assert.equal(localSemRepetirStand('A25', 'A2'), 'A25')
  // E o inverso: pavilhão "A" com stand "A" — aí SÃO iguais, e some mesmo.
  assert.equal(localSemRepetirStand('A', 'A'), '')
  // Diferença de caixa não impede o corte: o app da produção não padroniza.
  assert.equal(localSemRepetirStand('SP EXPO · a25', 'A25'), 'SP EXPO')
})

test('entradas vazias não inventam separador', () => {
  assert.equal(localSemRepetirStand('', 'A25'), '')
  assert.equal(localSemRepetirStand('SP EXPO', ''), 'SP EXPO')
  assert.equal(localSemRepetirStand(null, null), '')
})

test('a importação da produção não grava mais o código dentro do endereço', () => {
  // A causa raiz. `local` já vira `stand`; repeti-lo em `localizacao` é o que
  // fazia "A25" aparecer duas vezes na mesma linha da lista.
  const c = normalizarDaProducao({
    fairName: 'SP EXPO', nome: 'LW', local: 'A25', pavilhao: 'Pavilhão Azul',
  })
  assert.equal(c.stand, 'A25')
  assert.equal(c.expositor, 'LW')
  assert.equal(c.localizacao, 'Pavilhão Azul')
})

test('sem pavilhão, o endereço fica vazio em vez de virar o código do stand', () => {
  const c = normalizarDaProducao({ fairName: 'SP EXPO', nome: 'LW', local: 'A25' })
  assert.equal(c.localizacao, '')
})

// ------------------------------------------------- e-mails na importação

test('dois e-mails separados por vírgula NÃO são pendência', () => {
  /*
    O defeito relatado: o admin colava os dois contatos do expositor —
    marketing e agência, que é o normal — e a tela respondia "Falta: e-mail"
    em vermelho, com os dois endereços certos escritos na frente. O stand não
    podia ser importado.

    A causa era `pendenciasDe` testar a LINHA INTEIRA contra o padrão de um
    endereço só, usando uma cópia própria da expressão, enquanto o resto da
    ferramenta já aceitava lista desde sempre.
  */
  const stand = { stand: 'A25' }
  assert.deepEqual(
    pendenciasDe(stand, 'comercial@seliafullservice.com.br, leticia.baptistao@seliafullservice.com.br'),
    [],
  )
  // Os três separadores que a ferramenta aceita.
  assert.deepEqual(pendenciasDe(stand, 'a@x.com.br; b@y.com.br'), [])
  assert.deepEqual(pendenciasDe(stand, 'a@x.com.br b@y.com.br'), [])
})

test('um e-mail só continua valendo, e nenhum continua sendo pendência', () => {
  const stand = { stand: 'A25' }
  assert.deepEqual(pendenciasDe(stand, 'a@x.com.br'), [])
  assert.deepEqual(pendenciasDe(stand, ''), ['e-mail'])
  assert.deepEqual(pendenciasDe(stand, 'não é e-mail'), ['e-mail'])
  // Lixo junto de um endereço válido não salva o lixo, mas o válido basta.
  assert.deepEqual(pendenciasDe(stand, 'sem-arroba, a@x.com.br'), [])
})

test('a importação grava TODOS os e-mails colados, não só o primeiro', () => {
  // O campo é uma string só; quem separa é `projetoNovo`. Se isso quebrar, a
  // cobrança passa a sair só para o primeiro contato — silenciosamente.
  const p = projetoNovo({ email: 'a@x.com.br, b@y.com.br' })
  assert.deepEqual(p.emails, ['a@x.com.br', 'b@y.com.br'])
  assert.equal(p.email, 'a@x.com.br', 'o primeiro continua no campo singular')
})

test('a lista de e-mails é a mesma regra em todo lugar', () => {
  // Havia três cópias da expressão de e-mail — e uma delas divergiu, que é o
  // defeito acima. Este teste falha se `data/projeto.js` parar de apontar para
  // a mesma função que `core/producao.js` usa.
  assert.equal(listaDeEmails, listaDeEmailsDoNucleo)
})
