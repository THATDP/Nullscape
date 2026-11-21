/**
 * NULLSCAPE — Gerador de mundo procedural.
 *
 * Estrutura do mundo:
 *  - 4 regiões contíguas de 40x40 tiles, cada uma com um ambiente temático.
 *  - Salas retangulares não sobrepostas, ligadas por corredores roteados com A*
 *    que NUNCA cruzam o interior de uma sala. Toda ligação passa por portas.
 *  - Árvore geradora (Prim) + arestas extras => rotas alternativas e ciclos.
 *  - Câmaras secretas ligadas por corredores estreitos.
 *  - Portões de fronteira exigem sigilos recuperados nos quebra-cabeças.
 *  - Cada região tem um quebra-cabeça cooperativo distinto.
 *  - O Altar da última região encerra o ciclo com todos os sigilos.
 *
 * Determinístico: mesma seed => mesmo mundo.
 */

import { Rng, normalizeSeed, stableHash } from './rng.js';
import { THEMES, THEME_IDS, T, FURNITURE, ROOM_ROLES, themeFor } from './themes.js';

export const REGION_W = 40;
export const REGION_H = 40;
export const REGION_COUNT = 4;
export const WORLD_W = REGION_W * REGION_COUNT;
export const WORLD_H = REGION_H;
export const TILE_SIZE = 32;

const ROOM_TYPES = [
  { kind: 'small', minW: 6, maxW: 8, minH: 6, maxH: 8, weight: 3 },
  { kind: 'wide', minW: 10, maxW: 13, minH: 6, maxH: 8, weight: 2 },
  { kind: 'great', minW: 10, maxW: 14, minH: 10, maxH: 13, weight: 1.4 },
  { kind: 'hall', minW: 13, maxW: 18, minH: 6, maxH: 7, weight: 1.6 },
];

const ROMAN = ['I', 'II', 'III', 'IV'];
const GREEK = ['Alfa', 'Beta', 'Gama', 'Delta'];
const MECHANIC_KINDS = ['valvePair', 'breakerOrder', 'holdLever', 'pressurePlates', 'keycard', 'silenceChoir'];

export const WALKABLE_TILES = new Set([T.FLOOR, T.DOORWAY]);
const DIRS4 = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function rectsOverlap(a, b, pad = 0) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}
function centerOf(rect) {
  return { x: Math.floor(rect.x + rect.w / 2), y: Math.floor(rect.y + rect.h / 2) };
}
function distRects(a, b) {
  const ca = centerOf(a);
  const cb = centerOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}
function interiorOf(room) {
  return { x: room.x + 1, y: room.y + 1, w: room.w - 2, h: room.h - 2 };
}
function insideRect(r, x, y) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

class RegionGrid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h).fill(T.WALL);
  }
  idx(x, y) {
    return y * this.w + x;
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    if (!this.inside(x, y)) return T.WALL;
    return this.tiles[this.idx(x, y)];
  }
  set(x, y, v) {
    if (!this.inside(x, y)) return;
    this.tiles[this.idx(x, y)] = v;
  }
  fillRect(x, y, w, h, v) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, v);
  }
  ring(x, y, w, h, v) {
    for (let xx = x; xx < x + w; xx++) {
      this.set(xx, y, v);
      this.set(xx, y + h - 1, v);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.set(x, yy, v);
      this.set(x + w - 1, yy, v);
    }
  }
}

// ---------------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------------

function tryPlaceRooms(rng, targetCount) {
  const rooms = [];
  for (let i = 0; i < targetCount * 140 && rooms.length < targetCount; i++) {
    const type = rng.weighted(ROOM_TYPES.map((t) => ({ item: t, weight: t.weight })));
    const w = rng.int(type.minW, type.maxW);
    const h = rng.int(type.minH, type.maxH);
    const x = rng.int(2, REGION_W - w - 3);
    const y = rng.int(2, REGION_H - h - 3);
    const candidate = { x, y, w, h, kind: type.kind };
    if (rooms.some((r) => rectsOverlap(r, candidate, 2))) continue;
    rooms.push(candidate);
  }
  return rooms;
}

function carveRoom(grid, room) {
  grid.fillRect(room.x + 1, room.y + 1, room.w - 2, room.h - 2, T.FLOOR);
}

function edgePoint(room, side, rng) {
  const xLo = room.x + 2;
  const xHi = room.x + room.w - 3;
  const yLo = room.y + 2;
  const yHi = room.y + room.h - 3;
  switch (side) {
    case 'left':
      return { x: room.x, y: rng.int(yLo, yHi) };
    case 'right':
      return { x: room.x + room.w - 1, y: rng.int(yLo, yHi) };
    case 'top':
      return { x: rng.int(xLo, xHi), y: room.y };
    default:
      return { x: rng.int(xLo, xHi), y: room.y + room.h - 1 };
  }
}

const OUTWARD = {
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  top: { dx: 0, dy: -1 },
  bottom: { dx: 0, dy: 1 },
};

/** A* em 4 direções evitando interiores de salas. */
function routePath(grid, start, goal, blocked, opts = {}) {
  const { w, h } = grid;
  const key = (x, y) => y * w + x;
  const isBlocked = (x, y) => {
    if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return true;
    for (const r of blocked) if (insideRect(r, x, y)) return true;
    return false;
  };
  if (isBlocked(start.x, start.y) || isBlocked(goal.x, goal.y)) return null;
  const open = [{ x: start.x, y: start.y, g: 0, f: 0, parent: null }];
  const best = new Map([[key(start.x, start.y), 0]]);
  let goalNode = null;
  let guard = 0;
  while (open.length && guard++ < 40000) {
    open.sort((a, b) => a.f - b.f);
    const node = open.shift();
    if (node.x === goal.x && node.y === goal.y) {
      goalNode = node;
      break;
    }
    for (const d of DIRS4) {
      const nx = node.x + d.dx;
      const ny = node.y + d.dy;
      if (isBlocked(nx, ny)) continue;
      const tile = grid.get(nx, ny);
      // corredores existentes são mais baratos (reaproveita caminhos)
      let stepCost = 1;
      if (tile === T.FLOOR) stepCost = 0.35;
      if (opts.doorCells && opts.doorCells.has(`${nx},${ny}`)) stepCost = 0.05;
      // leve preferência por seguir reto
      const gScore = node.g + stepCost;
      const k = key(nx, ny);
      if (best.has(k) && best.get(k) <= gScore) continue;
      best.set(k, gScore);
      const heur = Math.abs(nx - goal.x) + Math.abs(ny - goal.y);
      open.push({ x: nx, y: ny, g: gScore, f: gScore + heur, parent: node });
    }
  }
  if (!goalNode) return null;
  const path = [];
  let n = goalNode;
  while (n) {
    path.push({ x: n.x, y: n.y });
    n = n.parent;
  }
  return path.reverse();
}

