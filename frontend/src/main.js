/**
 * NULLSCAPE — Bootstrap do cliente.
 *
 * Orquestra: telas (menu/lobby/jogo), rede (Socket.IO), áudio e Phaser.
 * Nada de framework: DOM direto, eventos explícitos.
 */

import './styles/base.css';
import './styles/hud.css';

import Phaser from 'phaser';
import { NetClient } from './net/socket.js';
import { ScreenManager } from './ui/screens.js';
import { Hud } from './ui/hud.js';
import { AudioEngine } from './game/audio.js';
import { GameScene } from './game/GameScene.js';
import {
  loadSettings,
  saveSettings,
  applySettingsToDom,
  DEFAULT_SETTINGS,
  recordDiscovery,
  loadCodex,
} from './ui/settings.js';
import { THEMES } from '../../shared/world/themes.js';
import { hydrateWorld } from '../../shared/world/generator.js';
import { CREATURE_DEFS } from '../../shared/sim/creatures.js';
import { ANOMALY_DEFS } from '../../shared/sim/anomalies.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.__NULLSCAPE_SERVER__ || '';

const QUOTES = [
  'O corredor tem o mesmo comprimento que o seu passo.',
  'Se uma sala se repetir, não entre duas vezes.',
  'Toda porta abre para o mesmo lugar até que não abra.',
  'O silêncio também é uma forma de resposta.',
  'Ninguém construiu este lugar. Ele foi encontrado.',
  'Você já esteve neste corredor. Foi você que esteve.',
];

class App {
  constructor() {
    this.settings = loadSettings();
    this.screens = new ScreenManager();
    this.hud = new Hud();
    this.audio = new AudioEngine({
      volume: this.settings.volume / 100,
      ambience: this.settings.ambience / 100,
      mute: this.settings.mute,
      reduced: this.settings.reduced,
    });
    this.game = null;
    this.scene = null;
    this.net = null;
    this.lobby = null;
    this.worldData = null;
    this.shared = null;
    this.codex = loadCodex();
    this.players = new Map();
    this.myId = null;
    this.inGame = false;
    this.paused = false;
    this.sessionStart = 0;
    this.lastPrompt = null;
    this.ready = false;
    this.reconnectAttempts = 0;
    this.seenAnomalies = new Set(this.codex.anomalies?.map((a) => a.id) || []);

    this.bindDom();
    applySettingsToDom(this.settings);
    this.applySettingsToForm();
    this.initQuotes();
    this.initNetwork();
    this.initSettingsHandlers();
    this.initCodex();
  }

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------

  bindDom() {
    const $ = (id) => document.getElementById(id);

    // nome
    const nameInput = $('input-name');
    nameInput.value = this.settings.name || '';
    nameInput.addEventListener('change', () => {
      this.settings.name = nameInput.value.trim().slice(0, 18);
      saveSettings(this.settings);
      if (this.net) this.net.name = this.settings.name || 'Anônimo';
    });

    // navegação
    $('btn-quickplay').addEventListener('click', () => this.quickPlay());
    $('btn-create').addEventListener('click', () => this.screens.show('create'));
    $('btn-join').addEventListener('click', () => this.screens.show('join'));
    $('btn-settings-menu').addEventListener('click', () => this.screens.show('settings'));
    $('btn-codex').addEventListener('click', () => {
      this.renderCodex();
      this.screens.show('codex');
    });
    $('btn-help').addEventListener('click', () => this.screens.show('help'));
    $('btn-credits').addEventListener('click', () => this.screens.show('credits'));
    $('btn-credits-back').addEventListener('click', () => this.screens.back());
    $('btn-help-back').addEventListener('click', () => this.screens.back());
    $('btn-codex-back').addEventListener('click', () => this.screens.back());
    $('btn-refresh-rooms').addEventListener('click', () => this.refreshRooms());

    // criar sala
    $('btn-create-cancel').addEventListener('click', () => this.screens.back());
    $('btn-create-confirm').addEventListener('click', () => this.createRoom());

    // entrar por código
    $('btn-join-cancel').addEventListener('click', () => this.screens.back());
    $('btn-join-confirm').addEventListener('click', () => this.joinByCode());
    $('input-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    $('input-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinByCode();
    });

