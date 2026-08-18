import type { AgentPlan, AgentUploadedFile, AiProviderConfig } from "../models/protocol.js";
import { normalizeAgentPlan, sanitizeCurrentPath, sanitizeIntent } from "./safety.js";

interface PlanningContext {
  currentPath: string;
  connectionName?: string;
  uploadedFiles?: AgentUploadedFile[];
}

interface PlanningCallbacks {
  onDelta?: (delta: string) => void;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
  }>;
}

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen-plus";

export async function createAgentPlan(
  intent: string,
  context: PlanningContext,
  aiConfig: AiProviderConfig,
  callbacks: PlanningCallbacks = {}
): Promise<AgentPlan> {
  const cleanIntent = sanitizeIntent(intent);
  const currentPath = sanitizeCurrentPath(context.currentPath);
  const apiKey = aiConfig.apiKey.trim();

  if (!apiKey) {
    throw new Error("请先在客户端 AI 设置中填写 API Key");
  }

  const content = await callQwen(apiKey, [
    {
      role: "system",
      content: buildSystemPrompt()
    },
    {
      role: "user",
      content: JSON.stringify({
        intent: cleanIntent,
        currentPath,
        connectionName: context.connectionName || "",
        uploadedFiles: (context.uploadedFiles ?? []).map((file) => ({
          name: file.name,
          path: file.path,
          directory: file.directory,
          size: file.size,
          uploadedAt: file.uploadedAt
        })),
        responseLanguage: "zh-CN"
      })
    }
  ], callbacks.onDelta, aiConfig);

  return normalizeNavigationPlan(normalizeAgentPlan(parseJsonObject(content), currentPath), cleanIntent);
}

async function callQwen(
  apiKey: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
  onDelta?: (delta: string) => void,
  aiConfig?: AiProviderConfig
): Promise<string> {
  const baseUrl = (aiConfig?.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  const model = (aiConfig?.model || DEFAULT_MODEL).trim();
  const timeoutMs = clampNumber(Number(process.env.QWEN_TIMEOUT_MS || 30_000), 5_000, 120_000, 30_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const stream = Boolean(onDelta) && process.env.QWEN_STREAM !== "false";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        stream,
        messages
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`千问调用失败：HTTP ${response.status} ${responseText.slice(0, 240)}`);
    }

    if (stream) {
      return await readStreamingContent(response, onDelta);
    }

    const responseText = await response.text();
    const payload = JSON.parse(responseText) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("千问返回为空");
    }
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("千问调用超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readStreamingContent(response: Response, onDelta?: (delta: string) => void): Promise<string> {
  if (!response.body) {
    throw new Error("千问流式响应为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  const parseLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
      return;
    }

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      return;
    }

    const payload = JSON.parse(data) as ChatCompletionStreamChunk;
    const delta = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? "";
    if (!delta) {
      return;
    }

    content += delta;
    onDelta?.(delta);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      parseLine(line);
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    parseLine(buffer);
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("千问返回为空");
  }
  return trimmed;
}

function buildSystemPrompt(): string {
  return [
    "你是 LShell 的远程 Linux 终端智能体，只负责把用户意图转成待确认的执行计划，绝不声称已经执行。",
    "你必须只返回 JSON 对象，不要 Markdown，不要解释性前后缀。",
    "JSON 结构：{ title, summary, assumptions, safetyNotes, steps }。",
    "steps 最多 8 个。每个 step 必须包含 title、description、command。",
    "命令必须是非交互式 shell 命令，避免需要手动输入密码、编辑器、交互确认或长时间前台进程。",
    "路径语义必须忠实于用户原文：用户说 home 或 home 目录时指 /home；只有明确说家目录、主目录或当前用户目录时才使用 ~。",
    "生成 cd 命令时优先使用明确的绝对路径或 ~，不要使用 $HOME，不要擅自把用户给出的目录名替换成环境变量。",
    "优先生成可审计、可回滚的计划：先检查路径/文件，再备份关键配置，再修改，再测试，最后 reload/restart。",
    "涉及 nginx 配置时，修改前备份，修改后必须包含 nginx -t，只有测试通过后才 reload。",
    "涉及 sudo 时尽量使用 sudo -n，让没有免密权限时快速失败。",
    "涉及解压时先确认压缩包存在，目标目录不存在时 mkdir -p；避免默认覆盖，确需覆盖时在 summary 和 safetyNotes 说明。",
    "如果 user JSON 中 uploadedFiles 非空，这些文件已经上传到远程服务器，必须优先使用 uploadedFiles[].path 作为源文件路径，不要再要求用户手动上传。",
    "如果 uploadedFiles 中包含 zip/tar/tgz/gz 等前端项目压缩包，部署计划应先创建临时解压目录，检查 package.json、dist、build 等目录；如果是源码包，先 npm/pnpm/yarn install/build；如果已有 dist/build，直接发布静态产物。",
    "前端静态部署建议使用 release 目录和 current 软链接或备份旧目录；涉及 nginx 时先备份配置、nginx -t 通过后再 reload。",
    "如果用户提到本地文件上传但 uploadedFiles 为空，你无法读取本地文件内容；请提示先在智能体上传区上传，或把命令写成针对远程路径执行。",
    "不要生成 rm -rf /、磁盘格式化、关机重启、fork bomb、覆盖系统认证文件等危险命令。"
  ].join("\n");
}

function normalizeNavigationPlan(plan: AgentPlan, intent: string): AgentPlan {
  const wantsHomeDirectory = /(?:cd|进入|切换|跳转|前往|到)\s*(?:到|至)?\s*home(?:\s*目录)?/iu.test(intent);
  const wantsUserHome = /(?:家目录|主目录|用户目录|当前用户目录)/u.test(intent);

  if (!wantsHomeDirectory && !wantsUserHome) {
    return plan;
  }

  const target = wantsUserHome ? "~" : "/home";
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (!/^\s*cd\s+(?:\$\{?HOME\}?|~|\/?home)\s*$/iu.test(step.command)) {
        return step;
      }
      return {
        ...step,
        command: `cd ${target}`,
        description: wantsUserHome ? "进入当前用户的家目录" : "进入系统的 /home 目录"
      };
    })
  };
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("千问返回的内容不是 JSON 对象");
  }
  return JSON.parse(withoutFence.slice(start, end + 1));
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}
