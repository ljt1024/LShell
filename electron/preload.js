const { contextBridge, ipcRenderer } = require("electron");

const backendUrl = readBackendUrl();

contextBridge.exposeInMainWorld("lshellDesktop", {
  backendUrl,
  getRuntimeInfo: () => ipcRenderer.invoke("desktop:get-runtime-info"),
  selectPrivateKey: () => ipcRenderer.invoke("desktop:select-private-key")
});

function readBackendUrl() {
  const argument = process.argv.find((item) => item.startsWith("--lshell-backend-url="));
  if (!argument) {
    return "";
  }

  return decodeURIComponent(argument.slice("--lshell-backend-url=".length));
}
