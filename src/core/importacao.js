// Importação da planilha de projetos.
//
// O cadastro peça a peça só se paga na primeira feira. Um evento com 30 stands
// e 4 peças cada são 120 linhas para digitar — e a planilha com isso já existe
// na operação. Este módulo é o que transforma "eu tenho em planilha" em
// projetos cadastrados, e é a diferença entre a ferramenta ser usada na segunda
// feira ou ser abandonada.
//
// Três decisões que valem ser explicadas:
//
// 1. Nada é rejeitado em bloco. Uma linha com defeito não invalida a planilha:
//    o que dá para importar é importado, e o que não deu volta como erro com o
//    número da linha. Planilha real sempre tem uma linha torta.
// 2. Os dois formatos que a operação usa de verdade são aceitos — uma linha
//    por peça (recomendado) e uma linha por stand com colunas "Arte A",
//    "Arte B" (que é como as planilhas de produção costumam nascer).
// 3. Não adivinhamos unidade. "10 x 10" tanto pode ser adesivo de 10 cm quanto
//    lona de 10 m; chutar aqui recriaria o erro silencioso que o cadastro veio
//    eliminar. Vira aviso para conferência humana.

import {
  chave, interpretarMedida, interpretarEscala, perfilPorTexto,
  projetoNovo, pecaNova, EMAIL, MAXIMO_PECAS,
} from '../data/projeto.js'

// ------------------------------------------------------------------ leitura

const SEPARADORES = [';', '\t', ',']

/** Divide o texto em células respeitando aspas, campos com quebra de linha e "" escapado. */
export function separarCsv(texto, sep) {
  const linhas = []
  let linha = []
  let campo = ''
  let aspas = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else { aspas = false }
      } else campo += c
      continue
    }
    if (c === '"') aspas = true
    else if (c === sep) { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha) }

  return linhas.map((l) => l.map((c) => c.trim()))
}

/**
 * Descobre o separador da planilha.
 *
 * O Excel em português salva CSV com ponto e vírgula, justamente porque a
 * vírgula é o separador decimal aqui — testar só a vírgula partiria "2,75" ao
 * meio. Escolhemos o separador que produz mais colunas com largura consistente.
 */
export function detectarSeparador(texto) {
  const amostra = texto.split('\n').slice(0, 20).join('\n')
  let melhor = { sep: ';', nota: -1 }
  for (const sep of SEPARADORES) {
    const linhas = separarCsv(amostra, sep).filter((l) => l.some((c) => c !== ''))
    if (!linhas.length) continue
    const colunas = linhas[0].length
    if (colunas < 2) continue
    const consistentes = linhas.filter((l) => l.length === colunas).length / linhas.length
    const nota = colunas * consistentes
    if (nota > melhor.nota) melhor = { sep, nota }
  }
  return melhor.sep
}

// ------------------------------------------------------------------ colunas

const SINONIMOS = {
  feira: ['feira', 'evento', 'nome da feira', 'nome do evento', 'nome feira'],
  expositor: ['cliente', 'expositor', 'empresa', 'nome do cliente', 'razao social', 'nome'],
  // Vários endereços na mesma célula, separados por ; ou vírgula: é como a
  // planilha da operação já traz quando há mais de um decisor.
  email: ['email', 'e mail', 'emails', 'e mails', 'email do cliente',
    'email do contato', 'contato', 'emails do cliente'],
  stand: ['stand', 'estande', 'nome do stand', 'nome stand'],
  localizacao: ['localizacao', 'local', 'rua', 'endereco', 'pavilhao', 'localizacao do stand'],
  rotulo: ['peca', 'arte', 'descricao', 'item', 'nome da peca', 'nome da arte'],
  tipo: ['tipo', 'material', 'tipo de peca', 'tipo de material', 'tipo da peca'],
  largura: ['largura', 'largura cm', 'base', 'l'],
  altura: ['altura', 'altura cm', 'h', 'a'],
  medida: ['medida', 'medidas', 'tamanho', 'dimensao', 'dimensoes'],
  escala: ['escala'],
  obs: ['obs', 'observacao', 'observacoes', 'nota'],
  // Pasta do projeto no Drive — é do STAND, não da peça.
  linkDrive: ['link drive', 'drive', 'link do drive', 'link da pasta',
    'pasta do projeto', 'link projeto', 'link do projeto', 'projeto'],
  // Gabarito próprio — é da PEÇA. Pela planilha só entra como link: arquivo
  // se envia na tela, um de cada vez.
  gabarito: ['gabarito', 'link gabarito', 'link do gabarito', 'gabarito link'],
}

