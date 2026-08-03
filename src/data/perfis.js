// Catálogo de tipos de peça e suas exigências mínimas.
//
// A regra de ouro do grande formato: o DPI aceitável é função da DISTÂNCIA
// de visualização. Uma testeira a 5 m de altura a 30 dpi fica impecável;
// o mesmo arquivo num adesivo de balcão, a 50 cm do olho, fica sofrível.
// Por isso o critério é por peça, nunca um número único global.

export const PERFIS_PADRAO = [
  {
    id: 'lona-parede',
    nome: 'Lona de parede / backdrop',
    distanciaM: 2.5,
    dpiMin: 50,
    dpiIdeal: 100,
    sangriaMm: 100,
    margemMm: 100,
    obs: 'Impressão em lona tensionada ou colada em parede de napa.',
  },
  {
    id: 'testeira',
    nome: 'Testeira / banner alto',
    distanciaM: 5,
    dpiMin: 30,
    dpiIdeal: 72,
    sangriaMm: 100,
    margemMm: 150,
    obs: 'Peça alta, vista sempre de longe. Margem generosa: a estrutura come as bordas.',
  },
  {
    id: 'adesivo-balcao',
    nome: 'Adesivo de balcão / recepção',
    distanciaM: 0.5,
    dpiMin: 150,
    dpiIdeal: 300,
    sangriaMm: 3,
    margemMm: 10,
    obs: 'Peça vista de perto e por muito tempo. É a mais exigente do stand.',
  },
  {
    id: 'vinil-piso',
    nome: 'Vinil de piso',
    distanciaM: 1.5,
    dpiMin: 72,
    dpiIdeal: 120,
    sangriaMm: 100,
    margemMm: 50,
    obs: 'Considere o desgaste e o laminado de proteção, que suavizam o detalhe.',
  },
  {
    id: 'placa',
    nome: 'Placa / sinalização / totem',
    distanciaM: 1,
    dpiMin: 120,
    dpiIdeal: 200,
    sangriaMm: 3,
    margemMm: 10,
    obs: 'Costuma ter texto pequeno — vale conferir a legibilidade.',
  },
  {
    id: 'livre',
    nome: 'Outra peça (definir manualmente)',
    distanciaM: 2,
    dpiMin: 100,
    dpiIdeal: 150,
    sangriaMm: 10,
    margemMm: 30,
    obs: '',
  },
]

// Escalas de trabalho aceitas. Arte em escala é praxe no grande formato:
// o designer monta a 1:10 a 300 dpi, o que dá 30 dpi no tamanho final — e
// está correto. Ignorar isso é a causa nº 1 de reprovação indevida.
export const ESCALAS = [
  { id: '1:1', fator: 1, rotulo: '1:1 — tamanho real' },
  { id: '1:2', fator: 2, rotulo: '1:2 — metade do tamanho' },
  { id: '1:4', fator: 4, rotulo: '1:4 — um quarto' },
  { id: '1:10', fator: 10, rotulo: '1:10 — um décimo (comum em grande formato)' },
]

export const FORMATOS_ACEITOS = ['jpg', 'jpeg', 'png', 'pdf', 'ai']
export const FORMATOS_CONHECIDOS = [...FORMATOS_ACEITOS, 'cdr', 'eps', 'psd', 'tif', 'tiff', 'svg', 'webp', 'gif', 'bmp', 'heic']

const CHAVE = 'aprovacao-arte:perfis'
const CHAVE_POLITICA = 'aprovacao-arte:politica'
const CHAVE_NITIDEZ = 'aprovacao-arte:detector-nitidez'

export function carregarPerfis() {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return PERFIS_PADRAO
    const salvos = JSON.parse(bruto)
    if (!Array.isArray(salvos) || !salvos.length) return PERFIS_PADRAO
    // mantém perfis novos do código que ainda não existiam no navegador do usuário
    const ids = new Set(salvos.map((p) => p.id))
    return [...salvos, ...PERFIS_PADRAO.filter((p) => !ids.has(p.id))]
  } catch {
    return PERFIS_PADRAO
  }
}

export function salvarPerfis(perfis) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(perfis))
  } catch {
    /* localStorage indisponível (aba anônima, cota) — segue com os padrões */
  }
}

export function restaurarPerfis() {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    /* idem */
  }
  return PERFIS_PADRAO
}

// Política da empresa (pisos de DPI e de sangria). Persistida inteira, para
// que acrescentar um novo piso no futuro não exija nova chave de storage.
export function carregarPolitica(padrao) {
  try {
    const bruto = localStorage.getItem(CHAVE_POLITICA)
    if (!bruto) return padrao
    const salvo = JSON.parse(bruto)
    return salvo && typeof salvo === 'object' ? { ...padrao, ...salvo } : padrao
  } catch {
    return padrao
  }
}

export function salvarPolitica(politica) {
  try {
    localStorage.setItem(CHAVE_POLITICA, JSON.stringify(politica))
  } catch {
    /* localStorage indisponível */
  }
}

// Detector de nitidez real (análise espectral). Ligado por decisão da
// operação. Continua desligável no painel de regras — ver README, seção
// "Detector de nitidez real", para o que ele pega e o que deixa passar.
export function carregarDetectorNitidez() {
  try {
    return localStorage.getItem(CHAVE_NITIDEZ) !== 'off'
  } catch {
    return true
  }
}

export function salvarDetectorNitidez(ligado) {
  try {
    localStorage.setItem(CHAVE_NITIDEZ, ligado ? 'on' : 'off')
  } catch {
    /* localStorage indisponível */
  }
}
