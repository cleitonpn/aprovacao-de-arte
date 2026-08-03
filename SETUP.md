# Configuração — 5 minutos, só telas do Firebase

Roteiro para ligar o envio de arte e o painel do time. A ferramenta **já
funciona sem nada disto** — a análise inteira roda no navegador. Isto liga o
botão *Enviar arte para produção* e a tela `#/admin`.

| | |
|---|---|
| Projeto Firebase | `aprovacao-de-arte-49bc3` |
| Admin do painel | `cleitonpnascimento@gmail.com` |

**Já feito:** ✅ plano Blaze · ✅ Authentication com Google · ✅ Firestore +
coleção `admins`

**Falta:** 5 passos, todos no Firebase Console. Nenhum terminal, nenhuma
credencial para gerar, nada no Google Cloud Console.

---

## Passo 1 — Ligar o login anônimo

👉 https://console.firebase.google.com/project/aprovacao-de-arte-49bc3/authentication/providers

1. Na lista de provedores, clique em **Anônimo**.
2. Ative a chave e **Salvar**.

**Para que serve:** é isto que permite o expositor enviar a arte **sem fazer
login**. O navegador dele recebe uma credencial descartável, sem tela e sem
senha — ele nem percebe que existe. As regras de segurança exigem essa
credencial para aceitar qualquer gravação; sem ela, o projeto ficaria aberto
ao mundo.

---

## Passo 1.5 — Autorizar o domínio do site

👉 https://console.firebase.google.com/project/aprovacao-de-arte-49bc3/authentication/settings

Em **Domínios autorizados**, clique em *Adicionar domínio* e inclua:

```
cleitonpn.github.io
```

**Por que isso é obrigatório:** o Firebase só aceita login com Google vindo de
domínios que você autorizou. De fábrica a lista tem só `localhost` e
`aprovacao-de-arte-49bc3.firebaseapp.com` — o endereço do GitHub Pages não
está lá. Sem isso, o botão *Entrar com Google* do painel abre a janela e falha
com `auth/unauthorized-domain`.

O envio do expositor **não** depende disto (a sessão anônima não usa janela de
login), então esse erro atinge só o painel do time.

---

## Passo 2 — Criar o Storage

👉 https://console.firebase.google.com/project/aprovacao-de-arte-49bc3/storage

1. **Começar** (*Get started*).
2. Escolha **Iniciar no modo de produção** → **Avançar**.
3. Região: **`southamerica-east1`** (São Paulo) → **Concluído**.

Não se preocupe com as regras que ele cria — vamos substituí-las no passo 4.

---

## Passo 3 — Colar as regras do Firestore

👉 https://console.firebase.google.com/project/aprovacao-de-arte-49bc3/firestore/rules

1. Apague tudo o que estiver na caixa de texto.
2. Cole o conteúdo do arquivo **[`firestore.rules`](firestore.rules)** deste
   repositório.
3. **Publicar**.

**O que essas regras fazem** — e por que valem a colagem:

- **Repetem a trava do veredicto no servidor.** A interface já impede o clique
  em "enviar" quando a arte foi reprovada, mas interface se contorna. Estas
  regras rodam no Google: arte reprovada não entra, e arte com ressalva só
  entra se o aceite de risco estiver registrado junto.
- **Envio é só criação, nunca alteração.** Ninguém sobrescreve o envio de
  outro expositor, nem adultera o próprio depois de feito.
- **Só admin lê.** O expositor consegue gravar o envio dele e nada mais — não
  consegue listar, ler nem apagar envios de ninguém.

---

## Passo 4 — Colar as regras do Storage

👉 https://console.firebase.google.com/project/aprovacao-de-arte-49bc3/storage/rules

1. Apague tudo.
2. Cole o conteúdo de **[`storage.rules`](storage.rules)**.
3. **Publicar**.

Limitam a pasta, o tipo (JPG, PNG, PDF) e o tamanho (até 1 GB), e proíbem
sobrescrever arquivo existente. Leitura é negada de propósito: o painel usa o
link gerado no momento do envio, que tem token próprio, então ninguém
consegue varrer o armazenamento procurando arte de outros clientes.

