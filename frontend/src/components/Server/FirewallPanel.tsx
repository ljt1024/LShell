import { DeleteOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import type { AliyunSecurityGroupState, CloudSecurityGroupRule, FirewallRuleAction, FirewallRuleProtocol, FirewallState, ServerOverview } from "../../types/protocol";

interface FirewallPanelProps {
  connected: boolean;
  overview?: ServerOverview;
  state?: FirewallState;
  aliyunState?: AliyunSecurityGroupState;
  loading: boolean;
  aliyunLoading: boolean;
  onRefresh: () => void;
  onRefreshAliyun: () => void;
  onAddRule: (rule: { action: FirewallRuleAction; source: string; port?: number; protocol?: FirewallRuleProtocol }) => void;
  onRemoveRule: (ruleId: string) => void;
}

interface RuleFormValues {
  action: FirewallRuleAction;
  source: string;
  port?: number;
  protocol: FirewallRuleProtocol;
}

export function FirewallPanel({ connected, overview, state, aliyunState, loading, aliyunLoading, onRefresh, onRefreshAliyun, onAddRule, onRemoveRule }: FirewallPanelProps) {
  const [form] = Form.useForm<RuleFormValues>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const firewall = state ?? (overview ? { provider: overview.firewall.provider, enabled: overview.firewall.enabled, rules: [] } : undefined);
  const rules = firewall?.rules ?? [];
  const allowedCount = rules.filter((rule) => rule.action === "allow").length;
  const deniedCount = rules.filter((rule) => rule.action === "deny").length;

  const columns = useMemo(() => [
    { title: "策略", dataIndex: "action", width: 90, render: (action: FirewallRuleAction) => <Tag color={action === "allow" ? "success" : "error"}>{action === "allow" ? "允许" : "拉黑"}</Tag> },
    { title: "来源 IP / 网段", dataIndex: "source", ellipsis: true },
    { title: "目标端口", dataIndex: "port", width: 110, render: (port?: number) => port ?? "全部" },
    { title: "协议", dataIndex: "protocol", width: 90, render: (protocol: FirewallRuleProtocol) => protocol.toUpperCase() },
    { title: "备注", dataIndex: "description", width: 100, render: (value?: string) => value || "-" },
    { title: "操作", key: "actions", width: 70, render: (_: unknown, rule: FirewallState["rules"][number]) => rule.removable ? <Popconfirm title="删除这条防火墙规则？" description="删除后对应 IP 可能立即恢复或失去访问权限。" okText="删除" cancelText="取消" onConfirm={() => onRemoveRule(rule.id)}><Button type="text" danger icon={<DeleteOutlined />} aria-label="删除规则" /></Popconfirm> : null }
  ], [onRemoveRule]);

  const submit = (values: RuleFormValues) => {
    onAddRule({ ...values, source: values.source.trim() });
    setDialogOpen(false);
    form.resetFields();
  };

  return <section className="ops-panel firewall-panel">
    <PanelHeader loading={loading} onRefresh={onRefresh} onAdd={() => setDialogOpen(true)} disabled={!connected || !["ufw", "firewalld"].includes(firewall?.provider ?? "")} />
    {!connected ? <Empty description="请先连接服务器" /> : <Tabs className="firewall-tabs" defaultActiveKey="host" items={[{ key: "host", label: "服务器防火墙", children: firewall ? <div className="ops-content">
      <div className="ops-status-hero"><SafetyCertificateOutlined /><div><Typography.Title level={3}>{firewall.enabled === true ? "防护已启用" : firewall.enabled === false ? "防护未启用" : "状态不可确定"}</Typography.Title><Typography.Text>{overview?.firewall.summary || firewall.warning || "已读取远程防火墙规则"}</Typography.Text></div><Tag color={firewall.enabled ? "success" : firewall.enabled === false ? "warning" : "default"}>{firewall.provider}</Tag></div>
      <div className="ops-detail-grid"><Detail label="规则引擎" value={firewall.provider} /><Detail label="允许规则" value={String(allowedCount)} /><Detail label="拉黑规则" value={String(deniedCount)} /><Detail label="管理能力" value={["ufw", "firewalld"].includes(firewall.provider) ? "可读写" : "仅查看"} /></div>
      {firewall.warning ? <div className="ops-notice"><Typography.Text strong>权限提示</Typography.Text><Typography.Paragraph>{firewall.warning}</Typography.Paragraph></div> : null}
      <div className="firewall-rule-heading"><div><Typography.Title level={4}>访问规则</Typography.Title><Typography.Text>按来源 IP 或 CIDR 网段允许、拉黑，也可以限制到指定端口。</Typography.Text></div><Space><Tag color="success">允许 {allowedCount}</Tag><Tag color="error">拉黑 {deniedCount}</Tag></Space></div>
      <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={rules} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: "暂无可识别的 IP 访问规则" }} scroll={{ x: 720 }} />
      <div className="ops-notice"><Typography.Text strong>避免断开 SSH</Typography.Text><Typography.Paragraph>新增拉黑规则前，请确认没有包含当前客户端 IP，也不要删除当前 SSH 端口所需的允许规则。变更需要远程用户具备受限的免交互 sudo 权限。</Typography.Paragraph></div>
    </div> : <Empty description="暂无防火墙状态"><Button onClick={onRefresh}>加载状态</Button></Empty> }, { key: "aliyun", label: "阿里云安全组", children: <AliyunSecurityGroups state={aliyunState} loading={aliyunLoading} onRefresh={onRefreshAliyun} /> }]} />}
    <Modal title="新增 IP 访问规则" open={dialogOpen} onCancel={() => setDialogOpen(false)} onOk={() => form.submit()} okText="应用规则" cancelText="取消" confirmLoading={loading} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ action: "allow", protocol: "tcp" }} onFinish={submit}>
        <Form.Item name="action" label="访问策略" rules={[{ required: true }]}><Radio.Group optionType="button" buttonStyle="solid" options={[{ label: "允许访问", value: "allow" }, { label: "拉黑 IP", value: "deny" }]} /></Form.Item>
        <Form.Item name="source" label="来源 IP 或 CIDR" rules={[{ required: true, message: "请输入 IP 地址或 CIDR 网段" }, { pattern: /^[0-9a-fA-F:.]+(?:\/\d{1,3})?$/, message: "请输入有效的 IPv4、IPv6 或 CIDR" }]}><Input placeholder="例如 203.0.113.10 或 10.0.0.0/24" autoComplete="off" /></Form.Item>
        <div className="firewall-form-row"><Form.Item name="port" label="目标端口"><InputNumber min={1} max={65535} precision={0} placeholder="留空表示全部端口" /></Form.Item><Form.Item name="protocol" label="协议"><Select options={[{ label: "TCP", value: "tcp" }, { label: "UDP", value: "udp" }, { label: "全部", value: "any" }]} /></Form.Item></div>
        <Typography.Paragraph className="firewall-form-hint">允许规则常用于只开放某个 IP 对 SSH、HTTP 或数据库端口的访问；拉黑规则用于阻止恶意来源。规则会立即写入远程服务器。</Typography.Paragraph>
      </Form>
    </Modal>
  </section>;
}

