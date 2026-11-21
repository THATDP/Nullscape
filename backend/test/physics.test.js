/**
 * NULLSCAPE — Testes de física e predição.
 * A física do cliente e do servidor é o MESMO módulo; aqui garantimos que
 * ela é determinística, não atravessa paredes e respeita os limites de speed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateValidWorld, serializeWorld, hydrateWorld, applyDoorStates, TILE_SIZE } from '../../shared/world/generator.js';
import { T } from '../../shared/world/themes.js';
import {
  stepMovement,
  tryMove,
  circleBlocked,
  tileOfWorld,
  withinTiles,
  dirSector,
  lerpAngle,
  SPEED_WALK,
  SPEED_RUN,
  RADIUS,
} from '../../shared/sim/physics.js';

const world = generateValidWorld('FISICA');

function spawnState() {
  return {
    x: (world.spawn.x + 0.5) * TILE_SIZE,
    y: (world.spawn.y + 0.5) * TILE_SIZE,
    vx: 0,
    vy: 0,
  };
}

test('spawn não colide', () => {
  const s = spawnState();
  assert.equal(circleBlocked(world, s.x, s.y, RADIUS), false);
});

test('movimento determinístico: mesma entrada, mesmo resultado', () => {
  const a = spawnState();
  const b = spawnState();
  const input = { dx: 0.7, dy: 0.7, run: true };
  for (let i = 0; i < 60; i++) {
    stepMovement(world, a, input, 1 / 60);
    stepMovement(world, b, input, 1 / 60);
  }
  assert.equal(a.x.toFixed(6), b.x.toFixed(6));
  assert.equal(a.y.toFixed(6), b.y.toFixed(6));
});

test('jogador não atravessa parede ao correr para fora do mapa', () => {
  const s = spawnState();
  for (let i = 0; i < 600; i++) stepMovement(world, s, { dx: -1, dy: 0, run: true }, 1 / 60);
  assert.equal(circleBlocked(world, s.x, s.y, RADIUS), false, 'jogador ficou dentro de uma parede');
  const tile = tileOfWorld(world, Math.floor(s.x / TILE_SIZE), Math.floor(s.y / TILE_SIZE));
  assert.ok(tile === T.FLOOR || tile === T.DOORWAY, `jogador em tile inválido ${tile}`);
});

test('velocidade máxima nunca excede o limite configurado', () => {
  const s = spawnState();
  for (let i = 0; i < 120; i++) {
    stepMovement(world, s, { dx: 1, dy: 0, run: true }, 1 / 60);
    const speed = Math.hypot(s.vx, s.vy);
    assert.ok(speed <= SPEED_RUN * 1.03, `velocidade ${speed} acima do limite ${SPEED_RUN}`);
  }
  const walking = spawnState();
  for (let i = 0; i < 120; i++) stepMovement(world, walking, { dx: 0, dy: 1, run: false }, 1 / 60);
  assert.ok(Math.hypot(walking.vx, walking.vy) <= SPEED_WALK * 1.03);
});

test('entrada normalizada impede speedhack por vetor gigante', () => {
  const s = spawnState();
  stepMovement(world, s, { dx: 100, dy: 100, run: true }, 1 / 60);
  // a normalização é responsabilidade do servidor (rooms.applyInput); aqui
  // garantimos que a física ainda limita a velocidade máxima
  assert.ok(Math.hypot(s.vx, s.vy) <= SPEED_RUN * 1.03);
});

test('tryMove desliza em paredes em vez de travar', () => {
  const s = spawnState();
  // posiciona perto de uma parede à esquerda
  let wallX = null;
  for (let x = Math.floor(s.x / TILE_SIZE); x > 0; x--) {
    if (tileOfWorld(world, x, Math.floor(s.y / TILE_SIZE)) === T.WALL) {
      wallX = x;
      break;
    }
  }
  if (wallX === null) return;
  const target = { x: (wallX + 1.5) * TILE_SIZE, y: s.y };
  // empurra na diagonal contra a parede
  for (let i = 0; i < 30; i++) {
    const moved = tryMove(world, target.x, target.y, -3, 1.5, RADIUS);
    target.x = moved.x;
    target.y = moved.y;
  }
  assert.ok(target.y > s.y, 'deveria deslizar verticalmente mesmo pressionando a parede');
  assert.equal(circleBlocked(world, target.x, target.y, RADIUS), false);
});

test('utilitários de rede (setor de direção) são estáveis', () => {
  assert.equal(dirSector(0, 0), -1);
  for (let i = 0; i < 8; i++) {
    const angle = -Math.PI + (i / 8) * Math.PI * 2;
    assert.ok(dirSector(Math.cos(angle), Math.sin(angle)) >= 0);
  }
  assert.ok(Math.abs(lerpAngle(3.1, -3.1, 0.5)) <= Math.PI + 0.001);
});

test('withinTiles funciona na granularidade de tiles', () => {
  assert.equal(withinTiles(0, 0, 32, 0, 1), true);
  assert.equal(withinTiles(0, 0, 64, 0, 1), false);
});

test('predição e simulação autoritativa convergem com os mesmos inputs', () => {
  // Cliente prediz com os mesmos inputs que o servidor vai processar
  const predicted = spawnState();
  const authoritative = spawnState();
  const inputs = [];
  for (let i = 0; i < 90; i++) {
    const t = i / 90;
    inputs.push({ dx: Math.cos(t * 6), dy: Math.sin(t * 6), run: i % 3 === 0 });
  }
  for (const input of inputs) {
    stepMovement(world, predicted, input, 1 / 60);
    stepMovement(world, authoritative, input, 1 / 60);
  }
  const error = Math.hypot(predicted.x - authoritative.x, predicted.y - authoritative.y);
  assert.equal(error, 0, 'mesma física + mesmos inputs = zero divergência');
});

// ---------------------------------------------------------------------------
// Regressões: grid serializado (cliente) e colisão de portões
// ---------------------------------------------------------------------------

test('world hidratado do payload da rede é jogável pela física compartilhada', () => {
  // O cliente recebe serializeWorld() — grids em RLE — e prediz localmente.
  const payload = serializeWorld(generateValidWorld('HIDRATADO'));
  assert.ok(Array.isArray(payload.regions[0].grid), 'payload deve vir em RLE');
  const clientWorld = hydrateWorld(payload);
  const s = { x: (payload.spawn.x + 0.5) * TILE_SIZE, y: (payload.spawn.y + 0.5) * TILE_SIZE, vx: 0, vy: 0 };
  assert.equal(circleBlocked(clientWorld, s.x, s.y, RADIUS), false, 'spawn deve ser livre no mundo hidratado');
  const startX = s.x;
  for (let i = 0; i < 60; i++) stepMovement(clientWorld, s, { dx: 0, dy: 1, run: true }, 1 / 60);
  assert.ok(Math.abs(s.y - (payload.spawn.y + 0.5) * TILE_SIZE) > 1 || Math.abs(s.x - startX) > 1, 'física deve mover o jogador');
  assert.equal(circleBlocked(clientWorld, s.x, s.y, RADIUS), false, 'predição não pode terminar dentro de parede');
});

test('mundo hidratado e mundo do servidor concordam tile a tile', () => {
  const serverWorld = generateValidWorld('CONCORDANCIA');
  const clientWorld = hydrateWorld(serializeWorld(serverWorld));
  for (let gy = 1; gy < serverWorld.worldH; gy += 7) {
    for (let gx = 1; gx < serverWorld.worldW; gx += 7) {
      assert.equal(tileOfWorld(clientWorld, gx, gy), tileOfWorld(serverWorld, gx, gy), `divergência em ${gx},${gy}`);
    }
  }
});

test('portão fechado bloqueia fisicamente e libera ao abrir', () => {
  const w = generateValidWorld('PORTAO-FISICA');
  const gate = w.doors.find((d) => d.kind === 'gate');
  assert.ok(gate && gate.open === false, 'deve existir portão fechado');
  // O vão do portão acompanha o corredor de ligação; escolhe uma linha em que
  // a aproximação pela esquerda é piso livre.
  const rows = Array.from(new Set(gate.cells.map((c) => c.y))).sort((a, b) => a - b);
  const startX = (gate.gx - 2 + 0.5) * TILE_SIZE;
  const row = rows.find((y) => !circleBlocked(w, startX, (y + 0.5) * TILE_SIZE, RADIUS));
  assert.ok(row !== undefined, 'deve haver aproximação livre para o portão');

  const s = { x: startX, y: (row + 0.5) * TILE_SIZE, vx: 0, vy: 0 };
  for (let i = 0; i < 240; i++) stepMovement(w, s, { dx: 1, dy: 0, run: true }, 1 / 60);
  assert.ok(s.x < (gate.gx + 1) * TILE_SIZE, `portão fechado não pode ser atravessado (x=${s.x})`);

  gate.open = true;
  for (let i = 0; i < 240; i++) stepMovement(w, s, { dx: 1, dy: 0, run: true }, 1 / 60);
  assert.ok(s.x > (gate.gx + 2) * TILE_SIZE, `portão aberto deve permitir passagem (x=${s.x})`);
});

test('applyDoorStates fecha a porta interna no grid local do cliente', () => {
  const w = hydrateWorld(serializeWorld(generateValidWorld('PORTAS-CLIENTE')));
  const door = w.doors.find((d) => d.kind === 'normal');
  applyDoorStates(w, [{ id: door.id, open: false, kind: 'normal' }]);
  assert.equal(w.regions[door.region].grid.get(door.cells[0].x, door.cells[0].y), T.WALL);
  applyDoorStates(w, [{ id: door.id, open: true, kind: 'normal' }]);
  assert.equal(w.regions[door.region].grid.get(door.cells[0].x, door.cells[0].y), T.DOORWAY);
});
