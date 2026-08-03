/**
 * Cloud Function do envio de arte.
 *
 * Existe por um motivo só: permitir que o expositor envie a arte SEM fazer
 * login. Ela guarda a credencial que escreve no Drive e devolve ao navegador
 * uma URL de sessão de upload assinada.
 *
 * Os bytes do arquivo NUNCA passam por aqui. O navegador fala direto com o
 * Google. Por isso um arquivo de 500 MB custa o mesmo que um de 5 MB, e o
 * plano gratuito dá conta com folga.
 */

const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { GoogleAuth, OAuth2Client } = require('google-auth-library')

initializeApp()
const bd = getFirestore()

// --- segredos (firebase functions:secrets:set NOME) --------------------------
const TOKEN_EVENTO = defineSecret('TOKEN_EVENTO')
const DRIVE_PASTA_RAIZ = defineSecret('DRIVE_PASTA_RAIZ')
// Caminho A — Drive compartilhado (recomendado, exige Google Workspace)
const SERVICE_ACCOUNT_JSON = defineSecret('SERVICE_ACCOUNT_JSON')
// Caminho B — conta comum do Google (funciona sem Workspace)
const OAUTH_CLIENT_ID = defineSecret('OAUTH_CLIENT_ID')
const OAUTH_CLIENT_SECRET = defineSecret('OAUTH_CLIENT_SECRET')
const OAUTH_REFRESH_TOKEN = defineSecret('OAUTH_REFRESH_TOKEN')

const ESCOPO = 'https://www.googleapis.com/auth/drive.file'
const ORIGENS_LIBERADAS = (process.env.ORIGENS_LIBERADAS || '').split(',').filter(Boolean)

const TIPOS_ACEITOS = new Set([
  'image/jpeg', 'image/png', 'application/pdf',
  'application/postscript', 'application/illustrator', 'application/octet-stream',
])
const TAMANHO_MAXIMO = 1024 * 1024 * 1024 // 1 GB

/**
 * Duas formas de autenticar no Drive, porque a escolha depende do plano de
 * Google que a empresa tem:
 *
 * A) Service account + Drive compartilhado. É o caminho limpo, mas exige
 *    Workspace. Atenção à pegadinha clássica: service account não tem cota de
 *    armazenamento própria, então enviar para uma pasta do "Meu Drive" de
 *    alguém FALHA. Só funciona dentro de um Drive compartilhado.
 *
 * B) Refresh token de uma conta comum. Os arquivos ficam no Drive daquela
 *    conta, e funciona com Gmail comum.
 */
async function tokenDoDrive() {
  const chave = SERVICE_ACCOUNT_JSON.value()
  if (chave) {
    const auth = new GoogleAuth({ credentials: JSON.parse(chave), scopes: [ESCOPO] })
    const cliente = await auth.getClient()
    const { token } = await cliente.getAccessToken()
    return token
  }
  const refresh = OAUTH_REFRESH_TOKEN.value()
  if (refresh) {
    const cliente = new OAuth2Client(OAUTH_CLIENT_ID.value(), OAUTH_CLIENT_SECRET.value())
    cliente.setCredentials({ refresh_token: refresh })
    const { token } = await cliente.getAccessToken()
    return token
  }
  throw new Error('Nenhuma credencial do Drive configurada (SERVICE_ACCOUNT_JSON ou OAUTH_REFRESH_TOKEN).')
}

const cabecalhos = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

