import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKeyPart, clientKeyFor, ACENTOS_DE_REFERENCIA } from '../src/core/chaveCliente.js'

// Teste de PARIDADE com o app de montagem.
//
// A tabela `CASOS` abaixo é cópia verbatim de `tools/client_key_parity.test.js`
// do repositório `pendencias-cas-2026`, que por sua vez espelha
// `test/client_key_test.dart` de lá. Os três arquivos precisam concordar:
// mudar um sem os outros é o começo da divergência.
//
// E a divergência aqui NÃO dá erro. Se um lado produzir `mdulos` e o outro
// `modulos`, a ponte simplesmente não encontra nada — o expositor fica sem
// print e ninguém sabe por quê. É exatamente o modo de falha que os tópicos
// FCM daquele app já sofreram antes de existir teste assim.

const CASOS = [
  // [fairName, nome, chave esperada]
  ['ABAV', 'JadLog', 'abav__jadlog'],
  ['ABAV', 'JADLOG', 'abav__jadlog'],
  ['ABAV', ' jadlog ', 'abav__jadlog'],
  // Acento CONVERTIDO, nunca apagado. Este é o caso que separa uma
  // implementação correta de uma que parece correta.
  ['CAS 2026 Módulos', 'Comunicação', 'cas_2026_modulos__comunicacao'],
  ['Conferencia Luxo — ECBR', 'J&T', 'conferencia_luxo_ecbr__j_t'],
  ['São Paulo', 'Açaí & Cia', 'sao_paulo__acai_cia'],
  // Pontuação seguida vira um "_" só, e não sobra nas pontas.
  ['  ABAV  ', '-- Selia --', 'abav__selia'],
  ['ABAV', 'Tray  Commerce', 'abav__tray_commerce'],
  // Sem uma das partes não há chave: meia chave ligaria coisas sem relação.
  ['', 'JadLog', ''],
  ['ABAV', '', ''],
  ['ABAV', '   ', ''],
  ['ABAV', '###', ''],
]

test('normalizeKeyPart converte acento em vez de apagar', () => {
  assert.equal(normalizeKeyPart('Módulos'), 'modulos')
  assert.equal(normalizeKeyPart('Comunicação'), 'comunicacao')
  assert.equal(normalizeKeyPart('São Paulo'), 'sao_paulo')
})

test('normalizeKeyPart não deixa "_" nas pontas nem repetido', () => {
  assert.equal(normalizeKeyPart('-- Selia --'), 'selia')
  assert.equal(normalizeKeyPart('A  &&  B'), 'a_b')
})

test('clientKeyFor bate com os casos de referência do app', () => {
  for (const [feira, nome, esperado] of CASOS) {
    assert.equal(clientKeyFor(feira, nome), esperado,
      `clientKeyFor(${JSON.stringify(feira)}, ${JSON.stringify(nome)})`)
  }
})

test('o separador nunca fica ambíguo', () => {
  // Nenhuma parte normalizada contém "__", então "feira_a" + "b" não pode
  // colidir com "feira" + "a_b".
  assert.notEqual(clientKeyFor('feira a', 'b'), clientKeyFor('feira', 'a b'))
})

test('a tabela de acentos é a mesma do app, caractere a caractere', () => {
  // Um acento a menos de um lado é uma chave diferente para o expositor que o
  // usa — e só para ele. O tipo de defeito que aparece num cliente só, meses
  // depois, e parece coisa daquele cliente.
  const esperada = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
    'é': 'e', 'ê': 'e', 'è': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c', 'ñ': 'n',
  }
  assert.deepEqual(ACENTOS_DE_REFERENCIA, esperada)
})

test('o hífen longo do nome da feira não sobrevive à normalização', () => {
  // "Conferencia Luxo — ECBR" é digitado com travessão na planilha, e ele não é
  // ASCII. Se um lado o tratasse como letra, a feira inteira teria chave
  // diferente — e foi justamente essa feira que expôs o defeito posicional.
  assert.equal(normalizeKeyPart('Conferencia Luxo — ECBR'), 'conferencia_luxo_ecbr')
})
