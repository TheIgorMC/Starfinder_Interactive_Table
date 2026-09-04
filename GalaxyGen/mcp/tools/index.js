// One `register(server)` export per tool category, all wired up here.
// This is the ONLY file that needs a new line added when a whole new
// category shows up (e.g. an events.js for the effect engine) — adding
// tools to an *existing* category is just editing that category's file
// and needs no change here at all. See ../README.md for the walkthrough.
import * as project from "./project.js";
import * as sectors from "./sectors.js";
import * as fields from "./fields.js";
import * as systems from "./systems.js";
import * as planets from "./planets.js";
import * as hyperlanes from "./hyperlanes.js";
import * as factions from "./factions.js";
import * as actors from "./actors.js";
import * as organizations from "./organizations.js";
import * as query from "./query.js";

const MODULES = [project, sectors, fields, systems, planets, hyperlanes, factions, actors, organizations, query];

export function registerAllTools(server) {
  for (const mod of MODULES) mod.register(server);
}
