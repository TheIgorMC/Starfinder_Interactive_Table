# Build context is the stack root (starfinder-tool/) — see docker-compose.yml.
FROM node:20-alpine
WORKDIR /app
COPY mcp-server/package.json ./
RUN npm install --omit=dev
COPY mcp-server/src ./src
# galaxy tool definitions, imported by relative path (../../galaxy-core → /galaxy-core)
COPY galaxy-core /galaxy-core
EXPOSE 3100
CMD ["node", "src/index.js"]
