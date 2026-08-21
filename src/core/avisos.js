// Quais e-mails o sistema deve mandar, e quando.
//
// A lacuna que isto fecha: a prova ficava esperando na tela e ninguém avisava.
// O time montava a prova, ela aparecia no link — e o cliente só descobria se
// resolvesse abrir o link por conta própria. Na prática quem descobria era o
// analista, ligando três dias depois.
//
// Duas escolhas que valem explicar:
//
// 1. Este arquivo NÃO manda e-mail. Ele decide o que precisa ser mandado, e
//    devolve isso como dados. Quem envia é a função na nuvem. Assim a regra —
//    a parte que erra em silêncio — roda nos testes daqui, sem rede e sem
//    Firebase, e o serviço de e-mail vira uma peça trocável.
//
// 2. Toda a leitura de estado vem de `fluxo.js`. Reimplementar "esta prova
//    está esperando resposta?" aqui seria a sexta cópia de uma regra que já
//    existe — e foi exatamente assim que a data do prazo virou "Invalid Date"
//    em cinco lugares diferentes.

import { resumoDoProjeto } from './fluxo.js'
import { SUPORTE } from './tutorial.js'

/** Quantos dias antes do prazo o cliente é lembrado. */
export const DIAS_DE_LEMBRETE = [7, 2]

const ENDERECO_PADRAO = 'https://sistemastands.com'

