import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { ServerOverview } from "../../types/protocol";

export function AccessIpMap({ items }: { items: ServerOverview["accessIps"] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map>();
  const layerRef = useRef<L.LayerGroup>();
  const located = items.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { zoomControl: true, attributionControl: true, minZoom: 2, worldCopyJump: true }).setView([24, 12], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    return () => { map.remove(); mapRef.current = undefined; layerRef.current = undefined; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (located.length === 0) return;
    const bounds: L.LatLngExpression[] = [];
    const maxRequests = Math.max(...located.map((item) => item.requests), 1);
    for (const item of located) {
      const point: L.LatLngExpression = [item.latitude!, item.longitude!];
      bounds.push(point);
      const radius = 6 + Math.sqrt(item.requests / maxRequests) * 12;
      L.circleMarker(point, { radius, color: "#dff4e6", weight: 1, fillColor: "#45ad7d", fillOpacity: 0.78 })
        .bindPopup(`<strong>${escapeHtml(item.ip)}</strong><br>${escapeHtml([item.city, item.country].filter(Boolean).join(", ") || "未知位置")}<br>${item.requests} 次请求`)
        .addTo(layer);
    }
    map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 6 });
  }, [items, located]);

  return <div className="access-map-wrap"><div ref={hostRef} className="access-map" />{located.length === 0 ? <div className="access-map-empty">暂无可定位的公网 IP</div> : null}</div>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}