/**
 * Escava o caminho com largura 2, nunca tocando nenhum tile de uma sala.
 * O alargamento só é aplicado quando todos os 4 vizinhos estão livres.
 */
function carvePath(grid, path, blocked) {
  const roomTile = (x, y) => blocked.some((r) => insideRect(r, x, y));
  const canPaint = (x, y) => !roomTile(x, y) && x > 0 && y > 0 && x < grid.w - 1 && y < grid.h - 1;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (canPaint(p.x, p.y) && grid.get(p.x, p.y) === T.WALL) grid.set(p.x, p.y, T.FLOOR);
    const prev = path[i - 1] || p;
    const next = path[i + 1] || p;
    const vertical = next.y !== prev.y;
    const bx = vertical ? p.x + 1 : p.x;
    const by = vertical ? p.y : p.y + 1;
    if (canPaint(bx, by) && grid.get(bx, by) === T.WALL) grid.set(bx, by, T.FLOOR);
  }
}

/** Liga duas salas com corredor roteado e registra as portas resultantes. */
function connectRooms(grid, a, b, rng, blocked, doorCells) {
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  let sideA;
  let sideB;
  if (Math.abs(ax - bx) >= Math.abs(ay - by)) {
    sideA = ax < bx ? 'right' : 'left';
    sideB = ax < bx ? 'left' : 'right';
  } else {
    sideA = ay < by ? 'bottom' : 'top';
    sideB = ay < by ? 'top' : 'bottom';
  }
  const pa = edgePoint(a, sideA, rng);
  const pb = edgePoint(b, sideB, rng);
  const oa = { x: pa.x + OUTWARD[sideA].dx, y: pa.y + OUTWARD[sideA].dy };
  const ob = { x: pb.x + OUTWARD[sideB].dx, y: pb.y + OUTWARD[sideB].dy };
  const path = routePath(grid, oa, ob, blocked, { doorCells });
  if (!path) return null;
  carvePath(grid, path, blocked);
  doorCells.add(`${pa.x},${pa.y}`);
  doorCells.add(`${pb.x},${pb.y}`);
  return { pa, pb, path };
}

// ---------------------------------------------------------------------------
// Conteúdo das salas
// ---------------------------------------------------------------------------

function poolWater(rng, room, grid) {
  if (room.w < 8 || room.h < 7) return false;
  const w = Math.max(3, room.w - 6);
  const h = Math.max(2, room.h - 6);
  const x = room.x + Math.floor((room.w - w) / 2);
  const y = room.y + Math.floor((room.h - h) / 2);
  grid.fillRect(x, y, w, h, T.WATER);
  grid.ring(x - 1, y - 1, w + 2, h + 2, T.FLOOR);
  room.hasPool = true;
  return true;
}

function propsForRoom(rng, room, theme, offset, grid) {
  const props = [];
  const placed = [];
  const count = Math.max(2, Math.floor(((room.w - 2) * (room.h - 2)) / 14));
  const kinds = theme.props;
  const door = { x: room.x + room.w / 2, y: room.y + room.h - 1 };
  for (let attempt = 0; attempt < count * 12 && props.length < count; attempt++) {
    const kind = rng.pick(kinds);
    const def = FURNITURE[kind] || { w: 1, h: 1, blocks: false };
    if (def.w > room.w - 4 || def.h > room.h - 4) continue;
    const x = rng.int(room.x + 1, room.x + room.w - def.w - 1);
    const y = rng.int(room.y + 1, room.y + room.h - def.h - 1);
    if (def.blocks && def.w > 1) {
      // Deixa ao menos uma faixa caminhável: evita colunas inteiras de bloqueio
      if (x + def.w > room.x + room.w - 1) continue;
    }
    const box = { x, y, w: def.w, h: def.h };
    let blocked = false;
    for (let yy = y; yy < y + def.h && !blocked; yy++) {
      for (let xx = x; xx < x + def.w && !blocked; xx++) {
        const tile = grid.get(xx, yy);
        if (tile !== T.FLOOR) blocked = true;
      }
    }
    if (blocked) continue;
    if (Math.hypot(x + def.w / 2 - door.x, y + def.h / 2 - door.y) < 2.4) continue;
    if (placed.some((p) => rectsOverlap(p, box, 1))) continue;
    placed.push(box);
    props.push({
      id: `p${room.id}-${props.length}`,
      kind,
      x,
      y,
      w: def.w,
      h: def.h,
      blocks: !!def.blocks,
      interactive: def.interactive || null,
      gx: x + offset.x,
      gy: y,
      roomId: room.id,
    });
  }
  return props;
}

function lightsForRoom(rng, room, theme, regionIndex) {
  // Cada ambiente tem SUA regra de iluminação (densidade, raio, instabilidade
  // e intensidade base) — ver `lighting` em shared/world/themes.js.
  const rule = theme.lighting || { density: 0.68, radius: [3, 6], unstable: 0.16, steady: 0.7 };
  const lights = [];
  for (let y = room.y + 2; y < room.y + room.h - 2; y += 4) {
    for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) {
      if (!rng.chance(rule.density)) continue;
      const flickering = rng.chance(rule.unstable);
      lights.push({
        x: (x + 0.5) * TILE_SIZE,
        y: (y + 0.5) * TILE_SIZE,
        radius: rng.int(rule.radius[0], rule.radius[1]) * TILE_SIZE,
        // luz instável é mais fraca; luz estável fica perto da intensidade base
        intensity: +rng.range(rule.steady * (flickering ? 0.45 : 0.8), rule.steady).toFixed(2),
        flicker: flickering,
        color: theme.palette.glow,
        regionId: regionIndex,
        themeId: theme.id,
      });
    }
  }
  // Garante que nenhuma sala fique totalmente às escuras.
  if (!lights.length) {
    lights.push({
      x: (room.x + room.w / 2) * TILE_SIZE,
      y: (room.y + room.h / 2) * TILE_SIZE,
      radius: rng.int(rule.radius[0], rule.radius[1]) * TILE_SIZE,
      intensity: +rule.steady.toFixed(2),
      flicker: false,
      color: theme.palette.glow,
      regionId: regionIndex,
      themeId: theme.id,
    });
  }
  return lights;
}

function assignRoomNames(rng, rooms, theme) {
  const pool = rng.shuffle(theme.names);
  rooms.forEach((room, i) => {
    room.name = pool[i % pool.length];
    if (i >= pool.length) room.name = `${pool[i % pool.length]} ${ROMAN[Math.floor(i / pool.length) % ROMAN.length]}`;
  });
}

