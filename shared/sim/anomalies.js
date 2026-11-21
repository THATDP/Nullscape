/**
 * NULLSCAPE — Anomalias.
 *
 * Cada anomalia é um evento com regras internas, duração, raridade e um
 * "contra-jogo" que o jogador pode aprender. O sistema escolhe anomalias com
 * base na tensão da sala (jogadores parados, tempo desde o último evento,
 * proximidade de criaturas) — nunca puramente aleatório.
 *
 * Raridades: 'sutil' (comum), 'moderada', 'rara', 'impossível'.
 * Durações curtas; nenhuma anomalia é permanente.
 */

import { Rng } from '../world/rng.js';
import { REGION_W, REGION_H } from '../world/generator.js';
import { T } from '../world/themes.js';
import { TILE_SIZE } from './physics.js';

export const ANOMALY_DEFS = {
  flicker: {
    id: 'flicker',
    label: 'Piscada nas Luzes',
    rarity: 'sutil',
    durationMs: 4000,
    cooldownMs: 22000,
    weight: 4,
    message: 'As luzes desta sala não estavam piscando antes.',
    rule: 'Só ocorre em salas com luzes marcadas como instáveis.',
    tension: 0,
    client: 'flicker',
  },
  shift: {
    id: 'shift',
    label: 'Corredor Deslocado',
    rarity: 'moderada',
    durationMs: 5000,
    cooldownMs: 40000,
    weight: 2.5,
    message: 'Um corredor parece ter mudado de lugar.',
    rule: 'Só ocorre se ninguém está olhando diretamente para o corredor.',
    client: 'shift',
  },
  doorVanish: {
    id: 'doorVanish',
    label: 'A Porta que Não Existe',
    rarity: 'moderada',
    durationMs: 6000,
    cooldownMs: 45000,
    weight: 2,
    message: 'Uma porta se lembra de que nunca existiu.',
    rule: 'Exige ao menos uma porta interna na região.',
    client: 'doorVanish',
  },
  murmur: {
    id: 'murmur',
    label: 'Vozes do Outro Corredor',
    rarity: 'sutil',
    durationMs: 6000,
    cooldownMs: 18000,
    weight: 4,
    message: 'Alguém sussurra o seu nome com a sua voz.',
    rule: 'Toca um áudio espacializado vindo da região vizinha.',
    client: 'murmur',
  },
  impossibleRepetition: {
    id: 'impossibleRepetition',
    label: 'Repetição Impossível',
    rarity: 'rara',
    durationMs: 7000,
    cooldownMs: 70000,
    weight: 1.2,
    message: 'A mesma sala aparece duas vezes. A segunda está vazia.',
    rule: 'Só em salas de corredor longo.',
    client: 'repeat',
  },
  geometry: {
    id: 'geometry',
    label: 'Geometria Dobrada',
    rarity: 'rara',
    durationMs: 8000,
    cooldownMs: 80000,
    weight: 1,
    message: 'O chão se curva onde não deveria.',
    rule: 'A curvatura é visível apenas no efeito visual; a colisão permanece verdadeira.',
    client: 'geometry',
  },
  reverse: {
    id: 'reverse',
    label: 'O Mundo Invertido',
    rarity: 'impossível',
    durationMs: 3500,
    cooldownMs: 120000,
    weight: 0.5,
    message: 'Por um instante, você caminha para dentro do som.',
    rule: 'Inverte o vetor de movimento do jogador. Termina sempre.',
    client: 'reverse',
  },
  lightsDie: {
    id: 'lightsDie',
    label: 'Apagão Local',
    rarity: 'moderada',
    durationMs: 5000,
    cooldownMs: 50000,
    weight: 2.2,
    message: 'A luz desiste.',
    rule: 'Ocorre especialmente quando uma Válvula Orgânica está ativa.',
    client: 'lightsDie',
  },
  watcherWindow: {
    id: 'watcherWindow',
    label: 'Algo na Janela',
    rarity: 'rara',
    durationMs: 3000,
    cooldownMs: 60000,
    weight: 1.1,
    message: 'Alguém molha um vidro que não existe.',
    rule: 'Só ocorre em ambientes com janelas ou espelhos.',
    client: 'watcherWindow',
  },
  stepEcho: {
    id: 'stepEcho',
    label: 'Passos Antecipados',
    rarity: 'sutil',
    durationMs: 5000,
    cooldownMs: 25000,
    weight: 3,
    message: 'Seus passos chegam antes de você.',
    rule: 'Só ocorre com jogadores em movimento.',
    client: 'stepEcho',
  },
  moveroom: {
    id: 'moveroom',
    label: 'Sala Deslocada',
    rarity: 'impossível',
    durationMs: 2000,
    cooldownMs: 150000,
    weight: 0.35,
    message: 'Por um instante, a sala não é mais a mesma sala.',
    rule: 'Todos os jogadores da sala veem o mesmo deslocamento. Não afeta colisão.',
    client: 'moveroom',
  },
};

