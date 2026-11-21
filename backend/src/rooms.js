/**
 * NULLSCAPE — Salas multiplayer (estado autoritativo).
 *
 * Cada sala possui:
 *  - id público, código de convite, semente do mundo, host
 *  - lista de jogadores e seus estados (posição, vida, inventário)
 *  - mundo gerado a partir da semente
 *  - sistemas: quebra-cabeças, criaturas, anomalias
 *  - progresso compartilhado (sigilos)
 *
 * Toda a simulação roda aqui. O cliente só envia intenções (input, interações)
 * e recebe snapshots. Salas vazias são destruídas automaticamente.
 */

import { generateValidWorld, serializeWorld, TILE_SIZE, REGION_W } from '../../shared/world/generator.js';
import { stepMovement } from '../../shared/sim/physics.js';
import { T } from '../../shared/world/themes.js';
import { CreatureSystem } from '../../shared/sim/creatures.js';
import { AnomalySystem } from '../../shared/sim/anomalies.js';
import { PuzzleSystem } from '../../shared/sim/puzzles.js';

const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAX_PLAYERS = 6;
const EMPTY_ROOM_GRACE_MS = 60 * 1000;
const DISCONNECT_GRACE_MS = 90 * 1000;

const MAX_HP = 100;
const MAX_HINTS_PER_MINUTE = 12;

function randomCode(rngSeed = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(rngSeed() * alphabet.length)];
  return out;
}

