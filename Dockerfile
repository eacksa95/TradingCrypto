# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# Instalar dependencias primero (aprovecha cache de Docker)
COPY backend/package*.json ./
RUN npm ci --only=production

# Copiar todo el proyecto
COPY backend/ ./
COPY database/ ./database/

# ── Runtime ───────────────────────────────────────────────────
EXPOSE 3000

# Ejecutar migraciones y luego arrancar el servidor
CMD ["sh", "-c", "node src/scripts/migrate.js && node src/index.js"]
