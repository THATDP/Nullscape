/**
 * NULLSCAPE — Renderização do mundo.
 *
 * Estratégia de desempenho:
 *  - o mapa inteiro é desenhado UMA VEZ em um RenderTexture por região (tiles).
 *  - props e portas são Sprites estáticas agrupadas por região.
 *  - apenas entidades vivas (jogadores, criaturas, luzes) atualizam por frame.
 *  - regiões distantes não recebem atualização (culling manual).
 */

import Phaser from 'phaser';
import { TILE, THEMES } from '../../../shared/world/themes.js';
import { TS } from './art.js';

export class WorldView {
  constructor(scene, worldData) {
    this.scene = scene;
    this.data = worldData;
    this.tileSize = TS;
    this.regionLayers = new Map();
    this.doorSprites = new Map();
    this.propSprites = new Map();
    this.interactSprites = new Map();
    this.built = false;
  }

  /** Decodifica um grid RLE em Uint8Array. */
  static decode(rle, w, h) {
    const tiles = new Uint8Array(w * h);
    let i = 0;
    for (const [value, count] of rle) {
      for (let k = 0; k < count; k++) tiles[i++] = value;
    }
    return tiles;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const scene = this.scene;
    const { worldW, worldH, tileSize } = this.data;

    this.baseLayer = scene.add.container(0, 0).setDepth(0);
    this.propLayer = scene.add.container(0, 0).setDepth(6);
    this.doorLayer = scene.add.container(0, 0).setDepth(5);
    this.interactLayer = scene.add.container(0, 0).setDepth(7);

    for (const region of this.data.regions) {
      this.buildRegion(region);
    }
    this.buildDoors();
    this.buildProps();
    this.buildInteractables();
    void worldW;
    void worldH;
    void tileSize;
  }

