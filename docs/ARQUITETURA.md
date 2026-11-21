# NULLSCAPE — Arquitetura

Este documento registra **por que** o jogo foi construído assim, não apenas como.
Leia junto com o código de `shared/` — ele é a fonte de verdade.

---

## 1. Perspectiva: oblíqua (top-down 3/4)

Foram avaliadas três opções:

| Perspectiva | Prós | Contras | Veredito |
| --- | --- | --- | --- |
| **Top-down puro** | fácil de ler, colisão simples | perde a sensação de "dentro" do espaço, móveis viram manchas | rejeitado |
| **Lateral 2D** | boa para animação e sombra | péssimo para espaços interligados (salas/corredores) e para 6 jogadores se localizando | rejeitado |
| **Oblíqua (top-down 3/4)** | lê planta baixa **e** dá volume; paredes mostram "topo iluminado" e sombra; móveis têm altura | exige arte desenhada em camadas | **escolhido** |

Decisões de implementação:

- cada tile de parede recebe uma **faixa superior clara** (a luz do teto) e uma
  **sombra inferior** — a leitura é de um corredor visto de cima e de frente ao
  mesmo tempo;
- móveis projetam sombra elíptica no chão;
- criaturas e jogadores têm sombra própria;
- a câmera fica **achatada em Z** (sem rotação por padrão). A única exceção é a
  anomalia `geometry`, que inclina a câmera em ~0.7° por alguns segundos.

**Não misturamos perspectivas.** A tela de menu usa uma "foto" do corredor em
CSS puro (gradientes), mas o jogo em si é 100% oblíquo.

### Câmera

- `startFollow(player, true, 0.09, 0.09)` — lerp suave;
- `deadzone(90, 60)` — o jogador pode se mover um pouco sem a câmera "colar";
- zoom adaptativo por largura de tela (1.35 → 1.75 no celular);
- limites do mundo (`setBounds`) impedem ver o vazio além do mapa;
- efeitos: shake curto em dano, flash em mecanismo resolvido, zoom lento na
  anomalia `repeat`, rotação sutil em `geometry`.

---

## 2. Mundo procedural

### 2.1 Semente e determinismo

Tudo deriva de uma seed textual (`SEED` normalizada em maiúsculas). O RNG é
`mulberry32` semeado por `xmur3` (`shared/world/rng.js`). Cada fase usa um
**sub-gerador derivado** (`rng.fork('region-2')`), então adicionar uma fase nova
não altera as anteriores.

Teste: `worldgen.test.js` → "mesma seed gera exatamente o mesmo mundo".

### 2.2 Composição

```
4 regiões × 40×40 tiles = 160×40 tiles (5120×1280 px)
  ├── 6–8 salas por região (+1 câmara secreta)
  ├── árvore geradora (Prim) + 1–3 arestas extras (ciclos)
  ├── corredores roteados com A* que NÃO entram em salas
  ├── portas explícitas (tile DOORWAY) em cada extremidade de corredor
  ├── mobiliário que vira parede (WALL) quando bloqueante
  ├── luzes de teto (flicker por tema)
  └── câmara secreta com tema "errado" (recompensa visual)
```

Regras de composição:

1. salas nunca se sobrepõem (margem de 2 tiles);
2. toda sala é alcançável — validado com BFS;
3. **toda passagem é uma porta** — corredores não atravessam paredes;
4. câmaras secretas são ligadas por corredores de largura 1;
5. a última região tem uma **sala de saída** com o Altar;
6. se qualquer regra falhar, `generateValidWorld` tenta outra seed derivada
   (`SEED:7919`, `SEED:15838`, …) até 16 vezes.

### 2.3 Serialização

- grid por região em **RLE** (`[[tile,count],...]`) — ~5 KB por região;
- payload completo do mundo (grids + salas + props + luzes + portas + puzzles +
  notas + sigilos) fica **entre 38 e 43 KB** (medido em 12 seeds);
- o cliente decodifica o RLE localmente e desenha o mapa uma única vez.

---

## 3. Rede

### 3.1 Topologia

```
Navegador (Phaser) ──Socket.IO──> Node/Express ──> Room -> RoomSystems
        ▲                               │
        └──── snapshots (20 Hz) ◄───────┘
```

