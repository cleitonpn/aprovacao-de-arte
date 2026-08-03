# Configuração do envio para o Drive

Roteiro para ligar o envio automático da arte aprovada e o painel do time.
A ferramenta **já funciona sem nada disto** — a análise inteira roda no
navegador. Isto liga o botão *Enviar arte para produção*.

| | |
|---|---|
| Projeto Firebase | `aprovacao-de-arte-49bc3` |
| Pasta do Drive | `1O48_s3haaKpPX98BdBr8s_PggYUcC53H` |
| Admin do painel | `cleitonpnascimento@gmail.com` |
| Tipo de conta | Google comum, plano de 5 TB (sem Workspace) |

**Já feito:** ✅ plano Blaze · ✅ Authentication com Google · ✅ Firestore +
coleção `admins` · ✅ Google Drive API ativada

**Falta:** consentimento OAuth → cliente OAuth → refresh token → segredos no
GitHub → clicar em *Run workflow*.

> Nenhum passo daqui em diante precisa de terminal. Tudo é feito por telas do
> Google Cloud e do GitHub.

---

## Passo 3 — Consentimento OAuth (Google Auth Platform)

👉 https://console.cloud.google.com/auth/overview?project=aprovacao-de-arte-49bc3

O Google reorganizou essa área e ela agora se chama **Google Auth Platform**.
Não existe mais um assistente único: as configurações estão espalhadas em três
itens do menu lateral. Faça nesta ordem.

### 3.1 — Menu "Acesso a dados" → o escopo

1. Clique em **Acesso a dados** no menu da esquerda.
2. **Adicionar ou remover escopos**.
3. No campo de filtro, cole:
   ```
   https://www.googleapis.com/auth/drive.file
   ```
4. Marque a caixa da linha que aparecer → **Atualizar** → **Salvar**.

Deixe **apenas** esse escopo. Ele não é "sensível", e é isso que permite
publicar o app sem passar pela verificação do Google.

### 3.2 — Menu "Público-alvo" → tipo, testador e publicação

1. Clique em **Público-alvo**.
2. Confirme que o tipo de usuário é **Externo**.
3. Em *Usuários de teste*, adicione `cleitonpnascimento@gmail.com`.
4. **Clique em "Publicar app"** e confirme.

> 🚨 **Este é o passo que quase todo mundo pula.** Enquanto o app estiver em
> **"Teste"**, o Google expira o refresh token em **7 dias**. Vai funcionar
> hoje e, na semana que vem, os envios param sem nenhum erro visível para o
> cliente — o tipo de problema que consome dias até alguém achar a causa.
>
> Depois de publicar, o status em *Público-alvo* deve mostrar **"Em produção"**.
> Se pedir verificação do Google, sobrou escopo a mais no passo 3.1.

### 3.3 — Menu "Branding" (só se estiver vazio)

Nome do app (`Aprovacao de Arte`), e-mail de suporte e e-mail do desenvolvedor:
todos `cleitonpnascimento@gmail.com`.

---

## Passo 4 — Criar o cliente OAuth

Ainda na **Google Auth Platform**, menu **Clientes**:

👉 https://console.cloud.google.com/auth/clients?project=aprovacao-de-arte-49bc3

1. **+ Criar cliente**.
2. Tipo de aplicativo: **Aplicativo da Web** (*Web application*).
3. Nome: `aprovacao-de-arte`.
4. Em **URIs de redirecionamento autorizados**, clique em *+ Adicionar URI* e
   cole **exatamente**:
   ```
   https://developers.google.com/oauthplayground
   ```
5. **Criar**.
6. Abre uma janela com **ID do cliente** e **Chave secreta do cliente**.
   **Copie os dois agora** — usamos no passo seguinte. Dá para reabrir depois
   clicando no nome do cliente na lista.

> ⚠️ Tem que ser **Aplicativo da Web**, não "App para computador". O tipo
> desktop não oferece o campo de URI de redirecionamento, e sem ele o OAuth
> Playground do passo 5 recusa com `redirect_uri_mismatch` — sem opção de
> conserto a não ser refazer o cliente.
>
> Esse cliente é usado **uma vez só**, para gerar o refresh token. Depois
> disso quem fala com o Google é a função, com o token já emitido.

