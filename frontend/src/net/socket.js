/**
 * NULLSCAPE — Cliente de rede.
 *
 * Responsabilidades:
 *  - conexão com o servidor (URL configurável; padrão = mesma origem)
 *  - fila de mensagens + latência medida
 *  - reconexão com token de sessão persistido no navegador
 *  - "predição local + reconciliação": o movimento local é simulado com o
 *    MESMO módulo de física do servidor; snapshots corrigem suavemente.
 *  - interpolação de corpos remotos (buffer de 120ms)
 */

import { io as ioClient } from 'socket.io-client';
import { lerp } from '../../../shared/sim/physics.js';

const SNAPSHOT_DELAY_MS = 110;
const MAX_BUFFER = 24;

export class NetClient {
  constructor({ url, name, onEvent, onWorld, onLobby, onRooms, onStatus, onKick }) {
    this.url = url;
    this.name = name;
    this.socket = null;
    this.connected = false;
    this.joined = false;
    this.clientId = this.loadClientId();
    this.playerId = null;
    this.roomCode = null;
    this.roomInfo = null;
    this.latency = 0;
    this.latencySamples = [];
    this.remote = new Map(); // playerId -> {buffer, last, state}
    this.onEvent = onEvent || (() => {});
    this.onWorld = onWorld || (() => {});
    this.onLobby = onLobby || (() => {});
    this.onRooms = onRooms || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onKick = onKick || (() => {});
    this.shared = null;
    this.lastSnapshotAt = 0;
    this.serverOffset = 0;
    this.rooms = [];
    this.intentionalClose = false;
  }

  loadClientId() {
    try {
      const existing = localStorage.getItem('nullscape:clientId');
      if (existing && /^ns_/.test(existing)) return existing;
    } catch {
      /* modo privado */
    }
    return null;
  }

  saveClientId(id) {
    this.clientId = id;
    try {
      localStorage.setItem('nullscape:clientId', id);
    } catch {
      /* ignorar */
    }
  }

  connect() {
    if (this.socket) return this.socket;
    this.intentionalClose = false;
    const socket = ioClient(this.url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 6000,
      timeout: 12000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.connected = true;
      this.onStatus({ connected: true });
      this.socket.emit('hello', { name: this.name, clientId: this.clientId }, (res) => {
        if (res?.ok) {
          if (res.clientId) this.saveClientId(res.clientId);
          if (res.rooms) this.onRooms(res.rooms);
        }
      });
      // Se estávamos numa sala, tenta reconectar automaticamente
      if (this.roomCode && this.clientId) {
        socket.emit('room:rejoin', { code: this.roomCode, clientId: this.clientId }, (res) => {
          if (res?.ok) {
            this.playerId = res.playerId;
            this.joined = true;
            if (res.room?.code) this.roomCode = res.room.code;
            if (res.room) this.roomInfo = res.room;
            this.onLobby(res.lobby);
            this.onStatus({ reconnected: true });
            this.onEvent({ kind: 'reconnected' });
          } else {
            this.onStatus({ rejoinFailed: true });
            this.onKick(res?.error || 'não foi possível reconectar');
          }
        });
      }
    });

    socket.on('disconnect', (reason) => {
      this.connected = false;
      this.onStatus({ connected: false, reason });
      if (reason === 'io server disconnect' && !this.intentionalClose) {
        this.onKick('o servidor encerrou a conexão');
      }
    });

    socket.on('connect_error', () => {
      this.onStatus({ connected: false, error: true });
    });

    socket.on('s', (payload) => this.handleSnapshot(payload));
    socket.on('st', (st) => {
      this.shared = st;
      if (this.onShared) this.onShared(st);
    });
    socket.on('e', (payload) => {
      if (!payload?.events) return;
      for (const ev of payload.events) this.onEvent(ev);
    });
    socket.on('lobby', (lobby) => this.onLobby(lobby));
    socket.on('rooms', (payload) => this.onRooms(payload.rooms || []));
    socket.on('w', (payload) => {
      this.lastAck = payload?.seq ?? 0;
    });

    // ping periódico
    this.pingTimer = setInterval(() => {
      if (!this.connected) return;
      const t = Date.now();
      socket.emit('ping:client', { t }, (res) => {
        if (res?.t) {
          const rtt = Date.now() - res.t;
          this.latencySamples.push(rtt);
          if (this.latencySamples.length > 8) this.latencySamples.shift();
          this.latency = Math.round(this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length);
          if (res.serverTime) this.serverOffset = res.serverTime - (t + rtt / 2);
          this.onStatus({ latency: this.latency });
        }
      });
    }, 2500);