    // lobby
    $('btn-lobby-leave').addEventListener('click', () => this.leaveRoom());
    $('btn-lobby-start').addEventListener('click', () => this.startGame());
    $('lobby-code-value').addEventListener('click', () => this.copyCode());

    // HUD
    $('btn-pause').addEventListener('click', () => this.togglePause(true));
    $('btn-resume').addEventListener('click', () => this.togglePause(false));
    $('btn-pause-settings').addEventListener('click', () => this.screens.show('settings'));
    $('btn-pause-leave').addEventListener('click', () => this.leaveRoom());
    $('btn-note-close').addEventListener('click', () => this.hud.hideNote());
    $('btn-respawn').addEventListener('click', () => this.net?.respawn().then((ok) => ok && this.hud.hideDeath()));
    $('btn-ending-continue').addEventListener('click', () => this.hud.hideEnding());
    $('btn-ending-leave').addEventListener('click', () => this.leaveRoom());

    // settings
    $('btn-settings-back').addEventListener('click', () => this.screens.back());
    $('btn-settings-reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS, name: this.settings.name };
      saveSettings(this.settings);
      this.applySettingsToForm();
      applySettingsToDom(this.settings);
      this.audio.applySettings({
        volume: this.settings.volume / 100,
        ambience: this.settings.ambience / 100,
        mute: this.settings.mute,
        reduced: this.settings.reduced,
      });
      this.scene?.applySettings(this.settings);
    });

    // teclado global
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.hud.noteOverlay.hidden) {
          this.hud.hideNote();
          return;
        }
        if (this.screens.current === 'game') {
          this.togglePause(!this.paused);
        } else if (['settings', 'help', 'credits', 'codex', 'create', 'join'].includes(this.screens.current)) {
          this.screens.back();
        }
      }
      if (e.key === 'Tab' && this.screens.current === 'game') {
        e.preventDefault();
        this.showInventoryToast();
      }
    });

    // primeiro gesto inicia o áudio
    const unlock = () => {
      this.audio.start().then(() => {
        this.audio.applySettings({
          volume: this.settings.volume / 100,
          ambience: this.settings.ambience / 100,
          mute: this.settings.mute,
          reduced: this.settings.reduced,
        });
      });
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  applySettingsToForm() {
    const $ = (id) => document.getElementById(id);
    $('set-grain').value = this.settings.grain;
    $('set-grain-out').textContent = `${this.settings.grain}%`;
    $('set-dark').value = this.settings.darkness;
    $('set-dark-out').textContent = `${this.settings.darkness}%`;
    $('set-fog').value = this.settings.fog;
    $('set-fog-out').textContent = `${this.settings.fog}%`;
    $('set-volume').value = this.settings.volume;
    $('set-volume-out').textContent = `${this.settings.volume}%`;
    $('set-ambience').value = this.settings.ambience;
    $('set-ambience-out').textContent = `${this.settings.ambience}%`;
    $('set-reduced').checked = !!this.settings.reduced;
    $('set-shake').checked = !!this.settings.shake;
    $('set-mute').checked = !!this.settings.mute;
  }

  initSettingsHandlers() {
    const bind = (id, key, outId, transform = (v) => v) => {
      const el = document.getElementById(id);
      const out = document.getElementById(outId);
      el.addEventListener('input', () => {
        this.settings[key] = Number(el.value);
        if (out) out.textContent = `${transform(this.settings[key])}%`;
        saveSettings(this.settings);
        applySettingsToDom(this.settings);
        this.audio.applySettings({
          volume: this.settings.volume / 100,
          ambience: this.settings.ambience / 100,
        });
        this.scene?.applySettings(this.settings);
      });
    };
    bind('set-grain', 'grain', 'set-grain-out');
    bind('set-dark', 'darkness', 'set-dark-out');
    bind('set-fog', 'fog', 'set-fog-out');
    bind('set-volume', 'volume', 'set-volume-out');
    bind('set-ambience', 'ambience', 'set-ambience-out');

    const toggles = [
      ['set-reduced', 'reduced'],
      ['set-shake', 'shake'],
      ['set-mute', 'mute'],
    ];
    for (const [id, key] of toggles) {
      document.getElementById(id).addEventListener('change', (e) => {
        this.settings[key] = e.target.checked;
        saveSettings(this.settings);
        applySettingsToDom(this.settings);
        this.audio.applySettings({ mute: this.settings.mute, reduced: this.settings.reduced });
        this.scene?.applySettings(this.settings);
      });
    }
  }

  initQuotes() {
    const el = document.getElementById('menu-quote');
    let i = Math.floor(Math.random() * QUOTES.length);
    const set = () => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.textContent = QUOTES[i % QUOTES.length];
        el.style.opacity = '1';
        i++;
      }, 420);
    };
    el.style.transition = 'opacity 420ms ease';
    set();
    setInterval(() => {
      if (this.screens.current === 'menu') set();
    }, 11000);
  }

  // -------------------------------------------------------------------------
  // Rede
  // -------------------------------------------------------------------------

  initNetwork() {
    this.net = new NetClient({
      url: SERVER_URL,
      name: this.settings.name || 'Anônimo',
      onStatus: (status) => this.handleNetStatus(status),
      onRooms: (rooms) => this.renderRooms(rooms),
      onLobby: (lobby) => this.handleLobby(lobby),
      onEvent: (ev) => this.handleNetEvent(ev),
      onKick: (reason) => this.handleKick(reason),
    });
    this.net.connect();
    this.setServerStatus('connecting', 'conectando ao servidor');
  }

  handleNetStatus(status) {
    const banner = document.getElementById('conn-banner');
    const bannerText = document.getElementById('conn-banner-text');
    if (status.connected === true) {
      this.setServerStatus('online', 'servidor online');
      banner.hidden = true;
      this.hud.setConnection({ connected: true, latency: this.net.latency || 0 });
    }
    if (status.connected === false) {
      this.setServerStatus('offline', 'sem conexão');
      this.hud.setConnection({ connected: false });
      if (this.inGame || this.screens.current === 'lobby') {
        banner.hidden = false;
        bannerText.textContent = 'Conexão perdida. Tentando reconectar…';
      }
    }
    if (status.latency != null) {
      this.hud.setConnection({ connected: this.net.connected, latency: status.latency });
    }
    if (status.reconnected) {
      banner.hidden = true;
      this.hud.toast('Reconectado. Seu corpo continuou aqui.');
      if (this.inGame) {
        this.scene?.net && (this.scene.net = this.net);
      } else if (this.screens.current === 'lobby') {
        // permanece no lobby com estado restaurado
      }
    }
    if (status.rejoinFailed) {
      this.hud.toast('A sala não existe mais.');
    }
  }

  handleKick(reason) {
    this.inGame = false;
    this.destroyGame();
    this.leaveToMenu(`Sessão encerrada: ${reason}`);
  }

  setServerStatus(kind, text) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');
    dot.className = `dot ${kind === 'online' ? 'online' : kind === 'offline' ? '' : 'warn'}`;
    label.textContent = text;
  }

  renderRooms(rooms) {
    const list = document.getElementById('rooms-list');
    if (!list) return;
    this.roomsCache = rooms;
    if (!rooms.length) {
      list.innerHTML = '<p class="muted small">Nenhuma sala ativa. Crie uma, ou entre em uma sala pública.</p>';
      return;
    }
    list.innerHTML = '';
    for (const room of rooms) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'room-card';
      const name = document.createElement('span');
      name.className = 'room-card-name';
      name.textContent = room.name;
      const players = document.createElement('span');
      players.className = 'room-card-players';
      players.textContent = `${room.players}/${room.max}`;
      const meta = document.createElement('span');
      meta.className = 'room-card-meta';
      meta.textContent = `${room.region} · semente ${room.seed} · ${room.hostName}`;
      card.append(name, players, meta);
      card.addEventListener('click', () => this.joinRoom({ code: room.code }));
      list.appendChild(card);
    }
  }

  async refreshRooms() {
    const res = await this.net.refreshRooms();
    if (res?.rooms) this.renderRooms(res.rooms);
  }

  // -------------------------------------------------------------------------
  // Fluxo de salas
  // -------------------------------------------------------------------------

  async quickPlay() {
    this.persistName();
    this.setServerStatus('connecting', 'procurando sala');
    await this.net.connect();
    const rooms = this.roomsCache || [];
    const open = rooms.filter((r) => r.players < r.max && !r.private).sort((a, b) => b.players - a.players);
    if (open.length) {
      const res = await this.joinRoom({ code: open[0].code });
      if (res?.ok) return;
    }
    const created = await this.net.createRoom({ name: 'Sala de espera', private: false });
    if (!created.ok) {
      this.hud.toast(created.error || 'não foi possível criar uma sala');
      return;
    }
    this.enterLobby(created);
  }

  persistName() {
    const input = document.getElementById('input-name');
    const name = input.value.trim().slice(0, 18) || `Anônimo${Math.floor(Math.random() * 900 + 100)}`;
    input.value = name;
    this.settings.name = name;
    saveSettings(this.settings);
    this.net.name = name;
    return name;
  }

  async createRoom() {
    const name = this.persistName();
    const roomName = document.getElementById('input-room-name').value.trim().slice(0, 28);
    const seed = document.getElementById('input-seed').value.trim().toUpperCase().replace(/[^A-Z0-9\-:]/g, '');
    const isPrivate = document.getElementById('check-private').checked;
    const errEl = document.getElementById('create-error');
    errEl.textContent = '';
    const res = await this.net.createRoom({ name: roomName, seed, private: isPrivate });
    if (!res.ok) {
      errEl.textContent = res.error || 'não foi possível criar a sala';
      return;
    }
    this.enterLobby(res);
  }

  async joinByCode() {
    const name = this.persistName();
    void name;
    const code = document.getElementById('input-code').value.trim().toUpperCase();
    const errEl = document.getElementById('join-error');
    errEl.textContent = '';
    if (code.length < 4) {
      errEl.textContent = 'o código tem 6 caracteres';
      return;
    }
    const res = await this.joinRoom({ code });
    if (!res?.ok) errEl.textContent = res?.error || 'sala não encontrada';
  }

  async joinRoom({ code, roomId }) {
    this.persistName();
    const res = await this.net.joinRoom({ code, roomId });
    if (!res.ok) {
      this.hud.toast(res.error || 'não foi possível entrar');
      return res;
    }
    this.enterLobby(res);
    return res;
  }

  enterLobby(res) {
    // O servidor envia o mundo SERIALIZADO (grids em RLE). A predição local roda
    // a física compartilhada, que precisa de grids com get(): hidratamos aqui,
    // uma única vez por mundo recebido.
    if (res.world) this.worldData = hydrateWorld(res.world);
    this.shared = res.state || this.shared;
    this.myId = res.playerId;
    this.lobby = res.lobby || null;
    this.myColor = res.color || 0xe8e4d8;
    this.inGame = false;
    this.screens.clearStack();
    this.screens.show('lobby');
    this.renderLobby();
    this.preloadWorld();
    document.getElementById('conn-banner').hidden = true;
  }

  preloadWorld() {
    // A cena é criada no start, mas os dados já estão prontos.
    if (!this.worldData) return;
  }

  handleLobby(lobby) {
    if (!lobby) return;
    this.lobby = lobby;
    if (this.screens.current === 'lobby') this.renderLobby();
  }

  renderLobby() {
    const lobby = this.lobby;
    const world = this.worldData;
    document.getElementById('lobby-room-name').textContent = lobby?.name || 'Sala';
    document.getElementById('lobby-seed').textContent = `semente · ${lobby?.seed || world?.seed || '—'}`;
    document.getElementById('lobby-code-value').textContent = lobby?.code || '······';
    const count = lobby?.players?.length || 0;
    document.getElementById('lobby-count').textContent = `${count} / ${lobby?.max || 6}`;
    document.getElementById('btn-lobby-start').disabled = count === 0;

    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';
    for (const p of lobby?.players || []) {
      const li = document.createElement('li');
      li.className = `player-row${p.disconnected ? ' disconnected' : ''}`;
      const swatch = document.createElement('span');
      swatch.className = 'player-swatch';
      const color = `#${(p.color >>> 0).toString(16).padStart(6, '0')}`;
      swatch.style.background = color;
      swatch.style.color = color;
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = p.id === this.myId ? `${p.name} (você)` : p.name;
      li.append(swatch, name);
      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'player-badge host';
        badge.textContent = 'anfitrião';
        li.appendChild(badge);
      }
      list.appendChild(li);
    }

    // briefing do mundo
    if (world) {
      const regions = document.getElementById('lobby-regions');
      regions.innerHTML = '';
      world.regions.forEach((region, i) => {
        const theme = THEMES[region.themeId] || THEMES.threshold;
        const line = document.createElement('div');
        line.className = 'region-line';
        const idx = document.createElement('span');
        idx.className = 'idx';
        idx.textContent = `REGIÃO ${i + 1}`;
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = `#${(theme.palette.glow >>> 0).toString(16).padStart(6, '0')}`;
        swatch.style.opacity = '0.7';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = theme.label;
        const gate = document.createElement('span');
        gate.className = 'gate';
        gate.textContent = i === 0 ? 'início' : `portão: ${i} sigilo${i > 1 ? 's' : ''}`;
        line.append(idx, swatch, name, gate);
        regions.appendChild(line);
      });

      const mech = document.getElementById('lobby-mechanic');
      const kinds = {
        valvePair: 'Duas válvulas em salas diferentes precisam ser giradas quase ao mesmo tempo.',
        breakerOrder: 'Três disjuntores em sequência. A ordem está escrita em algum lugar.',
        holdLever: 'Um segura a alavanca. Outro pisa no botão. Ao mesmo tempo.',
        pressurePlates: 'Duas placas de pressão ocupadas simultaneamente.',
        keycard: 'Um cartão esquecido num armário abre um leitor.',
        silenceChoir: 'Toque o sino três vezes, sem pressa. O coro escuta a pressa.',
      };
      mech.innerHTML = `<strong>Quebra-cabeças desta sessão</strong>${world.puzzles
        .map((p) => `<div class="region-line"><span class="idx">${p.region + 1}</span><span class="name">${kinds[p.kind] || p.kind}</span></div>`)
        .join('')}`;

      const loadout = document.getElementById('lobby-loadout');
      loadout.innerHTML = '';
      const secrets = world.regions.filter((r) => r.rooms.some((room) => room.secret)).length;
      const chips = [
        `${world.regions.reduce((n, r) => n + r.rooms.length, 0)} salas`,
        `${world.doors.length} portas`,
        `${world.notes.length} anotações`,
        `${secrets} câmaras secretas`,
        `${world.doors.filter((d) => d.kind === 'gate').length} portões`,
      ];
      for (const text of chips) {
        const chip = document.createElement('span');
        chip.className = 'loadout-chip';
        chip.textContent = text;
        loadout.appendChild(chip);
      }
    }
  }

  async copyCode() {
    const code = this.lobby?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.hud.toast(`Código ${code} copiado.`);
    } catch {
      this.hud.toast(`Código: ${code}`);
    }
  }

  startGame() {
    if (!this.worldData) return;
    this.inGame = true;
    this.sessionStart = Date.now();
    this.screens.show('game');
    this.hud.show();
    this.hud.setRegion(this.worldData.regions[0]?.themeId || 'threshold');
    this.hud.setTeam(
      (this.lobby?.players || []).map((p) => ({ ...p })),
      this.myId,
    );
    this.hud.setVitals(100, false);
    this.hud.setSigils({ delivered: 0, total: 4 });
    this.updateObjective(this.shared);
    this.createPhaser();
    this.audio.start();
  }

  createPhaser() {
    this.destroyGame();
    const config = {
      type: Phaser.AUTO,
      parent: 'game-root',
      backgroundColor: '#050607',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: window.innerWidth,
        height: window.innerHeight,
      },
      render: { antialias: false, pixelArt: false, powerPreference: 'high-performance' },
      physics: { default: null },
      scene: [GameScene],
      audio: { noAudio: true },
      banner: false,
      disableContextMenu: true,
    };
    const sceneData = {
      world: this.worldData,
      shared: this.shared,
      net: this.net,
      audio: this.audio,
      settings: this.settings,
      callbacks: this.sceneCallbacks(),
    };
    this.game = new Phaser.Game({ ...config, scene: [] });
    const boot = () => {
      if (!this.game) return;
      this.game.scene.add('game', GameScene, true, sceneData);
      this.scene = this.game.scene.getScene('game');
      this.scene?.applySettings(this.settings);
    };
    if (this.game.isBooted) boot();
    else this.game.events.once('ready', boot);
  }

  destroyGame() {
    if (this.game) {
      this.game.destroy(true);
      this.game = null;
      this.scene = null;
    }
    const root = document.getElementById('game-root');
    if (root) root.innerHTML = '';
  }

  sceneCallbacks() {
    return {
      playerInfo: (id) => {
        const p = this.players.get(id) || this.lobby?.players?.find((x) => x.id === id);
        return { name: p?.name || 'Alguém', color: p?.color };
      },
      onKeycard: () => {
        this.myKeycard = true;
        this.hud.toast('Cartão magnético em mãos.');
      },
      onPlayerJoined: (player) => {
        if (!player) return;
        this.players.set(player.id, player);
        this.hud.toast(`${player.name} entrou no mundo.`);
        this.syncTeamHud();
        this.scene?.createPlayerSprite?.(player.id, player.name, player.color, false);
      },
      onPlayersChanged: () => this.syncTeamHud(),
      onShared: (shared) => {
        this.shared = shared;
        this.hud.setSigils({
          delivered: shared.sigils || 0,
          total: 4,
          revealed: (shared.sigilStates || []).filter((s) => s.revealed && !s.taken).map((s) => s.id),
          taken: (shared.sigilStates || []).filter((s) => s.taken && !s.delivered).map((s) => s.id),
          mine: [],
        });
        this.hud.setInventory(this.computeInventory(shared));
        this.updateObjective(shared);
        const me = shared.players?.find?.((p) => p.i === this.myId);
        void me;
      },
      onPrompt: (prompt) => {
        this.lastPrompt = prompt;
        this.hud.setPrompt(prompt);
      },
      onRegionChange: (themeId) => this.hud.setRegion(themeId),
      onDamage: (ev) => {
        this.hud.setVitals(ev.hp, ev.hp <= 0);
        this.hud.flicker(0.5);
      },
      onDeath: () => {
        this.hud.setVitals(0, true);
        this.hud.showDeath(9);
      },
      onRespawn: () => {
        this.hud.hideDeath();
        this.hud.setVitals(100, false);
        this.hud.toast('Você volta ao início. O corredor não mudou. Ou mudou.');
      },
      onNote: (note) => {
        this.hud.showNote(note);
        recordDiscovery('notes', note.id, { title: note.title });
      },
      onAnomaly: (a) => {
        this.discoverAnomaly(a);
        this.hud.flicker(a.rarity === 'impossível' ? 1 : 0.5);
      },
      onPuzzleSolved: (ev) => {
        recordDiscovery('puzzles', ev.puzzleId, { kind: ev.kind });
        this.hud.toast(ev.message || 'Mecanismo resolvido.');
        if (ev.sigilId) this.shared?.sigilStates?.forEach((s) => s.id === ev.sigilId && (s.revealed = true));
      },
      onComplete: (ev) => {
        this.hud.showEnding(ev, Date.now() - this.sessionStart);
        recordDiscovery('runs', 'complete', { at: Date.now() });
      },
      toast: (text) => this.hud.toast(text),
      message: (text) => this.hud.showMessage(text),
      whisper: (text) => this.hud.whisper(text),
      flicker: (strength) => this.hud.flicker(strength),
    };
  }

  computeInventory(shared) {
    const items = [];
    const mine = (shared?.sigilStates || []).filter((s) => s.taken && !s.delivered);
    for (const s of mine) {
      const idx = (s.id.split('-')[1] || '0');
      items.push({ glyph: '◇', label: `Sigilo ${['I', 'II', 'III', 'IV'][Number(idx)] || idx}` });
    }
    if (this.myKeycard) items.push({ glyph: '▤', label: 'Cartão magnético' });
    return items;
  }

  updateObjective(shared) {
    if (!shared) return;
    const revealed = (shared.sigilStates || []).filter((s) => s.revealed).length;
    const taken = (shared.sigilStates || []).filter((s) => s.taken && !s.delivered).length;
    const delivered = shared.sigils || 0;
    let text;
    if (shared.completed) text = 'O ciclo se fechou. Vocês ainda podem explorar.';
    else if (delivered >= 3) text = 'Levem o último sigilo ao Altar na última região.';
    else if (!revealed) text = 'Resolvam o primeiro mecanismo. As anotações explicam as regras.';
    else if (revealed > taken + delivered) text = `${revealed} mecanismos cedederam. Recolham os sigilos revelados.`;
    else text = `${delivered}/4 sigilos entregues. O próximo portão precisa de mais sigilos.`;
    this.hud.setObjective(text);
  }

  syncTeamHud() {
    const players = Array.from(this.players.values());
    if (!players.length && this.lobby) {
      for (const p of this.lobby.players) this.players.set(p.id, p);
    }
    const positions = this.scene?.getRemoteStates?.() || [];
    this.hud.setTeam(Array.from(this.players.values()), this.myId, [...positions, { id: this.myId, x: this.scene?.local?.x || 0, y: this.scene?.local?.y || 0 }]);
  }

  showInventoryToast() {
    const inv = this.computeInventory(this.shared);
    if (!inv.length) {
      this.hud.toast('Inventário vazio. O que você carrega é o que encontrou.');
    } else {
      this.hud.toast(inv.map((i) => `${i.glyph} ${i.label}`).join('   '));
    }
  }

  togglePause(paused) {
    if (!this.inGame) return;
    this.paused = paused;
    this.hud.hidePause();
    if (paused) {
      this.hud.showPause({
        roomCode: this.lobby?.code,
        seed: this.lobby?.seed,
        region: THEMES[this.scene?.currentTheme]?.label,
        players: this.players.size,
        latency: this.net.latency,
      });
      this.scene?.setPaused(true);
    } else {
      this.scene?.setPaused(false);
    }
  }

  handleNetEvent(ev) {
    switch (ev.type) {
      case 'playerJoined':
        if (ev.player) {
          this.players.set(ev.player.id, ev.player);
          if (this.inGame) {
            this.hud.toast(`${ev.player.name} entrou.`);
            this.scene?.createPlayerSprite?.(ev.player.id, ev.player.name, ev.player.color, false);
          }
          this.syncTeamHud();
        }
        break;
      case 'playerLeft':
      case 'playerDisconnected':
        this.players.delete(ev.playerId);
        this.syncTeamHud();
        break;
      case 'playerReconnected':
        this.syncTeamHud();
        break;
      case 'noteRead':
        break;
      case 'damage':
        break;
      case 'playerDied':
        if (ev.playerId === this.myId) {
          this.hud.setVitals(0, true);
          this.hud.showDeath(9);
        }
        break;
      case 'respawn':
        if (ev.playerId === this.myId) {
          this.hud.hideDeath();
          this.hud.setVitals(100, false);
        }
        break;
      default:
        break;
    }
  }

  discoverAnomaly(a) {
    if (!a?.kind) return;
    if (this.seenAnomalies.has(a.id)) return;
    this.seenAnomalies.add(a.kind);
    recordDiscovery('anomalies', a.kind, { label: a.label, rarity: a.rarity, message: a.message });
    this.codex = loadCodex();
  }

  async leaveRoom() {
    this.inGame = false;
    this.paused = false;
    this.destroyGame();
    this.hud.hide();
    await this.net.leaveRoom();
    this.lobby = null;
    this.shared = null;
    this.players.clear();
    this.screens.clearStack();
    this.screens.show('menu');
    this.refreshRooms();
  }

  leaveToMenu(message) {
    this.inGame = false;
    this.destroyGame();
    this.hud.hide();
    this.screens.clearStack();
    this.screens.show('menu');
    if (message) this.hud.toast(message);
  }

  // -------------------------------------------------------------------------
  // Códex
  // -------------------------------------------------------------------------

  initCodex() {
    this.renderCodex();
  }

  renderCodex() {
    const codex = loadCodex();
    this.codex = codex;
    const creatureBox = document.getElementById('codex-creatures');
    const anomalyBox = document.getElementById('codex-anomalies');
    const discoveryBox = document.getElementById('codex-discoveries');
    if (!creatureBox || !anomalyBox) return;

    const seenAnomalies = new Set((codex.anomalies || []).map((a) => a.id));

    creatureBox.innerHTML = '';
    for (const c of Object.values(CREATURE_DEFS)) {
      const entry = document.createElement('article');
      entry.className = 'codex-entry';
      const title = document.createElement('h4');
      title.textContent = c.label;
      const behavior = document.createElement('span');
      behavior.className = 'rarity';
      behavior.textContent = creatureBehaviorLabel(c.behavior);
      title.appendChild(behavior);
      const p = document.createElement('p');
      p.textContent = c.note;
      const p2 = document.createElement('p');
      p2.textContent = `Sinal: ${c.telegraph}`;
      entry.append(title, p, p2);
      creatureBox.appendChild(entry);
    }

    anomalyBox.innerHTML = '';
    for (const a of Object.values(ANOMALY_DEFS)) {
      const entry = document.createElement('article');
      const seen = seenAnomalies.has(a.id);
      entry.className = `codex-entry rarity-${a.rarity}${seen ? '' : ' locked'}`;
      const title = document.createElement('h4');
      title.textContent = seen ? a.label : '— — —';
      const rarity = document.createElement('span');
      rarity.className = 'rarity';
      rarity.textContent = a.rarity;
      title.appendChild(rarity);
      const p = document.createElement('p');
      p.textContent = seen ? a.rule : 'Ainda não observada. Explore para registrar.';
      entry.append(title, p);
      anomalyBox.appendChild(entry);
    }

    discoveryBox.innerHTML = '';
    const notes = codex.notes || [];
    const puzzles = codex.puzzles || [];
    const groups = [
      ['Anotações', notes.map((n) => n.title || n.id)],
      ['Mecanismos resolvidos', puzzles.map((p) => puzzleLabel(p.kind))],
      ['Travessias completas', (codex.runs || []).length ? [`${(codex.runs || []).length} mundo(s) encerrado(s)`] : []],
    ];
    let hasAny = false;
    for (const [label, items] of groups) {
      if (!items.length) continue;
      hasAny = true;
      const entry = document.createElement('article');
      entry.className = 'codex-entry';
      const h = document.createElement('h4');
      h.textContent = label;
      const p = document.createElement('p');
      p.textContent = items.join(' · ');
      entry.append(h, p);
      discoveryBox.appendChild(entry);
    }
    if (!hasAny) {
      discoveryBox.innerHTML = '<p class="muted small">Encontre anotações, resolva mecanismos e sobreviva para preencher este arquivo.</p>';
    }
  }
}

function creatureBehaviorLabel(behavior) {
  return (
    {
      patrolServe: 'patrulha · serve quem espera',
      observedChase: 'só existe quando observado',
      huntNoise: 'segue o som',
      stalkIsolated: 'caça quem está sozinho',
      mirrorPlayer: 'imita com atraso',
      observeLearn: 'observa e aprende',
      alterEnvironment: 'altera o ambiente',
    }[behavior] || behavior
  );
}

function puzzleLabel(kind) {
  return (
    {
      valvePair: 'válvulas simultâneas',
      breakerOrder: 'sequência de disjuntores',
      holdLever: 'alavanca + botão',
      pressurePlates: 'placas de pressão',
      keycard: 'cartão magnético',
      silenceChoir: 'sino do coro',
    }[kind] || kind
  );
}

window.addEventListener('DOMContentLoaded', () => {
  window.__nullscape = new App();
});

// Vite: se o DOM já estiver pronto (HMR)
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  if (!window.__nullscape) window.__nullscape = new App();
}
