/// <reference types="vite/client" />

interface LShellDesktopRuntimeInfo {
  appVersion: string;
  backendUrl: string;
  backendManaged: boolean;
  rendererUrl: string;
  isPackaged: boolean;
  platform: string;
  versions: Record<string, string>;
}

interface LShellDesktopBridge {
  backendUrl: string;
  getRuntimeInfo: () => Promise<LShellDesktopRuntimeInfo>;
  selectPrivateKey: () => Promise<string | undefined>;
}

interface Window {
  lshellDesktop?: LShellDesktopBridge;
}
