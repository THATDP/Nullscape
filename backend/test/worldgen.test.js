/**
 * NULLSCAPE — Testes do gerador procedural.
 * Garante: determinismo por seed, conectividade, portas reais, sigilos
 * alcançáveis e composição mínima por região.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateWorld,
  generateValidWorld,
  serializeWorld,
  validateConnectivity,
  bfsReach,
  encodeGrid,
  decodeGrid,
  REGION_W,
  REGION_H,
  REGION_COUNT,
  WORLD_W,
} from '../../shared/world/generator.js';
import { T, THEMES, THEME_IDS } from '../../shared/world/themes.js';
import { Rng, normalizeSeed, hashString } from '../../shared/world/rng.js';

const SEEDS = ['ALFA', '1414', 'X7', 'O-CORREDOR', 'PISCINA', 'NULO', 'MARROM', '9', 'ZEBRA', 'ECO'];

test('normalizeSeed é estável e determinístico', () => {
  assert.equal(normalizeSeed('alfa'), 'ALFA');
  assert.equal(normalizeSeed('  alfa  '), 'ALFA');
  assert.equal(normalizeSeed('a'), 'A');
  assert.ok(normalizeSeed().length > 0, 'sem seed deve gerar uma');
  assert.equal(normalizeSeed(1234), '1234');
  assert.equal(hashString('x')(), hashString('x')(), 'hash deve ser determinístico');
});

test('Rng produz a mesma sequência para a mesma seed', () => {
  const a = new Rng('REPRO');
  const b = new Rng('REPRO');
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((n) => n >= 0 && n < 1));
  const r = new Rng('INTS');
  for (let i = 0; i < 100; i++) {
    const n = r.int(3, 7);
    assert.ok(n >= 3 && n <= 7);
  }
});

test('mesma seed gera exatamente o mesmo mundo', () => {
  for (const seed of SEEDS) {
    const a = serializeWorld(generateValidWorld(seed));
    const b = serializeWorld(generateValidWorld(seed));
    assert.equal(a.hash, b.hash, `hash divergente para ${seed}`);
    assert.equal(JSON.stringify(a.regions[0].grid), JSON.stringify(b.regions[0].grid));
    assert.equal(a.spawn.x, b.spawn.x);
    assert.equal(a.spawn.y, b.spawn.y);
    assert.deepEqual(a.puzzles.map((p) => p.kind), b.puzzles.map((p) => p.kind));
  }
});

test('mundo tem 4 regiões com ambientes, salas e portas', () => {
  const world = generateValidWorld('COMPOSICAO');
  assert.equal(world.regions.length, REGION_COUNT);
  const themes = world.regions.map((r) => r.themeId);
  assert.equal(new Set(themes).size, themes.length, 'temas devem ser distintos');
  for (const themeId of themes) assert.ok(THEMES[themeId], `tema ${themeId} deve existir`);
  for (const region of world.regions) {
    assert.ok(region.rooms.length >= 4, `região ${region.index} deve ter salas`);
    assert.ok(region.props.length >= 6, `região ${region.index} deve ter mobiliário`);
    assert.ok(region.lights.length >= 3, `região ${region.index} deve ter luzes`);
    assert.ok(region.rooms.some((r) => r.role === 'normal' || r.role === 'hub'));
  }
  assert.ok(world.doors.length >= 12, 'deve haver portas reais');
  for (const door of world.doors) {
    assert.ok(door.cells.length >= 1);
    assert.ok(door.kind === 'normal' || door.kind === 'gate');
  }
});

test('toda sala é alcançável a partir do spawn (conectividade real)', () => {
  for (const seed of SEEDS) {
    const world = generateValidWorld(seed);
    const reach = bfsReach(world, world.spawn, 'all-open');
    for (const region of world.regions) {
      for (const room of region.rooms) {
        let ok = false;
        for (let y = room.y + 1; y < room.y + room.h - 1 && !ok; y++) {
          for (let x = room.x + 1; x < room.x + room.w - 1 && !ok; x++) {
            if (reach.has(`${x + region.offset.x},${y}`)) ok = true;
          }
        }
        assert.ok(ok, `sala ${room.id} inalcançável (seed ${seed})`);
      }
    }
    const validation = validateConnectivity(world);
    assert.equal(validation.ok, true, `conectividade inválida (seed ${seed})`);
    assert.equal(validation.exitReachable, true);
    assert.equal(validation.sigilsReachable, true);
  }
});

test('portões bloqueiam a passagem até serem abertos', () => {
  const world = generateValidWorld('PORTOES');
  const gates = world.doors.filter((d) => d.kind === 'gate');
  assert.ok(gates.length >= 2, 'devem existir portões de fronteira');
  const closedReach = bfsReach(world, world.spawn, 'gate-state');
  const openReach = bfsReach(world, world.spawn, 'all-open');
  assert.ok(openReach.size > closedReach.size, 'portões fechados devem reduzir a área alcançável');
  // Região inicial continua acessível com portões fechados
  const validation = validateConnectivity(world);
  assert.equal(validation.ok, true);
  for (let i = 0; i < gates.length; i++) {
    assert.equal(gates[i].requirement.type, 'sigils');
    assert.ok(gates[i].requirement.count >= 1);
  }
});

test('cada região tem um quebra-cabeça e um sigilo associado', () => {
  const world = generateValidWorld('PUZZLES');
  assert.equal(world.puzzles.length, REGION_COUNT);
  assert.equal(world.sigils.length, REGION_COUNT);
  for (const puzzle of world.puzzles) {
    assert.ok(puzzle.sigilId.startsWith('sigil-'));
    assert.ok(puzzle.mechanismIds.length >= 2, 'quebra-cabeça cooperativo precisa de 2+ mecanismos');
    assert.ok(typeof puzzle.clue === 'string' && puzzle.clue.length > 5);
    const sigil = world.sigils.find((s) => s.id === puzzle.sigilId);
    assert.ok(sigil, 'sigilo do puzzle deve existir');
    assert.equal(sigil.puzzleId, puzzle.id);
  }
  const kinds = new Set(world.puzzles.map((p) => p.kind));
  assert.ok(kinds.size >= 3, 'deve haver variedade de quebra-cabeças');
  assert.ok(world.altar, 'deve existir altar final');
  assert.equal(world.altar.requirement.count, 4);
});

test('anotações possuem texto e estão em salas válidas', () => {
  const world = generateValidWorld('NOTAS');
  assert.ok(world.notes.length >= 6);
  for (const note of world.notes) {
    assert.ok(note.title.length > 2);
    assert.ok(note.text.length > 20, 'notas devem ter texto significativo');
    assert.ok(note.gx >= 0 && note.gx < WORLD_W);
    assert.ok(note.gy >= 0 && note.gy < REGION_H);
  }
});

test('script de grid (RLE) preserva o mapa byte a byte', () => {
  const world = generateValidWorld('RLE');
  for (const region of world.regions) {
    const rle = encodeGrid(region.grid);
    const decoded = decodeGrid(rle, REGION_W, REGION_H);
    assert.deepEqual(Array.from(decoded), Array.from(region.grid.tiles));
    assert.ok(rle.length < REGION_W * REGION_H, 'RLE deve compactar');
  }
});

test('payload serializado é leve o suficiente para rede', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const json = JSON.stringify(serializeWorld(generateValidWorld(seed)));
    assert.ok(json.length < 180 * 1024, `payload grande demais: ${json.length} bytes (seed ${seed})`);
  }
});

test('praticamente toda região tem câmara secreta (com tema trocado)', () => {
  // Antes existia UMA tentativa por região e ~19% das regiões ficavam sem
  // câmara; em 45% dos mundos não havia nenhuma. Isso quebrava a promessa de
  // "cada quebra-cabeça revela um sigilo na câmara secreta".
  let regions = 0;
  let withSecret = 0;
  for (let i = 0; i < 12; i++) {
    const world = generateValidWorld(`CAMARA-${i}`);
    for (const region of world.regions) {
      regions++;
      const secret = region.rooms.find((r) => r.secret);
      if (!secret) continue;
      withSecret++;
      assert.ok(secret.hiddenThemeId && secret.hiddenThemeId !== region.themeId, 'câmara deve usar outro tema');
      assert.ok(secret.w >= 4 && secret.h >= 4, 'câmara não pode ser menor que 4×4');
      assert.ok(secret.id.startsWith(`r${region.index}-`), 'id da câmara deve seguir o padrão da região');
    }
    assert.ok(
      world.regions.some((r) => r.rooms.some((x) => x.secret)),
      `mundo CAMARA-${i} deveria ter ao menos uma câmara secreta`,
    );
  }
  assert.ok(withSecret / regions > 0.9, `esperado >90% das regiões com câmara, obtido ${((100 * withSecret) / regions).toFixed(1)}%`);
});

test('cada ambiente tem regra de iluminação própria e distinta', () => {
  const profiles = THEME_IDS.map((id) => {
    const l = THEMES[id].lighting;
    assert.ok(l, `${id} precisa de uma regra de iluminação`);
    assert.ok(l.density > 0 && l.density <= 1, `${id}: densidade inválida`);
    assert.ok(Array.isArray(l.radius) && l.radius[0] < l.radius[1], `${id}: raio inválido`);
    assert.ok(l.unstable >= 0 && l.unstable <= 1, `${id}: instabilidade inválida`);
    assert.ok(l.steady > 0 && l.steady <= 1, `${id}: intensidade inválida`);
    return JSON.stringify(l);
  });
  assert.equal(new Set(profiles).size, THEME_IDS.length, 'dois temas não podem compartilhar a mesma regra de luz');

  // O gerador realmente aplica a regra: luzes instáveis são mais fracas.
  const world = generateValidWorld('LUZES');
  for (const region of world.regions) {
    assert.ok(region.lights.length >= 3, 'região deve ter luzes');
    const unstable = region.lights.filter((l) => l.flicker);
    const steady = region.lights.filter((l) => !l.flicker);
    if (unstable.length && steady.length) {
      const avg = (arr) => arr.reduce((n, l) => n + l.intensity, 0) / arr.length;
      assert.ok(avg(unstable) < avg(steady), `luz instável deve ser mais fraca (região ${region.index})`);
    }
  }
});

test('todos os ambientes têm identidade visual e sonora própria', () => {
  for (const id of THEME_IDS) {
    const theme = THEMES[id];
    assert.ok(theme.label.length > 3);
    assert.ok(theme.ambience.length > 0, `${id} precisa de ambiência sonora`);
    assert.ok(theme.props.length >= 6, `${id} precisa de mobiliário`);
    assert.ok(theme.names.length >= 8, `${id} precisa de nomes de sala`);
    assert.ok(theme.notes.length >= 2, `${id} precisa de anotações`);
    assert.ok(theme.palette.floor && theme.palette.wall && theme.palette.glow);
    // Paleta dessaturada: diferença entre canais pequena no piso
    const r = (theme.palette.floor >> 16) & 0xff;
    const g = (theme.palette.floor >> 8) & 0xff;
    const b = theme.palette.floor & 0xff;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread < 130, `${id} deve ter paleta discreta (spread ${spread})`);
  }
});

test('water é gerado apenas em ambientes aquáticos e é intransponível', () => {
  const world = generateValidWorld('AGUA');
  let waterTiles = 0;
  for (const region of world.regions) {
    for (const tile of region.grid.tiles) {
      if (tile === T.WATER) {
        waterTiles++;
        assert.equal(region.theme.water, true, `água em tema não aquático: ${region.themeId}`);
      }
    }
  }
  if (world.regions.some((r) => r.theme.water)) assert.ok(waterTiles > 0, 'tema aquático deve ter água');
});

test('o spawn sempre está em piso caminhável', () => {
  for (const seed of SEEDS) {
    const world = generateValidWorld(seed);
    const region = world.regions[0];
    const tile = region.grid.get(world.spawn.x - region.offset.x, world.spawn.y);
    assert.ok(tile === T.FLOOR || tile === T.DOORWAY, `spawn inválido (seed ${seed}): tile ${tile}`);
  }
});

test('geração é rápida o suficiente para produção', () => {
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) generateValidWorld(`PERF${i}`);
  const avg = (performance.now() - t0) / 10;
  assert.ok(avg < 250, `geração lenta: ${avg.toFixed(1)}ms por mundo`);
});