### 3.2.0 HTTP (fora do WebSocket)

| Rota | Uso | Resposta principal |
| --- | --- | --- |
| `GET /health` | health check do Render, monitoramento, *warm-up* | `{ok, status:'alive', uptimeSeconds, rooms, players, version, now}` — sempre `200` se o processo está de pé |
| `GET /ready` | readiness (libera tráfego) | `{ok}`; `503` se o `RoomManager` não inicializou |
| `GET /api/status` | números do servidor | `{ok, version, tickRate:20, maxPlayersPerRoom:6, rooms, players, uptimeSeconds}` |
| `GET /api/rooms` | diretório público de salas (máx. 60, salas privadas omitidas) | `{rooms:[{id,name,code,players,max,hostName,region,seed,started,private}], now}` |
| `GET /api/rooms/:code` | detalhe de uma sala (o mesmo objeto da lista) | `{room}` ou `404 {error}` |
| `GET /api/preview/:seed` | diagnostica a geração de um mundo **sem criar sala** | `{seed, hash, themes:[0..3], rooms, puzzles, validation, sizeBytes}` |
| `GET /api/codex` | conteúdo do código in-game | `{creatures:[{id,label,note,telegraph,behavior}], anomalies:[{id,label,rarity,message,rule}]}` |

> `/health` responde **200 mesmo com o jogo vazio** — é o endpoint que o Render
> usa no `healthCheckPath`. Se você recebe 502 no Render, o problema é o
> processo não subir (porta/build), não a lógica do jogo.

### 3.2 Protocolo resumido

**Cliente → servidor**

| Evento | Payload | Observações |
| --- | --- | --- |
| `hello` | `{name, clientId}` | devolve token `ns_<uuid>` se não houver |
| `room:create` | `{name, roomName, seed, private, clientId}` | ack com mundo completo |
| `room:join` | `{code \| roomId, name, clientId}` | ack com mundo completo |
| `room:rejoin` | `{code, clientId}` | restaura o mesmo corpo |
| `room:leave` | `{}` | |
| `input` | `{seq, dx, dy, run, look}` | `volatile`, 8–20 Hz |
| `interact` | `{targetId}` | ack com `hint`/`error` |
| `respawn` | `{}` | |
| `ping:client` | `{t}` | mede RTT e offset de relógio |

**Servidor → cliente**

| Evento | Payload | Frequência |
| --- | --- | --- |
| `s` | `{t, p:[{i,x,y,d,hp,dead,dc,run,st}]}` | 20 Hz, `volatile` |
| `st` | progresso, portas, puzzles, sigilos, criaturas, anomalias | 4 Hz |
| `e` | `{events:[...]}` | pontual |
| `lobby` | lista de jogadores | em mudanças |
| `rooms` | diretório público | ~6 s |

### 3.2.1 Serialização × hidratação (cliente)

O servidor trafega o mundo **comprimido** (RLE), mas a física compartilhada
precisa de grids indexáveis (`get(gx, gy)`). A ponte é `hydrateWorld(payload)`
em `shared/world/generator.js`:

```
serializeWorld(world)  --rede-->  hydrateWorld(payload)  --physica--> stepMovement()
```

- roda **uma vez por mundo recebido** (criar/entrar/reconectar);
- reconstrói `regions[].grid` (get/set/inside), `offset`, e os agregados
  (`props`, `lights`);
- **não** duplica estado dinâmico: portas, sigilos, puzzles e criaturas vivem no
  snapshot `st`;
- `applyDoorStates(world, shared.doors)` espelha o estado de portas no grid
  local. O servidor envia **apenas portas fechadas**; as ausentes são abertas —
  isso evita que uma porta reaberta por outro jogador fique sólida na predição.

> Esta camada é o que permite o cliente rodar *literalmente* a física do
> servidor. Sem ela a predição quebra no primeiro frame — há teste de regressão
> em `physics.test.js` e no smoke do cliente.

### 3.2.1.1 Câmaras secretas (mundo) — ver também §3.1

