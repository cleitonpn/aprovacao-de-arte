// Projeto: as peças que um stand precisa entregar, cadastradas ANTES de o
// cliente enviar qualquer arquivo.
//
// É a inversão do fluxo original. Antes, o cliente digitava a medida da peça
// e a análise inteira dependia daquele número — se ele errava, a ferramenta
// aprovava com confiança uma arte errada, que é o único jeito de ela ser pior
// que nada. Agora a medida vem de quem a conhece: o projeto do stand.
//
// Cada projeto tem um `token` que é o ID do documento e, ao mesmo tempo, a
// credencial: quem tem o link entra, sem login e sem senha. É de propósito —
// quem monta a arte quase nunca é o e-mail cadastrado, é a agência do cliente,
// e uma senha por pessoa deixaria justamente ela de fora.

import { PERFIS_PADRAO } from './perfis.js'

/** Alfabeto sem caracteres que se confundem lidos em voz alta ou no papel. */
const ALFABETO = '23456789abcdefghjkmnpqrstuvwxyz'

export function tokenNovo(tamanho = 12) {
  const bytes = new Uint8Array(tamanho)
  if (globalThis.crypto?.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < tamanho; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join('')
}

export const idDePeca = () => `p_${tokenNovo(8)}`

/** Texto comparável: sem acento, sem caixa, sem pontuação sobrando. */
export function chave(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------- perfis
//
// O cliente escreve "lona", "adesivo de balcão", "testeira" — não o id do
// perfil. Este mapa é o tradutor, e vale tanto para a importação de planilha
// quanto para o cadastro na tela.

const PALAVRAS_POR_PERFIL = [
  ['adesivo-balcao', ['adesivo', 'balcao', 'recepcao', 'vitrine', 'vidro', 'acm', 'aplique']],
  ['vinil-piso', ['piso', 'chao', 'tapete', 'vinil de piso']],
  ['testeira', ['testeira', 'letreiro', 'banner alto', 'fachada', 'marquise', 'sanca']],
  ['placa', ['placa', 'totem', 'sinalizacao', 'display', 'painel de sinalizacao', 'menu']],
  ['lona-parede', ['lona', 'backdrop', 'parede', 'napa', 'painel', 'fundo', 'tecido']],
]

/**
 * Descobre o tipo de peça a partir do texto livre da planilha.
 *
 * A ordem importa: "adesivo de painel" é adesivo, não painel. Por isso os
 * perfis mais específicos vêm antes dos genéricos, e não usamos o primeiro
 * termo que casar em ordem alfabética.
 */
export function perfilPorTexto(texto, perfis = PERFIS_PADRAO) {
  const t = chave(texto)
  if (!t) return 'livre'
  for (const [id, palavras] of PALAVRAS_POR_PERFIL) {
    if (palavras.some((p) => t.includes(p))) {
      return perfis.some((perfil) => perfil.id === id) ? id : 'livre'
    }
  }
  return 'livre'
}

// ---------------------------------------------------------------- medidas

const NUM = '(\\d+(?:[.,]\\d+)?)'
const UNIDADE = '(cm|mm|m)?'
const RE_MEDIDA = new RegExp(`${NUM}\\s*${UNIDADE}\\s*[x×*]\\s*${NUM}\\s*${UNIDADE}`, 'i')

const paraCm = (valor, unidade) => {
  if (unidade === 'm') return valor * 100
  if (unidade === 'mm') return valor / 10
  return valor
}

/**
 * Lê "275x275", "2,75 x 2,75 m", "1000 x 500 mm" e devolve centímetros.
 *
 * Sem unidade assumimos centímetro e NÃO tentamos adivinhar pelo tamanho do
 * número: "10 x 10" tanto pode ser um adesivo de 10 cm quanto uma lona de
 * 10 m. Chutar aqui produziria exatamente o erro silencioso que este cadastro
 * existe para eliminar — então quem chama recebe o aviso e confere.
 */
export function interpretarMedida(texto) {
  const m = RE_MEDIDA.exec(String(texto || ''))
  if (!m) return null
  const [, l, uL, a, uA] = m
  const unidade = (uA || uL || '').toLowerCase()
  const larguraCm = paraCm(Number(l.replace(',', '.')), (uL || unidade).toLowerCase())
  const alturaCm = paraCm(Number(a.replace(',', '.')), unidade)
  if (!(larguraCm > 0) || !(alturaCm > 0)) return null
  return { larguraCm, alturaCm, unidadeInformada: Boolean(unidade) }
}

/** Lê "1:4", "1/4" ou "4" e devolve o fator de escala. */
export function interpretarEscala(texto) {
  const t = String(texto || '').trim()
  if (!t) return 1
  const m = /^1\s*[:/]\s*(\d+(?:[.,]\d+)?)$/.exec(t) || /^(\d+(?:[.,]\d+)?)$/.exec(t)
  if (!m) return 1
  const fator = Number(m[1].replace(',', '.'))
  return Number.isFinite(fator) && fator >= 1 ? fator : 1
}

// ---------------------------------------------------------------- validação

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Um limite alto o bastante para qualquer stand real e baixo o bastante para
// que um erro de digitação (ou uma planilha maluca) não vire um documento
// gigante no Firestore.
export const MAXIMO_PECAS = 60

export function pecaNova(parcial = {}) {
  return {
    id: parcial.id || idDePeca(),
    rotulo: parcial.rotulo || '',
    perfilId: parcial.perfilId || 'lona-parede',
    larguraCm: Number(parcial.larguraCm) || 0,
    alturaCm: Number(parcial.alturaCm) || 0,
    escalaFator: Number(parcial.escalaFator) || 1,
    obs: parcial.obs || '',
  }
}

export function projetoNovo(parcial = {}) {
  return {
    token: parcial.token || tokenNovo(),
    feira: parcial.feira || '',
    expositor: parcial.expositor || '',
    email: parcial.email || '',
    stand: parcial.stand || '',
    localizacao: parcial.localizacao || '',
    pecas: (parcial.pecas || []).map(pecaNova),
    aceitaAvulsos: parcial.aceitaAvulsos !== false,
  }
}

export function validarProjeto(p) {
  const erros = {}
  const texto = (v) => String(v || '').trim()

  if (texto(p?.feira).length < 2) erros.feira = 'Informe o nome da feira'
  if (texto(p?.expositor).length < 2) erros.expositor = 'Informe o nome do cliente'
  if (texto(p?.stand).length < 2) erros.stand = 'Informe o nome do stand'
  if (!EMAIL.test(texto(p?.email))) erros.email = 'E-mail inválido'

  const pecas = Array.isArray(p?.pecas) ? p.pecas : []
  if (!pecas.length) erros.pecas = 'O projeto precisa de pelo menos uma peça'
  else if (pecas.length > MAXIMO_PECAS) erros.pecas = `Máximo de ${MAXIMO_PECAS} peças por projeto`
  else {
    const porPeca = {}
    pecas.forEach((peca, i) => {
      if (texto(peca?.rotulo).length < 2) porPeca[i] = 'Dê um nome à peça'
      else if (!(Number(peca?.larguraCm) > 0) || !(Number(peca?.alturaCm) > 0)) {
        porPeca[i] = 'Largura e altura em cm'
      }
    })
    if (Object.keys(porPeca).length) erros.porPeca = porPeca
  }

  return { valido: Object.keys(erros).length === 0, erros }
}

export function normalizarProjeto(p) {
  const texto = (v, max) => String(v ?? '').trim().slice(0, max)
  return {
    token: p.token || tokenNovo(),
    feira: texto(p.feira, 160),
    expositor: texto(p.expositor, 120),
    email: texto(p.email, 160).toLowerCase(),
    stand: texto(p.stand, 160),
    localizacao: texto(p.localizacao, 160),
    aceitaAvulsos: p.aceitaAvulsos !== false,
    pecas: (p.pecas || []).map((peca) => ({
      id: peca.id || idDePeca(),
      rotulo: texto(peca.rotulo, 120),
      perfilId: texto(peca.perfilId, 40) || 'livre',
      larguraCm: Math.round(Number(peca.larguraCm) * 100) / 100,
      alturaCm: Math.round(Number(peca.alturaCm) * 100) / 100,
      escalaFator: Number(peca.escalaFator) > 1 ? Number(peca.escalaFator) : 1,
      obs: texto(peca.obs, 240),
    })),
  }
}

/** O cadastro que o envio grava, montado a partir do projeto. */
export function cadastroDoProjeto(projeto) {
  return {
    nome: projeto.expositor,
    email: projeto.email,
    feira: projeto.feira,
    stand: projeto.stand,
    localizacao: projeto.localizacao || '',
  }
}
