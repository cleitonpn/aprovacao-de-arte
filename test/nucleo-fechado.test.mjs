import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/*
  `src/core/` não pode importar de fora de `src/core/`.

  Não é preferência de arquitetura: é o que o deploy das funções exige. O
  `firebase.json` roda `copiar-nucleo.mjs` antes de publicar, e ele copia
  APENAS `src/core/` para dentro de `functions/nucleo/`. Um arquivo do núcleo
  que importe `../data/projeto.js` funciona perfeitamente no site e quebra na
  função — no import, em produção, com a função inteira fora do ar.

  O gatilho que publica o status da arte no app de montagem depende de
  `nucleo/fluxo.js` e `nucleo/producao.js`. Se alguém acrescentar a esses dois
  um import para fora do núcleo, o app de montagem para de receber status e o
  erro aparece longe daqui.
*/

const raizCore = new URL('../src/core/', import.meta.url).pathname

/*
  A exceção conhecida, nomeada uma a uma para continuar sendo exceção.

  `importacao.js` importa de `data/projeto.js` e é anterior a esta regra. Ele
  NÃO é carregado por nenhuma função hoje — só pela tela de importar planilha —,
  então a cópia quebrada nunca chega a ser lida. É dívida, não defeito, e está
  aqui para não ser esquecida: no dia em que alguma função precisar dele, este
  comentário é o aviso de que ele tem de ser arrumado antes.
*/
const DIVIDA_CONHECIDA = new Set(['importacao.js'])

function arquivosDoCore(dir = raizCore, prefixo = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory()
      ? arquivosDoCore(join(dir, e.name), `${prefixo}${e.name}/`)
      : (e.name.endsWith('.js') ? [`${prefixo}${e.name}`] : [])
  ))
}

test('nenhum arquivo do núcleo importa de fora do núcleo', () => {
  const infratores = []
  for (const nome of arquivosDoCore()) {
    if (DIVIDA_CONHECIDA.has(nome)) continue
    const codigo = readFileSync(join(raizCore, nome), 'utf8')
    // `from '../qualquer-coisa'` — sai do núcleo. `./` fica dentro.
    for (const [, alvo] of codigo.matchAll(/from\s+['"](\.\.\/[^'"]+)['"]/g)) {
      infratores.push(`${nome} → ${alvo}`)
    }
  }
  assert.deepEqual(
    infratores, [],
    'o núcleo é copiado sozinho para as funções; estes imports quebram no deploy:\n'
    + infratores.join('\n'),
  )
})

test('a dívida conhecida ainda existe — senão sai da lista', () => {
  // Uma exceção que sobrevive ao arquivo que a motivou vira permissão silenciosa.
  for (const nome of DIVIDA_CONHECIDA) {
    const codigo = readFileSync(join(raizCore, nome), 'utf8')
    assert.match(
      codigo, /from\s+['"]\.\.\//,
      `${nome} não importa mais de fora do núcleo — tire-o de DIVIDA_CONHECIDA`,
    )
  }
})

test('os dois módulos de que o gatilho depende estão limpos', () => {
  // O teste acima já cobre, mas nomear estes dois deixa explícito o que quebra
  // se a regra for afrouxada: o status da arte no app de montagem.
  for (const nome of ['fluxo.js', 'producao.js']) {
    const codigo = readFileSync(join(raizCore, nome), 'utf8')
    assert.doesNotMatch(codigo, /from\s+['"]\.\.\//, `${nome} sai do núcleo`)
  }
})
