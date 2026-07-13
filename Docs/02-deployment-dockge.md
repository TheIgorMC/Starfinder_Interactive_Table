# Deployment — Orange Pi 3B / Docker / Dockge

## Directory layout

```
/mnt/data_ssd/repos/Starfinder_Interactive_Table/   # git clone lives here
  └── WebApp/starfinder-tool/                       # the actual stack (compose lives here)

/mnt/emmc/stacks/starfinder-tool/       # symlink -> the folder above (see below)

/mnt/data_ssd/nas_share/SIT/            # Persistent data, kept off eMMC
  ├── db/                               # Postgres data dir (or sqlite file)
  ├── uploads/                          # user-uploaded maps, tokens, images
  ├── aon-cache/                        # imported rules data cache
  └── content/                          # SDF content packs served to clients
```

Rationale: Dockge expects stack definitions directly under its configured
stacks root (`/mnt/emmc/stacks/<name>/compose.yaml`) — it does not scan
nested subfolders. Since this stack lives inside the full repo at
`WebApp/starfinder-tool/`, symlink it into place rather than copying:

```
ln -s /mnt/data_ssd/repos/Starfinder_Interactive_Table/WebApp/starfinder-tool \
      /mnt/emmc/stacks/starfinder-tool
```

`git pull` in the repo updates the stack in place; Dockge follows the
symlink and picks up changes on redeploy. eMMC only ever holds the symlink
itself (negligible writes); the repo and all persistent game data live on
the SSD (`/mnt/data_ssd/...`) to avoid eMMC wear and allow larger storage.

Note: `MapCreator/` (also in the repo) is not part of this stack and is not
deployed to the Pi — it's a separate, heavier offline tool run on a
workstation; only `WebApp/starfinder-tool/` gets symlinked in.

## docker-compose.yml (skeleton)

```yaml
name: starfinder-tool

services:
  backend:
    build: ./backend
    container_name: sf-backend
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgres://sf:${DB_PASSWORD:-sf}@db:5432/sf
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - /mnt/data_ssd/nas_share/SIT/uploads:/app/uploads
      - /mnt/data_ssd/nas_share/SIT/aon-cache:/app/aon-cache
      - /mnt/data_ssd/nas_share/SIT/content:/app/content
    depends_on:
      db:
        condition: service_healthy

  frontend:
    build: ./frontend
    container_name: sf-frontend
    restart: unless-stopped
    ports:
      - "7600:80"
    depends_on:
      - backend

  db:
    image: postgres:16-alpine
    container_name: sf-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=sf
      - POSTGRES_PASSWORD=${DB_PASSWORD:-sf}
      - POSTGRES_DB=sf
    volumes:
      - /mnt/data_ssd/nas_share/SIT/db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sf"]
      interval: 5s
      timeout: 3s
      retries: 10
```

See [`WebApp/starfinder-tool/docker-compose.yml`](../WebApp/starfinder-tool/docker-compose.yml)
for the actual file — this is kept in sync with it.

Notes:
- All bind mounts point at `/mnt/data_ssd/...` — Dockge only needs to see the
  compose file under its stacks root (via the symlink above); the actual
  volumes can live anywhere the host filesystem allows.
- `frontend` served separately via nginx container (static React build) so
  the backend stays a pure API — simplifies scaling/updating each half
  independently. Can be merged into one container later if preferred.
- Ports are placeholders; adjust to avoid collisions with other stacks on
  the Pi.
- Add a `.env` file (git-ignored) for secrets instead of hardcoding
  passwords once past the prototype stage.

## Dockge compatibility checklist

- [ ] Symlink name (`/mnt/emmc/stacks/starfinder-tool`) matches `name:` in compose file (Dockge convention)
- [ ] Compose file uses relative build contexts (`./backend`, `./frontend`) resolved from the stack folder itself
- [ ] No absolute host paths inside the stack folder — only in `volumes:` bind mounts, which is fine
- [ ] `.env` (if used) sits alongside `docker-compose.yml` in `WebApp/starfinder-tool/` (git-ignored) so Dockge's editor picks it up through the symlink
