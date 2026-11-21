/**
 * NULLSCAPE — Arte procedural.
 *
 * Nenhum asset externo: cada tile, móvel, criatura e efeito é desenhado em
 * canvas na inicialização (texturas geradas) ou a cada frame (formas vivas).
 *
 * Direção de arte:
 *  - perspectiva oblíqua "top-down 3/4": paredes têm uma faixa superior clara
 *    (como uma planta baixa iluminada de cima) e sombra projetada para baixo;
 *  - paletas dessaturadas com um único acento doente por ambiente;
 *  - contornos finos, texturas de ruído, poças, manchas, juntas de piso.
 */

import { THEMES, TILE } from '../../../shared/world/themes.js';

export const TS = 32;

// ---------------------------------------------------------------------------
// Utilidades de desenho
// ---------------------------------------------------------------------------

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') return ctx.roundRect(x, y, w, h, r);
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}
function rgbStr(r, g, b, a = 1) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
  return rgbStr(f(r), f(g), f(b));
}
export function cssColor(hex) {
  return `rgb(${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff})`;
}
function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return rgbStr(r, g, b, alpha);
}

/** Cria uma textura de canvas e registra no Phaser. */
function makeTexture(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const canvas = scene.textures.createCanvas(key, w, h);
  const ctx = canvas.getContext();
  draw(ctx, w, h);
  canvas.refresh();
}

// ---------------------------------------------------------------------------
// Chão
// ---------------------------------------------------------------------------

function drawFloor(ctx, w, h, palette, pattern, seed) {
  const rnd = mulberry(seed);
  ctx.fillStyle = cssColor(palette.floor);
  ctx.fillRect(0, 0, w, h);

  // variação por tile
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 0.6 + rnd() * 2.4;
    ctx.fillStyle = rgba(palette.floorAlt, 0.25 + rnd() * 0.35);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  switch (pattern) {
    case 'carpet': {
      // trama de carpete
      ctx.strokeStyle = rgba(palette.carpet, 0.55);
      ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 2) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(palette.carpet, 0.3);
      for (let x = 0; x < w; x += 3) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      break;
    }
    case 'tile': {
      ctx.strokeStyle = rgba(palette.wallShadow, 0.35);
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
      // brilho de azulejo
      ctx.fillStyle = rgba(0xffffff, 0.035);
      ctx.fillRect(0, 0, w, 2);
      break;
    }
    case 'concrete': {
      ctx.strokeStyle = rgba(palette.wallShadow, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h - 0.5);
      ctx.lineTo(w, h - 0.5);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = rgba(palette.carpet, 0.3);
        ctx.beginPath();
        const sx = rnd() * w;
        const sy = rnd() * h;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (rnd() - 0.5) * 12, sy + (rnd() - 0.5) * 12);
        ctx.stroke();
      }
      break;
    }
    case 'linoleum': {
      ctx.strokeStyle = rgba(palette.wallShadow, 0.4);
      for (let x = 0; x <= w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(palette.trim, 0.045);
      ctx.fillRect(0, h * 0.5, w, 1);
      break;
    }
    case 'metal': {
      ctx.strokeStyle = rgba(palette.wallShadow, 0.5);
      for (let x = 0; x <= w; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      // rebites
      ctx.fillStyle = rgba(palette.trim, 0.4);
      for (let x = 4; x < w; x += 16) {
        for (let y = 4; y < h; y += 16) ctx.fillRect(x, y, 1, 1);
      }
      break;
    }
    case 'wood': {
      ctx.strokeStyle = rgba(palette.wallShadow, 0.4);
      for (let y = 8; y < h; y += 10) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(palette.floorAlt, 0.5);
      for (let i = 0; i < 5; i++) {
        const y = rnd() * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + 1.5, w * 0.6, y - 1.5, w, y);
        ctx.stroke();
      }
      break;
    }
    default: {
      ctx.strokeStyle = rgba(palette.wallShadow, 0.25);
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    }
  }

  // desgaste
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rgba(0, 0, 0, 0.06 + rnd() * 0.08);
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rnd() * 6, 1 + rnd() * 4, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Paredes
// ---------------------------------------------------------------------------

function drawWall(ctx, w, h, palette, themeId, variant) {
  const rnd = mulberry(variant * 977 + 13);
  // corpo da parede
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, shade(palette.wall, 0.02));
  grad.addColorStop(0.5, cssColor(palette.wall));
  grad.addColorStop(1, shade(palette.wall, -0.1));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // faixa superior iluminada (leitura 3/4)
  ctx.fillStyle = rgba(palette.wallTop, 0.85);
  ctx.fillRect(0, 0, w, 5);
  ctx.fillStyle = rgba(0xffffff, 0.05);
  ctx.fillRect(0, 0, w, 1);

  // rodapé / sombra
  ctx.fillStyle = rgba(palette.wallShadow, 0.75);
  ctx.fillRect(0, h - 4, w, 4);

  // textura de material
  if (themeId === 'school') {
    ctx.fillStyle = rgba(palette.trim, 0.06);
    for (let y = 8; y < h - 4; y += 9) ctx.fillRect(0, y, w, 1);
  } else if (themeId === 'industrial' || themeId === 'garage') {
    ctx.strokeStyle = rgba(palette.wallShadow, 0.6);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.55);
    ctx.lineTo(w, h * 0.55);
    ctx.stroke();
    ctx.fillStyle = rgba(palette.trim, 0.12);
    ctx.fillRect(0, h * 0.55, w, 1);
  } else if (themeId === 'pool') {
    ctx.fillStyle = rgba(0xffffff, 0.03);
    for (let y = 7; y < h; y += 8) ctx.fillRect(0, y, w, 1);
  } else if (themeId === 'hotel' || themeId === 'residential') {
    ctx.fillStyle = rgba(palette.trim, 0.13);
    ctx.fillRect(0, 6, w, 1);
  } else if (themeId === 'offices') {
    ctx.fillStyle = rgba(0xffffff, 0.03);
    ctx.fillRect(0, 6, w, 12);
  }

  // manchas / rachaduras
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = rgba(0, 0, 0, 0.05 + rnd() * 0.06);
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + rnd() * 5, 2 + rnd() * 3, rnd(), 0, Math.PI * 2);
    ctx.fill();
  }

  // borda escura entre tiles
  ctx.strokeStyle = rgba(0, 0, 0, 0.28);
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function drawWater(ctx, w, h, palette) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, shade(palette.wallShadow, -0.02));
  grad.addColorStop(0.5, cssColor(palette.wallShadow));
  grad.addColorStop(1, shade(palette.wallShadow, 0.04));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = rgba(palette.glow, 0.1);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse((i + 0.5) * (w / 3), h * (0.4 + 0.15 * i), w * 0.14, h * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(palette.glow, 0.18);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.bezierCurveTo(w * 0.3, h * 0.44, w * 0.7, h * 0.58, w, h * 0.5);
  ctx.stroke();
}

