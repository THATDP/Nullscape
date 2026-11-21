/**
 * NULLSCAPE — Criaturas e suas inteligências.
 *
 * Cada criatura tem estado interno, percepção, objetivos e regras próprias.
 * Nenhuma delas simplesmente "persegue" o jogador: o comportamento emerge de
 * condições (isolamento, som, luz, olhar, memória) e sempre há contra-jogo.
 *
 * Criaturas implementadas:
 *  - Garçom (waiter)  : patrulha; se te vê parado por muito tempo, serve "algo".
 *  - Lento (slow)     : persegue enquanto observado; congela se ninguém olha.
 *  - Ouvinte (listener): segue ruído (correr, portas, botões).
 *  - Solitário (lonely): manifesta-se quando um jogador fica sozinho por muito tempo.
 *  - Espelho (echo)   : copia o comportamento de um jogador específico, com atraso.
 *  - Vigia (watcher)  : observa de longe, sem se aproximar; piscar de luzes.
 *  - Válvula Orgânica (organ) : altera o ambiente (apaga luz, fecha porta).
 *
 * A IA roda no servidor com atualização escalonada (staggered) por custo.
 */

import { Rng } from '../world/rng.js';
import { REGION_W } from '../world/generator.js';
import { T } from '../world/themes.js';
import { TILE_SIZE, tileOfWorld, circleBlocked, tryMove } from './physics.js';

export const CREATURE_DEFS = {
  waiter: {
    id: 'waiter',
    label: 'O Garçom',
    color: 0xd8d2c4,
    size: 14,
    speed: 1.4 * TILE_SIZE,
    aggression: 0.15,
    sightTiles: 7,
    hearingTiles: 4,
    emits: 'chime',
    note: 'Ele não persegue quem anda. Só quem espera.',
    telegraph: 'Um tilintar de louça muito distante.',
    attack: { damage: 12, cooldownMs: 6000, rangeTiles: 0.9 },
    behavior: 'patrolServe',
  },
  slow: {
    id: 'slow',
    label: 'O Lento',
    color: 0x2e2b33,
    size: 16,
    speed: 0.9 * TILE_SIZE,
    aggression: 0.4,
    sightTiles: 9,
    hearingTiles: 2,
    emits: 'drag',
    note: 'Ele só existe enquanto alguém olha. Pare de olhar e ele para.',
    telegraph: 'Algo se arrasta atrás de você, mas apenas quando você confirma com os olhos.',
    attack: { damage: 18, cooldownMs: 5000, rangeTiles: 0.8 },
    behavior: 'observedChase',
  },
  listener: {
    id: 'listener',
    label: 'O Ouvinte',
    color: 0x8e9a86,
    size: 13,
    speed: 1.7 * TILE_SIZE,
    aggression: 0.5,
    sightTiles: 2,
    hearingTiles: 14,
    emits: 'wet',
    note: 'Correr chama. Portas chamam. Os botões gritam.',
    telegraph: 'Umidade: o som de alguém andando descalço em água rasa.',
    attack: { damage: 14, cooldownMs: 4500, rangeTiles: 0.8 },
    behavior: 'huntNoise',
  },
  lonely: {
    id: 'lonely',
    label: 'O Solitário',
    color: 0x4c4a63,
    size: 15,
    speed: 1.1 * TILE_SIZE,
    aggression: 0.9,
    sightTiles: 6,
    hearingTiles: 6,
    emits: 'knock',
    note: 'Ele só aparece para quem fica muito tempo sem ninguém por perto.',
    telegraph: 'Três batidas em madeira. Sempre três.',
    attack: { damage: 20, cooldownMs: 5000, rangeTiles: 0.9 },
    behavior: 'stalkIsolated',
  },
  echo: {
    id: 'echo',
    label: 'O Espelho',
    color: 0xb7aecb,
    size: 14,
    speed: 3.2 * TILE_SIZE,
    aggression: 0.25,
    sightTiles: 12,
    hearingTiles: 0,
    emits: 'replay',
    note: 'Ele repete seus passos com atraso. Se te alcançar, você é o eco.',
    telegraph: 'Você ouve seus próprios passos um segundo depois de dá-los.',
    attack: { damage: 10, cooldownMs: 7000, rangeTiles: 0.7 },
    behavior: 'mirrorPlayer',
  },
  watcher: {
    id: 'watcher',
    label: 'O Vigia',
    color: 0x6c7a8a,
    size: 18,
    speed: 0,
    aggression: 0,
    sightTiles: 16,
    hearingTiles: 6,
    emits: 'drone',
    note: 'Ele nunca se aproxima. Ele só aprende onde você esteve.',
    telegraph: 'Uma presença que não se move, mas está sempre mais perto quando você vira.',
    attack: null,
    behavior: 'observeLearn',
  },
  organ: {
    id: 'organ',
    label: 'A Válvula Orgânica',
    color: 0xa2554f,
    size: 17,
    speed: 0.7 * TILE_SIZE,
    aggression: 0.2,
    sightTiles: 5,
    hearingTiles: 8,
    emits: 'pulse',
    note: 'Ela não quer você. Ela quer as luzes apagadas e as portas fechadas.',
    telegraph: 'Um pulso molhado acompanha cada lâmpada que morre.',
    attack: null,
    behavior: 'alterEnvironment',
  },
};

