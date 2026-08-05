// Quem pode o quê, e em quais feiras.
//
// Duas perguntas independentes, e misturá-las é o erro clássico: "posso mandar
// prova de aprovação?" (o papel) e "posso mexer NESTE stand?" (o escopo). Um
// analista de cobrança com acesso a todas as feiras continua não podendo
// aprovar nada; um analista completo só opera as feiras dele. As duas
// perguntas se respondem aqui, em funções puras, e as telas só desenham.
//
// Onde isto é lei e onde não é — vale a franqueza, porque é uma decisão:
//
// - **É lei no servidor** a única permissão cuja falsificação seria grave:
//   mexer na lista de analistas. Sem essa trava, qualquer pessoa com acesso
//   se promoveria a admin, e o resto das permissões viraria decoração.
// - **É regra de tela** o resto. O modelo de ameaça aqui é a equipe interna
//   errando o clique, não alguém montando chamada de API para contornar. Como
//   toda ação relevante fica registrada com o e-mail de quem fez, um contorno
//   apareceria no histórico em vez de acontecer em silêncio.

export const PAPEIS = {
  admin: {
    rotulo: 'Administrador',
    descricao: 'Acesso máximo. Faz tudo, em todas as feiras, e é o único que cadastra e remove analistas.',
    permissoes: ['verPainel', 'verArtes', 'cadastrarProjetos', 'cobrar', 'aprovar', 'gerenciarAnalistas'],
    sempreTodasAsFeiras: true,
  },
  completo: {
    rotulo: 'Analista completo',
    descricao: 'Opera as feiras dele de ponta a ponta: cadastra projetos, manda prova, libera reenvio e marca impressão.',
    permissoes: ['verPainel', 'verArtes', 'cadastrarProjetos', 'cobrar', 'aprovar'],
  },
  cadastro: {
    rotulo: 'Cadastro',
    descricao: 'Cadastra feiras e projetos e importa planilha. Não manda prova, não libera reenvio e não marca impressão.',
    permissoes: ['verArtes', 'cadastrarProjetos'],
  },
  cobranca: {
    rotulo: 'Cobrança',
    descricao: 'Acompanha o que falta e cobra o cliente por e-mail. Não altera cadastro nem decide sobre arte.',
    permissoes: ['verArtes', 'cobrar'],
  },
}

export const PAPEL_PADRAO = 'admin'
export const LISTA_DE_PAPEIS = Object.entries(PAPEIS).map(([id, p]) => ({ id, ...p }))

export const ROTULO_PERMISSAO = {
  verPainel: 'Visão geral da feira',
  verArtes: 'Ver e baixar as artes recebidas',
  cadastrarProjetos: 'Cadastrar feiras, projetos e importar planilha',
  cobrar: 'Cobrar o cliente por e-mail e exportar listas',
  aprovar: 'Prova de aprovação, liberar reenvio e status de impressão',
  gerenciarAnalistas: 'Cadastrar e remover analistas',
}

/**
 * Normaliza o documento do analista.
 *
 * Registro antigo, sem `papel`, vira administrador — é o que os cadastros
 * feitos antes desta tela existirem de fato eram, e rebaixá-los na migração
 * trancaria o time inteiro para fora do painel de uma vez.
 */
export function acessoDe(dados) {
  const papel = dados?.papel in PAPEIS ? dados.papel : PAPEL_PADRAO
  const definicao = PAPEIS[papel]
  const todasAsFeiras = definicao.sempreTodasAsFeiras || dados?.todasAsFeiras === true
  return {
    papel,
    rotulo: definicao.rotulo,
    permissoes: definicao.permissoes,
    todasAsFeiras,
    feiras: todasAsFeiras ? [] : [...new Set((dados?.feiras || []).filter(Boolean))],
  }
}

/** @param {ReturnType<typeof acessoDe>} acesso */
export const pode = (acesso, permissao) => Boolean(acesso?.permissoes?.includes(permissao))

/** O analista alcança esta feira? */
export function alcancaFeira(acesso, feiraId) {
  if (!acesso) return false
  if (acesso.todasAsFeiras) return true
  return acesso.feiras.includes(feiraId)
}

/** Filtra a lista de feiras pelo escopo do analista. */
export function feirasVisiveis(acesso, feiras = []) {
  if (!acesso) return []
  if (acesso.todasAsFeiras) return feiras
  return feiras.filter((f) => acesso.feiras.includes(f.id))
}

/**
 * As abas que este analista enxerga.
 *
 * Esconder a aba, e não só desabilitar o botão dentro dela, é deliberado:
 * quem não pode aprovar não precisa saber que a tela de aprovação existe. Uma
 * aba que só dá erro ao clicar é pior do que aba nenhuma.
 */
export function abasDe(acesso) {
  const abas = []
  // A visão geral vem primeiro porque é a tela em que o dia começa: "como está
  // a feira?" antes de "o que chegou agora?". Como `telaInicial` é a primeira
  // desta lista, quem tem a permissão abre o painel direto nela.
  if (pode(acesso, 'verPainel')) abas.push({ id: 'visao', rotulo: 'Visão geral' })
  if (pode(acesso, 'verArtes')) abas.push({ id: 'admin', rotulo: 'Artes recebidas' })
  if (pode(acesso, 'cadastrarProjetos') || pode(acesso, 'cobrar') || pode(acesso, 'aprovar')) {
    abas.push({ id: 'projetos', rotulo: 'Projetos' })
  }
  if (pode(acesso, 'gerenciarAnalistas')) abas.push({ id: 'analistas', rotulo: 'Analistas' })
  return abas
}

/** Primeira tela a abrir para este analista. */
export const telaInicial = (acesso) => abasDe(acesso)[0]?.id || null
