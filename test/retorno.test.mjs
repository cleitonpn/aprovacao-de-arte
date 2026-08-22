import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { assinaturaConfere, lerEvento, JANELA_SEGUNDOS } from '../functions/src/retorno.js'

// Este endereço fica aberto na internet. Sem a verificação, qualquer pessoa
// marca o e-mail de qualquer cliente como "voltou" — e o estrago não é vazar
// dado, é a equipe ligando para quem está tranquilo e deixando de ligar para
// quem precisa. Daí testar a assinatura com chave e envelope reais.

const SEGREDO = `whsec_${Buffer.from('um-segredo-de-teste-com-tamanho').toString('base64')}`
const AGORA = Date.parse('2026-08-22T12:00:00Z')
const CORPO = JSON.stringify({ type: 'email.bounced', data: { email_id: 'e_1' } })

function assinar(corpo, { id = 'msg_1', timestamp = Math.floor(AGORA / 1000), segredo = SEGREDO } = {}) {
  const chave = Buffer.from(segredo.slice(6), 'base64')
  const sig = createHmac('sha256', chave).update(`${id}.${timestamp}.${corpo}`).digest('base64')
  return { id, timestamp: String(timestamp), assinatura: `v1,${sig}` }
}

const conferir = (extra = {}) => assinaturaConfere({
  segredo: SEGREDO, corpo: CORPO, agora: AGORA, ...assinar(CORPO), ...extra,
})

test('assinatura legítima passa', () => {
  assert.equal(conferir(), true)
})

test('corpo alterado depois de assinado não passa', () => {
  // O caso que interessa: alguém intercepta um evento verdadeiro e troca o
  // e-mail de destino.
  const outro = JSON.stringify({ type: 'email.bounced', data: { email_id: 'e_2' } })
  assert.equal(conferir({ corpo: outro }), false)
})

test('assinatura de outro segredo não passa', () => {
  const falso = `whsec_${Buffer.from('outro-segredo-qualquer-aqui').toString('base64')}`
  assert.equal(conferir({ ...assinar(CORPO, { segredo: falso }) }), false)
})

test('evento antigo não pode ser reenviado', () => {
  // Sem janela de tempo, um evento legítimo capturado hoje continua válido
  // daqui a um ano.
  const velho = Math.floor(AGORA / 1000) - JANELA_SEGUNDOS - 60
  assert.equal(conferir({ ...assinar(CORPO, { timestamp: velho }) }), false)
})

test('sem segredo configurado, nada passa', () => {
  // Falha fechada. Se o segredo não foi configurado ainda, é melhor perder
  // eventos do que aceitar qualquer um: dado inventado no painel é pior que
  // dado nenhum.
  assert.equal(conferir({ segredo: '' }), false)
  assert.equal(conferir({ segredo: 'whsec_' }), false)
})

test('cabeçalho com várias assinaturas: basta uma bater', () => {
  // É assim que a troca de chave do Svix acontece sem derrubar eventos.
  const boa = assinar(CORPO)
  assert.equal(conferir({ assinatura: `v1,lixo ${boa.assinatura}` }), true)
})

test('faltando qualquer parte do envelope, não passa', () => {
  assert.equal(conferir({ id: '' }), false)
  assert.equal(conferir({ timestamp: '' }), false)
  assert.equal(conferir({ assinatura: '' }), false)
  assert.equal(conferir({ timestamp: 'ontem' }), false)
})

// ------------------------------------------------------- leitura do evento

test('e-mail que voltou vira estado "voltou", com motivo e destinatário', () => {
  const e = lerEvento({
    type: 'email.bounced',
    created_at: '2026-08-22T11:59:00Z',
    data: { email_id: 'e_9', to: ['marketing@kemim.com'], bounce: { message: 'mailbox does not exist' } },
  })
  assert.equal(e.estado, 'voltou')
  assert.equal(e.envioId, 'e_9')
  assert.deepEqual(e.para, ['marketing@kemim.com'])
  assert.match(e.motivo, /mailbox does not exist/)
})

test('entregue e spam também são lidos', () => {
  assert.equal(lerEvento({ type: 'email.delivered', data: { email_id: 'e_1' } }).estado, 'ok')
  assert.equal(lerEvento({ type: 'email.complained', data: { email_id: 'e_1' } }).estado, 'reclamou')
})

test('eventos que não mudam nada são descartados', () => {
  // `sent` é o que acabamos de fazer; atraso quase sempre se resolve sozinho e
  // viraria alarme falso no painel.
  assert.equal(lerEvento({ type: 'email.sent', data: { email_id: 'e_1' } }), null)
  assert.equal(lerEvento({ type: 'email.delivery_delayed', data: { email_id: 'e_1' } }), null)
  assert.equal(lerEvento({ type: 'contact.created', data: {} }), null)
  assert.equal(lerEvento(null), null)
})

test('sem id de envio não há como saber de quem é o evento', () => {
  assert.equal(lerEvento({ type: 'email.bounced', data: { to: ['a@b.com'] } }), null)
})

test('motivo ausente não descarta o evento', () => {
  // O formato do motivo muda entre versões da API. O que importa é o estado —
  // perder o evento inteiro por causa da frase seria trocar o essencial pelo
  // acessório.
  const e = lerEvento({ type: 'email.bounced', data: { email_id: 'e_1', to: 'a@b.com' } })
  assert.equal(e.estado, 'voltou')
  assert.equal(e.motivo, null)
  assert.deepEqual(e.para, ['a@b.com'])
})
