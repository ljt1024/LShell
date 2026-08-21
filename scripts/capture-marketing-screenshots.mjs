import { chromium } from "playwright";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const screenshotOne = path.join(projectRoot, "assets", "image1.png");
const screenshotTwo = path.join(projectRoot, "assets", "image2.png");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1510, height: 827 }, deviceScaleFactor: 2 });

await page.addInitScript(() => {
  Object.defineProperty(window, "lshellDesktop", { value: {
    backendUrl: "http://127.0.0.1:8080",
    getRuntimeInfo: async () => ({ appVersion: "0.1.0", backendUrl: "http://127.0.0.1:8080", backendManaged: true, rendererUrl: location.origin, isPackaged: true, platform: "darwin", versions: {} }),
    selectPrivateKey: async () => undefined
  } });
  sessionStorage.setItem("lshell-active-session", JSON.stringify({
    sessionId: "demo-session-2026",
    name: "production-web-01",
    currentPath: "/var/www/lshell"
  }));

  const files = [
    { name: "backend", path: "/var/www/lshell/backend", type: "directory", size: 4096, permissions: "drwxr-xr-x", modifyTime: Date.now() - 180000 },
    { name: "frontend", path: "/var/www/lshell/frontend", type: "directory", size: 4096, permissions: "drwxr-xr-x", modifyTime: Date.now() - 260000 },
    { name: "electron", path: "/var/www/lshell/electron", type: "directory", size: 4096, permissions: "drwxr-xr-x", modifyTime: Date.now() - 420000 },
    { name: ".env", path: "/var/www/lshell/.env", type: "file", size: 684, permissions: "-rw-------", modifyTime: Date.now() - 900000 },
    { name: "package.json", path: "/var/www/lshell/package.json", type: "file", size: 1382, permissions: "-rw-r--r--", modifyTime: Date.now() - 640000 },
    { name: "README.md", path: "/var/www/lshell/README.md", type: "file", size: 6270, permissions: "-rw-r--r--", modifyTime: Date.now() - 1200000 }
  ];

  const overview = {
    collectedAt: new Date().toISOString(), hostname: "prod-web-01", os: "Ubuntu 24.04.2 LTS", kernel: "6.8.0-52-generic",
    uptimeSeconds: 1897200, loadAverage: [0.24, 0.31, 0.28], cpuPercent: 27,
    memory: { totalBytes: 17179869184, usedBytes: 6871947673, availableBytes: 10307921511, usedPercent: 40 },
    swap: { totalBytes: 2147483648, usedBytes: 107374182, usedPercent: 5 },
    disks: [
      { filesystem: "/dev/vda1", mount: "/", totalBytes: 107374182400, usedBytes: 39728447488, usedPercent: 37 },
      { filesystem: "/dev/vdb1", mount: "/data", totalBytes: 536870912000, usedBytes: 209379655680, usedPercent: 39 }
    ],
    firewall: { provider: "ufw", enabled: true, summary: "active · 8 rules" },
    nginx: { installed: true, running: true, version: "nginx/1.24.0", configValid: true },
    accessIps: [
      { ip: "203.0.113.18", requests: 1284, country: "China", city: "Shanghai" },
      { ip: "198.51.100.42", requests: 836, country: "Singapore", city: "Singapore" },
      { ip: "192.0.2.76", requests: 429, country: "Japan", city: "Tokyo" }
    ], warnings: []
  };

  class DemoWebSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 0; bufferedAmount = 0; extensions = ""; protocol = ""; binaryType = "blob";
    onopen = null; onmessage = null; onerror = null; onclose = null;
    constructor(url) {
      super(); this.url = String(url);
      setTimeout(() => { this.readyState = 1; const event = new Event("open"); this.onopen?.(event); }, 80);
    }
    emit(data, delay = 20) {
      setTimeout(() => { const event = new MessageEvent("message", { data: JSON.stringify(data) }); this.onmessage?.(event); }, delay);
    }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.type === "connection.attach" || message.type === "connection.connect") {
        this.emit({ type: "connection.ready", sessionId: "demo-session-2026", name: "production-web-01" });
      }
      if (message.type === "file.list") this.emit({ type: "file.list", path: message.path, files, requestId: message.requestId });
      if (message.type === "server.overview") this.emit({ type: "server.overview", overview, requestId: message.requestId });
      if (message.type === "terminal.open") this.emit({ type: "terminal.output", data: "\u001b[32mroot@prod-web-01\u001b[0m:\u001b[34m/var/www/lshell\u001b[0m# " }, 80);
      if (message.type === "terminal.input" && message.data && !message.data.includes("\u0015")) {
        this.emit({ type: "terminal.output", data: message.data }, 5);
      }
      if (message.type === "agent.plan") {
        const plan = {
          id: "demo-plan", title: "检查 Nginx 错误日志与异常访问来源",
          summary: "读取近期错误日志并统计高频访问 IP，不修改服务器配置。",
          assumptions: ["Nginx 使用默认日志目录"], safetyNotes: ["所有步骤均为只读操作"],
          currentPath: "/var/www/lshell", createdAt: new Date().toISOString(),
          steps: [
            { id: "s1", title: "查看近期错误", description: "读取最近 80 行错误日志", command: "sudo tail -n 80 /var/log/nginx/error.log", riskLevel: "low", warnings: [], requiresSudo: true, destructive: false },
            { id: "s2", title: "统计访问来源", description: "统计访问次数最多的 IP", command: "awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head", riskLevel: "low", warnings: [], requiresSudo: false, destructive: false }
          ]
        };
        this.emit({ type: "agent.plan.started", requestId: message.requestId });
        this.emit({ type: "agent.plan", plan, requestId: message.requestId }, 100);
        this.emit({ type: "agent.plan.finished", requestId: message.requestId }, 120);
      }
    }
    close() { this.readyState = 3; const event = new CloseEvent("close"); this.onclose?.(event); }
  }
  Object.defineProperty(window, "WebSocket", { value: DemoWebSocket });
});

await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
await page.getByText("prod-web-01", { exact: true }).waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: screenshotOne });

await page.getByText("服务器目录", { exact: true }).click();
await page.locator(".terminal-host").waitFor();
await page.waitForTimeout(500);
await page.locator(".terminal-host").click();
await page.keyboard.type("帮我检查 nginx 错误日志并找出访问异常的 IP");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await page.screenshot({ path: screenshotTwo });

await browser.close();
console.log(`Updated ${screenshotOne}`);
console.log(`Updated ${screenshotTwo}`);
