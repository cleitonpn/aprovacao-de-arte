// O registro das tentativas reprovadas — e o alerta de quem está penando.
//
// Por que isto não existia e precisa existir: arte reprovada NUNCA sobe. A
// trava é o ponto da ferramenta (ver `Envio.jsx` e as regras do Storage), e
// ela funciona. Só que, por funcionar, o cliente que tentou oito vezes e
// desistiu não deixa rastro nenhum: para o painel ele é idêntico ao cliente
// que simplesmente não começou. Os dois aparecem como "0 de 5 artes", e são
// dois problemas completamente diferentes — um precisa de cobrança, o outro
// precisa de ajuda.
//
// Este arquivo é a metade pura disso: o que conta como reprovação, o que se
// guarda de cada uma e a partir de quando o time é chamado.

/**
 * A partir de quantas reprovações o stand vira alerta.
 *
 * "Mais de 3" — quatro tentativas reprovadas na mesma feira não é azar, é
 * alguém que não está conseguindo. Com o piso de DPI em 100, reprovar ficou
 * raro: quase tudo que antes reprovava hoje passa com ressalva. Quem chega a
 * quatro está mandando arquivo pequeno demais, no formato errado ou na medida
 * errada — e nenhum desses três se resolve com mais um e-mail de cobrança.
 *
 * Mudar o número aqui muda o alerta em todas as telas.
 */
export const LIMITE_REPROVACOES = 3

const texto = (v, max) => String(v ?? '').trim().slice(0, max)

/**
 * Os motivos que de fato reprovaram a arte.
 *
 * Só os bloqueantes. Uma arte reprovada costuma trazer junto meia dúzia de
 * ressalvas e informativos, e guardar tudo transformaria o log em outra tela
 * técnica — que é o oposto do que ele serve para responder: "por que este
 * cliente não está conseguindo?".
 */
export function motivosDeReprovacao(resultado, maximo = 4) {
  return (resultado?.achados || [])
    .filter((a) => a.nivel === 'bloqueante')
    .slice(0, maximo)
    .map((a) => ({
      id: a.id ?? null,
      titulo: texto(a.titulo, 160),
      acao: a.acao ? texto(a.acao, 300) : null,
    }))
}

/**
 * O documento de uma tentativa reprovada.
 *
 * Guarda o suficiente para o analista entender o caso sem pedir o arquivo: que
 * peça, que arquivo, quantos dpi tinha e quantos precisava, e o que travou.
 * Não guarda o arquivo — ele não subiu, e é justamente por não ter subido que
 * este registro existe.
 */
export function eventoDeReprovacao({ peca, resultado, versao = 1, em = new Date().toISOString() }) {
  const medidas = resultado?.medidas || {}
  const resolucao = resultado?.resolucao || {}
  return {
    pecaId: peca?.id ?? null,
    pecaRotulo: texto(peca?.rotulo || resultado?.perfil?.nome, 160),
    versao: Number(versao) || 1,
    arquivo: {
      nome: texto(medidas.arquivo?.nome, 240),
      tamanho: Number(medidas.arquivo?.tamanho) || null,
      formato: medidas.formato ?? null,
      sha256: medidas.arquivo?.hash ?? null,
    },
    dpi: Number.isFinite(resolucao.dpi) ? Math.round(resolucao.dpi) : null,
    dpiExigido: Number.isFinite(resolucao.minimo?.dpi) ? Math.round(resolucao.minimo.dpi) : null,
    motivos: motivosDeReprovacao(resultado),
    em,
  }
}

/** Chave de deduplicação: o MESMO arquivo, na MESMA peça, é uma tentativa só. */
export function chaveDaTentativa(token, pecaId, resultado) {
  const marca = resultado?.medidas?.arquivo?.hash
    || `${resultado?.medidas?.arquivo?.nome}:${resultado?.medidas?.arquivo?.tamanho}`
  return `${token}:${pecaId}:${marca}`
}

/**
 * O que o painel precisa saber sobre a dificuldade de um stand.
 *
 * Lê o espelho gravado no documento do projeto, não a subcoleção: pintar o
 * alerta em trezentos stands não pode custar trezentas consultas. A subcoleção
 * é a verdade e fica para quem abrir a ficha.
 */
export function dificuldadeDoProjeto(projeto) {
  const d = projeto?.dificuldade || {}
  const total = Number(d.reprovacoes) || 0
  // Quantas reprovações o stand tinha quando alguém do time falou com o
  // cliente. Gravado no `controle`, que só o time escreve.
  const atendidoAte = Number(projeto?.controle?.contato?.reprovacoesAte) || 0

  return {
    total,
    ultimaEm: d.ultimaEm || null,
    ultimoMotivo: d.ultimoMotivo || null,
    ultimaPeca: d.ultimaPeca || null,
    // O alerta cala depois da conversa e VOLTA na próxima tentativa reprovada.
    //
    // Por contagem, e não por tempo: aqui existe um evento novo capaz de dizer
    // que a conversa não resolveu — o cliente tentar de novo e ser recusado de
    // novo. Enquanto ele não tentar, não há notícia nenhuma, e repetir o alerta
    // seria repetir uma informação que o time já tratou.
    alerta: total > LIMITE_REPROVACOES && total > atendidoAte,
    atendido: atendidoAte > 0 && total <= atendidoAte,
    atendidoAte,
  }
}

/**
 * O motivo que mais se repete — a frase que o analista vai usar na ligação.
 *
 * Cinco reprovações pelo mesmo motivo é um cliente que não entendeu UMA coisa;
 * cinco por motivos diferentes é um cliente perdido. A conversa é outra nos
 * dois casos, e é isso que este agrupamento entrega.
 */
export function motivosMaisComuns(reprovacoes = []) {
  const conta = new Map()
  for (const r of reprovacoes) {
    for (const m of r.motivos || []) {
      const chave = m.titulo || m.id || 'Sem motivo registrado'
      const atual = conta.get(chave) || { titulo: chave, acao: m.acao || null, vezes: 0 }
      atual.vezes += 1
      if (!atual.acao && m.acao) atual.acao = m.acao
      conta.set(chave, atual)
    }
  }
  return [...conta.values()].sort((a, b) => b.vezes - a.vezes)
}
