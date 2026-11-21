# NULLSCAPE

> **Explorador de espaços liminares. Multiplayer. Sem cadastro.**
> Quatro regiões impossíveis, quatro mecanismos cooperativos, quatro sigilos.
> O medo não vem de sustos: vem da arquitetura.

NULLSCAPE é um jogo 2D multiplayer de exploração surreal em espaços liminares.
Até **6 jogadores** entram na mesma sala, recebem **o mesmo mundo procedural**
(a partir de uma semente compartilhada) e precisam descobrir, juntos, como
atravessar quatro regiões que parecem familiares e estão profundamente erradas.

Nada de combate. A única ferramenta é saber **quando andar, quando parar, quando
falar e quando olhar para o outro lado**.

---

## Estado do projeto

| Item | Status |
| --- | --- |
| Servidor autoritativo (Express + Socket.IO) | ✅ |
| Mundo procedural determinístico (4 regiões, 40×40 tiles cada) | ✅ |
| Regras de iluminação próprias por ambiente (densidade/raio/instabilidade) | ✅ |
| 8 ambientes com identidade visual/sonora | ✅ |
| 6 quebra-cabeças cooperativos | ✅ |
| 7 criaturas com IA por estados | ✅ |
| 11 anomalias com raridade e regra interna | ✅ |
| Reconexão com token de sessão | ✅ |
| Loops de teste: **87 testes** (unit + integração com 6 clientes Socket.IO reais) + **25 verificações** de fumaça no cliente | ✅ |
| Build de produção (Vite) | ✅ |
| Deploy: GitHub Pages + Render | ✅ (instruções em `docs/PUBLICACAO.md`) |
| Teste manual em navegadores reais | ⚠️ **necessário** — ver `docs/TESTES.md` |

---

## Estrutura

```
.
├── frontend/            # Cliente Phaser 3 + Vite (HTML/CSS/JS puros)
│   ├── src/
│   │   ├── game/        # cena, arte procedural, áudio WebAudio
│   │   ├── net/         # cliente Socket.IO, predição, interpolação
│   │   ├── ui/          # telas, HUD, preferências
│   │   └── main.js      # orquestração do app
│   ├── scripts/         # smoke test do cliente (jsdom)
│   └── vite.config.js
├── backend/             # Servidor autoritativo Node.js
│   ├── src/
│   │   ├── index.js     # Express + Socket.IO + loop de simulação
│   │   ├── net.js       # protocolo, validação, rate limit
│   │   ├── rooms.js     # salas, sessões, limpeza
│   │   └── logger.js    # config por ambiente + logs
│   └── test/            # 87 testes (node:test)
├── shared/              # CÓDIGO COMPARTILHADO servidor ↔ cliente
│   ├── world/           # gerador procedural, temas, RNG
│   └── sim/             # física, criaturas, anomalias, puzzles
├── docs/                # documentação em português
├── .github/workflows/   # CI + deploy no GitHub Pages
└── render.yaml          # Blueprint do Render
```

O diretório `shared/` é importado **por caminho relativo** pelos dois lados.
Não há cópia de código: a física do cliente é literalmente a mesma função que o
servidor executa. Isso é o que faz a predição local convergir em vez de "puxar"
o jogador para trás.

---

## Rodar localmente

Requisitos: **Node.js 20+** (`nvm use` respeita o `.nvmrc`).

```bash
# 1) servidor
cd backend
npm ci
npm run dev            # http://localhost:3000  (health: /health)

# 2) cliente (em outro terminal)
cd frontend
npm ci
npm run dev            # http://localhost:5173
```

O Vite usa proxy para `/socket.io`, `/api` e `/health` → `localhost:3000`.
Assim o cliente funciona **sem variável de ambiente** em desenvolvimento.

Para testar multiplayer de verdade, abra **duas janelas anônimas** (ou dois
navegadores diferentes) e entre com o mesmo código de convite.

### Variáveis de ambiente

**Backend** (`backend/.env.example`):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | porta HTTP/Socket.IO (o Render injeta automaticamente) |
| `CORS_ORIGINS` | `http://localhost:5173` | lista separada por vírgula |
| `ALLOW_GITHUB_PAGES` | `true` | aceita origens `https://*.github.io` |
| `ALLOW_UNKNOWN_ORIGINS` | `false` | **não usar em produção** |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `NODE_ENV` | `development` | `production` no Render |

**Frontend** (`frontend/.env.example`):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `VITE_SERVER_URL` | *(vazio)* | vazio = mesma origem (proxy). Em produção: URL do Render |

Nenhum segredo é embutido no bundle: o cliente só conhece a URL pública do
servidor.

---

## Como o jogo funciona

### 1. Quatro regiões, uma travessia

Cada mundo é uma faixa contínua de **4 regiões de 40×40 tiles**. Cada região
recebe um dos **8 ambientes** (escritórios, hotel, piscinas internas,
estacionamento, escola, industrial, residencial, limiares) com paleta,
mobiliário, luzes, ambiência sonora e anotações próprias.

A conectividade é garantida por construção:

- uma **árvore geradora (Prim)** conecta todas as salas;
- **arestas extras** criam rotas alternativas e becos sem saída intencionais;
- corredores são roteados com **A\*** que nunca atravessa o interior de salas —
  logo, **toda passagem é uma porta de verdade** (tile `DOORWAY`);
- o gerador valida o resultado com BFS e **regenera com outra semente derivada**
  se algo ficar inalcançável (`generateValidWorld`).

### 2. Quatro mecanismos, quatro sigilos

Cada região esconde **um quebra-cabeça cooperativo diferente**:

