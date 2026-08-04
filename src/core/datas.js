// Datas, num lugar só.
//
// Este arquivo existe por causa de um bug bobo e caro: a mesma conversão
// "isto aqui virou quantos milissegundos?" estava copiada em cinco telas, e
// cada cópia conhecia um conjunto diferente de formatos. A do cliente não
// sabia ler número — e `situacaoDoPrazo` devolve o limite justamente como
// número. Resultado: "Prazo para envio das artes: Invalid Date — faltam 23
// dias". A conta estava certa, a data ao lado dela não.
//
// Formatos que chegam aqui, todos legítimos:
//   - Timestamp do Firestore ({ seconds }) — o que vem do banco
//   - ISO em texto — o que gravamos e o que vem do <input type="date">
//   - número em ms — o que as funções puras devolvem
//   - Date — o que o JavaScript devolve quando alguém já converteu

/** Qualquer forma de data → milissegundos. 0 quando não dá para ler. */
export function emMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') return Date.parse(v) || 0
  if (v instanceof Date) return v.getTime() || 0
  if (typeof v.seconds === 'number') return v.seconds * 1000
  if (typeof v.toMillis === 'function') {
    try { return v.toMillis() || 0 } catch { return 0 }
  }
  return 0
}

/** Data curta (31/12/2026). `vazio` para quando não há data. */
export function formatarData(v, vazio = '—') {
  const ms = emMs(v)
  return ms ? new Date(ms).toLocaleDateString('pt-BR') : vazio
}

/** Data com hora (31/12/2026 14:05). */
export function formatarDataHora(v, vazio = '—') {
  const ms = emMs(v)
  return ms ? new Date(ms).toLocaleString('pt-BR') : vazio
}

/** Para o value de um <input type="date">, no fuso local. */
export function paraInputData(v) {
  const ms = emMs(v)
  if (!ms) return ''
  const d = new Date(ms)
  // Nada de toISOString aqui: ele converte para UTC, e um prazo gravado às
  // 23:59:59 de Brasília voltaria para o campo como o dia seguinte.
  const dois = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
}

// O prazo vale até o FIM do dia escolhido: guardar 00:00 faria "prazo dia 10"
// vencer na virada do dia 9 para o 10, e ninguém entende prazo assim.
export const fimDoDia = (aaaammdd) => (
  aaaammdd ? new Date(`${aaaammdd}T23:59:59`).toISOString() : null
)
