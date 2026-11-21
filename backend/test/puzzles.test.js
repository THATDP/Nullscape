/**
 * NULLSCAPE — Testes dos quebra-cabeças cooperativos.
 * Cada variante tem regra própria; aqui verificamos resolução correta,
 * recusa correta e que mecanismos exigem proximidade.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateValidWorld, TILE_SIZE } from '../../shared/world/generator.js';
import { PuzzleSystem } from '../../shared/sim/puzzles.js';

function makeRoom(seed) {
  const world = generateValidWorld(seed);
  const room = {
    world,
    playerStates: new Map(),
    envEvents: [],
    events: [],
    player(id) {
      const p = { id, x: 0, y: 0, dead: false, disconnected: false, inventory: [], hasKeycard: false };
      this.playerStates.set(id, p);
      return p;
    },
  };
  room.puzzleSystem = new PuzzleSystem(room);
  return room;
}

function moveTo(player, mech) {
  player.x = (mech.gx + 0.5) * TILE_SIZE;
  player.y = (mech.gy + 0.5) * TILE_SIZE;
}

function solveByKind(room, puzzle) {
  const ps = room.puzzleSystem;
  const p1 = room.player('p1');
  const p2 = room.player('p2');
  const mechs = puzzle.mechanismIds.map((id) => room.world.interactables.find((m) => m.id === id)).filter(Boolean);

  switch (puzzle.kind) {
    case 'valvePair': {
      const [a, b] = mechs.filter((m) => m.kind === 'valve');
      moveTo(p1, a);
      moveTo(p2, b);
      ps.interact(p1.id, a.id);
      const res = ps.interact(p2.id, b.id);
      return res;
    }
    case 'breakerOrder': {
      const breakers = mechs.filter((m) => m.kind === 'breaker');
      for (const index of puzzle.order) {
        const b = breakers.find((m) => m.orderIndex === index);
        moveTo(p1, b);
        ps.interact(p1.id, b.id);
      }
      return { ok: true };
    }
    case 'holdLever': {
      const lever = mechs.find((m) => m.kind === 'lever');
      const plate = mechs.find((m) => m.kind === 'plate');
      moveTo(p1, lever);
      moveTo(p2, plate);
      ps.interact(p1.id, lever.id);
      return ps.interact(p2.id, plate.id);
    }
    case 'pressurePlates': {
      const plates = mechs.filter((m) => m.kind === 'plate');
      moveTo(p1, plates[0]);
      moveTo(p2, plates[1]);
      ps.interact(p1.id, plates[0].id);
      return ps.interact(p2.id, plates[1].id);
    }
    case 'keycard': {
      const reader = room.world.interactables.find((m) => m.kind === 'keycardReader' && m.puzzleId === puzzle.id);
      const card = room.world.interactables.find((m) => m.kind === 'keycardItem' && m.puzzleId === puzzle.id);
      if (card) {
        moveTo(p1, card);
        ps.interact(p1.id, card.id);
      }
      if (reader) {
        moveTo(p1, reader);
        return ps.interact(p1.id, reader.id);
      }
      return { ok: false };
    }
    case 'silenceChoir': {
      const bell = mechs.find((m) => m.kind === 'bell');
      moveTo(p1, bell);
      let now = Date.now();
      for (let i = 0; i < 3; i++) {
        now += 1500;
        ps.interact(p1.id, bell.id, now);
      }
      return { ok: true };
    }
    default:
      return { ok: false };
  }
}

test('existem quebra-cabeças de tipos variados e todos resolvíveis', () => {
  const kindsSeen = new Set();
  for (let i = 0; i < 12; i++) {
    const room = makeRoom(`PUZZLE${i}`);
    for (const puzzle of room.world.puzzles) {
      kindsSeen.add(puzzle.kind);
      const res = solveByKind(room, puzzle);
      assert.ok(res.ok !== false, `puzzle ${puzzle.kind} recusado: ${res.error}`);
      const st = room.puzzleSystem.state.get(puzzle.id);
      assert.equal(st.solved, true, `${puzzle.kind} deveria estar resolvido (seed PUZZLE${i})`);
      const sigil = room.world.sigils.find((s) => s.id === puzzle.sigilId);
      assert.equal(sigil.revealed, true, `${puzzle.kind} deveria revelar o sigilo`);
    }
  }
  assert.ok(kindsSeen.size >= 4, `variedade insuficiente: ${[...kindsSeen]}`);
});

test('interação fora de alcance é recusada', () => {
  const room = makeRoom('DISTANCIA');
  const puzzle = room.world.puzzles[0];
  const mech = room.world.interactables.find((m) => m.id === puzzle.mechanismIds[0]);
  const p = room.player('p1');
  p.x = 0;
  p.y = 0;
  const res = room.puzzleSystem.interact('p1', mech.id);
  assert.equal(res.ok, false);
  assert.match(res.error, /alcance/);
});

test('jogador morto não interage', () => {
  const room = makeRoom('MORTO');
  const puzzle = room.world.puzzles[0];
  const mech = room.world.interactables.find((m) => m.id === puzzle.mechanismIds[0]);
  const p = room.player('p1');
  moveTo(p, mech);
  p.dead = true;
  const res = room.puzzleSystem.interact('p1', mech.id);
  assert.equal(res.ok, false);
});

test('quebrador de energia exige ordem correta e reinicia ao errar', () => {
  const room = makeRoom('ORDEM');
  const puzzle = room.world.puzzles.find((p) => p.kind === 'breakerOrder');
  if (!puzzle) return;
  const breakers = puzzle.mechanismIds.map((id) => room.world.interactables.find((m) => m.id === id));
  const p = room.player('p1');
  const wrong = breakers.find((b) => b.orderIndex === puzzle.order[puzzle.order.length - 1]);
  moveTo(p, wrong);
  room.puzzleSystem.interact(p.id, wrong.id);
  const st = room.puzzleSystem.state.get(puzzle.id);
  assert.equal(st.sequence.length, 0, 'erro deve reiniciar a sequência');
  assert.equal(st.solved, false);
});

test('válvulas fora da janela de tempo não resolvem', () => {
  const room = makeRoom('JANELA');
  const puzzle = room.world.puzzles.find((p) => p.kind === 'valvePair');
  if (!puzzle) return;
  const valves = puzzle.mechanismIds.map((id) => room.world.interactables.find((m) => m.id === id));
  const p = room.player('p1');
  const t0 = Date.now();
  moveTo(p, valves[0]);
  room.puzzleSystem.interact(p.id, valves[0].id, t0);
  moveTo(p, valves[1]);
  // muito depois da janela
  room.puzzleSystem.interact(p.id, valves[1].id, t0 + puzzle.window + 5000);
  const st = room.puzzleSystem.state.get(puzzle.id);
  // A segunda válvula apenas inicia uma nova janela
  assert.equal(st.solved, false);
  assert.ok(st.activatedAt > t0);
});

test('alavanca não solta se o jogador sai de perto', () => {
  const room = makeRoom('ALAVANCA');
  const puzzle = room.world.puzzles.find((p) => p.kind === 'holdLever');
  if (!puzzle) return;
  const lever = room.world.interactables.find((m) => m.puzzleId === puzzle.id && m.kind === 'lever');
  const p1 = room.player('p1');
  const p2 = room.player('p2');
  moveTo(p1, lever);
  room.puzzleSystem.interact(p1.id, lever.id);
  const st = room.puzzleSystem.state.get(puzzle.id);
  assert.equal(st.held.size, 1);
  // p1 se afasta
  p1.x += 600;
  room.puzzleSystem.update(0.05, Date.now());
  assert.equal(st.held.size, 0, 'alavanca deve ser solta ao se afastar');
  // botão sem ninguém na alavanca não funciona
  const plate = room.world.interactables.find((m) => m.puzzleId === puzzle.id && m.kind === 'plate');
  moveTo(p2, plate);
  const res = room.puzzleSystem.interact(p2.id, plate.id);
  assert.equal(res.ok, true);
  assert.ok(res.hint, 'deve explicar que falta alguém na alavanca');
  assert.equal(st.solved, false);
});

test('sino do coro conta 3 toques com pausa mínima', () => {
  const room = makeRoom('SINO');
  const puzzle = room.world.puzzles.find((p) => p.kind === 'silenceChoir');
  if (!puzzle) return;
  const bell = room.world.interactables.find((m) => m.puzzleId === puzzle.id && m.kind === 'bell');
  const p = room.player('p1');
  moveTo(p, bell);
  const st = room.puzzleSystem.state.get(puzzle.id);
  let now = Date.now();
  room.puzzleSystem.interact(p.id, bell.id, now);
  assert.equal(st.bellCount, 1);
  // rápido demais: zera
  room.puzzleSystem.interact(p.id, bell.id, now + 200);
  assert.equal(st.bellCount, 0);
  now += 2000;
  for (let i = 0; i < 3; i++) {
    now += 1500;
    room.puzzleSystem.interact(p.id, bell.id, now);
  }
  assert.equal(st.solved, true);
});

test('cartão magnético precisa ser encontrado antes de usar', () => {
  const room = makeRoom('CARTAO');
  const puzzle = room.world.puzzles.find((p) => p.kind === 'keycard');
  if (!puzzle) return;
  const reader = room.world.interactables.find((m) => m.kind === 'keycardReader' && m.puzzleId === puzzle.id);
  const card = room.world.interactables.find((m) => m.kind === 'keycardItem' && m.puzzleId === puzzle.id);
  const p = room.player('p1');
  moveTo(p, reader);
  const first = room.puzzleSystem.interact(p.id, reader.id);
  assert.equal(first.ok, true);
  assert.ok(first.hint, 'deve indicar que falta o cartão');
  assert.equal(room.puzzleSystem.state.get(puzzle.id).solved, false);

  moveTo(p, card);
  const take = room.puzzleSystem.interact(p.id, card.id);
  assert.equal(take.ok, true);
  assert.equal(p.hasKeycard, true);

  moveTo(p, reader);
  room.puzzleSystem.interact(p.id, reader.id);
  assert.equal(room.puzzleSystem.state.get(puzzle.id).solved, true);
  assert.equal(p.hasKeycard, false, 'o cartão é consumido pelo leitor');
});

test('snapshot de puzzles é compacto e serializável', () => {
  const room = makeRoom('SNAPSHOT');
  const snap = room.puzzleSystem.snapshot();
  const json = JSON.stringify(snap);
  assert.ok(json.length < 4000);
  assert.ok(Object.keys(snap).length === room.world.puzzles.length);
});
