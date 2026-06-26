import { Alert, ConfigProvider, Layout, Space, Tag, Typography, theme } from "antd";
import { ConnectionPanel } from "./components/Connection/ConnectionPanel";
import { FileManager } from "./components/FileManager/FileManager";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { useWebShell } from "./hooks/useWebShell";
import "./styles.css";

export default function App() {
  const shell = useWebShell();
  const connected = shell.status === "connected";

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
        <Layout.Sider width={360} className="app-sider">
          <ConnectionPanel status={shell.status} onConnect={shell.connect} onDisconnect={shell.disconnect} />
        </Layout.Sider>
        <Layout className="app-main">
          <Layout.Header className="app-header">
            <Space>
              <Typography.Title level={4}>LShell Web Console</Typography.Title>
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
          <Layout.Content className="workspace">
            <FileManager
              connected={connected}
              files={shell.files}
              currentPath={shell.currentPath}
              activeFilePath={shell.activeFilePath}
              fileContent={shell.fileContent}
              dirty={shell.dirty}
              onList={shell.listFiles}
              onRead={shell.readFile}
              onSave={shell.saveFile}
              onCloseEditor={shell.closeEditor}
              onContentChange={shell.updateFileContent}
              onMkdir={shell.mkdir}
              onRemove={shell.remove}
              onRename={shell.rename}
              onUpload={shell.uploadFile}
              onDownload={shell.downloadFile}
            />
            <TerminalPanel
              status={shell.status}
              sessionId={shell.sessionId}
              registerWriter={shell.registerTerminalWriter}
              onOpen={shell.openTerminal}
              onInput={shell.sendTerminalInput}
              onResize={shell.resizeTerminal}
            />
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