function drawVoid(ctx, w, h) {
  ctx.fillStyle = '#040506';
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w * 0.7);
  grad.addColorStop(0, 'rgba(40,44,52,0.5)');
  grad.addColorStop(1, 'rgba(4,5,6,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawDoorway(ctx, w, h, palette) {
  ctx.fillStyle = shade(palette.floor, -0.12);
  ctx.fillRect(0, 0, w, h);
  // soleira
  ctx.fillStyle = rgba(palette.trim, 0.22);
  ctx.fillRect(0, 0, w, 2);
  ctx.fillRect(0, h - 2, w, 2);
  // linha de luz do batente
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgba(palette.glow, 0.1));
  g.addColorStop(0.5, rgba(palette.glow, 0.02));
  g.addColorStop(1, rgba(palette.glow, 0.06));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba(0, 0, 0, 0.3);
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function drawObstacle(ctx, w, h, palette) {
  ctx.fillStyle = shade(palette.floor, -0.16);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba(0, 0, 0, 0.4);
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = rgba(0, 0, 0, 0.25);
  ctx.fillRect(0, h - 5, w, 5);
}

// ---------------------------------------------------------------------------
// Mobiliário
// ---------------------------------------------------------------------------

const PROP_DRAWERS = {
  desk(ctx, w, h, p) {
    ctx.fillStyle = '#3c3a33';
    ctx.fillRect(1, 2, w - 2, h - 4);
    ctx.fillStyle = '#4c4940';
    ctx.fillRect(1, 2, w - 2, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeRect(1.5, 2.5, w - 3, h - 5);
    ctx.fillStyle = 'rgba(20,20,18,0.7)';
    ctx.fillRect(w * 0.12, h * 0.45, w * 0.22, h * 0.32);
    // papéis
    ctx.fillStyle = 'rgba(210,204,186,0.5)';
    ctx.fillRect(w * 0.55, h * 0.35, w * 0.18, h * 0.22);
  },
  chair(ctx, w, h) {
    ctx.fillStyle = '#2e2c28';
    roundRectPath(ctx, w * 0.22, h * 0.2, w * 0.56, h * 0.6, 3);
    ctx.fill();
    ctx.fillStyle = '#3d3a34';
    ctx.fillRect(w * 0.28, h * 0.45, w * 0.44, h * 0.3);
  },
  cabinet(ctx, w, h) {
    ctx.fillStyle = '#4a4740';
    ctx.fillRect(2, 1, w - 4, h - 3);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(2, h * 0.42, w - 4, 1.5);
    ctx.fillStyle = 'rgba(216,207,154,0.5)';
    ctx.fillRect(w * 0.46, h * 0.28, w * 0.08, 2);
    ctx.fillRect(w * 0.46, h * 0.62, w * 0.08, 2);
  },
  printer(ctx, w, h) {
    ctx.fillStyle = '#33363a';
    ctx.fillRect(3, h * 0.32, w - 6, h * 0.5);
    ctx.fillStyle = '#4a4e54';
    ctx.fillRect(3, h * 0.32, w - 6, 4);
    ctx.fillStyle = 'rgba(210,204,186,0.75)';
    ctx.fillRect(4, h * 0.3, w - 8, 2);
    ctx.fillStyle = 'rgba(160,60,50,0.55)';
    ctx.fillRect(w - 8, h * 0.45, 2, 2);
  },
  plant(ctx, w, h) {
    ctx.fillStyle = '#4a3b33';
    ctx.fillRect(w * 0.36, h * 0.6, w * 0.28, h * 0.28);
    ctx.fillStyle = '#3e5138';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(w / 2 + Math.cos(a) * 6, h * 0.48 + Math.sin(a) * 5, 4.2, 2.4, a, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  monitor(ctx, w, h) {
    ctx.fillStyle = '#22242a';
    ctx.fillRect(w * 0.2, h * 0.28, w * 0.6, h * 0.4);
    ctx.fillStyle = 'rgba(120,190,180,0.22)';
    ctx.fillRect(w * 0.24, h * 0.32, w * 0.52, h * 0.3);
    ctx.fillStyle = '#191b20';
    ctx.fillRect(w * 0.44, h * 0.68, w * 0.12, h * 0.12);
  },
  watercooler(ctx, w, h) {
    ctx.fillStyle = '#3a4247';
    ctx.fillRect(w * 0.3, h * 0.4, w * 0.4, h * 0.5);
    ctx.fillStyle = 'rgba(130,180,190,0.5)';
    roundRectPath(ctx, w * 0.33, h * 0.12, w * 0.34, h * 0.3, 4);
    ctx.fill();
  },
  whiteboard(ctx, w, h) {
    ctx.fillStyle = '#c8c4b2';
    ctx.fillRect(2, h * 0.16, w - 4, h * 0.66);
    ctx.strokeStyle = 'rgba(40,40,38,0.6)';
    ctx.strokeRect(2.5, h * 0.16, w - 5, h * 0.66 - 1);
    ctx.strokeStyle = 'rgba(50,50,60,0.45)';
    ctx.beginPath();
    ctx.moveTo(w * 0.12, h * 0.4);
    ctx.lineTo(w * 0.4, h * 0.4);
    ctx.moveTo(w * 0.2, h * 0.56);
    ctx.lineTo(w * 0.55, h * 0.56);
    ctx.stroke();
  },
  bed(ctx, w, h) {
    ctx.fillStyle = '#3f3a3d';
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#8b8070';
    ctx.fillRect(4, 4, w - 8, h * 0.5);
    ctx.fillStyle = '#6d6357';
    ctx.fillRect(4, 4 + h * 0.5, w - 8, h * 0.46);
    ctx.fillStyle = 'rgba(226,220,204,0.5)';
    ctx.fillRect(6, 6, w * 0.32, h * 0.2);
  },
  nightstand(ctx, w, h) {
    ctx.fillStyle = '#463b34';
    ctx.fillRect(4, h * 0.3, w - 8, h * 0.6);
    ctx.fillStyle = 'rgba(226,208,170,0.35)';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.26, 3, 0, Math.PI * 2);
    ctx.fill();
  },
  luggage(ctx, w, h) {
    ctx.fillStyle = '#3d3a3f';
    roundRectPath(ctx, w * 0.22, h * 0.3, w * 0.56, h * 0.6, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,210,190,0.25)';
    ctx.beginPath();
    ctx.moveTo(w * 0.22, h * 0.56);
    ctx.lineTo(w * 0.78, h * 0.56);
    ctx.stroke();
  },
  armchair(ctx, w, h) {
    ctx.fillStyle = '#57493f';
    roundRectPath(ctx, w * 0.14, h * 0.24, w * 0.72, h * 0.66, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(w * 0.4, h * 0.3, w * 0.2, h * 0.5);
  },
  mirror(ctx, w, h) {
    ctx.fillStyle = '#2f2a2c';
    ctx.fillRect(3, 2, w - 6, h - 4);
    const g = ctx.createLinearGradient(3, 2, w - 3, h - 2);
    g.addColorStop(0, 'rgba(190,200,205,0.5)');
    g.addColorStop(0.5, 'rgba(120,132,140,0.35)');
    g.addColorStop(1, 'rgba(200,208,214,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(5, 4, w - 10, h - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(7, h - 8);
    ctx.lineTo(w - 10, 6);
    ctx.lineTo(w - 7, 6);
    ctx.lineTo(10, h - 8);
    ctx.fill();
  },
  tvcrt(ctx, w, h) {
    ctx.fillStyle = '#2b2926';
    roundRectPath(ctx, 3, h * 0.2, w - 6, h * 0.6, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(90,120,120,0.35)';
    roundRectPath(ctx, 6, h * 0.26, w - 12, h * 0.46, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(7, h * 0.28, w - 14, 3);
  },
  lampshade(ctx, w, h) {
    ctx.fillStyle = '#3a332c';
    ctx.fillRect(w / 2 - 1, h * 0.45, 2, h * 0.45);
    ctx.fillStyle = 'rgba(226,196,140,0.55)';
    ctx.beginPath();
    ctx.moveTo(w * 0.3, h * 0.22);
    ctx.lineTo(w * 0.7, h * 0.22);
    ctx.lineTo(w * 0.62, h * 0.48);
    ctx.lineTo(w * 0.38, h * 0.48);
    ctx.fill();
  },
  dresser(ctx, w, h) {
    ctx.fillStyle = '#43382f';
    ctx.fillRect(2, h * 0.26, w - 4, h * 0.66);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(4, h * 0.26 + (i * h * 0.66) / 3);
      ctx.lineTo(w - 4, h * 0.26 + (i * h * 0.66) / 3);
      ctx.stroke();
    }
  },
  lounger(ctx, w, h) {
    ctx.fillStyle = '#8d8d84';
    roundRectPath(ctx, 3, h * 0.28, w - 6, h * 0.5, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    for (let x = 8; x < w - 6; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.3);
      ctx.lineTo(x - 3, h * 0.76);
      ctx.stroke();
    }
  },
  umbrella(ctx, w, h) {
    ctx.fillStyle = '#4c5a58';
    ctx.fillRect(w / 2 - 1, h * 0.4, 2, h * 0.5);
    ctx.fillStyle = 'rgba(180,170,150,0.55)';
    ctx.beginPath();
    ctx.moveTo(w * 0.16, h * 0.4);
    ctx.lineTo(w * 0.5, h * 0.1);
    ctx.lineTo(w * 0.84, h * 0.4);
    ctx.fill();
  },
  locker(ctx, w, h) {
    ctx.fillStyle = '#5c6664';
    ctx.fillRect(4, 1, w - 8, h - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let y = 4; y < h - 2; y += 6) ctx.fillRect(5, y, w - 10, 1);
    ctx.fillStyle = 'rgba(220,230,225,0.5)';
    ctx.fillRect(w - 10, h * 0.5, 2, 4);
  },
  divingboard(ctx, w, h) {
    ctx.fillStyle = '#6d7573';
    ctx.fillRect(w * 0.3, 0, w * 0.4, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(w * 0.34, 0, 3, h);
  },
  poolfloat(ctx, w, h) {
    ctx.strokeStyle = 'rgba(214,150,150,0.75)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.3, h * 0.22, 0.4, 0, Math.PI * 2);
    ctx.stroke();
  },
  towel(ctx, w, h) {
    ctx.fillStyle = 'rgba(216,210,190,0.6)';
    ctx.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.4);
    ctx.strokeStyle = 'rgba(150,120,110,0.5)';
    ctx.beginPath();
    ctx.moveTo(w * 0.2, h * 0.5);
    ctx.lineTo(w * 0.8, h * 0.5);
    ctx.stroke();
  },
  signpool(ctx, w, h) {
    ctx.fillStyle = '#3f4a48';
    ctx.fillRect(w * 0.44, h * 0.4, 3, h * 0.5);
    ctx.fillStyle = '#c8c4b4';
    ctx.fillRect(w * 0.26, h * 0.12, w * 0.48, h * 0.3);
    ctx.fillStyle = 'rgba(50,60,58,0.85)';
    ctx.fillRect(w * 0.32, h * 0.2, w * 0.36, 2);
    ctx.fillRect(w * 0.32, h * 0.27, w * 0.24, 2);
  },
  car(ctx, w, h) {
    ctx.fillStyle = '#3b4148';
    roundRectPath(ctx, 2, 4, w - 4, h - 8, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,140,150,0.35)';
    roundRectPath(ctx, 5, h * 0.22, w - 10, h * 0.2, 3);
    ctx.fill();
    roundRectPath(ctx, 5, h * 0.6, w - 10, h * 0.18, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(220,200,150,0.5)';
    ctx.fillRect(3, h * 0.1, 3, 4);
    ctx.fillRect(w - 6, h * 0.1, 3, 4);
  },
  pillar(ctx, w, h) {
    ctx.fillStyle = '#5f6166';
    ctx.fillRect(w * 0.16, h * 0.16, w * 0.68, h * 0.68);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(w * 0.16, h * 0.16, w * 0.68, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(w * 0.16, h * 0.74, w * 0.68, 5);
  },
  cone(ctx, w, h) {
    ctx.fillStyle = 'rgba(190,120,60,0.85)';
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.25);
    ctx.lineTo(w * 0.66, h * 0.75);
    ctx.lineTo(w * 0.34, h * 0.75);
    ctx.fill();
    ctx.fillStyle = 'rgba(230,225,210,0.6)';
    ctx.fillRect(w * 0.38, h * 0.52, w * 0.24, 3);
  },
  barrel(ctx, w, h) {
    ctx.fillStyle = '#4a4238';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.3, h * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,140,90,0.35)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.42, w * 0.3, h * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();
  },
  signexit(ctx, w, h) {
    ctx.fillStyle = 'rgba(90,160,120,0.5)';
    ctx.fillRect(w * 0.2, h * 0.34, w * 0.6, h * 0.3);
    ctx.fillStyle = 'rgba(240,245,235,0.85)';
    ctx.fillRect(w * 0.28, h * 0.46, 6, 2);
    ctx.fillRect(w * 0.34, h * 0.44, 2, 6);
  },
  cart(ctx, w, h) {
    ctx.strokeStyle = 'rgba(180,180,175,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.14, h * 0.3, w * 0.72, h * 0.4);
    ctx.fillStyle = 'rgba(60,62,64,0.8)';
    ctx.fillRect(w * 0.14, h * 0.3, w * 0.72, h * 0.4);
  },
  crate(ctx, w, h) {
    ctx.fillStyle = '#6a563d';
    ctx.fillRect(3, 3, w - 6, h - 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeRect(3.5, 3.5, w - 7, h - 7);
    ctx.beginPath();
    ctx.moveTo(3, 3);
    ctx.lineTo(w - 3, h - 3);
    ctx.moveTo(w - 3, 3);
    ctx.lineTo(3, h - 3);
    ctx.stroke();
  },
  puddle(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.45);
    g.addColorStop(0, 'rgba(120,140,145,0.35)');
    g.addColorStop(1, 'rgba(120,140,145,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.42, h * 0.34, 0.3, 0, Math.PI * 2);
    ctx.fill();
  },
  studentdesk(ctx, w, h) {
    ctx.fillStyle = '#5b5244';
    ctx.fillRect(2, h * 0.35, w - 4, h * 0.3);
    ctx.fillStyle = '#3f3a31';
    ctx.fillRect(w * 0.2, h * 0.62, 3, h * 0.28);
    ctx.fillRect(w * 0.74, h * 0.62, 3, h * 0.28);
    ctx.fillStyle = 'rgba(220,214,190,0.4)';
    ctx.fillRect(w * 0.3, h * 0.4, w * 0.3, h * 0.12);
  },
  blackboard(ctx, w, h) {
    ctx.fillStyle = '#2c342e';
    ctx.fillRect(2, h * 0.14, w - 4, h * 0.66);
    ctx.strokeStyle = 'rgba(230,226,210,0.25)';
    ctx.strokeRect(4.5, h * 0.18, w - 9, h * 0.58);
    ctx.strokeStyle = 'rgba(230,226,210,0.14)';
    ctx.beginPath();
    ctx.moveTo(8, h * 0.34);
    ctx.lineTo(w * 0.42, h * 0.34);
    ctx.moveTo(8, h * 0.5);
    ctx.lineTo(w * 0.6, h * 0.5);
    ctx.stroke();
  },
  teachersdesk(ctx, w, h) {
    ctx.fillStyle = '#4f463a';
    ctx.fillRect(2, h * 0.3, w - 4, h * 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(6, h * 0.5, w - 12, h * 0.24);
  },
  globe(ctx, w, h) {
    ctx.fillStyle = '#59524a';
    ctx.fillRect(w / 2 - 1, h * 0.6, 2, h * 0.2);
    ctx.fillStyle = 'rgba(100,130,120,0.7)';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.42, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
  },
  stairs(ctx, w, h) {
    ctx.fillStyle = '#5a5a52';
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = shade(0x5a5a52, -i * 0.03);
      ctx.fillRect(4, 4 + i * ((h - 8) / 6), w - 8, (h - 8) / 6 - 1);
    }
  },
  bell(ctx, w, h) {
    ctx.fillStyle = 'rgba(200,180,120,0.8)';
    ctx.beginPath();
    ctx.moveTo(w * 0.36, h * 0.62);
    ctx.quadraticCurveTo(w * 0.36, h * 0.28, w / 2, h * 0.28);
    ctx.quadraticCurveTo(w * 0.64, h * 0.28, w * 0.64, h * 0.62);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,40,38,0.9)';
    ctx.fillRect(w * 0.44, h * 0.66, w * 0.12, 3);
  },
  poster(ctx, w, h) {
    ctx.fillStyle = 'rgba(216,210,190,0.25)';
    ctx.fillRect(w * 0.26, h * 0.2, w * 0.48, h * 0.6);
    ctx.fillStyle = 'rgba(60,70,64,0.6)';
    ctx.fillRect(w * 0.32, h * 0.3, w * 0.36, 2);
    ctx.fillRect(w * 0.32, h * 0.38, w * 0.24, 2);
  },
  machine(ctx, w, h) {
    ctx.fillStyle = '#4b4f52';
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(6, h * 0.3, w - 12, h * 0.5);
    ctx.fillStyle = 'rgba(200,130,80,0.4)';
    ctx.fillRect(w * 0.16, h * 0.14, w * 0.16, 3);
  },
  conveyor(ctx, w, h) {
    ctx.fillStyle = '#33363a';
    ctx.fillRect(2, h * 0.32, w - 4, h * 0.36);
    ctx.strokeStyle = 'rgba(160,165,170,0.35)';
    for (let x = 6; x < w - 4; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.34);
      ctx.lineTo(x, h * 0.66);
      ctx.stroke();
    }
  },
  shelf(ctx, w, h) {
    ctx.fillStyle = '#4a443a';
    ctx.fillRect(2, h * 0.14, w - 4, h * 0.72);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(2, h * 0.14 + (i * h * 0.72) / 3);
      ctx.lineTo(w - 2, h * 0.14 + (i * h * 0.72) / 3);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,190,160,0.25)';
    ctx.fillRect(6, h * 0.2, 5, h * 0.15);
    ctx.fillRect(w * 0.5, h * 0.56, 7, h * 0.15);
  },
  panel(ctx, w, h) {
    ctx.fillStyle = '#3a3f42';
    ctx.fillRect(4, 1, w - 8, h - 2);
    ctx.fillStyle = 'rgba(30,32,34,0.9)';
    ctx.fillRect(7, 6, w - 14, h * 0.36);
    ctx.fillStyle = 'rgba(120,200,140,0.5)';
    ctx.fillRect(9, 9, 2, 2);
    ctx.fillStyle = 'rgba(200,160,90,0.5)';
    ctx.fillRect(w - 12, 9, 2, 2);
  },
  pipe(ctx, w, h) {
    ctx.strokeStyle = 'rgba(130,140,145,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 + 2, 0);
    ctx.lineTo(w / 2 + 2, h);
    ctx.stroke();
  },
  valve(ctx, w, h) {
    ctx.strokeStyle = 'rgba(170,120,90,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.3, h / 2);
    ctx.lineTo(w * 0.7, h / 2);
    ctx.moveTo(w / 2, h * 0.3);
    ctx.lineTo(w / 2, h * 0.7);
    ctx.stroke();
  },
  sofa(ctx, w, h) {
    ctx.fillStyle = '#4e4741';
    roundRectPath(ctx, 2, h * 0.26, w - 4, h * 0.62, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let i = 1; i < 3; i++) ctx.fillRect(2 + (i * (w - 4)) / 3, h * 0.3, 1.5, h * 0.54);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(2, h * 0.8, w - 4, h * 0.1);
  },
  tv(ctx, w, h) {
    ctx.fillStyle = '#26282b';
    roundRectPath(ctx, 2, h * 0.24, w - 4, h * 0.46, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(70,90,95,0.4)';
    ctx.fillRect(5, h * 0.3, w - 10, h * 0.34);
    ctx.fillStyle = '#1e2022';
    ctx.fillRect(w * 0.44, h * 0.7, w * 0.12, h * 0.12);
  },
  clock(ctx, w, h) {
    ctx.fillStyle = 'rgba(60,50,44,0.9)';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.34, w * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,210,190,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.34);
    ctx.lineTo(w / 2, h * 0.22);
    ctx.moveTo(w / 2, h * 0.34);
    ctx.lineTo(w * 0.58, h * 0.38);
    ctx.stroke();
    ctx.fillStyle = 'rgba(60,50,44,0.7)';
    ctx.fillRect(w / 2 - 1, h * 0.5, 2, h * 0.36);
  },
  lamp(ctx, w, h) {
    ctx.fillStyle = 'rgba(60,56,50,0.9)';
    ctx.fillRect(w / 2 - 1, h * 0.3, 2, h * 0.5);
    ctx.fillStyle = 'rgba(230,200,140,0.5)';
    ctx.beginPath();
    ctx.moveTo(w * 0.34, h * 0.18);
    ctx.lineTo(w * 0.66, h * 0.18);
    ctx.lineTo(w * 0.58, h * 0.36);
    ctx.lineTo(w * 0.42, h * 0.36);
    ctx.fill();
  },
  table(ctx, w, h) {
    ctx.fillStyle = '#574b3f';
    roundRectPath(ctx, 4, 4, w - 8, h - 8, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(4, h * 0.5, w - 8, 1.5);
  },
  frame(ctx, w, h) {
    ctx.strokeStyle = 'rgba(190,175,140,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.28, h * 0.2, w * 0.44, h * 0.55);
    ctx.fillStyle = 'rgba(190,180,160,0.12)';
    ctx.fillRect(w * 0.3, h * 0.22, w * 0.4, h * 0.51);
  },
  bookshelf(ctx, w, h) {
    ctx.fillStyle = '#443a30';
    ctx.fillRect(2, 2, w - 4, h - 4);
    const colors = ['rgba(150,120,100,0.6)', 'rgba(110,130,120,0.6)', 'rgba(180,160,120,0.55)'];
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = colors[i % 3];
      ctx.fillRect(6 + i * 6.5, h * 0.2, 4, h * 0.5);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(2, h * 0.55);
    ctx.lineTo(w - 2, h * 0.55);
    ctx.stroke();
  },
  radiator(ctx, w, h) {
    ctx.fillStyle = 'rgba(140,140,132,0.55)';
    for (let x = 4; x < w - 4; x += 5) ctx.fillRect(x, h * 0.28, 3, h * 0.44);
  },
  column(ctx, w, h) {
    ctx.fillStyle = '#6b6960';
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(2, 2, w - 4, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(2, h - 6, w - 4, 4);
  },
  bench(ctx, w, h) {
    ctx.fillStyle = '#4f4a43';
    ctx.fillRect(2, h * 0.34, w - 4, h * 0.34);
    ctx.fillStyle = '#38342f';
    ctx.fillRect(w * 0.14, h * 0.66, 4, h * 0.26);
    ctx.fillRect(w * 0.8, h * 0.66, 4, h * 0.26);
  },
  signempty(ctx, w, h) {
    ctx.fillStyle = 'rgba(200,196,180,0.14)';
    ctx.fillRect(w * 0.3, h * 0.3, w * 0.4, h * 0.44);
    ctx.strokeStyle = 'rgba(216,207,154,0.25)';
    ctx.strokeRect(w * 0.3 + 0.5, h * 0.3 + 0.5, w * 0.4 - 1, h * 0.44 - 1);
  },
  doorframe(ctx, w, h) {
    ctx.strokeStyle = 'rgba(200,196,180,0.16)';
    ctx.lineWidth = 3;
    ctx.strokeRect(w * 0.2, h * 0.1, w * 0.6, h * 0.8);
  },
};

function drawProp(ctx, w, h, kind) {
  const fn = PROP_DRAWERS[kind];
  if (fn) fn(ctx, w, h);
  else {
    ctx.fillStyle = 'rgba(120,120,110,0.5)';
    ctx.fillRect(4, 4, w - 8, h - 8);
  }
}

// ---------------------------------------------------------------------------
// Criaturas
// ---------------------------------------------------------------------------

const CREATURE_DRAW = {
  waiter(ctx, w, h, t) {
    // silhueta alta e curva, com bandeja
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.86, w * 0.24, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cfc9ba';
    ctx.beginPath();
    ctx.moveTo(w * 0.34, h * 0.82);
    ctx.quadraticCurveTo(w * 0.4, h * 0.36, w * 0.5, h * 0.28);
    ctx.quadraticCurveTo(w * 0.62, h * 0.36, w * 0.66, h * 0.82);
    ctx.closePath();
    ctx.fill();
    // cabeça oval sem rosto
    ctx.fillStyle = '#e3ded0';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.2, w * 0.11, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    // bandeja
    ctx.strokeStyle = 'rgba(230,225,210,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(w * 0.68, h * 0.46, w * 0.16, h * 0.045, 0.1, 0, Math.PI * 2);
    ctx.stroke();
    // a bandeja respira
    const pulse = 0.5 + Math.sin(t * 1.7) * 0.5;
    ctx.fillStyle = `rgba(216,207,154,${0.1 + pulse * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(w * 0.68, h * 0.46, w * 0.1 * pulse, h * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  slow(ctx, w, h, t) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.9, w * 0.3, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // massa escura com dobras
    ctx.fillStyle = '#1c1a20';
    ctx.beginPath();
    ctx.moveTo(w * 0.3, h * 0.88);
    ctx.quadraticCurveTo(w * 0.24, h * 0.3, w * 0.44, h * 0.16);
    ctx.quadraticCurveTo(w * 0.56, h * 0.08, w * 0.5, h * 0.2);
    ctx.quadraticCurveTo(w * 0.78, h * 0.44, w * 0.7, h * 0.88);
    ctx.closePath();
    ctx.fill();
    // olhos: só existem quando observados
    const eye = 0.5 + Math.sin(t * 3) * 0.5;
    ctx.fillStyle = `rgba(210,205,190,${0.35 + eye * 0.45})`;
    ctx.beginPath();
    ctx.ellipse(w * 0.44, h * 0.3, 1.6, 2.6, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.56, h * 0.28, 1.6, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  listener(ctx, w, h, t) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.88, w * 0.26, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // corpo fino e molhado
    ctx.fillStyle = '#6d7a68';
    ctx.beginPath();
    ctx.moveTo(w * 0.42, h * 0.86);
    ctx.quadraticCurveTo(w * 0.36, h * 0.4, w * 0.48, h * 0.24);
    ctx.quadraticCurveTo(w * 0.6, h * 0.4, w * 0.58, h * 0.86);
    ctx.closePath();
    ctx.fill();
    // ondulações (o som)
    ctx.strokeStyle = `rgba(160,180,160,${0.12 + Math.abs(Math.sin(t * 2.2)) * 0.2})`;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.4, w * 0.12 + i * 3.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // cabeça inclinada
    ctx.fillStyle = '#87957f';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.18, w * 0.1, h * 0.1, 0.3, 0, Math.PI * 2);
    ctx.fill();
  },
  lonely(ctx, w, h, t) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.9, w * 0.28, h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    // figura sentada/agachada, encolhida
    ctx.fillStyle = '#3a3849';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.66, w * 0.24, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.3, w * 0.15, h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // três batidas: anéis que pulsam
    const beat = (t * 2) % 3;
    ctx.strokeStyle = `rgba(190,190,210,${Math.max(0, 0.35 - beat * 0.1)})`;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.3, w * 0.2 + beat * 5, 0, Math.PI * 2);
    ctx.stroke();
  },
  echo(ctx, w, h, t) {
    // você, mas com um segundo de atraso: contorno duplicado
    for (let i = 0; i < 3; i++) {
      const off = Math.sin(t * 2 + i * 1.4) * 2.4;
      ctx.strokeStyle = `rgba(183,174,203,${0.5 - i * 0.14})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(w / 2 + off, h * 0.5, w * 0.26 - i * 2, h * 0.34 - i * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(183,174,203,0.16)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.5, w * 0.18, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(230,228,240,0.55)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.32, 1.4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  watcher(ctx, w, h, t) {
    // só olhos, alto, no escuro
    ctx.fillStyle = 'rgba(8,10,12,0.85)';
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.02);
    ctx.quadraticCurveTo(w * 0.72, h * 0.6, w * 0.6, h * 0.98);
    ctx.lineTo(w * 0.4, h * 0.98);
    ctx.quadraticCurveTo(w * 0.28, h * 0.6, w * 0.5, h * 0.02);
    ctx.fill();
    const blink = Math.sin(t * 0.9) > 0.94 ? 0.1 : 1;
    ctx.fillStyle = `rgba(150,190,210,${0.65 * blink})`;
    ctx.beginPath();
    ctx.ellipse(w * 0.44, h * 0.3, 1.8, 2.6, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.55, h * 0.3, 1.8, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(120,160,180,${0.08 * blink})`;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.3, w * 0.28, 0, Math.PI * 2);
    ctx.fill();
  },
  organ(ctx, w, h, t) {
    // válvula de carne: esfera pulsante com veias
    const pulse = 1 + Math.sin(t * 2.4) * 0.06;
    ctx.fillStyle = 'rgba(110,50,46,0.95)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.6, w * 0.27 * pulse, h * 0.24 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,80,72,0.7)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.6);
      ctx.quadraticCurveTo(
        w / 2 + Math.cos(a) * w * 0.16,
        h * 0.6 + Math.sin(a) * h * 0.12,
        w / 2 + Math.cos(a) * w * 0.3,
        h * 0.6 + Math.sin(a) * h * 0.22,
      );
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,20,20,0.8)';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.6, 2.4, 0, Math.PI * 2);
    ctx.fill();
  },
};

function drawCreature(ctx, w, h, kind, t) {
  const fn = CREATURE_DRAW[kind];
  if (!fn) return;
  ctx.save();
  fn(ctx, w, h, t);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Texturas geradas
// ---------------------------------------------------------------------------

export function buildTextures(scene) {
  for (const themeId of Object.keys(THEMES)) {
    const theme = THEMES[themeId];
    const p = theme.palette;
    makeTexture(scene, `floor-${themeId}`, TS, TS, (ctx, w, h) => drawFloor(ctx, w, h, p, theme.floorPattern, hashSeed(themeId)));
    for (let v = 0; v < 3; v++) {
      makeTexture(scene, `wall-${themeId}-${v}`, TS, TS, (ctx, w, h) => drawWall(ctx, w, h, p, themeId, v));
    }
    makeTexture(scene, `water-${themeId}`, TS, TS, (ctx, w, h) => drawWater(ctx, w, h, p));
    makeTexture(scene, `door-${themeId}`, TS, TS, (ctx, w, h) => drawDoorway(ctx, w, h, p));
    makeTexture(scene, `obstacle-${themeId}`, TS, TS, (ctx, w, h) => drawObstacle(ctx, w, h, p));
  }
  makeTexture(scene, 'void', TS, TS, drawVoid);

  // props: cada tipo tem sua textura em escala 1 tile (2x2 e 3x1 desenham esticado)
  const allProps = new Set();
  for (const theme of Object.values(THEMES)) for (const kind of theme.props) allProps.add(kind);
  allProps.add('valve');
  allProps.add('breaker');
  allProps.add('lever');
  allProps.add('plate');
  allProps.add('bell');
  allProps.add('choirSeal');
  allProps.add('altar');
  allProps.add('sigil');
  allProps.add('note');
  for (const kind of allProps) {
    makeTexture(scene, `prop-${kind}`, TS, TS, (ctx, w, h) => {
      if (kind === 'altar') {
        drawAltar(ctx, w, h);
      } else if (kind === 'sigil') {
        drawSigil(ctx, w, h);
      } else if (kind === 'note') {
        drawNote(ctx, w, h);
      } else if (kind === 'breaker') {
        drawBreaker(ctx, w, h);
      } else if (kind === 'lever') {
        drawLever(ctx, w, h);
      } else if (kind === 'plate') {
        drawPlate(ctx, w, h);
      } else if (kind === 'choirSeal') {
        drawChoirSeal(ctx, w, h);
      } else {
        drawProp(ctx, w, h, kind);
      }
    });
  }

  // partículas / luzes
  makeTexture(scene, 'glow', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.32)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  makeTexture(scene, 'dot', 8, 8, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  makeTexture(scene, 'dust', 4, 4, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(0, 0, w, h);
  });

  // jogador: sombra + corpo simples (anel de cor aplicado no container)
  makeTexture(scene, 'player-body', 28, 28, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.82, w * 0.3, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e4d8';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.52, w * 0.26, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,22,24,0.9)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.44, w * 0.16, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // olhar
    ctx.fillStyle = 'rgba(232,228,216,0.9)';
    ctx.beginPath();
    ctx.arc(w * 0.42, h * 0.42, 1.3, 0, Math.PI * 2);
    ctx.arc(w * 0.58, h * 0.42, 1.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // criaturas (1 frame de 8; animação é feita em tween/escala)
  for (const kind of ['waiter', 'slow', 'listener', 'lonely', 'echo', 'watcher', 'organ']) {
    makeTexture(scene, `creature-${kind}`, 64, 64, (ctx, w, h) => drawCreature(ctx, w, h, kind, 0));
  }

  // mobília "em pé" (2 tiles de altura) para leitura oblíqua
  makeTexture(scene, 'shadow-soft', 64, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function drawBreaker(ctx, w, h) {
  ctx.fillStyle = '#3b4044';
  ctx.fillRect(5, 5, w - 10, h - 10);
  ctx.fillStyle = 'rgba(20,22,24,0.9)';
  ctx.fillRect(8, 8, w - 16, h * 0.34);
  ctx.fillStyle = 'rgba(190,120,70,0.7)';
  ctx.fillRect(9, 9, w - 18, 2);
  ctx.strokeStyle = 'rgba(200,200,190,0.35)';
  ctx.strokeRect(8.5, 8.5, w - 17, h * 0.34);
  ctx.fillStyle = 'rgba(120,200,140,0.45)';
  ctx.fillRect(w * 0.72, h * 0.62, 3, 3);
}
function drawLever(ctx, w, h) {
  ctx.fillStyle = '#3d4145';
  ctx.fillRect(w * 0.28, h * 0.58, w * 0.44, h * 0.26);
  ctx.strokeStyle = 'rgba(220,200,150,0.75)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.6);
  ctx.lineTo(w * 0.66, h * 0.22);
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,170,110,0.9)';
  ctx.beginPath();
  ctx.arc(w * 0.68, h * 0.2, 3, 0, Math.PI * 2);
  ctx.fill();
}
function drawPlate(ctx, w, h) {
  ctx.fillStyle = 'rgba(90,95,92,0.85)';
  ctx.beginPath();
  roundRectPath(ctx, w * 0.16, h * 0.3, w * 0.68, h * 0.42, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(216,207,154,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(w * 0.2, h * 0.34, w * 0.6, h * 0.34);
  ctx.fillStyle = 'rgba(216,207,154,0.18)';
  ctx.fillRect(w * 0.3, h * 0.48, w * 0.4, 2);
}
function drawChoirSeal(ctx, w, h) {
  ctx.strokeStyle = 'rgba(170,180,190,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    ctx.moveTo(w / 2 + Math.cos(a) * w * 0.1, h / 2 + Math.sin(a) * h * 0.1);
    ctx.lineTo(w / 2 + Math.cos(a) * w * 0.24, h / 2 + Math.sin(a) * h * 0.24);
  }
  ctx.stroke();
}
function drawAltar(ctx, w, h) {
  ctx.fillStyle = 'rgba(10,11,13,0.9)';
  ctx.fillRect(4, 4, w - 8, h - 8);
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 1, w / 2, h * 0.45, w * 0.4);
  g.addColorStop(0, 'rgba(216,207,154,0.5)');
  g.addColorStop(1, 'rgba(216,207,154,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(216,207,154,0.45)';
  ctx.strokeRect(6.5, 6.5, w - 13, h - 13);
  ctx.fillStyle = 'rgba(216,207,154,0.8)';
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.26);
  ctx.lineTo(w * 0.62, h * 0.5);
  ctx.lineTo(w / 2, h * 0.74);
  ctx.lineTo(w * 0.38, h * 0.5);
  ctx.closePath();
  ctx.fill();
}
function drawSigil(ctx, w, h) {
  ctx.fillStyle = 'rgba(216,207,154,0.14)';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,228,216,0.8)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.24);
  ctx.lineTo(w * 0.74, h * 0.5);
  ctx.lineTo(w / 2, h * 0.76);
  ctx.lineTo(w * 0.26, h * 0.5);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.32);
  ctx.lineTo(w / 2, h * 0.68);
  ctx.stroke();
}
function drawNote(ctx, w, h) {
  ctx.fillStyle = 'rgba(216,210,190,0.82)';
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.12);
  ctx.fillRect(-8, -10, 16, 20);
  ctx.fillStyle = 'rgba(60,55,48,0.5)';
  for (let i = 0; i < 4; i++) ctx.fillRect(-5, -5 + i * 4, 10, 1);
  ctx.restore();
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Desenha uma criatura viva em um Graphics/Container (animação por frame). */
export function drawCreatureLive(graphics, kind, size, t) {
  graphics.clear();
  const fn = CREATURE_DRAW[kind];
  if (!fn) return;
  const ctx = graphics.canvas ? graphics.canvas.getContext('2d') : null;
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    fn(ctx, size, size, t);
    ctx.restore();
    graphics.refresh?.();
  }
}

export { PROP_DRAWERS, CREATURE_DRAW };
