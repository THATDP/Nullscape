# NULLSCAPE — Testes

Última execução completa: **86 testes automatizados** + **25 verificações do cliente**, 0 falhas.
**Multiplayer com navegadores reais: ainda não executado neste ambiente** —
veja a seção 3 e o checklist final.

---

## 1. Testes automatizados

### Backend (`cd backend && npm test`)

| Arquivo | Cobertura | Nº |
| --- | --- | --- |
| `worldgen.test.js` | determinismo por seed, conectividade BFS, portas reais, portões, sigilos alcançáveis, RLE, payload, paletas, água, spawn, tempo de geração | 14 |
| `physics.test.js` | determinismo de física, colisão, velocidade máxima, anti-speedhack, deslize em paredes, convergência predição↔servidor, **mundo hidratado da rede**, **colisão de portões** | 13 |
| `creatures.test.js` | estados e contra-jogo de cada criatura, telegrafia, dano com cooldown, limite de criaturas, limpeza, tensão de anomalias, raridade | 17 |
| `puzzles.test.js` | resolução das 6 variantes, alcance, jogador morto, ordem dos disjuntores, janela das válvulas, alavanca solta, sino, cartão | 9 |
| `rooms.test.js` | criação/limpeza, 6 jogadores, sanitização, input inválido, morte/respawn, sigilo perdido, altar, portas, reconexão, expiração, estado sem dados sensíveis, **desempenho** | 21 |
| `integration.test.js` | **6 clientes Socket.IO reais**: entrar, ver-se, movimento, rejeição de teleporte, estado compartilhado, puzzle, portão, reconexão, saída/limite, rate limit, limpeza, sala privada | 12 |

```bash
npm test              # tudo
npm run test:unit     # sem rede (rápido)
npm run test:integration
```

### Cliente (`cd frontend && npm run smoke`)

`scripts/smoke-dom.mjs` carrega o `index.html` no **jsdom**, sobe o **servidor
real** em porta efêmera, conecta pelo **NetClient real** e verifica 25 pontos:

- telas e HUD presentes no DOM;
- conexão, criação de sala, código de convite de 6 caracteres;
- lobby renderizado com anfitrião e semente;
- segundo jogador entrando pelo código;
- diretório público e broadcast;
- recebimento de estado compartilhado (criaturas incluídas);
- **mundo recebido pela rede é hidratável** para a física local;
- **predição local move sem atravessar parede**;
- reconexão;
- nenhum erro de script.

```bash
npm run smoke
```

### Build

```bash
cd frontend && npm run build
# dist/index.html ~21 KB, CSS ~30 KB, Phaser ~1,48 MB (340 KB gzip)
```

---

## 2. O que os testes **provam**

- **A mesma seed gera o mesmo mundo**, byte a byte (grid RLE idêntico).
- **Toda sala é alcançável** a partir do spawn em todas as seeds testadas.
- **Toda passagem é uma porta** — corredores não atravessam paredes.
- **Os portões bloqueiam** de fato (BFS com portões fechados alcança menos).
- **O cliente não pode teleportar**: posição só é alterada pelo servidor.
- **A física do cliente é a do servidor**: 90 frames de input complexo produzem
  divergência zero.
- **O mundo serializado pela rede é jogável no cliente** (grids RLE hidratados) —
  regressão de um bug que impedia qualquer movimento no navegador.
- **Portão fechado bloqueia de verdade** e libera ao abrir (testado na física,
  não só na regra).
- **Cada criatura respeita o próprio contra-jogo** (ex.: O Lento congela, O
  Garçom não ataca quem anda, O Solitário espera com o grupo junto).
- **Anomalias raras exigem tensão** e expiram sozinhas.
- **6 jogadores simultâneos** entram, se veem e recebem snapshots.
- **Reconexão** preserva posição, vida e inventário.
- **Salas vazias** são marcadas e removidas após a carência.
- **Rate limit** corta flood de interações.
- **Nenhum `socketId`** vaza no estado compartilhado.

---

## 3. O que **falta** testar (manual, obrigatório)

Não há navegador real neste ambiente de desenvolvimento. Antes de considerar o
multiplayer publicado, execute o roteiro abaixo.

### 3.1 Preparação

```bash
cd backend && npm run dev
cd frontend && npm run dev
```

Abra **duas janelas anônimas** de navegadores **diferentes** (ex.: Chrome e
Firefox), em máquinas diferentes se possível.

### 3.2 Roteiro — 6 jogadores

| # | Passo | Resultado esperado |
| --- | --- | --- |
| 1 | Chrome: criar sala privada, copiar código | lobby mostra 6 caracteres |
| 2 | Firefox: entrar pelo código | os dois lobbies mostram 2 jogadores |
| 3 | Em cada janela, clicar **Entrar no mundo** | ambos veem o mesmo mapa e um ao outro |
| 4 | Mover em direções opostas | o corpo remoto interpola sem "pular" |
| 5 | Correr (Shift) por 2 s | passos rápidos, som mais alto; O Ouvinte pode reagir |
| 6 | Chegar perto de uma anotação e apertar **E** | papel aparece; ambos podem ler |
| 7 | Resolver o primeiro mecanismo (dois jogadores) | ambos recebem a mensagem e o sigilo aparece |
| 8 | Um pega o sigilo | HUD do portador mostra ◇; o outro vê a mensagem |
| 9 | Entregar no portão | portão abre para todos |
| 10 | Fechar a aba de um jogador | outros veem "fora"; reconectar restaura o corpo |
| 11 | Reconectar no mesmo navegador | mesmo nome, mesma posição |
| 12 | Chegar a 6 jogadores e tentar um 7º | recusa "sala cheia" |
| 13 | Dobrar a janela / trocar resolução | HUD e câmera se ajustam |
| 14 | Ficar 3 min parado longe do grupo | tensão sobe; anomalia aparece |

### 3.3 Desempenho

- DevTools → Performance → 60 s de jogo com 6 jogadores: **≥ 50 FPS** em um
  notebook comum.
- DevTools → Network → WS: snapshots ≤ ~1,4 KB; nenhum pico acima de 10 KB/s
  por jogador.
- Abrir 6 abas no mesmo navegador (estresse): observar memória e estabilidade.

### 3.4 Acessibilidade

- Ativar **"Reduzir efeitos visuais"**: sem granulação, sem partículas, sem
  tremor.
- `prefers-reduced-motion` no SO: animações de CSS param.
- Jogar com o som mudo: todas as informações críticas também aparecem em texto.

### 3.5 Publicação

Depois do deploy (ver `docs/PUBLICACAO.md`):

- abrir a URL do Pages em dois dispositivos (um no 4G);
- confirmar o banner de cold start e a reconexão automática;
- validar que nenhum erro de CORS aparece no console.

---

## 4. Como repetir a suíte completa

```bash
# na raiz do repositório
(cd backend && npm ci && npm test)
(cd frontend && npm ci && npm run smoke && npm run build)
```

Tempo esperado: ~14 s (backend) + ~5 s (cliente) + ~7 s (build).