const RARITY_ORDER = ['sutil', 'moderada', 'rara', 'impossível'];

export class AnomalySystem {
  constructor(room) {
    this.room = room;
    this.rng = new Rng(`${room.world.seed}:anomalies`);
    this.active = [];
    this.lastByKind = new Map();
    this.history = [];
    this.lastEventAt = Date.now();
    this.nextCheckAt = Date.now() + this.rng.int(12000, 22000);
    this.discovered = new Set();
  }

  /** Calcula a tensão da sala (0..1). */
  tension(now) {
    const players = Array.from(this.room.playerStates.values()).filter((p) => !p.dead && !p.disconnected);
    if (!players.length) return 0;
    let still = 0;
    for (const p of players) {
      const moving = Math.hypot(p.vx || 0, p.vy || 0) > 25;
      if (!moving) still++;
    }
    const idleRatio = still / players.length;
    const spread = this.playerSpread(players);
    const separated = spread > 14 ? 1 : spread / 14;
    const sinceEvent = Math.min(1, (now - this.lastEventAt) / 45000);
    return Math.min(1, idleRatio * 0.35 + separated * 0.35 + sinceEvent * 0.3);
  }

  playerSpread(players) {
    if (players.length < 2) return 8;
    let max = 0;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        max = Math.max(max, Math.hypot(players[i].x - players[j].x, players[i].y - players[j].y) / TILE_SIZE);
      }
    }
    return max;
  }

  /** Elenco de anomalias permitido nesta sala (por região e tema). */
  allowedKinds() {
    return Object.values(ANOMALY_DEFS);
  }

  regionForPlayer(p) {
    return Math.floor(p.x / TILE_SIZE / REGION_W);
  }

  pickAnomaly(now) {
    const players = Array.from(this.room.playerStates.values()).filter((p) => !p.dead && !p.disconnected);
    if (!players.length) return null;
    const tension = this.tension(now);
    const candidates = [];
    for (const def of this.allowedKinds()) {
      const last = this.lastByKind.get(def.id) || 0;
      if (now - last < def.cooldownMs) continue;
      if (def.id === 'reverse' && tension < 0.55) continue;
      if (def.id === 'moveroom' && tension < 0.7) continue;
      if (def.id === 'watcherWindow' && tension < 0.35) continue;
      if (def.id === 'stepEcho' && !players.some((p) => Math.hypot(p.vx || 0, p.vy || 0) > 40)) continue;
      if (def.id === 'impossibleRepetition' && players.length < 2) continue;
      const rarityBoost = { sutil: 1, moderada: 1 + tension * 0.6, rara: 0.6 + tension * 1.3, impossível: tension * 1.8 }[def.rarity] || 1;
      candidates.push({ def, weight: def.weight * rarityBoost });
    }
    if (!candidates.length) return null;
    return this.rng.weighted(candidates);
  }

  /** Inicia uma anomalia e devolve o evento para os clientes. */
  trigger(now = Date.now(), forcedKind = null) {
    const def = forcedKind ? ANOMALY_DEFS[forcedKind] : this.pickAnomaly(now);
    if (!def) return null;
    const players = Array.from(this.room.playerStates.values()).filter((p) => !p.dead && !p.disconnected);
    if (!players.length) return null;
    const focus = this.rng.pick(players);
    const region = this.regionForPlayer(focus);
    const active = {
      id: `a${this.history.length + 1}`,
      kind: def.id,
      rarity: def.rarity,
      startedAt: now,
      endsAt: now + def.durationMs,
      region,
      focusPlayerId: focus.id,
      params: this.buildParams(def, region, focus),
    };
    this.active.push(active);
    this.lastByKind.set(def.id, now);
    this.lastEventAt = now;
    this.history.push({ ...active, message: def.message });
    if (this.history.length > 40) this.history.shift();
    this.discovered.add(def.id);
    return {
      type: 'anomaly',
      anomaly: {
        id: active.id,
        kind: active.kind,
        rarity: active.rarity,
        endsAt: active.endsAt,
        region: active.region,
        params: active.params,
        message: def.message,
        label: def.label,
        client: def.client,
      },
    };
  }

  buildParams(def, region, focus) {
    switch (def.id) {
      case 'shift': {
        const rooms = this.room.world.regions[region]?.rooms || [];
        const room = this.rng.pick(rooms.filter((r) => !r.secret)) || rooms[0];
        return room ? { gx: room.x + region * REGION_W, gy: room.y, w: room.w, h: room.h, roomId: room.id } : {};
      }
      case 'doorVanish': {
        const doors = (this.room.world.doors || []).filter((d) => d.kind === 'normal' && d.region === region);
        const door = this.rng.pick(doors);
        return door ? { doorId: door.id, gx: door.gx, gy: door.gy } : {};
      }
      case 'murmur':
        return { region, audio: 'murmur' };
      case 'impossibleRepetition': {
        const rooms = this.room.world.regions[region]?.rooms || [];
        const room = this.rng.pick(rooms.filter((r) => !r.secret)) || rooms[0];
        return room ? { gx: room.x + region * REGION_W, gy: room.y, w: room.w, h: room.h, roomId: room.id } : {};
      }
      case 'geometry':
        return { gx: Math.floor(focus.x / TILE_SIZE), gy: Math.floor(focus.y / TILE_SIZE) };
      case 'lightsDie': {
        const lights = (this.room.world.regions[region]?.lights || []).slice(0, 24).map((l) => ({ x: l.x, y: l.y }));
        return { lights };
      }
      case 'watcherWindow':
        return { gx: Math.floor(focus.x / TILE_SIZE), gy: Math.floor(focus.y / TILE_SIZE) };
      case 'reverse':
      case 'stepEcho':
        return { playerId: focus.id };
      case 'moveroom': {
        const rooms = this.room.world.regions[region]?.rooms || [];
        const room = this.rng.pick(rooms.filter((r) => r.role === 'normal')) || rooms[0];
        return room ? { roomId: room.id, gx: room.x + region * REGION_W, gy: room.y, w: room.w, h: room.h } : {};
      }
      case 'flicker': {
        const rooms = this.room.world.regions[region]?.rooms || [];
        const room = this.rng.pick(rooms) || rooms[0];
        return room ? { gx: room.x + region * REGION_W, gy: room.y, w: room.w, h: room.h } : {};
      }
      default:
        return {};
    }
  }

  /** Atualiza: expira anomalias e decide novas com base na tensão. */
  update(dt, now) {
    this.active = this.active.filter((a) => {
      if (now >= a.endsAt) {
        this.room.events.push({ type: 'anomalyEnd', anomalyId: a.id });
        return false;
      }
      return true;
    });
    if (now < this.nextCheckAt) return;
    const tension = this.tension(now);
    // Intervalo entre anomalias diminui com tensão alta
    const base = 30000 - tension * 18000;
    this.nextCheckAt = now + base + this.rng.int(-4000, 8000);
    if (this.active.length >= 2) return;
    const chance = 0.35 + tension * 0.5;
    if (this.rng.chance(chance)) {
      const event = this.trigger(now);
      if (event) this.room.events.push(event);
    }
  }

  /**
   * Eventos ambientais adicionais (organAlter, surveillance) vindos das criaturas.
   * Convertem comportamento de criatura em anomalia concreta.
   */
  applyEnvironmental(event, now) {
    if (event.type === 'organAlter') {
      return {
        type: 'anomaly',
        anomaly: {
          id: `env${now}`,
          kind: 'lightsDie',
          rarity: 'moderada',
          endsAt: now + 4000,
          region: Math.floor(event.gx / REGION_W),
          params: { gx: event.gx, gy: event.gy },
          message: 'A luz desiste.',
          label: ANOMALY_DEFS.lightsDie.label,
          client: 'lightsDie',
        },
      };
    }
    if (event.type === 'surveillance') {
      return {
        type: 'anomaly',
        anomaly: {
          id: `sv${now}`,
          kind: 'watcherWindow',
          rarity: 'rara',
          endsAt: now + 3000,
          region: 0,
          params: { playerId: event.playerId },
          message: 'Algo te viu pela terceira vez. Não é a primeira.',
          label: ANOMALY_DEFS.watcherWindow.label,
          client: 'watcherWindow',
        },
      };
    }
    return null;
  }

  snapshot() {
    return this.active.map((a) => ({ id: a.id, kind: a.kind, endsAt: a.endsAt, region: a.region }));
  }

  reset() {
    this.active = [];
    this.history = [];
    this.lastByKind.clear();
  }
}
