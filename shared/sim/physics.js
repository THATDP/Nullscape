/**
 * NULLSCAPE — Física compartilhada (autoritativa no servidor, preditiva no cliente).
 *
 * O servidor valida cada passo usando exatamente as mesmas funções que o
 * cliente usa para predição. Isso evita "correção fantasma": se a predição
 * local e a simulação do servidor usarem o mesmo código + mesmos inputs,
 * o resultado converge.
 *
 * Unidades: tiles internamente, pixels na fronteira de rede.
 */

import { WALKABLE_TILES, REGION_W, REGION_H } from '../world/generator.js';
import { T } from '../world/themes.js';

export const TILE_SIZE = 32;

/** Velocidades em pixels por segundo. */
export const SPEED_WALK = 3.2 * TILE_SIZE; // ~102 px/s
export const SPEED_RUN = 5.6 * TILE_SIZE; // ~179 px/s
export const ACCEL = 14;
export const FRICTION = 12;
export const RADIUS = 11; // pixels
const EMPTY_GATES = [];

/** Custo de tempo (segundos) para atravessar um tile de água. */
export const WATER_SLOW = 0.45;

export function isWalkableWorld(world, gx, gy) {
  if (gx < 0 || gy < 0 || gx >= world.worldW || gy >= world.worldH) return false;
  const region = world.regions[Math.floor(gx / REGION_W)];
  if (!region) return false;
  const tile = region.grid.get(gx - region.offset.x, gy);
  return WALKABLE_TILES.has(tile);
}

export function tileOfWorld(world, gx, gy) {
  if (gx < 0 || gy < 0 || gx >= world.worldW || gy >= world.worldH) return T.WALL;
  const region = world.regions[Math.floor(gx / REGION_W)];
  if (!region) return T.WALL;
  return region.grid.get(gx - region.offset.x, gy);
}

/** Lista de portões do mundo, cacheada (a física roda a 20 Hz por jogador). */
function gateList(world) {
  if (!world.doors) return EMPTY_GATES;
  if (world._gateList && world._gateListSrc === world.doors) return world._gateList;
  const list = world.doors.filter((d) => d.kind === 'gate');
  world._gateList = list;
  world._gateListSrc = world.doors;
  return list;
}

/** Retângulo (tiles) ocupado por um portão fechado — calculado uma vez. */
function gateRect(door) {
  if (door._rect) return door._rect;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of door.cells || []) {
    const gx = cell.x + (cell.ox || 0);
    const gy = cell.y + (cell.oy || 0);
    if (gx < minX) minX = gx;
    if (gy < minY) minY = gy;
    if (gx > maxX) maxX = gx;
    if (gy > maxY) maxY = gy;
  }
  if (!Number.isFinite(minX)) return null;
  door._rect = { gx: minX, gy: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  return door._rect;
}

/** Um círculo (centro px) colide com alguma parede/prop? */
export function circleBlocked(world, px, py, radius = RADIUS, blockers = null) {
  const minX = Math.floor((px - radius) / TILE_SIZE);
  const maxX = Math.floor((px + radius) / TILE_SIZE);
  const minY = Math.floor((py - radius) / TILE_SIZE);
  const maxY = Math.floor((py + radius) / TILE_SIZE);
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const tile = tileOfWorld(world, gx, gy);
      if (WALKABLE_TILES.has(tile)) continue;
      // colisão círculo vs AABB do tile
      const closestX = Math.max(gx * TILE_SIZE, Math.min(px, (gx + 1) * TILE_SIZE));
      const closestY = Math.max(gy * TILE_SIZE, Math.min(py, (gy + 1) * TILE_SIZE));
      if ((px - closestX) ** 2 + (py - closestY) ** 2 < radius * radius) return true;
    }
  }
  // Portões fechados bloqueiam — inclusive no cliente, que não muta o grid.
  const gates = gateList(world);
  for (let i = 0; i < gates.length; i++) {
    const door = gates[i];
    if (door.open) continue;
    const rect = gateRect(door);
    if (!rect) continue;
    const bx = rect.gx * TILE_SIZE;
    const by = rect.gy * TILE_SIZE;
    const closestX = Math.max(bx, Math.min(px, bx + rect.w * TILE_SIZE));
    const closestY = Math.max(by, Math.min(py, by + rect.h * TILE_SIZE));
    if ((px - closestX) ** 2 + (py - closestY) ** 2 < radius * radius) return true;
  }
  if (blockers) {
    for (const b of blockers) {
      const bx = b.gx * TILE_SIZE;
      const by = b.gy * TILE_SIZE;
      const bw = b.w * TILE_SIZE;
      const bh = b.h * TILE_SIZE;
      const closestX = Math.max(bx, Math.min(px, bx + bw));
      const closestY = Math.max(by, Math.min(py, by + bh));
      if ((px - closestX) ** 2 + (py - closestY) ** 2 < radius * radius) return true;
    }
  }
  return false;
}