// "Arte A", "arte_1", "Peça 2 tipo", "arte B medida"
const RE_LARGA = /^(?:arte|peca) ?([a-z]|\d{1,2})(?: (.+))?$/

function papelDaColuna(cabecalho) {
  const c = chave(cabecalho)
  if (!c) return null

  const larga = RE_LARGA.exec(c)
  if (larga) {
    const [, indice, sufixo] = larga
    if (!sufixo) return { modo: 'larga', indice, campo: 'texto' }
    for (const [papel, nomes] of Object.entries(SINONIMOS)) {
      if (nomes.includes(sufixo)) return { modo: 'larga', indice, campo: papel }
    }
    return { modo: 'larga', indice, campo: 'texto' }
  }

  for (const [papel, nomes] of Object.entries(SINONIMOS)) {
    if (nomes.includes(c)) return { modo: 'simples', campo: papel }
  }
  return null
}

export function mapearColunas(cabecalhos) {
  const simples = {}
  const largas = new Map()
  cabecalhos.forEach((texto, i) => {
    const papel = papelDaColuna(texto)
    if (!papel) return
    if (papel.modo === 'simples') {
      if (!(papel.campo in simples)) simples[papel.campo] = i
      return
    }
    if (!largas.has(papel.indice)) largas.set(papel.indice, {})
    const alvo = largas.get(papel.indice)
    if (!(papel.campo in alvo)) alvo[papel.campo] = i
  })
  return { simples, largas, temColunasDeArte: largas.size > 0 }
}

// ------------------------------------------------------------------ peças

/**
 * Lê a descrição livre de uma peça: "Lona de parede 275x275",
 * "adesivo balcão 100 x 100 cm", "Testeira 1,5m x 0,5m".
 */
export function interpretarPeca(texto, rotuloPadrao = '') {
  const bruto = String(texto || '').trim()
  if (!bruto) return null
  const medida = interpretarMedida(bruto)
  const descricao = bruto
    .replace(/\d+(?:[.,]\d+)?\s*(?:cm|mm|m)?\s*[x×*]\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m)?/i, ' ')
    .replace(/[\s—–\-–,;:]+$/g, '')
    .replace(/^[\s—–\-–,;:]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const rotulo = descricao || rotuloPadrao
  return {
    rotulo,
    perfilId: perfilPorTexto(descricao || rotuloPadrao),
    larguraCm: medida?.larguraCm ?? 0,
    alturaCm: medida?.alturaCm ?? 0,
    unidadeInformada: medida?.unidadeInformada ?? false,
    temMedida: Boolean(medida),
  }
}

// ------------------------------------------------------------------ importar

const MEDIDA_SUSPEITA_CM = 10

/**
 * Endereço utilizável, ou string vazia.
 *
 * Duas coisas acontecem aqui, e as duas são de defesa:
 *
 * - `drive.google.com/...` sem o `https://` vira link RELATIVO no navegador,
 *   e o botão levaria o cliente para dentro da nossa própria página em vez do
 *   Drive. Como planilha quase sempre traz o endereço sem protocolo,
 *   completamos em vez de recusar;
 * - "sim", "ver com o projetista" e afins viram nada. Um botão que abre página
 *   em branco é pior que botão nenhum: o cliente só descobre no momento em que
 *   mais precisa do arquivo.
 */
