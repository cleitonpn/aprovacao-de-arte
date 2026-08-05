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
| Cliente **sem** projeto cadastrado | `https://cleitonpn.github.io/aprovacao-de-arte/` |
| Cliente **com** projeto | gerado na tela *Projetos* — `…/#/p/TOKEN` |
| Artes recebidas | `…/#/admin` |
| Cadastro de projetos | `…/#/projetos` |
| Analistas com acesso | `…/#/analistas` |

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
| `auth/unauthorized-domain` ao entrar | falta `cleitonpn.github.io` em Authentication → Settings → Domínios autorizados |
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
