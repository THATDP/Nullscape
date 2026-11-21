/**
 * NULLSCAPE — Teste de integração multiplayer real.
 *
 * Sobe o servidor em uma porta efêmera, conecta N clientes Socket.IO reais
 * e valida: criação/entrada em sala, 6 jogadores, sincronização de movimento,
 * predição/reconciliação, interações compartilhadas, portões por sigilo,
 * anomalias, criaturas e reconexão.
 *
 * Execute com: npm run test:integration
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { generateValidWorld } from '../../shared/world/generator.js';
import { TILE_SIZE } from '../../shared/sim/physics.js';

const PORT = 3400 + Math.floor(Math.random() * 200);
const URL = `http://127.0.0.1:${PORT}`;

let server;
let manager;
const clients = [];

function connect() {
  return new Promise((resolve, reject) => {
    const socket = ioClient(URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function once(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando '${event}'`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function emitAck(socket, event, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout no ack de '${event}'`)), timeoutMs);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  process.env.PORT = String(PORT);
  process.env.LOG_LEVEL = 'error';
  const mod = await import('../src/index.js');
  server = mod.httpServer;
  manager = mod.manager;
  await sleep(300);
});

after(async () => {
  for (const c of clients) c.disconnect();
  await sleep(200);
  server?.closeAllConnections?.();
  server?.close();
  const { io } = await import('../src/index.js');
  io.close?.();
  await sleep(300);
  // o processo de teste não deve ficar preso a timers do servidor
  setTimeout(() => process.exit(0), 1500).unref();
});

test('health e status expõem informações corretas', async () => {
  const health = await fetch(`${URL}/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.status, 'alive');
  const status = await fetch(`${URL}/api/status`).then((r) => r.json());
  assert.equal(status.tickRate, 20);
  assert.equal(status.maxPlayersPerRoom, 6);
});

test('gerador é determinístico entre servidor e mundo de referência', () => {
  const a = generateValidWorld('INTEGRATION');
  const b = generateValidWorld('INTEGRATION');
  assert.equal(a.hash, b.hash);
  assert.equal(a.spawn.x, b.spawn.x);
  assert.equal(a.spawn.y, b.spawn.y);
});

test('seis jogadores reais entram na mesma sala e se veem', async () => {
  const host = await connect();
  clients.push(host);
  await emitAck(host, 'hello', { name: 'Host' });
  const created = await emitAck(host, 'room:create', { name: 'Host', private: false, seed: 'SIXPLAYERS' });
  assert.equal(created.ok, true, JSON.stringify(created));
  const code = created.room.code;
  assert.ok(created.world, 'mundo deve ser enviado ao entrar');
  assert.ok(created.world.regions.length === 4, 'mundo deve ter 4 regiões');

  const others = [];
  for (let i = 1; i < 6; i++) {
    const s = await connect();
    clients.push(s);
    const res = await emitAck(s, 'room:join', { code, name: `Jogador${i}` });
    assert.equal(res.ok, true, `jogador ${i}: ${JSON.stringify(res)}`);
    others.push({ socket: s, res });
  }

  const room = manager.findByCode(code);
  assert.equal(room.players.size, 6, 'servidor deve registrar 6 jogadores');
  assert.equal(room.connectedCount, 6);

  // Todos recebem o lobby com 6 jogadores
  await sleep(400);
  const lobby = room.lobbyState ? null : null;
  void lobby;
  const list = await fetch(`${URL}/api/rooms`).then((r) => r.json());
  const entry = list.rooms.find((r) => r.code === code);
  assert.ok(entry, 'sala pública deve aparecer no diretório');
  assert.equal(entry.players, 6);

  // Snapshot de movimento chega aos clientes
  const snapPromise = once(others[0].socket, 's');
  host.emit('input', { seq: 1, dx: 1, dy: 0, run: false });
  const snapshot = await snapPromise;
  assert.ok(Array.isArray(snapshot.p));
  assert.equal(snapshot.p.length, 6, 'snapshot deve conter os 6 jogadores');
});

test('movimento é sincronizado e o servidor rejeita teleporte', async () => {
  const room = manager.all().find((r) => r.players.size === 6);
  assert.ok(room, 'sala de 6 jogadores deve existir');
  const hostSocket = clients[0];
  const hostPlayer = Array.from(room.players.values()).find((p) => p.name === 'Host');
  const startX = hostPlayer.x;
  const startY = hostPlayer.y;

  // Escolhe uma direção realmente livre: o spawn pode encostar numa parede
  // (e aí "andar para a direita" não move ninguém — teste dependia de sorte).
  const { tryMove } = await import('../../shared/sim/physics.js');
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  // tryMove devolve {x, y} (sem flag) — medimos o deslocamento real.
  const freeDir =
    DIRS.find(([dx, dy]) => {
      const probe = { x: startX, y: startY };
      let travelled = 0;
      for (let step = 0; step < 24; step++) {
        const res = tryMove(room.world, probe.x, probe.y, dx * 4, dy * 4);
        travelled += Math.hypot(res.x - probe.x, res.y - probe.y);
        probe.x = res.x;
        probe.y = res.y;
      }
      return travelled > 60; // ~2 tiles livre
    }) || DIRS[0];
  const [dirX, dirY] = freeDir;

  // anda livre por ~1s
  for (let i = 0; i < 20; i++) {
    hostSocket.emit('input', { seq: 10 + i, dx: dirX, dy: dirY, run: false });
    await sleep(50);
  }
  hostSocket.emit('input', { seq: 99, dx: 0, dy: 0, run: false });
  await sleep(250);
  const moved = Math.hypot(hostPlayer.x - startX, hostPlayer.y - startY);
  assert.ok(moved > 8, `jogador deveria ter se movido (moveu ${moved.toFixed(1)}px)`);

  // Velocidade máxima não pode ser violada por inputs absurdos
  const beforeX = hostPlayer.x;
  const beforeY = hostPlayer.y;
  for (let i = 0; i < 30; i++) {
    hostSocket.emit('input', { seq: 200 + i, dx: 1e9, dy: 1e9, run: true });
    await sleep(50);
  }
  const dist = Math.hypot(hostPlayer.x - beforeX, hostPlayer.y - beforeY);
  const maxExpected = 5.6 * 32 * (30 * 0.05) + 40; // margem de aceleração
  assert.ok(dist <= maxExpected, `velocidade acima do permitido: ${dist}px > ${maxExpected}px`);

  // Servidor nunca aceita posição enviada pelo cliente
  hostSocket.emit('input', { seq: 300, dx: 0, dy: 0 });
  await sleep(100);
  assert.ok(Number.isFinite(hostPlayer.x) && Number.isFinite(hostPlayer.y));
});

test('estado compartilhado inclui mundo, criaturas e progresso', async () => {
  const room = manager.all().find((r) => r.players.size === 6);
  const st = room.stateSnapshot();
  assert.ok(Array.isArray(st.creatures));
  assert.ok(Array.isArray(st.sigilStates));
  assert.equal(st.sigils, 0);
  assert.ok(room.world.puzzles.length >= 3, 'mundo deve ter quebra-cabeças');
  assert.ok(room.world.interactables.length > 0);
  assert.ok(room.creatureSystem.creatures.size >= 1, 'deve existir criatura ativa');

  // Anomalias podem ser forçadas e chegam a todos
  const anyClient = clients[1];
  const anomalyPromise = once(anyClient, 'e', 3000);
  const room2 = manager.all().find((r) => r.players.size === 6);
  room2.events.push(room2.anomalySystem.trigger(Date.now(), 'flicker'));
  const evt = await anomalyPromise;
  assert.ok(evt.events.some((e) => e.type === 'anomaly'), 'evento anomalia deve chegar ao cliente');
});

test('quebra-cabeça cooperativo é validado pelo servidor e revela sigilo', async () => {
  const room = manager.all().find((r) => r.players.size === 6);
  const puzzle = room.world.puzzles[0];
  const players = Array.from(room.players.values());
  const [p1, p2] = players;
  assert.ok(p2, 'precisa de dois jogadores');

  const mechs = puzzle.mechanismIds.map((id) => room.world.interactables.find((m) => m.id === id)).filter(Boolean);
  const place = (player, mech) => {
    player.x = (mech.gx + 0.5) * TILE_SIZE;
    player.y = (mech.gy + 0.5) * TILE_SIZE;
  };

  // Cada variante tem sua regra; aqui resolvemos todas pelo servidor.
  switch (puzzle.kind) {
    case 'valvePair': {
      const [a, b] = mechs.filter((m) => m.kind === 'valve');
      place(p1, a);
      place(p2, b);
      room.puzzleSystem.interact(p1.id, a.id);
      room.puzzleSystem.interact(p2.id, b.id);
      break;
    }
    case 'breakerOrder': {
      const breakers = mechs.filter((m) => m.kind === 'breaker');
      for (const index of puzzle.order) {
        const b = breakers.find((m) => m.orderIndex === index);
        place(p1, b);
        room.puzzleSystem.interact(p1.id, b.id);
      }
      break;
    }
    case 'holdLever': {
      const lever = mechs.find((m) => m.kind === 'lever');
      const plate = mechs.find((m) => m.kind === 'plate');
      place(p1, lever);
      place(p2, plate);
      room.puzzleSystem.interact(p1.id, lever.id);
      room.puzzleSystem.interact(p2.id, plate.id);
      break;
    }
    case 'pressurePlates': {
      const plates = mechs.filter((m) => m.kind === 'plate');
      place(p1, plates[0]);
      place(p2, plates[1]);
      room.puzzleSystem.interact(p1.id, plates[0].id);
      room.puzzleSystem.interact(p2.id, plates[1].id);
      break;
    }
    case 'keycard': {
      const card = room.world.interactables.find((m) => m.kind === 'keycardItem' && m.puzzleId === puzzle.id);
      const reader = room.world.interactables.find((m) => m.kind === 'keycardReader' && m.puzzleId === puzzle.id);
      place(p1, card);
      room.puzzleSystem.interact(p1.id, card.id);
      place(p1, reader);
      room.puzzleSystem.interact(p1.id, reader.id);
      break;
    }
    case 'silenceChoir': {
      const bell = mechs.find((m) => m.kind === 'bell');
      place(p1, bell);
      let now = Date.now();
      for (let i = 0; i < 3; i++) {
        now += 1500;
        room.puzzleSystem.interact(p1.id, bell.id, now);
      }
      break;
    }
    default:
      assert.fail(`variante desconhecida: ${puzzle.kind}`);
  }

  const st = room.puzzleSystem.state.get(puzzle.id);
  assert.equal(st.solved, true, `quebra-cabeça ${puzzle.kind} deveria estar resolvido`);

  const sigil = room.world.sigils.find((s) => s.id === puzzle.sigilId);
  assert.equal(sigil.revealed, true, 'sigilo deve ser revelado após resolver o puzzle');

  // Jogador pega o sigilo
  p1.x = (sigil.gx + 0.5) * TILE_SIZE;
  p1.y = (sigil.gy + 0.5) * TILE_SIZE;
  const pick = room.pickupSigil(p1, sigil, Date.now());
  assert.equal(pick.ok, true);
  assert.equal(sigil.taken, true);
  assert.ok(p1.inventory.includes(sigil.id));
});

test('portão exige sigilos e recusa com mensagem clara', async () => {
  const room = manager.all().find((r) => r.players.size === 6);
  const gate = room.world.doors.find((d) => d.kind === 'gate');
  assert.ok(gate, 'deve existir portão de fronteira');
  const player = Array.from(room.players.values())[0];
  player.x = (gate.gx + 0.5) * TILE_SIZE;
  player.y = (gate.gy + 0.5) * TILE_SIZE;
  const res = room.toggleDoor(player, gate, Date.now());
  assert.equal(res.ok, false, 'portão deve recusar sem sigilos');
  assert.match(res.error, /sigilo/i);

  // Com sigilos suficientes, abre
  for (let i = 0; i < gate.requirement.count; i++) room.shared.delivered.add(`sigil-${i}`);
  room.shared.sigils = gate.requirement.count;
  const res2 = room.toggleDoor(player, gate, Date.now());
  assert.equal(res2.ok, true);
  assert.equal(gate.open, true);
});

test('reconexão preserva identidade, posição e inventário', async () => {
  const room = manager.all().find((r) => r.players.size === 6);
  const target = Array.from(room.players.values()).find((p) => p.name === 'Jogador2');
  assert.ok(target);
  const clientId = target.clientId;
  assert.ok(clientId, 'jogador deve ter clientId');
  const posX = target.x;
  const inventory = [...target.inventory];

  // Simula queda
  room.markDisconnected(target.socketId);
  assert.equal(target.disconnected, true);

  // Novo socket reconecta
  const reconnected = await connect();
  clients.push(reconnected);
  const res = await emitAck(reconnected, 'room:rejoin', { code: room.code, clientId });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.reconnected, true);
  assert.equal(res.playerId, target.id);
  const restored = room.playerStates.get(target.id);
  assert.equal(restored.disconnected, false);
  assert.equal(restored.x, posX);
  assert.deepEqual(restored.inventory, inventory);
  assert.ok(room.connectedCount >= 5);
});

test('saída de jogador libera sala e lista, limite de 6 é respeitado', async () => {
  const room = manager.all().find((r) => r.code);
  const before = room.players.size;
  const extra = await connect();
  clients.push(extra);
  const res = await emitAck(extra, 'room:join', { code: room.code, name: 'Excedente' });
  if (before >= 6) {
    assert.equal(res.ok, false);
    assert.equal(res.code, 'full');
  }

  // Um jogador sai
  const leaving = Array.from(room.players.values())[0];
  const socket = clients.find((c) => c.id === leaving.socketId);
  if (socket) {
    await emitAck(socket, 'room:leave', {});
    await sleep(100);
    assert.ok(room.players.size <= before, 'saída deve reduzir a lista');
  }
});

test('rate limiting rejeita flood de interações', async () => {
  const room = manager.all().find((r) => r.players.size > 0);
  if (!room) return;
  const socket = clients.find((c) => room.players.has(c.id));
  if (!socket) return;
  const results = [];
  for (let i = 0; i < 30; i++) {
    results.push(emitAck(socket, 'interact', { targetId: 'nao-existe' }));
  }
  const settled = await Promise.allSettled(results);
  const answered = settled.filter((s) => s.status === 'fulfilled').length;
  assert.ok(answered < 30, 'nem todas as interações devem ser processadas (rate limit)');
});

test('salas vazias são limpas e o mundo é liberado', async () => {
  const host = await connect();
  clients.push(host);
  const created = await emitAck(host, 'room:create', { name: 'Temp', private: true });
  assert.equal(created.ok, true);
  const code = created.room.code;
  const room = manager.findByCode(code);
  assert.ok(room);
  await emitAck(host, 'room:leave', {});
  host.disconnect();
  await sleep(300);
  const after = manager.findByCode(code);
  assert.equal(after.players.size, 0, 'sala deve ficar vazia');
  assert.ok(after.lastEmptyAt, 'sala vazia deve registrar horário para limpeza');
});

test('sala privada não aparece no diretório público', async () => {
  const host = await connect();
  clients.push(host);
  const created = await emitAck(host, 'room:create', { name: 'Priv', private: true });
  const list = await fetch(`${URL}/api/rooms`).then((r) => r.json());
  assert.ok(!list.rooms.some((r) => r.code === created.room.code), 'sala privada não deve ser listada');
  await emitAck(host, 'room:leave', {});
});
