import fs from "node:fs/promises";
import { Client } from "ssh2";
import type { ClientChannel, ConnectConfig, SFTPWrapper } from "ssh2";
import type { AgentStepExecutionResult, FileInfo, ServerConfig } from "../models/protocol.js";
import { joinRemotePath, normalizeRemotePath } from "../sftp/remotePath.js";

type SftpEntry = {
  filename: string;
  attrs: {
    size: number;
    mtime: number;
    mode: number;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  };
};

export class SSHSession {
  readonly id: string;
  readonly name: string;

  private readonly config: ServerConfig;
  private readonly client = new Client();
  private sftp?: SFTPWrapper;
  private terminal?: ClientChannel;
  private terminalOutput?: (data: string) => void;
  private terminalClosed?: (code?: number | null, signal?: string | null) => void;
  private connected = false;
  private lastUsedAt = Date.now();

  constructor(id: string, config: ServerConfig) {
    this.id = id;
    this.config = config;
    this.name = config.name;
  }

  get idleMs(): number {
    return Date.now() - this.lastUsedAt;
  }

  async connect(): Promise<void> {
    const connectConfig = await this.buildConnectConfig();

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        this.connected = true;
        this.touch();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.client.off("ready", onReady);
        this.client.off("error", onError);
      };

      this.client.once("ready", onReady);
      this.client.once("error", onError);
      this.client.connect(connectConfig);
    });
  }

  async openTerminal(
    options: { cols: number; rows: number },
    onData: (data: string) => void,
    onClose: (code?: number | null, signal?: string | null) => void
  ): Promise<void> {
    this.assertConnected();
    this.terminalOutput = onData;
    this.terminalClosed = onClose;

    if (this.terminal) {
      this.resizeTerminal(options.cols, options.rows);
      this.terminal.write("\r");
      return;
    }

    const cols = clampNumber(options.cols, 20, 300, 120);
    const rows = clampNumber(options.rows, 5, 120, 32);

    await new Promise<void>((resolve, reject) => {
      this.client.shell(
        {
          term: "xterm-256color",
          cols,
          rows
        },
        (error, stream) => {
          if (error) {
            reject(error);
            return;
          }

            this.terminal = stream;
            stream.on("data", (chunk: Buffer) => this.terminalOutput?.(chunk.toString("utf8")));
            stream.stderr.on("data", (chunk: Buffer) => this.terminalOutput?.(chunk.toString("utf8")));
            stream.on("close", (code?: number | null, signal?: string | null) => {
              if (this.terminal === stream) {
                this.terminal = undefined;
              }
              this.terminalClosed?.(code, signal);
            });
          this.touch();
          resolve();
        }
      );
    });
  }

  writeTerminal(data: string): void {
    this.assertConnected();
    this.touch();
    this.terminal?.write(data);
  }

  resizeTerminal(cols: number, rows: number): void {
    if (!this.terminal) {
      return;
    }
    this.touch();
    this.terminal.setWindow(
      clampNumber(rows, 5, 120, 32),
      clampNumber(cols, 20, 300, 120),
      0,
      0
    );
  }

  async execCommand(
    command: string,
    options: {
      cwd?: string;
      timeoutMs?: number;
      maxBytes?: number;
      onData?: (stream: "stdout" | "stderr", data: string) => void;
    } = {}
  ): Promise<AgentStepExecutionResult> {
    this.assertConnected();
    const startedAt = Date.now();
    const timeoutMs = clampNumber(options.timeoutMs ?? 120_000, 5_000, 10 * 60_000, 120_000);
    const maxBytes = clampNumber(options.maxBytes ?? 256 * 1024, 16 * 1024, 2 * 1024 * 1024, 256 * 1024);
    const executableCommand = options.cwd
      ? `cd ${quoteForShell(normalizeRemotePath(options.cwd))} && ${command}`
      : command;

    return new Promise<AgentStepExecutionResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let totalBytes = 0;
      let settled = false;
      let timedOut = false;
      let outputLimited = false;
      let streamRef: ClientChannel | undefined;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.touch();
        callback();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        streamRef?.close();
      }, timeoutMs);

      const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
        totalBytes += chunk.length;
        const text = chunk.toString("utf8");
        if (target === "stdout") {
          stdout += text;
        } else {
          stderr += text;
        }
        options.onData?.(target, text);
        if (totalBytes > maxBytes) {
          if (!outputLimited) {
            outputLimited = true;
            const limitMessage = `\n[LShell] 输出超过 ${Math.round(maxBytes / 1024)}KB，已停止该命令。\n`;
            stderr += limitMessage;
            options.onData?.("stderr", limitMessage);
          }
          streamRef?.close();
        }
      };

      this.client.exec(executableCommand, (error, stream) => {
        if (error) {
          finish(() => reject(error));
          return;
        }

        streamRef = stream;
        stream.on("data", (chunk: Buffer) => collect("stdout", chunk));
        stream.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
        stream.on("error", (streamError: Error) => finish(() => reject(streamError)));
        stream.on("close", (code?: number | null, signal?: string | null) => {
          finish(() => {
            const durationMs = Date.now() - startedAt;
            if (timedOut) {
              resolve({
                command,
                stdout,
                stderr: `${stderr}\n[LShell] 命令执行超过 ${Math.round(timeoutMs / 1000)} 秒，已停止。\n`,
                exitCode: 124,
                signal: signal ?? "TIMEOUT",
                durationMs
              });
              return;
            }

            resolve({
              command,
              stdout,
              stderr,
              exitCode: typeof code === "number" ? code : null,
              signal,
              durationMs
            });
          });
        });
      });
    });
  }

  async listDirectory(remotePath: string): Promise<FileInfo[]> {
    const sftp = await this.getSftp();
    const directory = normalizeRemotePath(remotePath);
    const entries = await new Promise<SftpEntry[]>((resolve, reject) => {
      sftp.readdir(directory, (error, list) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(list as SftpEntry[]);
      });
    });

    this.touch();
    return entries
      .filter((entry) => entry.filename !== "." && entry.filename !== "..")
      .map((entry) => ({
        name: entry.filename,
        path: joinRemotePath(directory, entry.filename),
        type: inferFileType(entry),
        size: entry.attrs.size,
        permissions: formatPermissions(entry.attrs.mode),
        modifyTime: entry.attrs.mtime * 1000
      }))
      .sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        return a.type === "directory" ? -1 : 1;
      });
  }

  async readFile(remotePath: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
    const buffer = await this.readFileBuffer(remotePath, maxBytes);
    return buffer.toString("utf8");
  }

  async readFileBuffer(remotePath: string, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
    const sftp = await this.getSftp();
    const filePath = normalizeRemotePath(remotePath);

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const stream = sftp.createReadStream(filePath);

      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy(new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("close", () => {
        this.touch();
        resolve(Buffer.concat(chunks));
      });
    });
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    await this.writeBuffer(remotePath, Buffer.from(content, "utf8"));
  }

  async writeBuffer(remotePath: string, content: Buffer): Promise<void> {
    const sftp = await this.getSftp();
    const filePath = normalizeRemotePath(remotePath);

    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(filePath, { flags: "w" });
      stream.on("error", reject);
      stream.on("close", () => {
        this.touch();
        resolve();
      });
      stream.end(content);
    });
  }

  async mkdir(remotePath: string): Promise<void> {
    const sftp = await this.getSftp();
    const directory = normalizeRemotePath(remotePath);
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(directory, (error) => (error ? reject(error) : resolve()));
    });
    this.touch();
  }

  async mkdirp(remotePath: string): Promise<void> {
    const sftp = await this.getSftp();
    const directory = normalizeRemotePath(remotePath);
    const parts = directory.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = `${current}/${part}`;
      const exists = await new Promise<boolean>((resolve, reject) => {
        sftp.stat(current, (error, stat) => {
          if (!error) {
            if (!stat.isDirectory()) {
              reject(new Error(`${current} 已存在但不是目录`));
              return;
            }
            resolve(true);
            return;
          }
          if ((error as NodeJS.ErrnoException).code === "ENOENT" || /No such file/i.test(error.message)) {
            resolve(false);
            return;
          }
          reject(error);
        });
      });

      if (!exists) {
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(current, (error) => (error ? reject(error) : resolve()));
        });
      }
    }
    this.touch();
  }

  async remove(remotePath: string): Promise<void> {
    const sftp = await this.getSftp();
    const target = normalizeRemotePath(remotePath);
    const attrs = await new Promise<SftpEntry["attrs"]>((resolve, reject) => {
      sftp.stat(target, (error, stat) => (error ? reject(error) : resolve(stat as SftpEntry["attrs"])));
    });

    await new Promise<void>((resolve, reject) => {
      const done = (error: Error | null | undefined) => (error ? reject(error) : resolve());
      if (attrs.isDirectory()) {
        sftp.rmdir(target, done);
      } else {
        sftp.unlink(target, done);
      }
    });
    this.touch();
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.rename(normalizeRemotePath(oldPath), normalizeRemotePath(newPath), (error) =>
        error ? reject(error) : resolve()
      );
    });
    this.touch();
  }

  async close(): Promise<void> {
    this.terminal?.end();
    this.terminal = undefined;
    this.sftp?.end();
    this.sftp = undefined;
    this.connected = false;
    this.client.end();
  }

  private async getSftp(): Promise<SFTPWrapper> {
    this.assertConnected();
    if (this.sftp) {
      return this.sftp;
    }

    this.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)));
    });
    return this.sftp;
  }

  private async buildConnectConfig(): Promise<ConnectConfig> {
    const config: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      readyTimeout: 15_000,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      tryKeyboard: true
    };

    if (this.config.authType === "password") {
      config.password = this.config.password;
    } else {
      config.privateKey = this.config.privateKey ?? (await fs.readFile(this.config.privateKeyPath!, "utf8"));
      config.passphrase = this.config.privateKeyPassphrase;
    }

    return config;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("SSH 会话尚未连接");
    }
  }

  private touch(): void {
    this.lastUsedAt = Date.now();
  }
}

function inferFileType(entry: SftpEntry): FileInfo["type"] {
  if (entry.attrs.isDirectory()) {
    return "directory";
  }
  if (entry.attrs.isSymbolicLink()) {
    return "symlink";
  }
  return "file";
}

function formatPermissions(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`.slice(-3);
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
