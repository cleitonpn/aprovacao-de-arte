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

// Quem é quem no cadastro — e este trio já se confundiu uma vez.
//
// `expositor` é o campo "Cliente / expositor": a pessoa (ou a empresa) com quem
// se fala. `stand` é o nome do stand. `feira` é o evento. O assunto saía como
// "Suas artes do cleiton — Petvet", que junta o nome de quem recebe com o nome
// da feira e não diz o que o cliente precisa saber ao bater o olho na caixa de
// entrada: de qual stand e de qual feira se trata. Quem expõe em três feiras no
// mesmo mês recebia três e-mails de assunto quase idêntico.
//
// A convenção é a mesma da mensagem de cobrança que o time manda à mão: saudar
// pelo nome do cliente, identificar pelo stand e pela feira.
const nomeDoCliente = (p) => String(p?.expositor || '').trim()
const nomeDoStand = (p) => String(p?.stand || p?.expositor || '').trim() || 'seu stand'
const nomeDaFeira = (p) => String(p?.feira || '').trim()

/** "do stand Petvet Brasil para a feira Petvet 2026" — sem feira, só o stand. */
const ondeExpoe = (p, preposicao = 'do') =>
  `${preposicao} stand ${nomeDoStand(p)}${nomeDaFeira(p) ? ` para a feira ${nomeDaFeira(p)}` : ''}`

/** O que identifica o stand no fim do assunto: " — stand X, Feira Y". */
const etiqueta = (p) =>
  ` — stand ${nomeDoStand(p)}${nomeDaFeira(p) ? `, ${nomeDaFeira(p)}` : ''}`

/**
 * Até quando uma resposta do time ainda merece e-mail.
 *
 * Duas horas. É folgado para o atraso normal de um gatilho e curto o bastante
 * para que nenhuma conversa antiga vire aviso quando o documento do projeto
 * for reescrito por outro motivo.
 */
const JANELA_DA_RESPOSTA = 2 * 60 * 60 * 1000

/** Medida sem casa decimal inútil: 275 e não 275,0. */
const fmt = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/**
 * Tudo que este projeto precisa avisar AGORA.
 *
 * Cada aviso traz uma `chave` estável. É ela que impede o cliente de receber o
 * mesmo e-mail duas vezes: quem envia grava a chave antes de mandar, e uma
 * segunda passagem pelo mesmo estado não gera nada. Isso importa porque
 * gatilho de Firestore roda "pelo menos uma vez" — repetir é normal, e sem
 * chave o cliente receberia o aviso em duplicata.
 */
