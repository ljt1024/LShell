import { randomUUID } from "node:crypto";
import type { AgentPlan, AgentPlanStep, AgentRiskLevel } from "../models/protocol.js";
import { normalizeRemotePath } from "../sftp/remotePath.js";

const MAX_STEPS = 8;
const MAX_COMMAND_LENGTH = 2_000;

const blockedPatterns: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\brm\s+(?:-[^\s]*r[^\s]*f|-f[^\s]*r)[^\n;&|]*\s(?:\/|\/\*|~|\$HOME)(?:\s|$)/i,
    message: "阻止递归强制删除根目录、家目录或通配根路径"
  },
  {
    pattern: /\b(?:mkfs|mkswap|fdisk|parted|sfdisk|wipefs)\b/i,
    message: "阻止磁盘格式化、分区或擦除类命令"
  },
  {
    pattern: /\bdd\s+[^;&|]*\bof=\/dev\//i,
    message: "阻止直接写入块设备"
  },
  {
    pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
    message: "阻止 fork bomb"
  },
  {
    pattern: /\b(?:shutdown|poweroff|halt|reboot)\b/i,
    message: "阻止关机或重启服务器"
  },
  {
    pattern: />\s*\/etc\/(?:passwd|shadow|sudoers)(?:\s|$)/i,
    message: "阻止直接覆盖系统认证或 sudo 配置文件"
  }
];

const highRiskPatterns: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\bsudo\b/i,
    message: "包含 sudo，可能需要提升权限"
  },
  {
    pattern: /\b(?:systemctl|service)\s+(?:restart|reload|stop|start)\b/i,
    message: "会变更系统服务状态"
  },
  {
    pattern: /\bnginx\s+-s\s+reload\b/i,
    message: "会重新加载 nginx"
  },
  {
    pattern: /\/etc\/(?:nginx|systemd|ssh|ssh\/sshd_config)\b/i,
    message: "会修改或读取关键系统配置目录"
  },
  {
    pattern: /\b(?:apt|apt-get|yum|dnf|apk|pacman)\s+(?:install|remove|upgrade|update)\b/i,
    message: "会改动系统软件包或软件源状态"
  }
];

const mediumRiskPatterns: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\brm\s+/i,
    message: "包含删除操作"
  },
  {
    pattern: /\b(?:mv|cp|chmod|chown)\s+/i,
    message: "包含文件移动、复制或权限变更"
  },
  {
    pattern: /\b(?:sed|perl)\s+[^;&|]*-i\b/i,
    message: "包含原地修改文件"
  },
  {
    pattern: /\b(?:unzip|tar)\s+/i,
    message: "包含解压操作，可能覆盖目标目录内容"
  },
  {
    pattern: />{1,2}\s*\//,
    message: "包含重定向写入文件"
  }
];

export function sanitizeIntent(intent: string): string {
  const trimmed = intent.replace(/\0/g, "").trim();
  if (!trimmed) {
    throw new Error("请输入要交给智能体处理的意图");
  }
  if (trimmed.length > 4_000) {
    throw new Error("意图过长，请拆成更小的任务");
  }
  return trimmed;
}

export function sanitizeCurrentPath(currentPath: string): string {
  return normalizeRemotePath(currentPath || "/");
}

export function normalizeAgentPlan(input: unknown, currentPath: string): AgentPlan {
  const raw = coerceRecord(input, "智能体返回的计划格式无效");
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];

  if (rawSteps.length === 0) {
    throw new Error("智能体没有生成可执行步骤");
  }
  if (rawSteps.length > MAX_STEPS) {
    throw new Error(`智能体最多一次执行 ${MAX_STEPS} 个步骤，请缩小任务范围`);
  }

  const normalizedPath = sanitizeCurrentPath(getString(raw.currentPath) || currentPath);
  const steps = rawSteps.map((step, index) => normalizeStep(step, index));
  const safetyNotes = uniqueStrings([
    ...toStringArray(raw.safetyNotes),
    "执行前请逐条核对命令；后端会再次阻断已知危险命令。",
    "涉及 sudo、系统服务、nginx 配置或删除操作时，建议先确认备份和回滚路径。"
  ]);

  return {
    id: getString(raw.id) || randomUUID(),
    title: limitText(getString(raw.title) || "终端智能体计划", 80),
    summary: limitText(getString(raw.summary) || "根据你的意图生成了一个待确认的执行计划。", 300),
    assumptions: toStringArray(raw.assumptions).slice(0, 6),
    safetyNotes,
    currentPath: normalizedPath,
    createdAt: getString(raw.createdAt) || new Date().toISOString(),
    steps
  };
}

export function assertExecutablePlan(plan: AgentPlan): AgentPlan {
  const normalized = normalizeAgentPlan(plan, plan.currentPath);
  const blocked = normalized.steps.flatMap((step) => step.warnings.filter((warning) => warning.startsWith("阻止")));
  if (blocked.length > 0) {
    throw new Error(`计划包含被阻断的命令：${blocked.join("；")}`);
  }
  return normalized;
}

function normalizeStep(input: unknown, index: number): AgentPlanStep {
  const raw = coerceRecord(input, `第 ${index + 1} 步格式无效`);
  const command = sanitizeCommand(getString(raw.command));
  const analysis = analyzeCommand(command);

  return {
    id: getString(raw.id) || `step-${index + 1}`,
    title: limitText(getString(raw.title) || `步骤 ${index + 1}`, 80),
    description: limitText(getString(raw.description) || "", 300),
    command,
    riskLevel: analysis.riskLevel,
    warnings: uniqueStrings([...toStringArray(raw.warnings), ...analysis.warnings]).slice(0, 8),
    requiresSudo: analysis.requiresSudo,
    destructive: analysis.destructive
  };
}

function sanitizeCommand(command: string): string {
  const normalized = command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\0/g, "").trim();
  if (!normalized) {
    throw new Error("命令不能为空");
  }
  if (normalized.length > MAX_COMMAND_LENGTH) {
    throw new Error(`单条命令不能超过 ${MAX_COMMAND_LENGTH} 个字符`);
  }
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new Error("命令包含不可见控制字符");
  }
  return normalized;
}

function analyzeCommand(command: string): {
  riskLevel: AgentRiskLevel;
  warnings: string[];
  requiresSudo: boolean;
  destructive: boolean;
} {
  const warnings: string[] = [];
  let riskLevel: AgentRiskLevel = "low";

  for (const check of blockedPatterns) {
    if (check.pattern.test(command)) {
      warnings.push(check.message);
      riskLevel = "blocked";
    }
  }

  const requiresSudo = /\bsudo\b/i.test(command);
  let highRisk = false;
  for (const check of highRiskPatterns) {
    if (check.pattern.test(command)) {
      warnings.push(check.message);
      highRisk = true;
    }
  }

  let mediumRisk = false;
  for (const check of mediumRiskPatterns) {
    if (check.pattern.test(command)) {
      warnings.push(check.message);
      mediumRisk = true;
    }
  }

  const destructive = /\b(?:rm|mv|chmod|chown|truncate|dd)\b|>{1,2}\s*\//i.test(command);
  if (riskLevel !== "blocked") {
    riskLevel = highRisk ? "high" : mediumRisk || destructive ? "medium" : "low";
  }

  return {
    riskLevel,
    warnings: uniqueStrings(warnings),
    requiresSudo,
    destructive
  };
}

function coerceRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value as Record<string, unknown>;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => limitText(item.trim(), 240))
    .filter(Boolean);
}

function limitText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
