import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { ConnectionManager } from "./ssh/ConnectionManager.js";
import { attachWebSocketServer } from "./websocket/server.js";

const app = express();
const connections = new ConnectionManager();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || true,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    name: "lshell-backend",
    time: new Date().toISOString()
  });
});

const server = http.createServer(app);
attachWebSocketServer(server, connections);

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`LShell backend listening at http://${host}:${port}`);
});

const idleSweep = setInterval(() => {
  void connections.sweepIdle(10 * 60 * 1000);
}, 60_000);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}, closing SSH sessions`);
  clearInterval(idleSweep);
  await connections.closeAll();
  server.close(() => process.exit(0));
}

process.on("SIGINT", (signal) => void shutdown(signal));
process.on("SIGTERM", (signal) => void shutdown(signal));