function sanitizeName(name) {
  if (typeof name !== 'string') return 'Anônimo';
  const clean = name.replace(/[^\p{L}\p{N} _\-.'’]/gu, '').trim().slice(0, 18);
  return clean || 'Anônimo';
}

export class Room {
  constructor({ id, code, seed, name, isPrivate, hostId, publicDirectory, io }) {
    this.id = id;
    this.code = code;
    this.name = name || 'Sala sem nome';
    this.seed = seed;
    this.isPrivate = !!isPrivate;
    this.hostId = hostId;
    this.createdAt = Date.now();
    this.publicDirectory = publicDirectory;
    this.io = io;
    this.players = new Map(); // socketId -> player
    this.playerStates = new Map(); // playerId -> state
    this.sockets = new Map(); // playerId -> socket
    this.events = [];
    this.envEvents = [];
    this.lastEmptyAt = null;
    this.started = false;
    this.shared = {
      sigils: 0,
      delivered: new Set(),
      discovered: new Set(),
      puzzleSolved: new Set(),
      notesRead: new Set(),
      completedAt: null,
      deaths: 0,
      distanceWalked: 0,
    };
    this.stats = { interactions: 0, anomalies: 0, creatureSpawns: 0 };
    this.interval = null;
    this.lastTickAt = Date.now();
    this.accumulator = 0;
    this.world = null;
    this.creatureSystem = null;
    this.anomalySystem = null;
    this.puzzleSystem = null;
    this.metrics = { ticks: 0, lastSnapshotBytes: 0, actionsPerSecond: 0, actionBudget: new Map() };
    this.finished = false;
  }

  /** Cria o mundo e inicializa os sistemas (chamado uma vez). */
  initWorld() {
    this.world = generateValidWorld(this.seed);
    const blockers = [];
    for (const region of this.world.regions) {
      for (const room of region.rooms) {
        // nada: props já viram WALL no grid, bloqueadores extras não são necessários
        void room;
      }
    }
    this.blockers = blockers;
    this.creatureSystem = new CreatureSystem(this);
    this.anomalySystem = new AnomalySystem(this);
    this.puzzleSystem = new PuzzleSystem(this);
    // Garante ao menos uma criatura inicial por sessão
    this.creatureSystem.spawn(this.creatureSystem.spawnProfile[0], { minDist: 10 });
    return this.world;
  }

  get size() {
    return this.players.size;
  }

  get connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.disconnected) n++;
    return n;
  }

  addPlayer({ socketId, name, clientId }) {
    if (this.players.size >= MAX_PLAYERS) return { error: 'sala cheia' };
    if (!this.world) return { error: 'mundo não inicializado' };
    const playerId = `p_${socketId}`;
    const spawn = this.world.spawn;
    const player = {
      id: playerId,
      clientId: clientId || null,
      socketId,
      name: sanitizeName(name),
      color: this.pickColor(),
      x: (spawn.x + 0.5) * TILE_SIZE,
      y: (spawn.y + 0.5) * TILE_SIZE,
      vx: 0,
      vy: 0,
      dirX: 0,
      dirY: 1,
      hp: MAX_HP,
      maxHp: MAX_HP,
      dead: false,
      deadAt: null,
      disconnected: false,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      lastInputAt: Date.now(),
      input: { dx: 0, dy: 0, run: false },
      hasKeycard: false,
      inventory: [],
      stillSince: Date.now(),
      lastInteractAt: 0,
      interactBudget: MAX_HINTS_PER_MINUTE,
      interactBudgetAt: Date.now(),
      lookX: 0,
      lookY: 1,
      safeUntil: 0,
      stats: { distance: 0, notes: 0, anomaliesSeen: 0 },
      isHost: this.players.size === 0,
    };
    this.players.set(socketId, player);
    this.playerStates.set(playerId, player);
    this.lastEmptyAt = null;
    if (this.players.size === 1) this.hostId = socketId;
    this.pushEvent({
      type: 'playerJoined',
      player: this.publicPlayer(player),
    });
    return { player };
  }

  pickColor() {
    const palette = [0xd8cf9a, 0x9ab8d8, 0xc9a4c1, 0x9ad8b0, 0xd8a49a, 0xb0a4d8];
    const used = new Set(Array.from(this.players.values()).map((p) => p.color));
    for (const c of palette) if (!used.has(c)) return c;
    return palette[this.players.size % palette.length];
  }

  publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      isHost: p.isHost,
      disconnected: p.disconnected,
      hp: p.hp,
      dead: p.dead,
    };
  }

  removePlayer(socketId, reason = 'left') {
    const p = this.players.get(socketId);
    if (!p) return;
    this.players.delete(socketId);
    this.playerStates.delete(p.id);
    this.sockets.delete(p.id);
    if (this.hostId === socketId) {
      const next = this.players.values().next().value;
      this.hostId = next ? next.socketId : null;
      if (next) next.isHost = true;
    }
    this.pushEvent({ type: 'playerLeft', playerId: p.id, name: p.name, reason });
    // Solta alavancas que o jogador segurava
    if (this.puzzleSystem) {
      for (const st of this.puzzleSystem.state.values()) st.held.delete(p.id);
    }
    if (this.players.size === 0) {
      this.lastEmptyAt = Date.now();
      this.started = false;
    }
  }

  /** Desconexão temporária (reconexão permitida). */
  markDisconnected(socketId) {
    const p = this.players.get(socketId);
    if (!p) return null;
    p.disconnected = true;
    p.disconnectedAt = Date.now();
    p.input = { dx: 0, dy: 0, run: false };
    this.sockets.delete(p.id);
    this.pushEvent({ type: 'playerDisconnected', playerId: p.id, name: p.name });
    return p;
  }

  /** Reconecta um jogador pelo clientId (token persistido no navegador). */
  reconnectPlayer({ clientId, socketId }) {
    for (const p of Array.from(this.players.values())) {
      if (p.clientId && p.clientId === clientId && p.disconnected) {
        this.players.delete(p.socketId);
        p.socketId = socketId;
        p.disconnected = false;
        p.disconnectedAt = null;
        p.lastSeenAt = Date.now();
        p.isHost = this.hostId === socketId || this.hostId === null;
        if (this.hostId === null) this.hostId = socketId;
        this.players.set(socketId, p);
        this.playerStates.set(p.id, p);
        this.pushEvent({ type: 'playerReconnected', playerId: p.id, name: p.name });
        return p;
      }
    }
    return null;
  }

  /** Limpa jogadores desconectados há muito tempo. */
  sweepDisconnects(now) {
    let removed = 0;
    for (const p of Array.from(this.players.values())) {
      if (p.disconnected && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS) {
        this.removePlayer(p.socketId, 'timeout');
        removed++;
      }
    }
    return removed;
  }

  isEmpty() {
    return this.players.size === 0;
  }

  shouldBeCleaned(now) {
    return this.isEmpty() && this.lastEmptyAt && now - this.lastEmptyAt > EMPTY_ROOM_GRACE_MS;
  }

  /** Aplica input validado. */
  applyInput(socketId, input) {
    const p = this.players.get(socketId);
    if (!p || p.dead) return { ok: false };
    const now = Date.now();
    let dx = Number(input?.dx);
    let dy = Number(input?.dy);
    if (!Number.isFinite(dx)) dx = 0;
    if (!Number.isFinite(dy)) dy = 0;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    p.input = { dx, dy, run: !!input?.run };
    if (mag > 0.01) {
      p.dirX = dx / (mag || 1);
      p.dirY = dy / (mag || 1);
      p.lookX = p.dirX;
      p.lookY = p.dirY;
      p.stillSince = null;
    } else if (!p.stillSince) {
      p.stillSince = now;
    }
    p.lastInputAt = now;
    p.lastSeenAt = now;
    if (input?.look) {
      const lx = Number(input.look.x);
      const ly = Number(input.look.y);
      if (Number.isFinite(lx) && Number.isFinite(ly)) {
        p.lookX = lx;
        p.lookY = ly;
      }
    }
    return { ok: true };
  }

  /** Interação com mecanismo/objeto (validação de distância no PuzzleSystem). */
  interact(socketId, targetId, now = Date.now()) {
    const p = this.players.get(socketId);
    if (!p || p.dead) return { ok: false, error: 'jogador inválido' };
    if (now - p.lastInteractAt < 180) return { ok: false, error: 'muito rápido' };
    p.lastInteractAt = now;
    // orçamento por minuto
    if (now - p.interactBudgetAt > 60000) {
      p.interactBudget = MAX_HINTS_PER_MINUTE;
      p.interactBudgetAt = now;
    }
    if (p.interactBudget <= 0) return { ok: false, error: 'calma' };
    p.interactBudget--;
    this.stats.interactions++;

    // Objetos especiais primeiro
    if (targetId === 'altar') return this.interactAltar(p, now);
    const sigil = this.world.sigils.find((s) => s.id === targetId);
    if (sigil) return this.pickupSigil(p, sigil, now);
    const note = this.world.notes.find((n) => n.id === targetId);
    if (note) {
      const dist = Math.hypot(p.x - (note.gx + 0.5) * TILE_SIZE, p.y - (note.gy + 0.5) * TILE_SIZE);
      if (dist > 2.2 * TILE_SIZE) return { ok: false, error: 'fora de alcance' };
      this.shared.notesRead.add(note.id);
      this.pushEvent({ type: 'noteRead', playerId: p.id, note });
      return { ok: true, note, type: 'note' };
    }
    const door = this.world.doors.find((d) => d.id === targetId);
    if (door) return this.toggleDoor(p, door, now);
    const prop = this.world.props.find((pr) => pr.id === targetId);
    if (prop) {
      const dist = Math.hypot(p.x - (prop.gx + 0.5) * TILE_SIZE, p.y - (prop.gy + 0.5) * TILE_SIZE);
      if (dist > 2.4 * TILE_SIZE) return { ok: false, error: 'fora de alcance' };
      if (prop.contains) {
        // Revela item escondido (cartão)
        this.pushEvent({ type: 'reveal', playerId: p.id, propId: prop.id, itemId: prop.contains });
        return { ok: true, type: 'reveal', itemId: prop.contains };
      }
      this.pushEvent({ type: 'inspect', playerId: p.id, propId: prop.id, kind: prop.kind });
      return { ok: true, type: 'inspect', prop };
    }
    // Mecanismo de quebra-cabeça
    const result = this.puzzleSystem.interact(p.id, targetId, now);
    if (!result.ok && result.error === 'fora de alcance') {
      return { ok: false, error: 'fora de alcance' };
    }
    if (result.events?.length) {
      for (const ev of result.events) this.pushEvent({ ...ev, playerId: p.id });
      const sfx = result.events.find((e) => e.type === 'sfx');
      if (sfx) this.creatureSystem.notifyPlayerAction(p.id, 'noise');
    }
    return result;
  }

  toggleDoor(p, door, now) {
    const dist = Math.hypot(p.x - (door.gx + 0.5) * TILE_SIZE, p.y - (door.gy + 0.5) * TILE_SIZE);
    if (dist > 2.4 * TILE_SIZE) return { ok: false, error: 'fora de alcance' };
    if (door.kind === 'gate') {
      if (door.open) return { ok: true, type: 'gate', door };
      const need = door.requirement?.count || 0;
      if (this.shared.sigils < need) {
        return { ok: false, error: `Este portão exige ${need} sigilo(s). Vocês têm ${this.shared.sigils}.` };
      }
      door.open = true;
      this.pushEvent({ type: 'gateOpened', doorId: door.id, label: door.label });
      this.creatureSystem.notifyPlayerAction(p.id, 'door');
      return { ok: true, type: 'gate', door };
    }
    door.open = !door.open;
    // Portas fechadas bloqueiam fisicamente: aplicamos nos grids do mundo
    this.applyDoorCollision(door);
    this.pushEvent({ type: 'door', doorId: door.id, open: door.open });
    this.creatureSystem.notifyPlayerAction(p.id, 'door');
    return { ok: true, type: 'door', door };
  }

  applyDoorCollision(door) {
    for (const cell of door.cells) {
      const region = this.world.regions[Math.floor((cell.x + cell.ox) / REGION_W)];
      if (!region) continue;
      const lx = cell.x;
      const ly = cell.y;
      const current = region.grid.get(lx, ly);
      if (door.open) {
        if (current === T.WALL) region.grid.set(lx, ly, T.DOORWAY);
      } else {
        if (current === T.DOORWAY) region.grid.set(lx, ly, T.WALL);
      }
    }
  }

  pickupSigil(p, sigil, now) {
    if (!sigil.revealed) return { ok: false, error: 'O sigilo ainda está velado. Resolva o mecanismo da região.' };
    if (sigil.taken) return { ok: false, error: 'Este sigilo já foi levado.' };
    const dist = Math.hypot(p.x - (sigil.gx + 0.5) * TILE_SIZE, p.y - (sigil.gy + 0.5) * TILE_SIZE);
    if (dist > 2.2 * TILE_SIZE) return { ok: false, error: 'fora de alcance' };
    sigil.taken = true;
    sigil.carriedBy = p.id;
    p.inventory.push(sigil.id);
    this.pushEvent({ type: 'sigilTaken', sigilId: sigil.id, playerId: p.id, name: sigil.name });
    return { ok: true, type: 'sigil', sigil };
  }

  interactAltar(p, now) {
    const altar = this.world.altar;
    if (!altar) return { ok: false, error: 'sem altar' };
    const dist = Math.hypot(p.x - (altar.gx + 0.5) * TILE_SIZE, p.y - (altar.gy + 0.5) * TILE_SIZE);
    if (dist > 2.4 * TILE_SIZE) return { ok: false, error: 'fora de alcance' };
    const carried = p.inventory.filter((id) => id.startsWith('sigil-'));
    if (!carried.length) {
      return { ok: false, error: 'O Altar está vazio. Traga os sigilos das regiões.' };
    }
    for (const sigilId of carried) {
      const sigil = this.world.sigils.find((s) => s.id === sigilId);
      if (!sigil) continue;
      sigil.taken = true;
      sigil.delivered = true;
      sigil.carriedBy = null;
      this.shared.delivered.add(sigilId);
      p.inventory = p.inventory.filter((id) => id !== sigilId);
    }
    this.shared.sigils = this.shared.delivered.size;
    this.shared.puzzleSolved = new Set(this.puzzleSystem.solvedOrder);
    this.pushEvent({ type: 'sigilDelivered', playerId: p.id, count: this.shared.sigils, total: 4 });
    if (this.shared.sigils >= 4) {
      this.finishSession(p);
    }
    return { ok: true, type: 'altar', delivered: this.shared.sigils };
  }

  finishSession(p) {
    this.finished = true;
    this.shared.completedAt = Date.now();
    this.pushEvent({
      type: 'sessionComplete',
      byPlayerId: p.id,
      byName: p.name,
      stats: {
        deaths: this.shared.deaths,
        notes: this.shared.notesRead.size,
        anomalies: this.anomalySystem.history.length,
        distanceTiles: Math.round(this.shared.distanceWalked / TILE_SIZE),
        durationMs: Date.now() - this.createdAt,
      },
    });
  }

  /** Respawn de jogador morto. */
  respawn(socketId) {
    const p = this.players.get(socketId);
    if (!p || !p.dead) return false;
    const spawn = this.world.spawn;
    p.dead = false;
    p.hp = MAX_HP;
    p.deadAt = null;
    p.x = (spawn.x + 0.5) * TILE_SIZE;
    p.y = (spawn.y + 0.5) * TILE_SIZE;
    p.safeUntil = Date.now() + 4000;
    this.pushEvent({ type: 'respawn', playerId: p.id });
    return true;
  }

  damagePlayer(playerId, amount, source) {
    const p = this.playerStates.get(playerId);
    if (!p || p.dead) return;
    const now = Date.now();
    if (p.safeUntil && now < p.safeUntil) return;
    p.hp = Math.max(0, p.hp - amount);
    this.pushEvent({ type: 'damage', playerId, amount, hp: p.hp, source });
    if (p.hp <= 0) {
      p.dead = true;
      p.deadAt = now;
      this.shared.deaths++;
      p.inventory = p.inventory.filter((id) => {
        const sigil = this.world.sigils.find((s) => s.id === id);
        if (sigil) {
          sigil.taken = false;
          sigil.carriedBy = null;
        }
        return !sigil;
      });
      this.pushEvent({ type: 'playerDied', playerId, name: p.name });
    }
  }

  pushEvent(event) {
    this.events.push(event);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  /** Snapshot do estado de progresso enviado aos clientes. */
  stateSnapshot() {
    return {
      sigils: this.shared.sigils,
      delivered: Array.from(this.shared.delivered),
      solved: Array.from(this.puzzleSystem.state.entries())
        .filter(([, st]) => st.solved)
        .map(([id]) => id),
      puzzles: this.puzzleSystem.snapshot(),
      // Portões sempre (progresso compartilhado) + portas internas apenas
      // quando fechadas — o cliente assume abertas as que não vierem.
      doors: this.world.doors
        .filter((d) => d.kind === 'gate' || !d.open)
        .map((d) => ({ id: d.id, open: d.open, kind: d.kind })),
      sigilStates: this.world.sigils.map((s) => ({
        id: s.id,
        revealed: !!s.revealed,
        taken: s.taken,
        delivered: s.delivered,
        carriedBy: s.carriedBy,
      })),
      notesRead: Array.from(this.shared.notesRead),
      completed: this.finished,
      completedAt: this.shared.completedAt,
      altar: this.world.altar ? { id: this.world.altar.id, gx: this.world.altar.gx, gy: this.world.altar.gy } : null,
      creatures: this.creatureSystem.snapshot(),
      anomalies: this.anomalySystem.snapshot(),
    };
  }

  /** Loop de simulação (chamado pelo servidor). */
  tick(dt, now) {
    if (!this.world) return;
    this.metrics.ticks++;
    this.lastTickAt = now;
    const activePlayers = Array.from(this.players.values()).filter((p) => !p.dead && !p.disconnected);

    for (const p of activePlayers) {
      const prevX = p.x;
      const prevY = p.y;
      let input = p.input;
      // Anomalia 'reverse' inverte o input por alguns instantes
      const reverse = this.anomalySystem.active.find((a) => a.kind === 'reverse' && a.params.playerId === p.id);
      if (reverse) input = { ...input, dx: -input.dx, dy: -input.dy };
      stepMovement(this.world, p, input, dt, null);
      const dist = Math.hypot(p.x - prevX, p.y - prevY);
      p.stats.distance += dist;
      this.shared.distanceWalked += dist;
      p.region = Math.floor(p.x / TILE_SIZE / REGION_W);
      if (p.input.run && dist > 0.5 && now % 400 < TICK_MS * 2) {
        this.creatureSystem.notifyPlayerAction(p.id, 'sprint');
      }
    }

    this.creatureSystem.update(dt, now);
    this.puzzleSystem.update(dt, now);
    this.anomalySystem.update(dt, now);

    // Eventos ambientais gerados por criaturas
    for (const envEvent of this.creatureSystem.room.envEvents.splice(0)) {
      const anomalyEvent = this.anomalySystem.applyEnvironmental(envEvent, now);
      if (anomalyEvent) {
        this.pushEvent(anomalyEvent);
        this.stats.anomalies++;
      }
    }
    for (const ev of this.anomalySystem.active) {
      void ev;
    }

    // Criaturas -> ataques
    for (const dmg of this.creatureSystem.drainDamage()) {
      this.damagePlayer(dmg.playerId, dmg.amount, dmg.kind);
      const p = this.playerStates.get(dmg.playerId);
      if (p) p.safeUntil = now + 900; // i-frames curtos
    }
    // Sistema de criaturas -> eventos
    for (const ev of this.creatureSystem.drainEvents()) {
      this.pushEvent(ev);
      if (ev.type === 'spawn') this.stats.creatureSpawns++;
    }
    for (const ev of this.puzzleSystem.drainEvents()) {
      this.pushEvent(ev);
      if (ev.type === 'puzzleSolved') {
        this.shared.puzzleSolved.add(ev.puzzleId);
        this.shared.discovered.add(ev.puzzleId);
      }
    }

    // Coleta input para respawn automático
    for (const p of this.players.values()) {
      if (p.dead && p.deadAt && now - p.deadAt > 9000) {
        this.respawn(p.socketId);
      }
    }
  }

  /** Snapshot compacto enviado a cada tick. */
  movementSnapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        i: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        d: Math.round(Math.atan2(p.dirY, p.dirX) * 100) / 100,
        hp: p.hp,
        dead: p.dead ? 1 : 0,
        dc: p.disconnected ? 1 : 0,
        run: p.input.run && Math.hypot(p.vx, p.vy) > 60 ? 1 : 0,
        st: p.stillSince ? Math.min(600, Math.round((Date.now() - p.stillSince) / 100)) : 0,
      });
    }
    return players;
  }
}

