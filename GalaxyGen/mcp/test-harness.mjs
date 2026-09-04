// One-off smoke test — not part of the shipped server, just used to verify
// the tool set end-to-end via a real MCP client/transport before wiring it
// into an actual AI client's config. Delete or keep around for future
// module additions, your call.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.join(__dirname, "test-galaxy.json");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(__dirname, "server.js")],
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "test-harness", version: "0.0.1" });
await client.connect(transport);
transport.stderr?.on("data", (chunk) => process.stderr.write(`[server stderr] ${chunk}`));

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.map((c) => c.text).join("\n") ?? "";
  if (res.isError) {
    console.error(`FAIL ${name}:`, text);
    process.exitCode = 1;
    return null;
  }
  console.log(`ok   ${name}`);
  return text ? JSON.parse(text) : null;
}

const tools = await client.listTools();
console.log(`registered tools: ${tools.tools.length}`);

await call("new_project", { seed: "harness-test", width: 1000, height: 1000 });
await call("create_sector", {
  name: "Test Sector",
  focus: "mining",
  points: [[100, 100], [400, 100], [400, 400], [100, 400]],
});
await call("fill_sector_field", { sectorSlug: "test-sector", field: "population", value: 0.4 });
await call("fill_sector_field", { sectorSlug: "test-sector", field: "export", value: 0.8 });
const sample = await call("sample_field", { field: "population", x: 250, y: 250 });
if (!sample || Math.abs(sample.value - 0.4) > 0.01) throw new Error("sample_field mismatch");

const genSystems = await call("generate_systems", { minSpacing: 20, maxSpacing: 60 });
if (!genSystems || genSystems.systemCount < 1) throw new Error("generate_systems produced 0 systems");

const systems = await call("list_systems", {});
const firstSlug = systems[0].slug;
const detail = await call("get_system", { slug: firstSlug });
if (!Array.isArray(detail.bodies)) throw new Error("system missing bodies");

await call("generate_hyperlanes", {});
await call("redistribute_systems", {});
await call("generate_planets", {});

const bodies = await call("get_system_bodies", { slug: firstSlug });
console.log(`  ${firstSlug}: ${bodies.bodies.length} bodies, frostLine=${bodies.zones.frostLine.toFixed(2)}`);

await call("add_body", { systemSlug: firstSlug, kind: "rocky planet", orbitAU: 5 });
const afterAdd = await call("get_system_bodies", { slug: firstSlug });
const newBody = afterAdd.bodies.find((b) => b.name === "New Body");
if (!newBody) throw new Error("add_body didn't add a body");

await call("add_body", { systemSlug: firstSlug, kind: "orbital station", parentSlug: newBody.slug });
const afterStation = await call("get_system_bodies", { slug: firstSlug });
const station = afterStation.bodies.find((b) => b.kind === "orbital station");
if (!station) throw new Error("add_body didn't add a station");

await call("update_body", {
  systemSlug: firstSlug,
  bodySlug: station.slug,
  population: 500,
  services: ["refueling", "cantina"],
});
const afterUpdate = await call("get_system_bodies", { slug: firstSlug });
const updatedStation = afterUpdate.bodies.find((b) => b.slug === station.slug);
if (updatedStation.population !== 500) throw new Error("update_body didn't persist population");

await call("delete_body", { systemSlug: firstSlug, bodySlug: newBody.slug });

await call("create_faction", { name: "Test Combine", color: "#ff8844", government: "corporate", aggression: 0.3, strength: 0.5, x: 250, y: 250 });
await call("generate_factions", {});
await call("generate_background_actors", {});

await call("create_organization", { name: "Test Cartel", ideology: "profit", parentFaction: "dominion" });
const orgs = await call("list_organizations", {});
if (orgs.length !== 1) throw new Error("create_organization failed");

const models = await call("generate_ship_models", {});
if (!models || models.modelCount < 16) throw new Error("generate_ship_models produced too few models");
const modelList = await call("list_ship_models", { role: "cargo" });
if (!modelList.length) throw new Error("no cargo ship models generated");

const companiesResult = await call("generate_companies", {});
if (!companiesResult || companiesResult.generatedCount < 1) throw new Error("generate_companies produced 0 companies");
const companies = await call("list_companies", {});
const testCompanySlug = companies[0].slug;
const companyDetail = await call("get_company", { slug: testCompanySlug });
if (!Array.isArray(companyDetail.fleet) || companyDetail.fleet.length === 0) throw new Error("company has no fleet");

const newCompany = await call("create_company", { name: "Harness Test Line", kind: "cargo-line", scale: "small" });
await call("add_fleet_entry", { companySlug: newCompany.slug, modelSlug: modelList[0].slug, count: 5 });
const afterFleet = await call("get_company", { slug: newCompany.slug });
if (afterFleet.fleet[0].count !== 5) throw new Error("add_fleet_entry didn't persist");
await call("add_notable_ship", { companySlug: newCompany.slug, name: "Test Flagship", modelSlug: modelList[0].slug });
const afterShip = await call("get_company", { slug: newCompany.slug });
if (afterShip.notableShips.length !== 1) throw new Error("add_notable_ship didn't persist");
await call("update_notable_ship", { companySlug: newCompany.slug, shipSlug: afterShip.notableShips[0].slug, status: "lost" });
await call("remove_fleet_entry", { companySlug: newCompany.slug, modelSlug: modelList[0].slug });
await call("remove_notable_ship", { companySlug: newCompany.slug, shipSlug: afterShip.notableShips[0].slug });
await call("delete_company", { slug: newCompany.slug });

await call("get_ai_index", {});
const info = await call("project_info", {});
console.log("counts:", info.counts);

await call("save_project", { path: projectPath });
await call("load_project", { path: projectPath });
const reloaded = await call("project_info", {});
if (reloaded.counts.systems !== info.counts.systems) throw new Error("reload system count mismatch");

console.log(process.exitCode ? "\nSMOKE TEST: FAILURES ABOVE" : "\nSMOKE TEST: ALL PASSED");
await client.close();