---

## Passo 5 — Publicar o site

👉 https://github.com/cleitonpn/aprovacao-de-arte/actions/workflows/deploy.yml

**Run workflow** → **Run workflow**. Em uns 2 minutos o site está no ar com o
envio ligado.

Link para o expositor:

```
https://cleitonpn.github.io/aprovacao-de-arte/
```

Link do painel do time:

```
https://cleitonpn.github.io/aprovacao-de-arte/#/admin
```

---

## Conferir

1. Abra a ferramenta, preencha o cadastro, suba uma arte **aprovada** e clique
   em *Enviar arte para produção*. Deve aparecer um protocolo `AP-…`.
2. Abra o painel, entre com o Google, escolha a feira e confira se a arte está
   lá com o botão **Baixar**.

### Se der errado

| Sintoma | Causa provável |
|---|---|
| `auth/unauthorized-domain` ao entrar | falta `cleitonpn.github.io` nos domínios autorizados (passo 1.5) |
| `permission-denied` no painel | falta o documento com seu e-mail na coleção `admins` — o **ID do documento** tem que ser o e-mail inteiro |
| Envio recusado pelas regras | regras não publicadas, ou publicadas só num dos dois lugares (Firestore **e** Storage) |
| `auth/operation-not-allowed` no envio | o login **Anônimo** não foi ativado no passo 1 |
| Botão de envio não aparece | o site foi publicado antes de o Storage existir — rode o workflow de novo |

---

## O painel do time

`#/admin` → escolhe a feira e mostra tudo o que chegou:

- quem enviou, com e-mail clicável, stand e localização;
- peça, medidas e veredicto (com marcação de "risco aceito" quando houver);
- **Baixar** individual, ou **Baixar as N artes** em lote — o navegador pede
  permissão para baixar vários arquivos uma vez e depois libera o resto;
- **Exportar planilha (CSV)** para abrir no Excel;
- **Baixar lista de links** em texto;
- filtro por expositor, stand ou peça.

Para liberar mais alguém do time, crie um documento na coleção `admins` com o
e-mail da pessoa como **ID do documento**. Isso é feito só pelo console, de
propósito: assim ninguém se autopromove pela aplicação.

---

## O que fica registrado

Cada envio grava um documento em `envios/{protocolo}` com o cadastro completo
do expositor, a peça, o veredicto, o **aceite de risco com data e hora**, o
laudo técnico inteiro e o **SHA-256 do arquivo**.

O hash é o que dá valor ao registro: quando alguém reclamar do resultado
impresso, existe a prova de qual arquivo exato foi aprovado, por quem e
quando.

---

## Custos

| Item | Consumo esperado | Custo estimado |
|---|---|---|
| Armazenamento | ~20 GB por evento | ~R$ 3/mês por evento acumulado |
| Download pelo time | ~20 GB por evento | ~R$ 13 por evento |
| Firestore | ~2 KB por arte | R$ 0 — cota gratuita |
| Hospedagem | estática | R$ 0 — GitHub Pages |

Ou seja, algo entre **R$ 15 e R$ 25 por evento**. Vale um lembrete honesto: a
opção de guardar no Google Drive sairia de graça, já que vocês têm o plano de
5 TB — mas exigiria consentimento OAuth, cliente OAuth, refresh token e conta
de serviço. Ficou como possibilidade futura; o código dessa versão está no
histórico do repositório, no commit anterior a este.

## Uma limitação que vale conhecer

O envio é aberto: qualquer pessoa com o link pode enviar arte, porque é
justamente isso que evita a barreira de login para o expositor. As regras
limitam bastante o estrago (só JPG/PNG/PDF, até 1 GB, só criação, sem
leitura), mas não impedem alguém mal-intencionado de encher o armazenamento.

Se um dia isso incomodar, o remédio é o **Firebase App Check** com reCAPTCHA:
ele garante que as chamadas vêm mesmo da página de vocês, e continua invisível
para o expositor. São mais uns 10 minutos de configuração — dá para ligar
depois, sem mexer no resto.
