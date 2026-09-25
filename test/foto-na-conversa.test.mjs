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

  // A checagem da foto é null-safe dos dois lados: a chave pode existir
  // valendo null nas mensagens gravadas antes da correção.
  assert.match(ate, /texto\.size\(\) > 0\s*\n\s*\|\|\s*\(request\.resource\.data\.get\('imagem', null\) != null/)
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

// ------------------------------ a forma do documento (o defeito que vazou)

import { corpoDaMensagem, mensagemTemConteudo } from '../src/core/conversa.js'
import { semIndefinidos } from '../src/core/mensagem.js'

test('mensagem SÓ DE TEXTO não grava a chave da foto', () => {
  /*
    O defeito que chegou a produção e quebrou o chat inteiro.

    A foto era montada como `undefined` quando não havia foto, e
    `semIndefinidos` — que existe para o Firestore não recusar o documento
    inteiro — troca `undefined` por `null` em vez de tirar a chave. Toda
    mensagem passou a gravar `imagem: null`; a regra via `'imagem' in data`
    como verdadeiro, tentava ler `.link` de null, e ler campo de null é erro —
    que no Firestore significa negar. Texto puro parou de enviar; com foto,
    funcionava.

    A asserção que importa é sobre o documento DEPOIS de `semIndefinidos`: é
    ele que vai para o servidor, e era exatamente ali que a chave reaparecia.
  */
  const doc = semIndefinidos(corpoDaMensagem({ autor: 'time', nome: 'Ana', texto: 'olá' }))
  assert.equal('imagem' in doc, false, 'a chave não pode existir valendo null')
  assert.equal(doc.texto, 'olá')
})

test('mensagem COM foto grava a chave completa', () => {
  const doc = semIndefinidos(corpoDaMensagem({
    autor: 'cliente',
    nome: 'Tamiris',
    texto: '',
    imagem: { link: 'https://firebasestorage.googleapis.com/x', caminho: 'conversa/t/a.jpg', nome: 'a.jpg', tipo: 'image/jpeg', tamanho: 10 },
  }))
  assert.equal(doc.imagem.link, 'https://firebasestorage.googleapis.com/x')
  assert.equal(doc.imagem.caminho, 'conversa/t/a.jpg')
})

test('foto sem link não vira chave — é o mesmo buraco por outro caminho', () => {
  // Um upload que falhou pela metade devolveria um objeto sem `link`. Gravá-lo
  // recriaria exatamente o `imagem` inútil que negava a escrita.
  const doc = semIndefinidos(corpoDaMensagem({ autor: 'time', texto: 'oi', imagem: { nome: 'x.jpg' } }))
  assert.equal('imagem' in doc, false)
})

test('a regra tolera `imagem` valendo null', () => {
  /*
    A tolerância fica mesmo depois de o código parar de gravar null: as
    mensagens já gravadas em produção estão assim, e uma regra que só funcione
    para documentos novos deixaria o histórico ilegível.
  */
  const fs = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  const bloco = fs.slice(fs.indexOf('match /projetos/{token}/mensagens/'))
  const ate = bloco.slice(0, bloco.indexOf('match /', 10))

  assert.match(ate, /get\('imagem', null\) == null/, 'o caminho sem foto precisa aceitar null')
  assert.doesNotMatch(
    ate, /!\('imagem' in request\.resource\.data\)/,
    '`in` não distingue chave ausente de chave valendo null — foi o que quebrou',
  )
})

test('ninguém consegue gravar mensagem vazia dos dois lados', () => {
  assert.equal(mensagemTemConteudo(corpoDaMensagem({ autor: 'time', texto: '   ' })), false)
  assert.equal(mensagemTemConteudo(corpoDaMensagem({ autor: 'time', texto: 'oi' })), true)
  assert.equal(
    mensagemTemConteudo(corpoDaMensagem({ autor: 'time', texto: '', imagem: { link: 'https://x' } })),
    true,
  )
})

test('o autor nunca vira um valor inventado', () => {
  // A regra confere `autor == 'cliente'` ou `'time' && ehAdmin()`. Um terceiro
  // valor seria negado pelo servidor; aqui ele nem chega a ser montado.
  assert.equal(corpoDaMensagem({ autor: 'admin', texto: 'x' }).autor, 'cliente')
  assert.equal(corpoDaMensagem({ autor: 'time', texto: 'x' }).autor, 'time')
})
