// Cadastro do expositor.
//
// Fica no localStorage para que quem volta a usar a ferramenta — e as pessoas
// voltam, porque cada stand tem várias peças — não redigite tudo a cada arte.

const CHAVE = 'aprovacao-arte:cadastro'

export const CAMPOS = [
  { chave: 'nome', rotulo: 'Seu nome', obrigatorio: true, tipo: 'text', autoComplete: 'name' },
  { chave: 'email', rotulo: 'E-mail', obrigatorio: true, tipo: 'email', autoComplete: 'email' },
  { chave: 'feira', rotulo: 'Nome da feira / evento', obrigatorio: true, tipo: 'text' },
  { chave: 'stand', rotulo: 'Nome do stand', obrigatorio: true, tipo: 'text', autoComplete: 'organization' },
  {
    chave: 'localizacao',
    rotulo: 'Localização do stand',
    obrigatorio: false,
    tipo: 'text',
    dica: 'Opcional — rua, número, pavilhão',
  },
]

export const CADASTRO_VAZIO = { nome: '', email: '', feira: '', stand: '', localizacao: '' }

// Deliberadamente permissivo: o objetivo é evitar erro de digitação óbvio, não
// bloquear o cliente por causa de um domínio incomum.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validar(cadastro) {
  const erros = {}
  for (const campo of CAMPOS) {
    const valor = (cadastro?.[campo.chave] || '').trim()
    if (campo.obrigatorio && !valor) {
      erros[campo.chave] = 'Campo obrigatório'
    } else if (campo.chave === 'email' && valor && !EMAIL.test(valor)) {
      erros[campo.chave] = 'E-mail inválido'
    } else if (campo.obrigatorio && valor.length < 2) {
      erros[campo.chave] = 'Muito curto'
    }
  }
  return { valido: Object.keys(erros).length === 0, erros }
}

export function normalizar(cadastro) {
  const limpo = {}
  for (const campo of CAMPOS) limpo[campo.chave] = (cadastro?.[campo.chave] || '').trim()
  limpo.email = limpo.email.toLowerCase()
  return limpo
}

export function carregar() {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return null
    const salvo = JSON.parse(bruto)
    return validar(salvo).valido ? normalizar(salvo) : null
  } catch {
    return null
  }
}

export function salvar(cadastro) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(normalizar(cadastro)))
  } catch {
    /* localStorage indisponível — o cadastro segue válido nesta sessão */
  }
}

export function limpar() {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    /* idem */
  }
}

/**
 * Identificador da feira, derivado do nome.
 *
 * Serve de ID de documento no Firestore e de pasta no armazenamento, então
 * precisa ser estável: a mesma feira digitada por dois expositores tem que
 * cair no mesmo lugar. Fica aqui, e não no serviço de envio, porque o cadastro
 * de projetos também precisa dele e importar o envio traria junto o SDK.
 */
export const idDeFeira = (nome) => paraNomeArquivo(nome, 60).toLowerCase()

/** Trecho seguro para compor nome de arquivo e de pasta no Drive. */
export function paraNomeArquivo(texto, maximo = 40) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maximo) || 'sem-nome'
}
