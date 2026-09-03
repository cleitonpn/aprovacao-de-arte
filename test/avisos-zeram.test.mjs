import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/*
  Toda bolinha precisa de quem a apague.

  O defeito que este arquivo existe para impedir não é de lógica — é de fiação,
  e por isso nenhum teste de função pura o pegaria. A aba "Artes recebidas" foi
  removida e levou junto a única linha que gravava `envios:{feira}`. O CONTADOR
  ficou, apenas mudou de aba. Resultado: uma bolinha que acende com a primeira
  arte e não apaga mais — nem recarregando, nem abrindo a ficha do cliente,
  porque a marca com que ela se compara nunca mais avançava. Ficou assim por
  dias, e quem reportou foi o usuário.

  A regra: se alguma tela LÊ `vistoEm(..., 'assunto:...')`, alguma tela tem que
  ESCREVER `marcarVisto(..., 'assunto:...')`. Um assunto só lido é um aviso
  eterno.
*/

const raiz = new URL('../src/', import.meta.url).pathname

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return arquivos(caminho)
    return /\.(js|jsx)$/.test(nome) ? [caminho] : []
  })
}

/**
 * As funções que MONTAM uma chave de aviso, e o assunto de cada uma.
 *
 * `chaveDaConversa(token)` devolve `conversa:${token}`, e uma chamada dessas
 * conta tanto quanto o literal escrito à mão — aliás conta mais, porque é a
 * forma certa. Sem resolvê-las, o teste acusaria "conversa" de órfã e a
 * primeira reação de quem visse isso seria afrouxar o teste.
 */
function ajudantesDeChave(codigo) {
  const mapa = new Map()
  for (const [, nome, prefixo] of codigo.matchAll(
    /(?:export\s+)?const\s+(chave[A-Za-z]*)\s*=\s*\([^)]*\)\s*=>\s*`([a-zA-Z]+):/g,
  )) mapa.set(nome, prefixo)
  return mapa
}

/** Os prefixos de assunto usados numa chamada — `vistoEm` ou `marcarVisto`. */
function assuntosDe(codigo, funcao, ajudantes) {
  const chamada = new RegExp(`${funcao}\\(([^;]{0,200}?)\\)`, 'gs')
  const assuntos = new Set()
  for (const [, args] of codigo.matchAll(chamada)) {
    for (const [, prefixo] of args.matchAll(/[`'"]([a-zA-Z]+):/g)) assuntos.add(prefixo)
    for (const [nome, prefixo] of ajudantes) {
      if (args.includes(`${nome}(`)) assuntos.add(prefixo)
    }
  }
  return assuntos
}

test('todo assunto de aviso que é lido também é marcado como visto', () => {
  const codigo = arquivos(raiz).map((f) => readFileSync(f, 'utf8')).join('\n')

  const ajudantes = ajudantesDeChave(codigo)
  assert.ok(ajudantes.size > 0, 'nenhuma função de chave encontrada — o resolvedor quebrou')

  const lidos = assuntosDe(codigo, 'vistoEm', ajudantes)
  const marcados = assuntosDe(codigo, 'marcarVisto', ajudantes)

  assert.ok(lidos.size >= 3, `esperava vários assuntos, achei ${[...lidos].join(', ')}`)

  const orfaos = [...lidos].filter((a) => !marcados.has(a))
  assert.deepEqual(
    orfaos, [],
    `assunto lido e nunca marcado — a bolinha de "${orfaos.join(', ')}" acende e não apaga nunca`,
  )
})
