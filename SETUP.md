# Configuração do envio para o Drive

Roteiro para ligar o envio automático da arte aprovada. A ferramenta **já
funciona sem nada disto** — a análise inteira roda no navegador. O que este
roteiro liga é o botão *Enviar arte para produção* e o painel do time.

Projeto Firebase: **`aprovacao-de-arte-49bc3`** (já configurado no `.env`).

---

## Por que existe uma Cloud Function

Você pediu que o expositor **não precise fazer login** — e está certo: exigir
conta Google de cada cliente é justamente a barreira que a ferramenta existe
para remover.

Só que escrever no Drive exige uma credencial, e credencial não pode ficar no
navegador (qualquer um leria e passaria a escrever na pasta de vocês). A
função resolve isso: ela guarda a credencial e devolve ao navegador uma **URL
de sessão de upload** já autorizada.

```
navegador  ──(1) só os metadados──▶  Cloud Function ──▶ Drive (autoriza)
navegador  ◀──(2) URL da sessão────  Cloud Function
navegador  ──(3) OS BYTES, direto──▶ Google
navegador  ──(4) confirma─────────▶  Cloud Function ──▶ Firestore
```

O detalhe que mantém o custo em zero: **os bytes nunca passam pela função**.
Ela troca alguns kilobytes de JSON, então um arquivo de 500 MB custa o mesmo
que um de 5 MB.

> ⚠️ **Cloud Functions exige o plano Blaze** (cartão cadastrado). O consumo de
> vocês fica dentro da cota gratuita com folga — 2 milhões de invocações/mês —
> mas o cartão precisa estar lá. Se isso for um problema, dá para viver sem a
> função: o time de CV faz o login com a conta da empresa e sobe pelo
> navegador. Só que aí o cliente não sobe sozinho.

---

## Parte 1 — Firebase

1. **Plano Blaze**: console → ⚙️ → *Uso e faturamento* → *Modificar plano*.
2. **Firestore**: *Criar banco de dados* → modo produção → região
   `southamerica-east1`.
3. **Authentication**: *Começar* → ative o provedor **Google**. Isso é só
   para o painel do time; o expositor nunca faz login.
4. **Libere seu acesso ao painel**: no Firestore, crie a coleção `admins` com
   um documento cujo **ID é o seu e-mail** (ex.: `cleiton@empresa.com.br`).
   O conteúdo pode ser `{ nome: "Cleiton" }`. Repita para cada pessoa do time.

   Adicionar admin é feito só pelo console, de propósito — assim ninguém se
   autopromove pela aplicação.

---

## Parte 2 — Google Drive

O Drive precisa aceitar que a função escreva na pasta. O caminho depende do
tipo de conta:

### Caminho A — com Google Workspace (recomendado)

1. Crie um **Drive compartilhado** (não uma pasta do "Meu Drive").
2. Google Cloud Console → mesmo projeto → *APIs e serviços* → ative a
   **Google Drive API**.
3. *Credenciais* → *Criar credencial* → **Conta de serviço**. Gere uma chave
   **JSON** e guarde o arquivo.
4. Copie o e-mail da conta de serviço (algo como
   `envio-arte@aprovacao-de-arte-49bc3.iam.gserviceaccount.com`) e
   **adicione-o como Gerente de conteúdo** no Drive compartilhado.
5. Abra a pasta no navegador e copie o ID da URL:
   `drive.google.com/drive/folders/`**`ESTE_TRECHO`**

> 🚨 **A pegadinha que custa um dia de trabalho:** conta de serviço **não tem
> cota de armazenamento própria**. Enviar para uma pasta do "Meu Drive" de
> alguém falha com *"Service Accounts do not have storage quota"*. Só funciona
> dentro de um **Drive compartilhado**. Se vocês não têm Workspace, use o
> caminho B.

### Caminho B — conta Google comum (sem Workspace)

Aqui a função age em nome de uma conta real, e os arquivos ficam no Drive
dela.