/** Separador de eixos (X, Y) — permite deslizar em paredes. */
export function tryMove(world, px, py, dx, dy, radius = RADIUS, blockers = null) {
  let nx = px;
  let ny = py;
  if (dx !== 0) {
    const cx = nx + dx;
    if (!circleBlocked(world, cx, ny, radius, blockers)) nx = cx;
    else {
      // movimento parcial até tocar
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const t = (dx * i) / steps;
        if (!circleBlocked(world, nx + t, ny, radius, blockers)) nx += dx / steps;
        else break;
      }
    }
  }
  if (dy !== 0) {
    const cy = ny + dy;
    if (!circleBlocked(world, nx, cy, radius, blockers)) ny = cy;
    else {
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const t = (dy * i) / steps;
        if (!circleBlocked(world, nx, ny + t, radius, blockers)) ny += dy / steps;
        else break;
      }
    }
  }
  return { x: nx, y: ny };
}

/**
 * Integra um passo de movimento com aceleração e colisão.
 * @param {{x:number,y:number,vx:number,vy:number}} state posição/velocidade em px
 * @param {{dx:number,dy:number,run:boolean}} input vetor normalizado + correr
 * @param {number} dt segundos
 */
export function stepMovement(world, state, input, dt, blockers = null) {
  const maxSpeed = input.run ? SPEED_RUN : SPEED_WALK;
  const targetVx = input.dx * maxSpeed;
  const targetVy = input.dy * maxSpeed;
  const accel = ACCEL * dt;
  state.vx += (targetVx - state.vx) * Math.min(1, accel);
  state.vy += (targetVy - state.vy) * Math.min(1, accel);
  if (input.dx === 0 && input.dy === 0) {
    const f = Math.max(0, 1 - FRICTION * dt);
    state.vx *= f;
    state.vy *= f;
  }
  // limita velocidade (anti-cheat: nunca acima do máximo)
  const speed = Math.hypot(state.vx, state.vy);
  const hardCap = maxSpeed * 1.02;
  if (speed > hardCap) {
    state.vx = (state.vx / speed) * hardCap;
    state.vy = (state.vy / speed) * hardCap;
  }
  const moved = tryMove(world, state.x, state.y, state.vx * dt, state.vy * dt, RADIUS, blockers);
  state.x = moved.x;
  state.y = moved.y;
  return state;
}

/** Interpolação suave de um corpo remoto entre snapshots. */
export function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Posição em tile (inteiro) a partir de pixels. */
export function tileOfPixel(px, py) {
  return { gx: Math.floor(px / TILE_SIZE), gy: Math.floor(py / TILE_SIZE) };
}

/** Centro de um tile em pixels. */
export function pixelOfTile(gx, gy) {
  return { x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE };
}

/** Verifica se dois pontos estão a menos de `tiles` de distância. */
export function withinTiles(ax, ay, bx, by, tiles) {
  return Math.hypot(ax - bx, ay - by) <= tiles * TILE_SIZE;
}

/** Codifica direção em 8 setores (para envio econômico pela rede). */
export function dirSector(vx, vy) {
  if (vx === 0 && vy === 0) return -1;
  const angle = Math.atan2(vy, vx);
  return Math.round(((angle + Math.PI) / (Math.PI * 2)) * 7) % 8;
}

/** Cache de colisão para props bloqueantes por região (acelera o servidor). */
export function buildBlockers(world) {
  const props = world.props || [];
  return props.filter((p) => p.blocks).map((p) => ({ gx: p.gx, gy: p.gy, w: p.w, h: p.h, roomId: p.roomId }));
}
