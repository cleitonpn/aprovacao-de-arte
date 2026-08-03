# Aprovação de Arte

Ferramenta de análise automática de arte para impressão em grande formato
(stands e eventos). O cliente sobe o arquivo, informa a peça, e recebe na
hora um veredicto com **o que exatamente pedir ao designer**.

A **análise roda 100% no navegador** — o arquivo não sai da máquina do cliente
enquanto ele não decidir enviar. Isso elimina custo por análise e resolve a
conversa sobre confidencialidade de arte não divulgada antes do evento.

Quando a arte passa, um botão envia o arquivo para o Firebase Storage — **sem
o expositor precisar de login** — e o time baixa tudo por feira num painel
próprio. Ver [SETUP.md](SETUP.md).

```bash
npm install
npm run dev       # desenvolvimento
npm test          # testes das regras e da calibração
npm run build     # build de produção (dist/)
```

## Fluxo completo

1. **Cadastro** na entrada: nome, e-mail, feira, stand e localização
   (opcional). Fica salvo — quem volta para a segunda peça entra direto.
2. **Peça**: tipo, medidas e escala de trabalho. A ferramenta já mostra o que
   pedir ao designer e gera o gabarito.
3. **Arte**: análise em segundos, com veredicto e ações prescritivas.
4. **Envio**: só é liberado se a arte foi **aprovada**, ou se foi *aprovada
   com ressalva* **e** o cliente aceitou o risco explicitamente. Arte
   reprovada nunca sobe. A trava está na interface e repetida no servidor,
   para quem chamar a API direto não conseguir contorná-la.
5. **Painel do time** (`#/admin`): seleciona a feira, lista quem já enviou e
   baixa as artes — uma a uma ou todas de uma vez, além de exportar a
   planilha do que chegou.

## O problema que ela resolve

O gargalo não é avaliar a arte — o time de comunicação visual faz isso em
cinco minutos. O gargalo é o ciclo:

```
cliente envia → CV avalia → e-mail "está em baixa qualidade" →
cliente repassa ao designer → designer não sabe o que faltou →
refaz no chute → reenvia → recusa de novo → ...
```

Cada volta custa dias porque envolve três pessoas e uma mensagem vaga. Então
a ferramenta ataca quatro frentes, nesta ordem de impacto:

| | O que resolve |
|---|---|
| **Prescritiva** | Não diz "baixa qualidade"; diz *"precisa de 5.906 × 2.953 px, você mandou 3.543 × 1.772 — cerca de 1,7× mais"* |
| **Preventiva** | Gera o **gabarito** da peça (medida, sangria, área segura) para mandar ao designer **antes** de ele desenhar |
| **Self-service** | O cliente valida sozinho, antes de enviar |
| **Instantânea** | Segundos, não dias |

## Como o veredicto funciona

**Três níveis, não dois.** A faixa amarela é o que torna a ferramenta usável
na operação: sem ela, um caso limítrofe vira uma volta desnecessária no ciclo.

- 🟢 **Aprovada** — segue para impressão
- 🟡 **Aprovada com ressalva** — imprime, com perda descrita. O cliente pode
  clicar em *"aceito o risco"*, e a decisão fica registrada com data e hash
  SHA-256 do arquivo. Quando alguém reclamar do resultado impresso, existe a
  prova de qual arquivo exato foi aprovado e por quem.
- 🔴 **Reprovada** — não imprime sem ajuste, com o número exato a corrigir

O veredicto é sempre o pior achado. Toda regra é determinística e auditável:
nada aqui é "o modelo achou que está ruim", porque isso é indefensável numa
negociação com o cliente.

## Política da empresa (pisos globais)

Dois pisos valem para **toda** peça, e o perfil de cada tipo de peça só pode
ser mais exigente que eles — nunca menos. Ambos editáveis no modo técnico.

| Piso | Valor | Efeito |
|---|---|---|
| **DPI mínimo** | 150 dpi | Nenhuma arte é aprovada abaixo disso |
| **Sangria mínima** | 100 mm por lado | Toda peça pede 10 cm de sangria de cada lado |

Com a sangria de 10 cm, uma lona de 2,00 × 2,90 m é entregue como arquivo de
**2,20 × 3,10 m**. Duas consequências que o código já trata:

- a checagem de proporção aceita **tanto o tamanho de corte quanto o tamanho
  com sangria** — 200 × 290 dá proporção 0,690 e 220 × 310 dá 0,710, uma
  diferença de 3%. Comparar só com o tamanho de corte reprovaria justamente o
  arquivo montado do jeito certo;
- o gabarito, a mensagem para o designer e a resolução exigida já saem
  calculados sobre o tamanho **com** sangria.

