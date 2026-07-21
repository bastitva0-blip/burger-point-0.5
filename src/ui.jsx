// ─────────────────────────────────────────────────────────
//  ui.jsx — Burger Point Shared UI Primitives
//  Toast notifications · Skeleton loaders · Saved addresses
// ─────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, MapPin, Navigation } from "lucide-react";

// ══════════════════════════════════════════════════════════
//  TOAST SYSTEM
// ══════════════════════════════════════════════════════════

const ToastContext = createContext(null);

let _addToast = null; // module-level so non-React code can call toast()

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const remove = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const add = useCallback((message, type = "info", duration = 3500) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5 stacked
    timers.current[id] = setTimeout(() => remove(id), duration);
    return id;
  }, [remove]);

  // Expose globally so non-React code (e.g. event handlers) can call toast()
  useEffect(() => { _addToast = add; return () => { _addToast = null; }; }, [add]);

  const ICONS = {
    success: <CheckCircle size={15} className="flex-shrink-0 text-green-500" />,
    error:   <AlertCircle  size={15} className="flex-shrink-0 text-red-500" />,
    warning: <AlertTriangle size={15} className="flex-shrink-0 text-amber-500" />,
    info:    <Info          size={15} className="flex-shrink-0 text-blue-500" />,
  };

  const BG = {
    success: "bg-white border-l-4 border-green-500",
    error:   "bg-white border-l-4 border-red-500",
    warning: "bg-white border-l-4 border-amber-500",
    info:    "bg-white border-l-4 border-blue-500",
  };

  return (
    <ToastContext.Provider value={add}>
      {children}
      {/* Toast container — top of screen, safe z-index above modals */}
      <div className="fixed top-4 left-0 right-0 z-[200] flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t, i) => (
          <div
            key={t.id}
            className={`
              ${BG[t.type] || BG.info}
              w-full max-w-sm rounded-xl shadow-lg px-4 py-3
              flex items-center gap-3
              pointer-events-auto
              toast-enter
            `}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            {ICONS[t.type] || ICONS.info}
            <p className="flex-1 text-sm font-medium text-stone-800 leading-snug">{t.message}</p>
            <button
              onClick={() => remove(t.id)}
              className="flex-shrink-0 text-stone-400 hover:text-stone-600 transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Hook — use inside React components */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside <ToastProvider>");
  return {
    success: (msg, d) => ctx(msg, "success", d),
    error:   (msg, d) => ctx(msg, "error",   d),
    warning: (msg, d) => ctx(msg, "warning", d),
    info:    (msg, d) => ctx(msg, "info",    d),
  };
}

/** Global imperative toast — works outside React trees */
export const toast = {
  success: (msg, d) => _addToast?.(msg, "success", d),
  error:   (msg, d) => _addToast?.(msg, "error",   d),
  warning: (msg, d) => _addToast?.(msg, "warning", d),
  info:    (msg, d) => _addToast?.(msg, "info",    d),
};

// ══════════════════════════════════════════════════════════
//  SKELETON LOADERS
// ══════════════════════════════════════════════════════════

/** Base shimmer block */
export function Shimmer({ className = "" }) {
  return (
    <div className={`relative overflow-hidden bg-stone-100 rounded-xl ${className}`}>
      <div className="shimmer-wave absolute inset-0" />
    </div>
  );
}

/** Skeleton for a single menu item card */
export function MenuItemSkeleton() {
  return (
    <div className="flex gap-3 py-4 border-b border-stone-100">
      <Shimmer className="w-20 h-20 flex-shrink-0 rounded-2xl" />
      <div className="flex-1 space-y-2 pt-1">
        <Shimmer className="h-4 w-3/4 rounded-lg" />
        <Shimmer className="h-3 w-1/2 rounded-lg" />
        <Shimmer className="h-5 w-16 rounded-lg" />
      </div>
      <div className="flex-shrink-0 self-center">
        <Shimmer className="w-16 h-9 rounded-xl" />
      </div>
    </div>
  );
}

/** Skeleton for menu list (N items) */
export function MenuSkeleton({ count = 5 }) {
  return (
    <div>
      {/* Category hero */}
      <Shimmer className="h-28 w-full rounded-2xl mb-4 mt-3" />
      {Array.from({ length: count }).map((_, i) => (
        <MenuItemSkeleton key={i} />
      ))}
    </div>
  );
}

/** Skeleton for category bar */
export function CategoryBarSkeleton() {
  return (
    <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Shimmer key={i} className="h-8 flex-shrink-0 rounded-xl" style={{ width: `${60 + i * 10}px` }} />
      ))}
    </div>
  );
}

