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

> 🔁 **Se você já colou as regras antes, cole de novo.** As duas mudaram para
> incluir os projetos, os arquivos de apoio e o cadastro de analistas. Sem
> republicar, o cadastro de projetos falha com *permissão negada* e o link do
> cliente abre vazio.

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

| Pasta | O que aceita | Limite |
|---|---|---|
| `envios/` | arte de peça: JPG, PNG, PDF | 1 GB |
| `avulsos/` | apoio: SVG, EPS/AI, ZIP + os acima | 200 MB |

Misturar as duas obrigaria a afrouxar a regra da arte, e aí um `.zip` passaria
a ser aceito como peça para impressão.

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

### 1. Cadastrar os projetos da feira (`#/projetos`)

**Importar planilha** é o caminho que se paga. Aceita os dois formatos que as
planilhas de produção têm na prática:

**Uma linha por peça** (recomendado):

```
feira;cliente;email;stand;localizacao;peca;tipo;largura;altura;escala
Expo Sul 2026;Buddy Nutrition;ana@buddy.com;Buddy;Rua 3;Lona de fundo;lona;275;275;1:1
Expo Sul 2026;Buddy Nutrition;ana@buddy.com;Buddy;Rua 3;Adesivo do balcão;adesivo;100;100;1:1
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
  ficou de fora, com o número da linha.

Uma coisa ela **não** faz de propósito: adivinhar unidade. `10 x 10` tanto pode
ser adesivo de 10 cm quanto lona de 10 m — chutar recriaria o erro silencioso
que o cadastro veio eliminar. Vira aviso para conferência.

### 2. Mandar o link para o cliente

Cada projeto tem **Copiar link do cliente**. O link não pede login nem senha —
o cliente pode encaminhar direto para a agência que faz a arte, que é quem
normalmente monta o arquivo.

### 3. Cobrar o que falta

O painel mostra `3 de 5` por stand. **Cobrar por e-mail** abre o e-mail já
escrito, com a lista das peças pendentes, as medidas e o link. Também dá para
copiar de uma vez os e-mails de todos os stands com pendência.

### 4. Baixar (`#/admin`)

Igual a antes, agora com o nome da peça cadastrada em cada arquivo.

---

## Analistas (`#/analistas`)

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

### Se der errado

| Sintoma | Causa provável |
|---|---|
| `auth/unauthorized-domain` ao entrar | falta `cleitonpn.github.io` em Authentication → Settings → Domínios autorizados |
| "Conta ainda não liberada" | o e-mail não está na coleção `admins` — libere em `#/analistas` |
| Analista novo não entra | ele ainda não clicou no link de confirmação do e-mail |
| `permission-denied` ao cadastrar projeto | regras do **Firestore** desatualizadas (passo 1) |
| Link do cliente abre "Link não encontrado" | regras do Firestore desatualizadas, ou o token foi copiado pela metade |
| "envio do **arquivo** recusado" | regras do **Storage** desatualizadas (passo 2) |
| "registro do envio recusado" | regras do **Firestore** desatualizadas (passo 1) |
| Arquivo de apoio recusado | regras do Storage sem a pasta `avulsos/` — republique |
| Planilha importa com acento quebrado | salve como *CSV UTF-8* no Excel (a ferramenta tenta os dois, mas o UTF-8 é o certo) |

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
