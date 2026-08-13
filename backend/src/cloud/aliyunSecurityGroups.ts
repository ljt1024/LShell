import EcsPackage, { DescribeSecurityGroupAttributeRequest } from "@alicloud/ecs20140526";
import OpenApi from "@alicloud/openapi-client";
import type { AliyunSecurityGroupState, CloudSecurityGroupRule } from "../models/protocol.js";
import type { SSHSession } from "../ssh/SSHSession.js";

interface MetadataResult {
  instanceId: string;
  regionId: string;
  securityGroupIds: string[];
  roleName: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
}

const METADATA_SCRIPT = String.raw`
set -eu
base=http://100.100.100.200/latest/meta-data
token=$(curl -fsS --connect-timeout 2 -X PUT -H 'X-aliyun-ecs-metadata-token-ttl-seconds: 60' http://100.100.100.200/latest/api/token 2>/dev/null || true)
header=""
if [ -n "$token" ]; then header="X-aliyun-ecs-metadata-token: $token"; fi
meta() { if [ -n "$header" ]; then curl -fsS --connect-timeout 2 -H "$header" "$base/$1"; else curl -fsS --connect-timeout 2 "$base/$1"; fi; }
instance_id=$(meta instance-id)
region_id=$(meta region-id)
groups=$(meta security-groups)
role_name=$(meta ram/security-credentials/ | head -1)
credentials=$(meta "ram/security-credentials/$role_name")
printf '%s\n%s\n%s\n%s\n%s\n' "$instance_id" "$region_id" "$groups" "$role_name" "$credentials"
`;

type SecurityGroupResponse = Awaited<ReturnType<InstanceType<(typeof import("@alicloud/ecs20140526"))["default"]>["describeSecurityGroupAttribute"]>>;
type EcsClientConstructor = new (config: OpenApi.Config) => {
  describeSecurityGroupAttribute(request: DescribeSecurityGroupAttributeRequest): Promise<SecurityGroupResponse>;
};
const EcsClient = (EcsPackage as unknown as { default: EcsClientConstructor }).default;

export async function readAliyunSecurityGroups(session: SSHSession): Promise<AliyunSecurityGroupState> {
  const syncedAt = new Date().toISOString();
  let metadata: MetadataResult;
  try {
    metadata = await readMetadata(session);
  } catch (error) {
    return {
      provider: "aliyun",
      available: false,
      groups: [],
      rules: [],
      warning: error instanceof Error ? error.message : "无法读取阿里云 ECS 元数据",
      syncedAt
    };
  }

  try {
    const config = new OpenApi.Config({
      accessKeyId: metadata.accessKeyId,
      accessKeySecret: metadata.accessKeySecret,
      securityToken: metadata.securityToken,
      endpoint: `ecs.${metadata.regionId}.aliyuncs.com`
    });
    const client = new EcsClient(config);
    const groups: AliyunSecurityGroupState["groups"] = [];
    const rules: CloudSecurityGroupRule[] = [];

    for (const groupId of metadata.securityGroupIds) {
      const response = await client.describeSecurityGroupAttribute(new DescribeSecurityGroupAttributeRequest({
        regionId: metadata.regionId,
        securityGroupId: groupId,
        direction: "all",
        maxResults: 1000
      }));
      const body = response.body;
      const groupName = body?.securityGroupName || groupId;
      groups.push({ id: groupId, name: groupName, description: body?.description });
      for (const permission of body?.permissions?.permission ?? []) {
        const direction = permission.direction === "egress" ? "egress" : "ingress";
        rules.push({
          id: permission.securityGroupRuleId || `${groupId}:${direction}:${rules.length}`,
          groupId,
          groupName,
          direction,
          action: permission.policy?.toLowerCase() === "drop" ? "deny" : "allow",
          source: permission.sourceCidrIp || permission.ipv6SourceCidrIp || permission.sourceGroupId || permission.sourcePrefixListId || "any",
          destination: permission.destCidrIp || permission.ipv6DestCidrIp || permission.destGroupId || permission.destPrefixListId || "any",
          protocol: permission.ipProtocol || "ALL",
          portRange: permission.portRange || "-1/-1",
          priority: permission.priority,
          description: permission.description
        });
      }
    }

    return {
      provider: "aliyun",
      available: true,
      instanceId: metadata.instanceId,
      regionId: metadata.regionId,
      roleName: metadata.roleName,
      groups,
      rules,
      syncedAt
    };
  } catch (error) {
    return {
      provider: "aliyun",
      available: false,
      instanceId: metadata.instanceId,
      regionId: metadata.regionId,
      roleName: metadata.roleName,
      groups: [],
      rules: [],
      warning: formatAliyunError(error),
      syncedAt
    };
  }
}

async function readMetadata(session: SSHSession): Promise<MetadataResult> {
  const result = await session.execCommand(METADATA_SCRIPT, { timeoutMs: 12_000, maxBytes: 128 * 1024 });
  if (result.exitCode !== 0) {
    throw new Error("未检测到阿里云 ECS 元数据。请确认目标是 ECS 实例，并允许访问 100.100.100.200。 ");
  }
  const [instanceId, regionId, rawGroups, roleName, ...credentialLines] = result.stdout.trim().split(/\r?\n/);
  if (!instanceId || !regionId) throw new Error("ECS 元数据缺少实例或地域信息");
  if (!roleName) throw new Error("实例未绑定 RAM 角色，无法安全读取阿里云安全组");

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(credentialLines.join("\n")) as Record<string, unknown>;
  } catch {
    throw new Error("RAM 角色临时凭证格式无效");
  }
  const accessKeyId = readString(credentials, "AccessKeyId");
  const accessKeySecret = readString(credentials, "AccessKeySecret");
  const securityToken = readString(credentials, "SecurityToken");
  if (!accessKeyId || !accessKeySecret || !securityToken) throw new Error("RAM 角色临时凭证不完整");

  return {
    instanceId,
    regionId,
    securityGroupIds: parseSecurityGroups(rawGroups),
    roleName,
    accessKeyId,
    accessKeySecret,
    securityToken
  };
}

function parseSecurityGroups(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string" && item.startsWith("sg-"));
  } catch {
    // Some metadata versions return a comma-separated list.
  }
  const groups = value.split(/[\s,]+/).filter((item) => item.startsWith("sg-"));
  if (groups.length === 0) throw new Error("实例元数据中未找到安全组 ID");
  return groups;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function formatAliyunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Forbidden|Unauthorized|NoPermission|AccessDenied/i.test(message)) {
    return "RAM 实例角色缺少 ECS 安全组只读权限，请授予 DescribeSecurityGroupAttribute 权限。";
  }
  return `阿里云安全组同步失败：${message}`;
}
