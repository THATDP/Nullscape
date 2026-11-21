# NULLSCAPE — Publicação (GitHub Pages + Render)

Este guia assume que você já tem o repositório no GitHub e uma conta no Render.
Tudo abaixo usa **apenas planos gratuitos**.

> **Resumo do que vamos fazer**
> 1. O **backend** vai para o **Render** (Web Service Node).
> 2. O **frontend** vai para o **GitHub Pages** (via GitHub Actions).
> 3. Os dois são ligados por duas configurações: `VITE_SERVER_URL` (no GitHub) e
>    `CORS_ORIGINS` (no Render).

---

## 0. Ordem importa

Configure o **Render primeiro** (para ter a URL do servidor) e o **GitHub Pages
depois** (para ter a origem que o servidor deve permitir).

Se você fizer o contrário, o jogo abre mas não conecta — e o console do navegador
mostra erro de CORS. Não é bug: é a ordem das configurações.

---

## 1. Publicar o backend no Render

### 1.1 Pelo Blueprint (recomendado)

O repositório já contém `render.yaml`.

1. Acesse <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Conecte sua conta do GitHub e escolha o repositório **`Nullscape`**.
3. O Render lê o `render.yaml` e mostra o serviço `nullscape-server`.
4. Clique em **Apply**.
5. Aguarde o build (`npm ci`) e o start (`npm start`). O log deve mostrar:

   ```
   [boot] NULLSCAPE servidor na porta 10000 (env=production, versão=1.0.0)
   ```

6. Copie a URL do serviço, algo como:

   ```
   https://nullscape-server.onrender.com
   ```

### 1.2 Manualmente (se preferir)

1. **New +** → **Web Service** → escolha o repositório.
2. Preencha:

   | Campo | Valor |
   | --- | --- |
   | Name | `nullscape-server` |
   | Region | `Oregon` (ou a mais próxima) |
   | Root Directory | `backend` |
   | Runtime | `Node` |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Plan | `Free` |
   | Health Check Path | `/health` |

3. **Create Web Service**.

### 1.3 Variáveis de ambiente do Render

Em **Environment** do serviço, adicione:

| Chave | Valor | Obrigatória |
| --- | --- | --- |
| `NODE_ENV` | `production` | sim |
| `CORS_ORIGINS` | `https://SEU_USUARIO.github.io` | **sim** |
| `ALLOW_GITHUB_PAGES` | `true` | recomendada |
| `LOG_LEVEL` | `info` | opcional |
| `NODE_VERSION` | `20` | opcional (o `package.json` já pede `>=20`) |

> **Não** defina `PORT`: o Render injeta a porta e o servidor a respeita
> (`process.env.PORT`).
>
> **Não** use `CORS_ORIGINS=*` em produção. O servidor ignora `*` em produção a
> menos que você defina `ALLOW_ALL_ORIGINS=true` de propósito.

Se você usa um domínio próprio no Pages (ex.: `nullscape.exemplo.com`), coloque
**todos** os domínios separados por vírgula:

```
https://SEU_USUARIO.github.io,https://nullscape.exemplo.com
```

### 1.4 Verificar

```bash
curl https://nullscape-server.onrender.com/health
# {"ok":true,"status":"alive","uptimeSeconds":...,"rooms":0,...}

curl https://nullscape-server.onrender.com/api/status
```

---

## 2. Publicar o frontend no GitHub Pages

### 2.1 Ativar o Pages

1. No GitHub: **Settings** → **Pages**.
2. Em **Source**, escolha **GitHub Actions** (não "Deploy from a branch").
3. Pronto — o workflow `.github/workflows/deploy-pages.yml` cuida do resto.

### 2.2 Configurar a URL do servidor

1. **Settings** → **Secrets and variables** → **Actions** → aba **Variables**.
2. **New repository variable**:
   - Nome: `VITE_SERVER_URL`
   - Valor: `https://nullscape-server.onrender.com`
3. O workflow injeta isso no build (`VITE_SERVER_URL: ${{ vars.VITE_SERVER_URL }}`).

### 2.3 Disparar o deploy

- **Automático**: qualquer `push` em `main` que toque `frontend/`, `shared/` ou o
  próprio workflow.
- **Manual**: **Actions** → **Deploy frontend para GitHub Pages** → **Run
  workflow**.

Ao final, a URL aparece em **Settings → Pages**:

```
https://SEU_USUARIO.github.io/Nullscape/
```

> O `base: './'` do Vite faz o build funcionar em subdiretórios (essencial para
> Pages de projeto). O workflow também copia `index.html` para `404.html` e cria
> `.nojekyll`.

### 2.4 Fechar o ciclo (CORS)

