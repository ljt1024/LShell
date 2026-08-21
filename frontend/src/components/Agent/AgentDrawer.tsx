import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  PaperClipOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Alert, Button, Collapse, Drawer, Empty, Input, Popconfirm, Space, Tag, Typography, Upload, message as antMessage } from "antd";
import { useEffect, useMemo, useState } from "react";
import type {
  AgentHistoryStatus,
  AgentPlan,
  AgentPlanHistoryItem,
  AgentPlanStep,
  AgentRiskLevel,
  AgentStepState,
  AgentUploadedFile
} from "../../types/protocol";

interface AgentDrawerProps {
  open: boolean;
  connected: boolean;
  currentPath: string;
  plan?: AgentPlan;
  stepStates: Record<string, AgentStepState>;
  generating: boolean;
  executing: boolean;
  message?: string;
  planStream: string;
  history: AgentPlanHistoryItem[];
  uploadedFiles: AgentUploadedFile[];
  uploading: boolean;
  uploadMessage?: string;
  onClose: () => void;
  onPlan: (intent: string) => void;
  onExecute: (plan: AgentPlan) => void;
  onReset: () => void;
  onUploadFile: (file: File, directory: string) => Promise<void>;
  onRemoveUploadedFile: (fileId: string) => void;
  onClearUploadedFiles: () => void;
  onLoadHistory: (item: AgentPlanHistoryItem) => void;
  onClearHistory: () => void;
}