function chooseRoomRoles(rooms, regionIndex, isLast) {
  for (const r of rooms) r.role = ROOM_ROLES.NORMAL;
  if (regionIndex === 0) {
    const entry = rooms.slice().sort((a, b) => a.x - b.x || a.y - b.y)[0];
    if (entry) entry.role = ROOM_ROLES.ENTRY;
  }
  if (isLast) {
    const exitRoom = rooms
      .filter((r) => r.role !== ROOM_ROLES.ENTRY)
      .sort((a, b) => centerOf(b).x - centerOf(a).x)[0];
    if (exitRoom) exitRoom.role = ROOM_ROLES.EXIT;
  }
  const hub = rooms
    .filter((r) => r.role === ROOM_ROLES.NORMAL)
    .sort(
      (a, b) =>
        Math.hypot(centerOf(a).x - REGION_W / 2, centerOf(a).y - REGION_H / 2) -
        Math.hypot(centerOf(b).x - REGION_W / 2, centerOf(b).y - REGION_H / 2),
    )[0];
  if (hub) hub.role = ROOM_ROLES.HUB;
  // Uma sala "quieta" por região: espaço sem saída intencional
  const quiet = rooms.filter((r) => r.role === ROOM_ROLES.NORMAL)[0];
  if (quiet) quiet.role = ROOM_ROLES.QUIET;
  return rooms;
}

function addPropsObstacles(grid, props) {
  for (const p of props) {
    if (!p.blocks) continue;
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (grid.get(x, y) === T.FLOOR) grid.set(x, y, T.WALL);
      }
    }
  }
}

function freeFloorNear(region, room, gxTarget, gyTarget, exclude = null) {
  const grid = region.grid;
  const offset = region.offset;
  let best = null;
  let bestD = Infinity;
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      if (grid.get(x, y) !== T.FLOOR) continue;
      const d = Math.hypot(x + offset.x - gxTarget, y - gyTarget);
      if (d < bestD) {
        if (exclude && Math.hypot(x + offset.x - exclude.gx, y - exclude.gy) < 3) continue;
        bestD = d;
        best = { gx: x + offset.x, gy: y, lx: x, ly: y };
      }
    }
  }
  if (!best) {
    const c = centerOf(room);
    best = { gx: c.x + offset.x, gy: c.y, lx: c.x, ly: c.y };
  }
  return best;
}

