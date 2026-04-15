# ── Build ─────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Dependencias primero (aprovecha layer cache de Docker)
COPY backend/package*.json ./
RUN npm ci --only=production

# Código de la app
COPY backend/ ./

# SQL de migraciones (buscado por migrate.js)
COPY database/ ./database/

# ── Runtime ───────────────────────────────────────────────────
# Railway inyecta PORT automáticamente; la app lo lee con process.env.PORT
EXPOSE 3000

# Arranca siempre el servidor; si la migración falla, el servidor igual sube
# y la migración se puede reintentar. El || true evita que mate el contenedor.
CMD ["sh", "-c", "node src/scripts/migrate.js || echo 'Migrate warning (tablas ya existen o error)'; node src/index.js"]
