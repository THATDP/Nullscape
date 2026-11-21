# NULLSCAPE — O mundo, por dentro

> Este documento é parte do material criativo. Ele também é útil para testar:
> cada regra citada existe no código.

---

## Premissa

NULLSCAPE não tem história explicada. Tem **regras que o jogador pode aprender**.

O mundo é uma faixa contínua de quatro lugares que nunca foram construídos — foram
encontrados. Cada um tem um propósito que ninguém lembra e um mecanismo que precisa
de **mais de uma pessoa** para funcionar. Quatro sigilos fecham um ciclo que
ninguém abriu.

O Altar no fim da última região não é uma saída. É o lugar onde o ciclo reconhece
que foi atravessado. Depois dele, o corredor continua — porque o corredor sempre
continua.

---

## Os oito ambientes

Cada ambiente define paleta dessaturada, materiais, mobiliário, luzes, ambiência
sonora, nomes de sala e **anotações** (que ensinam as regras do mundo).

### Escritórios Intermináveis
- **Paleta**: bege-fluorescente, carpete cinza-esverdeado, acento `#d8cf9a`.
- **Som**: zumbido de ar-condicionado com batimento lento.
- **Anotações**: memorandos sobre expediente, formulários e o ramal 9.
- **Detalhe**: as salas têm nomes repetidos ("Sala de Espera 3" e "Sala de
  Espera 3 (repetida)").

### Hotel Vazio
- **Paleta**: vinho sujo, carpete estampado, acento `#c9a48a`.
- **Som**: drone grave e distante, como elevador parado entre andares.
- **Anotações**: livro de registro com hóspede recorrente às 03:33.
- **Detalhe**: camas feitas, espelhos e bagagens que ninguém deixou.

### Piscinas Internas Impossíveis
- **Paleta**: azul-esverdeado descorado, azulejo, acento `#8fd3c6`.
- **Som**: reverb úmido; água em bandpass.
- **Regra do mapa**: piscinas são obstáculos intransponíveis (contornar).
- **Detalhe**: placas com profundidades contraditórias (1,2m — 11m).

### Estacionamentos Abandonados
- **Paleta**: concreto escuro, sinalização amarela gasta, acento `#e0b465`.
- **Som**: vento de garagem, goteira, eco.
- **Detalhe**: o nível -3 aparece várias vezes com nomes diferentes.

### Escolas sem Alunos
- **Paleta**: verde-institucional, linóleo, quadro-negro, acento `#b9c48a`.
- **Som**: tom de campainha distante e aleatório.
- **Mecânica de ambiente**: `silenceChoir` (o sino).
- **Detalhe**: sala 12, sala 13, sala 13-B.

### Salas Industriais
- **Paleta**: aço, ferrugem, acento laranja apagado `#cf7f59`.
- **Som**: batidas de máquina em intervalos irregulares.
- **Detalhe**: "nunca desligue a bomba 3".

### Residências Distorcidas
- **Paleta**: marrom-lilás, madeira, abajures, acento `#c99ab8`.
- **Som**: relógio de parede + drone doméstico.
- **Detalhe**: corredores que dão voltas em torno da própria casa.

### Limiares
- **Paleta**: cinza quase puro, acento lilás `#b7b0c9`.
- **Som**: quase silêncio; só um tom grave espaçado.
- **Detalhe**: salas sem nome, "Antessala", "O Intervalo". Pode ser a última
  região (35% de chance) — a mais opressiva fica no fim.
- **Luz**: a mais escura de todas — 20% de densidade, raio 2–4 tiles, 35% das
  luminárias instáveis e intensidade base 0,35 (contra 1,00 da Escola).

> Câmaras secretas usam **o tema de outro ambiente** — uma piscina dentro do
> escritório, um quarto de hotel dentro do estacionamento. É intencionalmente
> "errado" e não afeta colisão.

---

## Os seis quebra-cabeças cooperativos

| Mecanismo | Regra exata | Contra-jogo |
| --- | --- | --- |
| **Válvulas pareadas** | as duas válvulas precisam girar dentro de **9 s**; a segunda gira a primeira janela | dividam-se e usem contagem |
| **Sequência de disjuntores** | 3 disjuntores na ordem correta; erro reinicia | a ordem está numa anotação da mesma região |
| **Alavanca + botão** | um jogador segura a alavanca (tem de permanecer perto) e outro pisa no botão | exige separação e retorno rápido |
| **Placas de pressão** | as duas placas ocupadas simultaneamente | ficar em cima, não só tocar |
| **Cartão magnético** | o cartão está escondido num armário da região; o leitor fica em outra sala | um vai buscar, outro espera no leitor |
| **Sino do coro** | tocar 3×, com pausa ≥ 0,9s e ≤ 4s entre toques; pressa zera | um toca, os outros protegem |

Cada solução **revela um sigilo** na câmara secreta daquela região.

---

## As sete criaturas

| Criatura | Estado | Objetivo | Percepção | Ataque | Recuo |
| --- | --- | --- | --- | --- | --- |
| **O Garçom** | `patrol` → `approach` → `recede` | servir quem **espera** | 7 tiles | 12 dmg, só se você estiver **parado** | recua se você andar na direção dele |
| **O Lento** | `advance` / `frozen` / `dormant` | ficar mais perto **enquanto é visto** | 9 tiles (dependente do olhar) | 18 dmg só se for observado | congela sem ser observado; reaparece em outro ponto |
| **O Ouvinte** | `investigate` → `patrol` | seguir **ruído** | ouve 14 tiles | 14 dmg | perde o alvo se você parar de fazer barulho |
| **O Solitário** | `waiting` → `hunt` | caçar o jogador **isolado** | 6 tiles | 20 dmg | desaparece quando vocês se reúnem |
| **O Espelho** | `mirror` | repetir sua rota com **1,4 s de atraso** | 12 tiles (memória) | 10 dmg | mude de direção |
| **O Vigia** | `observeLearn` | **aprender** seus pontos; nunca aproximar | 16 tiles | — | não fique no mesmo lugar |
| **A Válvula Orgânica** | `alterEnvironment` | apagar luzes / fechar portas | 5 tiles | — | fuja; ela recua de quem se aproxima |

A telegrafia é sempre auditiva: sino de louça, arrasto, umidade, três batidas,
repetição de passos, um tom grave, um pulso molhado.

---

## As onze anomalias

| Anomalia | Raridade | Regra | Duração |
| --- | --- | --- | --- |
| Piscada nas Luzes | sutil | salas com luzes instáveis | 4 s |
| Vozes do Outro Corredor | sutil | som espacial da região vizinha | 6 s |
| Passos Antecipados | sutil | só com jogador em movimento | 5 s |
| Corredor Deslocado | moderada | se ninguém olha | 5 s |
| A Porta que Não Existe | moderada | exige porta interna na região | 6 s |
| Apagão Local | moderada | comum com a Válvula Orgânica | 5 s |
| Repetição Impossível | rara | exige 2+ jogadores | 7 s |
| Geometria Dobrada | rara | só visual; colisão permanece | 8 s |
| Algo na Janela | rara | exige tensão ≥ 0,35 | 3 s |
| Sala Deslocada | impossível | tensão ≥ 0,7; todos veem | 2 s |
| O Mundo Invertido | impossível | tensão ≥ 0,55; inverte o input | 3,5 s |

**Tensão** = (proporção de jogadores parados × 0,35) + (dispersão do grupo × 0,35)
+ (tempo desde o último evento × 0,3).

---

## Progressão

Não há níveis. A progressão é **descoberta registrada localmente**:

- **Regiões desbloqueáveis**: os portões (1, 2 e 3 sigilos) e o Altar (4).
- **Registros**: 9+ anotações por mundo, com títulos e textos únicos.
- **Descobertas**: o "Arquivo de anomalias" (códex) desbloqueia entradas conforme
  você as presencia; criaturas já estão descritas, anomalias só aparecem depois
  de vistas.
- **Segredos**: uma câmara secreta por região (tema trocado) — **~99% das
  regiões** conseguem encaixá-la e **todo mundo tem ao menos uma**. O encaixe é
  tentado até 9 vezes, com tamanho e margem
  progressivamente menores, e o corredor secreto tenta uma segunda rota antes de
  desistir.
- **Eventos raros**: anomalias `impossível`, a Válvula Orgânica, o Vigia.
- **Estatísticas**: distância percorrida, anotações lidas, anomalias vistas,
  mortes, duração — mostradas no encerramento.

---

## Escrita das anotações (amostra)

> **Memorando 118**
> O expediente termina quando todos esquecerem que começou. Por favor, não
> desligue as luzes da ala norte. Elas são as únicas que ainda sabem o caminho
> de volta.

> **Placa de Segurança**
> Profundidade: 1,2m — 3,8m — 11m — 1,2m. Não mergulhe na última poça. Ela não
> tem fundo, apenas paciência. Toalhas disponíveis na recepção. As toalhas
> murcham se você as observar.

> **Carta Não Enviada**
> Querida, a casa aumentou de novo. O corredor agora dá duas voltas em torno de
> si mesmo. Coloquei um bilhete na cozinha para lembrar onde fica a cozinha. O
> bilhete desapareceu. A cozinha também. Ainda estamos aqui.

> **Cderno Rasgado**
> Dia 1: cheguei. Dia 2: cheguei. Dia 2: cheguei. Dia 2: cheguei. Aprendi que
> aqui não existe dia 3, mas existem muitas portas. Anotei cada porta. As
> anotações agora são portas.
