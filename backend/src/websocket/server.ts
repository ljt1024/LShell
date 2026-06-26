import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import type { ClientMessage, ServerMessage } from "../models/protocol.js";
import { ConnectionManager } from "../ssh/ConnectionManager.js";
import { normalizeServerConfig } from "../utils/validation.js";

type ManagedSocket = WebSocket & { isAlive?: boolean };

export function attachWebSocketServer(server: Server, connections: ConnectionManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket: ManagedSocket) => {
    let sessionId: string | undefined;

    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    const send = (message: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const requireSession = () => {
      if (!sessionId) {
        throw new Error("请先建立 SSH 连接");
      }
      const session = connections.get(sessionId);
      if (!session) {
        throw new Error("SSH 会话已失效");
      }
      return session;
    };

    socket.on("message", async (raw) => {
      let message: ClientMessage | undefined;
      try {
        message = parseMessage(raw);

        switch (message.type) {
          case "connection.connect": {
            send({ type: "connection.status", status: "connecting", message: "正在连接远程主机" });
            if (sessionId) {
              await connections.remove(sessionId);
              sessionId = undefined;
            }
            const config = normalizeServerConfig(message.config);
            const session = await connections.create(config);
            sessionId = session.id;
            send({ type: "connection.ready", sessionId: session.id, name: session.name });
            send({ type: "connection.status", status: "connected" });
            break;
          }

          case "connection.disconnect": {
            if (sessionId) {
              await connections.remove(sessionId);
              sessionId = undefined;
            }
            send({ type: "connection.status", status: "disconnected" });
            break;
          }

          case "terminal.open": {
            const session = requireSession();
            await session.openTerminal(
              { cols: message.cols, rows: message.rows },
              (data) => send({ type: "terminal.output", data }),
              (code, signal) => send({ type: "terminal.closed", code, signal })
            );
            break;
          }

          case "terminal.input": {
            requireSession().writeTerminal(message.data);
            break;
          }

          case "terminal.resize": {
            requireSession().resizeTerminal(message.cols, message.rows);
            break;
          }

          case "file.list": {
            const files = await requireSession().listDirectory(message.path);
            send({ type: "file.list", path: message.path, files });
            break;
          }

          case "file.read": {
            const content = await requireSession().readFile(message.path);
            send({ type: "file.read", path: message.path, content });
            break;
          }

          case "file.write": {
            await requireSession().writeFile(message.path, message.content);
            send({ type: "file.saved", path: message.path });
            break;
          }

          case "file.mkdir": {
            await requireSession().mkdir(message.path);
            send({ type: "action.done", action: message.type, path: message.path });
            break;
          }

          case "file.remove": {
            await requireSession().remove(message.path);
            send({ type: "action.done", action: message.type, path: message.path });
            break;
          }

          case "file.rename": {
            await requireSession().rename(message.oldPath, message.newPath);
            send({ type: "action.done", action: message.type, path: message.newPath });
            break;
          }

          case "file.upload": {
            const buffer = Buffer.from(message.contentBase64, "base64");
            const targetPath = `${message.directory.replace(/\/$/, "")}/${message.fileName}`;
            await requireSession().writeBuffer(targetPath, buffer);
            send({ type: "file.uploaded", path: targetPath });
            break;
          }

          case "file.download": {
            const buffer = await requireSession().readFileBuffer(message.path);
            send({
              type: "file.download",
              path: message.path,
              fileName: message.path.split("/").pop() || "download",
              contentBase64: buffer.toString("base64")
            });
            break;
          }
        }
      } catch (error) {
        send({
          type: "error",
          requestType: message?.type,
          message: error instanceof Error ? error.message : "未知错误"
        });
      }
    });

    socket.on("close", () => {
      if (sessionId) {
        void connections.remove(sessionId);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients as Set<ManagedSocket>) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));
  return wss;
}

function parseMessage(raw: RawData): ClientMessage {
  const text = Buffer.isBuffer(raw)
    ? raw.toString("utf8")
    : Array.isArray(raw)
      ? Buffer.concat(raw).toString("utf8")
      : raw.toString();
  return JSON.parse(text) as ClientMessage;
}
