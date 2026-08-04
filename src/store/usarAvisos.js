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

import { useEffect, useState } from 'react'
import { pode, feirasVisiveis } from '../core/permissoes.js'
import { vistoEm, dataEmMs } from './visto.js'

export function usarAvisos(sessao) {
  const [avisos, setAvisos] = useState({})
  const { fb, acesso, usuario } = sessao

  useEffect(() => {
    if (!fb || !acesso) return undefined
    let vivo = true
    const canceladores = []

    const { getFirestore, collection, getDocs, query, where, onSnapshot } = fb.firestore
    const bd = getFirestore(fb.app)

    getDocs(collection(bd, 'feiras')).then((snap) => {
      if (!vivo) return
      const ids = feirasVisiveis(acesso, snap.docs.map((d) => ({ id: d.id }))).map((f) => f.id)
      // Sem feira, sem escuta: não custa nada e evita listener pendurado numa
      // consulta que nunca devolveria linha.
      if (!ids.length) return

      // O Firestore aceita no máximo 30 valores num `in`. Um analista com mais
      // feiras que isso é caso raro; cortar a lista é melhor do que quebrar a
      // consulta inteira e deixar o painel sem aviso nenhum.
      const alcance = ids.slice(0, 30)

      if (pode(acesso, 'verArtes')) {
        canceladores.push(onSnapshot(
          query(collection(bd, 'envios'), where('feiraId', 'in', alcance)),
          (s) => {
            if (!vivo) return
            const novos = s.docs.filter((d) => {
              const e = d.data()
              return dataEmMs(e.criadoEm) > vistoEm(usuario?.email, `envios:${e.feiraId}`)
            }).length
            setAvisos((a) => ({ ...a, admin: novos }))
          },
          () => {},
        ))
      }

      canceladores.push(onSnapshot(
        query(collection(bd, 'projetos'), where('feiraId', 'in', alcance)),
        (s) => {
          if (!vivo) return
          const comMensagem = s.docs.filter((d) => {
            const p = d.data()
            return p.conversa?.ultimoAutor === 'cliente'
              && dataEmMs(p.conversa?.ultimaEm) > vistoEm(usuario?.email, `conversa:${d.id}`)
          }).length
          setAvisos((a) => ({ ...a, projetos: comMensagem }))
        },
        () => {},
      ))
    }).catch(() => { /* sem aviso é degradação aceitável; o painel funciona */ })

    return () => { vivo = false; canceladores.forEach((c) => c()) }
  }, [fb, acesso, usuario?.email])

  return avisos
}