---

## Passo 5 — Refresh token

👉 https://developers.google.com/oauthplayground

**A ordem importa.** Configurar suas credenciais tem que vir ANTES de
autorizar — senão o Playground emite um token vinculado ao app dele próprio, e
esse token não funciona com o seu `OAUTH_CLIENT_ID` na função.

1. Clique na **engrenagem** (⚙️, canto superior direito).
2. Marque **Use your own OAuth credentials**.
3. Aparecem dois campos: cole o **OAuth Client ID** e o **OAuth Client
   secret** do passo 4. Feche o painel da engrenagem.
4. Agora sim, no campo **Input your own scopes** (embaixo da lista de APIs, à
   esquerda), cole:
   ```
   https://www.googleapis.com/auth/drive.file
   ```
   Ignore a lista enorme de APIs acima — não precisa marcar nada nela.
5. **Authorize APIs** → escolha `cleitonpnascimento@gmail.com`.
   - Vai aparecer **"O Google não verificou este app"**. Clique em
     **Avançado** → **Acessar Aprovacao de Arte (não seguro)**.
     É a sua conta autorizando o seu próprio app — é esperado.
   - Permita o acesso.
6. Clique em **Exchange authorization code for tokens**.
7. **Copie o `Refresh token`** (a linha que começa com `1//`).

> `Error 400: redirect_uri_mismatch` → o URI de redirecionamento não foi
> cadastrado. Volte em **Clientes**, abra o cliente e confira se
> `https://developers.google.com/oauthplayground` está lá, sem barra no final.
> Se o cliente for do tipo "App para computador", esse campo não existe:
> crie outro como **Aplicativo da Web**.
>
> `Error 401: deleted_client` ou o token não funciona depois → provavelmente
> a engrenagem não estava marcada quando você autorizou. Refaça do item 1.

---

## Passo 6 — Conta de serviço para o GitHub publicar

O GitHub precisa de uma credencial para publicar a função no seu projeto.
Tudo por telas, sem terminal.

👉 https://console.cloud.google.com/iam-admin/serviceaccounts?project=aprovacao-de-arte-49bc3

1. **+ Criar conta de serviço**.
2. Nome: `github-deploy` → **Criar e continuar**.
3. Em *Conceder acesso*, adicione **dois** papéis:
   - **Editor**
   - **Administrador do Firebase** (*Firebase Admin*)

   > Editor é um papel amplo. Escolhi ele de propósito: montar a lista exata de
   > seis papéis que o deploy de uma função v2 exige é a receita mais comum de
   > erro `PERMISSION_DENIED` no meio do processo, e você não teria como
   > diagnosticar. Como é o seu próprio projeto e a credencial fica só no
   > GitHub, o risco é aceitável. Se um dia quiser restringir, dá para trocar
   > depois com o deploy já funcionando.

4. **Concluir**.
5. Na lista, clique na conta `github-deploy` → aba **Chaves** →
   **Adicionar chave** → **Criar nova chave** → tipo **JSON** → **Criar**.
   Um arquivo `.json` é baixado. Abra-o num editor de texto e **copie todo o
   conteúdo**, das chaves `{` `}` inclusive.

---

## Passo 7 — Colar os segredos no GitHub

👉 https://github.com/cleitonpn/aprovacao-de-arte/settings/secrets/actions

Clique em **New repository secret** e crie **cinco** segredos:

| Nome | Valor |
|---|---|
| `GCP_SA_KEY` | o conteúdo inteiro do arquivo JSON do passo 6 |
| `TOKEN_EVENTO` | uma frase difícil que você inventa (ex.: `forum-2026-kJ8x!vRm`) |
| `OAUTH_CLIENT_ID` | do passo 4, termina em `.apps.googleusercontent.com` |
| `OAUTH_CLIENT_SECRET` | do passo 4, começa com `GOCSPX-` |
| `OAUTH_REFRESH_TOKEN` | do passo 5, começa com `1//` |

O nome tem que ser **exatamente** esse, em maiúsculas. Depois de salvos, o
GitHub nunca mais mostra o valor — se errar, é só criar de novo por cima.

