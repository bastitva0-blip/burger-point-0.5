// ─────────────────────────────────────────────────────────
//  DeliveryTracker.jsx
//  Premium Estimated Delivery Progress screen.
//  Uses Leaflet + OpenStreetMap (free, no API key).
//  Bike animates along stored road-geometry route.
// ─────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { Phone, ChevronDown, ChevronUp, MapPin, Clock, Package, CheckCircle } from "lucide-react";

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

  // Total length
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
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const etaMs = (etaMinutes || 30) * 60 * 1000;

  useEffect(() => {
    if (isDelivered) { setProgress(1); return; }
    if (!deliveryStartedAt) return;

    const started = new Date(deliveryStartedAt).getTime();

    const tick = () => {
      const elapsed = Date.now() - started;
      const p = Math.min(elapsed / etaMs, 0.96); // cap at 96% until delivered
      setProgress(p);
      if (p < 0.96) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [deliveryStartedAt, etaMs, isDelivered]);

  return progress;
}

// ── Bottom sheet ──────────────────────────────────────────
function BottomSheet({ order, riderName, riderPhone, etaMin, isDelivered, hasRider }) {
  const [expanded, setExpanded] = useState(false);
  const startY = useRef(null);

  const handleTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const handleTouchEnd   = (e) => {
    if (startY.current == null) return;
    const diff = startY.current - e.changedTouches[0].clientY;
    if (diff > 40)  setExpanded(true);
    if (diff < -40) setExpanded(false);
    startY.current = null;
  };

  const steps = [
    { label: "Order Confirmed",    done: true,  icon: "✓" },
    { label: "Preparing",          done: true,  icon: "✓" },
    { label: "Packed",             done: true,  icon: "✓" },
    { label: "Rider Assigned",     done: hasRider, icon: hasRider ? "🛵" : "" },
    { label: "Delivered",          done: isDelivered, icon: isDelivered ? "✓" : "" },
  ];

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-[1000] bg-white rounded-t-3xl shadow-2xl overflow-hidden"
      style={{ height: expanded ? "72vh" : "auto", transition: "height 0.25s ease-out" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="w-10 h-1 bg-stone-200 rounded-full" />
      </div>

      {/* Collapsed header */}
      <div className="px-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-2xl flex items-center justify-center text-xl">{hasRider ? "🛵" : "👨‍🍳"}</div>
          <div>
            <p className="font-black text-stone-800 text-sm">{hasRider ? (riderName || "Your Rider") : "Preparing your order"}</p>
            <p className="text-xs text-stone-400">
              {isDelivered ? "✅ Delivered!" : !hasRider ? "Rider not assigned yet" : etaMin != null ? `~${etaMin} min away` : "On the way"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasRider && riderPhone && (
            <a href={`tel:${riderPhone}`}
              className="w-10 h-10 bg-green-500 rounded-2xl flex items-center justify-center shadow-sm active:scale-95 transition-transform">
              <Phone size={16} className="text-white" />
            </a>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className="w-10 h-10 bg-stone-100 rounded-2xl flex items-center justify-center">
            {expanded ? <ChevronDown size={18} className="text-stone-500" /> : <ChevronUp size={18} className="text-stone-500" />}
          </button>
        </div>
      </div>

      {/* Expanded content — CSS opacity transition instead of AnimatePresence */}
      <div
        style={{
          opacity: expanded ? 1 : 0,
          maxHeight: expanded ? "calc(72vh - 100px)" : "0px",
          overflow: "auto",
          transition: "opacity 0.2s ease-out",
          padding: expanded ? "0 20px" : "0 20px",
        }}>
        {expanded && (
          <>
            {/* Delivery steps */}
            <div className="mb-5">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">Delivery Progress</p>
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-3 mb-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${s.done ? "bg-orange-500 text-white" : "bg-stone-100 text-stone-400"}`}>
                    {s.done ? s.icon || "✓" : ""}
                  </div>
                  <p className={`text-sm font-bold ${s.done ? "text-stone-800" : "text-stone-300"}`}>{s.label}</p>
                  {i === 3 && s.done && !isDelivered && (
                    <span className="ml-auto text-[10px] bg-orange-100 text-orange-600 font-bold px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
                  )}
                </div>
              ))}
            </div>

            {/* Order items */}
            <div className="bg-stone-50 rounded-2xl p-4 mb-4">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">Your Order</p>
              {order.items?.map((it, i) => (
                <div key={i} className="flex justify-between text-sm py-1.5 border-b border-stone-100 last:border-0">
                  <span className="text-stone-700 flex-1">
                    {it.name}{it.selectedVariant ? ` (${it.selectedVariant})` : ""} ×{it.qty}
                  </span>
                  <span className="text-stone-600 font-bold ml-3">₹{it.finalPrice * it.qty}</span>
                </div>
              ))}
              <div className="flex justify-between font-black text-sm pt-2 mt-1">
                <span>Total</span>
                <span className="text-orange-600">₹{order.total}</span>
              </div>
            </div>

            {/* Order meta */}
            <div className="space-y-2 mb-6">
              {order.delivery_address && (
                <div className="flex items-start gap-2 bg-blue-50 rounded-xl p-3">
                  <MapPin size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-stone-700">{order.delivery_address}</p>
                </div>
              )}
              {order.payment_method && (
                <div className="flex items-center gap-2 bg-green-50 rounded-xl p-3">
                  <span className="text-xs text-stone-500">💳 Paid via</span>
                  <span className="text-xs font-bold text-stone-700">{order.payment_method}</span>
                </div>
              )}
              {order.note && (
                <div className="bg-yellow-50 rounded-xl p-3">
                  <p className="text-xs text-stone-500 italic">📝 "{order.note}"</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Premium message by progress — aware of whether a rider is assigned yet ──
function getStatusMessage(progress, isDelivered, hasRider, orderStatus) {
  if (isDelivered) return { title: "Delivered! 🎉", sub: "Enjoy your meal ❤️" };
  if (!hasRider) {
    if (orderStatus === "ready") return { title: "Packed & ready 📦", sub: "Waiting for a rider to be assigned." };
    return { title: "Preparing your order 👨‍🍳", sub: "We'll show the live map once a rider is on the way." };
  }
  if (progress > 0.85) return { title: "Almost there! 🏁", sub: "Please keep your phone nearby." };
  if (progress > 0.5)  return { title: "On the way! 🛵", sub: "Your rider has left the restaurant." };
  return { title: "Your order is on the way 🍔", sub: "Your rider has picked up your order." };
}

// ── Main DeliveryTracker ──────────────────────────────────
export default function DeliveryTracker({ order, riderName, riderPhone, restaurantCoords, onNewOrder }) {
  const isDelivered = order.status === "served";
  const hasRider    = Boolean(riderName);

  const routeCoords   = useMemo(() => order.route_geometry || null, [order.route_geometry]);
  const etaMin        = useEtaCountdown(order.delivery_started_at, order.route_eta_minutes);
  const progress      = useRouteProgress(order.delivery_started_at, order.route_eta_minutes, isDelivered);
  const msg           = getStatusMessage(progress, isDelivered, hasRider, order.status);

  const restCoords = restaurantCoords || [26.926287, 80.942995];
  const custCoords = (order.customer_lat && order.customer_lng)
    ? [order.customer_lat, order.customer_lng] : null;

  const mapBounds = useMemo(() => {
    const pts = [restCoords];
    if (custCoords)  pts.push(custCoords);
    if (hasRider && routeCoords) pts.push(...routeCoords);
    return pts.length > 1 ? L.latLngBounds(pts) : null;
  }, [restCoords, custCoords, routeCoords, hasRider]);

  const center = custCoords
    ? [(restCoords[0] + custCoords[0]) / 2, (restCoords[1] + custCoords[1]) / 2]
    : restCoords;

  // Progress bar width
  const pct = Math.round(progress * 100);

  return (
    <div className="fixed inset-0 bg-stone-900 flex flex-col" style={{ zIndex: 9999 }}>

      {/* ── Hero Header ── */}
      <div
        className="flex-shrink-0 bg-gradient-to-r from-orange-500 to-red-600 text-white px-5 pt-10 pb-5 z-[1001]"
        style={{ animation: "dtSlideDown 0.3s ease-out" }}
      >
        <style>{`@keyframes dtSlideDown{from{opacity:0;transform:translateY(-30px)}to{opacity:1;transform:translateY(0)}}`}</style>
        <div className="max-w-lg mx-auto">
          <p key={msg.title} className="font-black text-2xl leading-tight" style={{ animation: "dtFadeIn 0.3s ease-out" }}>
            {msg.title}
          </p>
          <p key={msg.sub} className="text-orange-100 text-sm mt-1" style={{ animation: "dtFadeIn 0.3s ease-out 0.05s backwards" }}>
            {msg.sub}
          </p>
          <style>{`@keyframes dtFadeIn{from{opacity:0}to{opacity:1}}`}</style>

          {/* ETA + progress bar — only meaningful once a rider is moving */}
          {hasRider && (
            <div className="mt-4 flex items-center gap-4">
              <div className="bg-white/20 rounded-2xl px-4 py-2 flex items-center gap-2 flex-shrink-0">
                <Clock size={15} className="text-orange-200" />
                <span className="font-black text-xl text-white">
                  {isDelivered ? "Done" : etaMin != null ? `${etaMin} min` : "–"}
                </span>
              </div>
              <div className="flex-1">
                <div className="flex justify-between text-[10px] text-orange-200 mb-1">
                  <span>Restaurant</span><span>Your Door</span>
                </div>
                <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-white rounded-full" style={{ width: `${pct}%`, transition: "width 1s ease-out" }} />
                </div>
              </div>
            </div>
          )}
          {!hasRider && (
            <div className="mt-4 bg-white/15 rounded-2xl px-4 py-2.5 flex items-center gap-2">
              <span className="text-xs text-orange-100">🔎 Looking for a nearby rider to assign to your order…</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Map (65–70% of remaining screen) ── */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <MapContainer
          center={center}
          zoom={14}
          className="w-full h-full"
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© OpenStreetMap contributors'
          />

          {mapBounds && <MapFitter bounds={mapBounds} />}

          {/* Restaurant marker */}
          <Marker position={restCoords} icon={restaurantIcon} />

          {/* Customer marker */}
          {custCoords && <Marker position={custCoords} icon={customerIcon} />}

          {/* Road route + moving bike — only once a rider is actually assigned */}
          {hasRider && routeCoords && routeCoords.length > 1 && (
            <Polyline
              positions={routeCoords}
              pathOptions={{ color: "#f97316", weight: 5, opacity: 0.85 }}
            />
          )}
          {hasRider && routeCoords && (
            <BikeMarker coords={routeCoords} progress={progress} />
          )}

          {/* Fallback straight line if no route stored yet, once rider assigned */}
          {hasRider && !routeCoords && custCoords && (
            <Polyline
              positions={[restCoords, custCoords]}
              pathOptions={{ color: "#f97316", weight: 4, opacity: 0.6, dashArray: "8 6" }}
            />
          )}
        </MapContainer>

        {/* Map attribution overlay */}
        <div className="absolute bottom-36 right-2 z-[999] bg-white/80 text-[9px] text-stone-500 px-1.5 py-0.5 rounded">
          © OpenStreetMap
        </div>
      </div>

      {/* ── Bottom Sheet ── */}
      <div className="relative z-[1000]">
        <BottomSheet
          order={order}
          riderName={riderName}
          riderPhone={riderPhone}
          etaMin={etaMin}
          isDelivered={isDelivered}
          hasRider={hasRider}
        />
      </div>

      {/* ── Delivered CTA ── */}
      {isDelivered && (
        <div
          className="absolute bottom-0 left-0 right-0 z-[1002] bg-white px-5 pb-8 pt-4 rounded-t-3xl shadow-2xl"
          style={{ animation: "dtSlideUp 0.3s ease-out" }}
        >
          <style>{`@keyframes dtSlideUp{from{transform:translateY(200px)}to{transform:translateY(0)}}`}</style>
          <p className="text-center text-3xl mb-2">🎉</p>
          <p className="text-center font-black text-stone-800 text-xl mb-1">Delivered!</p>
          <p className="text-center text-stone-500 text-sm mb-5">Enjoy your meal ❤️</p>
          <button onClick={onNewOrder}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-transform">
            🛒 Order Again
          </button>
        </div>
      )}
    </div>
  );
}
