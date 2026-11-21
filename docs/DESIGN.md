# NULLSCAPE — Direção de arte, interface e som

O objetivo estético: **lugares que parecem familiares e estão profundamente
errados**. Isso é conquistado com composição e luz, não com monstros na tela.

---

## 1. Princípios

1. **Dessaturação com um acento doente.** Cada ambiente tem uma paleta com
   amplitude máxima entre canais abaixo de 130 (testado em `worldgen.test.js`).
   O acento (`glow`) é o único ponto "vivo".
2. **Luz artificial, não natural.** Nenhuma sombra de sol. Tudo é fluorescente,
   vapor de sódio, emergência.
3. **Espaço vazio como personagem.** Salas grandes com poucos móveis, corredores
   longos, cantos que não são usados para nada.
4. **Geometria quase correta.** Ângulos retos, mas proporções erradas — corredores
   de 2 tiles de largura com salas de 18.
5. **Nada de ícones genéricos.** Toda sinalização é tipográfica, discreta, como
   placas de prédio comercial.

## 2. Paleta base (interface)

| Token | Hex | Uso |
| --- | --- | --- |
| `--ink-0` | `#050607` | fundo absoluto |
| `--ink-1` | `#08090b` | painéis |
| `--ink-3` | `#131619` | superfícies |
| `--bone` | `#e8e4d8` | texto primário |
| `--bone-dim` | `#b9b4a5` | texto secundário |
| `--bone-faint` | `#8a8779` | metadados |
| `--accent` | `#d8cf9a` | fluorescente velho (foco, portões, sigilos) |
| `--accent-2` | `#9ab3a8` | verde de piscina |
| `--warn` | `#c98a5b` | avisos |
| `--danger` | `#a8544c` | dano, morte |
| `--paper` | `#d8d0bb` | anotações (papel) |

## 3. Tipografia

- **Inter** (300–600) para interface — legibilidade em telas escuras.
- **JetBrains Mono** (300–500) para: títulos de sistema, códigos, metadados,
  anotações, HUD. Dá a sensação de **sinalização técnica** de prédio.
- Título do jogo: monoespaçado, `letter-spacing` grande, leve glitch em CSS
  (clip-path + deslocamento de cor) a cada ~8 s.

## 4. Interface (telas)

| Tela | Intenção | Detalhe |
| --- | --- | --- |
| Menu | corredor em CSS: luz no teto, perspectiva por gradientes, grão | a citação muda a cada 11 s |
| Criar sala | semente visível ("a mesma semente, o mesmo mundo") | validação inline |
| Entrar por código | campo monoespaçado, 6 dígitos | Enter confirma |
| Lobby | código copiável, lista de jogadores, **briefing do mundo** | mostra os 4 ambientes e os mecanismos **sem revelar a solução** |
| HUD | mínimo: equipe à esquerda, região e objetivo no centro, conexão e menu à direita | desaparece organicamente |
| Pausa | mostra sala, semente, região, jogadores, latência | "o mundo continua sem você" |
| Anotação | papel amarelado, rotação de 0,5°, textura de ruído | lê-se como objeto |
| Encerramento | estatísticas em monoespaçado | permite continuar explorando |
| Arquivo (códex) | criaturas sempre visíveis; anomalias **bloqueadas** até serem vistas | incentiva descoberta |

### HUD — decisões

- nenhuma barra colorida; a vida é uma linha fina que fica avermelhada abaixo de
  40%;
- sigilos são **losangos** (não ícones);
- conexão é um medidor de 4 barras + ms;
- mensagens narrativas aparecem no **centro-alto**, em monoespaçado, com fade
  lento;
- "sussurros" (pistas de criaturas) aparecem à direita, em itálico, e somem.

## 5. Arte procedural

Todos os gráficos são desenhados em canvas na inicialização
(`frontend/src/game/art.js`, ~130 texturas):

- **chão**: trama de carpete, juntas de azulejo, manchas de concreto, tábuas de
  madeira, chapas metálicas com rebites;
- **parede**: gradiente vertical + faixa superior iluminada + rodapé em sombra +
  textura por tema + manchas;
