FROM node:20-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ ./

EXPOSE 3000

# 'exec' reemplaza sh con node como PID 1 (Railway lo monitorea directamente)
# --max-old-space-size limita el heap para no superar el RAM de Railway (512MB)
CMD ["sh", "-c", "node src/scripts/migrate.js; exec node --max-old-space-size=256 src/index.js"]
