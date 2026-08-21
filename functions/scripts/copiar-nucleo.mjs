// Leva `src/core/` para dentro de `functions/` antes do deploy.
//
// O Firebase sobe só o que está na pasta da função, mas a regra de quem avisar
// tem que ser exatamente a mesma do site — a que diz se uma prova ainda espera
// resposta, se a devolução já foi atendida, quantos dias faltam do prazo.
//
// Manter uma segunda cópia escrita à mão seria repetir o defeito que já custou
// caro aqui: a conversão de data existia em cinco versões e uma delas não
// tratava número, o que virou "Invalid Date" na tela do cliente. Por isso a
// cópia é mecânica, roda no deploy e é descartável — `functions/nucleo/` está
// no .gitignore justamente para nunca virar um arquivo que alguém edita.

import { cp, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const origem = resolve(aqui, '../../src/core')
const destino = resolve(aqui, '../nucleo')

await rm(destino, { recursive: true, force: true })
await cp(origem, destino, { recursive: true })

console.log(`núcleo copiado: ${origem} -> ${destino}`)
