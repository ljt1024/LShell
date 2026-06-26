import type { AuthType, ServerConfig } from "../models/protocol.js";

export function normalizeServerConfig(input: unknown): ServerConfig {
  if (!input || typeof input !== "object") {
    throw new Error("连接配置不能为空");
  }

  const value = input as Record<string, unknown>;
  const authType: AuthType = value.authType === "privateKey" ? "privateKey" : "password";
  const port = Number(value.port ?? 22);

  const config: ServerConfig = {
    id: typeof value.id === "string" ? value.id : undefined,
    name: readRequiredString(value.name, "连接名称"),
    host: readRequiredString(value.host, "主机地址"),
    port,
    username: readRequiredString(value.username, "用户名"),
    authType,
    password: readOptionalString(value.password),
    privateKey: readOptionalString(value.privateKey),
    privateKeyPath: readOptionalString(value.privateKeyPath),
    privateKeyPassphrase: readOptionalString(value.privateKeyPassphrase),
    group: readOptionalString(value.group)
  };

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("端口必须是 1-65535 之间的整数");
  }

  if (authType === "password" && !config.password) {
    throw new Error("密码认证需要填写密码");
  }

  if (authType === "privateKey" && !config.privateKey && !config.privateKeyPath) {
    throw new Error("密钥认证需要填写私钥内容或后端可读取的私钥路径");
  }

  return config;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
