import type { ServerOverview } from "../models/protocol.js";
import type { SSHSession } from "../ssh/SSHSession.js";
import { enrichAccessIps } from "./ipGeolocation.js";

const OVERVIEW_COMMAND = String.raw`sh -lc '
hostname 2>/dev/null || printf unknown
printf "\n__LSHELL_OS__\n"
(grep "^PRETTY_NAME=" /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d "\"") || true
printf "__LSHELL_KERNEL__\n"
uname -sr 2>/dev/null || true
printf "\n__LSHELL_UPTIME__\n"
cut -d" " -f1 /proc/uptime 2>/dev/null || printf 0
printf "\n__LSHELL_LOAD__\n"
cut -d" " -f1-3 /proc/loadavg 2>/dev/null || printf "0 0 0"
printf "\n__LSHELL_CPU__\n"
if command -v vmstat >/dev/null 2>&1; then vmstat 1 2 2>/dev/null | tail -1 | awk "{print 100-\$15}"; fi
printf "__LSHELL_MEM__\n"
awk "/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {print \$1, \$2}" /proc/meminfo 2>/dev/null
printf "__LSHELL_DISK__\n"
df -P -B1 -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | tail -n +2
printf "__LSHELL_FIREWALL__\n"
if command -v ufw >/dev/null 2>&1; then printf "ufw|"; ufw status 2>/dev/null | head -1
elif command -v firewall-cmd >/dev/null 2>&1; then printf "firewalld|"; firewall-cmd --state 2>/dev/null
elif command -v nft >/dev/null 2>&1; then printf "nftables|"; nft list ruleset 2>/dev/null | awk "BEGIN{n=0} /^table /{n++} END{print n \" tables\"}"
elif command -v iptables >/dev/null 2>&1; then printf "iptables|"; iptables -S 2>/dev/null | awk "END{print NR \" rules\"}"
else printf "none|not detected\n"; fi
printf "__LSHELL_NGINX__\n"
if command -v nginx >/dev/null 2>&1; then
  printf "installed|"; nginx -v 2>&1 | head -1
  if command -v systemctl >/dev/null 2>&1; then systemctl is-active nginx 2>/dev/null || true; else pgrep -x nginx >/dev/null 2>&1 && printf "active\n" || printf "inactive\n"; fi
  nginx -t >/dev/null 2>&1 && printf "valid\n" || printf "invalid\n"
else printf "missing\n"; fi
printf "__LSHELL_IPS__\n"
log=""; for file in /var/log/nginx/access.log /usr/local/nginx/logs/access.log; do [ -r "$file" ] && log="$file" && break; done
if [ -n "$log" ]; then tail -n 2000 "$log" 2>/dev/null | awk "{count[\$1]++} END{for(ip in count) print count[ip], ip}" | sort -rn | head -20; fi
'`;

export async function collectServerOverview(session: SSHSession): Promise<ServerOverview> {
  const result = await session.execCommand(OVERVIEW_COMMAND, { timeoutMs: 15_000, maxBytes: 512 * 1024 });
  const sections = parseSections(result.stdout);
  const warnings: string[] = [];
  if (result.exitCode !== 0 && result.stderr.trim()) {
    warnings.push(result.stderr.trim().slice(0, 240));
  }

  const memoryValues = Object.fromEntries(
    lines(sections.MEM).map((line) => {
      const [key, value] = line.split(/\s+/);
      return [key?.replace(/:$/, ""), number(value) * 1024];
    })
  );
  const memTotal = memoryValues.MemTotal ?? 0;
  const memAvailable = memoryValues.MemAvailable ?? 0;
  const swapTotal = memoryValues.SwapTotal ?? 0;
  const swapFree = memoryValues.SwapFree ?? 0;

  const accessIps = lines(sections.IPS).flatMap((line) => {
    const match = line.match(/^(\d+)\s+(\S+)$/);
    return match ? [{ requests: number(match[1]), ip: match[2] }] : [];
  });

  return {
    collectedAt: new Date().toISOString(),
    hostname: firstLine(sections.ROOT) || "unknown",
    os: firstLine(sections.OS) || "Linux",
    kernel: firstLine(sections.KERNEL),
    uptimeSeconds: number(firstLine(sections.UPTIME)),
    loadAverage: tuple3(lines(sections.LOAD)[0]),
    cpuPercent: optionalPercent(firstLine(sections.CPU)),
    memory: usage(memTotal, Math.max(0, memTotal - memAvailable), memAvailable),
    swap: { totalBytes: swapTotal, usedBytes: Math.max(0, swapTotal - swapFree), usedPercent: percent(swapTotal - swapFree, swapTotal) },
    disks: lines(sections.DISK).flatMap(parseDisk),
    firewall: parseFirewall(firstLine(sections.FIREWALL)),
    nginx: parseNginx(lines(sections.NGINX)),
    accessIps: await enrichAccessIps(accessIps),
    warnings
  };
}

function parseSections(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  let section = "ROOT";
  for (const line of output.split(/\r?\n/)) {
    const marker = line.match(/^__LSHELL_([A-Z]+)__$/);
    if (marker) {
      section = marker[1];
      continue;
    }
    result[section] = `${result[section] ?? ""}${line}\n`;
  }
  return result;
}

function parseDisk(line: string): ServerOverview["disks"] {
  const values = line.trim().split(/\s+/);
  if (values.length < 6) return [];
  return [{ filesystem: values[0], totalBytes: number(values[1]), usedBytes: number(values[2]), usedPercent: number(values[4]?.replace("%", "")), mount: values.slice(5).join(" ") }];
}

function parseFirewall(value: string): ServerOverview["firewall"] {
  const [provider = "none", ...summaryParts] = value.split("|");
  const summary = summaryParts.join("|").trim() || "状态不可用";
  const normalized = summary.toLowerCase();
  const enabled = provider === "none" ? undefined : /active|running|tables|rules/.test(normalized) && !/inactive|not running/.test(normalized);
  return { provider, enabled, summary };
}

function parseNginx(values: string[]): ServerOverview["nginx"] {
  if (values[0] === "missing") return { installed: false };
  const version = values[0]?.split("|").slice(1).join("|").replace(/^nginx version:\s*/i, "");
  return { installed: true, version, running: values[1] === "active", configValid: values[2] === "valid" };
}

function usage(totalBytes: number, usedBytes: number, availableBytes: number): ServerOverview["memory"] {
  return { totalBytes, usedBytes, availableBytes, usedPercent: percent(usedBytes, totalBytes) };
}

function tuple3(value = ""): [number, number, number] {
  const values = value.trim().split(/\s+/).map(number);
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function optionalPercent(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : undefined;
}

function percent(used: number, total: number): number {
  return total > 0 ? Math.round((Math.max(0, used) / total) * 1000) / 10 : 0;
}

function firstLine(value = ""): string { return lines(value)[0] ?? ""; }
function lines(value = ""): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