const CREATURE_LIST = Object.values(CREATURE_DEFS);

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Gerenciador de criaturas de uma sala.
 * O mundo é compartilhado; o gerente decide spawn, coordena IA e ataques.
 */
export class CreatureSystem {
  constructor(room) {
    this.room = room;
    this.world = room.world;
    this.rng = new Rng(`${room.world.seed}:creatures`);
    this.creatures = new Map();
    this.nextId = 1;
    this.tick = 0;
    this.noiseEvents = []; // {gx, gy, strength, t}
    this.damageQueue = []; // {playerId, amount, source, at}
    this.events = []; // eventos narrativos para os clientes
    this.spawnProfile = this.chooseProfile();
  }

  /** Perfil de criaturas por seed: cada mundo tem seu elenco. */
  chooseProfile() {
    const rng = this.rng.fork('profile');
    const pool = CREATURE_LIST.filter((c) => c.id !== 'lonely' && c.id !== 'echo');
    const chosen = rng.sample(pool, 3);
    return chosen.map((c) => c.id);
  }

  get playerStates() {
    return this.room.playerStates;
  }

  /** Ponto caminhável aleatório em um raio de tiles, opcionalmente longe dos jogadores. */
  findSpawnPoint(near = null, minDistFromPlayers = 6, maxTries = 40) {
    const world = this.world;
    for (let i = 0; i < maxTries; i++) {
      let gx;
      let gy;
      if (near) {
        const radius = this.rng.int(4, 12);
        gx = near.gx + this.rng.int(-radius, radius);
        gy = near.gy + this.rng.int(-radius, radius);
      } else {
        gx = this.rng.int(2, world.worldW - 3);
        gy = this.rng.int(2, world.worldH - 3);
      }
      if (gx < 1 || gy < 1 || gx >= world.worldW - 1 || gy >= world.worldH - 1) continue;
      const tile = tileOfWorld(world, gx, gy);
      if (![T.FLOOR, T.DOORWAY].includes(tile)) continue;
      let tooClose = false;
      for (const ps of this.playerStates.values()) {
        if (ps.dead || ps.disconnected) continue;
        const pgx = Math.floor(ps.x / TILE_SIZE);
        const pgy = Math.floor(ps.y / TILE_SIZE);
        if (manhattan(gx, gy, pgx, pgy) < minDistFromPlayers) tooClose = true;
      }
      if (tooClose) continue;
      return { gx, gy, x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE };
    }
    return null;
  }

  spawn(kind, options = {}) {
    const def = CREATURE_DEFS[kind];
    if (!def) return null;
    if (this.creatures.size >= 5) return null;
    const point = options.point || this.findSpawnPoint(options.near || null, options.minDist || 6);
    if (!point) return null;
    const id = `c${this.nextId++}`;
    const creature = {
      id,
      kind,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      state: 'idle',
      stateData: {},
      phaseOffset: this.nextId % 2,
      awareOf: null,
      targetPlayerId: null,
      cooldown: 0,
      lastSeen: null,
      memory: {},
      bornAt: Date.now(),
      region: Math.floor(point.gx / REGION_W),
      aggro: 0,
      health: 1,
      awayUntil: 0,
      visible: true,
      mirrorBuffer: [],
      noiseTarget: null,
      alertLevel: 0,
    };
    if (kind === 'echo') {
      // escolhe um jogador para imitar
      const players = Array.from(this.playerStates.values()).filter((p) => !p.dead);
      if (players.length) {
        creature.targetPlayerId = this.rng.pick(players).id;
        creature.mirrorBuffer = [];
      }
    }
    if (kind === 'watcher') {
      // fica parado, mas "aprende" posições
      creature.memory.hotspots = [];
    }
    this.creatures.set(id, creature);
    this.events.push({ type: 'spawn', creatureId: id, kind, region: creature.region });
    return creature;
  }

