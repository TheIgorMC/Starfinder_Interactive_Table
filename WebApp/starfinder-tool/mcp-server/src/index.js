import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ensureSchema } from "./db.js";
import { PgOAuthProvider } from "./oauth-provider.js";
import { loginRouter } from "./login.js";
import { registerTools } from "./tools.js";

const PORT = Number(process.env.PORT || 3100);
const PUBLIC_URL = process.env.MCP_PUBLIC_URL;
if (!PUBLIC_URL) throw new Error("MCP_PUBLIC_URL is not set (e.g. https://sit-mcp.orion-project.it)");

const issuerUrl = new URL(PUBLIC_URL);
const mcpServerUrl = new URL("/mcp", PUBLIC_URL);
const provider = new PgOAuthProvider();

function buildMcpServer() {
  const server = new McpServer({ name: "starfinder-interactive-table", version: "0.1.0" }, { capabilities: {} });
  registerTools(server);
  return server;
}

async function main() {
  await ensureSchema();

  const app = express();
  app.set("trust proxy", true); // behind a reverse proxy (see .env.example / docker-compose.yml)

  // Authorization server: metadata, dynamic client registration, /authorize,
  // /token, /revoke — all generic, see oauth-provider.js for the actual logic.
  app.use(mcpAuthRouter({
    provider,
    issuerUrl,
    resourceServerUrl: mcpServerUrl,
    resourceName: "Starfinder Interactive Table",
    scopesSupported: ["mcp:tools"],
  }));

  // GM login page the /authorize flow bounces through (oauth-provider.js's
  // authorize() redirects here when there's no valid GM session yet).
  app.use(express.urlencoded({ extended: false }));
  app.use(loginRouter);

  app.use(express.json());

  const requireAuth = requireBearerAuth({
    verifier: provider,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  });

  // Streamable HTTP transport, one per MCP session (stateful — matches the
  // SDK's own reference server pattern), each session gets its own
  // McpServer/tool-registration instance.
  const transports = new Map();

  app.post("/mcp", requireAuth, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    try {
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport && !sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => transports.set(sid, transport),
        });
        transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
        await buildMcpServer().connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      if (!transport) {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID provided" }, id: null });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  const handleSessionRequest = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport = sessionId && transports.get(sessionId);
    if (!transport) return res.status(400).send("Invalid or missing session ID");
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", requireAuth, handleSessionRequest);
  app.delete("/mcp", requireAuth, handleSessionRequest);

  app.listen(PORT, () => console.log(`MCP server listening on :${PORT}, public URL ${PUBLIC_URL}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
