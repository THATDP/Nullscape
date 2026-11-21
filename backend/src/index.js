/**
 * NULLSCAPE — Servidor autoritativo.
 *
 * Responsabilidades:
 *  - Express: health check, diretório público de salas, métricas leves.
 *  - Socket.IO: entrada sem cadastro, salas públicas/privadas por código,
 *    sincronização de movimento (inputs -> snapshots), validação de eventos,
 *    limitação de mensagens, reconexão e limpeza de salas vazias.
 *
 * O servidor é a única fonte de verdade para mundo, criaturas, anomalias,
 * quebra-cabeças e progresso compartilhado.
 */

import http from 'node:http';
import { URL } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { generateValidWorld, serializeWorld, TILE_SIZE } from '../../shared/world/generator.js';
import { CREATURE_DEFS } from '../../shared/sim/creatures.js';
import { ANOMALY_DEFS } from '../../shared/sim/anomalies.js';
import { Room, RoomManager, RoomConstants } from './rooms.js';
import { createLogger, validateEnv } from './logger.js';
import { attachSocketHandlers } from './net.js';

const env = validateEnv(process.env);
const log = createLogger(env.LOG_LEVEL);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const allowedOrigins = env.CORS_ORIGINS;
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
      // Permite previews do GitHub Pages do próprio repositório
      if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) && env.ALLOW_GITHUB_PAGES) return callback(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return callback(null, true);
      if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
  }),
);
app.use(express.json({ limit: '16kb' }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
      if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) && env.ALLOW_GITHUB_PAGES) return cb(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return cb(null, true);
      if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return cb(null, true);
      return cb(null, false);
    },
  },
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 64 * 1024,
  transports: ['websocket', 'polling'],
  allowRequest: (req, callback) => {
    // Só aceita origens conhecidas (proteção extra contra abuso)
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) && env.ALLOW_GITHUB_PAGES) return callback(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return callback(null, true);
    return callback(null, env.ALLOW_UNKNOWN_ORIGINS);
  },
});

const manager = new RoomManager({ io, log });
const serverStats = {
  startedAt: Date.now(),
  connections: 0,
  messagesIn: 0,
  messagesOut: 0,
  roomsCreated: 0,
  rejected: 0,
  peakPlayers: 0,
};

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'alive',
    uptimeSeconds: Math.round(process.uptime()),
    rooms: manager.rooms.size,
    players: manager.all().reduce((n, r) => n + r.players.size, 0),
    version: env.VERSION,
    now: new Date().toISOString(),
  });
});

app.get('/ready', (req, res) => {
  const ok = manager instanceof RoomManager;
  res.status(ok ? 200 : 503).json({ ok });
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: env.VERSION,
    tickRate: RoomConstants.TICK_RATE,
    maxPlayersPerRoom: RoomConstants.MAX_PLAYERS,
    rooms: manager.rooms.size,
    players: manager.all().reduce((n, r) => n + r.players.size, 0),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/api/rooms', (req, res) => {
  res.json({ rooms: manager.listPublic(), now: Date.now() });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = manager.findByCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'sala não encontrada' });
  res.json({ room: manager.publicInfo(room) });
});

// Diagnóstico: gera um mundo de teste sem criar sala (útil para monitorar geração)
app.get('/api/preview/:seed', (req, res) => {
  try {
    const world = generateValidWorld(req.params.seed);
    const serialized = serializeWorld(world);
    res.json({
      seed: serialized.seed,
      hash: serialized.hash,
      themes: serialized.regions.map((r) => r.themeId),
      rooms: serialized.regions.map((r) => r.rooms.length),
      puzzles: serialized.puzzles.map((p) => p.kind),
      validation: serialized.validation,
      sizeBytes: JSON.stringify(serialized).length,
    });
  } catch (err) {
    res.status(400).json({ error: 'semente inválida', detail: String(err.message) });
  }
});

app.get('/api/codex', (req, res) => {
  res.json({
    creatures: Object.values(CREATURE_DEFS).map((c) => ({
      id: c.id,
      label: c.label,
      note: c.note,
      telegraph: c.telegraph,
      behavior: c.behavior,
    })),
    anomalies: Object.values(ANOMALY_DEFS).map((a) => ({
      id: a.id,
      label: a.label,
      rarity: a.rarity,
      message: a.message,
      rule: a.rule,
    })),
  });
});

// 404 JSON para /api
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'não encontrado' });
  return next();
});

// Handler de erro central
app.use((err, req, res, next) => {
  log.error(`[http] ${err.stack || err.message}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'erro interno' });
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

attachSocketHandlers({ io, manager, log, env, serverStats });

io.engine.on('connection_error', (err) => {
  log.warn(`[socket] connection_error ${err.code}: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Loop global de simulação
// ---------------------------------------------------------------------------

let lastTick = Date.now();
const globalTimer = setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  for (const room of manager.all()) {
    try {
      room.tick(dt, now);
      const snapshot = room.movementSnapshot();
      // Estado de progresso a cada 5 ticks (~4/s) — sempre que houver jogadores
      if (room.metrics.ticks % 5 === 0) {
        io.to(room.id).volatile.emit('st', room.stateSnapshot());
        serverStats.messagesOut += 1;
      }
      if (snapshot.length) {
        io.to(room.id).volatile.emit('s', { t: now, p: snapshot });
        serverStats.messagesOut += 1;
      }
      if (room.events.length) {
        const events = room.events.splice(0);
        io.to(room.id).emit('e', { t: now, events });
      }
    } catch (err) {
      log.error(`[loop] sala ${room.id}: ${err.stack || err.message}`);
    }
  }
  if (Math.floor(now / 1000) % 15 === 0) {
    const dropped = manager.cleanup(now);
    if (dropped) log.info(`[limpeza] ${dropped} sala(s) vazia(s) removida(s)`);
    for (const room of manager.all()) room.sweepDisconnects(now);
  }
}, RoomConstants.TICK_MS);

// ---------------------------------------------------------------------------
// Inicialização / encerramento
// ---------------------------------------------------------------------------

const PORT = env.PORT;
// `httpServer.port` permite porta efêmera (0) em testes de integração/fumaça.
httpServer.listen(PORT, '0.0.0.0', () => {
  const bound = httpServer.address();
  const shown = bound && typeof bound === 'object' ? bound.port : PORT;
  log.info(`[boot] NULLSCAPE servidor na porta ${shown} (env=${env.NODE_ENV}, versão=${env.VERSION})`);
  log.info(`[boot] origens permitidas: ${env.CORS_ORIGINS.join(', ')}`);
});

function shutdown(signal) {
  log.info(`[boot] encerrando (${signal})...`);
  clearInterval(globalTimer);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 6000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error(`[unhandledRejection] ${err?.stack || err}`));
process.on('uncaughtException', (err) => log.error(`[uncaughtException] ${err?.stack || err}`));

export { app, httpServer, io, manager, serverStats };
