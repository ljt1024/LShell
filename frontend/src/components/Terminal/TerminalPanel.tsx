import { ClearOutlined, CodeOutlined, FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { AgentPlan, ConnectionStatus } from "../../types/protocol";

interface TerminalPanelProps {
  status: ConnectionStatus;
  sessionId?: string;
  agentPlan?: AgentPlan;
  agentGenerating: boolean;
  agentMessage?: string;
  registerWriter: (writer: (data: string) => void) => () => void;
  onOpen: (cols: number, rows: number) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onAgentPlan: (intent: string) => void;
  onAgentReset: () => void;
}

export function TerminalPanel({
  status,
  sessionId,
  agentPlan,
  agentGenerating,
  agentMessage,
  registerWriter,
  onOpen,
  onInput,
  onResize,
  onAgentPlan,
  onAgentReset
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const statusRef = useRef(status);
  const pendingShellInputRef = useRef("");
  const openedSessionRef = useRef<string>();
  const agentPhaseRef = useRef<"shell" | "planning">("shell");
  const onAgentPlanRef = useRef(onAgentPlan);
  const onAgentResetRef = useRef(onAgentReset);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    inputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    resizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    onAgentPlanRef.current = onAgentPlan;
    onAgentResetRef.current = onAgentReset;
  }, [onAgentPlan, onAgentReset]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: {
        background: "#0b0d0e",
        foreground: "#e7ece5",
        cursor: "#f7c948",
        selectionBackground: "#315a4f",
        black: "#0b0d0e",
        red: "#e56b6f",
        green: "#65c18c",
        yellow: "#f7c948",
        blue: "#5794d1",
        magenta: "#c678dd",
        cyan: "#5ec9c3",
        white: "#e7ece5"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.writeln("\x1b[38;2;101;193;140mLShell terminal\x1b[0m");

    const dataSubscription = terminal.onData((data) => {
      if (statusRef.current !== "connected") {
        return;
      }
      const pendingInput = pendingShellInputRef.current;
      pendingShellInputRef.current = updatePendingShellInput(pendingInput, data);
      if ((data === "\r" || data === "\n") && shouldOpenAgentMode(pendingInput)) {
        inputRef.current("\x15");
        inputRef.current("\r");
        agentPhaseRef.current = "planning";
        onAgentResetRef.current();
        terminal.write("\r\n\x1b[38;2;94;201;195m[智能体] 正在根据输入推荐 Shell 命令...\x1b[0m\r\n");
        onAgentPlanRef.current(pendingInput.trim());
        return;
      }
      inputRef.current(data);
    });
    const cleanupWriter = registerWriter((data) => terminal.write(data));

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (statusRef.current === "connected") {
        resizeRef.current(terminal.cols, terminal.rows);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      dataSubscription.dispose();
      cleanupWriter();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [registerWriter]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !sessionId || status !== "connected") {
      return;
    }

    if (openedSessionRef.current === sessionId) {
      return;
    }

    terminal.reset();
    pendingShellInputRef.current = "";
    agentPhaseRef.current = "shell";
    fitAddon.fit();
    terminal.writeln("\x1b[38;2;247;201;72mopening remote shell...\x1b[0m");
    openedSessionRef.current = sessionId;
    onOpen(terminal.cols, terminal.rows);
  }, [onOpen, sessionId, status]);

  useEffect(() => {
    if (status !== "connected") {
      openedSessionRef.current = undefined;
    }
  }, [status]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !agentPlan || agentPhaseRef.current !== "planning") {
      return;
    }

    const autoExecute = agentPlan.steps.length > 0 && agentPlan.steps.every((step) => step.riskLevel === "low");
    terminal.write(formatAgentPlan(agentPlan, autoExecute));
    if (autoExecute) {
      agentPhaseRef.current = "shell";
      pendingShellInputRef.current = "";
      inputRef.current(`${joinAgentCommands(agentPlan)}\r`);
      return;
    }
    agentPhaseRef.current = "shell";
  }, [agentPlan]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || agentPhaseRef.current !== "planning" || agentGenerating || !agentMessage || agentPlan) {
      return;
    }

    terminal.write(`\r\n\x1b[38;2;229;107;111m[智能体] ${agentMessage}\x1b[0m\r\n`);
    agentPhaseRef.current = "shell";
    inputRef.current("\r");
  }, [agentGenerating, agentMessage, agentPlan]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    };

    if (fullscreen) {
      window.addEventListener("keydown", handleKeyDown);
    }

    const resizeTimer = window.setTimeout(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal || !fitAddon) {
        return;
      }
      fitAddon.fit();
      if (statusRef.current === "connected") {
        resizeRef.current(terminal.cols, terminal.rows);
      }
      terminal.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(resizeTimer);
    };
  }, [fullscreen]);

  return (
    <section className={`terminal-panel${fullscreen ? " terminal-panel-fullscreen" : ""}`}>
      <div className="section-bar">
        <Space>
          <CodeOutlined />
          <Typography.Text>终端</Typography.Text>
          <Tag color={status === "connected" ? "success" : "default"}>{status === "connected" ? "live" : "offline"}</Tag>
        </Space>
        <Space size={6}>
          <Button size="small" icon={<ClearOutlined />} onClick={() => terminalRef.current?.clear()}>
            清屏
          </Button>
          <Tooltip title={fullscreen ? "退出全屏" : "全屏"}>
            <Button
              size="small"
              icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => setFullscreen((current) => !current)}
              aria-label={fullscreen ? "退出终端全屏" : "终端全屏"}
            />
          </Tooltip>
        </Space>
      </div>
      <div ref={containerRef} className="terminal-host" />
    </section>
  );
}

function formatAgentPlan(plan: AgentPlan, autoExecute: boolean): string {
  const steps = plan.steps
    .map((step, index) => {
      const risk = step.riskLevel === "low" ? "低" : step.riskLevel === "medium" ? "中" : step.riskLevel === "high" ? "高" : "阻断";
      return `  ${index + 1}. ${step.title} [风险: ${risk}]\r\n     $ ${step.command}`;
    })
    .join("\r\n");
  const blocked = plan.steps.some((step) => step.riskLevel === "blocked");
  const note = blocked
    ? "计划包含被阻断命令，请勿执行。"
    : autoExecute
      ? "全部为低风险命令，正在自动执行..."
      : "包含非低风险操作，仅提供推荐，请确认后手动执行。";
  return `\r\n\x1b[1;38;2;94;201;195m[智能体推荐] ${plan.title}\x1b[0m\r\n${plan.summary}\r\n${steps}\r\n\x1b[38;2;247;201;72m${note}\x1b[0m\r\n`;
}

function joinAgentCommands(plan: AgentPlan): string {
  return plan.steps.map((step) => step.command.trim()).filter(Boolean).join(" && ");
}

const CHINESE_TEXT_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

export function shouldOpenAgentMode(input: string): boolean {
  return CHINESE_TEXT_PATTERN.test(input);
}

function updatePendingShellInput(current: string, data: string): string {
  if (data.includes("\r") || data.includes("\n") || data.includes("\x03") || data.includes("\x15")) {
    return "";
  }
  if (data === "\x7f") {
    return Array.from(current).slice(0, -1).join("");
  }
  if (!data.startsWith("\x1b") && !/[\x00-\x1f\x7f]/u.test(data)) {
    return `${current}${data}`;
  }
  return current;
}
