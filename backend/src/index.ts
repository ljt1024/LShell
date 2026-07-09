import "./config/env.js";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { ConnectionManager } from "./ssh/ConnectionManager.js";
import { attachWebSocketServer } from "./websocket/server.js";

const app = express();
const connections = new ConnectionManager();
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(runtimeDir, "../..");
const frontendDist = path.join(projectRoot, "frontend", "dist");
const frontendIndex = path.join(frontendDist, "index.html");

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

if (process.env.LSHELL_SERVE_FRONTEND === "true") {
  app.use(express.static(frontendDist, { index: false }));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api") || request.path === "/ws") {
      next();
      return;
    }

    response.sendFile(frontendIndex, (error) => {
      if (error) {
        next(error);
      }
    });
  });
}

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