export function avisosPendentes(projeto, {
  agora = Date.now(), base = ENDERECO_PADRAO, dias = DIAS_DE_LEMBRETE, novo = false,
} = {}) {
  const para = destinatarios(projeto)
  if (!para.length || !projeto?.token) return []

  const resumo = resumoDoProjeto(projeto, agora)
  const link = linkDoStand(projeto.token, base)
  const cliente = nomeDoCliente(projeto)
  const fim = etiqueta(projeto)
  const avisos = []

  // ------------------------------------------------------------ boas-vindas
  //
  // O trabalho humano que isto substitui: hoje alguém do atendimento manda o
  // link a cada cadastro, escrevendo à mão quais peças aquele stand tem e até
  // quando. Numa feira de trezentos expositores isso é um dia de trabalho — e
  // é onde o link se perde, chega sem as medidas ou não chega.
  //
  // `novo` vem de quem chama, e só a criação do documento no gatilho do
  // Firestore o liga. Sem isso, publicar esta função mandaria "bem-vindo,
  // envie suas artes" para toda a base no primeiro dia — inclusive para quem
  // já está no meio do processo, ou já imprimiu.
  if (novo && resumo.total > 0) {
    const lista = projeto.pecas.map((p) => `• ${p.rotulo} — ${fmt(p.larguraCm)} × ${fmt(p.alturaCm)} cm`)
    const prazo = resumo.prazo
    const quando = prazo.temPrazo
      ? `O prazo para enviar vai até ${new Date(prazo.limite).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`
      : 'O prazo de envio será informado em breve.'

    avisos.push({
      chave: `boas_vindas:${projeto.token}`,
      tipo: 'boas_vindas',
      para,
      assunto: `Suas artes ${ondeExpoe(projeto)}`,
      ...corpo({
        saudacao: `Olá${cliente ? `, ${cliente}` : ''}! Você está cadastrado para enviar as artes ${ondeExpoe(projeto)}, e a página de envio já está no ar.`,
        paragrafos: [
          resumo.total === 1 ? 'É 1 peça:' : `São ${resumo.total} peças:`,
          ...lista,
          quando,
          'Cada peça já está na página com a medida certa e um gabarito para baixar — o seu designer não precisa perguntar tamanho a ninguém. A conferência é na hora, no seu próprio navegador: em segundos você sabe se o arquivo serve.',
          'Guarde este link. É por ele que você envia, acompanha e aprova a prova de impressão.',
        ],
        acao: 'Abrir a página das minhas artes',
        link,
      }),
    })
  }

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
      assunto: `Sua prova de impressão está pronta${fim}`,
      ...corpo({
        saudacao: `Olá${cliente ? `, ${cliente}` : ''}! A prova de impressão ${ondeExpoe(projeto)} está pronta.`,
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
      assunto: `Precisamos de um ajuste na arte: ${s.peca.rotulo}${fim}`,
      ...corpo({
        saudacao: `Olá${cliente ? `, ${cliente}` : ''}! O time de comunicação visual conferiu a arte da peça “${s.peca.rotulo}” ${ondeExpoe(projeto)} e precisa de um ajuste antes de imprimir.`,
        paragrafos: [
          `O motivo: “${s.devolucao.motivo}”`,
          `É só enviar a versão corrigida na mesma página — ela entra como versão ${s.proximaVersao}. Você não precisa pedir liberação, e o prazo não conta contra você nesta correção.`,
        ],
        acao: 'Enviar a arte corrigida',
        link,
      }),
    })
  }

  // -------------------------------------------------- resposta do time no chat
  //
  // Não existe notificação nativa numa página que o cliente abre de vez em
  // quando por um link — então a resposta do analista ficava esperando na tela
  // até alguém lembrar de voltar. Na prática o cliente perguntava e ia embora,
  // e a conversa morria por falta de aviso, exatamente como morria no WhatsApp
  // antes de ela existir.
  //
  // O gatilho já está de pé sem custo nenhum: `resumirConversa` espelha a
  // última mensagem no documento do projeto, e é essa gravação que acorda o
  // `onDocumentWritten`. Não é preciso escutar a subcoleção.
  //
  // A chave é a HORA da última mensagem, e é o que faz a dedução funcionar nos
  // dois sentidos: reprocessar o mesmo estado não manda de novo (a chave já
  // está gravada), e uma resposta nova depois disso tem hora diferente e
  // manda. O efeito colateral aceito é o analista que escreve três parágrafos
  // em três mensagens gerar até três avisos — preferível a agrupar por janela
  // de tempo e deixar a última resposta sem aviso nenhum.
  //
  // A janela existe por causa do primeiro dia no ar, e é o mesmo cuidado do
  // `novo` das boas-vindas: no momento em que isto for publicado, dezenas de
  // stands já têm `ultimoAutor: 'time'` de semanas atrás. A próxima gravação
  // de qualquer um deles — marcar uma peça como impressa serve — dispararia
  // "a equipe respondeu você" sobre uma conversa encerrada. Um aviso desses
  // não se desfaz, e quem o recebe volta à ferramenta procurar uma resposta
  // que não existe.
  const conversa = projeto.conversa
  const respondidaHa = conversa?.ultimaEm ? agora - Date.parse(conversa.ultimaEm) : Infinity
  if (conversa?.ultimoAutor === 'time' && conversa.ultimaEm && respondidaHa < JANELA_DA_RESPOSTA) {
    avisos.push({
      chave: `conversa:${conversa.ultimaEm}`,
      tipo: 'conversa',
      para,
      assunto: `A equipe respondeu você${fim}`,
      ...corpo({
        saudacao: `Olá${cliente ? `, ${cliente}` : ''}! Nossa equipe respondeu a sua mensagem sobre as artes ${ondeExpoe(projeto)}.`,
        paragrafos: [
          // Sem o texto da resposta, de propósito. A conversa é o registro da
          // peça e vive junto dela; copiada para o e-mail, ela vira uma thread
          // paralela em que alguém responde por engano — e a regra da casa é
          // que toda a tratativa acontece no sistema.
          'A resposta está na conversa da sua página, junto das artes do stand — é lá também que você responde, para tudo ficar registrado no mesmo lugar.',
        ],
        acao: 'Ler a resposta',
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
        ? `Amanhã é o último dia para enviar as artes${fim}`
        : `Faltam ${prazo.diasRestantes} dias para o fim do prazo de artes${fim}`,
      ...corpo({
        saudacao: `Olá${cliente ? `, ${cliente}` : ''}! O prazo de envio das artes ${ondeExpoe(projeto)} termina em ${dia}.`,
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
