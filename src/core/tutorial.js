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

import { DPI_MINIMO_GLOBAL, SANGRIA_MINIMA_MM } from './regras.js'

/**
 * Para onde escrever quando a ferramenta não resolve.
 *
 * Num lugar só porque aparece em telas de dois públicos diferentes — o rodapé
 * do login, que é do time, e o texto de ajuda, que é do cliente. Endereço de
 * suporte escrito à mão em duas telas é o que faz uma delas continuar
 * apontando para a caixa de quem saiu da empresa.
 */
export const SUPORTE_EMAIL = 'cleitonpnascimento@gmail.com'

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
    titulo: 'Teste a arte quantas vezes quiser',
    texto: 'A conferência roda no seu próprio navegador: o arquivo só sai do seu computador quando você clica em enviar. Enquanto a arte não passa, nada chega ao time e nada conta como entrega — então testar não custa nada e não atrapalha ninguém. Em segundos você vê o que precisa mudar, com um texto pronto para mandar a quem montou a arte.',
  },
  {
    titulo: 'Se vier com ressalva, a decisão é sua',
    texto: 'Ressalva quer dizer que imprime, mas com perda perceptível. Você lê o que vai acontecer e decide: ou manda um arquivo melhor, ou assume e autoriza — com nome e e-mail, porque este link circula entre várias pessoas e o registro precisa dizer quem autorizou.',
  },
  {
    titulo: 'Aprovado aqui não é a palavra final',
    texto: 'A conferência desta tela é a primeira camada. Depois dela, o time de comunicação visual recebe o arquivo e faz uma segunda análise, agora técnica: se o arquivo abre e fecha na produção, se a arte se sustenta na medida real da peça, se algum elemento cai na dobra ou atrás da estrutura, se a cor tem como sair na impressão. Se algo ali não fechar, eles devolvem a arte com o motivo escrito nesta mesma tela, e você envia a versão corrigida no mesmo lugar. Essa segunda análise é técnica e só técnica — o conteúdo continua sendo seu.',
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

/**
 * O que a segunda análise cobre — e o que ela não cobre.
 *
 * Esta lista existe para evitar uma expectativa cara: o cliente que entende
 * "o time confere a arte" como "o time revisa a arte" manda o material sem
 * reler, o telefone errado é impresso em 40 stands, e a conversa sobre quem
 * paga a reimpressão acontece com a peça já na parede.
 *
 * A fronteira não é arbitrária, e o motivo dela precisa aparecer junto: o time
 * de comunicação visual passa por centenas de peças por feira. Nesse volume dá
 * para conferir o que é técnico e verificável na peça; não dá para revisar o
 * texto de cada expositor, nem haveria como — ninguém aqui sabe qual é o
 * telefone certo da empresa do cliente.
 */
export const CONFERENCIA_DO_TIME = {
  confere: [
    'Se o arquivo abre e processa na produção — fontes, transparências, camadas.',
    'Se a resolução se sustenta no tamanho real da peça montada.',
    'Se algum elemento importante cai na dobra, no corte ou atrás da estrutura.',
    'Se a cor tem como sair na impressão, e o que muda se não tiver.',
    'Se o arquivo enviado é mesmo o daquela peça, e não o de outra.',
  ],
  naoConfere: [
    'Ortografia, gramática e redação.',
    'Telefone, e-mail, site, endereço, CNPJ e QR code.',
    'Preços, nomes de produto, datas e qualquer informação do seu negócio.',
    'Se o logo enviado é a versão vigente da sua marca.',
  ],
  porque: 'São centenas de peças por feira. Nesse volume dá para conferir o que é técnico e verificável na peça — não dá para revisar o conteúdo de cada arte, e não teríamos como saber qual informação está certa.',
  responsabilidade: 'Confira o texto antes de enviar. Depois de impresso, corrigir significa refazer a peça.',
}

/** Os requisitos, com os números que o motor de fato aplica. */
export const REQUISITOS = [
  {
    titulo: 'Resolução',
    // Sem número único aqui, e é o comentário do topo deste arquivo em ação:
    // o piso deixou de ser um valor fixo e passou a sair da distância em que a
    // peça é vista (`pisoPorDistancia`, em `regras.js`). Repetir "100 dpi"
    // faria o cliente achar que uma parede de 82 dpi reprova — e ela passa.
    texto: `Não existe um número único: o mínimo sai da distância de onde a peça é vista. Uma parede olhada a 2,5 m aceita bem menos densidade que um adesivo de balcão a meio metro, e o cartão de cada peça mostra o mínimo dela já convertido em pixels. O padrão de qualidade da casa é ${DPI_MINIMO_GLOBAL} dpi no tamanho final; entre o mínimo daquela peça e esse padrão a arte passa, com ressalva.`,
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
    // Este texto mandava o cliente fazer o que a ferramenta passou a fazer
    // sozinha. Ele custou dez reprovações seguidas a um expositor cuja arte
    // estava certa, em 1:10, e que não sabia que existia um campo para trocar.
    texto: 'Montar a arte reduzida (1:2, 1:10) é praxe e está liberado. A ferramenta reconhece a escala sozinha, pelo tamanho do arquivo, e diz na tela o que reconheceu — o campo de escala existe só para o caso raro em que ela não tem como adivinhar.',
  },
  {
    titulo: 'Cor',
    texto: 'Trabalhe em CMYK quando puder. Cor viva de tela (RGB) muda na impressão, e o desvio maior aparece justamente em azul forte e verde.',
  },
]
