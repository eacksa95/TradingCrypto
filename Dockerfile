# ── Build ─────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Dependencias primero (aprovecha layer cache)
COPY backend/package*.json ./
RUN npm ci --only=production

# Código de la app
COPY backend/ ./

# SQL de migraciones
COPY database/ ./database/

# ── Runtime ───────────────────────────────────────────────────
# Railway inyecta PORT automáticamente
EXPOSE 3000

# Solo arrancar el servidor; la migración la maneja railway.toml releaseCommand
CMD ["node", "src/index.js"]