    return socket;
  }

  handleSnapshot(payload) {
    if (!payload?.p) return;
    const now = performance.now();
    this.lastSnapshotAt = now;
    for (const p of payload.p) {
      if (p.i === this.playerId) {
        // guarda a posição autoritativa para reconciliação da predição local
        this.lastOwn = { x: p.x, y: p.y, hp: p.hp, dead: p.dead, run: p.run, at: now, t: payload.t };
        continue;
      }
      let entry = this.remote.get(p.i);
      if (!entry) {
        entry = { buffer: [], state: { x: p.x, y: p.y, dir: p.d, hp: p.hp, dead: p.dead, dc: p.dc, run: p.run, st: p.st } };
        this.remote.set(p.i, entry);
      }
      entry.buffer.push({ t: now, x: p.x, y: p.y, dir: p.d, hp: p.hp, dead: p.dead, dc: p.dc, run: p.run, st: p.st });
      if (entry.buffer.length > MAX_BUFFER) entry.buffer.shift();
      entry.latest = { x: p.x, y: p.y, dir: p.d, hp: p.hp, dead: p.dead, dc: p.dc, run: p.run, st: p.st };
    }
    // remove jogadores que saíram
    for (const id of Array.from(this.remote.keys())) {
      const last = this.remote.get(id)?.buffer;
      if (last?.length && now - last[last.length - 1].t > 6000) this.remote.delete(id);
    }
  }

  /** Estado interpolado de um jogador remoto (render). */
  interpolated(playerId, now = performance.now()) {
    const entry = this.remote.get(playerId);
    if (!entry) return null;
    const target = now - SNAPSHOT_DELAY_MS;
    const buf = entry.buffer;
    if (!buf.length) return entry.state;
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= target) {
        a = buf[i];
        b = buf[Math.min(i + 1, buf.length - 1)];
        break;
      }
    }
    if (a === b) {
      entry.state = { ...a };
      return entry.state;
    }
    const span = b.t - a.t || 1;
    const t = Math.max(0, Math.min(1, (target - a.t) / span));
    entry.state = {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      dir: lerpAngleLocal(a.dir, b.dir, t),
      hp: b.hp,
      dead: b.dead,
      dc: b.dc,
      run: b.run,
      st: b.st,
    };
    return entry.state;
  }

  /** Posição autoritativa mais recente do jogador local (último snapshot). */
  ownState() {
    return this.lastOwn || null;
  }

  emitInput(input) {
    if (!this.socket || !this.joined) return;
    this.socket.volatile.emit('input', input);
  }

  interact(targetId) {
    return new Promise((resolve) => {
      if (!this.socket) return resolve({ ok: false, error: 'sem conexão' });
      const timer = setTimeout(() => resolve({ ok: false, error: 'sem resposta' }), 3500);
      this.socket.emit('interact', { targetId }, (res) => {
        clearTimeout(timer);
        resolve(res || { ok: false });
      });
    });
  }

  respawn() {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(false);
      this.socket.emit('respawn', {}, (res) => resolve(!!res?.ok));
    });
  }

  createRoom({ name, seed, private: isPrivate }) {
    return this.emitWithAck('room:create', { name: this.name, roomName: name, seed, private: isPrivate, clientId: this.clientId });
  }

  joinRoom({ code, roomId }) {
    return this.emitWithAck('room:join', { code, roomId, name: this.name, clientId: this.clientId });
  }

  leaveRoom() {
    return new Promise((resolve) => {
      if (!this.socket) return resolve();
      this.emittedLeave = true;
      this.roomCode = null;
      this.joined = false;
      this.playerId = null;
      this.remote.clear();
      this.socket.emit('room:leave', {}, () => {
        this.emittedLeave = true;
        resolve();
      });
    });
  }

  refreshRooms() {
    return this.emitWithAck('room:list', {});
  }

  emitWithAck(event, payload) {
    return new Promise((resolve) => {
      if (!this.socket) return resolve({ ok: false, error: 'sem conexão' });
      const timer = setTimeout(() => resolve({ ok: false, error: 'o servidor não respondeu' }), 9000);
      this.socket.emit(event, payload, (res) => {
        clearTimeout(timer);
        if (res?.ok) {
          if (res.clientId) this.saveClientId(res.clientId);
          if (res.playerId) this.playerId = res.playerId;
          if (res.room) {
            this.roomInfo = res.room;
            this.roomCode = res.room.code;
          }
          this.joined = true;
        }
        resolve(res || { ok: false, error: 'resposta inválida' });
      });
    });
  }

  disconnect() {
    this.intentionalClose = true;
    clearInterval(this.pingTimer);
    this.socket?.disconnect();
    this.socket = null;
    this.joined = false;
  }
}

function lerpAngleLocal(a, b, t) {
  if (typeof a !== 'number' || typeof b !== 'number') return b ?? a ?? 0;
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
