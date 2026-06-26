import path from "node:path";

export function normalizeRemotePath(remotePath: string): string {
  const normalized = path.posix.normalize(remotePath || "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function joinRemotePath(basePath: string, name: string): string {
  return normalizeRemotePath(path.posix.join(basePath || "/", name));
}