function trySecretChamber(rng, rooms, theme) {
  // Uma câmara secreta por região é parte da promessa do jogo (cada solução de
  // quebra-cabeça revela um sigilo lá dentro), então não basta uma tentativa
  // única: variamos tamanho e sala-anfitriã até achar espaço, e só então
  // escolhemos o encaixe mais próximo. Antes disso ~19% das regiões ficavam sem.
  const hosts = rooms.filter((r) => r.role === ROOM_ROLES.NORMAL || r.role === ROOM_ROLES.HUB);
  if (!hosts.length) return null;
  const ORDERED = rng.shuffle(hosts);

  // Tentativas progressivamente mais permissivas: câmaras menores, margem
  // menor e corredor mais longo — mas nunca uma sala minúscula injogável.
  const PLAN = [
    { size: [6, 8, 5, 6], margin: 3, maxDist: 18 },
    { size: [5, 7, 4, 5], margin: 2, maxDist: 20 },
    { size: [4, 6, 4, 4], margin: 2, maxDist: 24 },
  ];
  for (let attempt = 0; attempt < 9; attempt++) {
    const plan = PLAN[Math.min(PLAN.length - 1, Math.floor(attempt / 3))];
    const w = rng.int(plan.size[0], plan.size[1]);
    const h = rng.int(plan.size[2], plan.size[3]);
    const host = ORDERED[attempt % ORDERED.length];
    const hc = centerOf(host);
    const candidates = [];
    for (let y = 2; y < REGION_H - h - 2; y++) {
      for (let x = 2; x < REGION_W - w - 2; x++) {
        const box = { x, y, w, h };
        if (rooms.some((r) => rectsOverlap(r, box, plan.margin))) continue;
        const d = Math.hypot(centerOf(box).x - hc.x, centerOf(box).y - hc.y);
        if (d > plan.maxDist) continue;
        candidates.push({ box, d });
      }
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => a.d - b.d);
    const chosen = { ...candidates[0].box };
    chosen.kind = 'secret';
    chosen.role = ROOM_ROLES.SECRET;
    chosen.secret = true;
    chosen.name = rng.pick(['Câmara Selada', 'Quarto de Serviço', 'Sala Sem Planta', 'Anexo 0', 'O Armário Grande', 'Antiga Copa', 'Sala dos Sussurros']);
    chosen.hiddenThemeId = rng.pick(THEME_IDS.filter((t) => t !== theme.id));
    return { room: chosen, host };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Região
// ---------------------------------------------------------------------------

function generateRegion(rng, regionIndex, themeId, options) {
  const theme = themeFor(themeId);
  const grid = new RegionGrid(REGION_W, REGION_H);
  const offset = { x: regionIndex * REGION_W, y: 0 };

  const rooms = tryPlaceRooms(rng, rng.int(6, 8));
  if (rooms.length < 4) throw new Error(`Poucas salas na região ${regionIndex}`);

  rooms.forEach((r, i) => {
    r.id = `r${regionIndex}-${i}`;
    r.region = regionIndex;
    r.themeId = themeId;
    r.ox = offset.x;
    r.oy = 0;
  });
  for (const room of rooms) carveRoom(grid, room);
  assignRoomNames(rng, rooms, theme);
  chooseRoomRoles(rooms, regionIndex, options.isLast);

  // Piscinas (tema aquático). Garante ao menos uma, mesmo em salas pequenas.
  if (theme.water) {
    let pools = 0;
    for (const room of rooms) {
      if (room.role === ROOM_ROLES.EXIT) continue;
      if (rng.chance(0.55) && poolWater(rng, room, grid)) pools++;
    }
    if (!pools) {
      const candidate = rooms
        .filter((r) => r.role !== ROOM_ROLES.EXIT)
        .sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (candidate) {
        candidate.water = true;
        poolWater(rng, candidate, grid);
      }
    }
  }

  // Câmara secreta (antes dos corredores, para bloquear seu interior)
  const secretData = trySecretChamber(rng, rooms, theme);
  const secret = secretData ? secretData.room : null;
  if (secret) {
    secret.id = `r${regionIndex}-secret`;
    secret.region = regionIndex;
    secret.themeId = themeId;
    secret.ox = offset.x;
    secret.oy = 0;
    carveRoom(grid, secret);
  }

  const doorCells = new Set();
  const blocked = rooms.map(interiorOf);
  if (secret) blocked.push(interiorOf(secret));

  // Árvore geradora de salas
  const connected = new Set([0]);
  const pending = new Set(rooms.map((_, i) => i).filter((i) => i !== 0));
  const edges = [];
  while (pending.size) {
    let best = null;
    for (const a of connected) {
      for (const b of pending) {
        const d = distRects(rooms[a], rooms[b]);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) break;
    const res = connectRooms(grid, rooms[best.a], rooms[best.b], rng, blocked, doorCells);
    if (res) edges.push([best.a, best.b]);
    connected.add(best.b);
    pending.delete(best.b);
  }
  // Rotas alternativas
  const extras = Math.max(1, Math.floor(rooms.length / 3));
  let done = 0;
  let attempts = 0;
  while (done < extras && attempts++ < 30) {
    const a = rng.int(0, rooms.length - 1);
    let b = rng.int(0, rooms.length - 1);
    if (a === b) b = (b + 1) % rooms.length;
    if (edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
    const res = connectRooms(grid, rooms[a], rooms[b], rng, blocked, doorCells);
    if (res) {
      edges.push([a, b]);
      done++;
    }
  }
  // Câmara secreta: corredor estreito ligando à sala-anfitriã. Se falhar,
  // tenta SEM bloquear corredores de outras salas (o corredor secreto pode
  // cruzar um existente). Só desiste se as duas tentativas falharem.
  if (secret) {
    const allowed = blocked.filter((r) => r !== interiorOf(rooms[0]) || true);
    let res = connectRooms(grid, secretData.host, secret, rng, allowed, doorCells);
    if (!res) res = connectRooms(grid, secretData.host, secret, rng, [], doorCells);
    if (res) rooms.push(secret);
  }

  // Mobiliário e luzes
  const props = [];
  const lights = [];
  for (const room of rooms) {
    const roomProps = propsForRoom(rng, room, room.secret ? themeFor(room.hiddenThemeId) : theme, offset, grid);
    props.push(...roomProps);
    room.propIds = roomProps.map((p) => p.id);
    lights.push(...lightsForRoom(rng, room, theme, regionIndex));
    if (room.hasPool) {
      lights.push({
        x: (room.x + room.w / 2) * TILE_SIZE,
        y: (room.y + room.h / 2) * TILE_SIZE,
        radius: 5 * TILE_SIZE,
        intensity: 0.55,
        flicker: true,
        color: theme.palette.glow,
        regionId: regionIndex,
      });
    }
    if (room.secret) {
      lights.push({
        x: (room.x + room.w / 2) * TILE_SIZE,
        y: (room.y + room.h / 2) * TILE_SIZE,
        radius: 4 * TILE_SIZE,
        intensity: 0.5,
        flicker: true,
        color: 0xbfa6e8,
        regionId: regionIndex,
      });
    }
  }
  addPropsObstacles(grid, props);

  const regionRef = { index: regionIndex, grid, offset, rooms };
  const doors = buildDoorsFromCells(regionRef, doorCells, roomIdsFromCells(doorCells, rooms), blocked);

  return {
    index: regionIndex,
    theme,
    themeId,
    grid,
    offset,
    rooms,
    props,
    lights,
    edges,
    doors,
    secretId: secret && rooms.includes(secret) ? secret.id : null,
    name: `${theme.label} — ${GREEK[regionIndex] || regionIndex}`,
  };
}

function roomIdsFromCells(doorCells, rooms) {
  const cellRooms = [];
  for (const key of doorCells) {
    const [x, y] = key.split(',').map(Number);
    const room = rooms.find((r) => {
      // porta é uma célula na borda da sala
      const onLeft = x === r.x && y >= r.y && y < r.y + r.h;
      const onRight = x === r.x + r.w - 1 && y >= r.y && y < r.y + r.h;
      const onTop = y === r.y && x >= r.x && x < r.x + r.w;
      const onBottom = y === r.y + r.h - 1 && x >= r.x && x < r.x + r.w;
      return onLeft || onRight || onTop || onBottom;
    });
    if (room) cellRooms.push({ x, y, roomId: room.id });
  }
  return cellRooms;
}

/** Garante espaço livre ao redor de uma porta (fora das salas). */
function clearApproach(grid, x, y, blocked, radius = 1) {
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx <= 0 || ny <= 0 || nx >= grid.w - 1 || ny >= grid.h - 1) continue;
      if (blocked.some((r) => insideRect(r, nx, ny))) continue;
      if (grid.get(nx, ny) === T.WALL) grid.set(nx, ny, T.FLOOR);
    }
  }
}

function buildDoorsFromCells(region, doorCells, cellRoomRefs, blocked = []) {
  const grid = region.grid;
  const seen = new Set();
  const doors = [];
  let id = 0;
  for (const key of doorCells) {
    if (seen.has(key)) continue;
    const [sx, sy] = key.split(',').map(Number);
    const queue = [[sx, sy]];
    const group = [];
    seen.add(key);
    while (queue.length) {
      const [cx, cy] = queue.pop();
      group.push({ x: cx, y: cy });
      for (const d of DIRS4) {
        const nk = `${cx + d.dx},${cy + d.dy}`;
        if (doorCells.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          queue.push([cx + d.dx, cy + d.dy]);
        }
      }
    }
    const minX = Math.min(...group.map((c) => c.x));
    const minY = Math.min(...group.map((c) => c.y));
    const maxX = Math.max(...group.map((c) => c.x));
    const maxY = Math.max(...group.map((c) => c.y));
    for (const c of group) {
      grid.set(c.x, c.y, T.DOORWAY);
      clearApproach(grid, c.x, c.y, blocked, 1);
    }
    const roomIds = Array.from(
      new Set(cellRoomRefs.filter((c) => group.some((g) => g.x === c.x && g.y === c.y)).map((c) => c.roomId)),
    );
    doors.push({
      id: `d${id++}`,
      region: region.index,
      kind: 'normal',
      open: true,
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      gx: Math.round((minX + maxX) / 2) + region.offset.x,
      gy: Math.round((minY + maxY) / 2),
      cells: group.map((c) => ({ x: c.x, y: c.y, ox: region.offset.x, oy: 0 })),
      roomIds,
    });
  }
  return doors;
}

/** Abre passagem de 2-3 tiles na fronteira entre duas regiões. */
function connectRegions(rng, left, right) {
  const leftRoom = left.rooms.filter((r) => !r.secret).sort((a, b) => centerOf(b).x - centerOf(a).x)[0];
  const rightRoom = right.rooms.filter((r) => !r.secret).sort((a, b) => centerOf(a).x - centerOf(b).x)[0];
  if (!leftRoom || !rightRoom) return null;

  const leftY = rng.int(leftRoom.y + 2, leftRoom.y + leftRoom.h - 3);
  const rightY = rng.int(rightRoom.y + 2, rightRoom.y + rightRoom.h - 3);

  const leftBlocked = left.rooms.map(interiorOf);
  const rightBlocked = right.rooms.map(interiorOf);
  const leftDoor = { x: leftRoom.x + leftRoom.w - 1, y: leftY };
  const rightDoor = { x: rightRoom.x, y: rightY };
  const lp = routePath(left.grid, { x: leftDoor.x + 1, y: leftY }, { x: REGION_W - 2, y: leftY }, leftBlocked);
  const rp = routePath(right.grid, { x: 1, y: rightY }, { x: rightDoor.x - 1, y: rightY }, rightBlocked);
  if (!lp || !rp) return null;
  carvePath(left.grid, lp, leftBlocked);
  carvePath(right.grid, rp, rightBlocked);
  left.grid.set(leftDoor.x, leftDoor.y, T.DOORWAY);
  right.grid.set(rightDoor.x, rightDoor.y, T.DOORWAY);

  // Alinha as aberturas na fronteira
  const yLo = Math.min(leftY, rightY);
  const yHi = Math.max(leftY, rightY);
  for (let y = yLo; y <= yHi; y++) {
    left.grid.set(REGION_W - 1, y, T.FLOOR);
    right.grid.set(0, y, T.FLOOR);
    left.grid.set(REGION_W - 2, y, T.FLOOR);
    right.grid.set(1, y, T.FLOOR);
  }
  return {
    leftRoomId: leftRoom.id,
    rightRoomId: rightRoom.id,
    yLo,
    yHi,
    y: Math.round((yLo + yHi) / 2),
    leftDoor,
    rightDoor,
  };
}

// ---------------------------------------------------------------------------
// Quebra-cabeças
// ---------------------------------------------------------------------------

function buildPuzzles(worldRng, world) {
  const puzzles = [];
  const interactables = [];
  const notes = [];
  const sigils = [];
  const kinds = worldRng.shuffle(MECHANIC_KINDS);

  world.regions.forEach((region, regionIndex) => {
    const normal = region.rooms.filter((r) => !r.secret && r.role !== ROOM_ROLES.EXIT && r.role !== ROOM_ROLES.ENTRY);
    if (normal.length < 1) return;
    const kind = kinds[regionIndex % kinds.length];
    const rng = worldRng.fork(`pz-${regionIndex}`);
    const roomA = normal[0];
    const roomB = normal[Math.min(normal.length - 1, 1 + (regionIndex % Math.max(1, normal.length - 1)))] || normal[0];
    const puzzle = {
      id: `pz-${regionIndex}`,
      region: regionIndex,
      kind,
      roomIds: Array.from(new Set([roomA.id, roomB.id])),
      roomAId: roomA.id,
      roomBId: roomB.id,
      solved: false,
      progress: 0,
      clue: '',
      mechanismIds: [],
    };

    const add = (room, mechKind, label, extra = {}) => {
      const target = centerOf(room);
      const spot = freeFloorNear(region, room, target.x + region.offset.x, target.y, extra.exclude || null);
      const mech = {
        id: `m${regionIndex}-${interactables.length}`,
        kind: mechKind,
        label,
        gx: spot.gx,
        gy: spot.gy,
        x: (spot.gx + 0.5) * TILE_SIZE,
        y: (spot.gy + 0.5) * TILE_SIZE,
        roomId: room.id,
        region: regionIndex,
        puzzleId: puzzle.id,
        state: 0,
        ...extra,
      };
      delete mech.exclude;
      interactables.push(mech);
      puzzle.mechanismIds.push(mech.id);
      return mech;
    };

    if (kind === 'valvePair') {
      const a = add(roomA, 'valve', 'Válvula Alfa', { pair: 'a' });
      const b = add(roomB, 'valve', 'Válvula Beta', { pair: 'b', exclude: { gx: a.gx, gy: a.gy } });
      a.partner = b.id;
      b.partner = a.id;
      puzzle.clue = 'Duas válvulas, dois lugares. Gire-as quase ao mesmo tempo.';
      puzzle.window = 9000;
    } else if (kind === 'breakerOrder') {
      const order = rng.shuffle([0, 1, 2]);
      for (let i = 0; i < 3; i++) {
        add(roomA, 'breaker', `Disjuntor ${i + 1}`, { orderIndex: order[i], exclude: { gx: roomA.x + region.offset.x, gy: roomA.y } });
      }
      puzzle.clue = `A ordem dos disjuntores está rabiscada na parede: ${order.map((o) => o + 1).join(' → ')}.`;
      puzzle.order = order;
      notes.push({
        id: `note-clue-${regionIndex}`,
        title: 'Rabisco de Manutenção',
        text: `Os disjuntores da sala "${roomA.name}" só desarmam na ordem certa: ${order.map((o) => o + 1).join(', ')}. Se errar, recomece. A sala não gosta de pressa.`,
        gx: roomA.x + 1 + region.offset.x,
        gy: roomA.y + 1,
        region: regionIndex,
        roomId: roomA.id,
      });
    } else if (kind === 'holdLever') {
      const lever = add(roomA, 'lever', 'Alavanca de Contenção', { needsHeld: true });
      add(roomB, 'plate', 'Botão de Liberação', { needsPlayer: true, exclude: { gx: lever.gx, gy: lever.gy } });
      puzzle.clue = 'Alguém segura a alavanca. Alguém pisa no botão. Ao mesmo tempo.';
    } else if (kind === 'pressurePlates') {
      const p1 = add(roomA, 'plate', 'Placa de Pressão Alfa');
      const p2 = add(roomB, 'plate', 'Placa de Pressão Beta', { exclude: { gx: p1.gx, gy: p1.gy } });
      p1.partner = p2.id;
      p2.partner = p1.id;
      puzzle.clue = 'Duas placas. Duas pessoas. Simultâneas.';
    } else if (kind === 'keycard') {
      const reader = add(roomA, 'keycardReader', 'Leitor de Cartão');
      const locker = region.props.find((p) => p.interactive === 'locker' && !p.contains);
      const card = {
        id: `m${regionIndex}-keycard`,
        kind: 'keycardItem',
        label: 'Cartão Magnético',
        gx: locker ? locker.gx : reader.gx + 1,
        gy: locker ? locker.gy : reader.gy,
        x: 0,
        y: 0,
        roomId: locker ? locker.roomId : roomA.id,
        region: regionIndex,
        puzzleId: puzzle.id,
        hiddenIn: locker ? locker.id : null,
        visible: !locker,
      };
      card.x = (card.gx + 0.5) * TILE_SIZE;
      card.y = (card.gy + 0.5) * TILE_SIZE;
      if (locker) locker.contains = card.id;
      interactables.push(card);
      puzzle.mechanismIds.push(reader.id, card.id);
      puzzle.clue = 'Um cartão foi esquecido em algum armário desta região.';
    } else if (kind === 'silenceChoir') {
      add(roomA, 'bell', 'Sino de Chamada', { needsRitual: 3 });
      add(roomB, 'choirSeal', 'Selo do Coro', { exclude: { gx: roomA.x + region.offset.x, gy: roomA.y } });
      puzzle.clue = 'Toque o sino três vezes, sem pressa. O coro escuta a pressa.';
      puzzle.interval = 4000;
    }

    // Sigilo na câmara secreta (ou na sala B)
    const sigilRoom = region.rooms.find((r) => r.secret) || roomB;
    const rc = centerOf(sigilRoom);
    const spot = freeFloorNear(region, sigilRoom, rc.x + region.offset.x, rc.y);
    const sigil = {
      id: `sigil-${regionIndex}`,
      kind: 'sigil',
      name: `Sigilo ${ROMAN[regionIndex]}`,
      gx: spot.gx,
      gy: spot.gy,
      x: (spot.gx + 0.5) * TILE_SIZE,
      y: (spot.gy + 0.5) * TILE_SIZE,
      roomId: sigilRoom.id,
      region: regionIndex,
      puzzleId: puzzle.id,
      taken: false,
      carriedBy: null,
      delivered: false,
    };
    puzzle.sigilId = sigil.id;
    puzzle.sigilRoomId = sigilRoom.id;
    sigils.push(sigil);

    const note = region.theme.notes[regionIndex % region.theme.notes.length];
    notes.push({
      id: `note-${regionIndex}`,
      title: note.title,
      text: note.text,
      gx: roomB.x + 1 + region.offset.x,
      gy: roomB.y + roomB.h - 2,
      region: regionIndex,
      roomId: roomB.id,
    });

    const extraNote = region.theme.notes[(regionIndex + 1) % region.theme.notes.length];
    const extraRoom = region.rooms.find((r) => r.role === ROOM_ROLES.HUB) || normal[normal.length - 1];
    notes.push({
      id: `note-extra-${regionIndex}`,
      title: extraNote.title,
      text: extraNote.text,
      gx: extraRoom.x + extraRoom.w - 2 + region.offset.x,
      gy: extraRoom.y + 1,
      region: regionIndex,
      roomId: extraRoom.id,
    });

    puzzles.push(puzzle);
  });

  return { puzzles, interactables, notes, sigils };
}

/** Portões de fronteira + altar final. */
function buildGates(worldRng, world) {
  const gates = [];
  for (const link of world.links) {
    const idx = link.from;
    const y = Math.round((link.yLo + link.yHi) / 2);
    const cells = [];
    for (let yy = Math.min(link.yLo, y); yy <= Math.max(link.yHi, y + 1); yy++) {
      cells.push({ x: REGION_W - 1, y: yy, ox: link.from * REGION_W, oy: 0 });
      cells.push({ x: REGION_W, y: yy, ox: link.from * REGION_W, oy: 0 });
    }
    gates.push({
      id: `gate-${idx}`,
      region: link.to,
      cells,
      gx: link.from * REGION_W + REGION_W - 1,
      gy: y,
      w: 2,
      h: 2,
      open: false,
      kind: 'gate',
      label: `Portão ${GREEK[idx] || idx + 1}`,
      requirement: { type: 'sigils', count: idx + 1 },
      gateIndex: idx,
    });
  }

  const last = world.regions[world.regions.length - 1];
  const exitRoom = last.rooms.find((r) => r.role === ROOM_ROLES.EXIT) || last.rooms[last.rooms.length - 1];
  let altar = null;
  if (exitRoom) {
    const c = centerOf(exitRoom);
    const spot = freeFloorNear(last, exitRoom, c.x + last.offset.x, c.y);
    altar = {
      id: 'altar',
      kind: 'altar',
      label: 'O Limiar',
      gx: spot.gx,
      gy: spot.gy,
      x: (spot.gx + 0.5) * TILE_SIZE,
      y: (spot.gy + 0.5) * TILE_SIZE,
      roomId: exitRoom.id,
      region: last.index,
      puzzleId: null,
      requirement: { type: 'sigils', count: 4 },
      state: 0,
    };
  }
  return { gates, exitRoom, altar };
}

// ---------------------------------------------------------------------------
// Conectividade
// ---------------------------------------------------------------------------

function tileAt(world, gx, gy) {
  if (gx < 0 || gy < 0 || gx >= WORLD_W || gy >= WORLD_H) return T.WALL;
  const region = world.regions[Math.floor(gx / REGION_W)];
  if (!region) return T.WALL;
  return region.grid.get(gx - region.offset.x, gy);
}

function blockedSet(world, mode) {
  const blocked = new Set();
  if (mode === 'all-open') return blocked;
  for (const door of world.doors) {
    if (door.kind !== 'gate') continue;
    if (mode === 'gates-closed' || (mode === 'gate-state' && !door.open)) {
      for (const c of door.cells) blocked.add(`${c.x + c.ox},${c.y + c.oy}`);
    }
  }
  return blocked;
}

export function bfsReach(world, from, mode = 'all-open') {
  const blocked = blockedSet(world, mode);
  const seen = new Set();
  if (!WALKABLE_TILES.has(tileAt(world, from.x, from.y))) return seen;
  const startKey = `${from.x},${from.y}`;
  seen.add(startKey);
  const queue = [[from.x, from.y]];
  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    for (const d of DIRS4) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (!WALKABLE_TILES.has(tileAt(world, nx, ny))) continue;
      if (blocked.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

function roomReachable(reach, region, room) {
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      if (reach.has(`${x + region.offset.x},${y}`)) return true;
    }
  }
  return false;
}

export function validateConnectivity(world) {
  const openReach = bfsReach(world, world.spawn, 'all-open');
  const unreachable = [];
  for (const region of world.regions) {
    for (const room of region.rooms) {
      if (room.secret) continue; // testado à parte (pode falhar por design raro)
      if (!roomReachable(openReach, region, room)) unreachable.push(room.id);
    }
  }
  const secretReachable = world.regions.every((region) => {
    const secret = region.rooms.find((r) => r.secret);
    return !secret || roomReachable(openReach, region, secret);
  });
  const sigilsReachable = (world.sigils || []).every((sigil) => {
    const region = world.regions[sigil.region];
    return openReach.has(`${sigil.gx},${sigil.gy}`);
  });
  const interactablesReachable = (world.interactables || [])
    .filter((m) => m.kind !== 'keycardItem')
    .every((m) => openReach.has(`${m.gx},${m.gy}`) || WALKABLE_TILES.has(tileAt(world, m.gx, m.gy)));
  const lastRegion = world.regions[world.regions.length - 1];
  const exitRoom = lastRegion.rooms.find((r) => r.role === ROOM_ROLES.EXIT);
  const exitReachable = exitRoom ? roomReachable(openReach, lastRegion, exitRoom) : false;
  return {
    ok: unreachable.length === 0 && sigilsReachable && interactablesReachable && secretReachable && exitReachable,
    unreachable,
    exitReachable,
    secretReachable,
    sigilsReachable,
    interactablesReachable,
    reachableTiles: openReach.size,
  };
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export function generateWorld(seed) {
  const normalized = normalizeSeed(seed);
  const worldRng = new Rng(normalized);

  const nonThreshold = THEME_IDS.filter((t) => t !== 'threshold');
  const themes = worldRng.sample(nonThreshold, REGION_COUNT);
  if (worldRng.chance(0.35)) themes[REGION_COUNT - 1] = 'threshold';

  const regions = [];
  for (let i = 0; i < REGION_COUNT; i++) {
    const rng = worldRng.fork(`region-${i}`);
    regions.push(generateRegion(rng, i, themes[i], { isLast: i === REGION_COUNT - 1 }));
  }

  const world = {
    seed: normalized,
    regions,
    regionW: REGION_W,
    regionH: REGION_H,
    worldW: WORLD_W,
    worldH: WORLD_H,
    tileSize: TILE_SIZE,
    revision: 0,
    doors: [],
    interactables: [],
    puzzles: [],
    notes: [],
    sigils: [],
    lights: [],
    props: [],
    links: [],
  };

  const linkRng = worldRng.fork('links');
  for (let i = 0; i < REGION_COUNT - 1; i++) {
    const link = connectRegions(linkRng, regions[i], regions[i + 1]);
    if (!link) throw new Error(`Falha ao conectar regiões ${i}/${i + 1} (seed ${normalized})`);
    world.links.push({ ...link, from: i, to: i + 1 });
  }
  for (const link of world.links) {
    const left = regions[link.from];
    const right = regions[link.to];
    for (let y = link.yLo - 1; y <= link.yHi + 1; y++) {
      if (left.grid.get(REGION_W - 1, y) === T.WATER) left.grid.set(REGION_W - 1, y, T.FLOOR);
      if (right.grid.get(0, y) === T.WATER) right.grid.set(0, y, T.FLOOR);
    }
  }

  let doorId = 0;
  for (const region of regions) {
    for (const door of region.doors) world.doors.push({ ...door, id: `d${doorId++}` });
  }

  const puzzleData = buildPuzzles(worldRng.fork('puzzles'), world);
  world.puzzles = puzzleData.puzzles;
  world.interactables = puzzleData.interactables;
  world.notes = puzzleData.notes;
  world.sigils = puzzleData.sigils;

  const gateData = buildGates(worldRng.fork('gates'), world);
  world.doors.push(...gateData.gates);
  world.exitRoom = gateData.exitRoom;
  world.altar = gateData.altar;
  if (world.altar) world.interactables.push(world.altar);

  const entryRoom = regions[0].rooms.find((r) => r.role === ROOM_ROLES.ENTRY) || regions[0].rooms[0];
  if (!entryRoom) throw new Error(`Mundo sem sala de entrada (seed ${normalized})`);
  const entryCenter = centerOf(entryRoom);
  const spawnSpot = freeFloorNear(regions[0], entryRoom, entryCenter.x + regions[0].offset.x, entryCenter.y);
  world.spawn = { x: spawnSpot.gx, y: spawnSpot.gy, region: 0 };
  if (!gateData.exitRoom) throw new Error(`Mundo sem sala de saída (seed ${normalized})`);

  world.lights = regions.flatMap((r) => r.lights);
  world.props = regions.flatMap((r) => r.props);

  world.validation = validateConnectivity(world);
  if (!world.validation.ok) {
    throw new Error(`Mundo inválido (seed ${normalized}): ${JSON.stringify(world.validation)}`);
  }

  world.hash = stableHash({
    seed: normalized,
    rooms: regions.map((r) => r.rooms.map((room) => [room.id, room.x, room.y, room.w, room.h, room.themeId, room.role])),
    doors: world.doors.map((d) => [d.gx, d.gy, d.w, d.h, d.kind]),
    puzzles: world.puzzles.map((p) => [p.id, p.kind, p.roomIds]),
  });

  return world;
}

export function generateValidWorld(seed, maxAttempts = 16) {
  const base = normalizeSeed(seed);
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const trySeed = attempt === 0 ? base : `${base}:${attempt * 7919}`;
    try {
      return generateWorld(trySeed);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`Não foi possível gerar o mundo para ${base}`);
}

// ---------------------------------------------------------------------------
// Serialização
// ---------------------------------------------------------------------------

export function encodeGrid(grid) {
  const out = [];
  let current = grid.tiles[0];
  let count = 0;
  for (let i = 0; i < grid.tiles.length; i++) {
    const v = grid.tiles[i];
    if (v === current) count++;
    else {
      out.push([current, count]);
      current = v;
      count = 1;
    }
  }
  out.push([current, count]);
  return out;
}

export function decodeGrid(rle, w, h) {
  const tiles = new Uint8Array(w * h);
  let i = 0;
  for (const [value, count] of rle) {
    for (let k = 0; k < count; k++) tiles[i++] = value;
  }
  return tiles;
}

/** Grid local de uma região com a mesma interface usada pela física (get/set/inside). */
class LocalGrid {
  constructor(tiles, w, h) {
    this.tiles = tiles;
    this.w = w;
    this.h = h;
  }
  idx(x, y) {
    return y * this.w + x;
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    if (!this.inside(x, y)) return T.WALL;
    return this.tiles[this.idx(x, y)];
  }
  set(x, y, v) {
    if (!this.inside(x, y)) return;
    this.tiles[this.idx(x, y)] = v;
  }
}

/**
 * Reconstrói um mundo "jogável" a partir do payload serializado recebido pela
 * rede. O cliente precisa disso porque a predição local executa o MESMO módulo
 * de física do servidor (`shared/sim/physics.js`, via `tileOfWorld`), que opera
 * sobre grids com `get()`, e no payload eles viajam comprimidos em RLE.
 *
 * O resultado é compatível com o formato retornado por `generateWorld`, sem
 * duplicar o estado dinâmico (portas, sigilos, puzzles vivem no `shared`).
 */
export function hydrateWorld(payload) {
  if (!payload || !Array.isArray(payload.regions)) return payload;
  const regionW = payload.regionW || REGION_W;
  const regionH = payload.regionH || REGION_H;
  const regions = payload.regions.map((region) => {
    const grid = new LocalGrid(
      Array.isArray(region.grid) ? decodeGrid(region.grid, regionW, regionH) : new Uint8Array(regionW * regionH),
      regionW,
      regionH,
    );
    return {
      ...region,
      index: region.index,
      themeId: region.themeId,
      offset: { x: region.ox || 0, y: region.oy || 0 },
      ox: region.ox || 0,
      oy: region.oy || 0,
      grid,
      rooms: region.rooms || [],
      props: region.props || [],
      lights: region.lights || [],
    };
  });
  return {
    ...payload,
    regions,
    regionW,
    regionH,
    worldW: payload.worldW || regionW * regions.length,
    worldH: payload.worldH || regionH,
    tileSize: payload.tileSize || TILE_SIZE,
    doors: payload.doors || [],
    props: regions.flatMap((r) => r.props),
    lights: regions.flatMap((r) => r.lights),
    puzzles: payload.puzzles || [],
    interactables: payload.interactables || [],
    notes: payload.notes || [],
    sigils: payload.sigils || [],
    links: payload.links || [],
  };
}

/**
 * Aplica o estado de portas recebido do servidor ao grid local do cliente.
 *
 * Portões (`kind === 'gate'`) são resolvidos pela própria física (o servidor é
 * a fonte de verdade de `open`); portas internas fechadas viram parede no grid
 * local, para que a predição não atravesse uma porta que o servidor considera
 * fechada.
 */
export function applyDoorStates(world, states) {
  if (!world || !Array.isArray(states)) return;
  const byId = new Map((world.doors || []).map((d) => [d.id, d]));
  // O servidor envia apenas as portas fechadas; as internas ausentes estão
  // abertas (senão uma porta reaberta por outro jogador ficaria sólida aqui).
  for (const door of world.doors || []) {
    if (door.kind === 'gate' || door.open) continue;
    door.open = true;
    for (const cell of door.cells || []) {
      const region = world.regions[Math.floor((cell.x + (cell.ox || 0)) / REGION_W)];
      if (region?.grid?.get && region.grid.get(cell.x, cell.y) === T.WALL) region.grid.set(cell.x, cell.y, T.DOORWAY);
    }
  }
  for (const st of states) {
    const door = byId.get(st.id);
    if (!door) continue;
    door.open = !!st.open;
    if (door.kind === 'gate') continue;
    for (const cell of door.cells || []) {
      const ox = cell.ox || 0;
      const region = world.regions[Math.floor((cell.x + ox) / REGION_W)];
      if (!region?.grid?.set) continue;
      const current = region.grid.get(cell.x, cell.y);
      if (door.open) {
        if (current === T.WALL) region.grid.set(cell.x, cell.y, T.DOORWAY);
      } else if (current === T.DOORWAY) {
        region.grid.set(cell.x, cell.y, T.WALL);
      }
    }
  }
}

export function serializeWorld(world) {
  return {
    seed: world.seed,
    hash: world.hash,
    regionW: world.regionW,
    regionH: world.regionH,
    worldW: world.worldW,
    worldH: world.worldH,
    tileSize: world.tileSize,
    spawn: world.spawn,
    exitRoomId: world.exitRoom ? world.exitRoom.id : null,
    regions: world.regions.map((region) => ({
      index: region.index,
      themeId: region.themeId,
      name: region.name,
      ox: region.offset.x,
      oy: 0,
      grid: encodeGrid(region.grid),
      rooms: region.rooms.map((r) => ({
        id: r.id,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        name: r.name,
        role: r.role,
        themeId: r.hiddenThemeId || r.themeId,
        secret: !!r.secret,
        hasPool: !!r.hasPool,
      })),
      props: region.props.map((p) => ({
        id: p.id,
        kind: p.kind,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        blocks: p.blocks,
        interactive: p.interactive,
        gx: p.gx,
        gy: p.gy,
        roomId: p.roomId,
        contains: p.contains || null,
      })),
      lights: region.lights.map((l) => ({
        x: l.x,
        y: l.y,
        radius: l.radius,
        intensity: l.intensity,
        flicker: l.flicker,
        color: l.color,
      })),
    })),
    doors: world.doors.map((d) => ({
      id: d.id,
      region: d.region,
      gx: d.gx,
      gy: d.gy,
      w: d.w,
      h: d.h,
      cells: d.cells.map((c) => ({ x: c.x, y: c.y, ox: c.ox, oy: c.oy })),
      kind: d.kind,
      open: d.open,
      label: d.label || null,
      requirement: d.requirement || null,
    })),
    puzzles: world.puzzles.map((p) => ({
      id: p.id,
      region: p.region,
      kind: p.kind,
      roomIds: p.roomIds,
      roomAId: p.roomAId,
      roomBId: p.roomBId,
      clue: p.clue,
      sigilId: p.sigilId,
      sigilRoomId: p.sigilRoomId,
      window: p.window || null,
      order: p.order || null,
      interval: p.interval || null,
    })),
    interactables: world.interactables.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      gx: m.gx,
      gy: m.gy,
      x: m.x,
      y: m.y,
      puzzleId: m.puzzleId || null,
      region: m.region,
      roomId: m.roomId,
      visible: m.visible !== false,
      hiddenIn: m.hiddenIn || null,
      needsHeld: !!m.needsHeld,
      needsPlayer: !!m.needsPlayer,
      needsRitual: m.needsRitual || 0,
      requirement: m.requirement || null,
      partner: m.partner || null,
    })),
    notes: world.notes.map((n) => ({
      id: n.id,
      title: n.title,
      text: n.text,
      gx: n.gx,
      gy: n.gy,
      region: n.region,
      roomId: n.roomId,
    })),
    sigils: world.sigils.map((s) => ({
      id: s.id,
      gx: s.gx,
      gy: s.gy,
      roomId: s.roomId,
      region: s.region,
      puzzleId: s.puzzleId,
      name: s.name,
    })),
    altar: world.altar
      ? { id: world.altar.id, gx: world.altar.gx, gy: world.altar.gy, requirement: world.altar.requirement }
      : null,
    links: world.links.map((l) => ({ from: l.from, to: l.to, y: l.y, yLo: l.yLo, yHi: l.yHi })),
    validation: world.validation,
  };
}

export const WorldConstants = { REGION_W, REGION_H, WORLD_W, WORLD_H, TILE_SIZE, REGION_COUNT, TILE: T };

export { centerOf, distRects, tileAt, themeFor };