// ---------------------------------------------------------------------------

/**
 * Gerenciador de todas as salas. Cria, encontra, limpa.
 */
export class RoomManager {
  constructor({ io, maxRooms = 120, log = console }) {
    this.io = io;
    this.rooms = new Map(); // roomId -> Room
    this.bindings = new Map(); // socketId -> roomId
    this.byCode = new Map();
    this.maxRooms = maxRooms;
    this.log = log;
    this.counter = 0;
  }

  listPublic() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.isPrivate) continue;
      out.push(this.publicInfo(room));
    }
    return out.sort((a, b) => b.players - a.players).slice(0, 60);
  }

  publicInfo(room) {
    return {
      id: room.id,
      name: room.name,
      code: room.code,
      players: room.players.size,
      max: MAX_PLAYERS,
      hostName: room.players.get(room.hostId)?.name || '—',
      region: room.world?.regions?.[0]?.theme?.label || 'Desconhecida',
      seed: room.seed,
      started: room.players.size > 0,
      private: room.isPrivate,
    };
  }

  all() {
    return Array.from(this.rooms.values());
  }

  getBySocket(socketId) {
    const roomId = this.bindings.get(socketId);
    return roomId ? this.rooms.get(roomId) || null : null;
  }

  get(roomId) {
    return this.rooms.get(roomId) || null;
  }

  findByCode(code) {
    if (!code) return null;
    return this.byCode.get(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')) || null;
  }

  createRoom({ name, seed, isPrivate, hostId, hostName, code: requestedCode }) {
    if (this.rooms.size >= this.maxRooms) {
      const now = Date.now();
      for (const room of this.all()) if (room.shouldBeCleaned(now) || room.isEmpty()) this.dropRoom(room.id);
      if (this.rooms.size >= this.maxRooms) return { error: 'servidor cheio; tente novamente em instantes' };
    }
    let code = requestedCode ? String(requestedCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
    if (!code || code.length < 4) {
      do {
        code = randomCode();
      } while (this.byCode.has(code));
    }
    if (this.byCode.has(code)) return { error: 'código já em uso' };
    const id = `room-${++this.counter}-${code.toLowerCase()}`;
    const room = new Room({
      id,
      code,
      seed: seed || undefined,
      name: name || `Sala de ${hostName || 'anônimo'}`,
      isPrivate,
      hostId,
      io: this.io,
      publicDirectory: this,
    });
    try {
      room.initWorld();
    } catch (err) {
      this.log.error?.(`[sala] falha ao gerar mundo: ${err.message}`);
      return { error: 'não foi possível gerar o mundo; tente outra semente' };
    }
    this.rooms.set(id, room);
    this.byCode.set(code, room);
    this.log.info?.(`[sala] criada ${room.id} code=${code} seed=${room.seed} privada=${!!isPrivate}`);
    return { room };
  }

  dropRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.delete(roomId);
    if (room.code) this.byCode.delete(room.code);
    for (const [socketId, rid] of this.bindings) if (rid === roomId) this.bindings.delete(socketId);
    room.creatureSystem?.clear();
    room.anomalySystem?.reset();
    this.log.info?.(`[sala] destruída ${roomId} (seed ${room.seed})`);
  }

  cleanup(now = Date.now()) {
    let dropped = 0;
    for (const room of this.all()) {
      if (room.shouldBeCleaned(now)) {
        this.dropRoom(room.id);
        dropped++;
      }
    }
    return dropped;
  }

  bindSocket(socketId, roomId) {
    this.bindings.set(socketId, roomId);
  }

  unbindSocket(socketId) {
    this.bindings.delete(socketId);
  }
}

export const RoomConstants = {
  TICK_RATE,
  TICK_MS,
  MAX_PLAYERS,
  EMPTY_ROOM_GRACE_MS,
  DISCONNECT_GRACE_MS,
  MAX_HP,
};