- **mobiliário**: 60+ tipos ("desk", "locker", "divingboard", "blackboard",
  "conveyor"…), cada um com sombra e detalhes coerentes com o ambiente;
- **criaturas**: desenho vetorial no canvas (silhuetas, olhos, pulsos,
  ondulações);
- **efeitos**: *glow* radial, poeira, sombras elípticas.

Nada é carregado da rede. O primeiro frame já tem tudo.

## 6. Luz e atmosfera

Cada ambiente tem **sua própria regra de iluminação** (`lighting` em
`shared/world/themes.js`) — densidade de luminárias, raio, instabilidade e
intensidade base. Nenhum tema repete outro (há teste garantindo isso):

| Tema | Densidade | Raio (tiles) | Instável | Intensidade base |
| --- | --- | --- | --- | --- |
| Escritórios | 0,72 | 3–5 | 16% | 0,90 |
| Hotel | 0,50 | 3–5 | 22% | 0,72 |
| Piscina | 0,62 | 4–6 | 30% | 0,95 |
| Estacionamento | 0,40 | 4–6 | 50% | 0,60 |
| Escola | 0,80 | 3–6 | 12% | 1,00 |
| Industrial | 0,34 | 3–5 | 50% | 0,52 |
| Residencial | 0,44 | 2–4 | 28% | 0,66 |
| Limiar | 0,20 | 2–4 | 35% | 0,35 |

- luz instável é **mais fraca** (45–80% da base) — o prédio parece mal mantido
  justamente onde pisca;
- nenhuma sala pode ficar totalmente escura (uma luz de teto é garantida);
- **camada de escuridão** global (`darkLayer`) modulada pela configuração;
- **blend aditivo** nas luzes, com culling: no máximo 26 luzes visíveis por frame;
- anomalias de apagão derrubam luzes da área;
- vinheta radial fixa por cima do jogo;
- granulação (SVG noise) ajustável — pode ir a 0.

## 7. Áudio

Sintetizado em tempo real (`frontend/src/game/audio.js`), **sem arquivos**:

### Ambiência por tema

| Tema | Drone | Zumbido | Ruído filtrado | Extras |
| --- | --- | --- | --- | --- |
| Escritórios | 92 Hz | 118 Hz | bandpass 620 | — |
| Hotel | 78 Hz | 104 Hz | bandpass 620 | — |
| Piscina | 70 Hz | 60 Hz | bandpass 1100 (úmido) | — |
| Estacionamento | 48 Hz | 42 Hz | lowpass 320 (vento) | — |
| Escola | 88 Hz | 132 Hz | bandpass 620 | tom de campainha aleatório |
| Industrial | 54 Hz | 96 Hz | bandpass 620 | batidas de máquina |
| Residencial | 84 Hz | 110 Hz | bandpass 620 | relógio de parede |
| Limiar | 44 Hz | 38 Hz | bandpass 620 | tom grave a cada ~12 s |

- um LFO de 0,045 Hz modula o drone — **o prédio respira**;
- trocar de região faz fade-out/fade-in da ambiência.

### Sons diegéticos (com atenuação por distância)

passos (andar/correr), portas, válvulas, disjuntores, placas, sino (3 alturas),
cartão, sigilo tomado/entregue, ataques, morte, sussurros, pulso de tensão.

### Silêncio intencional

`audio.cutAmbience(segundos)` corta a ambiência ao morrer ou em momentos
narrativos. O silêncio é usado como pontuação, não como falha.

## 8. Acessibilidade

- **Reduzir efeitos visuais**: desliga granulação, partículas, flicker e tremor;
- `prefers-reduced-motion` no CSS;
- áudio só inicia após interação (política dos navegadores) e pode ser mudo;
- todo aviso sonoro tem equivalente textual (toast/sussurro);
- contraste de texto ≥ 4.5:1 nos elementos essenciais;
- HUD com `pointer-events: none` exceto nos controles — não prende o mouse.

## 9. O que foi evitado de propósito

- jumpscares com tela cheia e grito;
- excesso de sangue, gore ou "monstros" explícitos;
- menus coloridos, ícones 3D, música épica;
- textos de tutorial obrigatórios (o "Como jogar" é opcional);
- qualquer referência visual a franquias existentes.
