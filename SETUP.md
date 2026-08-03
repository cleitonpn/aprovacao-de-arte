# Configuração do envio para o Drive

Roteiro para ligar o envio automático da arte aprovada e o painel do time.
A ferramenta **já funciona sem nada disto** — a análise inteira roda no
navegador. Isto liga o botão *Enviar arte para produção*.

**Projeto Firebase:** `aprovacao-de-arte-49bc3`
**Pasta do Drive:** `1O48_s3haaKpPX98BdBr8s_PggYUcC53H`
**Admin do painel:** `cleitonpnascimento@gmail.com`
**Conta Google comum** (sem Workspace) → caminho do *refresh token*.

Já feito: ✅ plano Blaze · ✅ Authentication com provedor Google

---

## Por que existe uma Cloud Function

Você pediu que o expositor **não precise de login** — e está certo: exigir
conta Google de cada cliente é a barreira que a ferramenta existe para
remover.

Só que escrever no Drive exige credencial, e credencial não pode ficar no
navegador (qualquer um leria e passaria a escrever na pasta de vocês). A
função guarda a credencial e devolve ao navegador uma **URL de sessão de
upload** já autorizada.

```
navegador  ──(1) só os metadados──▶  Cloud Function ──▶ Drive (autoriza)
navegador  ◀──(2) URL da sessão────  Cloud Function
navegador  ──(3) OS BYTES, direto──▶ Google
navegador  ──(4) confirma─────────▶  Cloud Function ──▶ Firestore
```

Os bytes **nunca passam pela função**. Ela troca alguns kilobytes de JSON, e é
isso que faz um arquivo de 500 MB custar o mesmo que um de 5 MB.

---

## Passo 1 — Firestore

1. Console do Firebase → **Firestore Database** → *Criar banco de dados* →
   modo **produção** → região `southamerica-east1`.
2. Crie a coleção **`admins`** com um documento cujo **ID é o e-mail**:

   - ID do documento: `cleitonpnascimento@gmail.com`
   - Campo qualquer, ex.: `nome` (string) = `Cleiton`

   Sem esse documento o painel responde *permission-denied*. Adicionar admin
   é feito só pelo console, de propósito — assim ninguém se autopromove pela
   aplicação.

---

## Passo 2 — Credencial do Drive

Sem Workspace, a função age **em nome da sua conta Google**, e os arquivos
ficam no Drive dela.

### 2.1 Ative a API

Google Cloud Console (mesmo projeto `aprovacao-de-arte-49bc3`) →
*APIs e serviços* → *Biblioteca* → busque **Google Drive API** → **Ativar**.

### 2.2 Tela de consentimento

*APIs e serviços* → **Tela de permissão OAuth**:

- Tipo: **Externo**
- Nome do app, e-mail de suporte e e-mail do desenvolvedor: os seus
- Escopos: adicione `.../auth/drive.file`
- Usuários de teste: `cleitonpnascimento@gmail.com`

> 🚨 **A pegadinha que faz tudo parar de funcionar em uma semana.** Enquanto o
> app estiver com status **"Teste"**, o Google expira o refresh token em **7
> dias** — o envio funciona, e sete dias depois começa a falhar sem motivo
> aparente. Volte na tela de permissão e clique em **"Publicar app"**.
>
> Como `drive.file` **não é um escopo sensível**, publicar não exige
> verificação do Google. Ao autorizar você verá um aviso de "app não
> verificado" — clique em *Avançado* → *Acessar (não seguro)*. É a sua própria
> conta autorizando o seu próprio app.

### 2.3 Crie o ID do cliente OAuth

*Credenciais* → *Criar credenciais* → **ID do cliente OAuth** →
tipo **App para computador** → nome: `aprovacao-de-arte`.

Anote o **Client ID** e o **Client secret**.

### 2.4 Gere o refresh token

