import { useCallback, useEffect, useRef, useState } from "react";
import { clearAgentHistory, readAgentHistory, upsertAgentHistoryItem, writeAgentHistory } from "../services/agentHistory";
import { downloadBase64File, fileToBase64 } from "../services/encoding";
import type {
  AgentHistoryStatus,
  AgentPlan,
  AgentPlanHistoryItem,
  AgentStepState,
  AgentUploadedFile,
  AliyunSecurityGroupState,
  AiProviderConfig,
  ClientMessage,
  ConnectionStatus,
  FileInfo,
  FirewallRuleAction,
  FirewallRuleProtocol,
  FirewallState,
  ServerConfig,
  ServerOverview,
  ServerMessage
} from "../types/protocol";

type TerminalWriter = (data: string) => void;

const PERSISTED_SESSION_KEY = "lshell-active-session";
const MAX_STREAM_CHARS = 30_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const DEFAULT_AI_CONFIG: AiProviderConfig = {
  apiKey: "",
  model: "qwen-plus",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
};
const AI_CONFIG_KEY = "lshell-ai-config";

function readAiConfig(): AiProviderConfig {
  try {
    const value = JSON.parse(window.localStorage.getItem(AI_CONFIG_KEY) || "null") as Partial<AiProviderConfig> | null;
    return { ...DEFAULT_AI_CONFIG, ...value };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

interface PersistedSession {
  sessionId: string;
  name: string;
  currentPath: string;
}

interface PendingAgentUpload {
  fileName: string;
  directory: string;
  size: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

export function useWebShell() {
  const [aiConfig, setAiConfigState] = useState<AiProviderConfig>(() => readAiConfig());
  const socketRef = useRef<WebSocket | null>(null);
  const openSocketRef = useRef<(onOpen: (socket: WebSocket) => void) => void>();
  const reconnectTimerRef = useRef<number>();
  const reconnectAttemptRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const mountedRef = useRef(true);
  const lastConfigRef = useRef<ServerConfig>();
  const terminalWriterRef = useRef<TerminalWriter | null>(null);
  const currentPathRef = useRef("/");
  const requestSequenceRef = useRef(0);
  const navigationRequestRef = useRef<string>();
  const directoryRequestsRef = useRef(new Map<string, string>());
  const agentRequestRef = useRef<string>();
  const agentIntentRef = useRef("");
  const agentPlanRef = useRef<AgentPlan>();
  const agentStepStatesRef = useRef<Record<string, AgentStepState>>({});
  const agentUploadedFilesRef = useRef<AgentUploadedFile[]>([]);
  const pendingAgentUploadsRef = useRef(new Map<string, PendingAgentUpload>());

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [sessionId, setSessionId] = useState<string>();
  const [connectionName, setConnectionName] = useState<string>();
  const [error, setError] = useState<string>();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [activeFilePath, setActiveFilePath] = useState<string>();
  const [fileContent, setFileContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [directoryCache, setDirectoryCache] = useState<Record<string, FileInfo[]>>({});
  const [loadingDirectories, setLoadingDirectories] = useState<string[]>([]);
  const [agentPlan, setAgentPlan] = useState<AgentPlan>();
  const [agentStepStates, setAgentStepStates] = useState<Record<string, AgentStepState>>({});
  const [agentGenerating, setAgentGenerating] = useState(false);
  const [agentExecuting, setAgentExecuting] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string>();
  const [agentPlanStream, setAgentPlanStream] = useState("");
  const [agentHistory, setAgentHistory] = useState<AgentPlanHistoryItem[]>(() => readAgentHistory());
  const [agentUploadedFiles, setAgentUploadedFiles] = useState<AgentUploadedFile[]>([]);
  const [agentUploading, setAgentUploading] = useState(false);
  const [agentUploadMessage, setAgentUploadMessage] = useState<string>();
  const [connectionInterrupted, setConnectionInterrupted] = useState(false);
  const [reconnectMessage, setReconnectMessage] = useState<string>();
  const [serverOverview, setServerOverview] = useState<ServerOverview>();
  const [serverOverviewLoading, setServerOverviewLoading] = useState(false);
  const [firewallState, setFirewallState] = useState<FirewallState>();
  const [firewallLoading, setFirewallLoading] = useState(false);
  const [aliyunSecurityGroups, setAliyunSecurityGroups] = useState<AliyunSecurityGroupState>();
  const [aliyunSecurityGroupsLoading, setAliyunSecurityGroupsLoading] = useState(false);

  const updateAgentHistory = useCallback((updater: (current: AgentPlanHistoryItem[]) => AgentPlanHistoryItem[]) => {
    setAgentHistory((current) => writeAgentHistory(updater(current)));
  }, []);

  const persistActiveAgentPlan = useCallback(
    (status: AgentHistoryStatus, stepStates = agentStepStatesRef.current) => {
      const plan = agentPlanRef.current;
      if (!plan) {
        return;
      }

      const now = new Date().toISOString();
      const item: AgentPlanHistoryItem = {
        id: plan.id,
        intent: agentIntentRef.current,
        connectionName,
        uploadedFiles: agentUploadedFilesRef.current,
        plan,
        createdAt: plan.createdAt,
        updatedAt: now,
        executionStatus: status,
        stepStates
      };
      updateAgentHistory((current) => upsertAgentHistoryItem(current, item));
    },
    [connectionName, updateAgentHistory]
  );

  const replaceAgentStepStates = useCallback((next: Record<string, AgentStepState>) => {
    agentStepStatesRef.current = next;
    setAgentStepStates(next);
  }, []);

  const updateAgentStepStates = useCallback((updater: (current: Record<string, AgentStepState>) => Record<string, AgentStepState>) => {
    setAgentStepStates((current) => {
      const next = updater(current);
      agentStepStatesRef.current = next;
      return next;
    });
  }, []);

  const replaceAgentUploadedFiles = useCallback((files: AgentUploadedFile[]) => {
    agentUploadedFilesRef.current = files;
    setAgentUploadedFiles(files);
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("WebSocket 尚未连接");
      return;
    }
    socket.send(JSON.stringify(message));
  }, []);

  const listFiles = useCallback(
    (path = currentPathRef.current) => {
      const requestId = `navigation:${++requestSequenceRef.current}`;
      navigationRequestRef.current = requestId;
      send({ type: "file.list", path, requestId });
    },
    [send]
  );

  const loadDirectory = useCallback(
    (path: string) => {
      const requestId = `tree:${++requestSequenceRef.current}`;
      directoryRequestsRef.current.set(requestId, path);
      setLoadingDirectories((current) => (current.includes(path) ? current : [...current, path]));
      send({ type: "file.list", path, requestId });
    },
    [send]
  );

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "connection.status":
          setStatus(message.status);
          if (message.message) {
            setError(undefined);
          }
          break;
        case "connection.ready":
          reconnectAttemptRef.current = 0;
          if (reconnectTimerRef.current !== undefined) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = undefined;
          }
          setSessionId(message.sessionId);
          setConnectionName(message.name);
          setStatus("connected");
          setError(undefined);
          setConnectionInterrupted(false);
          setReconnectMessage(undefined);
          persistSession({
            sessionId: message.sessionId,
            name: message.name,
            currentPath: currentPathRef.current
          });
          listFiles(currentPathRef.current);
          break;
        case "terminal.output":
          terminalWriterRef.current?.(message.data);
          break;
        case "terminal.closed":
          terminalWriterRef.current?.("\r\n[terminal closed]\r\n");
          break;
        case "server.overview":
          setServerOverview(message.overview);
          setServerOverviewLoading(false);
          break;
        case "firewall.state":
          setFirewallState(message.state);
          setFirewallLoading(false);
          setServerOverviewLoading(false);
          break;
        case "cloud.aliyun-security-groups":
          setAliyunSecurityGroups(message.state);
          setAliyunSecurityGroupsLoading(false);
          break;
        case "file.list":
          setDirectoryCache((current) => ({ ...current, [message.path]: message.files }));
          if (message.requestId) {
            const requestedDirectory = directoryRequestsRef.current.get(message.requestId);
            if (requestedDirectory) {
              directoryRequestsRef.current.delete(message.requestId);
              setLoadingDirectories((current) => current.filter((path) => path !== requestedDirectory));
            }
          }
          if (!message.requestId || message.requestId === navigationRequestRef.current) {
            currentPathRef.current = message.path;
            setCurrentPath(message.path);
            setFiles(message.files);
            updatePersistedSession({ currentPath: message.path });
          }
          break;
        case "file.read":
          setActiveFilePath(message.path);
          setFileContent(message.content);
          setDirty(false);
          break;
        case "file.saved":
          setDirty(false);
          listFiles(currentPathRef.current);
          break;
        case "file.uploaded": {
          const pendingUpload = message.requestId ? pendingAgentUploadsRef.current.get(message.requestId) : undefined;
          if (pendingUpload) {
            pendingAgentUploadsRef.current.delete(message.requestId!);
            const uploadedFile: AgentUploadedFile = {
              id: message.requestId!,
              name: pendingUpload.fileName,
              path: message.path,
              directory: pendingUpload.directory,
              size: message.size ?? pendingUpload.size,
              uploadedAt: new Date().toISOString()
            };
            replaceAgentUploadedFiles([uploadedFile, ...agentUploadedFilesRef.current]);
            setAgentUploading(pendingAgentUploadsRef.current.size > 0);
            setAgentUploadMessage(`${pendingUpload.fileName} 已上传到 ${message.path}`);
            pendingUpload.resolve();
          }
          listFiles(currentPathRef.current);
          break;
        }
        case "action.done":
          listFiles(currentPathRef.current);
          break;
        case "file.download":
          downloadBase64File(message.fileName, message.contentBase64);
          break;
        case "agent.plan.started":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          setAgentGenerating(true);
          setAgentPlanStream("");
          setAgentMessage("正在生成计划...");
          break;
        case "agent.plan.delta":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          setAgentPlanStream((current) => trimStream(`${current}${message.delta}`));
          break;
        case "agent.plan":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          agentPlanRef.current = message.plan;
          setAgentPlan(message.plan);
          replaceAgentStepStates(createInitialAgentStepStates(message.plan));
          setAgentMessage("计划已生成，请检查后确认执行");
          persistActiveAgentPlan("planned", createInitialAgentStepStates(message.plan));
          break;
        case "agent.plan.finished":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          setAgentGenerating(false);
          break;
        case "agent.step.started":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          updateAgentStepStates((current) => {
            const next = {
              ...current,
              [message.stepId]: { ...current[message.stepId], status: "running" as const }
            };
            persistActiveAgentPlan("running", next);
            return next;
          });
          break;
        case "agent.step.output":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          updateAgentStepStates((current) => {
            const previous = current[message.stepId] ?? { status: "running" as const };
            const nextState = {
              ...previous,
              status: previous.status === "pending" ? "running" as const : previous.status,
              [message.stream]: trimStream(`${previous[message.stream] ?? ""}${message.data}`)
            };
            return {
              ...current,
              [message.stepId]: nextState
            };
          });
          break;
        case "agent.step.finished":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          updateAgentStepStates((current) => {
            const next = {
              ...current,
              [message.stepId]: {
                status: message.result.exitCode === 0 ? "success" as const : "failed" as const,
                stdout: message.result.stdout,
                stderr: message.result.stderr,
                result: message.result
              }
            };
            persistActiveAgentPlan(message.result.exitCode === 0 ? "running" : "failed", next);
            return next;
          });
          break;
        case "agent.execution.finished":
          if (message.requestId && message.requestId !== agentRequestRef.current) {
            break;
          }
          setAgentExecuting(false);
          setAgentMessage(message.message);
          persistActiveAgentPlan(message.ok ? "success" : "failed");
          if (message.ok) {
            listFiles(currentPathRef.current);
          }
          break;
        case "error":
          setStatus((previous) => (previous === "connecting" ? "error" : previous));
          setError(message.message);
          if (message.requestType?.startsWith("agent.")) {
            setAgentGenerating(false);
            setAgentExecuting(false);
            setAgentMessage(message.message);
            persistActiveAgentPlan("failed");
          }
          if (message.requestType === "server.overview") {
            setServerOverviewLoading(false);
          }
          if (message.requestType?.startsWith("firewall.")) {
            setFirewallLoading(false);
          }
          if (message.requestType === "cloud.aliyun-security-groups") {
            setAliyunSecurityGroupsLoading(false);
          }
          if (message.requestId) {
            const pendingUpload = pendingAgentUploadsRef.current.get(message.requestId);
            if (pendingUpload) {
              pendingAgentUploadsRef.current.delete(message.requestId);
              setAgentUploading(pendingAgentUploadsRef.current.size > 0);
              setAgentUploadMessage(message.message);
              pendingUpload.reject(new Error(message.message));
            }
          }
          if (message.requestType === "connection.attach") {
            clearPersistedSession();
            setSessionId(undefined);
            setConnectionName(undefined);
            setStatus("disconnected");
            setConnectionInterrupted(true);
            setReconnectMessage(
              lastConfigRef.current
                ? "原 SSH 会话已失效，可以使用当前页面保留的连接参数重新建立连接。"
                : "原 SSH 会话已失效，请返回连接面板重新输入认证信息。"
            );
          }
          if (message.requestId) {
            const requestedDirectory = directoryRequestsRef.current.get(message.requestId);
            if (requestedDirectory) {
              directoryRequestsRef.current.delete(message.requestId);
              setLoadingDirectories((current) => current.filter((path) => path !== requestedDirectory));
            }
          }
          terminalWriterRef.current?.(`\r\n[error] ${message.message}\r\n`);
          break;
      }
    },
    [listFiles, persistActiveAgentPlan, replaceAgentStepStates, replaceAgentUploadedFiles, updateAgentStepStates]
  );

  const openSocket = useCallback(
    (onOpen: (socket: WebSocket) => void) => {
      const previousSocket = socketRef.current;
      if (previousSocket) {
        previousSocket.onclose = null;
        previousSocket.close();
      }

      const socket = new WebSocket(resolveWebSocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        if (!mountedRef.current) {
          socket.close();
          return;
        }
        onOpen(socket);
      };

      socket.onmessage = (event) => {
        handleMessage(JSON.parse(event.data) as ServerMessage);
      };

      socket.onerror = () => {
        if (!readPersistedSession()) {
          setStatus("error");
          setError("WebSocket 连接失败");
          setConnectionInterrupted(true);
          setReconnectMessage("无法连接本地服务，请确认后端运行后重试。");
        }
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }
        socketRef.current = null;
        const persistedSession = readPersistedSession();
        if (!mountedRef.current || manualDisconnectRef.current || !persistedSession?.sessionId) {
          setStatus((previous) => (previous === "connected" || previous === "connecting" ? "disconnected" : previous));
          return;
        }

        const attempt = ++reconnectAttemptRef.current;
        const delay = Math.min(1_000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
        setStatus("connecting");
        setError(`连接中断，${Math.round(delay / 1_000)} 秒后自动重连...`);
        setConnectionInterrupted(true);
        setReconnectMessage("连接意外中断，正在尝试恢复原 SSH 会话。");
        reconnectTimerRef.current = window.setTimeout(() => {
          if (!mountedRef.current || manualDisconnectRef.current) {
            return;
          }
          openSocketRef.current?.((nextSocket) => {
            nextSocket.send(
              JSON.stringify({
                type: "connection.attach",
                sessionId: persistedSession.sessionId
              } satisfies ClientMessage)
            );
          });
        }, delay);
      };
    },
    [handleMessage]
  );

  openSocketRef.current = openSocket;

  const connect = useCallback(
    (config: ServerConfig) => {
      lastConfigRef.current = config;
      manualDisconnectRef.current = false;
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current !== undefined) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = undefined;
      }
      setStatus("connecting");
      setError(undefined);
      setConnectionInterrupted(false);
      setReconnectMessage(undefined);
      setFiles([]);
      setServerOverview(undefined);
      setFirewallState(undefined);
      setAliyunSecurityGroups(undefined);
      setActiveFilePath(undefined);
      setFileContent("");
      setDirty(false);
      setDirectoryCache({});
      setLoadingDirectories([]);
      setAgentPlan(undefined);
      agentPlanRef.current = undefined;
      replaceAgentStepStates({});
      setAgentGenerating(false);
      setAgentExecuting(false);
      setAgentMessage(undefined);
      setAgentPlanStream("");
      replaceAgentUploadedFiles([]);
      setAgentUploading(false);
      setAgentUploadMessage(undefined);
      directoryRequestsRef.current.clear();
      currentPathRef.current = "/";
      setCurrentPath("/");
      clearPersistedSession();

      openSocket((socket) => {
        socket.send(JSON.stringify({ type: "connection.connect", config } satisfies ClientMessage));
      });
    },
    [openSocket, replaceAgentStepStates, replaceAgentUploadedFiles]
  );

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current !== undefined) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    clearPersistedSession();
    send({ type: "connection.disconnect" });
    socketRef.current?.close();
    socketRef.current = null;
    setSessionId(undefined);
    setConnectionName(undefined);
    setFiles([]);
    setServerOverview(undefined);
    setFirewallState(undefined);
    setAliyunSecurityGroups(undefined);
    setDirectoryCache({});
    setLoadingDirectories([]);
    setAgentPlan(undefined);
    agentPlanRef.current = undefined;
    replaceAgentStepStates({});
    setAgentGenerating(false);
    setAgentExecuting(false);
    setAgentMessage(undefined);
    setAgentPlanStream("");
    replaceAgentUploadedFiles([]);
    setAgentUploading(false);
    setAgentUploadMessage(undefined);
    directoryRequestsRef.current.clear();
    setStatus("disconnected");
    setConnectionInterrupted(false);
    setReconnectMessage(undefined);
  }, [replaceAgentStepStates, replaceAgentUploadedFiles, send]);

  const reconnectNow = useCallback(() => {
    manualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current !== undefined) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }

    const persistedSession = readPersistedSession();
    if (persistedSession?.sessionId) {
      setStatus("connecting");
      setError(undefined);
      setReconnectMessage("正在恢复原 SSH 会话...");
      openSocket((socket) => {
        socket.send(
          JSON.stringify({
            type: "connection.attach",
            sessionId: persistedSession.sessionId
          } satisfies ClientMessage)
        );
      });
      return;
    }

    const config = lastConfigRef.current;
    if (config) {
      setReconnectMessage("正在重新建立 SSH 连接...");
      connect(config);
      return;
    }

    setStatus("disconnected");
    setConnectionInterrupted(true);
    setReconnectMessage("认证信息未保存在页面中，请打开连接设置重新输入后连接。");
  }, [connect, openSocket]);

  const dismissReconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (reconnectTimerRef.current !== undefined) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    const socket = socketRef.current;
    if (socket) {
      socket.onclose = null;
      socket.close();
      socketRef.current = null;
    }
    setStatus("disconnected");
    setConnectionInterrupted(false);
  }, []);

  useEffect(() => {
    const persistedSession = readPersistedSession();
    if (!persistedSession?.sessionId) {
      return;
    }

    currentPathRef.current = persistedSession.currentPath || "/";
    setCurrentPath(currentPathRef.current);
    setSessionId(persistedSession.sessionId);
    setConnectionName(persistedSession.name);
    setStatus("connecting");
    setError(undefined);
    manualDisconnectRef.current = false;

    openSocket((socket) => {
      socket.send(
        JSON.stringify({
          type: "connection.attach",
          sessionId: persistedSession.sessionId
        } satisfies ClientMessage)
      );
    });
  }, [openSocket]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current !== undefined) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      const socket = socketRef.current;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      socketRef.current = null;
    };
  }, []);

  const registerTerminalWriter = useCallback((writer: TerminalWriter) => {
    terminalWriterRef.current = writer;
    return () => {
      if (terminalWriterRef.current === writer) {
        terminalWriterRef.current = null;
      }
    };
  }, []);

  const updateFileContent = useCallback((content: string) => {
    setFileContent(content);
    setDirty(true);
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const contentBase64 = await fileToBase64(file);
      send({ type: "file.upload", directory: currentPathRef.current, fileName: file.name, contentBase64 });
    },
    [send]
  );

  const uploadAgentFile = useCallback(
    async (file: File, directory: string) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket 尚未连接");
      }

      const targetDirectory = directory.trim() || currentPathRef.current;
      const requestId = `agent-upload:${++requestSequenceRef.current}`;
      setAgentUploading(true);
      setAgentUploadMessage(`${file.name} 正在上传...`);

      let contentBase64: string;
      try {
        contentBase64 = await fileToBase64(file);
      } catch (error) {
        setAgentUploading(pendingAgentUploadsRef.current.size > 0);
        setAgentUploadMessage(error instanceof Error ? error.message : "读取本地文件失败");
        throw error;
      }

      await new Promise<void>((resolve, reject) => {
        pendingAgentUploadsRef.current.set(requestId, {
          fileName: file.name,
          directory: targetDirectory,
          size: file.size,
          resolve,
          reject
        });
        try {
          socket.send(
            JSON.stringify({
              type: "file.upload",
              directory: targetDirectory,
              fileName: file.name,
              contentBase64,
              requestId,
              size: file.size
            } satisfies ClientMessage)
          );
        } catch (error) {
          pendingAgentUploadsRef.current.delete(requestId);
          setAgentUploading(pendingAgentUploadsRef.current.size > 0);
          reject(error instanceof Error ? error : new Error("上传发送失败"));
        }
      });
    },
    []
  );

  const openTerminal = useCallback(
    (cols: number, rows: number) => send({ type: "terminal.open", cols, rows }),
    [send]
  );

  const sendTerminalInput = useCallback((data: string) => send({ type: "terminal.input", data }), [send]);

  const resizeTerminal = useCallback(
    (cols: number, rows: number) => send({ type: "terminal.resize", cols, rows }),
    [send]
  );

  const refreshServerOverview = useCallback(() => {
    setServerOverviewLoading(true);
    send({ type: "server.overview", requestId: `overview:${++requestSequenceRef.current}` });
  }, [send]);

  const refreshFirewall = useCallback(() => {
    setFirewallLoading(true);
    send({ type: "firewall.list", requestId: `firewall-list:${++requestSequenceRef.current}` });
  }, [send]);

  const addFirewallRule = useCallback(
    (rule: { action: FirewallRuleAction; source: string; port?: number; protocol?: FirewallRuleProtocol }) => {
      setFirewallLoading(true);
      send({ type: "firewall.add", ...rule, requestId: `firewall-add:${++requestSequenceRef.current}` });
    },
    [send]
  );

  const removeFirewallRule = useCallback(
    (ruleId: string) => {
      setFirewallLoading(true);
      send({ type: "firewall.remove", ruleId, requestId: `firewall-remove:${++requestSequenceRef.current}` });
    },
    [send]
  );

  const refreshAliyunSecurityGroups = useCallback(() => {
    setAliyunSecurityGroupsLoading(true);
    send({ type: "cloud.aliyun-security-groups", requestId: `aliyun-security-groups:${++requestSequenceRef.current}` });
  }, [send]);

  const readFile = useCallback((path: string) => send({ type: "file.read", path }), [send]);

  const saveFile = useCallback(() => {
    if (activeFilePath) {
      send({ type: "file.write", path: activeFilePath, content: fileContent });
    }
  }, [activeFilePath, fileContent, send]);

  const closeEditor = useCallback(() => {
    setActiveFilePath(undefined);
    setFileContent("");
    setDirty(false);
  }, []);

  const mkdir = useCallback((path: string) => send({ type: "file.mkdir", path }), [send]);
  const remove = useCallback((path: string) => send({ type: "file.remove", path }), [send]);
  const rename = useCallback((oldPath: string, newPath: string) => send({ type: "file.rename", oldPath, newPath }), [send]);
  const downloadFile = useCallback((path: string) => send({ type: "file.download", path }), [send]);

  const planAgentTask = useCallback(
    (intent: string) => {
      const requestId = `agent-plan:${++requestSequenceRef.current}`;
      agentRequestRef.current = requestId;
      agentIntentRef.current = intent.trim();
      agentPlanRef.current = undefined;
      setAgentGenerating(true);
      setAgentExecuting(false);
      setAgentMessage(undefined);
      setAgentPlan(undefined);
      setAgentPlanStream("");
      replaceAgentStepStates({});
      send({
        type: "agent.plan",
        intent,
        currentPath: currentPathRef.current,
        uploadedFiles: agentUploadedFilesRef.current,
        aiConfig,
        requestId
      });
    },
    [aiConfig, replaceAgentStepStates, send]
  );

  const setAiConfig = useCallback((next: AiProviderConfig) => {
    setAiConfigState(next);
    window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(next));
  }, []);

  const executeAgentPlan = useCallback(
    (plan: AgentPlan) => {
      const requestId = `agent-execute:${++requestSequenceRef.current}`;
      agentRequestRef.current = requestId;
      agentPlanRef.current = plan;
      setAgentExecuting(true);
      setAgentMessage(undefined);
      const initialStepStates = createInitialAgentStepStates(plan);
      replaceAgentStepStates(initialStepStates);
      persistActiveAgentPlan("running", initialStepStates);
      send({ type: "agent.execute", plan, requestId });
    },
    [persistActiveAgentPlan, replaceAgentStepStates, send]
  );

  const resetAgent = useCallback(() => {
    setAgentPlan(undefined);
    agentPlanRef.current = undefined;
    agentIntentRef.current = "";
    replaceAgentStepStates({});
    setAgentGenerating(false);
    setAgentExecuting(false);
    setAgentMessage(undefined);
    setAgentPlanStream("");
  }, [replaceAgentStepStates]);

  const removeAgentUploadedFile = useCallback(
    (fileId: string) => {
      replaceAgentUploadedFiles(agentUploadedFilesRef.current.filter((file) => file.id !== fileId));
    },
    [replaceAgentUploadedFiles]
  );

  const clearAgentUploadedFiles = useCallback(() => {
    replaceAgentUploadedFiles([]);
    setAgentUploadMessage(undefined);
  }, [replaceAgentUploadedFiles]);

  const loadAgentHistoryItem = useCallback(
    (item: AgentPlanHistoryItem) => {
      agentIntentRef.current = item.intent;
      agentPlanRef.current = item.plan;
      setAgentPlan(item.plan);
      replaceAgentUploadedFiles(item.uploadedFiles ?? []);
      replaceAgentStepStates(item.stepStates);
      setAgentGenerating(false);
      setAgentExecuting(false);
      setAgentPlanStream("");
      setAgentMessage(`已载入历史计划：${item.plan.title}`);
    },
    [replaceAgentStepStates, replaceAgentUploadedFiles]
  );

  const clearAgentHistoryItems = useCallback(() => {
    clearAgentHistory();
    setAgentHistory([]);
  }, []);

  return {
    status,
    sessionId,
    connectionName,
    error,
    files,
    directoryCache,
    loadingDirectories,
    currentPath,
    activeFilePath,
    fileContent,
    dirty,
    agentPlan,
    agentStepStates,
    agentGenerating,
    agentExecuting,
    agentMessage,
    agentPlanStream,
    agentHistory,
    agentUploadedFiles,
    agentUploading,
    aiConfig,
    setAiConfig,
    agentUploadMessage,
    connectionInterrupted,
    reconnectMessage,
    serverOverview,
    serverOverviewLoading,
    firewallState,
    firewallLoading,
    aliyunSecurityGroups,
    aliyunSecurityGroupsLoading,
    connect,
    disconnect,
    reconnectNow,
    dismissReconnect,
    registerTerminalWriter,
    openTerminal,
    sendTerminalInput,
    resizeTerminal,
    refreshServerOverview,
    refreshFirewall,
    addFirewallRule,
    removeFirewallRule,
    refreshAliyunSecurityGroups,
    listFiles,
    loadDirectory,
    readFile,
    saveFile,
    closeEditor,
    updateFileContent,
    mkdir,
    remove,
    rename,
    uploadFile,
    uploadAgentFile,
    downloadFile,
    planAgentTask,
    executeAgentPlan,
    resetAgent,
    removeAgentUploadedFile,
    clearAgentUploadedFiles,
    loadAgentHistoryItem,
    clearAgentHistoryItems,
    clearError: () => setError(undefined)
  };
}

