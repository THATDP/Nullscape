/**
 * NULLSCAPE — Cena principal.
 *
 * Câmera: oblíqua top-down com zoom próximo. Acompanha o jogador com suavidade
 * (lerp), respeita limites do mundo e dá "respiro" quando há movimento rápido.
 *
 * Rede: o jogador local é simulado localmente com o MESMO módulo de física do
 * servidor (predição). Snapshots do servidor não reescrevem a posição local de
 * forma dura; apenas corrigem derivas grandes. Corpos remotos são interpolados
 * com atraso de ~110ms.
 */

import Phaser from 'phaser';
import { THEMES } from '../../../shared/world/themes.js';
import { applyDoorStates } from '../../../shared/world/generator.js';
import {
  stepMovement,
  circleBlocked,
  RADIUS,
  TILE_SIZE,
  SPEED_RUN,
} from '../../../shared/sim/physics.js';
import { buildTextures, cssColor, TS } from './art.js';
import { WorldView } from './worldview.js';

const DEPTH = {
  lights: 20,
  entities: 12,
  effects: 16,
  overlays: 24,
};

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  init(data) {
    this.worldData = data.world;
    this.shared = data.shared || {};
    this.net = data.net;
    this.audio = data.audio;
    this.settings = data.settings;
    this.callbacks = data.callbacks || {};
    this.myPlayerId = this.net.playerId;
    this.remoteSprites = new Map();
    this.creatureSprites = new Map();
    this.playerNameSprites = new Map();
    this.inputSeq = 0;
    this.lastSentInput = { dx: 0, dy: 0, run: false };
    this.lastInputSentAt = 0;
    this.corrected = { x: 0, y: 0 };
    this.activeAnomalies = [];
    this.doorStates = new Map();
    this.nearbyInteractable = null;
    this.running = true;
    this.lastStepAt = 0;
    this.tensionAt = 0;
    this.flickerAt = 0;
  }

  create() {
    this.build();
    this.bindNetwork();
    this.setupCamera();
    this.setupInput();
    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => this.teardown());
  }

  // -------------------------------------------------------------------------
  // Construção
  // -------------------------------------------------------------------------

  build() {
    buildTextures(this);
    this.view = new WorldView(this, this.worldData);
    this.view.build();

    // Camada de luz (blend aditivo) e camada de escuridão
    this.lightLayer = this.add.container(0, 0).setDepth(DEPTH.lights).setBlendMode(Phaser.BlendModes.ADD);
    this.darkLayer = this.add
      .rectangle(0, 0, this.worldData.worldW * TS, this.worldData.worldH * TS, 0x020304, 0.62)
      .setOrigin(0, 0)
      .setDepth(DEPTH.lights - 1);

    this.entityLayer = this.add.container(0, 0).setDepth(DEPTH.entities);
    this.fxLayer = this.add.container(0, 0).setDepth(DEPTH.effects);

    // luzes da cena (somente as próximas do jogador são visíveis: economiza fill rate)
    this.lightSprites = [];
    for (const region of this.worldData.regions) {
      const theme = THEMES[region.themeId] || THEMES.threshold;
      for (const light of region.lights) {
        const sprite = this.add.image(light.x, light.y, 'glow').setScale((light.radius * 2) / 128).setAlpha(0.0).setTint(theme.palette.glow);
        this.lightLayer.add(sprite);
        this.lightSprites.push({ sprite, light, flicker: light.flicker, base: light.intensity, nextFlicker: 0 });
      }
    }

    // jogadores
    if (this.shared?.doors) {
      for (const d of this.shared.doors) this.doorStates.set(d.id, d);
      this.view.applyDoorState(this.shared.doors);
      applyDoorStates(this.worldData, this.shared.doors);
      for (const d of this.worldData.doors) {
        if (d.kind === 'gate' && this.doorStates.get(d.id)?.open) this.view.hideDoor(d.id, true);
      }
    }

    this.localPlayer = this.createPlayerSprite(this.myPlayerId, this.net.name || 'Você', 0xe8e4d8, true);

    // criaturas a partir do estado compartilhado
    if (this.shared?.creatures) this.syncCreatures(this.shared.creatures);
    if (this.shared?.sigilStates) this.syncSigils(this.shared.sigilStates);

    // partículas de poeira
    if (!this.settings?.reduced) {
      this.dust = this.add.particles(0, 0, 'dust', {
        x: { min: 0, max: this.worldData.worldW * TS },
        y: { min: 0, max: this.worldData.worldH * TS },
        lifespan: 9000,
        speedX: { min: -6, max: 6 },
        speedY: { min: -10, max: 2 },
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.16, end: 0 },
        quantity: 1,
        frequency: 90,
        blendMode: 'ADD',
      });
      this.dust.setDepth(DEPTH.effects);
    }

    // posição inicial local = posição autoritativa (se já houver) ou spawn
    const own = this.net?.ownState?.();
    const spawn = own ? { x: Math.floor(own.x / TS), y: Math.floor(own.y / TS) } : this.worldData.spawn;
    this.local = {
      x: (spawn.x + 0.5) * TS,
      y: (spawn.y + 0.5) * TS,
      vx: 0,
      vy: 0,
      dirX: 0,
      dirY: 1,
      speed: 0,
      running: false,
    };
    this.localPlayer.container.setPosition(this.local.x, this.local.y);

    this.cameras.main.setBackgroundColor('#050607');
    this.cameras.main.fadeIn(700, 3, 4, 5);
    this.audio?.setAmbience(this.themeAtWorld(spawn.x, spawn.y));
  }

  createPlayerSprite(id, name, color, isLocal = false) {
    const container = this.add.container(0, 0);
    const halo = this.add.image(0, 6, 'glow').setScale(0.42).setAlpha(isLocal ? 0.14 : 0.1).setTint(color);
    const body = this.add.image(0, 0, 'player-body');
    const ring = this.add.circle(0, 9, 12, color, 0).setStrokeStyle(1, color, isLocal ? 0.65 : 0.4);
    const label = this.add
      .text(0, -22, name, {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '9px',
        color: isLocal ? '#e8e4d8' : '#b9b4a5',
        stroke: '#050607',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    container.add([halo, body, ring, label]);
    container.setDepth(DEPTH.entities + (isLocal ? 2 : 1));
    this.entityLayer.add(container);
    const entry = { container, halo, body, ring, label, color, isLocal, walkPhase: 0 };
    if (!isLocal) {
      this.remoteSprites.set(id, entry);
      this.playerNameSprites.set(id, label);
    }
    return entry;
  }

  themeAtWorld(gx, gy) {
    const idx = Math.floor(gx / this.worldData.regionW);
    return this.worldData.regions[Math.max(0, Math.min(3, idx))]?.themeId || 'threshold';
  }

  setupCamera() {
    const cam = this.cameras.main;
    cam.setZoom(this.zoomForViewport());
    cam.startFollow(this.localPlayer.container, true, 0.09, 0.09);
    cam.setDeadzone(90, 60);
    cam.setBounds(0, 0, this.worldData.worldW * TS, this.worldData.worldH * TS);
    cam.centerOn(this.local.x, this.local.y);
  }

  zoomForViewport() {
    const w = this.scale.width;
    if (w < 560) return 1.75;
    if (w < 900) return 1.55;
    return 1.35;
  }

  handleResize() {
    this.cameras.main.setZoom(this.zoomForViewport());
  }

  // -------------------------------------------------------------------------
  // Rede
  // -------------------------------------------------------------------------

  bindNetwork() {
    this.net.onShared = (shared) => {
      this.shared = shared;
      this.callbacks.onShared?.(shared);
      this.syncCreatures(shared.creatures || []);
      this.syncSigils(shared.sigilStates || []);
      if (shared.doors) {
        // O snapshot só traz portas fechadas; qualquer porta conhecida que não
        // apareça nele está aberta (pode ter sido reaberta por outro jogador).
        const closed = new Set(shared.doors.map((d) => d.id));
        for (const id of this.doorStates.keys()) {
          if (!closed.has(id) && this.doorStates.get(id).kind !== 'gate') this.doorStates.set(id, { id, open: true, kind: 'normal' });
        }
        for (const d of shared.doors) this.doorStates.set(d.id, d);
        this.view.applyDoorState(shared.doors);
        // mantém a colisão local coerente com o servidor (portas internas)
        applyDoorStates(this.worldData, shared.doors);
        // portões abertos devem sumir visualmente
        for (const d of this.worldData.doors) {
          if (d.kind === 'gate' && this.doorStates.get(d.id)?.open) this.view.hideDoor(d.id, true);
        }
      }
    };
    this.net.onEvent = (ev) => this.handleServerEvent(ev);
  }

  syncCreatures(list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.i);
      let entry = this.creatureSprites.get(c.i);
      if (!entry) {
        const container = this.add.container(c.x, c.y).setDepth(DEPTH.entities + 1);
        const sprite = this.add.image(0, 0, `creature-${c.k}`).setScale(0.5);
        const aura = this.add.image(0, 0, 'glow').setScale(0.72).setAlpha(0.1).setTint(0x9a8f7a);
        container.add([aura, sprite]);
        const label = null;
        this.entityLayer.add(container);
        entry = { container, sprite, aura, kind: c.k, state: c.s, label };
        this.creatureSprites.set(c.i, entry);
        this.tweens.add({ targets: sprite, y: -2, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }
      entry.targetX = c.x;
      entry.targetY = c.y;
      entry.state = c.s;
      entry.visible = c.v !== 0;
      entry.container.setVisible(entry.visible);
      entry.aura.setAlpha(c.s === 8 ? 0.2 : 0.09);
      entry.sprite.setTint(c.s === 8 ? 0xd8b8b0 : 0xffffff);
    }
    for (const [id, entry] of this.creatureSprites) {
      if (!seen.has(id)) {
        entry.container.destroy();
        this.creatureSprites.delete(id);
      }
    }
  }

  syncSigils(states) {
    for (const s of states) {
      const sprite = this.view.interactSprites.get(s.id);
      if (sprite) sprite.setVisible(!!s.revealed && !s.taken && !s.delivered);
    }
  }

  handleServerEvent(ev) {
    const cb = this.callbacks;
    switch (ev.type) {
      case 'playerJoined':
        cb.onPlayerJoined?.(ev.player);
        break;
      case 'playerLeft':
      case 'playerDisconnected':
        this.removeRemote(ev.playerId);
        cb.onPlayersChanged?.();
        break;
      case 'playerReconnected':
        cb.toast?.(`${ev.name} voltou.`);
        cb.onPlayersChanged?.();
        break;
      case 'anomaly': {
        const a = ev.anomaly;
        cb.onAnomaly?.(a);
        this.playAnomaly(a);
        break;
      }
      case 'anomalyEnd':
        this.endAnomaly(ev.anomalyId);
        break;
      case 'mechanism':
        this.flashMechanism(ev.mechId, ev.action);
        this.audio?.spatial(ev.action, this.distanceTo(ev.gx, ev.gy));
        break;
      case 'puzzleSolved': {
        if (ev.sigilId) this.view.setSigilVisible(ev.sigilId, true);
        cb.onPuzzleSolved?.(ev);
        cb.message?.(ev.message || 'Um mecanismo cedeu.');
        this.audio?.spatial('power-up', this.distanceTo(ev.gx ?? this.local.x / TS, ev.gy ?? this.local.y / TS));
        this.cameras.main.flash(400, 216, 207, 154, false);
        break;
      }
      case 'keycardTaken':
        if (ev.playerId === this.myPlayerId) {
          cb.onKeycard?.();
          cb.toast?.('Cartão magnético adquirido. Encontre o leitor.');
        }
        break;
      case 'sigilTaken':
        cb.message?.(`${ev.name} foi tomado. Levem-no ao Altar.`);
        this.audio?.spatial('sigil-taken', 2);
        break;
      case 'sigilDelivered':
        cb.message?.(`Sigilo entregue (${ev.count}/${ev.total}).`);
        this.audio?.spatial('sigil-delivered', 2);
        break;
      case 'gateOpened':
        cb.message?.(`${ev.label || 'O portão'} cedeu.`);
        this.audio?.spatial('door', 4);
        this.view.hideDoor(ev.doorId, true);
        break;
      case 'door':
        this.audio?.spatial('door', 3);
        break;
      case 'damage':
        if (ev.playerId === this.myPlayerId) {
          this.cameras.main.shake(180, 0.004);
          this.audio?.spatial('attack', 1);
          cb.onDamage?.(ev);
        }
        break;
      case 'playerDied':
        if (ev.playerId === this.myPlayerId) {
          cb.onDeath?.();
          this.audio?.spatial('death', 0);
          this.audio?.cutAmbience(6);
        } else {
          cb.toast?.(`${ev.name} se perdeu.`);
        }
        break;
      case 'respawn':
        if (ev.playerId === this.myPlayerId) cb.onRespawn?.();
        break;
      case 'noteRead':
        if (ev.playerId === this.myPlayerId) cb.onNote?.(ev.note);
        break;
      case 'sessionComplete':
        cb.onComplete?.(ev);
        break;
      case 'attack':
        if (ev.playerId !== this.myPlayerId) this.audio?.spatial('attack', this.distanceToCreature(ev.creatureId));
        break;
      case 'telegraph':
        this.audio?.spatial(ev.sfx || 'knock', this.distanceTo(ev.gx / TS, ev.gy / TS));
        cb.whisper?.('Três batidas. Não responda em dois.');
        break;
      case 'learning':
        cb.whisper?.('Algo acabou de aprender onde você está.');
        break;
      case 'watcherMoved':
        cb.whisper?.('O Vigia estava aqui. Agora está mais perto.');
        break;
      case 'spawn':
        break;
      case 'leverReleased':
        if (ev.playerId === this.myPlayerId) cb.toast?.('Você soltou a alavanca.');
        break;
      case 'puzzleReset':
        cb.toast?.('O mecanismo voltou ao início.');
        break;
      case 'heardNoise':
        break;
      default:
        break;
    }
  }

  removeRemote(playerId) {
    const entry = this.remoteSprites.get(playerId);
    if (entry) {
      entry.container.destroy();
      this.remoteSprites.delete(playerId);
      this.playerNameSprites.delete(playerId);
    }
  }

  distanceTo(gx, gy) {
    return Math.hypot(this.local.x / TS - gx, this.local.y / TS - gy);
  }

  distanceToCreature(creatureId) {
    const entry = this.creatureSprites.get(creatureId);
    if (!entry) return 12;
    return Math.hypot(entry.container.x - this.local.x, entry.container.y - this.local.y) / TS;
  }

  // -------------------------------------------------------------------------
  // Efeitos de anomalia
  // -------------------------------------------------------------------------

  playAnomaly(a) {
    const cb = this.callbacks;
    const region = this.worldData.regions[a.region] || this.worldData.regions[0];
    cb.message?.(a.message);
    this.audio?.spatial('anomaly', 3);
    this.activeAnomalies.push({ id: a.id, kind: a.kind, endsAt: a.endsAt, params: a.params || {} });

    switch (a.client) {
      case 'flicker':
      case 'lightsDie':
        this.triggerFlicker(a.kind === 'lightsDie' ? 1.6 : 0.9);
        break;
      case 'shift':
      case 'moveroom':
        if (region) {
          this.view.regionOverlay(a.region, 0x2a2f38, 0.22, 1200);
          if (this.settings?.shake) this.cameras.main.shake(700, 0.0022);
        }
        break;
      case 'doorVanish':
        if (a.params.doorId) this.view.hideDoor(a.params.doorId, true);
        this.triggerFlicker(0.6);
        break;
      case 'murmur': {
        const phrases = [
          'Você ouviu seu nome na voz de outra pessoa.',
          'O corredor ao lado repetiu o seu nome.',
          'Alguém sussurrou de dentro da parede: "ainda aí?".',
        ];
        cb.whisper?.(phrases[Math.floor(Math.random() * phrases.length)]);
        break;
      }
      case 'repeat':
        if (this.settings?.shake) this.cameras.main.zoomTo(this.cameras.main.zoom * 0.96, 1600, 'Sine.easeInOut', true);
        this.time.delayedCall(3200, () => this.cameras.main.zoomTo(this.zoomForViewport(), 1400));
        break;
      case 'geometry':
        this.tweens.add({
          targets: this.cameras.main,
          rotation: 0.012,
          duration: 2600,
          yoyo: true,
          ease: 'Sine.inOut',
        });
        if (this.settings?.shake) this.cameras.main.shake(2600, 0.0012);
        break;
      case 'reverse':
        cb.whisper?.('O mundo inverteu. Andar para frente não é mais para frente.');
        this.triggerFlicker(0.45);
        break;
      case 'watcherWindow':
        this.triggerFlicker(0.5);
        cb.whisper?.('Algo molhou o vidro do lado de dentro.');
        break;
      case 'stepEcho':
        cb.whisper?.('Seus passos chegaram antes de você.');
        break;
      default:
        this.triggerFlicker(0.4);
    }
  }

  endAnomaly(id) {
    const idx = this.activeAnomalies.findIndex((a) => a.id === id);
    if (idx >= 0) {
      const a = this.activeAnomalies[idx];
      this.activeAnomalies.splice(idx, 1);
      if (a.kind === 'doorVanish' && a.params.doorId) {
        const st = this.doorStates.get(a.params.doorId);
        this.view.hideDoor(a.params.doorId, !!st && !st.open);
      }
    }
  }

  triggerFlicker(intensity = 1) {
    if (this.settings?.reduced) return;
    this.callbacks.flicker?.(intensity);
    for (const ls of this.lightSprites) {
      if (Math.random() < 0.4) ls.nextFlicker = this.time.now + Math.random() * 900;
    }
  }

  flashMechanism(mechId, action) {
    const sprite = this.view.interactSprites.get(mechId);
    if (!sprite) return;
    this.tweens.add({
      targets: sprite,
      scale: { from: 1.18, to: 1 },
      duration: 320,
      ease: 'Back.out',
    });
    if (action === 'breaker-on' || action === 'plate-press') {
      const flash = this.add.image(sprite.x, sprite.y, 'glow').setScale(0.6).setTint(0xd8cf9a).setDepth(DEPTH.effects);
      this.tweens.add({ targets: flash, alpha: 0, scale: 1.4, duration: 500, onComplete: () => flash.destroy() });
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  setupInput() {
    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      upArrow: Phaser.Input.Keyboard.KeyCodes.UP,
      downArrow: Phaser.Input.Keyboard.KeyCodes.DOWN,
      leftArrow: Phaser.Input.Keyboard.KeyCodes.LEFT,
      rightArrow: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      run: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      interact: Phaser.Input.Keyboard.KeyCodes.E,
      interactAlt: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });
    this.input.keyboard.on('keydown-E', () => this.tryInteract());
    this.input.keyboard.on('keydown-SPACE', () => this.tryInteract());
    this.input.on('pointerdown', (pointer) => {
      if (pointer.leftButtonDown()) this.tryInteract();
    });
    this.game.events.on('blur', () => {
      this.lastSentInput = { dx: 0, dy: 0, run: false };
      this.net.emitInput({ seq: ++this.inputSeq, dx: 0, dy: 0, run: false });
    });
  }

  readInput() {
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.leftArrow.isDown) dx -= 1;
    if (k.right.isDown || k.rightArrow.isDown) dx += 1;
    if (k.up.isDown || k.upArrow.isDown) dy -= 1;
    if (k.down.isDown || k.downArrow.isDown) dy += 1;
    const mag = Math.hypot(dx, dy);
    if (mag > 0) {
      dx /= mag;
      dy /= mag;
    }
    const run = k.run.isDown && mag > 0;
    return { dx, dy, run };
  }

  tryInteract() {
    if (!this.nearbyInteractable) return;
    const target = this.nearbyInteractable;
    this.audio?.spatial(target.kind === 'door' ? 'door' : 'step', 1);
    this.net.interact(target.id).then((res) => {
      if (!res?.ok) {
        if (res?.error) this.callbacks.toast?.(res.error);
        if (res?.hint) this.callbacks.toast?.(res.hint);
        this.audio?.spatial('breaker-error', 1);
      } else if (res.hint) {
        this.callbacks.toast?.(res.hint);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  update(time, delta) {
    if (!this.running) return;
    const dt = Math.min(0.05, delta / 1000);
    const input = this.readInput();
    this.updateLocalPlayer(dt, input);
    this.updateRemotes();
    this.updateCreatures(dt);
    this.updateLights(time, dt);
    this.updateInteractableProximity();
    this.updateAnomalyAmbience(time);
    this.sendInputIfNeeded(input, time);
  }

  updateLocalPlayer(dt, input) {
    const state = this.local;
    const reverse = this.activeAnomalies.some((a) => a.kind === 'reverse' && a.params.playerId === this.myPlayerId);
    const effective = reverse ? { dx: -input.dx, dy: -input.dy, run: input.run } : input;
    stepMovement(this.worldData, state, effective, dt, null);
    this.reconcileLocal(dt);
    state.running = effective.run && Math.hypot(state.vx, state.vy) > 40;
    if (effective.dx !== 0 || effective.dy !== 0) {
      state.dirX = effective.dx;
      state.dirY = effective.dy;
    }

    // passos
    const speed = Math.hypot(state.vx, state.vy);
    if (speed > 22) {
      const interval = state.running ? 240 : 400;
      if (this.time.now - this.lastStepAt > interval) {
        this.lastStepAt = this.time.now;
        this.audio?.spatial(state.running ? 'step-run' : 'step', 0.2);
      }
      this.localPlayer.walkPhase += (dt * speed) / 26;
    } else {
      this.localPlayer.walkPhase *= 0.9;
    }

    // suavização visual (o corpo segue o estado físico com um leve atraso)
    const visual = this.localPlayer.container;
    visual.x += (state.x - visual.x) * Math.min(1, dt * 22);
    visual.y += (state.y - visual.y) * Math.min(1, dt * 22);

    const bob = Math.sin(this.localPlayer.walkPhase) * 1.3;
    this.localPlayer.body.setY(bob - 1);
    this.localPlayer.body.setScale(state.running ? 1.04 : 1);
    this.localPlayer.halo.setAlpha(0.1 + Math.min(0.14, speed / 1400));
    // leve inclinação na direção do movimento
    const tilt = Phaser.Math.Clamp(state.vx / 900, -0.12, 0.12);
    this.localPlayer.body.setRotation(tilt);

    // tema por região (ambiência)
    const theme = this.themeAtWorld(Math.floor(state.x / TS), Math.floor(state.y / TS));
    if (theme !== this.currentTheme) {
      this.currentTheme = theme;
      this.audio?.setAmbience(theme);
      this.callbacks.onRegionChange?.(theme);
    }
  }

  /**
   * Reconciliação suave com a posição autoritativa.
   *
   * A predição roda a MESMA física do servidor, então a divergência costuma ser
   * de poucos pixels (latência/jitter). Corrigimos por fração por frame, sem
   * "puxão": erros pequenos são absorvidos em ~0,2 s; erros grandes (teleporte,
   * respawn, porta fechada) são corrigidos imediatamente.
   */
  reconcileLocal(dt) {
    const auth = this.net?.ownState?.();
    if (!auth) return;
    const dx = auth.x - this.local.x;
    const dy = auth.y - this.local.y;
    const err = Math.hypot(dx, dy);
    this.lastAuthError = err;
    if (err < 2) return;
    if (err > TS * 3) {
      // desincronização real: aceita a posição do servidor
      this.local.x = auth.x;
      this.local.y = auth.y;
      this.local.vx = 0;
      this.local.vy = 0;
      this.corrected.x += 1;
      return;
    }
    const k = Math.min(1, dt * 7);
    this.local.x += dx * k;
    this.local.y += dy * k;
  }

  ensureRemoteSprite(id) {
    if (this.remoteSprites.has(id) || id === this.myPlayerId) return;
    const info = (this.callbacks.playerInfo?.(id)) || {};
    this.createPlayerSprite(id, info.name || 'Alguém', info.color ?? 0xb9b4a5, false);
  }

  updateRemotes() {
    const now = performance.now();
    // cria sprites para jogadores que apareceram no snapshot
    for (const id of this.net.remote.keys()) this.ensureRemoteSprite(id);
    for (const [id, entry] of this.remoteSprites) {
      const interp = this.net.interpolated(id, now);
      if (!interp) continue;
      entry.container.x += (interp.x - entry.container.x) * 0.35;
      entry.container.y += (interp.y - entry.container.y) * 0.35;
      entry.container.setVisible(!interp.dead);
      entry.body.setRotation(interp.run ? Phaser.Math.Clamp((interp.x - entry.container.x) / 40, -0.1, 0.1) : 0);
      entry.label.setAlpha(interp.dc ? 0.35 : 0.9);
      entry.ring.setStrokeStyle(1, entry.color, interp.dc ? 0.18 : 0.4);
      // jogador muito longe: esmaece (leitura de equipe)
      const dist = Phaser.Math.Distance.Between(this.local.x, this.local.y, entry.container.x, entry.container.y);
      entry.container.setAlpha(dist > 1900 ? 0.28 : 1);
    }
    // remove sprites órfãos (jogadores que saíram do estado compartilhado)
    const living = new Set(Array.from(this.net.remote.keys()));
    for (const id of Array.from(this.remoteSprites.keys())) {
      if (!living.has(id) && this.time.now - (this.remoteSprites.get(id).createdAt || 0) > 1500) {
        // mantém até o evento de saída; sem evento, remove após longo timeout
      }
    }
  }

  updateCreatures(dt) {
    void dt;
    for (const [, entry] of this.creatureSprites) {
      if (entry.targetX == null) continue;
      const dx = entry.targetX - entry.container.x;
      const dy = entry.targetY - entry.container.y;
      const dist = Math.hypot(dx, dy);
      // interpolação com atraso; "teletransporte" (não observado) fica instantâneo
      if (dist > TS * 6) {
        entry.container.setPosition(entry.targetX, entry.targetY);
      } else {
        entry.container.x += dx * 0.35;
        entry.container.y += dy * 0.35;
      }
      const near = Phaser.Math.Distance.Between(this.local.x, this.local.y, entry.container.x, entry.container.y);
      if (near < TS * 7) {
        entry.sprite.setScale(0.5 + Math.sin(this.time.now / 420) * 0.012);
        if (entry.state === 8 && this.time.now - this.tensionAt > 1400) {
          this.tensionAt = this.time.now;
          this.audio?.tensionPulse(1 - near / (TS * 7));
        }
      }
    }
  }

  updateLights(time) {
    const cam = this.cameras.main;
    const viewLeft = cam.worldView.x;
    const viewRight = cam.worldView.right;
    const viewTop = cam.worldView.y;
    const viewBottom = cam.worldView.bottom;
    let budget = 26;
    for (const ls of this.lightSprites) {
      const inView = ls.light.x > viewLeft - 200 && ls.light.x < viewRight + 200 && ls.light.y > viewTop - 200 && ls.light.y < viewBottom + 200;
      if (!inView || budget <= 0) {
        ls.sprite.setVisible(false);
        continue;
      }
      budget--;
      ls.sprite.setVisible(true);
      let alpha = ls.base * 0.42;
      if (ls.flicker) {
        if (time > ls.nextFlicker) ls.nextFlicker = time + 120 + Math.random() * 2400;
        if (time < ls.nextFlicker && time > ls.nextFlicker - 140) alpha *= 0.15 + Math.random() * 0.3;
      }
      const distToPlayer = Phaser.Math.Distance.Between(this.local.x, this.local.y, ls.light.x, ls.light.y);
      const proximity = Phaser.Math.Clamp(1 - distToPlayer / 900, 0.25, 1);
      ls.sprite.setAlpha(alpha * proximity);
    }
  }

  updateInteractableProximity() {
    let best = null;
    let bestDist = Infinity;
    const px = this.local.x;
    const py = this.local.y;

    const consider = (id, gx, gy, kind, label, extra) => {
      const dist = Math.hypot(px - (gx + 0.5) * TS, py - (gy + 0.5) * TS);
      if (dist < 2.4 * TS && dist < bestDist) {
        bestDist = dist;
        best = { id, gx, gy, kind, label, dist, ...(extra || {}) };
      }
    };

    for (const item of this.worldData.interactables || []) {
      if (!item.visible && item.kind !== 'keycardItem') continue;
      if (item.kind === 'altar') {
        consider(item.id, item.gx, item.gy, 'altar', 'Depositar sigilos no Altar');
        continue;
      }
      if (item.kind === 'keycardItem') {
        consider(item.id, item.gx, item.gy, 'keycardItem', 'Pegar cartão magnético');
        continue;
      }
      if (item.kind === 'keycardReader') {
        consider(item.id, item.gx, item.gy, 'keycardReader', 'Usar leitor de cartão');
        continue;
      }
      consider(item.id, item.gx, item.gy, item.kind, item.label || 'Interagir');
    }

    for (const sigil of this.worldData.sigils || []) {
      const st = this.shared?.sigilStates?.find((s) => s.id === sigil.id);
      if (!st?.revealed || st?.taken || st?.delivered) continue;
      consider(sigil.id, sigil.gx, sigil.gy, 'sigil', `Tomar ${sigil.name || 'sigilo'}`);
    }

    for (const note of this.worldData.notes || []) {
      consider(note.id, note.gx, note.gy, 'note', `Ler: ${note.title || 'anotação'}`, { title: note.title });
    }

    for (const door of this.worldData.doors) {
      if (door.kind === 'gate') {
        const st = this.doorStates.get(door.id);
        if (st?.open) continue;
        consider(door.id, door.gx, door.gy, 'gate', `${door.label || 'Portão'} — exige ${door.requirement?.count || 0} sigilo(s)`);
      } else {
        consider(door.id, door.gx, door.gy, 'door', 'Abrir/fechar porta');
      }
    }

    for (const prop of this.worldData.props || []) {
      if (prop.contains) consider(prop.id, prop.gx, prop.gy, 'prop', 'Revistar armário');
    }

    this.nearbyInteractable = best;
    this.callbacks.onPrompt?.(best ? { id: best.id, label: this.promptLabel(best), kind: best.kind } : null);
  }

  promptLabel(item) {
    if (item.kind === 'gate') return item.label;
    if (item.kind === 'door') return 'Abrir/fechar porta';
    if (item.kind === 'sigil') return 'Tomar sigilo';
    if (item.kind === 'altar') return 'Depositar sigilos';
    if (item.kind === 'note') return item.label || 'Ler anotação';
    if (item.kind === 'prop') return 'Revistar';
    if (item.kind === 'keycardItem') return 'Pegar cartão magnético';
    if (item.kind === 'keycardReader') return 'Usar leitor';
    // mecanismos nomeados vêm do gerador (Válvula Alfa, Disjuntor 2, Sino…)
    if (['valve', 'breaker', 'lever', 'plate', 'bell', 'choirSeal'].includes(item.kind)) return item.label || 'Acionar mecanismo';
    if (item.kind === 'altar') return 'Depositar sigilos';
    return item.label || 'Interagir';
  }

  updateAnomalyAmbience(time) {
    // tensão global: quando há anomalia ativa, a ambiência respira diferente
    const hasAnomaly = this.activeAnomalies.length > 0;
    if (hasAnomaly && time - this.flickerAt > 2000) {
      this.flickerAt = time;
      if (Math.random() < 0.35) this.triggerFlicker(0.3);
    }
  }

  sendInputIfNeeded(input, time) {
    const changed = input.dx !== this.lastSentInput.dx || input.dy !== this.lastSentInput.dy || input.run !== this.lastSentInput.run;
    if (changed || time - this.lastInputSentAt > 120) {
      if (!changed && Math.hypot(this.local.vx, this.local.vy) < 4) {
        // parado: economiza banda
        if (!this.sentStop) {
          this.net.emitInput({ seq: ++this.inputSeq, dx: 0, dy: 0, run: false });
          this.sentStop = true;
        }
        return;
      }
      this.net.emitInput({
        seq: ++this.inputSeq,
        dx: this.round2(input.dx),
        dy: this.round2(input.dy),
        run: input.run,
        look: { x: this.round2(this.local.dirX), y: this.round2(this.local.dirY) },
      });
      this.lastSentInput = input;
      this.lastInputSentAt = time;
      this.sentStop = input.dx === 0 && input.dy === 0;
    }
  }

  round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** Reposiciona o jogador local após respawn. */
  teleportTo(x, y) {
    this.local.x = x;
    this.local.y = y;
    this.local.vx = 0;
    this.local.vy = 0;
    this.localPlayer.container.setPosition(x, y);
    this.cameras.main.centerOn(x, y);
    this.cameras.main.fadeIn(500, 3, 4, 5);
  }

  getRemoteStates() {
    const out = [];
    for (const [id, entry] of this.remoteSprites) {
      out.push({ id, x: entry.container.x, y: entry.container.y, name: entry.label.text, color: entry.color });
    }
    return out;
  }

  setPaused(paused) {
    this.running = !paused;
    if (paused) {
      this.net.emitInput({ seq: ++this.inputSeq, dx: 0, dy: 0, run: false });
    }
  }

  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.darkLayer) this.darkLayer.setAlpha(0.2 + settings.darkness * 0.6);
    if (this.dust) this.dust.setVisible(!settings.reduced);
  }

  teardown() {
    this.scale.off('resize', this.handleResize, this);
    this.net.onShared = null;
    for (const [, entry] of this.creatureSprites) entry.container.destroy();
    this.creatureSprites.clear();
    for (const [, entry] of this.remoteSprites) entry.container.destroy();
    this.remoteSprites.clear();
    this.view?.destroy();
  }
}

export { DEPTH, cssColor, SPEED_RUN, circleBlocked, RADIUS, TILE_SIZE };