> O `TOKEN_EVENTO` é usado nos dois lados: a função exige ele para aceitar um
> envio, e o site o embute no build. Por isso vale um segredo só.

---

## Passo 8 — Publicar, sem terminal

### 8.1 — A função

👉 https://github.com/cleitonpn/aprovacao-de-arte/actions/workflows/deploy-funcao.yml

1. Clique em **Run workflow** → **Run workflow** (o botão verde).
2. Acompanhe. O primeiro deploy demora uns 3 a 5 minutos, porque o Google
   precisa ligar várias APIs e montar o ambiente.
3. Terminando, a página mostra um resumo com o endereço da função.

Se algum segredo faltar, o workflow para logo no começo e diz **qual** —
justamente para você não descobrir isso só depois de cinco minutos.

### 8.2 — O site

👉 https://github.com/cleitonpn/aprovacao-de-arte/actions/workflows/deploy.yml

**Run workflow** também, para o site ser reconstruído já com o
`TOKEN_EVENTO` embutido.

O endereço da função **já está configurado** no projeto — é previsível a
partir do nome do projeto e da região, então não há nada para copiar e colar.

### 8.3 — O link do expositor

```
https://cleitonpn.github.io/aprovacao-de-arte/?e=SEU_TOKEN_EVENTO
```

Trocar o token por evento é só mudar a URL do convite — não precisa
republicar nada.

---

## Passo 9 — Conferir

1. Abra a ferramenta, preencha o cadastro, suba uma arte **aprovada** e clique
   em *Enviar arte para produção*. Deve aparecer um protocolo `AP-…`.
2. Confira o Drive: o arquivo chega como `stand__peca__protocolo.jpg`, dentro
   de uma subpasta com o nome da feira.
3. Abra `…/aprovacao-de-arte/#/admin`, entre com o Google e escolha a feira.

### Sobre a pasta de destino

O escopo `drive.file` só dá acesso aos arquivos que **a própria aplicação
criou** — uma pasta criada à mão costuma responder 404, mesmo sendo a mesma
conta. É a pegadinha clássica deste caminho.

A função trata isso sozinha: testa a pasta configurada e, se não conseguir
alcançá-la, **cria uma pasta própria** chamada *"Artes aprovadas — Aprovação
de Arte"* no seu Drive e passa a usá-la. O ID escolhido aparece nos logs e em
`config/drive` no Firestore. Pode mover ou compartilhar essa pasta à vontade:
mover não muda o ID.

### Se der errado

| Sintoma | Causa provável |
|---|---|
| `permission-denied` no painel | falta o documento com seu e-mail em `admins` |
| `failed-precondition` no painel | falta o índice do Firestore — o link para criá-lo sai no console do navegador (F12) |
| `Link do evento inválido` | `VITE_EVENTO_TOKEN` diferente do `TOKEN_EVENTO` |
| Funcionava e parou depois de ~7 dias | app OAuth ficou em status "Teste" — publique |
| `invalid_grant` nos logs | refresh token expirado ou revogado; gere outro no passo 5 e atualize o segredo |
| `PERMISSION_DENIED` no workflow | falta o papel Editor ou Firebase Admin na conta `github-deploy` |
| Workflow para dizendo que falta segredo | crie o segredo com o nome exato indicado |
| Arte foi para uma pasta inesperada | veja `config/drive` no Firestore |

Ver os logs da função (pelo navegador):
https://console.cloud.google.com/functions/details/southamerica-east1/envio?project=aprovacao-de-arte-49bc3&tab=logs

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
| Armazenamento das artes | dezenas de GB por evento | **R$ 0** — cabe no plano de 5 TB que vocês já têm |
| Cloud Function | ~2 chamadas por arte, alguns KB | **R$ 0** — cota de 2 M invocações/mês |
| Firestore | ~2 KB por arte | **R$ 0** — cota de 50 mil leituras/dia |
| Hospedagem | estática | **R$ 0** — GitHub Pages |

O que faz essa conta fechar é a arquitetura: os bytes do arquivo vão direto do
navegador para o Google, sem passar por infraestrutura paga no meio. Com 5 TB
de espaço, o armazenamento deixa de ser preocupação por bastante tempo.
