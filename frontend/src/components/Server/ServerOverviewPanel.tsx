import {
  CloudServerOutlined,
  DatabaseOutlined,
  FieldTimeOutlined,
  GlobalOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Button, Empty, Progress, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { useEffect } from "react";
import type { ServerOverview } from "../../types/protocol";

interface ServerOverviewPanelProps {
  connected: boolean;
  overview?: ServerOverview;
  loading: boolean;
  onRefresh: () => void;
}

export function ServerOverviewPanel({ connected, overview, loading, onRefresh }: ServerOverviewPanelProps) {
  useEffect(() => {
    if (!connected) return;
    onRefresh();
    const timer = window.setInterval(onRefresh, 10_000);
    return () => window.clearInterval(timer);
  }, [connected, onRefresh]);

  if (!connected) {
    return <Empty className="server-overview-empty" description="连接服务器后查看运行状态" />;
  }

  if (!overview && loading) {
    return <div className="server-overview-loading"><Spin /></div>;
  }

  if (!overview) {
    return <Empty className="server-overview-empty" description="暂无服务器状态"><Button onClick={onRefresh}>重新加载</Button></Empty>;
  }

  return (
    <div className="server-overview-panel">
      <div className="server-overview-heading">
        <div>
          <Typography.Text strong>{overview.hostname}</Typography.Text>
          <Typography.Text className="server-overview-os">{overview.os}</Typography.Text>
        </div>
        <Tooltip title="刷新状态">
          <Button size="small" icon={<ReloadOutlined spin={loading} />} onClick={onRefresh} aria-label="刷新服务器状态" />
        </Tooltip>
      </div>

      <div className="server-metric-grid">
        <Metric icon={<ThunderboltOutlined />} label="CPU" value={overview.cpuPercent} suffix="%" />
        <Metric icon={<DatabaseOutlined />} label="内存" value={overview.memory.usedPercent} suffix="%" detail={`${formatBytes(overview.memory.usedBytes)} / ${formatBytes(overview.memory.totalBytes)}`} />
      </div>

      <div className="server-fact-row">
        <Space size={7}><FieldTimeOutlined /><span>运行 {formatDuration(overview.uptimeSeconds)}</span></Space>
        <span>负载 {overview.loadAverage.map((item) => item.toFixed(2)).join(" / ")}</span>
      </div>

      <StatusBlock title="服务状态" icon={<CloudServerOutlined />}>
        <div className="server-status-line">
          <span>防火墙</span>
          <Tag color={overview.firewall.enabled === true ? "success" : overview.firewall.enabled === false ? "warning" : "default"}>
            {overview.firewall.provider} · {overview.firewall.enabled === true ? "开启" : overview.firewall.enabled === false ? "关闭" : "未知"}
          </Tag>
        </div>
        <Typography.Text className="server-status-summary">{overview.firewall.summary}</Typography.Text>
        <div className="server-status-line">
          <span>Nginx</span>
          <Space size={4}>
            <Tag color={overview.nginx.running ? "success" : "default"}>{overview.nginx.installed ? overview.nginx.running ? "运行中" : "未运行" : "未安装"}</Tag>
            {overview.nginx.installed ? <Tag color={overview.nginx.configValid ? "success" : "error"}>配置{overview.nginx.configValid ? "正常" : "异常"}</Tag> : null}
          </Space>
        </div>
        {overview.nginx.version ? <Typography.Text className="server-status-summary">{overview.nginx.version}</Typography.Text> : null}
      </StatusBlock>

      <StatusBlock title="磁盘" icon={<DatabaseOutlined />}>
        <div className="server-disk-list">
          {overview.disks.map((disk) => (
            <div key={`${disk.filesystem}:${disk.mount}`} className="server-disk-item">
              <div><span>{disk.mount}</span><span>{formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}</span></div>
              <Progress percent={Math.round(disk.usedPercent)} size="small" showInfo={false} strokeColor={metricColor(disk.usedPercent)} />
            </div>
          ))}
        </div>
      </StatusBlock>

      <StatusBlock title="访问 IP" icon={<GlobalOutlined />}>
        {overview.accessIps.length > 0 ? (
          <div className="server-ip-list">
            {overview.accessIps.slice(0, 10).map((item) => <div key={item.ip}><code>{item.ip}</code><span>{item.requests} 次</span></div>)}
          </div>
        ) : <Typography.Text type="secondary">未读取到 Nginx access log</Typography.Text>}
      </StatusBlock>

      {overview.warnings.length > 0 ? (
        <StatusBlock title="采集提示" icon={<SafetyCertificateOutlined />}>
          {overview.warnings.map((warning) => <Typography.Text key={warning} type="secondary">{warning}</Typography.Text>)}
        </StatusBlock>
      ) : null}
      <Typography.Text className="server-collected-at">更新于 {new Date(overview.collectedAt).toLocaleTimeString()}</Typography.Text>
    </div>
  );
}

function Metric({ icon, label, value, suffix, detail }: { icon: React.ReactNode; label: string; value?: number; suffix: string; detail?: string }) {
  const percent = value ?? 0;
  return <div className="server-metric"><div className="server-metric-label">{icon}<span>{label}</span></div><div className="server-metric-value">{value === undefined ? "--" : Math.round(value)}<small>{suffix}</small></div><Progress percent={Math.round(percent)} showInfo={false} strokeColor={metricColor(percent)} /><span className="server-metric-detail">{detail || "实时占用"}</span></div>;
}

function StatusBlock({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="server-status-block"><div className="server-status-title">{icon}<Typography.Text strong>{title}</Typography.Text></div>{children}</section>;
}

function metricColor(value: number): string { return value >= 90 ? "#e56b6f" : value >= 70 ? "#f7c948" : "#65c18c"; }
function formatBytes(value: number): string { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`; }
function formatDuration(seconds: number): string { const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); return days > 0 ? `${days} 天 ${hours} 小时` : `${hours} 小时`; }
