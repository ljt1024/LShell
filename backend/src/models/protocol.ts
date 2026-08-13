export type AuthType = "password" | "privateKey";

export interface ServerConfig {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  group?: string;
}

export type RemoteFileType = "file" | "directory" | "symlink" | "other";

export interface FileInfo {
  name: string;
  path: string;
  type: RemoteFileType;
  size: number;
  permissions: string;
  modifyTime: number;
}

export type AgentRiskLevel = "low" | "medium" | "high" | "blocked";

export interface AgentPlanStep {
  id: string;
  title: string;
  description: string;
  command: string;
  riskLevel: AgentRiskLevel;
  warnings: string[];
  requiresSudo: boolean;
  destructive: boolean;
}

export interface AgentPlan {
  id: string;
  title: string;
  summary: string;
  assumptions: string[];
  safetyNotes: string[];
  currentPath: string;
  createdAt: string;
  steps: AgentPlanStep[];
}

export interface AgentStepExecutionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string | null;
  durationMs: number;
}

export interface AgentUploadedFile {
  id: string;
  name: string;
  path: string;
  directory: string;
  size: number;
  uploadedAt: string;
}

export interface ServerOverview {
  collectedAt: string;
  hostname: string;
  os: string;
  kernel: string;
  uptimeSeconds: number;
  loadAverage: [number, number, number];
  cpuPercent?: number;
  memory: { totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: number };
  swap: { totalBytes: number; usedBytes: number; usedPercent: number };
  disks: Array<{ filesystem: string; mount: string; totalBytes: number; usedBytes: number; usedPercent: number }>;
  firewall: { provider: string; enabled?: boolean; summary: string };
  nginx: { installed: boolean; running?: boolean; version?: string; configValid?: boolean };
  accessIps: Array<{ ip: string; requests: number; latitude?: number; longitude?: number; country?: string; city?: string }>;
  warnings: string[];
}

export type FirewallRuleAction = "allow" | "deny";
export type FirewallRuleProtocol = "tcp" | "udp" | "any";

export interface FirewallRule {
  id: string;
  action: FirewallRuleAction;
  source: string;
  port?: number;
  protocol: FirewallRuleProtocol;
  description?: string;
  raw: string;
  removable: boolean;
}

export interface FirewallState {
  provider: string;
  enabled?: boolean;
  rules: FirewallRule[];
  warning?: string;
}

export interface CloudSecurityGroupRule {
  id: string;
  groupId: string;
  groupName: string;
  direction: "ingress" | "egress";
  action: "allow" | "deny";
  source: string;
  destination: string;
  protocol: string;
  portRange: string;
  priority?: string;
  description?: string;
}

export interface AliyunSecurityGroupState {
  provider: "aliyun";
  available: boolean;
  instanceId?: string;
  regionId?: string;
  roleName?: string;
  groups: Array<{ id: string; name: string; description?: string }>;
  rules: CloudSecurityGroupRule[];
  warning?: string;
  syncedAt: string;
}

export type ClientMessage =
  | { type: "connection.connect"; config: ServerConfig }
  | { type: "connection.attach"; sessionId: string }
  | { type: "connection.disconnect" }
  | { type: "terminal.open"; cols: number; rows: number }
  | { type: "terminal.input"; data: string }
  | { type: "terminal.resize"; cols: number; rows: number }
  | { type: "server.overview"; requestId?: string }
  | { type: "firewall.list"; requestId?: string }
  | { type: "firewall.add"; action: FirewallRuleAction; source: string; port?: number; protocol?: FirewallRuleProtocol; requestId?: string }
  | { type: "firewall.remove"; ruleId: string; requestId?: string }
  | { type: "cloud.aliyun-security-groups"; requestId?: string }
  | { type: "file.list"; path: string; requestId?: string }
  | { type: "file.read"; path: string }
  | { type: "file.write"; path: string; content: string }
  | { type: "file.mkdir"; path: string }
  | { type: "file.remove"; path: string }
  | { type: "file.rename"; oldPath: string; newPath: string }
  | { type: "file.upload"; directory: string; fileName: string; contentBase64: string; requestId?: string; size?: number }
  | { type: "file.download"; path: string }
  | { type: "agent.plan"; intent: string; currentPath: string; uploadedFiles?: AgentUploadedFile[]; requestId?: string }
  | { type: "agent.execute"; plan: AgentPlan; requestId?: string };

export type ServerMessage =
  | { type: "connection.status"; status: "idle" | "connecting" | "connected" | "disconnected"; message?: string }
  | { type: "connection.ready"; sessionId: string; name: string }
  | { type: "terminal.output"; data: string }
  | { type: "terminal.closed"; code?: number | null; signal?: string | null }
  | { type: "server.overview"; overview: ServerOverview; requestId?: string }
  | { type: "firewall.state"; state: FirewallState; requestId?: string }
  | { type: "cloud.aliyun-security-groups"; state: AliyunSecurityGroupState; requestId?: string }
  | { type: "file.list"; path: string; files: FileInfo[]; requestId?: string }
  | { type: "file.read"; path: string; content: string }
  | { type: "file.saved"; path: string }
  | { type: "file.uploaded"; path: string; requestId?: string; size?: number }
  | { type: "file.download"; path: string; fileName: string; contentBase64: string }
  | { type: "action.done"; action: string; path?: string }
  | { type: "agent.plan.started"; requestId?: string }
  | { type: "agent.plan.delta"; delta: string; requestId?: string }
  | { type: "agent.plan"; plan: AgentPlan; requestId?: string }
  | { type: "agent.plan.finished"; requestId?: string }
  | { type: "agent.step.started"; stepId: string; requestId?: string }
  | { type: "agent.step.output"; stepId: string; stream: "stdout" | "stderr"; data: string; requestId?: string }
  | { type: "agent.step.finished"; stepId: string; result: AgentStepExecutionResult; requestId?: string }
  | { type: "agent.execution.finished"; ok: boolean; message: string; requestId?: string }
  | { type: "error"; message: string; requestType?: string; requestId?: string };
