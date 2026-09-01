import { useCallback, useEffect, useState } from 'react'
import { ouvirFeiras } from '../services/projetos.js'
import { feirasVisiveis } from '../core/permissoes.js'

// O seletor de feira, num lugar só.
//
// Morava em `components/Admin.jsx`, que era a aba "Artes recebidas" — e três
// telas que nada têm a ver com envios importavam dali. Quando a aba saiu, o
// arquivo teria de ficar de pé só por causa deste gancho: é o cheiro clássico
// de código no lugar errado.

/**
 * Seletor de feira compartilhado pelas telas internas.
 *
 * `acesso` recorta a lista: um analista atribuído a duas feiras não deve nem
 * enxergar a terceira no seletor. Filtrar aqui, num lugar só, é o que impede a
 * lista completa de vazar por uma tela que alguém esqueceu de tratar.
 */
export function usarFeiras(fb, acesso, inicial = '') {
  const [feiras, setFeiras] = useState([])
  const [feiraId, setFeiraId] = useState('')
  const [erro, setErro] = useState(null)

  const recarregar = useCallback(async (selecionar) => {
    if (!fb) return
    try {
      const { getFirestore, collection, getDocs } = fb.firestore
      const snap = await getDocs(collection(getFirestore(fb.app), 'feiras'))
      const lista = feirasVisiveis(acesso, snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.atualizadaEm?.seconds || 0) - (a.atualizadaEm?.seconds || 0)))
      setFeiras(lista)
      // `inicial` só vale se a feira existir e a pessoa alcançar: um atalho
      // colado de outra feira não pode deixar a tela apontando para o vazio.
      const pedida = lista.some((f) => f.id === inicial) ? inicial : ''
      // A seleção atual só vale enquanto a feira existir. Sem esta conferência,
      // apagar a feira aberta deixa a tela apontando para um id que não existe
      // mais: seletor em branco, nenhum stand e nenhuma explicação. Vale também
      // para o dia em que alguém perder o acesso a uma feira.
      setFeiraId((atual) => {
        const valida = lista.some((f) => f.id === atual) ? atual : ''
        return selecionar || valida || pedida || lista[0]?.id || ''
      })
    } catch (e) {
      setErro(traduzirErroAuth(e))
    }
  }, [fb, acesso, inicial])

  useEffect(() => { recarregar() }, [recarregar])

  const feira = feiras.find((f) => f.id === feiraId) || null
  return { feiras, feira, feiraId, setFeiraId, recarregar, erro }
}

/**
 * Atalho para mandar a prova de aprovação desta arte ao cliente.
 *
 * Cobre só ESTA peça, de propósito: é o caminho de quem acabou de conferir um
 * arquivo e quer fechar o ciclo sem sair da lista. A prova que cobre várias
 * peças de uma vez — o mockup do stand inteiro — está em Projetos → Abrir, que
 * é onde o analista tem as peças todas à vista para escolher.
 */