| Mecanismo | Regra |
| --- | --- |
| `valvePair` | duas válvulas em salas diferentes, giradas dentro de 9s |
| `breakerOrder` | 3 disjuntores na ordem certa (a ordem está numa anotação) |
| `holdLever` | alguém segura a alavanca, outra pessoa pisa no botão |
| `pressurePlates` | duas placas ocupadas ao mesmo tempo |
| `keycard` | um cartão esquecido num armário abre o leitor |
| `silenceChoir` | tocar o sino 3× respeitando a pausa |

Resolver o mecanismo **revela o sigilo** na câmara secreta da região.
Os **portões de fronteira** exigem 1, 2 e 3 sigilos. O **Altar** na última região
pede os 4.

### 3. Criaturas que não "apenas perseguem"

Cada criatura tem estado interno, percepção, telegrafia e **contra-jogo**:

| Criatura | Comportamento | Contra-jogo |
| --- | --- | --- |
| O Garçom | patrulha; aproxima de quem fica **parado** | continue andando |
| O Lento | só avança **enquanto observado**; congela se você desviar | desvie o olhar (e ele reaparece em outro lugar) |
| O Ouvinte | investiga **ruído** (correr, portas, botões) | ande devagar |
| O Solitário | só se manifesta com um jogador **isolado** | fiquem juntos |
| O Espelho | imita sua trajetória **com 1,4s de atraso** | mude de direção |
| O Vigia | nunca se aproxima; **aprende** onde você esteve | não fique na mesma área |
| A Válvula Orgânica | apaga luzes e fecha portas | afaste-se dela |

A IA roda com atualização escalonada no servidor. Nenhuma criatura nasce em
cima do jogador e o número de criaturas vivas é limitado.

### 4. Anomalias com regras internas

11 anomalias divididas em `sutil`, `moderada`, `rara` e `impossível`. A escolha
depende da **tensão medida da sala** (jogadores parados, dispersão do grupo,
tempo desde o último evento) — nunca puramente aleatória. Todas têm duração
curta e cooldown próprio; `impossível` só acontece com tensão alta.

### 5. Áudio

Tudo sintetizado em tempo real (WebAudio), sem arquivos:

- ambiência por tema (drone, ar-condicionado, eco de piscina, vento, relógio);
- sons diegéticos com **atenuação por distância**;
- respiração lenta do prédio (LFO);
- **silêncio intencional** (`cutAmbience`) em momentos de tensão.

### 6. Arquitetura de rede

- **Servidor autoritativo**: posição, vida, portas, mecanismos, criaturas,
  anomalias e progresso vivem no servidor.
- **Cliente envia intenções**: `input {seq,dx,dy,run,look}` a 8–20 Hz.
- **Predição local** com o mesmo módulo de física de `shared/sim/physics.js`.
- **Interpolação** de corpos remotos com 110ms de atraso.
- **Snapshots seletivos**: movimento a 20 Hz (volatile), estado compartilhado a
  4 Hz, eventos pontuais.
- **Validação**: vetores normalizados, velocidade máxima, cooldown de interação,
  orçamento de 12 interações/minuto, rate limit de 45 msgs/s, payload ≤ 4 KB.
- **Reconexão**: token `ns_<uuid>` persistido no navegador; o servidor mantém o
  corpo por 90s.

Detalhes completos em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

---

## Testes

```bash
cd backend
npm test              # 87 testes (unit + integração com 6 clientes reais)
npm run test:unit     # gerador, física, criaturas, puzzles, salas
npm run test:integration
```

```bash
cd frontend
npm run smoke         # DOM + servidor real + Socket.IO (jsdom)
npm run build         # build de produção
```

O teste de integração sobe o servidor em uma porta efêmera, conecta **6
clientes Socket.IO reais**, valida movimento sincronizado, rejeição de
teleporte, quebra-cabeças, portões, reconexão e limpeza de salas vazias.

⚠️ **Ainda é necessário o teste manual em navegadores reais** (ver
`docs/TESTES.md`) antes de declarar o multiplayer "pronto para o público".

---

## Publicação

Passo a passo completo, em português, em **[`docs/PUBLICACAO.md`](docs/PUBLICACAO.md)**:

1. `main` → GitHub Actions publica `frontend/` no **GitHub Pages**.
2. `backend/` → **Render** via `render.yaml` (plano gratuito).
3. Configure `VITE_SERVER_URL` (variable do repositório) e `CORS_ORIGINS`
   (env var do Render) com a URL um do outro.

> **Plano gratuito do Render**: o serviço hiberna após ~15 min sem tráfego.
> A primeira conexão depois disso leva 30–60s. O cliente detecta a queda,
> mostra _"reconectando"_ e tenta novamente com backoff. Veja
> `docs/PUBLICACAO.md#lendo-o-cold-start`.

---

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | decisões técnicas, perspectiva, rede, IA, desempenho |
| [`docs/MUNDO.md`](docs/MUNDO.md) | ambientes, criaturas, anomalias, quebra-cabeças (lore + regras) |
| [`docs/PUBLICACAO.md`](docs/PUBLICACAO.md) | GitHub Pages, Render, CORS, variáveis, cold start |
| [`docs/TESTES.md`](docs/TESTES.md) | o que foi testado, como testar manualmente em navegadores |
| [`docs/DESIGN.md`](docs/DESIGN.md) | direção de arte, tipografia, som, acessibilidade |

---

## Licença e originalidade

Código e conteúdo original deste repositório. **Nenhum asset de franquia
existente é usado**: todos os tiles, móveis, criaturas, ícones e sons são
gerados proceduralmente em canvas/WebAudio na inicialização do cliente.

Phaser 3, Vite, Express e Socket.IO são dependências open-source com suas
próprias licenças.
