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

**Falta:** tela de consentimento → ID de cliente → refresh token → deploy.

---

## Passo 3 — Tela de consentimento OAuth

👉 https://console.cloud.google.com/apis/credentials/consent?project=aprovacao-de-arte-49bc3

*(no menu lateral do Google Cloud isso aparece como **APIs e serviços → Tela de
permissão OAuth**; em projetos novos o Google renomeou para **Google Auth
Platform → Branding**)*

1. Tipo de usuário: **Externo** → *Criar*.
2. Preencha o mínimo:
   - Nome do app: `Aprovacao de Arte`
   - E-mail de suporte: `cleitonpnascimento@gmail.com`
   - E-mail do desenvolvedor: `cleitonpnascimento@gmail.com`
3. *Salvar e continuar*.
4. Em **Escopos** → *Adicionar ou remover escopos* → no campo de filtro, cole:
   ```
   https://www.googleapis.com/auth/drive.file
   ```
   marque a caixa → *Atualizar* → *Salvar e continuar*.
5. Em **Usuários de teste** → adicione `cleitonpnascimento@gmail.com` →
   *Salvar e continuar*.

### ⚠️ Agora o passo que quase todo mundo pula

Volte ao **resumo da tela de consentimento** e clique em **"Publicar app"**
(botão *PUBLISH APP*) → confirme.

**Por quê:** enquanto o app estiver com status **"Teste"**, o Google expira o
refresh token em **7 dias**. Vai funcionar hoje, e na semana que vem os envios
começam a falhar sem nenhum erro visível para o cliente — o tipo de problema
que consome dias até alguém descobrir a causa.

Publicar **não exige verificação do Google** aqui, porque `drive.file` não é
um escopo sensível. Se aparecer algo sobre "verificação necessária", é sinal
de que sobrou algum escopo a mais na lista — deixe só o `drive.file`.

---

## Passo 4 — ID do cliente OAuth

👉 https://console.cloud.google.com/apis/credentials?project=aprovacao-de-arte-49bc3

1. **+ Criar credenciais** → **ID do cliente OAuth**.
2. Tipo de aplicativo: **App para computador** (*Desktop app*).
3. Nome: `aprovacao-de-arte` → *Criar*.
4. Aparece uma janela com **ID do cliente** e **Chave secreta do cliente**.
   **Copie os dois** — vamos usar já em seguida. (Dá para reabrir depois pelo
   ícone de lápis na lista de credenciais.)

---

## Passo 5 — Refresh token

👉 https://developers.google.com/oauthplayground

1. Clique na **engrenagem** (canto superior direito).
2. Marque **Use your own OAuth credentials**.
3. Cole o **OAuth Client ID** e o **OAuth Client secret** do passo anterior.
4. No painel da esquerda, no campo *Input your own scopes*, cole:
   ```
   https://www.googleapis.com/auth/drive.file
   ```
5. **Authorize APIs** → escolha `cleitonpnascimento@gmail.com`.
   - Vai aparecer **"O Google não verificou este app"**. Clique em
     **Avançado** → **Acessar Aprovacao de Arte (não seguro)**.
     É a sua conta autorizando o seu próprio app — é esperado.
   - Permita o acesso.
6. Clique em **Exchange authorization code for tokens**.
7. **Copie o `Refresh token`** (a linha que começa com `1//`).

> Se aparecer `Error 400: redirect_uri_mismatch`: volte na credencial do passo
> 4, e em *URIs de redirecionamento autorizados* adicione
> `https://developers.google.com/oauthplayground`.

---

## Passo 6 — Preencher as credenciais

Na pasta do projeto, copie `functions/.env.exemplo` para **`functions/.env`** e
preencha:

```env
TOKEN_EVENTO=uma-frase-difícil-que-você-inventa
OAUTH_CLIENT_ID=...apps.googleusercontent.com
OAUTH_CLIENT_SECRET=GOCSPX-...
OAUTH_REFRESH_TOKEN=1//0h...
```

O `functions/.env` **não vai para o Git** — fica só na sua máquina e é
publicado junto com a função no deploy.

---

## Passo 7 — Publicar a função

Esta é a única parte que precisa de terminal. São cinco comandos, uma vez só.

**Se você não tem Node.js instalado:** baixe a versão LTS em
https://nodejs.org e instale (avançar, avançar, concluir). Depois abra o
**Prompt de Comando** (Windows) ou o **Terminal** (Mac).

Navegue até a pasta do projeto e rode:

```bash
npm install -g firebase-tools
firebase login
firebase use aprovacao-de-arte-49bc3

cd functions
npm install
cd ..

firebase deploy --only functions,firestore:rules,firestore:indexes
```

O `firebase login` abre o navegador para você entrar com a conta Google.

No fim o deploy imprime a URL da função — algo como:

```
Function URL (envio(southamerica-east1)):
https://envio-xxxxxxxxxx-rj.a.run.app
```

**Copie essa URL.**

> Se travar em algo, me manda a mensagem de erro inteira que eu te digo o que
> é. Se preferir não mexer com terminal nenhum, me avisa: dá para eu montar um
> workflow no GitHub que publica a função sozinho a cada push, e aí você só
> preenche as credenciais na tela de *Settings → Secrets* do repositório.

---

## Passo 8 — Ligar no frontend

Edite o `.env` da **raiz** do projeto e preencha as duas linhas vazias:

```env
VITE_ENVIO_ENDPOINT=  ← a URL que o deploy imprimiu
VITE_EVENTO_TOKEN=    ← o mesmo TOKEN_EVENTO do functions/.env
```

Commit e push — o GitHub Actions publica o site sozinho.

O link para o expositor leva o token na URL, o que permite trocá-lo por evento
sem republicar nada:

```
https://cleitonpn.github.io/aprovacao-de-arte/?e=SEU_TOKEN
```

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
| `invalid_grant` nos logs | refresh token expirado ou revogado; gere outro no passo 5 |
| Arte foi para uma pasta inesperada | veja `config/drive` no Firestore |

Ver os logs: `firebase functions:log --only envio`

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
