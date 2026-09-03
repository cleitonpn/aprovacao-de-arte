// As bolinhas das abas.
//
// Existem para responder, sem clique, a única pergunta que faz o analista
// recarregar a página: "chegou alguma coisa?". Enquanto a resposta exigir
// navegar até a tela para descobrir, ele vai continuar apertando F5 — e a
// escuta em tempo real não terá resolvido nada.
//
// A contagem é feita sobre TODAS as feiras que a pessoa alcança, e não só
// sobre a que está selecionada: aviso que só aparece depois de escolher a
// feira certa chega tarde demais para servir de aviso.
//
// Detalhe que já foi bug: os documentos ficam guardados aqui e a CONTA é
// refeita fora da escuta. Contar dentro do callback do Firestore parecia mais
// direto, mas amarrava o número a um evento que só acontece quando um
// documento muda — e marcar como lido não muda documento nenhum. O contador
// só zerava recarregando a página, justamente o F5 que a escuta veio eliminar.

import { useEffect, useMemo, useState } from 'react'
import { pode, feirasVisiveis } from '../core/permissoes.js'
import { LIMITE_REPROVACOES } from '../core/reprovacoes.js'
import { vistoEm, dataEmMs, assinarVisto } from './visto.js'

export function usarAvisos(sessao) {
  const { fb, acesso, usuario } = sessao
  const [envios, setEnvios] = useState([])
  const [projetos, setProjetos] = useState([])
  // Muda toda vez que alguém marca algo como visto. É o gatilho que faz a
  // conta abaixo ser refeita sem depender de novidade vinda do servidor.
  const [versaoDoVisto, setVersaoDoVisto] = useState(0)

  useEffect(() => assinarVisto(() => setVersaoDoVisto((v) => v + 1)), [])

  useEffect(() => {
    if (!fb || !acesso) return undefined
    let vivo = true
    const canceladores = []

    const { getFirestore, collection, getDocs, query, where, onSnapshot } = fb.firestore
    const bd = getFirestore(fb.app)

    getDocs(collection(bd, 'feiras')).then((snap) => {
      if (!vivo) return
      const ids = feirasVisiveis(acesso, snap.docs.map((d) => ({ id: d.id }))).map((f) => f.id)
      if (!ids.length) return

      // O Firestore aceita no máximo 30 valores num `in`. Um analista com mais
      // feiras que isso é caso raro; cortar a lista é melhor do que quebrar a
      // consulta e deixar o painel sem aviso nenhum.
      const alcance = ids.slice(0, 30)

      if (pode(acesso, 'verArtes')) {
        canceladores.push(onSnapshot(
          query(collection(bd, 'envios'), where('feiraId', 'in', alcance)),
          (s) => { if (vivo) setEnvios(s.docs.map((d) => ({ id: d.id, ...d.data() }))) },
          () => {},
        ))
      }

      canceladores.push(onSnapshot(
        query(collection(bd, 'projetos'), where('feiraId', 'in', alcance)),
        (s) => { if (vivo) setProjetos(s.docs.map((d) => ({ token: d.id, ...d.data() }))) },
        () => {},
      ))
    }).catch(() => { /* sem aviso é degradação aceitável; o painel funciona */ })

    return () => { vivo = false; canceladores.forEach((c) => c()) }
  }, [fb, acesso, usuario?.email])

  // Devolve as contagens E a lista de projetos.
  //
  // A escuta aqui já cobre todas as feiras que a pessoa alcança — era o único
  // lugar do sistema com essa visão — e a conversa do time precisa exatamente
  // dela: listar quem falou sem depender da feira escolhida numa tela. Abrir
  // uma segunda escuta idêntica custaria as mesmas leituras duas vezes.
  /**
   * Quantas artes novas em CADA feira.
   *
   * A marca de "visto" é por feira, mas a bolinha da aba soma todas — então,
   * sem esta quebra, arte que chega numa feira que ninguém abriu deixa a
   * bolinha acesa para sempre e o analista não tem como descobrir de onde vem o
   * número. Ele fica olhando uma lista com zero artes recebidas e um "2" no
   * alto da tela.
   *
   * Sai daqui, e não de uma segunda escuta na tela de projetos, porque esta é a
   * única escuta do sistema que enxerga todas as feiras que a pessoa alcança —
   * abrir outra igual custaria as mesmas leituras duas vezes.
   */
  const novosPorFeira = useMemo(() => {
    const conta = {}
    for (const e of envios) {
      if (dataEmMs(e.criadoEm) > vistoEm(usuario?.email, `envios:${e.feiraId}`)) {
        conta[e.feiraId] = (conta[e.feiraId] || 0) + 1
      }
    }
    return conta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envios, usuario?.email, versaoDoVisto])

  return useMemo(() => ({
    projetos,
    novosPorFeira,
    abas: {
    // "Chegou arte nova" e "o cliente respondeu" passam a somar na mesma
    // bolinha, a de Projetos.
    //
    // Eram duas: a de envios acendia na aba "Artes recebidas", que saiu. Somar
    // é aceitável porque as duas levam ao MESMO lugar e à mesma ação — abrir a
    // ficha do stand. Uma bolinha que apontasse para uma aba inexistente seria
    // pior que nenhuma.
    projetos: Object.values(novosPorFeira).reduce((s, n) => s + n, 0)
      // Bolinha só quando a última palavra é do CLIENTE: marcar por autor evita
      // o painel acender por causa da própria resposta do time.
      + projetos.filter((p) => p.conversa?.ultimoAutor === 'cliente'
        && dataEmMs(p.conversa?.ultimaEm) > vistoEm(usuario?.email, `conversa:${p.token}`)).length,
    // O cliente que está penando some do painel: a arte reprovada não sobe,
    // então ele fica igual a quem nem começou. Esta é a única bolinha que
    // avisa de uma coisa que NÃO aconteceu — e é por isso que ela precisa
    // existir. Some quando alguém abre a ficha dele, e volta se ele tentar de
    // novo e for reprovado outra vez.
    visao: projetos.filter((p) => (p.dificuldade?.reprovacoes || 0) > LIMITE_REPROVACOES
      && dataEmMs(p.dificuldade?.ultimaEm) > vistoEm(usuario?.email, `dificuldade:${p.token}`)).length,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [novosPorFeira, projetos, usuario?.email, versaoDoVisto])
}