> ⚠️ **Peças pequenas.** O piso de 10 cm vale para todas: um adesivo de balcão
> de 10 × 5 cm passaria a exigir arquivo de 30 × 25 cm. Se isso não for a
> intenção da operação, baixe a sangria mínima no painel e deixe cada perfil
> com o valor adequado — a tabela por tipo de peça continua valendo para
> qualquer valor acima do piso.

## Critério de resolução

**Piso: 150 dpi.** O balcão continua exigindo 300 dpi como *ideal*, porque o
perfil pode ser mais exigente que o piso.

O que a ferramenta mede é o **DPI efetivo no tamanho impresso**:

```
dpi = pixels ÷ (centímetros ÷ 2,54)
```

O DPI gravado nos metadados do arquivo é ignorado de propósito — ele é
facilmente forjado e não diz nada sobre o resultado impresso.

### Escala de trabalho

Montar a arte reduzida (1:2, 1:4, 1:10) é praxe no grande formato. O campo de
escala existe porque ignorá-lo é a causa nº 1 de reprovação indevida. Ele
afeta a leitura do tamanho declarado em PDF e a resolução das imagens
embutidas; para um raster solto, o que vale são os pixels contra o tamanho
final da peça.

> ⚠️ **Ponto a definir com a operação.** Com o piso em 150 dpi medidos no
> tamanho final, uma lona de 2,00 × 2,90 m exige 11.812 × 17.126 px (~200
> megapixels), o que é impraticável para a maioria dos clientes. As duas
> saídas usuais: (a) trabalhar essas peças em escala 1:10, onde 150 dpi no
> arquivo é perfeitamente viável; ou (b) baixar o piso para peças grandes no
> painel de regras. A ferramenta suporta as duas — a escolha é da operação.

## O que é verificado

**Sempre**
- DPI efetivo no tamanho impresso, contra o piso e contra o ideal da peça
- Proporção da arte × proporção da peça, com o **% que seria cortado**
- Formato real do arquivo, lido da assinatura binária (não da extensão)

**Raster (JPG/PNG)**
- Qualidade JPEG estimada pela tabela de quantização e índice de blocagem 8×8
- Modo de cor (CMYK/RGB), perfil ICC embutido, canal alfa
- Densidade declarada (JFIF/pHYs) — usada só para sugerir a escala provável
- Conteúdo gráfico na faixa da margem de segurança

**PDF / AI** (`.ai` quase sempre é PDF por dentro)
- Vetor puro → sem restrição de resolução
- Resolução real de **cada imagem embutida**, no tamanho em que foi colocada
  na página (rastreando a matriz de transformação)
- Tamanho da página × escala contra a medida da peça
- Texto vivo, fontes não incorporadas, transparências, nº de páginas

**O que ela não faz** — e é importante não prometer:
julgar se a arte está bonita, se a cor da marca está certa, se o logo é a
versão atual, ou se há erro de digitação. Isso continua sendo olho humano. A
ferramenta tira do time o trabalho de *medir*; o de *julgar* continua com ele.

## Detector de nitidez real (experimental, ligado)

Existe um módulo de análise espectral (`src/core/espectro.js`) que tenta
responder a uma pergunta valiosa: **o arquivo carrega detalhe real na
resolução que declara?** É o caso clássico do cliente que amplia um JPG de
800 px para 4.000 px no editor — o arquivo *diz* 300 dpi e imprime como papa.
Nenhuma leitura de metadado pega isso; só olhar o conteúdo pega.

O método: imagens naturais têm espectro de potência que segue uma lei de
potência da baixa frequência até a Nyquist. Uma imagem ampliada segue a lei
até a Nyquist do arquivo *original* e depois desaba num patamar de ruído. Um
ajuste em dois segmentos localiza esse joelho.

**Ligado por decisão da operação**, e desligável no painel de regras. Em imagens sintéticas de
laboratório ele separa bem (ver `test/calibracao.test.mjs`), mas nos testes
com conteúdo real ele ainda oscila: em parte das ampliações o ajuste degenera
e a evidência some. Limitações já medidas e registradas como teste:

- grão ou ruído aplicado **depois** da ampliação repõe energia no topo e
  apaga a assinatura;
- ampliações extremas (8× ou mais) degeneram o ajuste — na prática isso não
  custa nada, porque um arquivo assim é barrado pelo cálculo de DPI, que é
  aritmética simples e não erra.

O achado é sempre **ressalva** — ele nunca reprova uma arte sozinho. E o
classificador é conservador: na dúvida, cala. Na prática isso significa que
ele deixa passar mais casos do que acusa, que é o erro barato dos dois.