Agora atualize `CORS_ORIGINS` no Render **com a origem exata do Pages**, sem
barra no final:

```
https://SEU_USUARIO.github.io
```

O Render reinicia o serviço automaticamente ao salvar a variável.

> `ALLOW_GITHUB_PAGES=true` já libera qualquer `https://*.github.io` — útil para
> previews de fork e PR. Se quiser travar só no seu, defina
> `ALLOW_GITHUB_PAGES=false` e use apenas `CORS_ORIGINS`.

---

## 3. Lendo o cold start do Render (plano gratuito)

O plano gratuito **hiberna** o serviço após ~15 minutos sem tráfego. Sintomas:

- a primeira conexão depois da hibernação demora **30–60 s**;
- o navegador mostra "sem conexão" por alguns segundos;
- o Socket.IO reconecta sozinho com backoff (0,8 s → 6 s).

O cliente já trata isso: o banner **"Conexão perdida. Tentando reconectar…"**
aparece e some quando o servidor acorda. **Não é preciso recarregar a página.**

Estratégias opcionais para reduzir a espera:

1. **Ping periódico externo** (ex.: cron-job.org, UptimeRobot) chamando
   `https://nullscape-server.onrender.com/health` a cada 10 min. Mantém o
   serviço quente dentro das regras do plano gratuito.
2. **Página de aquecimento**: o próprio cliente chama `/health` ao abrir o menu
   (o `NetClient.connect()` já estabelece o socket).
3. **Aceitar a espera**: o jogo é de exploração lenta; 40 s de "o mundo está
   acordando" combina com a atmosfera — mas não deixe de informar o jogador.

---

## 4. Rodar localmente em modo produção (teste antes de publicar)

```bash
# terminal 1 — backend
cd backend && npm ci && NODE_ENV=production PORT=3000 npm start

# terminal 2 — build + preview do cliente
cd frontend
VITE_SERVER_URL=http://localhost:3000 npm run build
npm run preview -- --port 4173
```

Abra `http://localhost:4173` em duas abas anônimas e confirme:
criação de sala, entrada pelo código, movimento sincronizado, um mecanismo
resolvido e o código de convite copiado.

Se `VITE_SERVER_URL` ficar vazio, o cliente tenta a mesma origem (funciona
apenas no `npm run dev`, onde o Vite faz proxy).

---

## 5. Checklist de publicação

- [ ] `backend/package.json` com `"start": "node src/index.js"` e `engines.node >= 20`.
- [ ] Render: root `backend`, health check `/health`, plano **Free**.
- [ ] Render: `CORS_ORIGINS` com a origem exata do Pages (sem `/`).
- [ ] GitHub: Pages → **Source: GitHub Actions**.
- [ ] GitHub: variável `VITE_SERVER_URL` com a URL do Render (sem `/`).
- [ ] Workflow verde em **Actions**.
- [ ] `/health` responde no Render.
- [ ] Abrir a URL do Pages em dois navegadores e entrar na mesma sala.
- [ ] Confirmar que o console não mostra erro de CORS.
- [ ] Confirmar que a queda de conexão mostra o banner e reconecta.

---

## 6. Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| Abre o menu, mas "sem conexão" | `VITE_SERVER_URL` não configurada no build | definir a variable e rodar o workflow de novo (o valor é **embutido no build**) |
| Erro de CORS no console | `CORS_ORIGINS` sem a origem do Pages | copiar a origem exata (sem `/` final) |
| "sala não encontrada" ao reconectar | sala ficou vazia por > 60 s | comportamento esperado; crie outra |
| Primeira conexão demora ~40 s | cold start do Render | ver seção 3 |
| Tela preta no jogo | WebGL indisponível | o Phaser cai para Canvas automaticamente; reporte com o console |
| Build falha com "shared not found" | `shared/` fora do repo | `shared/` precisa ser versionado e estar no mesmo nível de `frontend/` |
| 404 ao atualizar a página no Pages | `404.html` ausente | o workflow copia `index.html` → `404.html` |
| `npm ci` falha no Render | `package-lock.json` ausente | commitar `backend/package-lock.json` |

---

## 7. Atualizações futuras

- **Nova versão do servidor**: `push` em `main` → Render faz auto-deploy
  (`autoDeploy: true` no `render.yaml`).
- **Nova versão do cliente**: `push` → workflow do Pages.
- **Incompatibilidade de protocolo**: se você mudar o protocolo de rede, suba a
  `version` em `backend/package.json` e reinicie o Render **depois** do Pages,
  para não deixar clientes antigos presos. (A v1 não implementa versionamento de
  protocolo — é um ponto de evolução consciente.)