export function paraUrl(texto) {
  const bruto = String(texto || '').trim()
  if (!bruto) return ''
  if (/^https?:\/\//i.test(bruto)) return bruto
  // Precisa parecer domínio: letras/números, um ponto, e nenhum espaço.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(bruto)) return `https://${bruto}`
  return ''
}

/** Gabarito vindo da planilha — sempre como link; arquivo se envia na tela. */
function gabaritoDe(texto) {
  const url = paraUrl(texto)
  return url ? { tipo: 'link', url, nome: 'Gabarito do projeto' } : null
}

function conferirMedida(peca, linha, rotulo, avisos) {
  if (peca.larguraCm < MEDIDA_SUSPEITA_CM || peca.alturaCm < MEDIDA_SUSPEITA_CM) {
    avisos.push({
      linha,
      mensagem: `"${rotulo}" ficou com ${peca.larguraCm} × ${peca.alturaCm} cm. Confira se a planilha está em centímetros — sem a unidade escrita, assumimos cm.`,
    })
  }
}

/**
 * Converte o texto da planilha em projetos prontos para cadastrar.
 *
 * @returns {{projetos: object[], erros: object[], avisos: object[], formato: string, separador: string}}
 */
export function importarProjetos(texto, opcoes = {}) {
  const limpo = String(texto || '').replace(/^﻿/, '')
  const erros = []
  const avisos = []
  if (!limpo.trim()) {
    return { projetos: [], erros: [{ linha: 0, mensagem: 'O arquivo está vazio.' }], avisos, formato: '—', separador: ';' }
  }

  const separador = opcoes.separador || detectarSeparador(limpo)
  const linhas = separarCsv(limpo, separador).filter((l) => l.some((c) => c !== ''))
  if (linhas.length < 2) {
    return {
      projetos: [],
      erros: [{ linha: 1, mensagem: 'A planilha precisa de uma linha de cabeçalho e pelo menos uma linha de dados.' }],
      avisos, formato: '—', separador,
    }
  }

  const [cabecalho, ...dados] = linhas
  const { simples, largas, temColunasDeArte } = mapearColunas(cabecalho)
  const formato = temColunasDeArte ? 'uma linha por stand' : 'uma linha por peça'

  const faltando = ['feira', 'stand'].filter((c) => !(c in simples))
  if (faltando.length) {
    return {
      projetos: [],
      erros: [{
        linha: 1,
        mensagem: `Não encontrei a coluna ${faltando.map((f) => `"${f}"`).join(' nem ')} no cabeçalho. Colunas lidas: ${cabecalho.filter(Boolean).join(', ') || '(nenhuma)'}.`,
      }],
      avisos, formato, separador,
    }
  }
  if (!temColunasDeArte && !('rotulo' in simples) && !('medida' in simples) && !('largura' in simples)) {
    return {
      projetos: [],
      erros: [{
        linha: 1,
        mensagem: 'Não encontrei as colunas das peças. Use uma coluna "peça" (com "largura" e "altura", ou "medida"), ou colunas "Arte A", "Arte B" — uma por peça.',
      }],
      avisos, formato, separador,
    }
  }

  const celula = (linha, indice) => (indice === undefined ? '' : (linha[indice] || '').trim())
  const grupos = new Map()

  dados.forEach((linha, i) => {
    const numeroLinha = i + 2 // 1 é o cabeçalho, e planilha conta a partir de 1
    const feira = celula(linha, simples.feira)
    const stand = celula(linha, simples.stand)
    const expositor = celula(linha, simples.expositor) || stand
    const email = celula(linha, simples.email).toLowerCase()

    if (!feira || !stand) {
      erros.push({ linha: numeroLinha, mensagem: 'Linha sem feira ou sem stand — ignorada.' })
      return
    }

    const id = `${chave(feira)}|${chave(stand)}`
    if (!grupos.has(id)) {
      grupos.set(id, {
        projeto: projetoNovo({
          feira,
          expositor,
          email,
          stand,
          localizacao: celula(linha, simples.localizacao),
          linkDrive: paraUrl(celula(linha, simples.linkDrive)),
        }),
        linhas: [numeroLinha],
      })
    }
    const grupo = grupos.get(id)
    const p = grupo.projeto
    if (!grupo.linhas.includes(numeroLinha)) grupo.linhas.push(numeroLinha)
    // Primeiro valor não vazio vence: é comum a planilha repetir o stand e só
    // preencher o e-mail na primeira linha.
    if (!p.email && email) p.email = email
    if (!p.localizacao) p.localizacao = celula(linha, simples.localizacao)
    if (!p.linkDrive) p.linkDrive = paraUrl(celula(linha, simples.linkDrive))
    if (!p.expositor) p.expositor = expositor
    if (email && p.email && email !== p.email) {
      avisos.push({
        linha: numeroLinha,
        mensagem: `O stand "${stand}" aparece com dois e-mails (${p.email} e ${email}). Mantive o primeiro.`,
      })
    }

    const novas = temColunasDeArte
      ? pecasDaLinhaLarga(linha, largas, celula, numeroLinha, erros)
      : pecasDaLinhaSimples(linha, simples, celula, numeroLinha, erros)

    for (const peca of novas) {
      if (p.pecas.length >= MAXIMO_PECAS) {
        erros.push({ linha: numeroLinha, mensagem: `O stand "${stand}" passou de ${MAXIMO_PECAS} peças — as demais foram ignoradas.` })
        break
      }
      conferirMedida(peca, numeroLinha, peca.rotulo, avisos)
      p.pecas.push(pecaNova(peca))
    }
  })

  const projetos = []
  for (const { projeto, linhas: linhasDoGrupo } of grupos.values()) {
    const primeira = linhasDoGrupo[0]
    if (!projeto.pecas.length) {
      erros.push({ linha: primeira, mensagem: `O stand "${projeto.stand}" ficou sem nenhuma peça válida.` })
      continue
    }
    if (!EMAIL.test(projeto.email)) {
      erros.push({
        linha: primeira,
        mensagem: `O stand "${projeto.stand}" está sem e-mail válido${projeto.email ? ` ("${projeto.email}")` : ''}. Preencha antes de cadastrar.`,
      })
    }
    projetos.push(projeto)
  }

  return { projetos, erros, avisos, formato, separador }
}

function pecasDaLinhaSimples(linha, simples, celula, numeroLinha, erros) {
  const descricao = celula(linha, simples.rotulo)
  const tipo = celula(linha, simples.tipo)
  const medidaTexto = celula(linha, simples.medida)
  const larguraTexto = celula(linha, simples.largura)
  const alturaTexto = celula(linha, simples.altura)

  if (!descricao && !tipo && !medidaTexto && !larguraTexto) return []

  const numero = (t) => {
    const n = Number(String(t).replace(/[^\d.,-]/g, '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  let larguraCm = numero(larguraTexto)
  let alturaCm = numero(alturaTexto)
  if ((!larguraCm || !alturaCm) && medidaTexto) {
    const m = interpretarMedida(medidaTexto)
    if (m) { larguraCm = m.larguraCm; alturaCm = m.alturaCm }
  }
  if (!larguraCm || !alturaCm) {
    const m = interpretarMedida(descricao)
    if (m) { larguraCm = m.larguraCm; alturaCm = m.alturaCm }
  }

  const rotulo = descricao || tipo
  if (!rotulo) {
    erros.push({ linha: numeroLinha, mensagem: 'Peça sem nome — informe a coluna "peça" ou "tipo".' })
    return []
  }
  if (!larguraCm || !alturaCm) {
    erros.push({ linha: numeroLinha, mensagem: `A peça "${rotulo}" está sem medida legível. Use "largura" e "altura", ou "medida" no formato 275x275.` })
    return []
  }

  return [{
    rotulo: rotulo.replace(/\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m)?\s*[x×*]\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m)?\s*$/i, '').trim() || rotulo,
    perfilId: perfilPorTexto(`${tipo} ${descricao}`),
    larguraCm,
    alturaCm,
    escalaFator: interpretarEscala(celula(linha, simples.escala)),
    obs: celula(linha, simples.obs),
    gabarito: gabaritoDe(celula(linha, simples.gabarito)),
  }]
}

function pecasDaLinhaLarga(linha, largas, celula, numeroLinha, erros) {
  const pecas = []
  // Ordena para "Arte A" vir antes de "Arte B" e "Arte 2" antes de "Arte 10".
  const indices = [...largas.keys()].sort((a, b) => {
    const na = Number(a); const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return String(a).localeCompare(String(b), 'pt-BR')
  })

  for (const indice of indices) {
    const cols = largas.get(indice)
    const texto = celula(linha, cols.texto)
    const tipo = celula(linha, cols.tipo)
    const medidaTexto = celula(linha, cols.medida)
    const larguraTexto = celula(linha, cols.largura)
    const alturaTexto = celula(linha, cols.altura)
    if (!texto && !tipo && !medidaTexto && !larguraTexto) continue // peça não usada neste stand

    const rotuloPadrao = `Arte ${String(indice).toUpperCase()}`
    const lida = interpretarPeca([tipo, texto].filter(Boolean).join(' '), rotuloPadrao) || {}
    let larguraCm = lida.larguraCm || 0
    let alturaCm = lida.alturaCm || 0

    if ((!larguraCm || !alturaCm) && medidaTexto) {
      const m = interpretarMedida(medidaTexto)
      if (m) { larguraCm = m.larguraCm; alturaCm = m.alturaCm }
    }
    if ((!larguraCm || !alturaCm) && larguraTexto && alturaTexto) {
      larguraCm = Number(larguraTexto.replace(',', '.')) || 0
      alturaCm = Number(alturaTexto.replace(',', '.')) || 0
    }

    if (!larguraCm || !alturaCm) {
      erros.push({
        linha: numeroLinha,
        mensagem: `"${rotuloPadrao}" (${texto || tipo}) está sem medida legível. Escreva a medida junto, no formato "Lona 275x275".`,
      })
      continue
    }

    pecas.push({
      rotulo: lida.rotulo || rotuloPadrao,
      perfilId: lida.perfilId || perfilPorTexto(tipo),
      larguraCm,
      alturaCm,
      escalaFator: interpretarEscala(celula(linha, cols.escala)),
      obs: celula(linha, cols.obs),
      gabarito: gabaritoDe(celula(linha, cols.gabarito)),
    })
  }
  return pecas
}

/** Planilha de exemplo, para o time baixar e preencher. */
export const MODELO_CSV = [
  'feira;cliente;email;stand;localizacao;link drive;peca;tipo;largura;altura;escala;gabarito',
  'Feira Exemplo 2026;Buddy Nutrition;contato@buddy.com.br;Buddy Nutrition;Rua 3, Pavilhão A;https://drive.google.com/drive/folders/EXEMPLO;Lona de fundo;lona;275;275;1:1;',
  'Feira Exemplo 2026;Buddy Nutrition;contato@buddy.com.br;Buddy Nutrition;Rua 3, Pavilhão A;https://drive.google.com/drive/folders/EXEMPLO;Adesivo do balcão;adesivo;100;100;1:1;',
  'Feira Exemplo 2026;Buddy Nutrition;contato@buddy.com.br;Buddy Nutrition;Rua 3, Pavilhão A;https://drive.google.com/drive/folders/EXEMPLO;Testeira com recorte;testeira;150;50;1:1;https://drive.google.com/file/d/EXEMPLO/view',
].join('\r\n')
