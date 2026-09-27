# Starfinder Interactive Table

- [`Docs/`](Docs/) — project-wide design docs (architecture, deployment, feature scope, roadmap)
- [`WebApp/starfinder-tool/`](WebApp/starfinder-tool/) — the GM/player web app (see its own README for setup and deploy)
- [`GalaxyGen/`](GalaxyGen/) — offline procedural galaxy generator (systems, sectors, factions, actors, ships); runs on a workstation, not deployed to the Orange Pi. Its output can be imported into the web app's **Galaxy** tab and linked to Campaign lore entries — see [`Docs/10-galaxy-mapgen.md`](Docs/10-galaxy-mapgen.md)
- [`MapCreator/`](MapCreator/) — placeholder for a future battle-map authoring tool; runs on a workstation, not deployed to the Orange Pi
- [`DataEntry/`](DataEntry/) — a disconnected draft-authoring pipeline for race/class/archetype/theme data; not imported anywhere yet, see `Docs/04-data-pipeline-aon.md`