`trySecretChamber` roda **antes** de cavar corredores e faz até **9 tentativas
progressivas** (tamanho 6–8 → 5–7 → 4–6 tiles; margem 3 → 2; distância máxima da
sala-anfitriã 18 → 20 → 24). Uma única tentativa deixava ~19% das regiões sem
câmara e 45% dos mundos sem nenhuma. Hoje: **~99% das regiões** têm câmara e
todo mundo tem pelo menos uma. O corredor tem duas chances (com e sem a lista de
bloqueios) antes de a câmara ser descartada.

### 3.2.2 Colisão de portões

Portões de fronteira são validados **na física**, não na UI: `circleBlocked`
consulta `world.doors` e trata cada portão fechado como um AABB em coordenadas
de mundo. Assim cliente e servidor concordam sem mutação de grid e sem
divergência de predição.

### 3.3 Predição e reconciliação

```js
// cliente (GameScene.updateLocalPlayer)
stepMovement(world, localState, input, dt);   // MESMA função do servidor
```

- o cliente nunca envia posição, apenas **intenção**;
- **reconciliação suave**: o snapshot do próprio jogador (`NetClient.ownState()`)
  corrige a posição local por fração (~0,2 s para erros de poucos pixels) e
  instantaneamente acima de 3 tiles (respawn, porta fechada, teleporte);
- o servidor aplica `applyInput` → `stepMovement` no `tick` de 50ms;
- vetores são normalizados (`mag > 1`), `NaN` descartado;
- velocidade máxima imposta pela física (`SPEED_RUN * 1.02`);
- como a física é idêntica, a divergência é ~0 com os mesmos inputs;
  `physics.test.js` comprova com 90 frames de input complexo.

### 3.4 Interpolação

`NetClient.interpolated(playerId)` mantém um buffer de até 24 snapshots e
renderiza com **110 ms de atraso**. Corpos remotos ainda passam por um lerp
visual de 0.35 para suavizar jitter.

### 3.5 Limites e validação

| Proteção | Valor |
| --- | --- |
| Rate limit geral | 45 mensagens/s por socket |
| Rate limit de interação | 18/s por socket + 1/180ms por jogador |
| Orçamento de interações | 12/min por jogador |
| Payload máximo | 4 KB (rede) / 64 KB (engine) |
| Jogadores por sala | 6 |
| Criaturas ativas | 5 por sala |
| Nome | 18 caracteres, apenas letras/números/` _-.'’` |
| Sessão | token `ns_<uuid>` |

Nenhum segredo é enviado ao cliente. CORS é validado tanto no Express quanto no
`allowRequest` do Socket.IO.

### 3.6 Reconexão

1. O cliente guarda `clientId` em `localStorage`.
2. Se o socket cai, `reconnect` do Socket.IO tenta reconectar.
3. Ao reconectar, envia `room:rejoin {code, clientId}`.
4. O servidor procura um jogador **desconectado** com o mesmo `clientId`, troca
   o socket, mantém posição/vida/inventário.
5. Se o jogador não voltar em **90 s**, é removido e o sigilo que carregava
   volta ao mundo.

### 3.7 Ciclo de vida de uma sala

```
createRoom() -> initWorld() (gera mundo, cria sistemas, nasce 1 criatura)
   │
   ├── jogadores entram/saem (lobby sempre atualizado)
   ├── tick global 20 Hz -> room.tick() -> criaturas, puzzles, anomalias
   ├── rooms vazias: lastEmptyAt marcado
   └── cleanup a cada 15 s: remove salas vazias há > 60 s
```

---

## 4. IA das criaturas

`shared/sim/creatures.js` — 7 arquétipos, todos com estado interno:

```js
{ id, kind, x, y, state, stateData, awareOf, targetPlayerId,
  cooldown, lastSeen, memory, aggro, memory.hotspots }
```

- **Percepção**: distância em tiles (sight/hearing por tipo) + `playerLookingAt`.
- **Comportamentos** (`behavior`): `patrolServe`, `observedChase`, `huntNoise`,
  `stalkIsolated`, `mirrorPlayer`, `observeLearn`, `alterEnvironment`.
- **Ataque**: somente com alcance + cooldown + condição própria
  (ex.: O Garçom recusa atacante em movimento; O Lento exige ser observado).
