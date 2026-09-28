# Build context is the stack root (starfinder-tool/) — see docker-compose.yml.
FROM node:20-alpine AS build
WORKDIR /stack/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
# vite alias @galaxy-core → ../galaxy-core
COPY galaxy-core /stack/galaxy-core
RUN npm run build

FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /stack/frontend/dist /usr/share/nginx/html
