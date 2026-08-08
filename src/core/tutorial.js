// O que o cliente precisa saber antes de mandar a primeira arte.
//
// Isto é conteúdo, não interface — e mora aqui, longe da tela, por um motivo
// prático: os números que o tutorial promete são os mesmos que o motor cobra.
// Escritos à mão no meio do JSX, eles envelheceriam na primeira mudança de
// política, e o cliente passaria a ler uma instrução que a ferramenta não
// cumpre mais. Foi exatamente o que aconteceu com o piso de dpi: mudou de 150
// para 100 e todo texto solto por aí continuou dizendo 150.
//
// Daí os requisitos serem CALCULADOS a partir de `regras.js`.

import { DPI_PISO_ABSOLUTO, DPI_MINIMO_GLOBAL, SANGRIA_MINIMA_MM } from './regras.js'

/** Horário de atendimento humano. Um lugar só: aparece no tutorial e no chat. */
export const SUPORTE = {
  dias: 'segunda a sexta',
  inicio: '08:00',
  fim: '18:00',
  get texto() { return `${this.dias}, das ${this.inicio} às ${this.fim}` },
}

/**
 * O caminho da arte, do jeito que ele realmente acontece.
 *
 * Sem prometer etapa que não existe: não há "análise do time" antes da prova,
 * e a aprovação final é do cliente, não nossa. Um passo a passo que descreve
 * um fluxo idealizado gera mais ligação do que resolve.
 */
export const PASSOS = [
  {
    titulo: 'Confira a lista de peças',
    texto: 'Cada peça do seu stand já está aqui com a medida certa, tirada do projeto. Você não precisa informar tamanho nenhum — e é justamente por isso que a conferência é confiável.',
  },
  {
    titulo: 'Baixe o gabarito antes de desenhar',
    texto: 'O botão fica ao lado de cada peça. Ele traz o tamanho final, a sangria e a margem de segurança — a área que não pode ter texto nem logo porque some na dobra ou atrás da estrutura.',
  },
  {
    titulo: 'Envie a arte e veja o resultado na hora',
    texto: 'A conferência roda no seu próprio navegador: o arquivo só sai do seu computador quando você clica em enviar. Em segundos você recebe aprovado, aprovado com ressalva ou reprovado, com o que exatamente precisa mudar.',
  },
  {
    titulo: 'Se vier com ressalva, a decisão é sua',
    texto: 'Ressalva quer dizer que imprime, mas com perda perceptível. Você lê o que vai acontecer e decide: ou manda um arquivo melhor, ou assume e autoriza — com nome e e-mail, porque este link circula entre várias pessoas e o registro precisa dizer quem autorizou.',
  },
  {
    titulo: 'Aprovado aqui não é a palavra final',
    texto: 'A conferência desta tela é a primeira camada: ela mede o que dá para medir no arquivo — resolução, tamanho, sangria, formato. O que ela não enxerga é o conteúdo. Quando a arte chega ao time de comunicação visual, pode ser que eles achem algo que só olho humano pega: logo numa versão antiga, telefone desatualizado, cor fora da sua identidade, arquivo trocado com o de outra peça. Aí eles recusam e devolvem a arte, com o motivo escrito aqui mesmo, e você manda a versão corrigida no mesmo lugar.',
  },
  {
    titulo: 'Aprove a prova antes de imprimir',
    texto: 'Com a arte recebida, o time monta a prova de aprovação e ela aparece nesta mesma tela. Você aprova tudo, reprova tudo ou aprova em partes. Nada vai para a impressora sem esse aceite.',
  },
  {
    titulo: 'Acompanhe até ficar pronta',
    texto: 'Depois de aprovada a peça passa a "em impressão" e depois "impressa", aqui mesmo. Trocar a arte depois que entrou em produção significa reimprimir, e aí há custo extra — por isso a prova existe.',
  },
]

/** Os requisitos, com os números que o motor de fato aplica. */
export const REQUISITOS = [
  {
    titulo: 'Resolução',
    texto: `Mínimo de ${DPI_PISO_ABSOLUTO} dpi no tamanho final impresso. O padrão de qualidade é ${DPI_MINIMO_GLOBAL} dpi — entre um e outro a arte passa, mas com ressalva.`,
  },
  {
    titulo: 'Formato do arquivo',
    texto: 'PDF, JPG ou PNG. PDF é o melhor caminho no grande formato, porque preserva o vetor e o texto. Arquivo aberto de editor (.cdr, .psd, .indd) e TIFF não são lidos.',
  },
  {
    titulo: 'Sangria',
    texto: `Área de arte além do corte, para o acabamento não deixar filete branco: ${SANGRIA_MINIMA_MM / 10} cm por lado na maioria das peças, 5 cm em adesivo. O gabarito de cada peça já vem com a medida certa — siga por ele.`,
  },
  {
    titulo: 'Escala',
    texto: 'Montar a arte reduzida (1:2, 1:10) é praxe e está liberado. Só informe a escala na hora de enviar, senão um arquivo correto é reprovado por engano.',
  },
  {
    titulo: 'Cor',
    texto: 'Trabalhe em CMYK quando puder. Cor viva de tela (RGB) muda na impressão, e o desvio maior aparece justamente em azul forte e verde.',
  },
]