- **Telegrafia**: evento `telegraph` com som posicional antes da ameaça.
- **Custo**: até 5 criaturas, atualizadas no tick de 20 Hz com lógica barata
  (sem pathfinding pesado — movimento em direção com colisão).
- **Limpeza**: sala sem jogadores → `clear()`.

> A regra de ouro: **nenhuma criatura persegue todos os jogadores o tempo todo**.
> Cada uma tem uma condição que o jogador pode aprender e evitar.

---

## 5. Anomalias

`shared/sim/anomalies.js`:

```js
tension = idleRatio*0.35 + separation*0.35 + sinceLastEvent*0.3
```

A escolha usa peso × multiplicador por raridade, com multiplicadores que
**crescem com a tensão** para as raras/impossíveis. Anomalias ativas expiram por
`endsAt`; o cliente visualiza `client` (`flicker`, `shift`, `geometry`…).

Eventos vindos das criaturas (`envEvents`) também são convertidos em anomalias
(`organ` → apagão local; `watcher` → "janela").

---

## 6. Desempenho

| Técnica | Onde |
| --- | --- |
| RenderTexture por região (mapa desenhado 1×) | `worldview.js` |
| Culling manual de luzes (máx. 26 por frame) | `GameScene.updateLights` |
| Partículas com `frequency: 90` e desligadas em modo reduzido | `GameScene.build` |
| Snapshots `volatile` (descartáveis) | `index.js` |
| `movementSnapshot` compacto (sem nomes) | `rooms.js` |
| Estado compartilhado a 4 Hz, não 20 Hz | `index.js` |
| Geração de mundo com cache por sala (1× por sessão) | `rooms.initWorld` |
| Limite de criaturas e de salas (120) | `creatures.js`, `rooms.js` |
| IA **escalonada**: cada criatura pensa a ~10 Hz (2 ticks de 20 Hz), deslocada por id | `creatures.update` |
| Checagem de ataque em todo tick (barata) para não atrasar dano | `creatures.update` |

Medições dos testes:

- geração de mundo: **~14 ms** de média (`worldgen.test.js` exige < 250 ms);
- 400 ticks com 6 jogadores: **< 4 s** (`rooms.test.js`, ~5–8 ms/tick);
- snapshot de movimento de 6 jogadores: **~0,4 KB** (415 bytes medidos);
- estado compartilhado (`st`): **~1 KB**;
- geração de mundo: **~14 ms** de média em 12 seeds (limite do teste: 250 ms).

---

## 7. Acessibilidade e redução de efeitos

- configurações persistentes (`localStorage`) para granulação, escuridão,
  neblina, tremor de câmera e **"reduzir efeitos visuais"**;
- modo reduzido desliga granulação, partículas, flicker de HUD e tremores;
- `prefers-reduced-motion` desliga animações de CSS;
- áudio nunca é obrigatório: o jogo inicia o contexto no primeiro gesto do
  usuário;
- contraste alto nos textos essenciais; HUD discretíssimo por padrão.

---

## 8. Limitações conhecidas (v1)

- **Sem persistência entre sessões**: ao esvaziar, a sala e o progresso somem
  (por design da v1). A arquitetura permite adicionar: `Room.serialize()`
  → snapshot de estado já existe (`stateSnapshot`); faltaria um storage.
- **Sem servidor de matchmaking**: a lista pública vive em memória do processo.
  Um segundo processo no Render não compartilharia o diretório.
- **Sem anti-cheat forte**: o servidor valida física e distâncias, mas um
  cliente modificado ainda pode automatizar inputs dentro dos limites.
- **Criaturas movem-se em linha reta com colisão**, não com pathfinding
  completo. Funciona bem nos corredores; dentro de salas grandes com muito
  mobiliário podem ficar presas em cantos (por isso nascem em piso aberto).
- **Física em 2D de círculo** com separação por eixo: não há empurrão entre
  jogadores (eles se sobrepõem visualmente). É uma escolha para evitar
  "trancamento" em portas de 1 tile.
- **Teste com navegadores reais pendente** — ver `docs/TESTES.md`.
