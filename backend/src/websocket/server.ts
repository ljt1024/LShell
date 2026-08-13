import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { assertExecutablePlan } from "../agent/safety.js";
import { createAgentPlan } from "../agent/qwenClient.js";
import type { ClientMessage, ServerMessage } from "../models/protocol.js";
import { collectServerOverview } from "../monitor/collectOverview.js";
import { addFirewallRule, readFirewallState, removeFirewallRule } from "../firewall/manageFirewall.js";
import { readAliyunSecurityGroups } from "../cloud/aliyunSecurityGroups.js";
import { joinRemotePath, normalizeRemotePath } from "../sftp/remotePath.js";
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

          case "connection.attach": {
            const session = connections.get(message.sessionId);
            if (!session) {
              throw new Error("SSH 会话已失效，请重新连接");
            }
            sessionId = session.id;
            send({ type: "connection.ready", sessionId: session.id, name: session.name });
            send({ type: "connection.status", status: "connected", message: "已恢复 SSH 连接" });
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

          case "server.overview": {
            const overview = await collectServerOverview(requireSession());
            send({ type: "server.overview", overview, requestId: message.requestId });
            break;
          }

          case "firewall.list": {
            const state = await readFirewallState(requireSession());
            send({ type: "firewall.state", state, requestId: message.requestId });
            break;
          }

          case "firewall.add": {
            const state = await addFirewallRule(requireSession(), message);
            send({ type: "firewall.state", state, requestId: message.requestId });
            break;
          }

          case "firewall.remove": {
            const state = await removeFirewallRule(requireSession(), message.ruleId);
            send({ type: "firewall.state", state, requestId: message.requestId });
            break;
          }

          case "cloud.aliyun-security-groups": {
            const state = await readAliyunSecurityGroups(requireSession());
            send({ type: "cloud.aliyun-security-groups", state, requestId: message.requestId });
            break;
          }

          case "file.list": {
            const files = await requireSession().listDirectory(message.path);
            send({ type: "file.list", path: message.path, files, requestId: message.requestId });
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
            const session = requireSession();
            const directory = normalizeRemotePath(message.directory);
            const targetPath = joinRemotePath(directory, message.fileName);
            await session.mkdirp(directory);
            await session.writeBuffer(targetPath, buffer);
            send({ type: "file.uploaded", path: targetPath, requestId: message.requestId, size: message.size });
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

          case "agent.plan": {
            const session = requireSession();
            const { requestId } = message;
            send({ type: "agent.plan.started", requestId });
            const plan = await createAgentPlan(message.intent, {
              currentPath: message.currentPath,
              connectionName: session.name,
              uploadedFiles: message.uploadedFiles
            }, {
              onDelta: (delta) => send({ type: "agent.plan.delta", delta, requestId })
            });
            send({ type: "agent.plan", plan, requestId });
            send({ type: "agent.plan.finished", requestId });
            break;
          }

          case "agent.execute": {
            const session = requireSession();
            const { requestId } = message;
            const plan = assertExecutablePlan(message.plan);

            let ok = true;
            for (const step of plan.steps) {
              send({ type: "agent.step.started", stepId: step.id, requestId });
              const result = await session.execCommand(step.command, {
                cwd: plan.currentPath,
                onData: (stream, data) =>
                  send({ type: "agent.step.output", stepId: step.id, stream, data, requestId })
              });
              send({ type: "agent.step.finished", stepId: step.id, result, requestId });

              if (result.exitCode !== 0) {
                ok = false;
                send({
                  type: "agent.execution.finished",
                  ok: false,
                  message: `步骤「${step.title}」失败，已停止后续执行`,
                  requestId
                });
                break;
              }
            }

            if (ok) {
              send({
                type: "agent.execution.finished",
                ok: true,
                message: "智能体计划执行完成",
                requestId
              });
            }
            break;
          }
        }
      } catch (error) {
        send({
          type: "error",
          requestType: message?.type,
          requestId: message && "requestId" in message ? message.requestId : undefined,
          message: error instanceof Error ? error.message : "未知错误"
        });
      }
    });

    socket.on("close", () => {
      sessionId = undefined;
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