  despawn(id) {
    const c = this.creatures.get(id);
    if (!c) return;
    this.creatures.delete(id);
    this.events.push({ type: 'despawn', creatureId: id, kind: c.kind });
  }

  clear() {
    for (const id of Array.from(this.creatures.keys())) this.despawn(id);
  }

  /** Registra ruído (corrida, porta, botão). Criaturas próximas investigam. */
  registerNoise(gx, gy, strength = 6, kind = 'step') {
    this.noiseEvents.push({ gx, gy, strength, kind, at: Date.now() });
    if (this.noiseEvents.length > 200) this.noiseEvents.splice(0, this.noiseEvents.length - 200);
    for (const c of this.creatures.values()) {
      const def = CREATURE_DEFS[c.kind];
      if (!def) continue;
      const cgx = Math.floor(c.x / TILE_SIZE);
      const cgy = Math.floor(c.y / TILE_SIZE);
      const dist = Math.hypot(cgx - gx, cgy - gy);
      if (dist > def.hearingTiles) continue;
      if (c.kind === 'listener' || c.kind === 'organ') {
        c.state = 'investigate';
        c.noiseTarget = { gx, gy, at: Date.now() };
        c.stateData.stepTarget = { gx, gy };
        this.events.push({ type: 'heardNoise', creatureId: c.id, kind: c.kind, gx, gy, strength });
      } else if (!c.targetPlayerId && c.state === 'patrol') {
        c.stateData.stepTarget = { gx, gy };
      }
    }
  }

  /** Chamado quando um jogador interage/é visto (alimenta memória e agressão). */
  notifyPlayerAction(playerId, action) {
    const ps = this.playerStates.get(playerId);
    if (!ps) return;
    const gx = Math.floor(ps.x / TILE_SIZE);
    const gy = Math.floor(ps.y / TILE_SIZE);
    if (action === 'interact' || action === 'door' || action === 'noise') {
      this.registerNoise(gx, gy, action === 'door' ? 9 : 7, action);
    }
    if (action === 'sprint') this.registerNoise(gx, gy, 8, 'sprint');
  }

  /** Estado de olhar: quais criaturas estão na direção do jogador (client-side é aproximado). */
  playerLookingAt(ps, creature) {
    // O cliente envia `look` (vetor) junto do input; usamos para a mecânica do Lento.
    const dx = creature.x - ps.x;
    const dy = creature.y - ps.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const lx = ps.lookX ?? ps.dirX ?? 0;
    const ly = ps.lookY ?? ps.dirY ?? 0;
    const mag = Math.hypot(lx, ly);
    if (mag < 0.01) return false;
    const dot = (dx / dist) * (lx / mag) + (dy / dist) * (ly / mag);
    const facing = dot > 0.35;
    // Percepção periférica só em distância de toque. Para O Lento ela é mínima
    // de propósito: o contra-jogo dele é DESVIAR O OLHAR, e um raio grande
    // tornava impossível congelá-lo depois que ele se aproximava.
    const nearRadius = creature.kind === 'slow' ? TILE_SIZE * 1.05 : 3 * TILE_SIZE;
    const near = dist < nearRadius;
    return facing || near;
  }

