# Configuração — só telas do Firebase

Roteiro para ligar o envio de arte, o cadastro de projetos e o painel do time.
A ferramenta **já funciona sem nada disto** — a análise inteira roda no
navegador. Isto liga o botão *Enviar arte para produção*, as telas internas e o
link do cliente.

| | |
|---|---|
| Projeto Firebase | `aprovacao-de-arte-49bc3` |
| Primeiro analista | `cleitonpnascimento@gmail.com` |

**Já feito:** ✅ plano Blaze · ✅ login com Google, e-mail/senha e anônimo ·
✅ Firestore + coleção `admins` · ✅ Storage

---

> 🔁 **Se você já colou as regras antes, cole de novo.** As duas mudaram de
> novo, agora para o fluxo de aprovação: pedido de nova versão, prova de
> aprovação, prazo e status de impressão. Sem republicar, o cliente não
> consegue pedir troca de arte nem responder a uma prova, e o envio da prova
> pelo analista é recusado.

## Passo 1 — Colar as regras do Firestore

👉 https://console.firebase.google.com/project/aprovacao-de-arte-49bc3/firestore/rules

1. Apague tudo o que estiver na caixa de texto.
2. Cole o conteúdo de **[`firestore.rules`](firestore.rules)**.
3. **Publicar**.

**O que essas regras fazem** — e por que valem a colagem:

- **Repetem a trava do veredicto no servidor.** A interface já impede o clique
  em "enviar" quando a arte foi reprovada, mas interface se contorna. Estas
  regras rodam no Google: arte reprovada não entra, e arte com ressalva só
  entra se o aceite de risco estiver registrado junto.
- **Protegem a medida do projeto.** Quem tem o link do cliente consegue marcar
  uma peça como entregue e nada mais. Não consegue alterar a medida cadastrada
  — se conseguisse, a ferramenta voltaria a aprovar arte contra medida errada,
  que é o problema que o cadastro veio resolver.
- **Envio é só criação, nunca alteração.** Ninguém sobrescreve o envio de
  outro expositor, nem adultera o próprio depois de feito.
- **Um expositor não vê o de outro.** Ler a lista de projetos e de envios é só
  para quem consta em `admins`.

---

## Passo 2 — Colar as regras do Storage

👉 https://console.firebase.google.com/project/aprovacao-de-arte-49bc3/storage/rules

1. Apague tudo.
2. Cole o conteúdo de **[`storage.rules`](storage.rules)**.
3. **Publicar**.

Duas pastas com regras diferentes, de propósito:

| Pasta | O que aceita | Quem grava | Limite |
|---|---|---|---|
| `envios/` | arte de peça: JPG, PNG, PDF | o cliente | 1 GB |
| `avulsos/` | apoio: SVG, EPS/AI, ZIP + os acima | o cliente | 200 MB |
| `provas/` | prova de aprovação: JPG, PNG, WEBP, PDF | **só o time** | 30 MB |
| `gabaritos/` | gabarito próprio da peça: PDF, PNG, JPG | **só o time** | 30 MB |

Misturar as pastas obrigaria a afrouxar a regra da arte, e aí um `.zip`
passaria a ser aceito como peça para impressão. Em `provas/` o sentido se
inverte: gravar é privilégio do time — se fosse aberta, o cliente poderia subir
a própria prova de aprovação e o documento perderia o valor.

---

## Passo 3 — Publicar o site

👉 https://github.com/cleitonpn/aprovacao-de-arte/actions/workflows/deploy.yml

**Run workflow** → **Run workflow**. Em uns 2 minutos está no ar.

---

## Os endereços

| Para quem | Link |
|---|---|
| Cliente **sem** projeto cadastrado | `https://sistemastands.com/` |
| Cliente **com** projeto | gerado na tela *Projetos* — `…/#/p/TOKEN` |
| Visão geral da feira | `…/#/visao` |
| Artes recebidas | `…/#/admin` |
| Cadastro de projetos | `…/#/projetos` |
| Analistas com acesso | `…/#/analistas` |

O endereço antigo (`cleitonpn.github.io/aprovacao-de-arte/`) continua
funcionando: o GitHub redireciona para o domínio próprio, e o token do cliente
vive depois do `#`, que o navegador leva junto no redirecionamento. Os links
que a tela *Projetos* copia são montados a partir do endereço em que ela está
aberta — não há nada fixo no código para atualizar.