export function AgentDrawer({
  open,
  connected,
  currentPath,
  plan,
  stepStates,
  generating,
  executing,
  message,
  planStream,
  history,
  uploadedFiles,
  uploading,
  uploadMessage,
  onClose,
  onPlan,
  onExecute,
  onReset,
  onUploadFile,
  onRemoveUploadedFile,
  onClearUploadedFiles,
  onLoadHistory,
  onClearHistory
}: AgentDrawerProps) {
  const [intent, setIntent] = useState("");
  const [uploadDirectory, setUploadDirectory] = useState(currentPath);
  const trimmedIntent = intent.trim();
  const hasBlockedStep = Boolean(plan?.steps.some((step) => step.riskLevel === "blocked"));
  const highRisk = Boolean(plan?.steps.some((step) => step.riskLevel === "high"));
  const executeDisabled = !plan || hasBlockedStep || generating || executing;

  useEffect(() => {
    setUploadDirectory((current) => current || currentPath);
  }, [currentPath]);

  const collapseItems = useMemo(
    () =>
      plan?.steps.map((step, index) => ({
        key: step.id,
        label: (
          <div className="agent-step-label">
            <Space size={8}>
              {renderStepStatus(stepStates[step.id])}
              <span>{index + 1}. {step.title}</span>
            </Space>
            <Space size={4}>
              <Tag color={riskColor(step.riskLevel)}>{riskText(step.riskLevel)}</Tag>
              {step.requiresSudo ? <Tag color="gold">sudo</Tag> : null}
              {step.destructive ? <Tag color="volcano">变更</Tag> : null}
            </Space>
          </div>
        ),
        children: <AgentStepDetail step={step} state={stepStates[step.id]} />
      })) ?? [],
    [plan, stepStates]
  );

  const handlePlan = () => {
    if (!trimmedIntent) {
      return;
    }
    onPlan(trimmedIntent);
  };

  const handleUpload = (file: File) => {
    void onUploadFile(file, uploadDirectory)
      .then(() => antMessage.success(`${file.name} 已上传`))
      .catch((error) => antMessage.error(error instanceof Error ? error.message : "上传失败"));
    return Upload.LIST_IGNORE;
  };

  const executeButton = (
    <Button
      type="primary"
      icon={<PlayCircleOutlined />}
      disabled={executeDisabled}
      loading={executing}
    >
      执行计划
    </Button>
  );

  return (
    <Drawer
      className="agent-drawer"
      title={
        <Space>
          <RobotOutlined />
          <span>终端智能体</span>
          <Tag color={connected ? "success" : "default"}>{connected ? "connected" : "offline"}</Tag>
        </Space>
      }
      width="min(760px, 100vw)"
      open={open}
      onClose={onClose}
      destroyOnClose={false}
      extra={
        <Button disabled={generating || executing} onClick={onReset}>
          清空
        </Button>
      }
    >
      <div className="agent-composer">
        <div className="agent-context-row">
          <Space size={8}>
            <SafetyCertificateOutlined />
            <Typography.Text>计划确认后执行</Typography.Text>
          </Space>
          <Typography.Text className="agent-path">{currentPath}</Typography.Text>
        </div>
        <Input.TextArea
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder="例如：把 /tmp/app.zip 解压到 /var/www/app，备份 nginx 配置，测试通过后 reload"
          autoSize={{ minRows: 4, maxRows: 8 }}
          disabled={!connected || generating || executing}
        />
        <div className="agent-upload-panel">
          <div className="agent-upload-row">
            <Input
              value={uploadDirectory}
              onChange={(event) => setUploadDirectory(event.target.value)}
              disabled={!connected || generating || executing || uploading}
              prefix={<PaperClipOutlined />}
              placeholder="/tmp 或 /var/www/releases"
            />
            <Upload showUploadList={false} beforeUpload={handleUpload} disabled={!connected || uploading}>
              <Button disabled={!connected || uploading} loading={uploading} icon={<UploadOutlined />}>
                上传文件
              </Button>
            </Upload>
          </div>
          {uploadMessage ? <Typography.Text className="agent-upload-message">{uploadMessage}</Typography.Text> : null}
          {uploadedFiles.length > 0 ? (
            <div className="agent-uploaded-files">
              <div className="agent-uploaded-header">
                <Space size={8}>
                  <PaperClipOutlined />
                  <Typography.Text strong>远程文件上下文</Typography.Text>
                  <Tag>{uploadedFiles.length}</Tag>
                </Space>
                <Button size="small" type="text" danger onClick={onClearUploadedFiles}>
                  清空
                </Button>
              </div>
              {uploadedFiles.map((file) => (
                <div key={file.id} className="agent-uploaded-file">
                  <div className="agent-uploaded-copy">
                    <Typography.Text>{file.name}</Typography.Text>
                    <Typography.Text className="agent-uploaded-path">{file.path}</Typography.Text>
                  </div>
                  <Space size={6}>
                    <Tag>{formatBytes(file.size)}</Tag>
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onRemoveUploadedFile(file.id)}
                      aria-label={`移除 ${file.name}`}
                    />
                  </Space>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="agent-action-row">
          <Button
            type="primary"
            icon={<RobotOutlined />}
            disabled={!connected || !trimmedIntent || generating || executing}
            loading={generating}
            onClick={handlePlan}
          >
            生成计划
          </Button>
          <Popconfirm
            title={highRisk ? "确认执行高风险计划？" : "确认执行计划？"}
            description={highRisk ? "请确认命令、备份和回滚路径无误。" : "将按当前命令列表逐步执行。"}
            okText="确认执行"
            cancelText="取消"
            onConfirm={() => plan && onExecute(plan)}
            disabled={executeDisabled}
          >
            {executeButton}
          </Popconfirm>
        </div>
      </div>

      {message ? <Alert className="agent-message" type={executing ? "info" : "success"} showIcon message={message} /> : null}
      {generating && planStream ? (
        <div className="agent-stream-panel">
          <Space size={8}>
            <RobotOutlined />
            <Typography.Text strong>计划草稿流</Typography.Text>
          </Space>
          <pre className="agent-stream">{planStream}</pre>
        </div>
      ) : null}
      {hasBlockedStep ? (
        <Alert
          className="agent-message"
          type="error"
          showIcon
          message="计划包含被阻断的命令，不能执行"
        />
      ) : null}

      {history.length > 0 ? (
        <div className="agent-history">
          <div className="agent-history-header">
            <Space size={8}>
              <HistoryOutlined />
              <Typography.Text strong>历史计划</Typography.Text>
              <Tag>{history.length}</Tag>
            </Space>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onClearHistory}>
              清空
            </Button>
          </div>
          <div className="agent-history-list">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                className="agent-history-item"
                onClick={() => onLoadHistory(item)}
              >
                <span className="agent-history-title">{item.plan.title}</span>
                <span className="agent-history-meta">
                  <Tag color={historyStatusColor(item.executionStatus)}>{historyStatusText(item.executionStatus)}</Tag>
                  {new Date(item.updatedAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {plan ? (
        <div className="agent-plan">
          <div className="agent-plan-heading">
            <div>
              <Typography.Title level={4}>{plan.title}</Typography.Title>
              <Typography.Paragraph>{plan.summary}</Typography.Paragraph>
            </div>
            <Tag>{new Date(plan.createdAt).toLocaleTimeString()}</Tag>
          </div>

          {plan.assumptions.length > 0 ? (
            <div className="agent-note-list">
              <Typography.Text strong>假设</Typography.Text>
              {plan.assumptions.map((item) => (
                <Typography.Text key={item}>{item}</Typography.Text>
              ))}
            </div>
          ) : null}

          {plan.safetyNotes.length > 0 ? (
            <div className="agent-note-list">
              <Typography.Text strong>安全提示</Typography.Text>
              {plan.safetyNotes.map((item) => (
                <Typography.Text key={item}>{item}</Typography.Text>
              ))}
            </div>
          ) : null}

          <Collapse className="agent-steps" defaultActiveKey={plan.steps.map((step) => step.id)} items={collapseItems} />
        </div>
      ) : (
        <Empty className="agent-empty" description={connected ? "还没有计划" : "请先连接服务器"} />
      )}
    </Drawer>
  );
}

function AgentStepDetail({ step, state }: { step: AgentPlanStep; state?: AgentStepState }) {
  const output = formatOutput(state);
  const hasOutput = Boolean(output || state?.result);

  return (
    <div className="agent-step-detail">
      {step.description ? <Typography.Paragraph>{step.description}</Typography.Paragraph> : null}
      <pre className="agent-command">{step.command}</pre>
      {step.warnings.length > 0 ? (
        <div className="agent-warning-list">
          {step.warnings.map((warning) => (
            <Tag key={warning} icon={<ExclamationCircleOutlined />} color={step.riskLevel === "blocked" ? "red" : "gold"}>
              {warning}
            </Tag>
          ))}
        </div>
      ) : null}
      {hasOutput ? (
        <div className="agent-result">
          <Space size={8}>
            {state?.result ? (
              <>
                <Tag color={state.result.exitCode === 0 ? "green" : "red"}>exit {state.result.exitCode ?? "?"}</Tag>
                <Typography.Text>{(state.result.durationMs / 1000).toFixed(1)}s</Typography.Text>
              </>
            ) : (
              <Tag color="processing">streaming</Tag>
            )}
          </Space>
          <pre className="agent-output">{output || "(no output)"}</pre>
        </div>
      ) : null}
    </div>
  );
}

function renderStepStatus(state?: AgentStepState) {
  if (!state || state.status === "pending") {
    return <span className="agent-status-dot" />;
  }
  if (state.status === "running") {
    return <span className="agent-status-dot agent-status-running" />;
  }
  if (state.status === "success") {
    return <CheckCircleOutlined className="agent-status-success" />;
  }
  return <CloseCircleOutlined className="agent-status-failed" />;
}

function riskColor(risk: AgentRiskLevel): string {
  switch (risk) {
    case "blocked":
      return "red";
    case "high":
      return "volcano";
    case "medium":
      return "gold";
    default:
      return "green";
  }
}

function riskText(risk: AgentRiskLevel): string {
  switch (risk) {
    case "blocked":
      return "阻断";
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    default:
      return "低风险";
  }
}

function formatOutput(state?: AgentStepState): string {
  if (!state) {
    return "";
  }
  const stdout = state.result?.stdout ?? state.stdout ?? "";
  const stderr = state.result?.stderr ?? state.stderr ?? "";
  return [
    stdout ? `stdout\n${stdout.trimEnd()}` : "",
    stderr ? `stderr\n${stderr.trimEnd()}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function historyStatusColor(status: AgentHistoryStatus): string {
  switch (status) {
    case "success":
      return "green";
    case "failed":
      return "red";
    case "running":
      return "processing";
    default:
      return "default";
  }
}

function historyStatusText(status: AgentHistoryStatus): string {
  switch (status) {
    case "success":
      return "已完成";
    case "failed":
      return "失败";
    case "running":
      return "执行中";
    default:
      return "待执行";
  }
}
