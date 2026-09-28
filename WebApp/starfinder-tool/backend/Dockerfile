# Build context is the stack root (starfinder-tool/), so the shared
# galaxy-core/ library can be copied in alongside — see docker-compose.yml.
FROM node:20-alpine
WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/scripts ./scripts
# imported by relative path from src/ (../../galaxy-core → /galaxy-core)
COPY galaxy-core /galaxy-core
EXPOSE 3000
CMD ["node", "src/index.js"]