  /** Passo de IA. Retorna eventos/ataques para a sala processar. */
  update(dt, now) {
    this.tick++;
    const world = this.world;
    const players = Array.from(this.playerStates.values()).filter((p) => !p.dead && !p.disconnected);
    const alivePlayers = Array.from(this.playerStates.values()).filter((p) => !p.dead);
    const roomEmpty = alivePlayers.length === 0;

    // Reavaliar elenco periodicamente
    if (this.tick % 300 === 0) this.maintainPopulation(alivePlayers, now);

    // Atualização escalonada: cada criatura pensa a ~10 Hz (metade dos ticks de
    // 20 Hz), deslocada por id. Com 5 criaturas, corta o custo de IA pela metade
    // sem atraso perceptível — o movimento é integrado no mesmo passo.
    const aiStride = 2;
    for (const c of Array.from(this.creatures.values())) {
      const def = CREATURE_DEFS[c.kind];
      if (!def) continue;
      const phase = (this.tick + (c.phaseOffset ?? 0)) % aiStride;
      if (phase !== 0) continue;
      const aiDt = dt * aiStride;
      const cgx = Math.floor(c.x / TILE_SIZE);
      const cgy = Math.floor(c.y / TILE_SIZE);
      c.cooldown = Math.max(0, c.cooldown - aiDt * 1000);

      // Percepção
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of players) {
        const pgx = Math.floor(p.x / TILE_SIZE);
        const pgy = Math.floor(p.y / TILE_SIZE);
        const d = Math.hypot(pgx - cgx, pgy - cgy);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = p;
        }
      }
      if (nearest && nearestDist <= def.sightTiles) {
        c.lastSeen = { x: nearest.x, y: nearest.y, at: now };
        c.awareOf = nearest.id;
      } else if (nearestDist > def.sightTiles * 1.6) {
        c.awareOf = null;
      }

