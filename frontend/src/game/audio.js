/**
 * NULLSCAPE — Áudio procedural (WebAudio).
 *
 * Nenhum arquivo de som: tudo é sintetizado. O sistema tem três camadas:
 *   1. ambiência por ambiente (drone, ar-condicionado, eco de piscina, vento);
 *   2. sons diegéticos posicionais (passos, portas, válvulas, criaturas);
 *   3. silêncio intencional — a ambiência é cortada em momentos de tensão.
 *
 * O volume de ambiência oscila lentamente (respiração do prédio).
 */

const AMBIENCE = {
  offices: { drone: 92, hum: 118, hiss: 0.05, density: 0.55, air: 0.35 },
  hotel: { drone: 78, hum: 104, hiss: 0.06, density: 0.4, air: 0.3 },
  pool: { drone: 70, hum: 60, hiss: 0.11, density: 0.7, air: 0.55, wet: true },
  garage: { drone: 48, hum: 42, hiss: 0.07, density: 0.35, air: 0.6, wind: true },
  school: { drone: 88, hum: 132, hiss: 0.04, density: 0.45, air: 0.3, tone: true },
  industrial: { drone: 54, hum: 96, hiss: 0.09, density: 0.6, air: 0.4, machine: true },
  residential: { drone: 84, hum: 110, hiss: 0.045, density: 0.4, air: 0.32, clock: true },
  threshold: { drone: 44, hum: 38, hiss: 0.03, density: 0.22, air: 0.2, void: true },
};

export class AudioEngine {
  constructor(settings = {}) {
    this.ctx = null;
    this.master = null;
    this.ambienceGain = null;
    this.sfxGain = null;
    this.ready = false;
    this.settings = {
      volume: 0.7,
      ambience: 0.55,
      mute: false,
      reduced: false,
      ...settings,
    };
    this.currentTheme = null;
    this.ambienceNodes = [];
    this.pendingTheme = null;
    this.silenced = false;
  }

  /** Deve ser chamado a partir de um gesto do usuário. */
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.mute ? 0 : this.settings.volume;
    this.master.connect(this.ctx.destination);

    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = this.settings.ambience * 0.5;
    this.ambienceGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.85;
    this.sfxGain.connect(this.master);

