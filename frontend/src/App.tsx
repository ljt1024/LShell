import {
  ApiOutlined,
  CodeOutlined,
  DesktopOutlined,
  DisconnectOutlined,
  FolderOutlined,
  GlobalOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Alert, Button, ConfigProvider, Layout, Menu, Modal, Space, Tag, Tooltip, Typography, theme } from "antd";
import type { CSSProperties, PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionPanel } from "./components/Connection/ConnectionPanel";
import { FileManager } from "./components/FileManager/FileManager";
import { DirectoryTreePanel } from "./components/FileTree/DirectoryTreePanel";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { ServerOverviewPanel } from "./components/Server/ServerOverviewPanel";
import { FirewallPanel } from "./components/Server/FirewallPanel";
import { NginxPanel } from "./components/Server/NginxPanel";
import { useWebShell } from "./hooks/useWebShell";
import "./styles.css";

export default function App() {
  const shell = useWebShell();
  const connected = shell.status === "connected";
  const workspaceRef = useRef<HTMLElement | null>(null);
  const isResizingRef = useRef(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [filePanePercent, setFilePanePercent] = useState(58);
  const [workspaceView, setWorkspaceView] = useState<"overview" | "files" | "firewall" | "nginx" | "connection">("connection");
  const [desktopInfo, setDesktopInfo] = useState<LShellDesktopRuntimeInfo>();

  useEffect(() => {
    if (connected) {
      setWorkspaceView("overview");
    }
  }, [connected]);

  useEffect(() => {
    let mounted = true;
    void window.lshellDesktop?.getRuntimeInfo().then((info) => {
      if (mounted) {
        setDesktopInfo(info);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const workspaceStyle = {
    "--file-pane-size": `${filePanePercent}fr`,
    "--terminal-pane-size": `${100 - filePanePercent}fr`
  } as CSSProperties;

  const updateSplitFromPointer = useCallback((clientY: number) => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    const rect = workspace.getBoundingClientRect();
    const style = window.getComputedStyle(workspace);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const usableHeight = rect.height - paddingTop - paddingBottom;
    const y = clientY - rect.top - paddingTop;
    const nextPercent = clamp((y / usableHeight) * 100, 32, 74);
    setFilePanePercent(nextPercent);
  }, []);

  const startPaneResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      isResizingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      updateSplitFromPointer(event.clientY);
      event.preventDefault();
    },
    [updateSplitFromPointer]
  );

  const movePaneResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isResizingRef.current) {
        return;
      }
      updateSplitFromPointer(event.clientY);
    },
    [updateSplitFromPointer]
  );

  const stopPaneResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    isResizingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const nudgePaneResize = useCallback((delta: number) => {
    setFilePanePercent((current) => clamp(current + delta, 32, 74));
  }, []);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#2f9c75",
          colorInfo: "#5794d1",
          colorWarning: "#f7c948",
          colorBgBase: "#111312",
          colorTextBase: "#e7ece5",
          borderRadius: 6,
          fontFamily: '"Aptos", "IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
        },
        components: {
          Layout: {
            bodyBg: "#111312",
            headerBg: "#161917",
            siderBg: "#151816"
          },
          Table: {
            headerBg: "#1d211e",
            rowHoverBg: "#202820"
          }
        }
      }}
    >
      <Layout className="app-shell">
        <Layout.Sider
          width={320}
          collapsed={siderCollapsed}
          collapsedWidth={0}
          trigger={null}
          className={`app-sider${siderCollapsed ? " app-sider-collapsed" : ""}`}
        >
          <div className="sidebar-shell">
            <div className="sidebar-brand">
              <div className="sidebar-brand-mark">
                <CodeOutlined />
              </div>
              <div>
                <Typography.Title level={4}>LShell</Typography.Title>
                <Typography.Text>Remote workspace</Typography.Text>
              </div>
            </div>
            <Menu
              className="workspace-nav"
              mode="inline"
              selectedKeys={[workspaceView]}
              onSelect={({ key }) => setWorkspaceView(key as typeof workspaceView)}
              items={[
                { key: "overview", icon: <DesktopOutlined />, label: "服务器概览", disabled: !connected },
                { key: "files", icon: <FolderOutlined />, label: "服务器目录", disabled: !connected },
                { key: "firewall", icon: <SafetyCertificateOutlined />, label: "防火墙", disabled: !connected },
                { key: "nginx", icon: <GlobalOutlined />, label: "Nginx 配置", disabled: !connected },
                { type: "divider" },
                { key: "connection", icon: <ApiOutlined />, label: "连接管理" }
              ]}
            />
            <div className="workspace-nav-spacer" />
            <div className="workspace-nav-footer">
              <span className={`workspace-nav-indicator${connected ? " is-connected" : ""}`} />
              <div><Typography.Text>{connected ? shell.connectionName : "未连接"}</Typography.Text><Typography.Text>{connected ? "SSH session active" : "Select a server"}</Typography.Text></div>
            </div>
          </div>
        </Layout.Sider>
        <Layout className="app-main">
          <Layout.Header className="app-header">
            <Space>
              <Tooltip title={siderCollapsed ? "显示连接面板" : "隐藏连接面板"}>
                <Button
                  className="sidebar-toggle"
                  type="text"
                  icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setSiderCollapsed((collapsed) => !collapsed)}
                  aria-label={siderCollapsed ? "显示连接面板" : "隐藏连接面板"}
                />
              </Tooltip>
              <Typography.Title level={4}>远程工作区</Typography.Title>
              {desktopInfo ? (
                <Tooltip
                  title={`${desktopInfo.backendManaged ? "桌面托管后端" : "复用已有后端"} ${desktopInfo.backendUrl}`}
                >
                  <Tag icon={<DesktopOutlined />} color="cyan">
                    Desktop
                  </Tag>
                </Tooltip>
              ) : null}
              <Tag color={connected ? "success" : shell.status === "connecting" ? "processing" : "default"}>
                {shell.connectionName || shell.status}
              </Tag>
              {shell.sessionId ? <Tag>{shell.sessionId.slice(0, 8)}</Tag> : null}
            </Space>
            <Typography.Text className="header-path">{shell.currentPath}</Typography.Text>
          </Layout.Header>
          {shell.error ? (
            <Alert
              className="error-strip"
              type="error"
              showIcon
              closable
              message={shell.error}
              onClose={shell.clearError}
            />
          ) : null}
          <Layout.Content
            ref={workspaceRef}
            className={`workspace${workspaceView === "files" ? " workspace-with-terminal" : " workspace-single-panel"}`}
            style={workspaceStyle}
          >
            <div className="primary-workspace-panel">
              {workspaceView === "overview" ? <ServerOverviewPanel connected={connected} overview={shell.serverOverview} loading={shell.serverOverviewLoading} onRefresh={shell.refreshServerOverview} /> : null}
              {workspaceView === "files" ? (
                <div className="file-workspace">
                  <DirectoryTreePanel connected={connected} currentPath={shell.currentPath} directoryCache={shell.directoryCache} loadingDirectories={shell.loadingDirectories} onNavigate={shell.listFiles} onLoadDirectory={shell.loadDirectory} />
                  <FileManager connected={connected} files={shell.files} currentPath={shell.currentPath} activeFilePath={shell.activeFilePath} fileContent={shell.fileContent} dirty={shell.dirty} onList={shell.listFiles} onRead={shell.readFile} onSave={shell.saveFile} onCloseEditor={shell.closeEditor} onContentChange={shell.updateFileContent} onMkdir={shell.mkdir} onRemove={shell.remove} onRename={shell.rename} onUpload={shell.uploadFile} onDownload={shell.downloadFile} />
                </div>
              ) : null}
              {workspaceView === "firewall" ? <FirewallPanel connected={connected} overview={shell.serverOverview} state={shell.firewallState} aliyunState={shell.aliyunSecurityGroups} loading={shell.firewallLoading || shell.serverOverviewLoading} aliyunLoading={shell.aliyunSecurityGroupsLoading} onRefresh={() => { shell.refreshServerOverview(); shell.refreshFirewall(); }} onRefreshAliyun={shell.refreshAliyunSecurityGroups} onAddRule={shell.addFirewallRule} onRemoveRule={shell.removeFirewallRule} /> : null}
              {workspaceView === "nginx" ? <NginxPanel connected={connected} overview={shell.serverOverview} loading={shell.serverOverviewLoading} onRefresh={shell.refreshServerOverview} /> : null}
              {workspaceView === "connection" ? <ConnectionPanel status={shell.status} onConnect={shell.connect} onDisconnect={shell.disconnect} /> : null}
            </div>
            {workspaceView === "files" ? (
              <>
                <div
                  className="workspace-resizer"
                  role="separator"
                  aria-label="调整文件区和终端区高度"
                  aria-orientation="horizontal"
                  aria-valuemin={32}
                  aria-valuemax={74}
                  aria-valuenow={Math.round(filePanePercent)}
                  tabIndex={0}
                  onPointerDown={startPaneResize}
                  onPointerMove={movePaneResize}
                  onPointerUp={stopPaneResize}
                  onPointerCancel={stopPaneResize}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      nudgePaneResize(-4);
                      event.preventDefault();
                    }
                    if (event.key === "ArrowDown") {
                      nudgePaneResize(4);
                      event.preventDefault();
                    }
                  }}
                >
                  <span className="resizer-grip" />
                </div>
                <TerminalPanel
                  status={shell.status}
                  sessionId={shell.sessionId}
                  agentPlan={shell.agentPlan}
                  agentGenerating={shell.agentGenerating}
                  agentMessage={shell.agentMessage}
                  registerWriter={shell.registerTerminalWriter}
                  onOpen={shell.openTerminal}
                  onInput={shell.sendTerminalInput}
                  onResize={shell.resizeTerminal}
                  onAgentPlan={shell.planAgentTask}
                  onAgentReset={shell.resetAgent}
                />
              </>
            ) : null}
          </Layout.Content>
        </Layout>
      </Layout>
      <Modal
        open={shell.connectionInterrupted}
        title={
          <Space>
            <DisconnectOutlined />
            <span>连接已中断</span>
          </Space>
        }
        okText="立即重连"
        cancelText="连接设置"
        okButtonProps={{ icon: <ReloadOutlined /> }}
        closable={false}
        maskClosable={false}
        onOk={shell.reconnectNow}
        onCancel={() => {
          shell.dismissReconnect();
          setWorkspaceView("connection");
          setSiderCollapsed(false);
        }}
      >
        <Typography.Paragraph>{shell.reconnectMessage || "与服务器的连接已断开。"}</Typography.Paragraph>
        <Typography.Text type="secondary">
          系统会自动尝试恢复连接，也可以立即重试或重新填写连接信息。
        </Typography.Text>
      </Modal>
    </ConfigProvider>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
