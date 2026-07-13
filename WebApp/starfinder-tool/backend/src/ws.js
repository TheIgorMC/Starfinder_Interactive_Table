import { WebSocketServer } from "ws";

let wss;

export function initWs(server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (sock) => {
    sock.send(JSON.stringify({ type: "hello", ts: Date.now() }));
  });
  return wss;
}

export function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}
