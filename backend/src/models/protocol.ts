export type AuthType = "password" | "privateKey";

export interface ServerConfig {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  group?: string;
}

export type RemoteFileType = "file" | "directory" | "symlink" | "other";

export interface FileInfo {
  name: string;
  path: string;
  type: RemoteFileType;
  size: number;
  permissions: string;
  modifyTime: number;
}

export type ClientMessage =
  | { type: "connection.connect"; config: ServerConfig }
  | { type: "connection.attach"; sessionId: string }
  | { type: "connection.disconnect" }
  | { type: "terminal.open"; cols: number; rows: number }
  | { type: "terminal.input"; data: string }
  | { type: "terminal.resize"; cols: number; rows: number }
  | { type: "file.list"; path: string; requestId?: string }
  | { type: "file.read"; path: string }
  | { type: "file.write"; path: string; content: string }
  | { type: "file.mkdir"; path: string }
  | { type: "file.remove"; path: string }
  | { type: "file.rename"; oldPath: string; newPath: string }
  | { type: "file.upload"; directory: string; fileName: string; contentBase64: string }
  | { type: "file.download"; path: string };

export type ServerMessage =
  | { type: "connection.status"; status: "idle" | "connecting" | "connected" | "disconnected"; message?: string }
  | { type: "connection.ready"; sessionId: string; name: string }
  | { type: "terminal.output"; data: string }
  | { type: "terminal.closed"; code?: number | null; signal?: string | null }
  | { type: "file.list"; path: string; files: FileInfo[]; requestId?: string }
  | { type: "file.read"; path: string; content: string }
  | { type: "file.saved"; path: string }
  | { type: "file.uploaded"; path: string }
  | { type: "file.download"; path: string; fileName: string; contentBase64: string }
  | { type: "action.done"; action: string; path?: string }
  | { type: "error"; message: string; requestType?: string; requestId?: string };
