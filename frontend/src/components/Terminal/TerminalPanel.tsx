import { ClearOutlined, CodeOutlined, FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "../../types/protocol";

interface TerminalPanelProps {
  status: ConnectionStatus;
  sessionId?: string;
  registerWriter: (writer: (data: string) => void) => () => void;
  onOpen: (cols: number, rows: number) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

export function TerminalPanel({ status, sessionId, registerWriter, onOpen, onInput, onResize }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const statusRef = useRef(status);
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
      if (statusRef.current === "connected") {
        inputRef.current(data);
      }
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

    terminal.reset();
    fitAddon.fit();
    terminal.writeln("\x1b[38;2;247;201;72mopening remote shell...\x1b[0m");
    onOpen(terminal.cols, terminal.rows);
  }, [onOpen, sessionId, status]);

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
