#!/usr/bin/env node
// GalaxyGen MCP server — lets an AI tool (Claude or otherwise) drive the
// same galaxy generators the browser app uses (systemGen.js, planetGen.js,
// hyperlaneGen.js, factionGen.js, actorGen.js — imported straight from
// ../src/lib, no duplicated logic) against a project .json file on disk,
// without needing the app open. See README.md for the file-based (not
// live-app-sync) contract, the full tool list, and how to add more tools.
// The browser lib files (systemGen.js, hyperlaneGen.js, factionGen.js,
// actorGen.js, ...) call the Web Crypto `crypto.randomUUID()` as an
// ambient global, same as any browser code can. Node exposes that same API
// under `node:crypto`'s `webcrypto` export, but — at least on this Node 18
// build — only wires it up as the bare global `crypto` when the process is
// started via `node -e`, not when running an actual module file (confirmed
// directly: `node -e "console.log(typeof crypto)"` -> "object", but a
// `.mjs` file with the same line -> "undefined"). Polyfilling it here, once,
// before anything else loads, means every lib file keeps using the plain
// browser-style API with zero Node-specific branching anywhere in ../src.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";

const server = new McpServer({ name: "galaxygen", version: "0.1.0" });
registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