const escapar = (v) => String(v ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

/** O link do stand — é o que a pessoa precisa clicar, então nunca é opcional. */
export function linkDoStand(token, base = ENDERECO_PADRAO) {
  return `${String(base).replace(/\/+$/, '')}/#/p/${token}`
}

/**
 * Para quem vai o aviso.
 *
 * A lista inteira, não só o primeiro: decisão de arte raramente cai numa
 * pessoa só — tem o marketing, tem a agência, tem quem assina. Mandar para um
 * endereço só é quase o mesmo que não mandar.
 */
export function destinatarios(projeto) {
  const lista = projeto?.emails?.length ? projeto.emails : [projeto?.email]
  return [...new Set(lista.filter(Boolean).map((e) => String(e).trim().toLowerCase()))]
}

/**
 * Monta o corpo do e-mail nos dois formatos.
 *
 * Texto puro junto do HTML porque parte dos clientes corporativos bloqueia
 * HTML por política — e um e-mail que chega em branco é pior do que nenhum.
 */
function corpo({ saudacao, paragrafos, acao, link }) {
  const texto = [
    saudacao,
    '',
    ...paragrafos,
    '',
    `${acao}: ${link}`,
    '',
    `Dúvidas? Use a caixa "Dúvidas com o time" na própria página — a conversa fica registrada junto com as artes deste stand. Atendimento ${SUPORTE.texto}.`,
    'Este endereço não recebe respostas.',
  ].join('\n')

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:520px">
<p>${escapar(saudacao)}</p>
${paragrafos.map((p) => `<p>${escapar(p)}</p>`).join('\n')}
<p style="margin:24px 0">
<a href="${escapar(link)}" style="background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escapar(acao)}</a>
</p>
<p style="font-size:13px;color:#666">Se o botão não abrir, copie este endereço: <br>${escapar(link)}</p>
<p style="font-size:13px;color:#666">Dúvidas? Use a caixa “Dúvidas com o time” na própria página — a conversa fica registrada junto com as artes deste stand. Atendimento ${escapar(SUPORTE.texto)}.</p>
<p style="font-size:12px;color:#999">Este endereço não recebe respostas.</p>
</div>`

  return { texto, html }
}

const nomeDoStand = (p) => p?.expositor || p?.stand || 'seu stand'

/**
 * Tudo que este projeto precisa avisar AGORA.
 *
 * Cada aviso traz uma `chave` estável. É ela que impede o cliente de receber o
 * mesmo e-mail duas vezes: quem envia grava a chave antes de mandar, e uma
 * segunda passagem pelo mesmo estado não gera nada. Isso importa porque
 * gatilho de Firestore roda "pelo menos uma vez" — repetir é normal, e sem
 * chave o cliente receberia o aviso em duplicata.
 */
export function avisosPendentes(projeto, { agora = Date.now(), base = ENDERECO_PADRAO, dias = DIAS_DE_LEMBRETE } = {}) {
  const para = destinatarios(projeto)
  if (!para.length || !projeto?.token) return []

  const resumo = resumoDoProjeto(projeto, agora)
  const link = linkDoStand(projeto.token, base)
  const stand = nomeDoStand(projeto)
  const feira = projeto.feira ? ` — ${projeto.feira}` : ''
  const avisos = []

  // ------------------------------------------------------ prova esperando
  //
  // Uma prova por e-mail, não uma peça por e-mail: a prova é o mockup do stand
  // inteiro, e mandar seis e-mails para o mesmo aceite seria ruído.
  const porProva = new Map()
  for (const s of resumo.pecas) {
    if (s.status !== 'em_prova' || !s.provaAtual) continue
    const atual = porProva.get(s.provaAtual.id) || { prova: s.provaAtual, pecas: [] }
    atual.pecas.push(s.peca.rotulo)
    porProva.set(s.provaAtual.id, atual)
  }

  for (const [provaId, { pecas }] of porProva) {
    avisos.push({
      chave: `prova:${provaId}`,
      tipo: 'prova',
      para,
      assunto: `Sua prova de impressão está pronta${feira}`,
      ...corpo({
        saudacao: `Olá! A prova de impressão do ${stand} está pronta.`,
        paragrafos: [
          `Ela cobre ${pecas.length === 1 ? 'a peça' : 'as peças'}: ${pecas.join(', ')}.`,
          'Nada vai para a impressora sem o seu aceite — é o último momento de pedir ajuste sem custo de reimpressão. Você pode aprovar tudo, reprovar tudo ou aprovar em partes.',
        ],
        acao: 'Ver a prova e aprovar',
        link,
      }),
    })
  }

  // -------------------------------------------------------- arte devolvida
  for (const s of resumo.pecas) {
    if (s.status !== 'devolvida' || !s.devolucao) continue
    avisos.push({
      chave: `devolucao:${s.peca.id}:v${s.devolucao.paraVersao}`,
      tipo: 'devolucao',
      para,
      assunto: `Precisamos de um ajuste na arte: ${s.peca.rotulo}${feira}`,
      ...corpo({
        saudacao: `Olá! O time de comunicação visual conferiu a arte da peça “${s.peca.rotulo}” do ${stand} e precisa de um ajuste antes de imprimir.`,
        paragrafos: [
          `O motivo: “${s.devolucao.motivo}”`,
          `É só enviar a versão corrigida na mesma página — ela entra como versão ${s.proximaVersao}. Você não precisa pedir liberação, e o prazo não conta contra você nesta correção.`,
        ],
        acao: 'Enviar a arte corrigida',
        link,
      }),
    })
  }

  // ---------------------------------------------------------------- prazo
  //
  // Só faz sentido cobrar quem tem o que enviar. Lembrar do prazo quem já
  // mandou tudo é o tipo de e-mail que ensina o cliente a ignorar os nossos.
  const prazo = resumo.prazo
  const faltam = resumo.pendentes.length
  if (prazo.temPrazo && !prazo.vencido && faltam > 0 && dias.includes(prazo.diasRestantes)) {
    const dia = new Date(prazo.limite).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const quantas = faltam === 1 ? '1 peça' : `${faltam} peças`
    avisos.push({
      chave: `prazo:${dia}:${prazo.diasRestantes}`,
      tipo: 'prazo',
      para,
      assunto: prazo.diasRestantes === 1
        ? `Amanhã é o último dia para enviar as artes${feira}`
        : `Faltam ${prazo.diasRestantes} dias para o fim do prazo de artes${feira}`,
      ...corpo({
        saudacao: `Olá! O prazo de envio das artes do ${stand} termina em ${dia}.`,
        paragrafos: [
          `Ainda ${faltam === 1 ? 'falta' : 'faltam'} ${quantas} para chegar.`,
          'Cada peça já está na página com a medida certa e um gabarito para baixar — o designer não precisa perguntar tamanho a ninguém. A conferência é na hora, no seu próprio navegador.',
          'Artes enviadas depois do prazo podem ter taxa de urgência e acabamento comprometido. Se precisar de mais tempo, peça a liberação pela própria página.',
        ],
        acao: 'Enviar as artes que faltam',
        link,
      }),
    })
  }

  return avisos
}