Abra o [OAuth Playground](https://developers.google.com/oauthplayground):

1. Engrenagem (canto superior direito) → marque **Use your own OAuth
   credentials** → cole o Client ID e o Client secret.
2. No painel esquerdo, cole o escopo à mão:
   `https://www.googleapis.com/auth/drive.file`
3. **Authorize APIs** → entre com `cleitonpnascimento@gmail.com` → aceite o
   aviso de app não verificado.
4. **Exchange authorization code for tokens** → copie o **Refresh token**.

> Se o Playground reclamar de `redirect_uri_mismatch`, adicione
> `https://developers.google.com/oauthplayground` nos URIs de redirecionamento
> autorizados do seu ID de cliente.

---

## Passo 3 — Segredos e deploy

Na raiz do projeto (`npm i -g firebase-tools` se ainda não tiver):

```bash
firebase login
firebase use aprovacao-de-arte-49bc3

# Frase difícil de adivinhar. É ela que impede o endpoint de ficar aberto
# ao mundo — e vai na URL que você manda ao expositor.
firebase functions:secrets:set TOKEN_EVENTO

firebase functions:secrets:set OAUTH_CLIENT_ID
firebase functions:secrets:set OAUTH_CLIENT_SECRET
firebase functions:secrets:set OAUTH_REFRESH_TOKEN

cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules,firestore:indexes
```

O deploy imprime a URL da função:

```
https://southamerica-east1-aprovacao-de-arte-49bc3.cloudfunctions.net/envio
```

### Sobre a pasta de destino

O ID da sua pasta já está no código como padrão. Mas o escopo `drive.file` só
dá acesso aos arquivos que **a própria aplicação criou** — uma pasta que você
criou à mão costuma responder 404, mesmo sendo a mesma conta.

A função trata isso sozinha: testa a pasta configurada e, se não conseguir
alcançá-la, **cria uma pasta própria** chamada
*"Artes aprovadas — Aprovação de Arte"* no seu Drive e passa a usá-la. O ID
escolhido fica em `config/drive` no Firestore e aparece nos logs
(`firebase functions:log`). Pode mover ou compartilhar essa pasta à vontade —
mover não muda o ID.

Se você fizer questão de usar exatamente a pasta que já criou, gere o refresh
token com o escopo `https://www.googleapis.com/auth/drive` (completo) e defina
a variável de ambiente `DRIVE_ESCOPO` da função com esse valor. Aí a pasta
original passa a ser acessível — ao custo de dar ao app acesso a todo o seu
Drive, o que só recomendo se você usar uma conta Google dedicada a isso.

---

## Passo 4 — Ligar no frontend

Edite o `.env` na raiz e preencha as duas linhas vazias:

```env
VITE_ENVIO_ENDPOINT=https://southamerica-east1-aprovacao-de-arte-49bc3.cloudfunctions.net/envio
VITE_EVENTO_TOKEN=o-mesmo-valor-que-você-usou-no-TOKEN_EVENTO
```

Commit e push — o GitHub Actions publica sozinho.

O link para o expositor pode carregar o token na URL, o que permite trocá-lo
por evento sem republicar o site:

```
https://cleitonpn.github.io/aprovacao-de-arte/?e=TOKEN_DO_EVENTO
```

---

## Passo 5 — Conferir

1. Abra a ferramenta, preencha o cadastro, suba uma arte **aprovada** e clique
   em *Enviar arte para produção*. Deve aparecer um protocolo `AP-…`.
2. Confira o Drive: o arquivo chega como
   `stand__peca__protocolo.jpg`, dentro de uma subpasta com o nome da feira.
3. Abra `…/aprovacao-de-arte/#/admin`, entre com o Google e selecione a feira.

### Se der errado

| Sintoma | Causa provável |
|---|---|
| `permission-denied` no painel | falta o documento com seu e-mail em `admins` |
| `failed-precondition` no painel | falta o índice do Firestore — o link para criá-lo aparece no console do navegador |
| `Link do evento inválido` | `VITE_EVENTO_TOKEN` diferente do segredo `TOKEN_EVENTO` |
| Envio funcionava e parou depois de ~7 dias | app OAuth ainda em status "Teste" — publique |
| `invalid_grant` nos logs | refresh token expirado ou revogado; gere outro |
| Arquivo foi para uma pasta inesperada | o `drive.file` não alcançou a pasta configurada e a função criou a própria; veja `config/drive` no Firestore |

Logs: `firebase functions:log --only envio`

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
| Armazenamento das artes | dezenas de GB por evento | **R$ 0** até os 15 GB da conta Google; depois, Google One (~R$ 10/mês por 100 GB) |
| Cloud Function | ~2 chamadas por arte, alguns KB | **R$ 0** — cota de 2 M invocações/mês |
| Firestore | ~2 KB por arte | **R$ 0** — cota de 50 mil leituras/dia |
| Hospedagem | estática | **R$ 0** — GitHub Pages |

> ⚠️ Sem Workspace, as artes consomem os **15 GB gratuitos** da sua conta
> Google, compartilhados com Gmail e Fotos. Arte de grande formato é pesada:
> um evento pode consumir isso sozinho. Vale acompanhar e, quando apertar,
> assinar o Google One — continua sendo bem mais barato que o Firebase
> Storage para esse volume.
