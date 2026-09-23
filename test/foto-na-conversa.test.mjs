import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/*
  Foto na conversa.

  O grosso do que pode dar errado aqui não está em função nenhuma: está nas
  REGRAS, que rodam no servidor do Google e que nenhum teste de unidade alcança.
  Por isso estes testes leem os arquivos de regra. Não substituem o emulador —
  substituem o esquecimento, que é o modo de falha real: alguém mexe numa regra
  meses depois e a proteção some sem que nada na tela mude.
*/

const regra = (arquivo) => readFileSync(new URL(`../${arquivo}`, import.meta.url), 'utf8')

test('a conversa NÃO aceita PDF — ela não pode virar entrega de arte', () => {
  /*
    A decisão que mais importa neste recurso. Aceitando PDF, o cliente mandaria
    a arte pela conversa, daria por entregue, e ela teria escapado da análise,
    do gabarito, da prova e do registro de envio — que é a ferramenta inteira.
    Foto de arte é obviamente uma foto; PDF de arte parece uma entrega.
  */
  const storage = regra('storage.rules')
  const bloco = storage.slice(storage.indexOf('match /conversa/'))
  const ate = bloco.slice(0, bloco.indexOf('match /', 10))

  assert.match(ate, /image\/jpeg\|image\/png\|image\/webp/, 'a pasta da conversa aceita imagem')
  assert.doesNotMatch(ate, /application\/pdf/, 'PDF na conversa abriria um caminho paralelo de entrega')
  assert.doesNotMatch(ate, /application\/zip|postscript/, 'nem arquivo de editor')
})

test('a foto da conversa não sobrescreve outra e tem teto de tamanho', () => {
  const storage = regra('storage.rules')
  const bloco = storage.slice(storage.indexOf('match /conversa/'))
  const ate = bloco.slice(0, bloco.indexOf('match /', 10))

  assert.match(ate, /resource == null/, 'sem isto uma foto pode ser trocada depois de enviada')
  assert.match(ate, /request\.resource\.size > 0/)
  assert.match(ate, /15 \* 1024 \* 1024/, 'o teto precisa continuar existindo')
})

test('a mensagem aceita texto OU foto, e recusa as duas vazias', () => {
  // Antes bastava exigir texto não vazio. Com foto, a mensagem que é só imagem
  // passa a ser legítima — mas mensagem sem nada continua não sendo.
  const fs = regra('firestore.rules')
  const bloco = fs.slice(fs.indexOf('match /projetos/{token}/mensagens/'))
  const ate = bloco.slice(0, bloco.indexOf('match /', 10))

  assert.match(ate, /texto\.size\(\) > 0\s*\n\s*\|\|\s*\('imagem' in request\.resource\.data/)
  assert.match(ate, /texto\.size\(\) <= 2000/)
})

test('o link da foto tem que apontar para o NOSSO armazenamento', () => {
  /*
    Sem esta regra, `imagem.link` é um endereço livre que a tela do analista
    carregaria numa tag <img>: quem tivesse o link do stand poderia apontar
    para um servidor próprio e colher o IP e o navegador de quem abrisse a
    ficha — ou trocar a imagem depois de enviada, num registro que existe
    justamente por não poder ser alterado.
  */
  const fs = regra('firestore.rules')
  const bloco = fs.slice(fs.indexOf('match /projetos/{token}/mensagens/'))
  const ate = bloco.slice(0, bloco.indexOf('match /', 10))

  assert.match(ate, /imagem\.link\.matches\('https:\/\/firebasestorage/)
})

test('a mensagem continua sem poder ser editada nem apagada', () => {
  // A conversa vale como registro por causa desta linha. Acrescentar foto não
  // pode ter afrouxado nada aqui.
  const fs = regra('firestore.rules')
  const bloco = fs.slice(fs.indexOf('match /projetos/{token}/mensagens/'))
  const ate = bloco.slice(0, bloco.indexOf('match /', 10))

  assert.match(ate, /allow update, delete: if false/)
})

test('ninguém assina como o outro lado, com foto ou sem', () => {
  const fs = regra('firestore.rules')
  const bloco = fs.slice(fs.indexOf('match /projetos/{token}/mensagens/'))
  const ate = bloco.slice(0, bloco.indexOf('match /', 10))

  assert.match(ate, /autor == 'time' && ehAdmin\(\)/)
})

test('a tela recusa PDF antes de subir, com a mesma regra do servidor', () => {
  // A checagem do cliente não é a proteção — a proteção é a regra do Storage.
  // Ela existe para o erro aparecer ANTES do upload, com uma frase que diz o
  // que fazer, em vez de virar "unauthorized" depois de subir 12 MB.
  const envio = readFileSync(new URL('../src/services/envio.js', import.meta.url), 'utf8')
  const bloco = envio.slice(envio.indexOf('const TIPO_FOTO_POR_EXTENSAO'))

  assert.match(bloco, /jpg:|jpeg:|png:|webp:/)
  const mapa = bloco.slice(0, bloco.indexOf('}'))
  assert.doesNotMatch(mapa, /pdf/, 'a lista da tela tem de bater com a da regra')
  // E a mensagem de erro precisa dizer para onde ir, não só "não pode".
  assert.match(bloco, /botão de enviar da peça/)
})

test('a foto sobe no ENVIO, não na hora de escolher o arquivo', () => {
  // Subir ao escolher encheria o armazenamento com a foto de toda mensagem
  // que alguém começou e desistiu de mandar — e ninguém apaga aquilo depois.
  const tela = readFileSync(new URL('../src/components/Conversa.jsx', import.meta.url), 'utf8')
  const escolher = tela.slice(tela.indexOf('const escolherFoto'), tela.indexOf('const escolherFoto') + 500)
  assert.doesNotMatch(escolher, /enviarFotoDaConversa/, 'escolher não pode subir')

  const enviar = tela.slice(tela.indexOf('const enviar ='), tela.indexOf('const enviar =') + 900)
  assert.match(enviar, /enviarFotoDaConversa/, 'quem sobe é o envio')
})

test('a prévia é devolvida — object URL vaza se ninguém revogar', () => {
  // A conversa fica aberta o dia inteiro durante a montagem, trocando foto
  // atrás de foto. Cada prévia não revogada fica presa na memória da aba.
  const tela = readFileSync(new URL('../src/components/Conversa.jsx', import.meta.url), 'utf8')
  const criadas = [...tela.matchAll(/URL\.createObjectURL/g)].length
  const revogadas = [...tela.matchAll(/URL\.revokeObjectURL/g)].length
  assert.ok(criadas > 0, 'a prévia precisa existir')
  assert.ok(revogadas >= criadas, `${criadas} prévias criadas e só ${revogadas} devolvidas`)
})
