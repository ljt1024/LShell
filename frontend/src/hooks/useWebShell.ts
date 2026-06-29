import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBase64File, fileToBase64 } from "../services/encoding";
import type { ClientMessage, ConnectionStatus, FileInfo, ServerConfig, ServerMessage } from "../types/protocol";

type TerminalWriter = (data: string) => void;

const PERSISTED_SESSION_KEY = "lshell-active-session";

interface PersistedSession {
  sessionId: string;
  name: string;
  currentPath: string;
}

export function useWebShell() {
  const socketRef = useRef<WebSocket | null>(null);
  const terminalWriterRef = useRef<TerminalWriter | null>(null);
  const currentPathRef = useRef("/");
  const requestSequenceRef = useRef(0);
  const navigationRequestRef = useRef<string>();
  const directoryRequestsRef = useRef(new Map<string, string>());

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
          setSessionId(message.sessionId);
          setConnectionName(message.name);
          setStatus("connected");
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
        case "file.uploaded":
        case "action.done":
          listFiles(currentPathRef.current);
          break;
        case "file.download":
          downloadBase64File(message.fileName, message.contentBase64);
          break;
        case "error":
          setStatus((previous) => (previous === "connecting" ? "error" : previous));
          setError(message.message);
          if (message.requestType === "connection.attach") {
            clearPersistedSession();
            setSessionId(undefined);
            setConnectionName(undefined);
            setStatus("disconnected");
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
    [listFiles]
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

      socket.onopen = () => onOpen(socket);

      socket.onmessage = (event) => {
        handleMessage(JSON.parse(event.data) as ServerMessage);
      };

      socket.onerror = () => {
        setStatus("error");
        setError("WebSocket 连接失败");
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }
        setStatus((previous) => (previous === "connected" || previous === "connecting" ? "disconnected" : previous));
      };
    },
    [handleMessage]
  );

  const connect = useCallback(
    (config: ServerConfig) => {
      setStatus("connecting");
      setError(undefined);
      setFiles([]);
      setActiveFilePath(undefined);
      setFileContent("");
      setDirty(false);
      setDirectoryCache({});
      setLoadingDirectories([]);
      directoryRequestsRef.current.clear();
      currentPathRef.current = "/";
      setCurrentPath("/");
      clearPersistedSession();

      openSocket((socket) => {
        socket.send(JSON.stringify({ type: "connection.connect", config } satisfies ClientMessage));
      });
    },
    [openSocket]
  );

  const disconnect = useCallback(() => {
    clearPersistedSession();
    send({ type: "connection.disconnect" });
    socketRef.current?.close();
    socketRef.current = null;
    setSessionId(undefined);
    setConnectionName(undefined);
    setFiles([]);
    setDirectoryCache({});
    setLoadingDirectories([]);
    directoryRequestsRef.current.clear();
    setStatus("disconnected");
  }, [send]);

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

    openSocket((socket) => {
      socket.send(
        JSON.stringify({
          type: "connection.attach",
          sessionId: persistedSession.sessionId
        } satisfies ClientMessage)
      );
    });
  }, [openSocket]);

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

  const openTerminal = useCallback(
    (cols: number, rows: number) => send({ type: "terminal.open", cols, rows }),
    [send]
  );

  const sendTerminalInput = useCallback((data: string) => send({ type: "terminal.input", data }), [send]);

  const resizeTerminal = useCallback(
    (cols: number, rows: number) => send({ type: "terminal.resize", cols, rows }),
    [send]
  );

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
    connect,
    disconnect,
    registerTerminalWriter,
    openTerminal,
    sendTerminalInput,
    resizeTerminal,
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
    downloadFile,
    clearError: () => setError(undefined)
  };
}

function resolveWebSocketUrl(): string {
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
