import { isIP } from "node:net";
import type { ServerOverview } from "../models/protocol.js";

type AccessIp = ServerOverview["accessIps"][number];
type GeoEntry = Omit<AccessIp, "ip" | "requests">;

const cache = new Map<string, GeoEntry | null>();
const MAX_LOOKUPS_PER_REQUEST = 20;

export async function enrichAccessIps(items: AccessIp[]): Promise<AccessIp[]> {
  const publicIps = items.map((item) => item.ip).filter(isPublicIp).slice(0, MAX_LOOKUPS_PER_REQUEST);
  await Promise.all(publicIps.map(resolveIp));
  return items.map((item) => ({ ...item, ...(cache.get(item.ip) ?? {}) }));
}

async function resolveIp(ip: string): Promise<void> {
  if (cache.has(ip)) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      cache.set(ip, null);
      return;
    }
    const payload = await response.json() as { success?: boolean; latitude?: number; longitude?: number; country?: string; city?: string };
    if (payload.success === false || !Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
      cache.set(ip, null);
      return;
    }
    cache.set(ip, { latitude: payload.latitude, longitude: payload.longitude, country: payload.country, city: payload.city });
  } catch {
    cache.set(ip, null);
  }
}

function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 0) return false;
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (isIP(ip) === 6) return true;
  const parts = ip.split(".").map(Number);
  return !(
    parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}
