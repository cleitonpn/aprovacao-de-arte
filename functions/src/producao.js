// Publicar o status da arte no app de montagem, na hora em que ele muda.
//
// A ponte já existia como varredura agendada no GitHub (`tools/
// sincronizar-producao.mjs`). O problema nunca foi o que ela faz, e sim quando:
// o cron do GitHub é "melhor esforço" e entra numa fila compartilhada. Medido
// num dia real, com `*/15` configurado, ela rodou às 01:36, 06:39 e 12:04 —
// cinco horas de intervalo. O analista aprova uma arte aqui e o produtor, no
// meio da montagem, continua vendo o status de antes do café da manhã.
//
// Este módulo é o mesmo trabalho disparado por evento. A varredura CONTINUA
// existindo e é bom que continue: ela é a rede que pega o que o gatilho perdeu
// (função que falhou, deploy no meio de uma escrita, documento mexido por fora)
// e é ela quem apaga do app o stand que foi apagado aqui.
//
// O que os dois compartilham, e por isso mora no núcleo: o cálculo do estado
// (`statusParaProducao`) e a ASSINATURA. Assinaturas diferentes fariam os dois
// publicadores regravarem para sempre o que o outro acabou de escrever.

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'

import { resumoDoProjeto, provasDoProjeto } from '../nucleo/fluxo.js'
import {
  statusParaProducao, eloConfere, normalizarDaProducao, assinaturaDoStatus,
} from '../nucleo/producao.js'

const COLECAO_ORIGEM = 'fair_clients'
const COLECAO_STATUS = 'cv_status'
const APP_PRODUCAO = 'producao'

/**
 * O Firestore do OUTRO projeto.
 *
 * Preguiçoso e guardado: uma instância por processo. `initializeApp` com o
 * mesmo nome duas vezes lança, e numa função que escala para vários containers
 * — cada um com várias invocações — chamar isso a cada evento seria criar e
 * descartar conexão o tempo todo.
 *
 * A credencial vem do Secret Manager, não do código. É a mesma conta de serviço
 * que a varredura já usa (`FIREBASE_SA_PRODUCAO`), com leitura em
 * `fair_clients` e escrita em `cv_status` — e só isso.
 */
function bancoDaProducao(credencialJson) {
  const existente = getApps().find((a) => a.name === APP_PRODUCAO)
  if (existente) return getFirestore(getApp(APP_PRODUCAO))

  let conta
  try {
    conta = JSON.parse(credencialJson)
  } catch {
    // Sem `throw` com o conteúdo junto: a mensagem de erro de uma função vai
    // para o log, e o log não é lugar de chave privada.
    throw new Error('A credencial da produção não é um JSON válido.')
  }
  return getFirestore(initializeApp({ credential: cert(conta) }, APP_PRODUCAO))
}

/**
 * Este elo é seguro de usar?
 *
 * A varredura faz estas duas conferências olhando a base inteira de uma vez. O
 * gatilho vê um documento só, então elas viram duas perguntas dirigidas — mas
 * elas PRECISAM continuar existindo, porque o que elas evitam é específico e
 * caro: o print de aprovação de um cliente aparecendo na ficha de outro no app
 * de montagem. Do lado de lá ninguém desconfia, porque a tela parece normal.
 *
 * 1. DOIS PROJETOS, UM EXPOSITOR. Quase sempre um "vincular" no stand errado.
 *    Os dois escreveriam no mesmo documento e venceria quem gravasse por
 *    último. Daqui não há como saber qual está certo, então não se publica
 *    nenhum — o app cai para o comportamento que tinha antes da ponte.
 *
 * 2. ELO DESALINHADO. O id do expositor no app é a POSIÇÃO dele na planilha;
 *    inserir uma linha reescreve o id de todo mundo abaixo, e cada cliente
 *    herda o id que era do vizinho. `eloConfere` compara nome e stand antes de
 *    deixar publicar.
 */
async function eloSeguro(bdArte, bdProducao, token, projeto) {
  const id = projeto.producaoId

  const mesmoElo = await bdArte.collection('projetos').where('producaoId', '==', id).get()
  const outros = mesmoElo.docs.filter((d) => d.id !== token)
  if (outros.length) {
    logger.error(
      `CONFLITO: ${outros.length + 1} projetos apontam para o expositor ${id} `
      + `(${[token, ...outros.map((d) => d.id)].join(', ')}). Nada publicado até o elo errado ser desfeito.`,
    )
    return null
  }

  const doc = await bdProducao.collection(COLECAO_ORIGEM).doc(id).get()
  // Pode ser o elo NOVO, a chave estável, que não é o id do documento. Aí a
  // busca é por campo. Uma leitura a mais só no caminho em que a primeira
  // falhou — e ela falha para todo projeto importado depois da migração.
  const porChave = doc.exists
    ? null
    : await bdProducao.collection(COLECAO_ORIGEM).where('clientKey', '==', id).limit(1).get()
  const achado = doc.exists ? doc : porChave?.docs?.[0]

  const cliente = achado
    ? normalizarDaProducao({ ...achado.data(), producaoId: achado.id })
    : null

  const veredicto = eloConfere(
    { expositor: projeto.expositor || '', stand: projeto.stand || '' },
    cliente,
  )
  if (!veredicto.confere) {
    logger.error(
      veredicto.motivo === 'sumiu'
        ? `ELO ÓRFÃO: ${projeto.stand || token} aponta para o expositor ${id}, que não existe mais no app.`
        : `ELO TROCADO: aqui o projeto é "${veredicto.esperado}", mas o expositor ${id} no app hoje é `
          + `"${veredicto.encontrado}". A planilha provavelmente foi reordenada.`,
    )
    return null
  }

  return cliente
}

/**
 * Publica o status de UM projeto. Devolve o que aconteceu, para o log.
 *
 * @param {string} token id do documento em `projetos`
 * @param {object|null} projeto o documento depois da mudança, ou null se sumiu
 */
export async function publicarStatus(bdArte, credencialJson, token, projeto, antes = null) {
  const bdProducao = bancoDaProducao(credencialJson)
  const destino = bdProducao.collection(COLECAO_STATUS)

  const idAgora = projeto?.producaoId || ''
  const idAntes = antes?.producaoId || ''

  // O elo foi desfeito, ou o projeto foi apagado. Tirar do app o status de um
  // stand que não é mais nosso é tão importante quanto publicá-lo: deixá-lo
  // seria manter no ar um dado que ninguém aqui mantém mais.
  if (idAntes && idAntes !== idAgora) {
    await destino.doc(idAntes).delete()
    logger.info(`status removido do app: ${idAntes}`)
  }

  if (!idAgora) return 'sem_elo'

  const cliente = await eloSeguro(bdArte, bdProducao, token, projeto)
  if (!cliente) return 'elo_inseguro'

  const dados = statusParaProducao(
    { token, ...projeto },
    resumoDoProjeto({ token, ...projeto }),
    provasDoProjeto({ token, ...projeto }),
    { clientKey: cliente.clientKey || '', clientName: cliente.expositor || '' },
  )
  const marca = assinaturaDoStatus(dados)

  // Nada mudou no que o app vê. Isto não é otimização: sem a conferência, toda
  // escrita no projeto — inclusive as que a própria ferramenta faz para marcar
  // coisas internas — viraria uma escrita no outro projeto.
  const atual = await destino.doc(idAgora).get()
  if (atual.exists && atual.data().assinatura === marca) return 'sem_mudanca'

  await destino.doc(idAgora).set({
    ...dados,
    assinatura: marca,
    atualizadoEm: FieldValue.serverTimestamp(),
  })
  return 'publicado'
}
