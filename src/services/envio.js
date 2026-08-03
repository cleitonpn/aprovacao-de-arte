// Envio da arte aprovada para o Drive.
//
// Arquitetura escolhida para o cliente NÃO precisar de login:
//
//   navegador  --(1) metadados--> Cloud Function --(service account)--> Drive
//   navegador  <--(2) URL de sessão de upload---- Cloud Function
//   navegador  --(3) BYTES do arquivo, direto-->  Google
//   navegador  --(4) confirma-----------------> Cloud Function -> Firestore
//
// O detalhe que barateia tudo: os bytes nunca passam pela função. Ela troca
// alguns kilobytes de JSON, então um arquivo de 500 MB custa o mesmo que um
// de 5 MB — e cabe folgado no plano gratuito. Mandar o arquivo através da
// função custaria tempo de execução e tráfego de saída em cima de cada megabyte.

import { ENVIO, tokenDoEvento } from '../config.js'

// 8 MB por pedaço: grande o bastante para não virar conversa fiada de rede,
// pequeno o bastante para uma queda de conexão não jogar fora o upload todo.
const PEDACO = 8 * 1024 * 1024
const TENTATIVAS = 4

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function postar(caminho, corpo) {
  const resposta = await fetch(`${ENVIO.endpoint}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...corpo, tokenEvento: tokenDoEvento() }),
  })
  const texto = await resposta.text()
  let dados = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    /* resposta não-JSON cai no erro abaixo */
  }
  if (!resposta.ok) {
    throw new Error(dados?.erro || `Falha na comunicação com o servidor (${resposta.status}).`)
  }
  return dados
}

/**
 * Sobe os bytes em pedaços numa sessão retomável do Google.
 * Um 308 significa "recebi, manda o próximo" — não é erro.
 */
async function enviarBytes(urlSessao, arquivo, aoProgredir) {
  const total = arquivo.size
  let enviado = 0

  while (enviado < total) {
    const fim = Math.min(enviado + PEDACO, total)
    const pedaco = arquivo.slice(enviado, fim)
    let resposta = null
    let erroFinal = null

    for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
      try {
        resposta = await fetch(urlSessao, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${enviado}-${fim - 1}/${total}`,
          },
          body: pedaco,
        })
        erroFinal = null
        break
      } catch (e) {
        // queda de rede: espera progressiva antes de repetir o MESMO pedaço
        erroFinal = e
        await espera(1000 * 2 ** tentativa)
      }
    }
    if (erroFinal) throw new Error('A conexão caiu durante o envio. Tente novamente.')

    if (resposta.status === 308) {
      // O Google diz até onde recebeu; seguimos exatamente de lá.
      const faixa = resposta.headers.get('Range')
      const ate = faixa ? Number(faixa.split('-')[1]) : fim - 1
      enviado = Number.isFinite(ate) ? ate + 1 : fim
    } else if (resposta.ok) {
      enviado = total
      aoProgredir?.(1)
      return await resposta.json()
    } else if (resposta.status === 404) {
      throw new Error('A sessão de envio expirou. Tente enviar novamente.')
    } else {
      const detalhe = await resposta.text().catch(() => '')
      throw new Error(`O Google recusou o envio (${resposta.status}). ${detalhe.slice(0, 200)}`)
    }

    aoProgredir?.(enviado / total)
  }
  return null
}

/**
 * @param {File} arquivo
 * @param {object} dados  { cadastro, peca, perfil, veredicto, laudo, riscoAceito }
 * @param {(fracao:number)=>void} aoProgredir
 */
export async function enviarArte(arquivo, dados, aoProgredir) {
  if (!ENVIO.endpoint) throw new Error('O envio para o Drive não está configurado nesta instalação.')

  const limite = ENVIO.tamanhoMaximoMb * 1024 * 1024
  if (arquivo.size > limite) {
    throw new Error(`O arquivo tem ${(arquivo.size / 1048576).toFixed(0)} MB e o limite é ${ENVIO.tamanhoMaximoMb} MB.`)
  }

  aoProgredir?.(0)

  const sessao = await postar('/sessao', {
    cadastro: dados.cadastro,
    peca: dados.peca,
    perfil: { id: dados.perfil.id, nome: dados.perfil.nome },
    veredicto: dados.veredicto,
    riscoAceito: dados.riscoAceito || null,
    laudo: dados.laudo,
    arquivo: {
      nome: arquivo.name,
      tamanho: arquivo.size,
      tipo: arquivo.type || 'application/octet-stream',
      sha256: dados.laudo?.arquivo?.sha256 || null,
    },
  })

  const resultadoUpload = await enviarBytes(sessao.urlSessao, arquivo, aoProgredir)

  const confirmacao = await postar('/concluir', {
    protocolo: sessao.protocolo,
    idArquivoDrive: resultadoUpload?.id || null,
  })

  return {
    protocolo: sessao.protocolo,
    link: confirmacao?.link || resultadoUpload?.webViewLink || null,
    nomeNoDrive: confirmacao?.nome || sessao.nomeArquivo,
  }
}
