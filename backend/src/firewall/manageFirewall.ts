import { isIP } from "node:net";
import type { FirewallRule, FirewallRuleAction, FirewallRuleProtocol, FirewallState } from "../models/protocol.js";
import type { SSHSession } from "../ssh/SSHSession.js";

const MANAGED_COMMENT = "LShell";

export async function readFirewallState(session: SSHSession): Promise<FirewallState> {
  const provider = await detectProvider(session);
  if (provider === "ufw") {
    return readUfwState(session);
  }
  if (provider === "firewalld") {
    return readFirewalldState(session);
  }
  return { provider, rules: [], warning: "当前仅支持 UFW 和 firewalld 的规则管理。" };
}

export async function addFirewallRule(
  session: SSHSession,
  input: { action: FirewallRuleAction; source: string; port?: number; protocol?: FirewallRuleProtocol }
): Promise<FirewallState> {
  const source = validateSource(input.source);
  const port = validatePort(input.port);
  const protocol = validateProtocol(input.protocol, port);
  const provider = await detectProvider(session);

  if (provider === "ufw") {
    const destination = port ? ` to any port ${port}${protocol === "any" ? "" : ` proto ${protocol}`}` : "";
    await execute(session, `sudo -n ufw ${input.action} from ${source}${destination} comment '${MANAGED_COMMENT}'`);
  } else if (provider === "firewalld") {
    if (port && protocol === "any") {
      throw new Error("firewalld 的端口规则需要明确选择 TCP 或 UDP");
    }
    const family = source.includes(":") ? "ipv6" : "ipv4";
    const portPart = port ? ` port port=\"${port}\" protocol=\"${protocol}\"` : "";
    const richRule = `rule family=\"${family}\" source address=\"${source}\"${portPart} ${input.action === "allow" ? "accept" : "drop"}`;
    await execute(session, `sudo -n firewall-cmd --permanent --add-rich-rule='${richRule}' && sudo -n firewall-cmd --reload`);
  } else {
    throw new Error("当前服务器未检测到可管理的 UFW 或 firewalld");
  }

  return readFirewallState(session);
}

export async function removeFirewallRule(session: SSHSession, ruleId: string): Promise<FirewallState> {
  const state = await readFirewallState(session);
  const rule = state.rules.find((item) => item.id === ruleId && item.removable);
  if (!rule) {
    throw new Error("规则不存在或不允许通过控制台删除");
  }

  if (state.provider === "ufw") {
    const number = rule.id.slice("ufw:".length);
    if (!/^\d+$/.test(number)) {
      throw new Error("无效的 UFW 规则编号");
    }
    await execute(session, `yes | sudo -n ufw delete ${number}`);
  } else if (state.provider === "firewalld") {
    const encodedRule = rule.id.slice("firewalld:".length);
    const richRule = Buffer.from(encodedRule, "base64url").toString("utf8");
    if (!richRule.startsWith("rule ") || /['\r\n]/.test(richRule)) {
      throw new Error("无效的 firewalld 规则");
    }
    await execute(session, `sudo -n firewall-cmd --permanent --remove-rich-rule='${richRule}' && sudo -n firewall-cmd --reload`);
  }

  return readFirewallState(session);
}

async function detectProvider(session: SSHSession): Promise<string> {
  const result = await session.execCommand("if command -v ufw >/dev/null 2>&1; then echo ufw; elif command -v firewall-cmd >/dev/null 2>&1; then echo firewalld; elif command -v iptables >/dev/null 2>&1; then echo iptables; else echo none; fi");
  return result.stdout.trim().split(/\s+/)[0] || "none";
}

async function readUfwState(session: SSHSession): Promise<FirewallState> {
  const result = await session.execCommand("sudo -n ufw status numbered 2>/dev/null || ufw status numbered 2>/dev/null", { maxBytes: 512 * 1024 });
  if (result.exitCode !== 0) {
    return { provider: "ufw", rules: [], warning: "无法读取 UFW 规则，请确保当前 SSH 用户具有免交互 sudo 权限。" };
  }
  const lines = result.stdout.split(/\r?\n/);
  const enabled = !/^Status:\s+inactive/im.test(result.stdout);
  const rules = lines.map(parseUfwRule).filter((rule): rule is FirewallRule => Boolean(rule));
  return { provider: "ufw", enabled, rules };
}

function parseUfwRule(line: string): FirewallRule | undefined {
  const match = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT)(?:\s+IN)?\s{2,}(.+?)\s*$/i);
  if (!match) return undefined;
  const [, number, destination, actionText, sourceText] = match;
  const destinationMatch = destination.match(/^(\d+)(?:\/(tcp|udp))?/i);
  return {
    id: `ufw:${number}`,
    action: actionText.toUpperCase() === "ALLOW" ? "allow" : "deny",
    source: normalizeUfwSource(sourceText),
    port: destinationMatch ? Number(destinationMatch[1]) : undefined,
    protocol: (destinationMatch?.[2]?.toLowerCase() as FirewallRuleProtocol | undefined) ?? "any",
    description: line.includes(MANAGED_COMMENT) ? MANAGED_COMMENT : undefined,
    raw: line.trim(),
    removable: true
  };
}

async function readFirewalldState(session: SSHSession): Promise<FirewallState> {
  const result = await session.execCommand("firewall-cmd --state 2>/dev/null; firewall-cmd --list-rich-rules 2>/dev/null", { maxBytes: 512 * 1024 });
  if (result.exitCode !== 0) {
    return { provider: "firewalld", rules: [], warning: "无法读取 firewalld 规则。" };
  }
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("rule "));
  return { provider: "firewalld", enabled: /^running/m.test(result.stdout), rules: lines.map(parseFirewalldRule) };
}

function parseFirewalldRule(raw: string): FirewallRule {
  const source = raw.match(/source address="([^"]+)"/)?.[1] ?? "any";
  const port = Number(raw.match(/port port="(\d+)"/)?.[1]) || undefined;
  const protocol = (raw.match(/protocol="(tcp|udp)"/)?.[1] as FirewallRuleProtocol | undefined) ?? "any";
  return {
    id: `firewalld:${Buffer.from(raw).toString("base64url")}`,
    action: /\b(?:drop|reject)\b/.test(raw) ? "deny" : "allow",
    source,
    port,
    protocol,
    raw,
    removable: true
  };
}

function normalizeUfwSource(source: string): string {
  return source.replace(/\s+\(v6\)$/i, "").trim() || "any";
}

function validateSource(value: string): string {
  const source = value.trim();
  const [address, prefix] = source.split("/");
  const version = isIP(address);
  if (!version || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
    throw new Error("请输入有效的 IPv4、IPv6 或 CIDR，例如 203.0.113.10 或 10.0.0.0/24");
  }
  return source;
}

function validatePort(port?: number): number | undefined {
  if (port === undefined) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须在 1-65535 之间");
  return port;
}

function validateProtocol(protocol: FirewallRuleProtocol | undefined, port?: number): FirewallRuleProtocol {
  const value = protocol ?? (port ? "tcp" : "any");
  if (!(["tcp", "udp", "any"] as const).includes(value)) throw new Error("不支持的网络协议");
  return value;
}

async function execute(session: SSHSession, command: string): Promise<void> {
  const result = await session.execCommand(command, { timeoutMs: 30_000, maxBytes: 128 * 1024 });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "命令执行失败";
    if (/password is required|a password is required|sudo:/i.test(detail)) {
      throw new Error("防火墙变更需要免交互 sudo 权限，请为 ufw/firewall-cmd 配置受限 sudo 权限后重试");
    }
    throw new Error(detail);
  }
}
