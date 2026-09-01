// O laudo do ponto de vista de quem NÃO é designer.
//
// O que forçou esta camada: na primeira feira inteira feita pela ferramenta,
// quem usou a tela foi o cliente leigo — não a agência dele. Ele leu "Arte
// reprovada", uma lista de oito itens em que o que impede de imprimir estava
// misturado com o que já estava certo, e não soube o que fazer. Tentou de novo
// dez vezes, com o mesmo arquivo, e ligou para o time.
//
// Nada aqui muda a análise: os achados são os mesmos, com os mesmos níveis.
// Muda a ORDEM em que eles são lidos — primeiro o que impede, depois o caminho
// para resolver, e só então o resto — e a primeira frase, que passa a dizer o
// que fazer em vez de emitir um julgamento.

import { NIVEL } from './regras.js'

/**
 * Separa os achados nos três grupos que a pessoa realmente distingue.
 *
 * A lista única, ordenada por gravidade, parecia resolver: o item que importa
 * fica no topo. Não resolve — porque ele fica no topo de mais sete, com o mesmo
 * tamanho, o mesmo peso e um ícone que só quem já conhece a legenda decifra.
 * Quem lê conta oito problemas onde existe um.
 */
export function agruparAchados(achados = []) {
  const ordenar = (lista) => [...lista].sort((a, b) => NIVEL[b.nivel] - NIVEL[a.nivel])
  return {
    impedem: ordenar(achados.filter((a) => a.nivel === 'bloqueante')),
    conferir: ordenar(achados.filter((a) => a.nivel === 'ressalva' || a.nivel === 'info')),
    certos: achados.filter((a) => a.nivel === 'ok'),
  }
}

const plural = (n, um, muitos) => (n === 1 ? um : muitos)

/**
 * A primeira frase da tela.
 *
 * Ela responde "e agora?", não "que nota eu tirei?". O rótulo formal
 * (`ROTULO_VEREDICTO`) continua existindo para o laudo impresso e para o
 * painel do time, onde a palavra técnica é a certa; aqui ela vira uma etiqueta
 * pequena ao lado, porque o cliente não precisa dela para agir.
 */
export function chamadaDoVeredicto(veredicto, quantidadeQueImpede = 0) {
  if (veredicto === 'aprovado') {
    return {
      titulo: 'Pode enviar esta arte',
      texto: 'A arte atende a tudo que esta peça exige. Nada precisa mudar — é só clicar em enviar.',
    }
  }
  if (veredicto === 'ressalva') {
    return {
      titulo: 'Dá para imprimir, mas com perda',
      texto: 'Nada aqui impede a impressão. Leia os pontos abaixo e decida: se você aceitar, a peça é produzida exatamente como está.',
    }
  }
  const n = Math.max(quantidadeQueImpede, 1)
  return {
    titulo: 'Esta arte ainda não pode ser impressa',
    texto: `${n} ${plural(n, 'coisa precisa', 'coisas precisam')} mudar no arquivo. `
      + `${plural(n, 'Ela está', 'Elas estão')} logo abaixo, com o texto pronto para mandar a quem montou a arte.`,
  }
}

/**
 * Uma tentativa reprovada não é um envio.
 *
 * O cliente das dez tentativas achava que estava mandando arte errada para o
 * time a cada clique. Não estava: arte reprovada nunca sobe (ver `Envio.jsx`).
 * Ele parou de tentar por medo de atrapalhar, que é o oposto do que a tela
 * deveria provocar.
 */
export const TENTAR_DE_NOVO_E_LIVRE =
  'Você pode testar quantos arquivos quiser: enquanto a arte não passa, nada é '
  + 'enviado para o time e nada disso conta como entrega.'
