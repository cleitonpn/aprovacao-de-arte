// A leitura do que o Resend devolve sobre um e-mail já enviado.
//
// Duas partes, e as duas são puras de propósito — recebem texto e devolvem
// dados, sem rede, sem Firestore, sem relógio escondido. É o que permite testar
// a verificação de assinatura de verdade, com chave e envelope reais, em vez de
// confiar que está certa porque "não deu erro em produção".
//
// A verificação segue o padrão Svix, que é o que o Resend usa. Sem ela, o
// endereço seria uma porta aberta na internet para qualquer um marcar o e-mail
// de qualquer cliente como "voltou" — e o efeito prático seria a equipe ligando
// para gente que está tranquila, ou pior, parando de ligar para quem precisa.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Tolerância do carimbo de tempo. Cinco minutos é o padrão do Svix. */
export const JANELA_SEGUNDOS = 5 * 60

/**
 * A assinatura confere?
 *
 * O conteúdo assinado é `id.timestamp.corpo` — o corpo CRU, byte a byte, e não
 * o JSON reserializado: um espaço a mais na reserialização muda o resultado e
 * derruba todo evento legítimo.
 *
 * O cabeçalho pode trazer várias assinaturas separadas por espaço (é assim que
 * o Svix roda a troca de chave sem perder eventos). Basta uma bater.
 */
export function assinaturaConfere({ segredo, id, timestamp, corpo, assinatura, agora = Date.now() }) {
  if (!segredo || !id || !timestamp || !assinatura) return false

  // Sem a janela de tempo, um evento legítimo capturado hoje pode ser reenviado
  // daqui a um ano e continuar válido.
  const t = Number(timestamp)
  if (!Number.isFinite(t)) return false
  if (Math.abs(agora / 1000 - t) > JANELA_SEGUNDOS) return false

  // O segredo vem como `whsec_<base64>`; o que assina é o base64 decodificado.
  const bruto = String(segredo).startsWith('whsec_') ? String(segredo).slice(6) : String(segredo)
  let chave
  try {
    chave = Buffer.from(bruto, 'base64')
  } catch {
    return false
  }
  if (!chave.length) return false

  const esperada = createHmac('sha256', chave)
    .update(`${id}.${timestamp}.${corpo}`)
    .digest('base64')

  const esperadaBuf = Buffer.from(esperada)
  return String(assinatura)
    .split(' ')
    .map((p) => p.split(',').slice(1).join(','))
    .filter(Boolean)
    .some((candidata) => {
      const buf = Buffer.from(candidata)
      // Comparação de tempo constante: comprimento diferente já é `false`, e o
      // `timingSafeEqual` exige buffers do mesmo tamanho de qualquer forma.
      return buf.length === esperadaBuf.length && timingSafeEqual(buf, esperadaBuf)
    })
}

// Só três eventos mudam alguma coisa para o time. `sent` e `delivery_delayed`
// são ruído: o primeiro é o que acabamos de fazer, o segundo quase sempre se
// resolve sozinho e viraria alarme falso.
const ESTADOS = {
  'email.delivered': 'ok',
  'email.bounced': 'voltou',
  'email.complained': 'reclamou',
}

/**
 * O que este evento significa — ou `null` quando não significa nada.
 *
 * O motivo do retorno muda de formato entre versões da API do Resend (às vezes
 * `bounce.message`, às vezes uma string solta), então é lido com tolerância: um
 * motivo ausente não pode fazer o evento inteiro ser descartado, porque o que
 * importa é o estado, não a frase.
 */
export function lerEvento(corpo) {
  const dados = corpo?.data || {}
  const estado = ESTADOS[corpo?.type]
  if (!estado) return null

  const envioId = dados.email_id || dados.id || null
  if (!envioId) return null

  const motivo = dados.bounce?.message || dados.bounce?.reason || dados.reason
    || (typeof dados.bounce === 'string' ? dados.bounce : null)

  return {
    estado,
    envioId,
    para: Array.isArray(dados.to) ? dados.to : [dados.to].filter(Boolean),
    motivo: motivo ? String(motivo).slice(0, 400) : null,
    em: corpo?.created_at || dados.created_at || null,
  }
}