function AliyunSecurityGroups({ state, loading, onRefresh }: { state?: AliyunSecurityGroupState; loading: boolean; onRefresh: () => void }) {
  const columns = [
    { title: "方向", dataIndex: "direction", width: 80, render: (value: CloudSecurityGroupRule["direction"]) => <Tag color={value === "ingress" ? "blue" : "default"}>{value === "ingress" ? "入方向" : "出方向"}</Tag> },
    { title: "策略", dataIndex: "action", width: 80, render: (value: CloudSecurityGroupRule["action"]) => <Tag color={value === "allow" ? "success" : "error"}>{value === "allow" ? "允许" : "拒绝"}</Tag> },
    { title: "来源", dataIndex: "source", ellipsis: true },
    { title: "目标", dataIndex: "destination", ellipsis: true },
    { title: "协议", dataIndex: "protocol", width: 85 },
    { title: "端口范围", dataIndex: "portRange", width: 120, render: (value: string) => value === "-1/-1" ? "全部" : value },
    { title: "优先级", dataIndex: "priority", width: 80, render: (value?: string) => value || "-" },
    { title: "安全组", dataIndex: "groupName", width: 150, ellipsis: true }
  ];
  return <div className="ops-content cloud-firewall-content">
    <div className="cloud-firewall-heading"><div><Typography.Title level={4}>ECS 安全组规则</Typography.Title><Typography.Text>通过实例 RAM 角色只读同步，不保存 AccessKey，也不会修改云端规则。</Typography.Text></div><Button icon={<ReloadOutlined spin={loading} />} onClick={onRefresh}>同步安全组</Button></div>
    {!state ? <Empty description="尚未同步阿里云安全组"><Button type="primary" onClick={onRefresh} loading={loading}>立即同步</Button></Empty> : !state.available ? <Alert type="warning" showIcon message="无法同步阿里云安全组" description={state.warning} action={<Button size="small" onClick={onRefresh} loading={loading}>重试</Button>} /> : <>
      <div className="ops-detail-grid"><Detail label="实例 ID" value={state.instanceId || "-"} /><Detail label="地域" value={state.regionId || "-"} /><Detail label="RAM 角色" value={state.roleName || "-"} /><Detail label="安全组数量" value={String(state.groups.length)} /></div>
      <div className="cloud-group-list">{state.groups.map((group) => <div key={group.id}><Tag color="blue">{group.id}</Tag><strong>{group.name}</strong>{group.description ? <Typography.Text>{group.description}</Typography.Text> : null}</div>)}</div>
      <Table rowKey={(rule) => `${rule.groupId}:${rule.id}`} size="middle" loading={loading} columns={columns} dataSource={state.rules} pagination={{ pageSize: 12, hideOnSinglePage: true }} locale={{ emptyText: "当前安全组没有可展示的规则" }} scroll={{ x: 900 }} />
      <Typography.Text className="cloud-synced-at">最近同步：{new Date(state.syncedAt).toLocaleString()}</Typography.Text>
    </>}
  </div>;
}

function PanelHeader({ loading, onRefresh, onAdd, disabled }: { loading: boolean; onRefresh: () => void; onAdd: () => void; disabled: boolean }) { return <header className="ops-panel-header"><div><Typography.Title level={3}>防火墙</Typography.Title><Typography.Text>管理允许访问、拉黑 IP 和端口限制规则</Typography.Text></div><Space><Button icon={<ReloadOutlined spin={loading} />} onClick={onRefresh}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={onAdd} disabled={disabled}>新增规则</Button></Space></header>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="ops-detail"><span>{label}</span><strong>{value}</strong></div>; }
