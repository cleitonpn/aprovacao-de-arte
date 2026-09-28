import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/*
  Chave AUSENTE e chave valendo `null` não são a mesma coisa.

  Este arquivo existe porque a mesma confusão quebrou produção DUAS vezes em
  uma semana, nos dois casos por dias, e nos dois casos com um sintoma que não
  apontava para a causa:

  1. `imagem: null` em toda mensagem → `'imagem' in data` dava verdadeiro, a
     regra lia `.link` de null, e mensagem SÓ DE TEXTO parou de ser enviada.
  2. `contestacao: null` em todo envio → `'contestacao' in resource.data` dava
     verdadeiro, a regra lia `'decisao' in null`, e "Conferi este arquivo" e
     "Arquivar" pararam para TODOS os envios — sem nenhuma relação aparente
     com contestação.

  A origem dos dois é a mesma: `semIndefinidos` troca `undefined` por `null`
  em vez de tirar a chave (e tem que fazer isso — o Firestore recusa o
  documento inteiro ao encontrar um `undefined`). Então, no servidor, a chave
  quase sempre EXISTE; o que varia é o valor.

  Daí a regra desta casa: em `firestore.rules`, para saber se um campo tem
  conteúdo, usa-se `get(campo, null) == null`, nunca `'campo' in mapa`. Ler um
  campo de `null` é erro, e erro nega a escrita — silenciosamente, longe de
  onde alguém clicou.
*/

const regras = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

/** As linhas de código, sem os comentários — que citam o idioma proibido. */
const codigo = regras
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')

test('nenhuma regra usa `\'campo\' in mapa` para testar conteúdo', () => {
  const usos = [...codigo.matchAll(/'([a-zA-Z]+)' in /g)].map((m) => m[1])
  assert.deepEqual(
    usos, [],
    `use get('campo', null) no lugar de \`'campo' in\` — ${usos.join(', ')}. `
    + 'A chave quase sempre existe valendo null, e ler dentro dela nega a escrita.',
  )
})

test('as guardas de contestação toleram o campo valendo null', () => {
  // As duas que quebraram: a da criação e a que trava a decisão já tomada.
  assert.match(codigo, /d\.contestacao\.get\('decisao', null\) == null/)
  assert.match(codigo, /resource\.data\.get\('contestacao', null\) == null/)
  assert.match(codigo, /resource\.data\.contestacao\.get\('decisao', null\) == null/)
})

test('a guarda da foto na mensagem também tolera null', () => {
  assert.match(codigo, /request\.resource\.data\.get\('imagem', null\) == null/)
})

test('"Conferi este arquivo" continua alcançando o campo que ele escreve', () => {
  /*
    O botão grava só `conferencia`. Ele parou de funcionar não por causa da
    lista de campos alteráveis — `conferencia` sempre esteve nela — mas por
    causa de uma guarda VIZINHA que dava erro. Este teste guarda a lista; o de
    cima guarda a vizinhança.
  */
  const bloco = codigo.slice(codigo.indexOf('match /envios/{protocolo}'), codigo.indexOf('match /projetos/{token}'))
  const alteraveis = bloco.slice(bloco.indexOf('hasOnly(['), bloco.indexOf('])', bloco.indexOf('hasOnly([')))
  for (const campo of ['conferencia', 'arquivado', 'contestacao']) {
    assert.ok(alteraveis.includes(campo), `${campo} precisa continuar alterável`)
  }
})
