// ─────────────────────────────────────────────────────────
//  DeliveryTracker.jsx
//  Premium Estimated Delivery Progress screen.
//  Uses Leaflet + OpenStreetMap (free, no API key).
//  Bike animates along stored road-geometry route.
// ─────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { Phone, ChevronDown, ChevronUp, MapPin, Clock, Package, CheckCircle, Maximize2, Minimize2 } from "lucide-react";

// ── Fix Leaflet default icon paths (Vite breaks them) ─────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── Custom icons ──────────────────────────────────────────
const restaurantIcon = L.divIcon({
  className: "",
  html: `<div style="width:38px;height:38px;background:linear-gradient(135deg,#f97316,#ef4444);border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center">
    <span style="transform:rotate(45deg);font-size:16px">🍔</span>
  </div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
});

const customerIcon = L.divIcon({
  className: "",
  html: `<div style="width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#6366f1);border-radius:50%;border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:18px">🏠</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const bikeIcon = L.divIcon({
  className: "",
  html: `<div style="width:44px;height:44px;background:white;border-radius:50%;border:3px solid #f97316;box-shadow:0 4px 15px rgba(249,115,22,0.5);display:flex;align-items:center;justify-content:center;font-size:22px;animation:pulse 1.5s infinite">🛵</div>
  <style>@keyframes pulse{0%,100%{box-shadow:0 4px 15px rgba(249,115,22,0.5)}50%{box-shadow:0 4px 25px rgba(249,115,22,0.9)}}</style>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

// ── Interpolate position along route ──────────────────────
function interpolateRoute(coords, progress) {
  if (!coords || coords.length < 2) return coords?.[0] ?? [26.89, 80.94];
  const p = Math.max(0, Math.min(1, progress));
  if (p >= 1) return coords[coords.length - 1];

  let total = 0;
  const segs = [];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    const d  = Math.sqrt(dx * dx + dy * dy);
    segs.push(d);
    total += d;
  }

  let target = p * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const t = target / segs[i];
      return [
        coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
        coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
      ];
    }
    target -= segs[i];
  }
  return coords[coords.length - 1];
}

// ── Map auto-fit component ────────────────────────────────
function MapFitter({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [60, 60] });
  }, [map, bounds]);
  return null;
}

// ── Moving bike marker ────────────────────────────────────
function BikeMarker({ coords, progress }) {
  const pos = useMemo(() => interpolateRoute(coords, progress), [coords, progress]);
  return <Marker position={pos} icon={bikeIcon} />;
}

// ── ETA countdown hook ────────────────────────────────────
function useEtaCountdown(deliveryStartedAt, etaMinutes) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!deliveryStartedAt || !etaMinutes) return;
    const update = () => {
      const started  = new Date(deliveryStartedAt).getTime();
      const etaMs    = etaMinutes * 60 * 1000;
      const elapsed  = Date.now() - started;
      const leftMs   = Math.max(0, etaMs - elapsed);
      setRemaining(Math.ceil(leftMs / 60000));
    };
    update();
    const t = setInterval(update, 15000);
    return () => clearInterval(t);
  }, [deliveryStartedAt, etaMinutes]);

  return remaining;
}

// ── Progress along route (0→1) ────────────────────────────
function useRouteProgress(deliveryStartedAt, etaMinutes, isDelivered) {
  const [progress, setProgress] = useState(0);
