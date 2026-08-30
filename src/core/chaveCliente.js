// A chave estável do expositor — a ponte com o app de montagem.
//
// PROCEDÊNCIA: `normalizeKeyPart` e `clientKeyFor` são cópia VERBATIM de
// `tools/client_key_parity.test.js` do repositório `pendencias-cas-2026`, que é
// a implementação de referência. Não reescreva a partir da descrição: o próprio
// arquivo de lá avisa que "minúsculas, sem acento, só [a-z0-9]" admite mais de
// uma implementação, e duas delas discordam.
//
// O ponto onde é fácil errar: acento é CONVERTIDO, não removido. "Módulos" tem
// de virar `modulos`. Um lado que apague o caractere produz `mdulos`, e aí a
// ponte não casa nada — sem erro em lugar nenhum. Foi assim que os tópicos FCM
// daquele app divergiram antes de existir teste de paridade.
//
// POR QUE ELA EXISTE: até aqui o elo era o id do documento em `fair_clients`,
// que do lado do app é `nomeDaFeira_númeroDaLinha` — a POSIÇÃO do expositor na
// planilha. Reordenar a planilha reescrevia o id de todo mundo abaixo, e cada
// cliente herdava o id do vizinho: a prova de um stand ia parar no cartão de
// outro. Aconteceu de verdade, com 10 stands da Conferencia Luxo.
//
// Se este arquivo mudar, `test/chave-cliente.test.mjs` quebra — e ele existe
// para isso. Mudança aqui sem a mesma mudança no Dart de lá é o começo da
// divergência silenciosa.

const ACENTOS = {
  'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
  'é': 'e', 'ê': 'e', 'è': 'e', 'ë': 'e',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c', 'ñ': 'n',
}

export const SEPARADOR = '__'

/** Uma parte da chave: minúsculas, sem acento, resto vira "_". */
export function normalizeKeyPart(raw) {
  let s = String(raw == null ? '' : raw).toLowerCase().trim()
  for (const [de, para] of Object.entries(ACENTOS)) {
    s = s.split(de).join(para)
  }
  return s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * A chave estável do expositor, ou "" quando não dá para formar uma.
 *
 * Sem uma das partes não há chave: meia chave ligaria coisas sem relação.
 */
export function clientKeyFor(fairName, nome) {
  const f = normalizeKeyPart(fairName)
  const n = normalizeKeyPart(nome)
  if (!f || !n) return ''
  return f + SEPARADOR + n
}

/** A tabela de acentos, exposta para o teste de paridade conferir. */
export const ACENTOS_DE_REFERENCIA = ACENTOS