    // ruído branco reutilizável
    this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this.ready = true;
    if (this.pendingTheme) {
      const t = this.pendingTheme;
      this.pendingTheme = null;
      this.setAmbience(t);
    }
  }

  applySettings(next) {
    this.settings = { ...this.settings, ...next };
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(this.settings.mute ? 0 : this.settings.volume, this.ctx.currentTime, 0.05);
    this.ambienceGain.gain.setTargetAtTime(this.settings.ambience * 0.5, this.ctx.currentTime, 0.1);
  }

  /** Troca a ambiência para o tema do ambiente. */
  setAmbience(themeId) {
    if (this.currentTheme === themeId) return;
    if (!this.ready) {
      this.pendingTheme = themeId;
      return;
    }
    this.currentTheme = themeId;
    const params = AMBIENCE[themeId] || AMBIENCE.threshold;
    this.stopAmbience();
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // drone
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = params.drone;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.0;
    droneGain.gain.linearRampToValueAtTime(0.05, now + 3);
    drone.connect(droneGain).connect(this.ambienceGain);
    drone.start(now);

    // harmonia desafinada (bate de ar-condicionado)
    const hum = ctx.createOscillator();
    hum.type = 'triangle';
    hum.frequency.value = params.hum;
    hum.detune.value = 7;
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.gain.linearRampToValueAtTime(0.018, now + 5);
    hum.connect(humGain).connect(this.ambienceGain);
    hum.start(now);

    // ruído filtrado (ar, água, vento)
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = params.wind ? 'lowpass' : params.wet ? 'bandpass' : 'bandpass';
    filter.frequency.value = params.wind ? 320 : params.wet ? 1100 : 620;
    filter.Q.value = params.wet ? 0.8 : 0.4;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noiseGain.gain.linearRampToValueAtTime(params.hiss * 0.5, now + 4);
    noise.connect(filter).connect(noiseGain).connect(this.ambienceGain);
    noise.start(now);

    // LFO de volume: o prédio respira
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(droneGain.gain);
    lfo.start(now);

    const nodes = [drone, hum, noise, lfo];
    this.ambienceNodes = nodes;

    if (params.tone) this.scheduleSchoolTone();
    if (params.machine) this.scheduleMachine();
    if (params.clock) this.scheduleClock();
    if (params.void) this.scheduleVoid();
  }

  stopAmbience() {
    for (const node of this.ambienceNodes) {
      try {
        node.stop();
      } catch {
        /* já parado */
      }
    }
    this.ambienceNodes = [];
    for (const t of this.timers || []) clearTimeout(t);
    this.timers = [];
  }

  get timers() {
    this._timers = this._timers || [];
    return this._timers;
  }

  later(ms, fn) {
    const id = setTimeout(() => {
      if (this.settings.mute) return;
      fn();
    }, ms);
    this.timers.push(id);
    if (this.timers.length > 20) this.timers.shift();
  }

  scheduleSchoolTone() {
    const loop = () => {
      this.later(5200 + Math.random() * 9000, () => {
        this.tone(660 + Math.random() * 120, 0.16, 0.02, 'sine');
      });
      if (this.currentTheme === 'school') this.later(5400, loop);
    };
    loop();
  }
  scheduleMachine() {
    const loop = () => {
      this.later(2600 + Math.random() * 4200, () => {
        this.thump(0.05, 46);
      });
      if (this.currentTheme === 'industrial') this.later(2800, loop);
    };
    loop();
  }
  scheduleClock() {
    const loop = () => {
      this.later(1000, () => {
        this.click(0.03, 1800);
        this.later(500, () => this.click(0.022, 1300));
      });
      if (this.currentTheme === 'residential') this.later(1050, loop);
    };
    loop();
  }
  scheduleVoid() {
    const loop = () => {
      this.later(9000 + Math.random() * 14000, () => {
        this.tone(120 + Math.random() * 40, 4.5, 0.012, 'sine', 0.2);
      });
      if (this.currentTheme === 'threshold') this.later(10000, loop);
    };
    loop();
  }

  // --- primitivas --------------------------------------------------------

  tone(freq, dur, gain, type = 'sine', detuneCents = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detuneCents;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.min(0.05, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  click(gain = 0.05, freq = 2000) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(now, Math.random());
    src.stop(now + 0.06);
  }

  thump(gain = 0.06, freq = 60) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc.connect(g).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.45);
  }

  /** Som diegético com atenuação por distância (em tiles). */
  spatial(kind, distanceTiles = 0) {
    if (!this.ready) return;
    const atten = Math.max(0, 1 - distanceTiles / 14);
    if (atten <= 0.02) return;
    const pan = 0;
    const gainScale = atten * atten;
    switch (kind) {
      case 'step':
        this.click(0.014 * gainScale, 900 + Math.random() * 300);
        break;
      case 'step-run':
        this.click(0.03 * gainScale, 700 + Math.random() * 200);
        break;
      case 'door':
        this.thump(0.05 * gainScale, 90);
        this.click(0.03 * gainScale, 1400);
        break;
      case 'valve-turn':
        this.click(0.03 * gainScale, 500);
        this.tone(180, 0.7, 0.02, 'sawtooth');
        break;
      case 'breaker-on':
        this.click(0.05 * gainScale, 2600);
        this.tone(320, 0.3, 0.02, 'square');
        break;
      case 'breaker-error':
        this.tone(90, 0.6, 0.04, 'sawtooth');
        break;
      case 'plate-press':
        this.thump(0.04 * gainScale, 120);
        break;
      case 'power-up':
        this.tone(220, 1.4, 0.03, 'sine');
        this.tone(330, 1.2, 0.02, 'triangle');
        break;
      case 'pickup-card':
        this.click(0.05 * gainScale, 3200);
        this.tone(880, 0.2, 0.016, 'triangle');
        break;
      case 'bell-1':
      case 'bell-2':
      case 'bell-3':
        this.tone(520 + Math.random() * 6, 3.2, 0.035, 'sine');
        this.tone(786, 2.6, 0.018, 'sine');
        break;
      case 'choir-stop':
        this.tone(140, 3.4, 0.03, 'sine');
        break;
      case 'chime':
        this.tone(1180, 1.6, 0.012, 'sine');
        break;
      case 'drag':
        this.noiseSweep(0.03 * gainScale, 220, 90, 1.4);
        break;
      case 'wet':
        this.click(0.02 * gainScale, 420);
        break;
      case 'knock':
        this.thump(0.06 * gainScale, 130);
        this.later(320, () => this.thump(0.05 * gainScale, 125));
        this.later(660, () => this.thump(0.045 * gainScale, 118));
        break;
      case 'replay':
        this.click(0.012 * gainScale, 1400);
        break;
      case 'drone':
        this.tone(58, 5, 0.02 * atten, 'sine');
        break;
      case 'pulse':
        this.thump(0.05 * gainScale, 48);
        break;
      case 'sigil-taken':
        this.tone(440, 2.4, 0.03, 'sine');
        this.tone(660, 2.0, 0.02, 'sine');
        break;
      case 'sigil-delivered':
        this.tone(330, 3, 0.04, 'sine');
        this.tone(495, 2.6, 0.025, 'triangle');
        break;
      case 'anomaly':
        this.tone(72 + Math.random() * 10, 2.6, 0.02, 'sine');
        this.noiseSweep(0.02, 800, 200, 2.2);
        break;
      case 'attack':
        this.thump(0.09, 44);
        this.noiseSweep(0.05, 1200, 300, 0.5);
        break;
      case 'death':
        this.tone(48, 4, 0.05, 'sine');
        this.noiseSweep(0.03, 400, 80, 3.2);
        break;
      case 'murmur':
        this.tone(210, 3.4, 0.01, 'triangle');
        break;
      default:
        this.click(0.02 * gainScale, 1200);
    }
    void pan;
  }

  noiseSweep(gain, from, to, dur) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.min(0.3, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(now);
    src.stop(now + dur + 0.1);
  }

  /** Silêncio intencional: corta a ambiência por alguns segundos. */
  cutAmbience(seconds = 3) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.ambienceGain.gain.cancelScheduledValues(now);
    this.ambienceGain.gain.setValueAtTime(this.ambienceGain.gain.value, now);
    this.ambienceGain.gain.linearRampToValueAtTime(0.0, now + 0.35);
    this.ambienceGain.gain.setValueAtTime(0.0, now + seconds);
    this.ambienceGain.gain.linearRampToValueAtTime(this.settings.ambience * 0.5, now + seconds + 1.6);
  }

  /** Batimento de tensão (usado quando uma criatura se aproxima). */
  tensionPulse(intensity = 0.5) {
    if (!this.ready) return;
    if (this.settings.reduced) return;
    this.thump(0.03 + intensity * 0.045, 42 + intensity * 8);
  }

  destroy() {
    this.stopAmbience();
    try {
      this.ctx?.close();
    } catch {
      /* ignorar */
    }
    this.ctx = null;
    this.ready = false;
  }
}