Os números aparecem no painel técnico independentemente do detector estar
ligado, porque são o material bruto para calibrá-lo.

### Como calibrar antes de ligar

1. Junte o acervo real: artes **já aprovadas** e **já recusadas** pelo time.
2. Rode cada uma na ferramenta com o modo técnico ligado e anote a **queda
   espectral em dB** e o **ganho do ajuste**.
3. Se as duas populações se separarem, ajuste `GANHO_MIN` e `QUEDA_MIN_DB`
   em `src/core/espectro.js` para o ponto que **não gera falso positivo**.
4. Só então ligue o detector no painel de regras.

A regra que governa a calibração: **na dúvida, ficar calado.** Deixar passar
um caso difícil custa pouco — o cálculo de DPI pega a maioria deles. Acusar
arte boa de ampliada destrói a confiança do time e do cliente na ferramenta
inteira, e devolve a operação ao ciclo de e-mails.

## Estrutura

```
src/
  core/
    analise.js     Orquestrador: lê o arquivo, mede, aplica as regras
    regras.js      Motor de regras → achados e veredicto (funções puras)
    arquivo.js     Assinatura binária, metadados JPEG/PNG, SHA-256
    imagem.js      Decodificação, amostra reduzida, recortes em px nativo
    metricas.js    Nitidez, blocagem, máscara de detalhe, bordas
    espectro.js    FFT + espectro radial + detector de nitidez real
    pdf.js         Inspeção de PDF/AI via pdf.js
    mensagem.js    Texto para o designer e laudo JSON
  data/
    perfis.js      Tipos de peça, limiares, escalas (editável e persistido)
    cadastro.js    Cadastro do expositor e validação
  services/envio.js   Upload retomável em pedaços, direto para o Google
  store/historico.js  Histórico local das análises
  components/      Interface (inclui Cadastro, Envio e Admin)
  config.js        Variáveis de ambiente (nada secreto aqui)
functions/         Cloud Function que assina o upload no Drive
firestore.rules    Leitura só para admins; escrita só pela função
test/              Testes das regras, da calibração e das travas de envio
```

Detalhe de implementação que não é óbvio: a análise espectral roda sobre
**recortes em resolução nativa**, escolhidos nas regiões de maior detalhe.
Reduzir a imagem antes de medir destruiria exatamente a evidência procurada,
e medir região chapada não diz nada — é por isso que existe a máscara de
detalhe em `metricas.js`.

## Envio e painel

Ver **[SETUP.md](SETUP.md)** — são 4 passos no Firebase Console, sem terminal
e sem credencial nenhuma para gerar. Em resumo:

- **Arquivo no Storage, registro no Firestore**, gravados direto do navegador.
  Sem servidor próprio no meio.
- **Cliente sem login.** Uma sessão anônima do Firebase, criada sem nenhuma
  tela, autoriza a gravação. O expositor não percebe que ela existe.
- **A regra de negócio é lei no servidor.** A trava do veredicto está na
  interface *e* repetida em `firestore.rules`: arte reprovada não entra, e
  arte com ressalva só entra com o aceite de risco junto. Interface se
  contorna; regra do Firestore não.
- **Envio é só criação.** Nenhum expositor sobrescreve o envio de outro nem
  adultera o próprio depois de feito. Leitura, só para quem consta em
  `admins`.
- **Storage sem leitura direta.** O painel usa o link tokenizado gerado no
  envio, então ninguém varre o armazenamento atrás de arte alheia.

Alternativa considerada e descartada por ora: guardar no Google Drive sairia
de graça, mas exigia consentimento OAuth, cliente OAuth, refresh token e conta
de serviço. Essa versão está no histórico do repositório.

## Fase 3 — quando fizer sentido

- **Backend** com Ghostscript/ImageMagick: abrir `.cdr`, `.eps`, TIFF CMYK e
  fazer conversão de perfil ICC de verdade. Hoje `.cdr` recebe uma instrução
  clara de exportar PDF, que é o que a gráfica quer receber de qualquer jeito.
- **Integração com o configurador de stand**: o projeto
  `personalize-stand-forum-` já conhece a dimensão real de cada parede, então
  a especificação de cada peça sai automática, sem ninguém digitar medida.
- **Modo sombra**: por 30 dias, a ferramenta analisa e o time avalia como
  sempre; comparar os dois calibra os limiares com a realidade da operação.

## Métricas que dizem se funcionou

% de aprovação de primeira · tempo médio do ciclo · nº de voltas por arte ·
reprovações por motivo (esta última diz exatamente o que corrigir no
briefing comercial).