      switch (def.behavior) {
        case 'patrolServe':
          this.updatePatrolServe(c, def, players, nearest, nearestDist, aiDt, now);
          break;
        case 'observedChase':
          this.updateObservedChase(c, def, players, nearest, nearestDist, aiDt, now);
          break;
        case 'huntNoise':
          this.updateHuntNoise(c, def, nearest, nearestDist, aiDt, now);
          break;
        case 'stalkIsolated':
          this.updateStalkIsolated(c, def, alivePlayers, aiDt, now);
          break;
        case 'mirrorPlayer':
          this.updateMirrorPlayer(c, def, players, aiDt, now);
          break;
        case 'observeLearn':
          this.updateObserveLearn(c, def, players, aiDt, now);
          break;
        case 'alterEnvironment':
          this.updateAlterEnvironment(c, def, players, aiDt, now);
          break;
        default:
          this.moveToward(c, cgx, cgy, this.rng.int(2, world.worldW - 3), this.rng.int(2, world.worldH - 3), def.speed * 0.4, aiDt);
      }

    }

    // Ataque por contato roda em TODO tick (é só uma checagem de distância):
    // o jogador nunca leva dano "atrasado" por causa da IA escalonada.
    for (const c of Array.from(this.creatures.values())) {
      const def = CREATURE_DEFS[c.kind];
      if (!def?.attack) continue;
      c.cooldown = Math.max(0, c.cooldown - dt * 1000);
      if (c.cooldown > 0) continue;
      for (const p of players) {
        const dist = Math.hypot(p.x - c.x, p.y - c.y);
        if (dist > def.attack.rangeTiles * TILE_SIZE) continue;
        if (!this.canAttack(c, p, def, now)) continue;
        c.cooldown = def.attack.cooldownMs;
        this.damageQueue.push({ playerId: p.id, amount: def.attack.damage, source: c.id, kind: c.kind, at: now });
        this.events.push({ type: 'attack', creatureId: c.id, kind: c.kind, playerId: p.id, damage: def.attack.damage });
        break;
      }
    }

    // Criaturas "dissolvem" quando ninguém está perto (exceto as plantadas)
    if (roomEmpty) this.clear();
  }

  canAttack(creature, player, def, now) {
    if (player.safeUntil && now < player.safeUntil) return false;
    // O Lento só ataca se estiver sendo observado
    if (creature.kind === 'slow' && !this.playerLookingAt(player, creature)) return false;
    // O Garçom só ataca jogadores parados
    if (creature.kind === 'waiter') {
      const moving = Math.hypot(player.vx || 0, player.vy || 0) > 20;
      if (moving) return false;
    }
    return true;
  }

  maintainPopulation(alivePlayers, now) {
    const target = alivePlayers.length === 0 ? 0 : 2 + (alivePlayers.length > 2 ? 1 : 0);
    while (this.creatures.size < target) {
      const kind = this.rng.pick(this.spawnProfile);
      const point = this.findSpawnPoint(null, 10);
      if (!point) break;
      this.spawn(kind, { point });
    }
    // Se o elenco ficou entediante, adiciona o solitário em mundos maiores
    if (this.creatures.size > 0 && this.rng.chance(0.02 * (target - this.creatures.size + 1))) {
      this.spawn('lonely', { minDist: 10 });
    }
  }

  // --- Comportamentos -------------------------------------------------------

  moveToward(c, fromX, fromY, toX, toY, speed, dt) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const stepX = (dx / len) * speed * dt;
    const stepY = (dy / len) * speed * dt;
    const moved = tryMove(this.world, c.x, c.y, stepX, stepY, CREATURE_DEFS[c.kind].size * 0.6);
    c.vx = (moved.x - c.x) / dt;
    c.vy = (moved.y - c.y) / dt;
    c.x = moved.x;
    c.y = moved.y;
    c.region = Math.floor(c.x / TILE_SIZE / REGION_W);
  }

  randomWalkableNear(c, radius = 6) {
    const cgx = Math.floor(c.x / TILE_SIZE);
    const cgy = Math.floor(c.y / TILE_SIZE);
    for (let i = 0; i < 20; i++) {
      const gx = cgx + this.rng.int(-radius, radius);
      const gy = cgy + this.rng.int(-radius, radius);
      const tile = tileOfWorld(this.world, gx, gy);
      if (tile === T.FLOOR || tile === T.DOORWAY) return { gx, gy };
    }
    return { gx: cgx, gy: cgy };
  }

  updatePatrolServe(c, def, players, nearest, nearestDist, dt, now) {
    if (c.state === 'idle') {
      c.state = 'patrol';
      c.stateData.stepTarget = this.randomWalkableNear(c, 5);
    }
    if (nearest && nearestDist < def.sightTiles) {
      const stillFor = (nearest.stillSince ? now - nearest.stillSince : 0);
      const isFar = nearestDist > def.sightTiles * 0.55;
      if (stillFor > 4200 || (nearest.afk && nearestDist < 5)) {
        // Aproxima-se do jogador parado
        c.state = 'approach';
        c.targetPlayerId = nearest.id;
        if (isFar || this.playerLookingAt(nearest, c)) {
          // prefere se aproximar por trás enquanto o jogador olha
        }
      } else if (nearestDist < 2.2 && !nearest.afk) {
        // Se o jogador começa a andar na direção dele, recua
        c.state = 'recede';
        c.stateData.recedeUntil = now + 2500;
      }
    } else if (c.state === 'approach') {
      const last = c.lastSeen;
      if (!last || now - last.at > 5000) {
        c.state = 'patrol';
        c.stateData.stepTarget = this.randomWalkableNear(c, 6);
      }
    }
    if (c.state === 'recede') {
      if (now < c.stateData.recedeUntil) {
        const away = this.randomWalkableNear(c, 4);
        this.moveToward(c, Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE), away.gx, away.gy, def.speed, dt);
        return;
      }
      c.state = 'patrol';
    }
    if (nearest && nearestDist < def.sightTiles && (nearest.stillSince && now - nearest.stillSince > 4200)) {
      const target = nearest;
      this.moveToward(c, Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE), Math.floor(target.x / TILE_SIZE), Math.floor(target.y / TILE_SIZE), def.speed, dt);
      c.state = 'approach';
      return;
    }
    // Patrulha padrão: usa uma rota pseudo-aleatória em tiles
    const target = c.stateData.stepTarget || { gx: Math.floor(c.x / TILE_SIZE), gy: Math.floor(c.y / TILE_SIZE) };
    const tx = Math.floor(c.x / TILE_SIZE);
    const ty = Math.floor(c.y / TILE_SIZE);
    if (manhattan(tx, ty, target.gx, target.gy) < 2) {
      c.stateData.stepTarget = this.randomWalkableNear(c, 6);
    }
    this.moveToward(c, tx, ty, target.gx, target.gy, def.speed, dt);
  }

  updateObservedChase(c, def, players, nearest, nearestDist, dt, now) {
    if (!nearest) {
      c.visible = false;
      c.state = 'dormant';
      return;
    }
    const observed = this.playerLookingAt(nearest, c);
    if (observed && nearestDist <= def.sightTiles) {
      c.visible = true;
      c.state = 'advance';
      c.targetPlayerId = nearest.id;
      // avança quando observado, para na borda da visão
      const speed = nearestDist > def.sightTiles * 0.7 ? def.speed * 1.35 : def.speed;
      this.moveToward(c, Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE), Math.floor(nearest.x / TILE_SIZE), Math.floor(nearest.y / TILE_SIZE), speed, dt);
    } else {
      // "congela" quando não é observado; reaparece em outro lugar depois de um tempo
      c.state = 'frozen';
      c.stateData.frozenSince = c.stateData.frozenSince || now;
      if (now - c.stateData.frozenSince > 6000) {
        const point = this.findSpawnPoint(nearest ? { gx: Math.floor(nearest.x / TILE_SIZE), gy: Math.floor(nearest.y / TILE_SIZE) } : null, 5);
        if (point) {
          c.x = point.x;
          c.y = point.y;
        }
        c.stateData.frozenSince = 0;
      }
    }
  }

  updateHuntNoise(c, def, nearest, nearestDist, dt, now) {
    if (c.state === 'investigate' && c.noiseTarget) {
      const { gx, gy } = c.stateData.stepTarget || c.noiseTarget;
      const tx = Math.floor(c.x / TILE_SIZE);
      const ty = Math.floor(c.y / TILE_SIZE);
      if (manhattan(tx, ty, gx, gy) < 2) {
        c.state = 'patrol';
        c.noiseTarget = null;
        c.stateData.stepTarget = this.randomWalkableNear(c, 5);
      } else {
        this.moveToward(c, tx, ty, gx, gy, def.speed, dt);
        return;
      }
    }
    if (nearest && nearestDist < def.sightTiles + 3) {
      this.moveToward(c, Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE), Math.floor(nearest.x / TILE_SIZE), Math.floor(nearest.y / TILE_SIZE), def.speed, dt);
      return;
    }
    const target = c.stateData.stepTarget || this.randomWalkableNear(c, 7);
    const tx = Math.floor(c.x / TILE_SIZE);
    const ty = Math.floor(c.y / TILE_SIZE);
    if (manhattan(tx, ty, target.gx, target.gy) < 2) c.stateData.stepTarget = this.randomWalkableNear(c, 7);
    this.moveToward(c, tx, ty, target.gx, target.gy, def.speed * 0.5, dt);
  }

  updateStalkIsolated(c, def, alivePlayers, dt, now) {
    // Encontra quem está sozinho: nenhum outro jogador na mesma região/raio
    const isolated = alivePlayers.filter((p) => {
      const others = alivePlayers.filter((o) => o.id !== p.id);
      const pRegion = Math.floor(p.x / TILE_SIZE / REGION_W);
      const sameRegionNear = others.some((o) => {
        const oRegion = Math.floor(o.x / TILE_SIZE / REGION_W);
        return oRegion === pRegion && Math.hypot(o.x - p.x, o.y - p.y) < 12 * TILE_SIZE;
      });
      return others.length > 0 && !sameRegionNear;
    });
    if (!isolated.length) {
      c.visible = false;
      c.state = 'waiting';
      return;
    }
    const victim = isolated.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
    c.visible = true;
    c.targetPlayerId = victim.id;
    const dist = Math.hypot(victim.x - c.x, victim.y - c.y);
    // Telegrafia: 3 batidas quando começa a caçar
    if (c.state !== 'hunt') {
      c.state = 'hunt';
      this.events.push({ type: 'telegraph', creatureId: c.id, kind: c.kind, gx: c.x, gy: c.y, sfx: 'knock' });
    }
    if (dist > 1.1 * TILE_SIZE) {
      this.moveToward(c, Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE), Math.floor(victim.x / TILE_SIZE), Math.floor(victim.y / TILE_SIZE), def.speed, dt);
    }
  }

  updateMirrorPlayer(c, def, players, dt, now) {
    let target = c.targetPlayerId ? this.playerStates.get(c.targetPlayerId) : null;
    if (target && (target.dead || target.disconnected)) target = null;
    if (!target) {
      const candidates = players.slice().sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
      target = candidates[0] || null;
      if (target) c.targetPlayerId = target.id;
    }
    if (!target) return;
    // Grava o caminho do alvo no buffer e segue com atraso
    c.mirrorBuffer.push({ x: target.x, y: target.y, t: now });
    const delayMs = 1400;
    while (c.mirrorBuffer.length > 2 && now - c.mirrorBuffer[0].t > delayMs) c.mirrorBuffer.shift();
    const ghost = c.mirrorBuffer[0];
    if (!ghost) return;
    const cx = Math.floor(c.x / TILE_SIZE);
    const cy = Math.floor(c.y / TILE_SIZE);
    const tx = Math.floor(ghost.x / TILE_SIZE);
    const ty = Math.floor(ghost.y / TILE_SIZE);
    if (Math.abs(tx - cx) + Math.abs(ty - cy) > 1) {
      this.moveToward(c, cx, cy, tx, ty, def.speed, dt);
    }
    const dist = Math.hypot(target.x - c.x, target.y - c.y);
    c.alertLevel = dist < 3 * TILE_SIZE ? 1 : 0;
    c.visible = true;
  }

  updateObserveLearn(c, def, players, dt, now) {
    // O Vigia não se move, mas "aprende": registra a posição do jogador mais
    // próximo a cada N segundos. Quando registra a 3ª posição do mesmo jogador,
    // dispara um evento ambiental (luzes) naquela área.
    if (!players.length) return;
    const nearest = players.slice().sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
    if (!nearest) return;
    const dist = Math.hypot(nearest.x - c.x, nearest.y - c.y);
    if (dist > def.sightTiles * TILE_SIZE) {
      // reaparece mais perto: "sempre mais perto quando você vira"
      if (this.rng.chance(0.02 * dt * 60)) {
        const point = this.findSpawnPoint({ gx: Math.floor(nearest.x / TILE_SIZE), gy: Math.floor(nearest.y / TILE_SIZE) }, 7);
        if (point) {
          c.x = point.x;
          c.y = point.y;
          this.events.push({ type: 'watcherMoved', creatureId: c.id });
        }
      }
      return;
    }
    if (!c.memory.lastLearn || now - c.memory.lastLearn > 3500) {
      c.memory.lastLearn = now;
      c.memory.hotspots = c.memory.hotspots || [];
      c.memory.hotspots.push({ x: nearest.x, y: nearest.y, at: now });
      if (c.memory.hotspots.length > 6) c.memory.hotspots.shift();
      this.events.push({ type: 'learning', creatureId: c.id, playerId: nearest.id, gx: Math.floor(nearest.x / TILE_SIZE), gy: Math.floor(nearest.y / TILE_SIZE) });
      if (c.memory.hotspots.length === 3) {
        this.room.envEvents.push({ type: 'surveillance', playerId: nearest.id, at: now });
      }
    }
  }

  updateAlterEnvironment(c, def, players, dt, now) {
    const target = c.stateData.stepTarget || this.randomWalkableNear(c, 6);
    const tx = Math.floor(c.x / TILE_SIZE);
    const ty = Math.floor(c.y / TILE_SIZE);
    if (manhattan(tx, ty, target.gx, target.gy) < 2) {
      c.stateData.stepTarget = this.randomWalkableNear(c, 8);
      if (this.rng.chance(0.5)) {
        this.room.envEvents.push({ type: 'organAlter', gx: tx, gy: ty, at: now });
      }
    }
    this.moveToward(c, tx, ty, target.gx, target.gy, def.speed, dt);
    // Se um jogador chega perto, foge para longe
    const nearest = players.slice().sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
    if (nearest && Math.hypot(nearest.x - c.x, nearest.y - c.y) < 4 * TILE_SIZE) {
      const away = this.randomWalkableNear(c, 5);
      this.moveToward(c, tx, ty, away.gx, away.gy, def.speed * 1.2, dt);
    }
  }

  /** Serializa apenas o necessário (id, tipo, posição, estado). */
  snapshot(full = false) {
    const list = [];
    for (const c of this.creatures.values()) {
      if (!c.visible && c.kind === 'lonely') continue;
      list.push({
        i: c.id,
        k: c.kind,
        x: Math.round(c.x),
        y: Math.round(c.y),
        s: this.stateCode(c.state),
        v: c.visible ? 1 : 0,
      });
    }
    return list;
  }

  stateCode(state) {
    return (
      {
        idle: 0,
        patrol: 1,
        approach: 2,
        recede: 3,
        dormant: 4,
        frozen: 5,
        advance: 6,
        investigate: 7,
        hunt: 8,
        waiting: 9,
        learning: 10,
      }[state] ?? 0
    );
  }

  drainEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  drainDamage() {
    const out = this.damageQueue.slice();
    this.damageQueue.length = 0;
    return out;
  }
}