O domínio fica no arquivo `public/CNAME`. Ele precisa estar ali, e não só na
tela de Settings do GitHub: cada publicação substitui o site inteiro, e sem o
arquivo o domínio se perde numa delas.

---

## Avisos por e-mail

O cliente não abre o link sozinho. A prova ficava pronta e parada porque
ninguém contava a ele — quem descobria era o analista, ligando três dias
depois. Três e-mails fecham isso:

| Quando | O que o cliente recebe |
|---|---|
| O stand é cadastrado | Boas-vindas com a lista de peças e medidas, o prazo e o link |
| O analista sobe a prova | "Sua prova de impressão está pronta", com as peças que ela cobre |
| O time devolve uma arte | O motivo escrito pelo analista, e o número da próxima versão |
| Faltam 7 e 2 dias do prazo | Quantas peças faltam e a data limite |

Os três primeiros saem em segundos, porque reagem à gravação do analista. O
de prazo roda uma vez por dia, às 9h de Brasília — não há mudança nenhuma
para reagir quando o tempo passa.

O de boas-vindas substitui o e-mail que o atendimento manda à mão a cada
cadastro, com as medidas digitadas uma a uma. Ele sai **só na criação** do
stand: um projeto que já existia nunca recebe, nem quando é editado. Sem essa
trava, o primeiro dia no ar mandaria "bem-vindo, envie suas artes" para a base
inteira — incluindo quem já imprimiu.

Quem já mandou tudo **não** recebe o lembrete de prazo. Cobrar quem não deve é
como se ensina o cliente a ignorar os nossos e-mails, e aí o aviso que importa
também não é lido.

**Notificação do navegador não foi usada, de propósito.** No iPhone ela só
funciona se a pessoa instalar o site na tela de início, o que ninguém que abre
um link do WhatsApp vai fazer. E a permissão fica presa a um aparelho, enquanto
o link circula entre marketing, agência e quem assina — o aviso iria para quem
clicou "permitir", que muitas vezes não é quem decide.

### O que preparar (uma vez)

**1. Plano Blaze no Firebase.** Console → Configurações → Uso e faturamento →
Modificar plano. Cloud Functions exige cartão cadastrado; no volume desta
operação o consumo fica dentro da cota gratuita mensal. Vale colocar um
orçamento com alerta, na mesma tela.

