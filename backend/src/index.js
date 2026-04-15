import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { testConnection } from './config/database.js';
import walletsRouter  from './routes/wallets.js';
import tradesRouter   from './routes/trades.js';
import alertsRouter   from './routes/alerts.js';
import marketRouter   from './routes/market.js';
import analysisRouter from './routes/analysis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// El webhook de TradingView envía JSON — necesitamos parsear el body raw también
// para poder validar firmas si fuera necesario en el futuro
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static frontend ──────────────────────────────────────────
app.use(express.static(join(__dirname, '../public')));

// ── Rutas API ────────────────────────────────────────────────
app.use('/api/wallets',  walletsRouter);
app.use('/api/trades',   tradesRouter);
app.use('/api/alerts',   alertsRouter);
app.use('/api/market',   marketRouter);
app.use('/api/analysis', analysisRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    env: process.env.NODE_ENV,
  });
});

// SPA fallback — non-API routes serve index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(join(__dirname, '../public/index.html'));
});

// 404 (solo APIs)
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start ────────────────────────────────────────────────────
async function start() {
  // Primero levantamos el servidor (Railway ya puede hacer healthcheck)
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n🚀 TradingCrypto Backend corriendo en puerto ${PORT}`);
    console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);

    // Verificar DB con reintentos (Railway puede tardar en inyectar DATABASE_URL)
    let dbOk = false;
    for (let i = 1; i <= 5; i++) {
      dbOk = await testConnection();
      if (dbOk) break;
      console.log(`[DB] Intento ${i}/5 fallido, reintentando en 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!dbOk) {
      console.error('[DB] No se pudo conectar a PostgreSQL después de 5 intentos.');
      console.error('[DB] Variables disponibles: DATABASE_URL=' + (process.env.DATABASE_URL ? 'set' : 'NOT SET'));
    } else {
      console.log('[DB] Conexión establecida. Listo.');
    }
  });
}

start();
