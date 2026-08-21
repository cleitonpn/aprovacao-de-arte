// O envio em si, isolado numa função só.
//
// Isolado de propósito: trocar de serviço de e-mail é uma decisão comercial
// que não deveria custar uma refatoração. Tudo que o resto do sistema sabe é
// que existe `enviarEmail`. Se um dia o Resend não servir, o que muda é este
// arquivo — nem a regra de quem avisar, nem o texto, nem os gatilhos.

const ENDERECO = 'https://api.resend.com/emails'

/**
 * Manda um e-mail. Devolve o id do envio, que é o que aparece nos Logs do
 * Resend — sem ele, investigar "o cliente diz que não recebeu" vira adivinhação.
 */
export async function enviarEmail({ chaveApi, de, para, assunto, texto, html }) {
  if (!chaveApi) throw new Error('RESEND_API_KEY não configurada.')
  if (!para?.length) throw new Error('Nenhum destinatário.')

  const resposta = await fetch(ENDERECO, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chaveApi}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: de,
      to: para,
      subject: assunto,
      text: texto,
      html,
    }),
  })

  const corpo = await resposta.text()
  if (!resposta.ok) {
    // O status importa para quem lê o log: 422 costuma ser domínio não
    // verificado, 403 é chave sem permissão, 429 é cota do dia estourada.
    throw new Error(`Resend respondeu ${resposta.status}: ${corpo}`)
  }

  try {
    return JSON.parse(corpo)?.id ?? null
  } catch {
    return null
  }
}
