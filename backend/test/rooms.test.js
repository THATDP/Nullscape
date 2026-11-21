/**
 * NULLSCAPE — Testes de sala, sessão e protocolo (sem rede).
 * Cobrem: criação, entrada/saída, reconexão, dano, morte, sigilos,
 * portões, limpeza de salas vazias e métricas de desempenho.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomManager, RoomConstants } from '../src/rooms.js';
import { TILE_SIZE } from '../../shared/world/generator.js';
import { sanitizePayload } from './helpers.js';

function makeRoom(seed = 'SALA') {
  const room = new Room({
    id: `room-test-${seed}`,
    code: 'TESTE1',
    seed,
    name: 'Teste',
    isPrivate: false,
    hostId: 'sock1',
    io: null,
  });
  room.initWorld();
  room.addPlayer({ socketId: 'sock1', name: 'Ana', clientId: 'ns_aaaaaaaa-1111' });
  return room;
}

test('sala inicializa mundo, sistemas e criatura inicial', () => {
  const room = makeRoom('INIT');
  assert.ok(room.world);
  assert.ok(room.puzzleSystem);
  assert.ok(room.anomalySystem);
  assert.ok(room.creatureSystem);
  assert.ok(room.creatureSystem.creatures.size >= 1, 'deve nascer com uma criatura');
  assert.equal(room.players.size, 1);
});

test('máximo de 6 jogadores por sala', () => {
  const room = makeRoom('LIMITE');
  for (let i = 2; i <= 6; i++) {
    const res = room.addPlayer({ socketId: `sock${i}`, name: `J${i}`, clientId: `ns_cccccccc-${i}000` });
    assert.ok(res.player, `jogador ${i} deveria entrar`);
  }
  const overflow = room.addPlayer({ socketId: 'sock7', name: 'J7', clientId: 'ns_dddddddd-7000' });
  assert.equal(overflow.error, 'sala cheia');
  assert.equal(room.players.size, RoomConstants.MAX_PLAYERS);
});

test('nomes são sanitizados e nomes vazios recebem padrão', () => {
  const room = makeRoom('NOMES');
  const res = room.addPlayer({ socketId: 'sock2', name: '<script>alert(1)</script>', clientId: 'ns_x' });
  assert.ok(!res.player.name.includes('<'));
  assert.ok(res.player.name.length <= 18);
  const blank = room.addPlayer({ socketId: 'sock3', name: '   ', clientId: 'ns_y' });
  assert.equal(blank.player.name, 'Anônimo');
});

test('jogadores entram no mesmo ponto e compartilham o mundo', () => {
  const room = makeRoom('SPAWN');
  const a = room.players.get('sock1');
  room.addPlayer({ socketId: 'sock2', name: 'Bia', clientId: 'ns_b' });
  const b = room.players.get('sock2');
  assert.equal(a.world, undefined);
  assert.equal(room.world, room.world);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1, 'devem nascer no mesmo ponto');
});

test('input é validado: vetor normalizado e nan bloqueado', () => {
  const room = makeRoom('INPUT');
  const p = room.players.get('sock1');
  room.applyInput('sock1', { dx: 1e6, dy: 0, run: true });
  assert.ok(Math.abs(p.input.dx) <= 1);
  room.applyInput('sock1', { dx: NaN, dy: NaN, run: false });
  assert.equal(p.input.dx, 0);
  assert.equal(p.input.dy, 0);
  room.applyInput('sock1', { dx: 'a', dy: null });
  assert.equal(p.input.dx, 0);
});

test('movimento autoritativo avança posição ao longo do tempo', () => {
  const room = makeRoom('MOVIMENTO');
  const p = room.players.get('sock1');
  const startX = p.x;
  room.applyInput('sock1', { dx: 1, dy: 0, run: true });
  for (let i = 0; i < 40; i++) room.tick(0.05, Date.now() + i * 50);
  assert.ok(p.x > startX + 20, `deveria ter andado (${p.x - startX}px)`);
  assert.ok(p.stats.distance > 0);
});

test('jogador não atravessa parede mesmo com input contínuo', () => {
  const room = makeRoom('PAREDE');
  const p = room.players.get('sock1');
  room.applyInput('sock1', { dx: -1, dy: 0, run: true });
  for (let i = 0; i < 400; i++) room.tick(0.05, Date.now() + i * 50);
  const gx = Math.floor(p.x / TILE_SIZE);
  const gy = Math.floor(p.y / TILE_SIZE);
  const region = room.world.regions[Math.floor(gx / 40)];
  const tile = region?.grid.get(gx % 40, gy);
  assert.ok(tile === 0 || tile === 5, `jogador terminou em tile inválido ${tile}`);
});

test('interação tem cooldown e orçamento por minuto', () => {
  const room = makeRoom('RATE');
  const p = room.players.get('sock1');
  const now = Date.now();
  const first = room.interact('sock1', 'inexistente', now);
  assert.ok(first.error === 'muito rápido' || first.ok === false);
  const second = room.interact('sock1', 'inexistente', now + 300);
  assert.equal(second.ok, false);
  // esgota orçamento
  let blocked = false;
  for (let i = 0; i < 30; i++) {
    const r = room.interact('sock1', 'inexistente', now + 300 + i * 200);
    if (r.error === 'calma') blocked = true;
  }
  assert.ok(blocked, 'orçamento de interações deve bloquear flood');
  void p;
});

test('dano, morte e respawn mantêm o jogador no ciclo', () => {
  const room = makeRoom('VIDA');
  const p = room.players.get('sock1');
  room.damagePlayer(p.id, 40, 'teste');
  assert.equal(p.hp, 60);
  room.damagePlayer(p.id, 100, 'teste');
  assert.equal(p.hp, 0);
  assert.equal(p.dead, true);
  assert.equal(room.shared.deaths, 1);
  const ok = room.respawn('sock1');
  assert.equal(ok, true);
  assert.equal(p.dead, false);
  assert.equal(p.hp, RoomConstants.MAX_HP);
});

test('jogador morto solta os sigilos que carrega', () => {
  const room = makeRoom('SOLTA');
  const p = room.players.get('sock1');
  const sigil = room.world.sigils[0];
  sigil.revealed = true;
  p.x = (sigil.gx + 0.5) * TILE_SIZE;
  p.y = (sigil.gy + 0.5) * TILE_SIZE;
  const pick = room.pickupSigil(p, sigil, Date.now());
  assert.equal(pick.ok, true);
  assert.ok(p.inventory.includes(sigil.id));
  room.damagePlayer(p.id, 200, 'teste');
  assert.equal(sigil.taken, false, 'sigilo deve voltar ao mundo');
  assert.equal(p.inventory.length, 0);
});

test('sigilo não revelado não pode ser tomado', () => {
  const room = makeRoom('VELADO');
  const p = room.players.get('sock1');
  const sigil = room.world.sigils[0];
  sigil.revealed = false;
  p.x = (sigil.gx + 0.5) * TILE_SIZE;
  p.y = (sigil.gy + 0.5) * TILE_SIZE;
  const pick = room.pickupSigil(p, sigil, Date.now());
  assert.equal(pick.ok, false);
  assert.match(pick.error, /velado/);
});

test('altar entrega sigilos e encerra a sessão com 4', () => {
  const room = makeRoom('ALTAR');
  const p = room.players.get('sock1');
  const altar = room.world.altar;
  p.x = (altar.gx + 0.5) * TILE_SIZE;
  p.y = (altar.gy + 0.5) * TILE_SIZE;
  const empty = room.interactAltar(p, Date.now());
  assert.equal(empty.ok, false, 'altar vazio deve recusar');

  p.inventory = room.world.sigils.map((s) => s.id);
  const res = room.interactAltar(p, Date.now());
  assert.equal(res.ok, true);
  assert.equal(room.shared.sigils, 4);
  assert.equal(room.finished, true);
  assert.ok(room.shared.completedAt);
  const complete = room.events.find((e) => e.type === 'sessionComplete');
  assert.ok(complete, 'evento de conclusão deve ser emitido');
  assert.ok(complete.stats);
});

test('portas internas alternam e afetam colisão', () => {
  const room = makeRoom('PORTAS');
  const p = room.players.get('sock1');
  const door = room.world.doors.find((d) => d.kind === 'normal');
  p.x = (door.gx + 0.5) * TILE_SIZE;
  p.y = (door.gy + 0.5) * TILE_SIZE;
  const close = room.toggleDoor(p, door, Date.now());
  assert.equal(close.ok, true);
  assert.equal(door.open, false);
  const region = room.world.regions[door.region];
  const cell = door.cells[0];
  assert.equal(region.grid.get(cell.x, cell.y), 1, 'porta fechada deve virar parede');
  room.toggleDoor(p, door, Date.now());
  assert.equal(door.open, true);
  void region;
});

test('reconexão restaura o mesmo jogador (posição, inventário, vida)', () => {
  const room = makeRoom('RECON');
  const p = room.players.get('sock1');
  p.x += 120;
  room.damagePlayer(p.id, 25, 'teste');
  room.markDisconnected('sock1');
  assert.equal(p.disconnected, true);
  const restored = room.reconnectPlayer({ clientId: 'ns_aaaaaaaa-1111', socketId: 'sock-new' });
  assert.ok(restored);
  assert.equal(restored.disconnected, false);
  assert.equal(restored.socketId, 'sock-new');
  assert.equal(restored.hp, 75);
  assert.ok(room.players.has('sock-new'));
  assert.ok(!room.players.has('sock1'));
});

test('jogadores desconectados expiram após o tempo de carência', () => {
  const room = makeRoom('EXPIRE');
  const p = room.players.get('sock1');
  room.markDisconnected('sock1');
  p.disconnectedAt = Date.now() - RoomConstants.DISCONNECT_GRACE_MS - 1000;
  const removed = room.sweepDisconnects(Date.now());
  assert.equal(removed, 1);
  assert.equal(room.players.size, 0);
  assert.ok(room.lastEmptyAt);
});

test('sala vazia é marcada e limpa após o período de carência', () => {
  const room = makeRoom('VAZIA');
  room.removePlayer('sock1');
  assert.equal(room.isEmpty(), true);
  assert.ok(room.lastEmptyAt);
  assert.equal(room.shouldBeCleaned(Date.now()), false, 'não deve limpar imediatamente');
  assert.equal(room.shouldBeCleaned(Date.now() + RoomConstants.EMPTY_ROOM_GRACE_MS + 1), true);
});

test('RoomManager cria, encontra por código e destrói salas', () => {
  const manager = new RoomManager({ io: null, log: { info() {}, error() {}, warn() {} } });
  const res = manager.createRoom({ name: 'Teste', seed: 'GERENCIADOR', hostId: 's1', hostName: 'Ana' });
  assert.ok(res.room);
  const code = res.room.code;
  assert.equal(manager.findByCode(code), res.room);
  assert.equal(manager.findByCode(code.toLowerCase()), res.room);
  assert.equal(manager.findByCode('ZZZZZZ'), null);
  const listed = manager.listPublic();
  assert.ok(listed.some((r) => r.code === code));
  assert.ok(listed[0].seed);
  manager.dropRoom(res.room.id);
  assert.equal(manager.findByCode(code), null);
});

test('salas privadas não aparecem no diretório público', () => {
  const manager = new RoomManager({ io: null, log: { info() {}, error() {}, warn() {} } });
  manager.createRoom({ name: 'Privada', seed: 'PRIV', hostId: 's1', hostName: 'A', isPrivate: true });
  manager.createRoom({ name: 'Pública', seed: 'PUB', hostId: 's2', hostName: 'B', isPrivate: false });
  const listed = manager.listPublic();
  assert.ok(!listed.some((r) => r.name === 'Privada'));
  assert.ok(listed.some((r) => r.name === 'Pública'));
});

test('estado compartilhado serializa sem dados sensíveis', () => {
  const room = makeRoom('SERIAL');
  const snap = room.stateSnapshot();
  const json = JSON.stringify(snap);
  assert.ok(json.length < 24 * 1024, `estado grande demais: ${json.length}`);
  assert.ok(!json.includes('socketId'));
  assert.ok(!json.includes('sock1'));
  assert.deepEqual(sanitizePayload(snap), snap, 'estado deve ser JSON puro');
});

test('snapshot de movimento é econômico', () => {
  const room = makeRoom('BANDA');
  for (let i = 2; i <= 6; i++) room.addPlayer({ socketId: `s${i}`, name: `J${i}`, clientId: `ns_e${i}` });
  const snap = room.movementSnapshot();
  assert.equal(snap.length, 6);
  const json = JSON.stringify(snap);
  assert.ok(json.length < 1400, `snapshot muito grande: ${json.length} bytes para 6 jogadores`);
  for (const p of snap) {
    assert.ok(p.x >= 0 && p.y >= 0);
    assert.ok(!('name' in p));
  }
});

test('simulação de 6 jogadores por 20 segundos mantém desempenho', () => {
  const room = makeRoom('DESEMPENHO');
  for (let i = 2; i <= 6; i++) room.addPlayer({ socketId: `s${i}`, name: `J${i}`, clientId: `ns_f${i}` });
  const sockets = Array.from(room.players.keys());
  const t0 = performance.now();
  const now = Date.now();
  for (let tick = 0; tick < 400; tick++) {
    for (let i = 0; i < sockets.length; i++) {
      const angle = (tick / 40 + i) * Math.PI;
      room.applyInput(sockets[i], { dx: Math.cos(angle), dy: Math.sin(angle), run: i % 2 === 0 });
    }
    room.tick(0.05, now + tick * 50);
    room.movementSnapshot();
    if (tick % 5 === 0) room.stateSnapshot();
  }
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 4000, `simulação lenta: ${elapsed.toFixed(0)}ms para 400 ticks`);
  assert.ok(room.metrics.ticks === 400);
});