1. Ative a **Google Drive API** (igual ao passo 2 acima).
2. *Credenciais* → *ID do cliente OAuth* → tipo **Aplicativo para computador**.
3. Gere um **refresh token** para a conta da empresa, com o escopo
   `https://www.googleapis.com/auth/drive.file`. O jeito mais simples é o
   [OAuth Playground](https://developers.google.com/oauthplayground): engrenagem
   → *Use your own OAuth credentials* → cole client ID e secret → autorize o
   escopo → *Exchange authorization code for tokens*.
4. Crie a pasta destino no Drive da conta e copie o ID da URL.

---

## Parte 3 — Segredos da função

Rode na raiz do projeto (`npm i -g firebase-tools` se ainda não tiver):

```bash
firebase login
firebase use aprovacao-de-arte-49bc3

# Pasta destino no Drive (o ID copiado acima)
firebase functions:secrets:set DRIVE_PASTA_RAIZ

# Token do evento: invente uma frase difícil de adivinhar.
# É ela que impede o endpoint de ficar aberto ao mundo.
firebase functions:secrets:set TOKEN_EVENTO

# Caminho A — cole o conteúdo INTEIRO do JSON da conta de serviço
firebase functions:secrets:set SERVICE_ACCOUNT_JSON

# Caminho B — em vez do de cima, estes três
firebase functions:secrets:set OAUTH_CLIENT_ID
firebase functions:secrets:set OAUTH_CLIENT_SECRET
firebase functions:secrets:set OAUTH_REFRESH_TOKEN
```

Publique:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules,firestore:indexes
```

O deploy imprime a URL da função, algo como:

```
https://southamerica-east1-aprovacao-de-arte-49bc3.cloudfunctions.net/envio
```

### Restringir a origem (recomendado)

Para o endpoint só aceitar chamadas vindas da página de vocês:

```bash
firebase functions:config:unset  # se houver config antiga
# defina ORIGENS_LIBERADAS como variável de ambiente da função, ex.:
# https://cleitonpn.github.io
```

---

## Parte 4 — Ligar no frontend

Edite o `.env` na raiz e preencha as duas linhas vazias:

```env
VITE_ENVIO_ENDPOINT=https://southamerica-east1-aprovacao-de-arte-49bc3.cloudfunctions.net/envio
VITE_EVENTO_TOKEN=o-mesmo-valor-do-segredo-TOKEN_EVENTO
```

Faça commit e push: o GitHub Actions publica sozinho.

O link que vai para o expositor pode carregar o token na URL, o que permite
trocá-lo por evento sem republicar o site:

```
https://cleitonpn.github.io/aprovacao-de-arte/?e=TOKEN_DO_EVENTO
```

---

## Parte 5 — Conferir

1. Abra a ferramenta, preencha o cadastro, suba uma arte **aprovada** e clique
   em *Enviar arte para produção*. Deve aparecer o protocolo `AP-…`.
2. Confira o arquivo na pasta do Drive — ele chega nomeado como
   `stand__peca__protocolo.jpg`, dentro de uma subpasta com o nome da feira.
3. Abra `…/aprovacao-de-arte/#/admin`, entre com o Google e selecione a feira.

Se der `permission-denied` no painel, falta o documento com o seu e-mail na
coleção `admins`. Se der `failed-precondition`, o Firestore quer um índice — o
link para criá-lo aparece no console do navegador (ou rode o deploy dos
índices de novo).

---

## O que fica registrado

Cada envio grava um documento em `envios/{protocolo}`:

- cadastro completo do expositor (nome, e-mail, feira, stand, localização);
- peça, perfil aplicado e veredicto;
- **aceite de risco**, quando houver, com data e hora;
- laudo técnico inteiro, incluindo o **SHA-256** do arquivo;
- link do arquivo no Drive.

O hash é o que dá valor ao registro: quando alguém reclamar do resultado
impresso, existe a prova de qual arquivo exato foi aprovado, por quem e
quando.

## Custos

| Item | Consumo esperado | Custo |
|---|---|---|
| Armazenamento das artes | dezenas de GB por evento | **R$ 0** — usa o Drive que vocês já pagam |
| Cloud Function | ~2 chamadas por arte, alguns KB | **R$ 0** — cota de 2 M invocações/mês |
| Firestore | ~2 KB por arte | **R$ 0** — cota de 50 mil leituras/dia |
| Hospedagem | estática | **R$ 0** — GitHub Pages |

O que faz essa conta fechar é a arquitetura: os bytes do arquivo vão direto do
navegador para o Google, sem passar por infraestrutura paga no meio.
