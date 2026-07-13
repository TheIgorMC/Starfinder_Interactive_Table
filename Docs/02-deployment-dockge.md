# Deployment — Orange Pi 3B / Docker / Dockge

## Directory layout

```
/mnt/emmc/stacks/starfinder-tool/       # Dockge-managed stack (compose lives here)
  ├── docker-compose.yml
  └── .env

/mnt/data_ssd/starfinder-tool/          # Persistent data, kept off eMMC
  ├── db/                               # Postgres data dir (or sqlite file)
  ├── uploads/                          # user-uploaded maps, tokens, images
  └── aon-cache/                        # imported rules data cache
```

Rationale: Dockge expects stack definitions under its configured stacks root
(`/mnt/emmc/stacks/...`); the eMMC is fine for that (small text files, low
write volume). Actual game data / uploaded assets go on the SSD
(`/mnt/data_ssd/...`) to avoid eMMC wear and to allow larger storage.

## docker-compose.yml (skeleton)

```yaml
name: starfinder-tool

services:
  backend:
    build: ./backend
    container_name: sf-backend
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://sf:sf@db:5432/sf
      - NODE_ENV=production
    volumes:
      - /mnt/data_ssd/starfinder-tool/uploads:/app/uploads
      - /mnt/data_ssd/starfinder-tool/aon-cache:/app/aon-cache
    depends_on:
      - db

  frontend:
    build: ./frontend
    container_name: sf-frontend
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      - backend

  db:
    image: postgres:16-alpine
    container_name: sf-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=sf
      - POSTGRES_PASSWORD=sf
      - POSTGRES_DB=sf
    volumes:
      - /mnt/data_ssd/starfinder-tool/db:/var/lib/postgresql/data
```

Notes:
- All bind mounts point at `/mnt/data_ssd/...` — Dockge only needs to see the
  compose file under its stacks root; the actual volumes can live anywhere
  the host filesystem allows.
- `frontend` served separately via nginx container (static React build) so
  the backend stays a pure API — simplifies scaling/updating each half
  independently. Can be merged into one container later if preferred.
- Ports are placeholders; adjust to avoid collisions with other stacks on
  the Pi.
- Add a `.env` file (git-ignored) for secrets instead of hardcoding
  passwords once past the prototype stage.

## Dockge compatibility checklist

- [ ] Stack folder name matches `name:` in compose file (Dockge convention)
- [ ] Compose file uses relative build contexts (`./backend`, `./frontend`) resolved from the stack folder itself
- [ ] No absolute host paths inside the stack folder — only in `volumes:` bind mounts, which is fine
- [ ] `.env` (if used) sits alongside `docker-compose.yml` in the same stack folder so Dockge's editor picks it up
