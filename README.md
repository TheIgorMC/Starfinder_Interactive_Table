# Starfinder Interactive Table

- [`Docs/`](Docs/) — project-wide design docs (architecture, deployment, feature scope, roadmap)
- [`WebApp/starfinder-tool/`](WebApp/starfinder-tool/) — the GM/player web app (see its own README for setup and deploy)
- Galaxy generator/editor + viewer — now part of the web app (Galaxy Editor / Galaxy Map, shared code in [`WebApp/starfinder-tool/galaxy-core/`](WebApp/starfinder-tool/galaxy-core/)); the old standalone `GalaxyGen/` app was merged in. See [`Docs/10-galaxy-mapgen.md`](Docs/10-galaxy-mapgen.md)
- [`MapCreator/`](MapCreator/) — placeholder for a future battle-map authoring tool; runs on a workstation, not deployed to the Orange Pi
- [`DataEntry/`](DataEntry/) — a disconnected draft-authoring pipeline for race/class/archetype/theme data; not imported anywhere yet, see `Docs/04-data-pipeline-aon.md`