**2. Conta no [Resend](https://resend.com).** Em **Domains**, adicione
`sistemastands.com`. Ele mostra os registros (SPF, DKIM, DMARC) para colar no
painel da Hostinger, em Domínios → DNS. **Esse passo não é opcional**: sem ele
o remetente só pode ser `onboarding@resend.dev`, que entrega apenas no seu
próprio e-mail — e para o cliente cairia em spam.

**3. Em Settings → Secrets and variables → Actions** do repositório:

| Secret | O que é |
|---|---|
| `RESEND_API_KEY` | A chave criada em **API keys** no Resend |
| `FIREBASE_SA_ARTE` | O mesmo secret que a sincronização já usa |

A conta de serviço precisa dos papéis de deploy: Cloud Functions Admin,
Service Account User, Cloud Build Editor, Artifact Registry Admin e Cloud
Scheduler Admin. Sem eles o deploy falha com "permission denied" no meio.

**4. Rode o workflow "Publicar as funções de aviso"** em Actions → Run
workflow. Ele publica e grava a chave do Resend no Secret Manager do Google —
a chave nunca fica no código nem no repositório.

O remetente é `nao-responda@sistemastands.com` e o texto diz que aquele
endereço não recebe respostas. É a verdade: não há MX na raiz do domínio, e
toda a tratativa com o cliente acontece dentro do sistema, onde fica
registrada junto com as artes do stand. Não existe caixa de entrada para
criar nem para alguém esquecer de ler.

### Se algo não chegar

Os **Logs** do Resend mostram cada envio, com o motivo de quem não recebeu.
No Firebase, em Functions → Registros, cada e-mail sai com o `envioId` que
casa com aquela tela.

Três erros valem reconhecer pelo número: **422** é domínio ainda não
verificado, **403** é chave sem permissão, **429** é a cota do dia estourada
(o plano gratuito dá 100 e-mails por dia).

O sistema grava o que já avisou em `projetos/{token}/avisos`. É isso que
impede o cliente de receber o mesmo e-mail duas vezes — e é onde olhar para
saber se um aviso saiu. Apagar um documento de lá faz o aviso ser reenviado.

## Ponte com o app de produção

A ferramenta importa feira, expositor, stand e localização do app de produção
(`montagem-uset`) em vez de redigitar. São dois projetos Firebase separados e
continuam separados: uma **ação agendada do GitHub** copia os expositores para
uma coleção só de leitura deste projeto, e a tela lê daqui.

Nenhum navegador fala com o outro projeto — nem o do cliente, nem o do
analista. A alternativa seria colocar a credencial do projeto de produção
dentro deste site.

### O que preparar (uma vez)

**1. Duas contas de serviço.** No console do Google Cloud de cada projeto,
IAM → Contas de serviço → Criar chave (JSON):

| Projeto | Permissão | Para quê |
|---|---|---|
| `montagem-uset` | leitura **e escrita** no Firestore | ler `fair_clients`, gravar `cv_status` |
| `aprovacao-de-arte-49bc3` | escrita no Firestore | gravar o espelho |

**2. Dois secrets neste repositório** (Settings → Secrets and variables →
Actions → New repository secret). Cole o **JSON inteiro**, com as chaves `{ }`:

| Secret | Conteúdo |
|---|---|
| `FIREBASE_SA_PRODUCAO` | JSON da conta de `montagem-uset` |
| `FIREBASE_SA_ARTE` | JSON da conta deste projeto |

**3. Republique as regras do Firestore** — as coleções `producao_clientes` e
`producao_estado` precisam constar. Elas são de leitura só para o time e
**ninguém escreve pelo navegador**: quem grava é a ação agendada, com conta de
serviço, que passa por cima das regras. Um dado editado à mão ali divergiria da
origem sem deixar rastro.

**4. Rode a sincronização uma vez à mão** em Actions → *Sincronizar dados da
produção* → Run workflow.

Depois disso ela roda sozinha, mas **não conte com o horário**: o agendamento
do GitHub é melhor esforço, e na medição real deu 23 minutos entre uma execução
e a seguinte e 2h23 entre as outras duas. É por isso que a tela de importação
lê **ao vivo** do app de produção, e o agendamento ficou só com dois papéis:
levar o status da arte para o app e manter o espelho como reserva.

### Como usar

`#/projetos` → **Importar da produção**. Escolha a feira, marque os stands,
preencha o e-mail de cada um (o app de produção não tem esse dado) e importe.

A lista vem **direto do app de produção**, sem esperar sincronização — a linha
de resumo diz de onde veio. Se aparecer "do espelho", o projeto da produção não
respondeu e você está vendo dados de antes; **Atualizar agora** tenta de novo.

Três coisas que a tela faz de propósito:

- **Você escolhe o que entra.** Uma feira do app tem stands sem arte nenhuma
  conosco — montagem só, ou cliente que trouxe a comunicação visual pronta.
  Importar tudo encheria o painel de stands que nunca vão receber arte, e o
  "faltam 12 artes" deixaria de significar coisa alguma.
- **Nada é sobrescrito.** Quem já existe aparece marcado e fora do alcance do
  clique. Se o stand foi cadastrado à mão antes desta ponte, ela reconhece pelo
  par feira + stand e oferece **vincular** — o que dá ao app o elo com este
  projeto sem criar duplicata.
- **Os projetos nascem sem peças.** O app não conhece as artes do stand e nunca
  vai conhecer. Cadastre as peças depois de importar; até lá o painel marca
  esses stands com **sem peças cadastradas** em vermelho, porque o link do
  cliente abriria uma lista vazia.

### O que volta para o app

A mesma ação agendada leva de volta, para os stands importados, o que o app
mostra na ficha:

- **A prova de aprovação**, que passa a ter prioridade sobre o print colado na
  planilha. São o mesmo documento com idades diferentes: o da planilha
  envelhece na primeira arte corrigida. A planilha continua valendo como
  reserva, para o stand que ainda não foi importado.
- **O status da arte**: aguardando cliente, em análise na CV, aprovada, em
  impressão ou impressa, com o contador ("3 de 5 artes").

O status é sempre o estado **mais atrasado** das peças do stand. Quatro peças
impressas e uma sem arte não é quase pronto — é esperando o cliente, e é isso
que quem monta precisa ver.

Do lado do app, isso exige o APK novo (versão 1.0.89+90) e rodar lá o workflow
de regras do Firestore, para `cv_status` ficar protegida contra escrita do
cliente.

---

## Como usar, na ordem da operação

### 1. Cadastrar a feira e o prazo (`#/projetos`)

**Nova feira** → nome + **prazo final de envio das artes**. Faça isto antes de
cadastrar os clientes.

O prazo é da feira, e todos os stands leem dele — inclusive os cadastrados
depois. Não existe "aplicar a todos" e não há ordem certa a decorar: mudou a
data da feira, mudou para todo mundo na hora.

### 2. Cadastrar os projetos da feira (`#/projetos`)

**Importar planilha** é o caminho que se paga. Aceita os dois formatos que as
planilhas de produção têm na prática:

**Uma linha por peça** (recomendado):

```
feira;cliente;email;stand;localizacao;link drive;peca;tipo;largura;altura;escala;gabarito
Expo Sul 2026;Buddy;ana@buddy.com;Buddy;Rua 3;https://drive.google.com/…;Lona de fundo;lona;275;275;1:1;
Expo Sul 2026;Buddy;ana@buddy.com;Buddy;Rua 3;https://drive.google.com/…;Testeira com recorte;testeira;150;50;1:1;https://…/gabarito.pdf
```

**Uma linha por stand**, com uma coluna por arte:

```
feira;cliente;email;stand;localizacao;Arte A;Arte B;Arte C
Expo Sul 2026;Buddy Nutrition;ana@buddy.com;Buddy;Rua 3;Lona de parede 275x275;Adesivo balcão 100x100;Testeira 150x50
```

Detalhes que a importação resolve sozinha:

- reconhece cabeçalho com acento, maiúscula e nome alternativo (`cliente` ou
  `expositor`, `stand` ou `estande`, `medida` ou `tamanho`…);
- separa a medida da descrição: `Lona de parede 275x275` vira nome + tamanho;
- descobre o tipo de peça pelo texto (`adesivo`, `testeira`, `piso`, `lona`…);
- aceita `2,75 x 2,75 m`, `1000 x 500 mm` e `275x275`;
- reconhece o ponto e vírgula do Excel em português **e** a acentuação de
  arquivo salvo em Windows-1252;
- **não interrompe por uma linha torta**: importa o que dá e lista o que
  ficou de fora, com o número da linha;
- completa o `https://` que falta num link — sem isso ele viraria endereço
  relativo e o botão levaria o cliente para dentro da nossa própria página;
- ignora gabarito que não seja endereço ("sim", "ver com o projetista"): botão
  que abre nada é pior que botão nenhum.

**E-mails:** a coluna `email` aceita vários endereços separados por `;` ou
vírgula. A cobrança vai para todos — mandar só para o primeiro é quase o mesmo
que não mandar, porque decisão de arte raramente é de uma pessoa só.

**Duas colunas novas:** `link drive` (a pasta do projeto, por stand — vira botão
em destaque na tela do cliente) e `gabarito` (por peça, só link; arquivo se
envia na tela de cadastro).

Uma coisa ela **não** faz de propósito: adivinhar unidade. `10 x 10` tanto pode
ser adesivo de 10 cm quanto lona de 10 m — chutar recriaria o erro silencioso
que o cadastro veio eliminar. Vira aviso para conferência.

### 3. Mandar o link para o cliente

Cada projeto tem **Copiar link do cliente**. O link não pede login nem senha —
o cliente pode encaminhar direto para a agência que faz a arte, que é quem
normalmente monta o arquivo.

### 4. Cobrar o que falta

O painel mostra `3 de 5` por stand. **Cobrar por e-mail** abre o e-mail já
escrito, com a lista das peças pendentes, as medidas e o link. Também dá para
copiar de uma vez os e-mails de todos os stands com pendência.

### 5. Baixar (`#/admin`)

Com o nome da peça cadastrada em cada arquivo, e uma coluna
**Prova de aprovação** para mandar o print direto da lista.

### O painel se atualiza sozinho

Nada de F5. As telas internas **escutam o Firestore em tempo real**: arte que
chega, mensagem do cliente e resposta a uma prova aparecem sem recarregar.

As abas mostram uma bolinha vermelha com o que é novo **desde a sua última
visita** — contando todas as feiras que você alcança, não só a selecionada. Um
aviso que só aparece depois de escolher a feira certa chega tarde demais.

O marcador de "já vi" fica no navegador de cada analista, não no servidor: uma
gravação por tela aberta, dezenas por dia por pessoa, seria caro demais para
pintar uma bolinha. O preço é que trocar de máquina zera os avisos uma vez.

Sobre custo: parece caro manter conexão aberta e não é. O Firestore cobra a
leitura inicial de cada documento e, depois, só o que muda — um painel aberto
oito horas numa feira parada custa o mesmo que abri-lo uma vez.

### Visão geral (`#/visao`)

A feira inteira numa tela, para admin e analista completo: quantas artes
chegaram, quantos stands fecharam a lista, quem não mandou nada, onde estão as
peças (a esteira, de "aguardando" a "impressa") e o que está parado esperando o
time. Tudo é clicável e leva à ficha do stand — o painel existe para virar ação
na mesma manhã, não para contemplar.

Cadastro e cobrança não têm esta aba: ela mostra reprovações, pedidos e provas,
decisões que esses papéis não tomam.

### Quem está penando

Arte reprovada **não sobe** — é a trava que dá sentido à ferramenta. O efeito
colateral é que o cliente que tentou oito vezes e desistiu ficava invisível: no
painel ele era idêntico ao que nem abriu o link, "0 de 5 artes" nos dois casos.
São dois problemas opostos — um precisa de cobrança, o outro precisa de ajuda.

Agora cada tentativa recusada fica registrada na ficha do stand (`#/projetos` →
**Abrir**), com data, peça, arquivo, dpi encontrado e o que travou. Passando de
**3 tentativas**, o stand vira alerta: etiqueta vermelha na lista, bloco
próprio na visão geral, bolinha na aba e o filtro **Precisam de ajuda**. A
ficha mostra o motivo mais frequente — cinco reprovações pelo mesmo motivo é um
cliente que não entendeu uma coisa; cinco por motivos diferentes é um cliente
perdido, e a conversa é outra.

O alerta some quando alguém abre a ficha e volta se houver nova tentativa
reprovada. Para mudar o número, é a constante `LIMITE_REPROVACOES` em
`src/core/reprovacoes.js`.

### Conversa com o cliente

Cliente e analista trocam mensagens dentro da ferramenta — na tela do cliente e
em `#/projetos` → **Abrir**. Fica registrado junto com as artes do stand, e
**ninguém edita nem apaga**, nem o cliente nem o time: é o que faz do histórico
um registro que resolve discussão em vez de virar palavra contra palavra.

Não há aviso automático. Para algo urgente, telefone continua sendo telefone.

### 6. Fechar o ciclo (`#/projetos` → **Abrir**)

É onde o analista trabalha depois que a arte chega:

- **Prova de aprovação** — sobe o print/mockup e marca quais peças ele cobre.
  O cliente responde *aprovo tudo*, *aprovo em partes* (marcando quais peças
  precisam de arte nova) ou *reprovo tudo*, com data e hora registradas.
- **Pedidos de nova versão** — quando o cliente quer trocar uma arte já
  entregue, ele precisa explicar o motivo. O pedido aparece aqui e você
  **libera** ou **recusa com justificativa**. Se marcar *tem custo extra*, o
  cliente vê a opção de aceitar — e o aceite fica registrado.
- **Em impressão / impressa** — o cliente passa a ver esse status. Peça em
  produção trava o reenvio automaticamente, e a recusa já vem com o texto
  preenchido.
- **Liberar reimpressão** — quando o atendimento acerta o custo extra por
  telefone, é aqui que isso vira ação: o botão libera arte nova mesmo com a
  peça na impressora e tira o status de produção. A liberação do time vence
  qualquer bloqueio, porque quem sabe que a reimpressão foi combinada é o time.
- **Prorrogar prazo** — exceção só para aquele stand, com data de validade.

O que o time decide (liberar, recusar, prova, status, prazo) o cliente não
consegue escrever nem com o link em mãos. Isso está nas regras do Firestore,
não só na tela.

### Sobre o prazo

O prazo é cadastrado **na feira** e vale para todos os stands dela, inclusive
os que você cadastrar depois. Depois do prazo, o envio de peça nova fica
bloqueado e o cliente vê o aviso sobre taxa de urgência.

Uma exceção é automática e proposital: **quem está corrigindo porque nós
reprovamos a prova não é bloqueado**. Barrar o cliente por uma volta que o time
pediu seria puni-lo pelo nosso processo. Para as demais exceções, existe a
prorrogação por stand.

### Sobre a resolução

São **dois patamares**, não um só:

| Faixa | O que acontece |
|---|---|
| abaixo de **100 dpi** | reprovada — não imprime |
| entre **100 e 150 dpi** | **aprovada com ressalva** — imprime, fora do padrão |
| **150 dpi** ou mais | aprovada |

A versão anterior reprovava tudo abaixo de 150, inclusive arte que o time de CV
aprovaria sem pestanejar — e ferramenta que reprova o que a pessoa aprova não é
rigorosa, é ignorada.

O piso do **perfil** nunca é afrouxado: adesivo de balcão continua exigindo 150
dpi, porque é lido a 50 cm. A mesma arte de 120 dpi passa com ressalva numa
lona e reprova num adesivo.

**Sangria:** 10 cm por lado na lona (é o que se grampeia), **5 cm no adesivo**.

### Sobre o custo extra

O aviso ao cliente **não cita valor**, de propósito: parte dos expositores paga
pela organizadora do evento, que aplica margem própria sobre o nosso preço, e
publicar um número criaria uma expectativa que a fatura não confirma. O texto
manda falar com o atendimento. O aceite registrado guarda a data, a hora e o
texto exato que estava na tela — o trâmite comercial segue fora do sistema.

---

## Analistas (`#/analistas`)

**Só o Administrador abre esta tela.** Isso está nas regras do Firestore, não
só na interface: sem essa trava, qualquer analista se promoveria e os níveis
abaixo virariam decoração.

Cada pessoa tem **duas definições independentes** — o que ela pode fazer, e em
quais feiras. Dar todas as feiras a alguém não amplia o que ele faz nelas.

| Papel | O que faz |
|---|---|
| **Administrador** | Tudo, em todas as feiras. Único que cadastra e remove analistas. |
| **Analista completo** | Opera as feiras dele de ponta a ponta: cadastra projetos, manda prova, libera reenvio, marca impressão, cobra. |
| **Cadastro** | Só cadastra feiras/projetos e importa planilha. Não manda prova, não libera reenvio, não marca impressão. |
| **Cobrança** | Acompanha o que falta e cobra por e-mail. Não altera cadastro nem decide sobre arte. |

O escopo por feira é literal: um analista atribuído a duas feiras **não vê a
terceira no seletor**. E as abas que o papel não alcança somem — aba que só dá
erro ao clicar é pior que aba nenhuma.

Vale a franqueza sobre onde cada trava mora: **a lista de analistas é lei no
servidor**, porque é a única cuja falsificação seria grave. Os demais limites
são regra de tela — o risco aqui é a equipe errar o clique, não alguém montar
chamada de API, e toda ação relevante fica registrada com o e-mail de quem fez.

Duas formas de liberar alguém, porque existem dois casos reais:

- **Criar conta com senha** — para quem não usa conta Google. A senha inicial
  aparece na tela para você repassar, e a pessoa pode trocá-la depois em
  *Esqueci a senha*.
- **Só liberar o e-mail** — para quem vai entrar com Google. A conta já existe;
  aqui entra só a permissão.

**Todo analista precisa confirmar o e-mail antes de entrar.** Não é
burocracia: com o login por e-mail e senha ligado, qualquer pessoa da internet
cria uma conta com o endereço que quiser. Se bastasse constar na lista, daria
para se cadastrar com o e-mail de um colega que ainda não tem conta e entrar no
lugar dele. Exigir a confirmação obriga a ter acesso à caixa de entrada.

Vale saber: **quem tem acesso pode liberar qualquer pessoa**, inclusive a si
mesmo em outro endereço. É o preço de não ter servidor próprio no meio — a
alternativa seria voltar ao console do Firebase a cada contratação. A lista
deve ficar curta, e o campo *liberado por* registra quem liberou quem.

---

## Conferir

1. `#/projetos` → **Importar planilha** → baixe a planilha modelo, preencha
   duas linhas e importe. Devem aparecer os stands com as peças.
2. Copie o link de um stand, abra numa aba anônima. Deve abrir direto na lista
   de peças, **sem pedir login**, com as medidas certas.
3. Suba uma arte aprovada. O cartão da peça deve virar ✓ e o contador subir.
4. Volte a `#/projetos` e confirme que o stand mudou de `0 de 3` para `1 de 3`.
5. Na aba anônima, tente enviar a mesma peça de novo: deve pedir o motivo.
   Escreva e envie.
6. Em `#/projetos` → **Abrir**, o pedido aparece no topo. Recuse marcando
   *tem custo extra* e veja o cliente receber a opção de aceitar.
7. Ainda em **Abrir**, mande uma prova cobrindo a peça. Na aba anônima ela
   aparece com os três botões de resposta.
8. Marque a peça como **em impressão** e confirme que o cliente vê o status e
   perde o botão de enviar — mas continua com *Pedir troca mesmo assim*.
9. Em **Abrir**, clique em **Liberar reimpressão**. A peça sai de "em
   impressão" e o cliente volta a poder enviar. É o caminho de quando o
   atendimento já acertou o custo por telefone.

### Se der errado

| Sintoma | Causa provável |
|---|---|
| `auth/unauthorized-domain` ao entrar | falta o domínio do site em Authentication → **Configurações** → Domínios autorizados. A mensagem na tela mostra qual endereço adicionar. Vale para o login do time **e** para o envio do cliente, que usa sessão anônima |
| "Conta ainda não liberada" | o e-mail não está na coleção `admins` — libere em `#/analistas` |
| Analista novo não entra | ele ainda não clicou no link de confirmação do e-mail |
| Analista não vê a feira dele | a feira não foi marcada no acesso dele em `#/analistas` |
| Aba "Analistas" não aparece | o papel não é Administrador |
| `permission-denied` ao cadastrar projeto | regras do **Firestore** desatualizadas (passo 1) |
| Link do cliente abre "Link não encontrado" | regras do Firestore desatualizadas, ou o token foi copiado pela metade |
| "envio do **arquivo** recusado" | regras do **Storage** desatualizadas (passo 2) |
| "registro do envio recusado" | regras do **Firestore** desatualizadas (passo 1) |
| Arquivo de apoio recusado | regras do Storage sem a pasta `avulsos/` — republique |
| Planilha importa com acento quebrado | salve como *CSV UTF-8* no Excel (a ferramenta tenta os dois, mas o UTF-8 é o certo) |
| Prova recusada ao enviar | regras do Storage sem a pasta `provas/` — republique (passo 2) |
| Cliente não consegue pedir troca de arte | regras do Firestore desatualizadas (passo 1) |
| Cliente não vê o prazo que você cadastrou | regras do Firestore desatualizadas — o expositor precisa poder ler a feira |
| Cliente diz que não viu a prova | não existe e-mail automático — avise pelo botão de e-mail do painel |

---

## O que fica registrado

Cada envio grava um documento em `envios/{protocolo}` com o cadastro do
expositor, a peça (e **qual peça do projeto** ela é), o veredicto, o aceite de
risco com data e hora, o laudo técnico inteiro e o **SHA-256 do arquivo**.

O hash é o que dá valor ao registro: quando alguém reclamar do resultado
impresso, existe a prova de qual arquivo exato foi aprovado, por quem e quando.

---

## Custos

| Item | Consumo esperado | Custo estimado |
|---|---|---|
| Armazenamento | ~20 GB por evento | ~R$ 3/mês por evento acumulado |
| Download pelo time | ~20 GB por evento | ~R$ 13 por evento |
| Firestore | ~2 KB por arte, ~1 KB por projeto | R$ 0 — cota gratuita |
| Autenticação | dezenas de contas | R$ 0 — cota gratuita |
| Hospedagem | estática | R$ 0 — GitHub Pages |

Algo entre **R$ 15 e R$ 25 por evento**. O cadastro de projetos não muda essa
conta: são documentos de texto, dentro da cota gratuita com folga.

## Uma limitação que vale conhecer

A ferramenta aberta continua sem barreira: qualquer pessoa com o endereço pode
enviar arte, porque é isso que evita a barreira de login para o expositor. As
regras limitam bastante o estrago (só JPG/PNG/PDF, até 1 GB, só criação, sem
listagem), mas não impedem alguém mal-intencionado de encher o armazenamento.

Se um dia isso incomodar, o remédio é o **Firebase App Check** com reCAPTCHA:
garante que as chamadas vêm mesmo da página de vocês e continua invisível para
o expositor. São uns 10 minutos de configuração, sem mexer no resto.
