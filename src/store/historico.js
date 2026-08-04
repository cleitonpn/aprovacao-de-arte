// Registro das análises.
//
// Hoje grava no localStorage do navegador. A interface abaixo é o único ponto
// que precisa mudar para virar Firebase na fase 2 — nada mais no app conhece
// o mecanismo de persistência.
//
// O hash SHA-256 do arquivo é o que dá valor jurídico ao registro: quando o
// cliente aceita imprimir uma peça com ressalva e depois reclama do
// resultado, existe a prova de qual arquivo exato foi aprovado, por quem e
// quando.

const CHAVE = 'aprovacao-arte:historico'
const LIMITE = 200

function ler() {
  try {
    const bruto = localStorage.getItem(CHAVE)
    const lista = bruto ? JSON.parse(bruto) : []
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

function gravar(lista) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, LIMITE)))
  } catch {
    /* cota estourada ou aba anônima: o app segue funcionando sem histórico */
  }
}

export function listar() {
  return ler()
}

export function registrar(entrada) {
  const lista = ler()
  const registro = {
    id: `${entrada.hash || 'sem-hash'}:${Date.now()}`,
    ...entrada,
    registradoEm: new Date().toISOString(),
  }
  gravar([registro, ...lista])
  return registro
}

export function marcarRiscoAceito(id, quem = {}) {
  const riscoAceito = {
    em: new Date().toISOString(),
    nome: String(quem.nome || '').trim(),
    email: String(quem.email || '').trim().toLowerCase(),
  }
  const lista = ler().map((r) => (r.id === id ? { ...r, riscoAceito } : r))
  gravar(lista)
  return lista
}

export function limpar() {
  gravar([])
  return []
}