  buildRegion(region) {
    const scene = this.scene;
    const theme = THEMES[region.themeId] || THEMES.threshold;
    const w = this.data.regionW;
    const h = this.data.regionH;
    const tiles = WorldView.decode(region.grid, w, h);
    const offsetX = region.ox * TS;

    // RenderTexture por região (menos draw calls)
    const rt = scene.add.renderTexture(offsetX, 0, w * TS, h * TS).setOrigin(0, 0).setDepth(1);
    const key = `floor-${region.themeId}`;
    const wallKeys = [`wall-${region.themeId}-0`, `wall-${region.themeId}-1`, `wall-${region.themeId}-2`];
    const waterKey = `water-${region.themeId}`;
    const doorKey = `door-${region.themeId}`;
    const obstacleKey = `obstacle-${region.themeId}`;

    // desenha em lotes por textura para eficiência
    const batches = { floor: [], wall0: [], wall1: [], wall2: [], water: [], door: [], obstacle: [] };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y * w + x];
        const px = x * TS;
        const py = y * TS;
        if (t === T.FLOOR) batches.floor.push([px, py]);
        else if (t === T.WALL) {
          const v = (x * 7 + y * 13 + region.index) % 3;
          batches[`wall${v}`].push([px, py]);
        } else if (t === T.WATER) batches.water.push([px, py]);
        else if (t === T.DOORWAY) batches.door.push([px, py]);
        else if (t === T.OBSTACLE) batches.obstacle.push([px, py]);
        else if (t === T.VOID) batches.floor.push([px, py]);
      }
    }
    const stamp = (keyName, list) => {
      for (const [px, py] of list) rt.draw(keyName, px, py);
    };
    stamp(key, batches.floor);
    stamp(obstacleKey, batches.obstacle);
    stamp(doorKey, batches.door);
    stamp(waterKey, batches.water);
    stamp(wallKeys[0], batches.wall0);
    stamp(wallKeys[1], batches.wall1);
    stamp(wallKeys[2], batches.wall2);

    // vinheta de região (gradiente suave nas bordas) — sensação de estar "dentro"
    const mask = scene.add.graphics();
    mask.fillStyle(theme.palette.wallShadow, 0.12);
    mask.fillRect(0, 0, w * TS, 6);
    mask.fillRect(0, h * TS - 6, w * TS, 6);
    mask.setDepth(2).setPosition(offsetX, 0);
    this.baseLayer.add([rt, mask]);

    // portas decorativas (linhas de luz) por região — sprites estáticas
    this.regionLayers.set(region.index, { rt, mask, tiles });
  }

  buildDoors() {
    const scene = this.scene;
    for (const door of this.data.doors) {
      if (door.kind === 'gate') continue;
      // um sprite único central para a porta (abre/fecha)
      const cx = (door.gx + door.w / 2) * TS;
      const cy = (door.gy + door.h / 2) * TS;
      const themeId = this.themeAt(door.gx, door.gy);
      const doorsprite = scene.add
        .rectangle(cx, cy, Math.max(door.w, 1) * TS, Math.max(door.h, 1) * TS, THEMES[themeId].palette.trim, 0.16)
        .setDepth(4);
      const edge = scene.add
        .rectangle(cx, cy, Math.max(door.w, 1) * TS, 2, THEMES[themeId].palette.glow, 0.22)
        .setDepth(4);
      this.doorSprites.set(door.id, { rect: doorsprite, edge, door });
    }
    // portões: render distintos
    for (const door of this.data.doors) {
      if (door.kind !== 'gate') continue;
      const cx = (door.gx + 1) * TS;
      const cy = (door.gy + 1) * TS;
      const g = scene.add.graphics().setDepth(8);
      g.fillStyle(0x1b1f23, 0.95);
      g.fillRect(cx - TS, cy - TS, TS * 2, TS * 2);
      g.lineStyle(1.5, 0xd8cf9a, 0.5);
      g.strokeRect(cx - TS, cy - TS, TS * 2, TS * 2);
      // sigilos exigidos
      const count = door.requirement?.count || 0;
      for (let i = 0; i < count; i++) {
        const angle = (i / Math.max(1, count)) * Math.PI * 2;
        const px = cx + Math.cos(angle) * 14;
        const py = cy + Math.sin(angle) * 14;
        g.fillStyle(0xd8cf9a, 0.25);
        g.save();
        g.translateCanvas(px, py);
        g.rotateCanvas(Math.PI / 4);
        g.fillRect(-3, -3, 6, 6);
        g.restore();
      }
      const label = scene.add
        .text(cx, cy - TS - 6, door.label || 'Portão', {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '9px',
          color: '#8a8779',
          letterSpacing: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(9);
      this.doorSprites.set(door.id, { graphics: g, label, door });
    }
  }

  themeAt(gx, gy) {
    const idx = Math.floor(gx / this.data.regionW);
    return this.data.regions[idx]?.themeId || 'threshold';
  }

  buildProps() {
    const scene = this.scene;
    for (const region of this.data.regions) {
      const theme = THEMES[region.themeId] || THEMES.threshold;
      for (const prop of region.props) {
        const key = `prop-${prop.kind}`;
        if (!scene.textures.exists(key)) continue;
        const w = prop.w * TS;
        const h = prop.h * TS;
        const sprite = scene.add
          .image(prop.gx * TS + w / 2, prop.gy * TS + h / 2, key)
          .setDisplaySize(w, h)
          .setDepth(prop.blocks ? 7 : 6);
        sprite.setAlpha(0.96);
        // sombra projetada para dar volume
        if (prop.blocks) {
          const shadow = scene.add
            .ellipse(prop.gx * TS + w / 2, prop.gy * TS + h - 2, w * 0.9, h * 0.35, 0x000000, 0.25)
            .setDepth(5);
          this.propLayer.add(shadow);
        }
        this.propSprites.set(prop.id, sprite);
        this.propLayer.add(sprite);
        void theme;
      }
    }
  }

  buildInteractables() {
    const scene = this.scene;
    const items = [
      ...(this.data.interactables || []),
      ...(this.data.sigils || []).map((s) => ({ ...s, visible: false })),
      ...(this.data.notes || []).map((n) => ({ ...n, visible: true })),
    ];
    for (const item of items) {
      // Sigilos nascem invisíveis, mas o sprite PRECISA existir: revelar é só
      // alternar visibilidade (setSigilVisible). Antes eram descartados aqui e
      // o jogador nunca via o sigilo — item central da progressão.
      if (!item.visible && item.kind !== 'keycardItem' && item.kind !== 'sigil') continue;
      let sprite = null;
      if (item.kind === 'sigil') {
        sprite = scene.add.image((item.gx + 0.5) * TS, (item.gy + 0.5) * TS, 'prop-sigil');
        scene.tweens.add({ targets: sprite, alpha: { from: 0.35, to: 0.95 }, duration: 1800, yoyo: true, repeat: -1 });
      } else if (item.kind === 'note') {
        sprite = scene.add.image((item.gx + 0.5) * TS, (item.gy + 0.5) * TS, 'prop-note').setScale(0.8);
      } else if (item.kind === 'keycardReader') {
        sprite = scene.add.image((item.gx + 0.5) * TS, (item.gy + 0.5) * TS, 'prop-breaker').setScale(0.85);
      } else if (!['sigil', 'note', 'keycardReader'].includes(item.kind)) {
        // Nem todo mecanismo tem desenho próprio (keycardItem, por exemplo):
        // cai no marcador genérico em vez de criar um sprite sem textura.
        const propKey = `prop-${item.kind}`;
        sprite = scene.add.image(
          (item.gx + 0.5) * TS,
          (item.gy + 0.5) * TS,
          scene.textures.exists(propKey) ? propKey : 'prop-breaker',
        );
        if (item.kind === 'altar') {
          const glow = scene.add.image((item.gx + 0.5) * TS, (item.gy + 0.5) * TS, 'glow').setScale(1.6).setAlpha(0.16).setTint(0xd8cf9a);
          this.interactLayer.add(glow);
        }
      }
      if (sprite) {
        sprite.setDepth(8);
        if (item.kind === 'sigil' || item.kind === 'keycardItem') sprite.setVisible(!!item.visible);
        this.interactLayer.add(sprite);
        this.interactSprites.set(item.id, sprite);
      }
    }
  }

  /** Atualiza visual de portas conforme estado do servidor. */
  applyDoorState(states) {
    for (const st of states) {
      const entry = this.doorSprites.get(st.id);
      if (!entry) continue;
      if (entry.rect) {
        entry.rect.setAlpha(st.open ? 0.12 : 0.55);
        entry.edge.setAlpha(st.open ? 0.22 : 0.9);
        if (entry.hidden) entry.hidden = null;
      }
      if (entry.graphics) {
        entry.graphics.setAlpha(st.open ? 0.12 : 1);
        entry.label?.setAlpha(st.open ? 0.25 : 0.9);
      }
    }
  }

  setSigilVisible(sigilId, visible) {
    const sprite = this.interactSprites.get(sigilId);
    if (sprite) sprite.setVisible(visible);
  }

  setInteractableVisibility(itemId, visible) {
    const sprite = this.interactSprites.get(itemId);
    if (sprite) sprite.setVisible(visible);
  }

  /** Porta "desaparecida" (anomalia). */
  hideDoor(doorId, hidden) {
    const entry = this.doorSprites.get(doorId);
    if (!entry) return;
    if (entry.rect) entry.rect.setAlpha(hidden ? 0 : 0.55);
    if (entry.edge) entry.edge.setAlpha(hidden ? 0 : 0.22);
    if (entry.graphics) entry.graphics.setAlpha(hidden ? 0 : 1);
  }

  /** Projeta uma anomalia visual na região. */
  regionOverlay(regionIndex, color, alpha, duration) {
    const layer = this.regionLayers.get(regionIndex);
    if (!layer) return;
    const scene = this.scene;
    const overlay = scene.add
      .rectangle(layer.rt.x, 0, this.data.regionW * TS, this.data.regionH * TS, color, alpha)
      .setOrigin(0, 0)
      .setDepth(3);
    scene.tweens.add({
      targets: overlay,
      alpha: 0,
      duration,
      onComplete: () => overlay.destroy(),
    });
  }

  destroy() {
    this.propSprites.clear();
    this.doorSprites.clear();
    this.interactSprites.clear();
    this.regionLayers.clear();
  }
}