async function drive(caminho, opcoes, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/${caminho}`, {
    ...opcoes,
    headers: { ...cabecalhos(token), ...(opcoes.headers || {}) },
  })
  if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

const escapar = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Uma pasta por feira, criada sob demanda e memorizada no Firestore. */
async function pastaDaFeira(token, raiz, feiraId, nomeFeira) {
  const ref = bd.collection('feiras').doc(feiraId)
  const doc = await ref.get()
  if (doc.exists && doc.data().pastaId) return doc.data().pastaId

  const consulta = [
    `'${escapar(raiz)}' in parents`,
    `name = '${escapar(nomeFeira)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ].join(' and ')
  const achados = await drive(
    `files?q=${encodeURIComponent(consulta)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { method: 'GET' }, token,
  )

  let pastaId = achados.files?.[0]?.id
  if (!pastaId) {
    const nova = await drive('files?supportsAllDrives=true&fields=id', {
      method: 'POST',
      body: JSON.stringify({
        name: nomeFeira,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [raiz],
      }),
    }, token)
    pastaId = nova.id
  }

  await ref.set({ nome: nomeFeira, pastaId, atualizadaEm: FieldValue.serverTimestamp() }, { merge: true })
  return pastaId
}

const idDe = (texto) => String(texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sem-nome'

function protocoloNovo() {
  const d = new Date()
  const data = [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0')).join('')
  const aleatorio = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `AP-${data}-${aleatorio}`
}

function cors(req, res) {
  const origem = req.headers.origin
  const liberada = !ORIGENS_LIBERADAS.length || ORIGENS_LIBERADAS.includes(origem)
  res.set('Access-Control-Allow-Origin', liberada && origem ? origem : '*')
  res.set('Vary', 'Origin')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Max-Age', '3600')
  return liberada
}

const OBRIGATORIOS = ['nome', 'email', 'feira', 'stand']

function validarPedido(corpo) {
  const c = corpo?.cadastro || {}
  for (const campo of OBRIGATORIOS) {
    if (!String(c[campo] || '').trim()) return `Cadastro incompleto: falta "${campo}".`
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) return 'E-mail inválido.'

  const a = corpo?.arquivo || {}
  if (!a.nome || !Number.isFinite(a.tamanho) || a.tamanho <= 0) return 'Dados do arquivo ausentes.'
  if (a.tamanho > TAMANHO_MAXIMO) return 'Arquivo acima do limite permitido.'
  if (a.tipo && !TIPOS_ACEITOS.has(a.tipo)) return `Tipo de arquivo não aceito: ${a.tipo}.`

  // A trava do negócio, repetida no servidor: a interface já bloqueia, mas
  // quem chama a API direto não pode contornar a regra.
  if (corpo.veredicto === 'reprovado') return 'Arte reprovada não pode ser enviada.'
  if (corpo.veredicto === 'ressalva' && !corpo.riscoAceito) {
    return 'Arte com ressalva exige o aceite de risco antes do envio.'
  }
  if (!['aprovado', 'ressalva'].includes(corpo.veredicto)) return 'Veredicto inválido.'
  return null
}

exports.envio = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [TOKEN_EVENTO, DRIVE_PASTA_RAIZ, SERVICE_ACCOUNT_JSON,
      OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REFRESH_TOKEN],
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async (req, res) => {
    const origemLiberada = cors(req, res)
    if (req.method === 'OPTIONS') return res.status(204).send('')
    if (!origemLiberada) return res.status(403).json({ erro: 'Origem não autorizada.' })
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' })

    const esperado = TOKEN_EVENTO.value()
    if (esperado && req.body?.tokenEvento !== esperado) {
      return res.status(401).json({ erro: 'Link do evento inválido ou expirado.' })
    }

    const rota = (req.path || '').replace(/\/+$/, '')
    try {
      if (rota.endsWith('/sessao')) return await abrirSessao(req, res)
      if (rota.endsWith('/concluir')) return await concluir(req, res)
      return res.status(404).json({ erro: 'Rota desconhecida.' })
    } catch (e) {
      console.error('falha no envio', e)
      return res.status(500).json({ erro: 'Falha ao preparar o envio. Tente novamente em instantes.' })
    }
  },
)

async function abrirSessao(req, res) {
  const problema = validarPedido(req.body)
  if (problema) return res.status(400).json({ erro: problema })

  const { cadastro, arquivo, peca, perfil, veredicto, riscoAceito, laudo } = req.body
  const feiraId = idDe(cadastro.feira)
  const protocolo = protocoloNovo()

  const token = await tokenDoDrive()
  const pastaId = await pastaDaFeira(token, DRIVE_PASTA_RAIZ.value(), feiraId, cadastro.feira.trim())

  const extensao = (arquivo.nome.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
  const nomeArquivo = [
    idDe(cadastro.stand),
    idDe(perfil?.nome || 'peca'),
    protocolo,
  ].join('__') + extensao

  // Sessão retomável: devolvemos ao navegador a URL para onde ele manda os
  // bytes. Essa URL já carrega a autorização, então o cliente não precisa de
  // credencial nenhuma.
  const resposta = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        ...cabecalhos(token),
        'X-Upload-Content-Type': arquivo.tipo || 'application/octet-stream',
        'X-Upload-Content-Length': String(arquivo.tamanho),
      },
      body: JSON.stringify({
        name: nomeArquivo,
        parents: [pastaId],
        description: [
          `Protocolo: ${protocolo}`,
          `Expositor: ${cadastro.nome} <${cadastro.email}>`,
          `Stand: ${cadastro.stand}${cadastro.localizacao ? ` — ${cadastro.localizacao}` : ''}`,
          `Peça: ${perfil?.nome} ${peca?.larguraCm} × ${peca?.alturaCm} cm`,
          `Resultado: ${veredicto}${riscoAceito ? ' (risco aceito pelo cliente)' : ''}`,
        ].join('\n'),
      }),
    },
  )
  if (!resposta.ok) {
    throw new Error(`Sessão de upload recusada ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`)
  }
  const urlSessao = resposta.headers.get('Location')
  if (!urlSessao) throw new Error('O Google não devolveu a URL da sessão de upload.')

  await bd.collection('envios').doc(protocolo).set({
    protocolo,
    status: 'pendente',
    feiraId,
    feira: cadastro.feira.trim(),
    cadastro,
    peca,
    perfil,
    veredicto,
    riscoAceito: riscoAceito || null,
    laudo: laudo || null,
    arquivo: { nome: arquivo.nome, tamanho: arquivo.tamanho, tipo: arquivo.tipo, sha256: arquivo.sha256 || null },
    nomeNoDrive: nomeArquivo,
    criadoEm: FieldValue.serverTimestamp(),
  })

  return res.json({ protocolo, urlSessao, nomeArquivo })
}

async function concluir(req, res) {
  const { protocolo, idArquivoDrive } = req.body || {}
  if (!protocolo) return res.status(400).json({ erro: 'Protocolo ausente.' })

  const ref = bd.collection('envios').doc(protocolo)
  const doc = await ref.get()
  if (!doc.exists) return res.status(404).json({ erro: 'Protocolo não encontrado.' })
  if (doc.data().status === 'concluido') {
    return res.json({ link: doc.data().link || null, nome: doc.data().nomeNoDrive })
  }

  let link = null
  if (idArquivoDrive) {
    try {
      const token = await tokenDoDrive()
      const info = await drive(
        `files/${idArquivoDrive}?fields=webViewLink&supportsAllDrives=true`,
        { method: 'GET' }, token,
      )
      link = info.webViewLink || null
    } catch (e) {
      // O arquivo já subiu; não ter o link não é motivo para falhar o envio.
      console.warn('não foi possível ler o link do arquivo', e)
    }
  }

  await ref.set({
    status: 'concluido',
    idArquivoDrive: idArquivoDrive || null,
    link,
    concluidoEm: FieldValue.serverTimestamp(),
  }, { merge: true })

  const dados = doc.data()
  await bd.collection('feiras').doc(dados.feiraId).set({
    nome: dados.feira,
    totalEnvios: FieldValue.increment(1),
    atualizadaEm: FieldValue.serverTimestamp(),
  }, { merge: true })

  return res.json({ link, nome: dados.nomeNoDrive })
}
