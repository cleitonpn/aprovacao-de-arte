import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/*
  O campo de texto perdia o foco a cada letra digitada.

  Quem relatou descreveu o que via: "para cada letra digitada sai do campo e
  tenho que clicar novamente dentro para digitar a próxima". O `<textarea>`
  estava certo. A causa estava no `Modal`, num efeito que não fala de
  digitação nenhuma — ele cuida de Esc, rolagem e foco ao abrir.

  A armadilha: o efeito dependia de `onFechar`. Quem abre a caixa escreve
  `onFechar={() => setAberto(false)}` no JSX, e isso é uma função NOVA a cada
  render. Então cada tecla fazia o React desmontar e remontar o efeito — e a
  limpeza do efeito devolve o foco para quem o tinha antes da caixa abrir.

  Dois detalhes que tornam isso caro de achar à mão:

  - o estado sobrevive (a letra aparece), então não parece remontagem;
  - o arquivo culpado não tem nenhuma relação aparente com o campo.

  Daí a regra desta casa: efeito que mexe em foco não depende de função vinda
  por prop. A função mora numa referência, e o efeito depende só do que
  realmente deveria reexecutá-lo — abrir e fechar.
*/

const COMPONENTES = new URL('../src/components/', import.meta.url)

const semComentarios = (fonte) => fonte
  .split('\n')
  .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
  .join('\n')

/** As dependências do efeito que contém `trecho`, como lista de nomes. */
function dependenciasDoEfeitoCom(fonte, trecho) {
  const inicio = fonte.indexOf(trecho)
  assert.notEqual(inicio, -1, `não achei "${trecho}" — o teste precisa ser atualizado`)
  const fecho = fonte.slice(inicio).match(/\}, \[([^\]]*)\]\)/)
  assert.ok(fecho, 'não achei a lista de dependências do efeito')
  return fecho[1].split(',').map((d) => d.trim()).filter(Boolean)
}

test('o efeito de foco do Modal depende só de `aberto`', () => {
  const fonte = semComentarios(readFileSync(new URL('Modal.jsx', COMPONENTES), 'utf8'))
  assert.deepEqual(
    dependenciasDoEfeitoCom(fonte, 'anterior.current = document.activeElement'),
    ['aberto'],
    'qualquer dependência além de `aberto` remonta o efeito a cada render de '
    + 'quem abre a caixa — e a limpeza tira o foco de quem está digitando',
  )
})

test('o Esc continua chamando o onFechar mais recente', () => {
  const fonte = semComentarios(readFileSync(new URL('Modal.jsx', COMPONENTES), 'utf8'))
  // Tirar `onFechar` das dependências sem passar pela referência congelaria a
  // função da primeira abertura: o Esc fecharia a caixa errada, ou nenhuma.
  assert.match(fonte, /fechar\.current = onFechar/)
  assert.match(fonte, /Escape'\s*\)\s*fechar\.current\?\.\(\)/)
})

test('nenhum componente devolve foco num efeito que depende de prop `on...`', () => {
  const culpados = []

  for (const nome of readdirSync(COMPONENTES).filter((n) => n.endsWith('.jsx'))) {
    const fonte = semComentarios(readFileSync(new URL(nome, COMPONENTES), 'utf8'))
    // Um efeito que devolve o foco na limpeza é exatamente o que estraga a
    // digitação quando reexecuta sem motivo.
    for (const efeito of fonte.split('useEffect(').slice(1)) {
      const corpo = efeito.slice(0, efeito.search(/\}, \[[^\]]*\]\)/) + 1)
      if (!/\.focus\?\.\(\)|\.focus\(\)/.test(corpo)) continue
      const deps = dependenciasDoEfeitoCom(efeito, corpo.slice(0, 40))
      const funcoes = deps.filter((d) => /^on[A-Z]/.test(d))
      if (funcoes.length) culpados.push(`${nome}: [${funcoes.join(', ')}]`)
    }
  }

  assert.deepEqual(culpados, [], 'efeito de foco dependendo de prop de callback '
    + '— guarde a função numa referência e tire-a das dependências')
})
