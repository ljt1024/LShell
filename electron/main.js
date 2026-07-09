const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BACKEND_ENTRY = path.join(PROJECT_ROOT, "backend", "dist", "index.js");
const FRONTEND_INDEX = path.join(PROJECT_ROOT, "frontend", "dist", "index.html");

let mainWindow = null;
let backendProcess = null;
let backendUrl = "";
let rendererUrl = "";
let managedBackend = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerDesktopIpc();
    createAppMenu();

    try {
      backendUrl = await ensureBackend();
      createMainWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : "桌面端启动失败";
      dialog.showErrorBox("LShell 启动失败", message);
      app.quit();
    }
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendUrl) {
    createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

async function ensureBackend() {
  if (!fs.existsSync(BACKEND_ENTRY)) {
    throw new Error("后端尚未构建，请先运行 npm run build。");
  }

  const envFile = readProjectEnv();
  const listenHost = process.env.HOST || envFile.HOST || "127.0.0.1";
  const preferredPort = parsePort(process.env.PORT || envFile.PORT || "8080");
  const loadHost = listenHost === "0.0.0.0" || listenHost === "::" ? "127.0.0.1" : listenHost;
  const configuredUrl = `http://${loadHost}:${preferredPort}`;
  const rendererOverride = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
  const shouldServeFrontend = fs.existsSync(FRONTEND_INDEX);
  if (!shouldServeFrontend && !process.env.ELECTRON_RENDERER_URL && !process.env.VITE_DEV_SERVER_URL) {
    throw new Error("前端尚未构建，请先运行 npm run build。");
  }

  if (await waitForHealth(configuredUrl, 750)) {
    if (rendererOverride || (await checkFrontend(configuredUrl))) {
      managedBackend = false;
      return configuredUrl;
    }
    console.warn(`[desktop] ${configuredUrl} 已有后端运行，但未托管桌面 UI，将启动独立桌面后端。`);
  }

  const selectedPort = await resolveBackendPort(preferredPort, listenHost);
  const url = `http://${loadHost}:${selectedPort}`;

  backendProcess = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: listenHost,
      PORT: String(selectedPort),
      FRONTEND_ORIGIN: resolveFrontendOrigin(rendererOverride, url),
      LSHELL_SERVE_FRONTEND: shouldServeFrontend ? "true" : "false"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  backendProcess.stdout?.on("data", (chunk) => {
    console.log(`[backend] ${chunk.toString().trimEnd()}`);
  });
  backendProcess.stderr?.on("data", (chunk) => {
    console.error(`[backend] ${chunk.toString().trimEnd()}`);
  });
  backendProcess.once("exit", (code, signal) => {
    if (backendProcess) {
      console.log(`[backend] exited with code=${code ?? "null"} signal=${signal ?? "null"}`);
    }
    backendProcess = null;
  });

  await waitForHealth(url, 12_000, true);
  managedBackend = true;
  return url;
}

function createMainWindow() {
  rendererUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL || backendUrl;
  const windowState = readWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1080,
    minHeight: 700,
    title: "LShell",
    backgroundColor: "#0d0f0e",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--lshell-backend-url=${encodeURIComponent(backendUrl)}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url, rendererUrl)) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on("close", () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(rendererUrl);
}

function registerDesktopIpc() {
  ipcMain.handle("desktop:select-private-key", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "选择 SSH 私钥",
      properties: ["openFile", "showHiddenFiles"]
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return undefined;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("desktop:get-runtime-info", () => ({
    appVersion: app.getVersion(),
    backendUrl,
    backendManaged: managedBackend,
    rendererUrl,
    isPackaged: app.isPackaged,
    platform: process.platform,
    versions: process.versions
  }));
}

function createAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" }
            ]
          }
        ]
      : []),
    {
      label: "文件",
      submenu: [isMac ? { role: "close" } : { role: "quit" }]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "打开本地后端",
          click: () => {
            if (backendUrl) {
              void shell.openExternal(backendUrl);
            }
          }
        },
        {
          label: "关于 LShell",
          click: () => {
            const options = {
              type: "info",
              title: "关于 LShell",
              message: "LShell",
              detail: `版本：${app.getVersion()}\n后端：${backendUrl || "未启动"}`
            };
            if (mainWindow) {
              void dialog.showMessageBox(mainWindow, options);
              return;
            }
            void dialog.showMessageBox(options);
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }

  const child = backendProcess;
  let exited = false;
  backendProcess = null;
  child.once("exit", () => {
    exited = true;
  });
  child.kill("SIGTERM");

  setTimeout(() => {
    if (!exited) {
      child.kill("SIGKILL");
    }
  }, 2500).unref();
}

async function waitForHealth(url, timeoutMs, throwOnTimeout = false) {
  const startedAt = Date.now();

  do {
    if (await checkHealth(url)) {
      return true;
    }
    await delay(200);
  } while (Date.now() - startedAt < timeoutMs);

  if (throwOnTimeout) {
    throw new Error(`本地后端启动超时：${url}`);
  }
  return false;
}

function checkHealth(url) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function checkFrontend(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      const contentType = response.headers["content-type"] || "";
      response.resume();
      resolve(response.statusCode === 200 && String(contentType).includes("text/html"));
    });
    request.on("error", () => resolve(false));
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function resolveBackendPort(preferredPort, listenHost) {
  if (await isPortAvailable(preferredPort, listenHost)) {
    return preferredPort;
  }
  return findAvailablePort(preferredPort + 1, listenHost);
}

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function findAvailablePort(startPort, host) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, remaining) => {
      if (remaining <= 0) {
        reject(new Error("无法找到可用的本地后端端口。"));
        return;
      }

      const server = net.createServer();
      server.once("error", () => {
        tryPort(port + 1, remaining - 1);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, host);
    };

    tryPort(startPort, 50);
  });
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无效端口：${value}`);
  }
  return port;
}

function resolveFrontendOrigin(rendererOverride, fallbackUrl) {
  const originSource = rendererOverride || fallbackUrl;
  try {
    return new URL(originSource).origin;
  } catch {
    return fallbackUrl;
  }
}

function readProjectEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return env;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return env;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = value;
      return env;
    }, {});
}

function readWindowState() {
  const defaults = { width: 1360, height: 880 };
  const statePath = getWindowStatePath();
  if (!fs.existsSync(statePath)) {
    return defaults;
  }

  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      width: clampNumber(state.width, 1080, 3840, defaults.width),
      height: clampNumber(state.height, 700, 2400, defaults.height),
      x: Number.isFinite(state.x) ? state.x : undefined,
      y: Number.isFinite(state.y) ? state.y : undefined
    };
  } catch {
    return defaults;
  }
}

function saveWindowState(window) {
  if (!window) {
    return;
  }

  const bounds = window.getNormalBounds();
  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y
  };

  try {
    fs.mkdirSync(path.dirname(getWindowStatePath()), { recursive: true });
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn(`[desktop] 保存窗口状态失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function getWindowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function isInternalUrl(url, rendererUrl) {
  try {
    const target = new URL(url);
    const renderer = new URL(rendererUrl);
    return target.origin === renderer.origin || target.origin === backendUrl;
  } catch {
    return true;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
