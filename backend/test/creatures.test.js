/**
 * NULLSCAPE — Testes de criaturas e anomalias.
 * Verifica: estados internos, telegrafia, contra-jogo e que nenhuma criatura
 * persegue cegamente todos os jogadores o tempo todo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateValidWorld, TILE_SIZE } from '../../shared/world/generator.js';
import { CreatureSystem, CREATURE_DEFS } from '../../shared/sim/creatures.js';
import { AnomalySystem, ANOMALY_DEFS } from '../../shared/sim/anomalies.js';

function makeRoom(seed = 'CRIATURAS') {
  const world = generateValidWorld(seed);
  const room = {
    world,
    playerStates: new Map(),
    envEvents: [],
    events: [],
    player(id, x, y) {
      const p = {
        id,
        x,
        y,
        vx: 0,
        vy: 0,
        dead: false,
        disconnected: false,
        lookX: 1,
        lookY: 0,
        dirX: 1,
        dirY: 0,
        safeUntil: 0,
      };
      this.playerStates.set(id, p);
      return p;
    },
  };
  return room;
}

test('todas as criaturas têm estado interno, percepção e contra-jogo documentado', () => {
  for (const def of Object.values(CREATURE_DEFS)) {
    assert.ok(def.label.length > 2, `${def.id} sem nome`);
    assert.ok(def.note.length > 10, `${def.id} sem contra-jogo`);
    assert.ok(def.telegraph.length > 10, `${def.id} sem telegrafia`);
    assert.ok(def.behavior, `${def.id} sem comportamento`);
    assert.ok(Number.isFinite(def.sightTiles));
    assert.ok(Number.isFinite(def.hearingTiles));
    assert.ok(def.size > 0);
  }
  const behaviors = new Set(Object.values(CREATURE_DEFS).map((d) => d.behavior));
  assert.ok(behaviors.size >= 6, 'deve haver variedade de comportamentos');
});

test('perfil de criaturas é determinístico por seed', () => {
  const a = new CreatureSystem(makeRoom('PERFIL'));
  const b = new CreatureSystem(makeRoom('PERFIL'));
  assert.deepEqual(a.spawnProfile, b.spawnProfile);
});

test('criatura nasce em piso válido e longe dos jogadores', () => {
  const room = makeRoom('SPAWN');
  const p = room.player((0), (room.world.spawn.x + 0.5) * TILE_SIZE, (room.world.spawn.y + 0.5) * TILE_SIZE);
  void p;
  const sys = new CreatureSystem(room);
  const c = sys.spawn('listener', { minDist: 8 });
  assert.ok(c, 'criatura deve nascer');
  assert.ok(c.x > 0 && c.y > 0);
  const dist = Math.hypot(c.x - room.world.spawn.x * TILE_SIZE, c.y - room.world.spawn.y * TILE_SIZE);
  assert.ok(dist > 4 * TILE_SIZE, 'não deve nascer em cima do jogador');
});

test('O Lento só avança quando observado e congela quando não é visto', () => {
  const room = makeRoom('LENTO');
  const px = 200;
  const py = 200;
  const player = room.player('p1', px, py);
  player.lookX = 1;
  player.lookY = 0;
  const sys = new CreatureSystem(room);
  const c = sys.spawn('slow', { point: { gx: 0, gy: 0, x: px + 96, y: py } });
  assert.ok(c);
  const now = Date.now();
  for (let i = 0; i < 20; i++) sys.update(0.05, now + i * 50);
  assert.equal(c.visible, true, 'deve estar visível quando observado');
  assert.ok(Math.hypot(c.x - player.x, c.y - player.y) < 96 + 1, 'deve se aproximar quando observado');

  // Jogador passa a olhar para o lado oposto
  player.lookX = -1;
  const before = { x: c.x, y: c.y };
  for (let i = 0; i < 10; i++) sys.update(0.05, now + 2000 + i * 50);
  assert.equal(c.state, 'frozen', 'deve congelar sem ser observado');
  assert.equal(c.x, before.x, 'não deve se mover congelado');
});

test('O Ouvinte investiga ruído registrado', () => {
  const room = makeRoom('OUVINTE');
  room.player('p1', 100, 100);
  const sys = new CreatureSystem(room);
  const c = sys.spawn('listener', { point: { gx: 0, gy: 0, x: 160, y: 160 } });
  sys.registerNoise(5, 5, 8, 'sprint');
  assert.equal(c.state, 'investigate');
  assert.ok(c.noiseTarget);
});

test('O Garçom não ataca jogador em movimento', () => {
  const room = makeRoom('GARCOM');
  const player = room.player('p1', 200, 200);
  player.vx = 100;
  const sys = new CreatureSystem(room);
  const c = sys.spawn('waiter', { point: { gx: 0, gy: 0, x: 210, y: 200 } });
  c.cooldown = 0;
  const def = CREATURE_DEFS.waiter;
  assert.equal(sys.canAttack(c, player, def, Date.now()), false);
  player.vx = 0;
  assert.equal(sys.canAttack(c, player, def, Date.now()), true);
});

test('O Solitário só se manifesta quando alguém está isolado', () => {
  const room = makeRoom('SOLITARIO');
  const a = room.player('p1', 300, 300);
  const b = room.player('p2', 320, 300); // bem próximo
  void a;
  void b;
  const sys = new CreatureSystem(room);
  const c = sys.spawn('lonely', { point: { gx: 0, gy: 0, x: 2000, y: 600 } });
  const now = Date.now();
  for (let i = 0; i < 5; i++) sys.update(0.05, now + i * 50);
  assert.equal(c.state, 'waiting', 'com jogadores juntos, ele espera');
  assert.equal(c.visible, false);

  // Separa os jogadores em regiões diferentes
  room.playerStates.get('p2').x = 3200;
  for (let i = 0; i < 5; i++) sys.update(0.05, now + 500 + i * 50);
  assert.equal(c.state, 'hunt', 'com jogador isolado, ele caça');
});

test('O Espelho imita a trajetória com atraso', () => {
  const room = makeRoom('ESPELHO');
  const p = room.player('p1', 400, 400);
  const sys = new CreatureSystem(room);
  // spawna no próprio local do jogador para garantir espaço caminhável
  const c = sys.spawn('echo', { point: { gx: 0, gy: 0, x: p.x, y: p.y } });
  c.targetPlayerId = p.id;
  const startX = c.x;
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    p.x += 2;
    sys.update(0.05, now + i * 50);
  }
  assert.ok(c.mirrorBuffer.length > 0, 'deve gravar o caminho do jogador');
  assert.ok(c.x >= startX - 1, 'deve ANDAR seguindo o caminho');
  assert.ok(c.x < p.x + 5, 'não deve teleportar até o jogador');
});

test('O Vigia observa de longe e registra aprendizados sem atacar', () => {
  const room = makeRoom('VIGIA');
  const p = room.player('p1', 500, 500);
  const sys = new CreatureSystem(room);
  const c = sys.spawn('watcher', { point: { gx: 0, gy: 0, x: 700, y: 500 } });
  const now = Date.now();
  for (let i = 0; i < 200; i++) {
    sys.update(0.05, now + i * 50);
    if (i % 20 === 0) p.x += 3;
  }
  assert.ok((c.memory.hotspots || []).length > 0, 'deve aprender posições');
  assert.equal(CREATURE_DEFS.watcher.attack, null, 'não deve ter ataque');
});

test('ataques geram dano com telegrafia e cooldown', () => {
  const room = makeRoom('DANO');
  const player = room.player('p1', 500, 500);
  player.vx = 0;
  const sys = new CreatureSystem(room);
  const c = sys.spawn('listener', { point: { gx: 0, gy: 0, x: 505, y: 500 } });
  const now = Date.now();
  sys.update(0.05, now);
  const dmg = sys.drainDamage();
  assert.ok(dmg.length >= 1, 'deve causar dano por contato');
  assert.equal(dmg[0].playerId, 'p1');
  assert.ok(c.cooldown > 0, 'deve entrar em cooldown');
  sys.update(0.05, now + 100);
  assert.equal(sys.drainDamage().length, 0, 'não deve causar dano durante o cooldown');
});

test('limite de criaturas ativas evita sobrecarga', () => {
  const room = makeRoom('LIMITE');
  room.player('p1', 500, 500);
  const sys = new CreatureSystem(room);
  for (let i = 0; i < 20; i++) sys.spawn('listener', { point: { gx: 0, gy: 0, x: 800 + i * 10, y: 800 } });
  assert.ok(sys.creatures.size <= 5, 'não deve passar de 5 criaturas ativas');
});

test('sala vazia limpa criaturas', () => {
  const room = makeRoom('VAZIA');
  const sys = new CreatureSystem(room);
  sys.spawn('listener', { point: { gx: 0, gy: 0, x: 500, y: 500 } });
  assert.ok(sys.creatures.size >= 1);
  sys.update(0.05, Date.now());
  assert.equal(sys.creatures.size, 0);
});

test('anomalias têm raridade, regra e mensagem', () => {
  for (const def of Object.values(ANOMALY_DEFS)) {
    assert.ok(['sutil', 'moderada', 'rara', 'impossível'].includes(def.rarity), `${def.id} tem raridade inválida`);
    assert.ok(def.message.length > 10);
    assert.ok(def.rule.length > 10);
    assert.ok(def.durationMs > 0);
    assert.ok(def.durationMs < 20000, 'anomalias não devem ser permanentes');
  }
});

test('anomalias escalam com a tensão da sala', () => {
  const room = makeRoom('TENSAO');
  const sys = new AnomalySystem(room);
  assert.equal(sys.tension(Date.now()), 0, 'sem jogadores, tensão zero');

  const p1 = room.player('p1', 300, 300);
  const p2 = room.player('p2', 310, 300);
  p1.vx = 100; p2.vx = 100;
  const lowTension = sys.tension(Date.now());
  p1.vx = 0; p2.vx = 0; p1.stillSince = Date.now() - 60000; p2.stillSince = Date.now() - 60000;
  p2.x = 3000; // separados
  sys.lastEventAt = Date.now() - 60000;
  const highTension = sys.tension(Date.now());
  assert.ok(highTension > lowTension, `tensão deveria subir (${highTension} > ${lowTension})`);
});

test('anomalias raras exigem mais tensão que anomalias sutis', () => {
  const room = makeRoom('RARAS');
  room.player('p1', 300, 300);
  const sys = new AnomalySystem(room);
  sys.lastEventAt = Date.now() - 60000;
  // Com tensão baixa, anomalias 'impossível' não devem ser escolhidas
  let impossiveis = 0;
  for (let i = 0; i < 80; i++) {
    const pick = sys.pickAnomaly(Date.now());
    if (pick && pick.rarity === 'impossível') impossiveis++;
  }
  assert.ok(impossiveis === 0, 'anomalias impossíveis não devem ocorrer em baixa tensão');
});

test('anomalia disparada expira sozinha', () => {
  const room = makeRoom('EXPIRA');
  const p = room.player('p1', 500, 500);
  void p;
  const sys = new AnomalySystem(room);
  const ev = sys.trigger(Date.now(), 'flicker');
  assert.ok(ev);
  assert.equal(sys.active.length, 1);
  const endsAt = sys.active[0].endsAt;
  sys.update(0.05, endsAt + 10);
  assert.equal(sys.active.length, 0, 'anomalia deve expirar');
});

test('nenhum evento ambiental gera stack de anomalias permanentes', () => {
  const room = makeRoom('AMBIENTE');
  room.player('p1', 500, 500);
  const sys = new AnomalySystem(room);
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const ev = sys.applyEnvironmental({ type: 'organAlter', gx: 3, gy: 3 }, now + i);
    assert.ok(ev === null || ev.anomaly);
  }
  assert.equal(sys.active.length, 0, 'eventos ambientais não devem add anomalias ao estado ativo');
});