function createInitialAgentStepStates(plan: AgentPlan): Record<string, AgentStepState> {
  return Object.fromEntries(plan.steps.map((step) => [step.id, { status: "pending" as const }]));
}

function trimStream(value: string): string {
  if (value.length <= MAX_STREAM_CHARS) {
    return value;
  }
  return value.slice(value.length - MAX_STREAM_CHARS);
}

function resolveWebSocketUrl(): string {
  const desktopUrl = resolveDesktopWebSocketUrl();
  if (desktopUrl) {
    return desktopUrl;
  }

  const explicitUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicitUrl) {
    return explicitUrl;
  }

  if (import.meta.env.DEV && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return "ws://127.0.0.1:8080/ws";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function resolveDesktopWebSocketUrl(): string | undefined {
  const backendUrl = window.lshellDesktop?.backendUrl;
  if (!backendUrl) {
    return undefined;
  }

  try {
    const url = new URL("/ws", backendUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return undefined;
  }
}

function readPersistedSession(): PersistedSession | undefined {
  try {
    const raw = window.sessionStorage.getItem(PERSISTED_SESSION_KEY);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as PersistedSession;
  } catch {
    clearPersistedSession();
    return undefined;
  }
}

function persistSession(session: PersistedSession): void {
  window.sessionStorage.setItem(PERSISTED_SESSION_KEY, JSON.stringify(session));
}

function updatePersistedSession(update: Partial<PersistedSession>): void {
  const current = readPersistedSession();
  if (!current) {
    return;
  }
  persistSession({ ...current, ...update });
}

function clearPersistedSession(): void {
  window.sessionStorage.removeItem(PERSISTED_SESSION_KEY);
}