/** Skeleton for bestseller row */
export function BestsellerSkeleton() {
  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-28">
            <Shimmer className="w-28 h-[72px] rounded-2xl mb-1" />
            <Shimmer className="h-3 w-20 rounded-md mb-1" />
            <Shimmer className="h-3 w-12 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for cart drawer items */
export function CartItemSkeleton() {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-stone-50">
      <Shimmer className="w-12 h-12 flex-shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Shimmer className="h-3 w-3/4 rounded" />
        <Shimmer className="h-3 w-1/3 rounded" />
      </div>
      <Shimmer className="w-20 h-8 rounded-xl" />
    </div>
  );
}

/** Skeleton for admin order card */
export function OrderCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden mb-3 p-4">
      <div className="flex items-center gap-3">
        <Shimmer className="w-8 h-8 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-4 w-2/3 rounded" />
          <Shimmer className="h-3 w-1/2 rounded" />
        </div>
        <Shimmer className="w-16 h-6 rounded-full" />
      </div>
    </div>
  );
}

/** Skeleton for admin sales analytics */
export function SalesSkeleton() {
  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-white rounded-2xl p-4 border border-stone-100">
            <Shimmer className="h-6 w-16 rounded mb-2" />
            <Shimmer className="h-3 w-12 rounded" />
          </div>
        ))}
      </div>
      {/* Chart */}
      <div className="bg-white rounded-2xl p-4 border border-stone-100">
        <Shimmer className="h-4 w-32 rounded mb-4" />
        <div className="flex items-end gap-2 h-28">
          {[60, 45, 80, 35, 90, 55, 70].map((h, i) => (
            <Shimmer key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Skeleton for rider dashboard */
export function RiderCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-3">
      <div className="flex items-center gap-3 mb-3">
        <Shimmer className="w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-4 w-1/2 rounded" />
          <Shimmer className="h-3 w-1/3 rounded" />
        </div>
        <Shimmer className="w-20 h-7 rounded-xl" />
      </div>
      <Shimmer className="h-10 w-full rounded-xl" />
    </div>
  );
}

/** Skeleton for order tracker */
export function TrackerSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <Shimmer className="h-40 w-full rounded-none" />
      <div className="px-5 py-6 space-y-6">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-start gap-4">
            <Shimmer className="w-10 h-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <Shimmer className="h-4 w-1/2 rounded" />
              <Shimmer className="h-3 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Admin customer table skeleton */
export function CustomerRowSkeleton() {
  return (
    <div className="bg-stone-50 rounded-2xl px-4 py-3 mb-2 flex items-center gap-3">
      <Shimmer className="w-8 h-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Shimmer className="h-3 w-1/3 rounded" />
        <Shimmer className="h-3 w-1/4 rounded" />
      </div>
      <Shimmer className="w-12 h-5 rounded-full" />
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  SAVED DELIVERY ADDRESSES
// ══════════════════════════════════════════════════════════

const LS_ADDRS = "bp_saved_addresses";
const MAX_ADDRS = 3;

export function useSavedAddresses() {
  const [addresses, setAddresses] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_ADDRS) || "[]"); } catch { return []; }
  });

  const save = useCallback((addr) => {
    // addr = { label, house, floor, street, landmark, lat, lng, fullAddress }
    setAddresses(prev => {
      // Deduplicate by fullAddress
      const filtered = prev.filter(a => a.fullAddress !== addr.fullAddress);
      const next = [addr, ...filtered].slice(0, MAX_ADDRS);
      localStorage.setItem(LS_ADDRS, JSON.stringify(next));
      return next;
    });
  }, []);

  const remove = useCallback((fullAddress) => {
    setAddresses(prev => {
      const next = prev.filter(a => a.fullAddress !== fullAddress);
      localStorage.setItem(LS_ADDRS, JSON.stringify(next));
      return next;
    });
  }, []);

  return { addresses, save, remove };
}

/** Saved Address Picker — shown inside CustomerInfoForm */
export function SavedAddressPicker({ addresses, onSelect, onRemove }) {
  if (!addresses.length) return null;
  return (
    <div className="mb-3">
      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2 flex items-center gap-1">
        <MapPin size={9} /> Saved Addresses
      </p>
      <div className="space-y-2">
        {addresses.map((a, i) => (
          <div
            key={i}
            className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2.5 group"
          >
            <div className="w-7 h-7 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 text-sm">
              {i === 0 ? "🏠" : i === 1 ? "🏢" : "📍"}
            </div>
            <button
              className="flex-1 text-left min-w-0"
              onClick={() => onSelect(a)}
            >
              {a.label && (
                <p className="text-xs font-bold text-stone-700 truncate">{a.label}</p>
              )}
              <p className="text-[11px] text-stone-500 truncate leading-tight">{a.fullAddress}</p>
              {a.lat && a.lng && (
                <p className="text-[10px] text-green-600 mt-0.5 flex items-center gap-0.5">
                  <Navigation size={8} /> Location saved
                </p>
              )}
            </button>
            <button
              onClick={() => onRemove(a.fullAddress)}
              className="text-stone-300 hover:text-red-400 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
