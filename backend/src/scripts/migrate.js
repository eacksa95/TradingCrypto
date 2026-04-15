/**
 * Script de migración de base de datos
 * Uso: node src/scripts/migrate.js
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

async function migrate() {
  const clientConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME     || 'tradingcrypto',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      };

  const client = new Client(clientConfig);

  try {
    await client.connect();
    console.log('Conectado a PostgreSQL');

    // Buscar el SQL en múltiples ubicaciones (local vs Docker)
    const candidates = [
      resolve(__dirname, '../../../database/migrations/001_initial_schema.sql'),  // local
      resolve(__dirname, '../../database/migrations/001_initial_schema.sql'),     // Docker
      resolve(process.cwd(), 'database/migrations/001_initial_schema.sql'),       // desde raíz
    ];

    let sqlPath = null;
    for (const p of candidates) {
      try { readFileSync(p); sqlPath = p; break; } catch {}
    }
    if (!sqlPath) throw new Error('No se encontró el archivo SQL de migración. Rutas buscadas:\n' + candidates.join('\n'));

    console.log('Ejecutando migración:', sqlPath);

    const sql = readFileSync(sqlPath, 'utf-8');
    await client.query(sql);

    console.log('✅ Migración completada exitosamente');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('⚠️  Las tablas ya existen — migración omitida');
    } else {
      console.error('❌ Error en migración:', err.message);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

migrate();
