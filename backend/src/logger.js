/**
 * NULLSCAPE — Configuração por ambiente e logging estruturado.
 * Nenhum segredo vai para o cliente: as variáveis abaixo afetam só o servidor.
 */

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function validateEnv(raw = process.env) {
  const port = Number(raw.PORT || 3000);
  const originsRaw = raw.CORS_ORIGINS || raw.CORS_ORIGIN || '';
  const parsed = originsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowPages = raw.ALLOW_GITHUB_PAGES !== 'false';
  let origins = parsed.length ? parsed : DEFAULT_ORIGINS;
  if (origins.includes('*') && (raw.NODE_ENV || '').toLowerCase() === 'production') {
    // Nunca deixar "*" silencioso em produção sem intenção explícita
    if (raw.ALLOW_ALL_ORIGINS !== 'true') {
      origins = origins.filter((o) => o !== '*');
      if (!origins.length) origins = DEFAULT_ORIGINS;
    }
  }
  return {
    PORT: Number.isFinite(port) && port > 0 ? port : 3000,
    NODE_ENV: raw.NODE_ENV || 'development',
    VERSION: raw.VERSION || raw.npm_package_version || '1.0.0',
    CORS_ORIGINS: origins,
    ALLOW_GITHUB_PAGES: allowPages,
    ALLOW_UNKNOWN_ORIGINS: raw.ALLOW_UNKNOWN_ORIGINS === 'true',
    LOG_LEVEL: (raw.LOG_LEVEL || 'info').toLowerCase(),
  };
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const fmt = (lvl, msg) => `[${new Date().toISOString()}] ${lvl.toUpperCase()} ${msg}`;
  return {
    debug: (m) => threshold <= LEVELS.debug && console.debug(fmt('debug', m)),
    info: (m) => threshold <= LEVELS.info && console.log(fmt('info', m)),
    warn: (m) => threshold <= LEVELS.warn && console.warn(fmt('warn', m)),
    error: (m) => threshold <= LEVELS.error && console.error(fmt('error', m)),
  };
}
