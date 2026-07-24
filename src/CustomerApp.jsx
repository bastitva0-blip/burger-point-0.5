import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search, X, Plus, Minus, ArrowLeft, ShoppingCart, MapPin, Phone,
  CheckCircle, User, Navigation, CreditCard, Smartphone, Download,
  Heart, Clock, Star, Share2, History, RefreshCw, Wifi, WifiOff,
  Bike, Shield, Trash2, Tag, ThumbsUp, ThumbsDown, CalendarDays,
} from "lucide-react";

import {
  useToast, MenuSkeleton, CategoryBarSkeleton, BestsellerSkeleton,
  CartItemSkeleton, useSavedAddresses, SavedAddressPicker,
} from "./ui.jsx";
import { supabase } from "./supabase.js";
import {
  CATEGORIES, DEFAULT_MENU, ALL_ITEMS, SUPABASE_READY,
  clearTableSession, getTrackerSteps, STATUS_CFG,
  REVIEW_URL, WHATSAPP, INSTAGRAM,
} from "./constants.js";
import { haversineKm, calculateDelivery } from "./deliveryUtils.js";
import { useBusinessSettings } from "./useBusinessSettings.js";
import { lazy, Suspense } from "react";
const DeliveryTracker = lazy(() => import("./DeliveryTracker.jsx"));

// ── helpers ───────────────────────────────────────────────
function useAppUpdateAvailable() {
  const [available, setAvailable] = useState(typeof window !== "undefined" && !!window.__bpUpdateAvailable);
  useEffect(() => {
    if (window.__bpUpdateAvailable) { setAvailable(true); return; }
    const handler = () => setAvailable(true);
    window.addEventListener("bp:update-available", handler);
    return () => window.removeEventListener("bp:update-available", handler);
  }, []);
  return available;
}

const LS_FAVS        = "bp_favs";
const LS_HISTORY     = "bp_order_history";
const SS_ORDER       = "bp_placed_order";
const LS_ACTIVE_ORDER = "bp_active_order";   // persists across browser close
const LS_BESTSELLERS  = "bp_bestsellers";    // cached bestseller IDs
const LS_CUSTOMER    = "bp_customer";        // saved name + phone
const ACTIVE_STATUSES = new Set(["pending", "accepted", "ready", "dispatched"]);
const SS_WAIT    = "bp_wait_times";

const saveHistory = (order) => {
  try {
    const list = JSON.parse(localStorage.getItem(LS_HISTORY) || "[]");
    list.unshift(order);
    localStorage.setItem(LS_HISTORY, JSON.stringify(list.slice(0, 12)));
  } catch {}
};

// ── SHARED ITEM THUMBNAIL ─────────────────────────────────
export function ItemThumb({ item, className = "w-16 h-16", children }) {
  const [err, setErr] = useState(false);
  const cat = CATEGORIES.find(c => c.id === item.category);
  return (
    <div className={`${className} rounded-2xl flex-shrink-0 overflow-hidden bg-orange-50 relative`}>
      {!err && item.img
        ? <img src={item.img} alt={item.name} loading="lazy" className="w-full h-full object-cover" onError={() => setErr(true)} />
        : <div className="w-full h-full flex items-center justify-center text-2xl bg-gradient-to-br from-orange-100 to-amber-100">{cat?.emoji || "🍽️"}</div>
      }
      {children}
    </div>
  );
}

// ── BESTSELLER BADGE ──────────────────────────────────────
function BestsellerBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 bg-gradient-to-r from-orange-500 to-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-sm tracking-wide">
      🔥 Bestseller
    </span>
  );
}

// ── ITEM CARD ─────────────────────────────────────────────
function ItemCard({ item, cartQty, onAdd, onQtyChange, isFav, onToggleFav, isBestseller }) {
  const unavail = item.is_available === false;
  const [popping, setPopping] = useState(false);
  const handleAdd = () => {
    setPopping(true);
    setTimeout(() => setPopping(false), 200);
    onAdd(item);
  };
  return (
    <div className={`flex gap-3 py-4 border-b border-stone-100 last:border-0 ${unavail ? "opacity-50" : ""}`}>
      <ItemThumb item={item} className="w-20 h-20">
        <span className="absolute top-1 right-1 w-4 h-4 border-2 border-green-600 rounded-sm bg-white flex items-center justify-center">
          <span className="w-2 h-2 rounded-full bg-green-600" />
        </span>
      </ItemThumb>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1">
          <p className="text-sm font-bold text-stone-800 leading-tight flex-1">{item.name}</p>
          <button onClick={() => onToggleFav(item.id)} className="p-0.5 flex-shrink-0">
            <Heart size={14} className={isFav ? "fill-red-500 text-red-500" : "text-stone-300"} />
          </button>
        </div>
        {isBestseller && <div className="mt-1"><BestsellerBadge /></div>}
        {item.description && <p className="text-[11px] text-stone-400 mt-0.5 leading-snug line-clamp-2">{item.description}</p>}
        <div className="flex items-center gap-1 mt-1">
          <p className="text-sm font-black text-stone-800">₹{item.price}</p>
          {item.variants && <span className="text-xs text-stone-400 ml-1">onwards</span>}
        </div>
        {item.variants && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {item.variants.map((v, i) => (
              <span key={i} className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-md font-medium">{v.label} ₹{v.price}</span>
            ))}
          </div>
        )}
        {item.addons?.length > 0 && (
          <p className="text-[10px] text-orange-500 mt-1">+ Customisable</p>
        )}
      </div>
      {unavail ? (
        <span className="self-center text-[10px] bg-stone-100 text-stone-400 font-bold px-2 py-1 rounded-xl flex-shrink-0">Sold Out</span>
      ) : cartQty > 0 && !item.variants ? (
        <div className="self-center flex items-center gap-1 bg-orange-500 rounded-xl px-2 py-1.5 flex-shrink-0 shadow-md">
          <button onClick={() => onQtyChange(cartQty - 1)} className="w-7 h-7 flex items-center justify-center"><Minus size={12} className="text-white" /></button>
          <span className="text-xs font-black text-white w-4 text-center">{cartQty}</span>
          <button onClick={() => onQtyChange(cartQty + 1)} className="w-7 h-7 flex items-center justify-center"><Plus size={12} className="text-white" /></button>
        </div>
      ) : (
        <button onClick={handleAdd}
          className={`self-center flex items-center gap-1 bg-white border-2 border-orange-400 text-orange-600 px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all hover:bg-orange-500 hover:text-white flex-shrink-0 relative ${popping ? "add-pop" : ""}`}>
          <Plus size={12} /> ADD
          {cartQty > 0 && item.variants && (
            <span className="absolute -top-2 -right-2 bg-orange-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">{cartQty}</span>
          )}
        </button>
      )}
    </div>
  );
}

// ── ITEM MODAL (variant + addons + spice) ─────────────────
function ItemModal({ item, onClose, onAdd }) {
  const [selVariant, setSelVariant] = useState(0);
  const [qty, setQty]               = useState(1);
  const [selAddons, setSelAddons]   = useState([]);  // ids of toggled addons
  const [spice, setSpice]           = useState("Medium");

  const hasVariants = item.variants?.length > 0;
  const addons = item.addons || [];
  const spiceAddon = addons.find(a => a.type === "select" && a.id === "spice");
  const toggleAddons = addons.filter(a => a.type !== "select" || a.id !== "spice");

  const chosen      = hasVariants ? item.variants[selVariant] : null;
  const basePrice   = chosen ? chosen.price : item.price;
  const addonTotal  = toggleAddons.filter(a => selAddons.includes(a.id)).reduce((s, a) => s + (a.price || 0), 0);
  const finalPrice  = basePrice + addonTotal;

  const toggleAddon = (id) =>
    setSelAddons(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleAdd = () => {
    const addonLabels = [
      ...toggleAddons.filter(a => selAddons.includes(a.id)).map(a => `${a.label}${a.price ? ` +₹${a.price}` : ""}`),
      spiceAddon ? `${spice} 🌶` : "",
    ].filter(Boolean);

    onAdd({
      ...item,
      selectedVariant: chosen?.label || null,
      finalPrice,
      qty,
      addonLabels,
      spiceLevel: spiceAddon ? spice : null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-w-xl mx-auto" onClick={e => e.stopPropagation()}
        style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mt-3 mb-4 flex-shrink-0" />

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <ItemThumb item={item} className="w-16 h-16" />
            <div className="flex-1">
              <h3 className="font-bold text-stone-800 text-base">{item.name}</h3>
              {item.description && <p className="text-xs text-stone-400 mt-0.5 leading-snug">{item.description}</p>}
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0">
              <X size={14} className="text-stone-500" />
            </button>
          </div>

          {/* Variants */}
          {hasVariants && (
            <div className="mb-4">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Choose Size</p>
              <div className="flex gap-2">
                {item.variants.map((v, i) => (
                  <button key={i} onClick={() => setSelVariant(i)}
                    className={`flex-1 py-3 rounded-2xl text-sm font-bold border-2 transition-all ${selVariant === i ? "border-orange-500 bg-orange-50 text-orange-700" : "border-stone-200 text-stone-500"}`}>
                    {v.label}<div className="text-xs font-medium mt-0.5">₹{v.price}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Spice level */}
          {spiceAddon && (
            <div className="mb-4">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">🌶 Spice Level</p>
              <div className="flex gap-2">
                {(spiceAddon.options || ["Mild", "Medium", "Extra Hot"]).map(opt => (
                  <button key={opt} onClick={() => setSpice(opt)}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-all ${spice === opt ? "border-red-500 bg-red-50 text-red-700" : "border-stone-200 text-stone-500"}`}>
                    {opt === "Mild" ? "😊 Mild" : opt === "Medium" ? "🌶 Medium" : "🔥 Extra Hot"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toggle addons */}
          {toggleAddons.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Add Extras</p>
              <div className="space-y-2">
                {toggleAddons.map(a => (
                  <button key={a.id} onClick={() => toggleAddon(a.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${selAddons.includes(a.id) ? "border-orange-400 bg-orange-50" : "border-stone-100 bg-stone-50"}`}>
                    <span className="text-sm font-medium text-stone-700">{a.label}</span>
                    <div className="flex items-center gap-2">
                      {a.price > 0 && <span className="text-xs text-orange-600 font-bold">+₹{a.price}</span>}
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selAddons.includes(a.id) ? "bg-orange-500 border-orange-500" : "border-stone-300"}`}>
                        {selAddons.includes(a.id) && <CheckCircle size={12} className="text-white" />}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-6 pt-3 border-t border-stone-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 bg-stone-100 rounded-2xl px-4 py-2.5">
              <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-8 h-8 flex items-center justify-center"><Minus size={14} className="text-stone-600" /></button>
              <span className="text-sm font-black text-stone-800 w-5 text-center">{qty}</span>
              <button onClick={() => setQty(q => q + 1)} className="w-8 h-8 flex items-center justify-center"><Plus size={14} className="text-stone-600" /></button>
            </div>
            <button onClick={handleAdd}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 text-white py-3.5 rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-transform">
              Add — ₹{finalPrice * qty}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CART DRAWER ───────────────────────────────────────────
function CartDrawer({ cart, tableLabel, orderType, customerInfo, settings, onClose, onQty, onRemove, onPlace, unavailableIds = new Set(), validationError = null }) {
  const [note, setNote]           = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo]         = useState(null);
  const [promoErr, setPromoErr]   = useState("");
  const [applying, setApplying]   = useState(false);

  const subtotal = cart.reduce((s, i) => s + i.finalPrice * i.qty, 0);
  const discount = promo
    ? promo.discount_type === "percent"
      ? Math.min(Math.round(subtotal * promo.discount_value / 100), promo.max_discount || 9999)
      : promo.discount_value
    : 0;
  const afterDiscount = Math.max(0, subtotal - discount);

  const [roadDistanceKm, setRoadDistanceKm] = useState(null);
  const [fetchingDist,   setFetchingDist]   = useState(false);

  // Fetch actual road distance from OSRM whenever customer location changes
  useEffect(() => {
    if (orderType !== "delivery" || !customerInfo?.lat || !customerInfo?.lng) return;
    const rLat = settings.restaurant_lat || 26.926287;
    const rLng = settings.restaurant_lng || 80.942995;
    setFetchingDist(true);
    fetch(`https://router.project-osrm.org/route/v1/driving/${rLng},${rLat};${customerInfo.lng},${customerInfo.lat}?overview=false`)
      .then(r => r.json())
      .then(d => {
        const km = d.routes?.[0]?.distance / 1000;
        setRoadDistanceKm(km ?? null);
      })
      .catch(() => {
        // Fallback to haversine if OSRM fails
        setRoadDistanceKm(haversineKm(rLat, rLng, customerInfo.lat, customerInfo.lng));
      })
      .finally(() => setFetchingDist(false));
  }, [customerInfo?.lat, customerInfo?.lng, orderType, settings.restaurant_lat, settings.restaurant_lng]);

  const distanceKm = roadDistanceKm;
  const deliveryCalc = orderType === "delivery" ? calculateDelivery(distanceKm, afterDiscount, settings) : null;
  const deliveryFee  = deliveryCalc?.deliverable ? deliveryCalc.fee : 0;
  const packingCharge = orderType !== "dine-in" ? (settings.packing_charge || 0) : 0;
  const gstAmount = Math.round(afterDiscount * (settings.gst_percent || 0) / 100);
  const total = afterDiscount + deliveryFee + packingCharge + gstAmount;

  const belowMinOrder = settings.min_order_value > 0 && subtotal < settings.min_order_value;
  const blockedByDeliveryRadius = orderType === "delivery" && deliveryCalc && deliveryCalc.deliverable === false;
  const canPlace = !belowMinOrder && !blockedByDeliveryRadius;

  const typeLabel = orderType === "delivery" ? "🛵 Delivery" : orderType === "takeaway" ? "📦 Takeaway" : null;

  const applyPromo = async () => {
    if (!promoCode.trim()) return;
    setApplying(true); setPromoErr("");
    if (!SUPABASE_READY) { setPromoErr("Promo codes not available."); setApplying(false); return; }
    const { data, error } = await supabase.from("coupons")
      .select("*").eq("code", promoCode.trim().toUpperCase()).eq("is_active", true).single();
    setApplying(false);
    if (error || !data) { setPromoErr("Invalid or expired code."); return; }
    if (data.min_order && subtotal < data.min_order) { setPromoErr(`Minimum order ₹${data.min_order} required.`); return; }
    if (data.expiry && new Date(data.expiry) < new Date()) { setPromoErr("This code has expired."); return; }
    setPromo(data);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-w-xl mx-auto flex flex-col" style={{ maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mt-3 flex-shrink-0" />
        <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-bold text-stone-800 text-base flex items-center gap-2">
            <ShoppingCart size={18} className="text-orange-500" /> Your Cart
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] bg-orange-100 text-orange-700 font-bold px-2 py-1 rounded-lg">{tableLabel || typeLabel || "Menu"}</span>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-stone-100 flex items-center justify-center"><X size={14} className="text-stone-500" /></button>
          </div>
        </div>
        {customerInfo && (
          <div className="px-5 py-2 bg-orange-50 border-b border-orange-100 flex-shrink-0 flex items-center gap-2">
            <User size={13} className="text-orange-500" />
            <span className="text-xs font-bold text-stone-700">{customerInfo.name}</span>
            <span className="text-[11px] text-stone-400">{customerInfo.phone}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {/* Feature 8: unavailability warning */}
          {(() => {
            const affected = cart.filter(it => unavailableIds.has(it.id));
            if (!affected.length) return null;
            return (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 mb-3">
                {affected.map(it => (
                  <p key={it.id} className="text-xs font-bold text-amber-800">⚠️ {it.name} is no longer available — please remove it before ordering.</p>
                ))}
              </div>
            );
          })()}
          {/* Items */}
          {cart.map((item, i) => (
            <div key={i} className={`flex items-start gap-3 py-3 border-b border-stone-50 last:border-0 ${unavailableIds.has(item.id) ? "bg-red-50 rounded-xl px-2 border-red-200 border" : ""}`}>
              <ItemThumb item={item} className="w-12 h-12" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-stone-800 leading-tight">{item.name}</p>
                {item.selectedVariant && <p className="text-xs text-stone-400">{item.selectedVariant}</p>}
                {item.addonLabels?.length > 0 && (
                  <p className="text-[11px] text-orange-500 mt-0.5">{item.addonLabels.join(" · ")}</p>
                )}
                <p className="text-xs font-bold text-orange-600 mt-0.5">₹{item.finalPrice}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <button onClick={() => onRemove(i)} className="text-stone-300 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                <div className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 rounded-xl px-2 py-1">
                  <button onClick={() => onQty(i, item.qty - 1)} className="w-6 h-6 flex items-center justify-center"><Minus size={11} className="text-stone-600" /></button>
                  <span className="text-xs font-black text-stone-800 w-4 text-center">{item.qty}</span>
                  <button onClick={() => onQty(i, item.qty + 1)} className="w-6 h-6 flex items-center justify-center"><Plus size={11} className="text-stone-600" /></button>
                </div>
              </div>
            </div>
          ))}

          {/* Note */}
          <div className="mt-4">
            <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Special Instructions</p>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Less spicy, no onion, extra sauce…"
              className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-2xl p-3 resize-none h-16 outline-none focus:border-orange-400 transition-colors" />
          </div>

          {/* Promo code */}
          <div className="mt-4">
            <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2 flex items-center gap-1"><Tag size={10} /> Promo Code</p>
            {promo ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
                <div>
                  <p className="text-xs font-bold text-green-700">🎉 "{promo.code}" applied!</p>
                  <p className="text-xs text-green-600">You saved ₹{discount}</p>
                </div>
                <button onClick={() => { setPromo(null); setPromoCode(""); }} className="text-xs text-stone-400 hover:text-red-500"><X size={14} /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input value={promoCode} onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoErr(""); }}
                  placeholder="Enter code (e.g. BURGER10)"
                  className="flex-1 text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700 uppercase font-mono" />
                <button onClick={applyPromo} disabled={applying || !promoCode.trim()}
                  className="bg-orange-500 text-white text-xs font-bold px-4 rounded-xl disabled:opacity-50">
                  {applying ? "…" : "Apply"}
                </button>
              </div>
            )}
            {promoErr && <p className="text-red-500 text-xs mt-1">{promoErr}</p>}
          </div>

          {/* Bill */}
          <div className="mt-4 bg-orange-50 rounded-2xl p-4 border border-orange-100">
            <div className="flex justify-between text-sm text-stone-600 mb-1">
              <span>Subtotal</span><span>₹{subtotal}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-green-600 mb-1">
                <span>Discount ({promo.code})</span><span>−₹{discount}</span>
              </div>
            )}
            {orderType === "delivery" && deliveryCalc?.deliverable && (
              <div className="flex justify-between text-sm text-stone-600 mb-1">
                <span>Delivery {fetchingDist ? "(checking…)" : deliveryCalc.distanceKm != null ? `(${deliveryCalc.distanceKm.toFixed(1)} km road)` : ""}</span>
                <span>{deliveryCalc.freeDelivery ? "FREE" : `₹${deliveryFee}`}</span>
              </div>
            )}
            {packingCharge > 0 && (
              <div className="flex justify-between text-sm text-stone-600 mb-1">
                <span>Packing Charge</span><span>₹{packingCharge}</span>
              </div>
            )}
            {gstAmount > 0 && (
              <div className="flex justify-between text-sm text-stone-600 mb-1">
                <span>GST ({settings.gst_percent}%)</span><span>₹{gstAmount}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-stone-800 border-t border-orange-100 pt-2 mt-1">
              <span>Total</span><span className="text-orange-600">₹{total}</span>
            </div>
          </div>

          {blockedByDeliveryRadius && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-600">{deliveryCalc.reason}</div>
          )}
          {belowMinOrder && !blockedByDeliveryRadius && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-700">
              Minimum order is ₹{settings.min_order_value} — add ₹{settings.min_order_value - subtotal} more to continue.
            </div>
          )}
          <div className="h-4" />
        </div>

        <div className="px-5 pb-6 pt-3 border-t border-stone-100 flex-shrink-0">
          {validationError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-3 text-xs text-red-700 font-medium">{validationError}</div>
          )}
          <button onClick={() => onPlace({ note, total, discount, promoCode: promo?.code, deliveryFee, packingCharge, gstAmount, distanceKm: deliveryCalc?.distanceKm ?? null })}
            disabled={!canPlace}
            className="w-full bg-gradient-to-r from-orange-500 to-red-600 text-white py-4 rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-transform disabled:opacity-40 disabled:pointer-events-none">
            🍔 Place Order · ₹{total}
          </button>
          <p className="text-center text-[10px] text-stone-400 mt-2">Order sent directly to kitchen</p>
        </div>
      </div>
    </div>
  );
}

// ── REAL RAZORPAY MODAL ───────────────────────────────────
const RZP_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || "";

function RazorpayModal({ amount, customerName, customerPhone, onSuccess, onClose, onCancel }) {
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");
  const [failed,  setFailed]  = useState(false);

  const loadScript = () =>
    new Promise(resolve => {
      if (window.Razorpay) { resolve(true); return; }
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload  = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });

  const openRazorpay = async () => {
    setLoading(true); setErr(""); setFailed(false);
    const ok = await loadScript();
    setLoading(false);
    if (!ok) { setErr("Could not load Razorpay. Check your internet and try again."); return; }

    const options = {
      key: RZP_KEY_ID,
      amount: amount * 100,
      currency: "INR",
      name: "Burger Point",
      description: "Food Order",
      prefill: { name: customerName || "", contact: customerPhone || "" },
      theme: { color: "#f97316" },
      handler: (response) => onSuccess(response.razorpay_payment_id),
      modal: { ondismiss: () => setLoading(false) },
    };

    const rzp = new window.Razorpay(options);
    rzp.on("payment.failed", (resp) => {
      setFailed(true);
      setErr("Payment failed: " + (resp.error?.description || "Please try again."));
    });
    rzp.open();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full bg-white rounded-t-3xl max-w-lg mx-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-5" />
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <span className="text-white font-black text-base">R</span>
          </div>
          <div>
            <p className="font-black text-stone-800">Burger Point</p>
            <p className="text-xs text-stone-400">Secured by Razorpay · 256-bit SSL</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-stone-400">Total</p>
            <p className="font-black text-stone-900 text-xl">₹{amount}</p>
          </div>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-4">
            <p className="text-sm font-bold text-red-600 mb-1">❌ {failed ? "Payment Failed" : "Error"}</p>
            <p className="text-xs text-red-500">{err}</p>
          </div>
        )}

        <button onClick={openRazorpay} disabled={loading}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-2xl font-bold text-sm shadow-md active:scale-95 transition-transform disabled:opacity-60 flex items-center justify-center gap-2 mb-3">
          {loading
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Loading…</>
            : failed ? <>🔄 Try Again</> : <>💳 Pay ₹{amount} Online</>}
        </button>

        <button onClick={onClose}
          className="w-full border-2 border-dashed border-stone-200 text-stone-500 text-sm font-bold py-3.5 rounded-2xl hover:border-orange-300 hover:text-orange-600 transition-all">
          💵 Pay Cash at Counter / Door
        </button>

        <div className="flex items-center justify-center gap-4 mt-4">
          <span className="text-[10px] text-stone-400">🔒 100% Secure</span>
          <span className="text-[10px] text-stone-400">|</span>
          <span className="text-[10px] text-stone-400">UPI · Cards · NetBanking</span>
        </div>
      </div>
    </div>
  );
}

// ── ORDER TRACKER ─────────────────────────────────────────
function OrderTracker({ order, tableLabel, onNewOrder }) {
  const [status,      setStatus]      = useState(order.status || "pending");
  const [riderName,   setRiderName]   = useState(order.rider_name || null);
  const [riderPhone,  setRiderPhone]  = useState(order.rider_phone || null);
  const [liveOrder,   setLiveOrder]   = useState(order); // tracks full order for route data
  const [reviewDone,  setReviewDone]  = useState(false);
  const [thumbSent,   setThumbSent]   = useState(null);
  // Feature 1: stale banner
  const [isStale,     setIsStale]     = useState(false);
  // Feature 3: offline banner
  const [isOffline,   setIsOffline]   = useState(!navigator.onLine);
  // Feature 4: live ETA countdown
  const [etaText,     setEtaText]     = useState(null);
  const [waitTimes]                   = useState(() => {
    try { return JSON.parse(localStorage.getItem(SS_WAIT) || "{}"); } catch { return {}; }
  });

  // Feature 1: stale banner — check every 30s if accepted for >25 min
  useEffect(() => {
    if (status !== "accepted") { setIsStale(false); return; }
    const check = () => {
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      setIsStale(ageMs > 25 * 60 * 1000);
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [status, order.created_at]);

  // Feature 3: offline banner
  useEffect(() => {
    const goOnline = () => {
      setIsOffline(false);
      // Re-fetch order status immediately on reconnect
      if (SUPABASE_READY && order.id) {
        supabase.from("orders").select("status, rider_name, rider_phone").eq("id", order.id).single()
          .then(({ data }) => { if (data) applyUpdateRef.current?.(data); });
      }
    };
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, [order.id]);

  // Feature 4: ETA countdown
  useEffect(() => {
    const ot = order.order_type || "dine-in";
    const defaultWait = waitTimes[ot] || (ot === "delivery" ? 40 : ot === "takeaway" ? 20 : 15);
    if (status !== "pending" && status !== "accepted") { setEtaText(null); return; }
    const target = new Date(order.created_at).getTime() + defaultWait * 60000;
    const tick = () => {
      const diff = Math.round((target - Date.now()) / 1000);
      if (diff <= 0) { setEtaText("Any moment now…"); }
      else {
        const m = Math.floor(diff / 60), s = diff % 60;
        setEtaText(`${m}:${String(s).padStart(2, "0")}`);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [status, order.created_at, order.order_type, waitTimes]);

  // applyUpdateRef so offline handler can call applyUpdate without stale closure
  const applyUpdateRef = useRef(null);

  // Clear persisted order when served or cancelled — delay so customer refreshing
  // mid-completion still sees the served/done screen instead of jumping back to menu
  useEffect(() => {
    if (status === "served" || status === "cancelled") {
      const t = setTimeout(() => {
        localStorage.removeItem(LS_ACTIVE_ORDER);
        sessionStorage.removeItem(SS_ORDER);
      }, 3 * 60 * 1000); // keep for 3 minutes
      return () => clearTimeout(t);
    }
  }, [status]);

  // Feature 7: request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY || !order.id) return;

    const TERMINAL = new Set(["cancelled", "served"]);

    const applyUpdate = (data) => {
      if (!data) return;
      if (data.status) {
        // Feature 7: push notification on status change
        const prevStatus = applyUpdateRef.current?._lastStatus;
        if (data.status !== prevStatus && "Notification" in window && Notification.permission === "granted") {
          const NOTIF_MSGS = {
            accepted:  "👨‍🍳 Your order is being prepared!",
            ready:     "✅ Your order is ready!",
            dispatched:"🛵 Your rider is on the way!",
            served:    "😊 Order delivered — enjoy!",
            cancelled: "😔 Your order was cancelled",
          };
          const msg = NOTIF_MSGS[data.status];
          if (msg) {
            const n = new Notification("Burger Point", { body: msg });
            setTimeout(() => n.close(), 6000);
          }
        }
        setStatus(data.status);
        // As soon as the order reaches a terminal state, wipe the persisted copies
        // so that a page-refresh no longer shows a stale "dispatched" or "pending" screen.
        if (TERMINAL.has(data.status)) {
          localStorage.removeItem(LS_ACTIVE_ORDER);
          sessionStorage.removeItem(SS_ORDER);
        }
      }
      if (data.rider_name)  setRiderName(data.rider_name);
      if (data.rider_phone) setRiderPhone(data.rider_phone);
      setLiveOrder(prev => ({ ...prev, ...data }));
      // keep ref in sync for offline handler
      if (applyUpdateRef.current) applyUpdateRef.current._lastStatus = data.status || applyUpdateRef.current._lastStatus;
    };
    applyUpdateRef.current = applyUpdate;

    const ORDER_FIELDS = "status, rider_name, rider_phone, route_geometry, route_distance_km, route_eta_minutes, delivery_started_at, customer_lat, customer_lng, cancel_reason";

    // 1. Fetch current state immediately on mount; retry once on failure
    const fetchNow = (retryMs = 0) => {
      supabase.from("orders").select(ORDER_FIELDS).eq("id", order.id).single()
        .then(({ data, error }) => {
          if (!error) applyUpdate(data);
          else if (retryMs > 0) setTimeout(() => fetchNow(0), retryMs);
        });
    };
    fetchNow(3000); // initial fetch; retry after 3 s if it fails

    // 2. Subscribe to real-time changes — fires the instant admin updates the row
    let fallbackTimer = null;
    const channel = supabase
      .channel(`order-${order.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${order.id}` },
        (payload) => applyUpdate(payload.new)
      )
      .subscribe((state) => {
        // Fallback: if realtime can't connect, poll every 5 seconds instead
        if ((state === "CHANNEL_ERROR" || state === "TIMED_OUT") && !fallbackTimer) {
          fallbackTimer = setInterval(() => fetchNow(0), 5000);
        } else if (state === "SUBSCRIBED" && fallbackTimer) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
      });

    return () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      supabase.removeChannel(channel);
    };
  }, [order.id]);

  // Sync internal status when parent CustomerApp's auto-verify updates the prop.
  // (useState only initialises once, so prop changes after mount are ignored without this.)
  useEffect(() => {
    if (order.status && order.status !== status) {
      setStatus(order.status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.status]);

  const submitRating = async (rating) => {
    setThumbSent(rating);
    setReviewDone(true);
    if (SUPABASE_READY && order.id) {
      await supabase.from("reviews").insert({ order_id: order.id, rating });
    }
  };

  const steps  = getTrackerSteps(order.order_type || "dine-in");
  const curIdx = steps.findIndex(s => s.key === status);
  const ot     = order.order_type || "dine-in";

  const waitMins = (() => {
    if (status === "pending" || status === "accepted") {
      return waitTimes[ot] || (ot === "delivery" ? 40 : ot === "takeaway" ? 20 : 15);
    }
    return null;
  })();

  // Order was cancelled — show the reason plainly, no step tracker
  if (status === "cancelled") {
    const reason = liveOrder.cancel_reason || order.cancel_reason;
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center text-4xl mb-4">😔</div>
        <p className="font-black text-stone-800 text-xl mb-1">Order cancelled</p>
        <p className="text-sm text-stone-500 max-w-xs mb-4">
          {tableLabel || order.customer_name || "Your order"} · ₹{order.total} was cancelled by the restaurant.
        </p>
        {reason && (
          <div className="bg-white border border-red-200 rounded-2xl px-4 py-3 max-w-xs mb-6">
            <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Reason</p>
            <p className="text-sm text-stone-700">{reason}</p>
          </div>
        )}
        <a href="tel:+919194008822" className="flex items-center gap-2 border border-orange-200 text-orange-600 font-bold text-sm px-5 py-3 rounded-2xl mb-3">
          <Phone size={15} /> Call Restaurant
        </a>
        <button onClick={onNewOrder} className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-transform">
          🛒 Order Again
        </button>
      </div>
    );
  }

  // Show the delivery map only for active delivery orders.
  // Guard against cancelled / served states slipping through (e.g. stale localStorage
  // on refresh before the fetch completes).
  const isDelivery = (liveOrder.order_type || order.order_type) === "delivery";
  if (isDelivery && status !== "cancelled" && status !== "served") {
    return (
      <Suspense fallback={
        <div className="fixed inset-0 bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
          <div className="text-center text-white">
            <div className="text-5xl mb-4">🛵</div>
            <p className="font-black text-xl">Loading Tracker…</p>
          </div>
        </div>
      }>
        <DeliveryTracker
          order={{ ...liveOrder, status }}
          riderName={riderName}
          riderPhone={riderPhone}
          restaurantCoords={[26.926287, 80.942995]}
          onNewOrder={onNewOrder}
        />
      </Suspense>
    );
  }

  // Feature 6: WhatsApp order summary
  const waOrderSummary = (() => {
    const lines = (order.items || []).map(it => `• ${it.name}${it.selectedVariant ? ` (${it.selectedVariant})` : ""} ×${it.qty} — ₹${it.finalPrice * it.qty}`);
    const msg = `🍔 *Burger Point Order*\n\n${lines.join("\n")}\n\n*Total: ₹${order.total}*`;
    const phone = order.customer_phone;
    return phone
      ? `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col">
      {/* Feature 1: stale banner */}
      {isStale && status === "accepted" && (
        <div className="sticky top-0 z-20 bg-yellow-400 text-yellow-900 px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-xs font-bold flex-1">Still preparing — taking a little longer than usual 🙏</span>
          <a href="tel:+919194008822" className="flex-shrink-0 bg-yellow-900/20 text-yellow-900 text-xs font-black px-3 py-1.5 rounded-xl flex items-center gap-1.5">
            <Phone size={11} /> Call
          </a>
        </div>
      )}
      {/* Feature 3: offline banner */}
      {isOffline && (
        <div className="bg-stone-700 text-white text-xs font-medium px-4 py-2 text-center">
          You're offline — status will update when you reconnect
        </div>
      )}
      <div className="bg-gradient-to-r from-orange-500 to-red-600 text-white px-5 pt-10 pb-8 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl">{steps[curIdx]?.icon || "🕐"}</div>
            <div>
              <p className="font-black text-xl">{steps[curIdx]?.label || "Order Placed"}</p>
              <p className="text-orange-100 text-sm">{tableLabel || order.customer_name || "Your Order"} · ₹{order.total}</p>
            </div>
          </div>
          <div className="bg-white/20 rounded-2xl px-4 py-3 mb-2">
            <p className="text-orange-100 text-xs">{steps[curIdx]?.sub}</p>
          </div>
          {/* Feature 4: live ETA countdown */}
          {etaText && (
            <div className="bg-white/15 rounded-xl px-3 py-2 flex items-center gap-2">
              <Clock size={13} className="text-orange-200" />
              <span className="text-xs text-orange-100">
                {etaText === "Any moment now…"
                  ? <span className="font-bold text-white">Any moment now…</span>
                  : <>Estimated wait: <span className="font-bold text-white">{etaText}</span></>}
              </span>
            </div>
          )}
          {order.payment_method && (
            <div className="mt-2 bg-white/15 rounded-xl px-3 py-2 flex items-center gap-2">
              <span className="text-xs text-orange-100">💳 Paid via</span>
              <span className="text-xs font-bold text-white">{order.payment_method}</span>
              <span className="ml-auto text-xs bg-green-400/30 text-green-100 font-bold px-2 py-0.5 rounded-full">✓ Captured</span>
            </div>
          )}
          {order.promo_code && (
            <div className="mt-2 bg-white/15 rounded-xl px-3 py-2 flex items-center gap-2">
              <Tag size={12} className="text-orange-200" />
              <span className="text-xs text-orange-100">Promo <span className="font-bold text-white">{order.promo_code}</span> applied · saved ₹{order.discount}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 px-5 py-6 max-w-lg mx-auto w-full">
        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-5">Live Order Status</p>

        {/* Review nudge when served */}
        {status === "served" && (
          <div className="bg-gradient-to-br from-orange-50 to-yellow-50 border border-orange-200 rounded-2xl p-4 mb-5">
            {!thumbSent ? (
              <>
                <p className="text-sm font-bold text-stone-800 mb-3">How was your experience? 😊</p>
                <div className="flex gap-3 mb-3">
                  <button onClick={() => submitRating("up")} className="flex-1 flex items-center justify-center gap-2 bg-green-100 text-green-700 font-bold text-sm py-2.5 rounded-xl active:scale-95 transition-transform">
                    <ThumbsUp size={16} /> Loved it!
                  </button>
                  <button onClick={() => submitRating("down")} className="flex-1 flex items-center justify-center gap-2 bg-red-50 text-red-500 font-bold text-sm py-2.5 rounded-xl active:scale-95 transition-transform">
                    <ThumbsDown size={16} /> Not great
                  </button>
                </div>
                <a href={REVIEW_URL} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs text-orange-600 font-semibold">
                  <Star size={12} fill="currentColor" /> Leave a Google Review ⭐
                </a>
              </>
            ) : (
              <div className="text-center">
                <p className="text-2xl mb-1">{thumbSent === "up" ? "🎉" : "🙏"}</p>
                <p className="text-sm font-bold text-stone-800">{thumbSent === "up" ? "Thanks! We're glad you loved it!" : "Thanks for the feedback. We'll improve!"}</p>
                {thumbSent === "up" && (
                  <a href={REVIEW_URL} target="_blank" rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-orange-600 font-semibold">
                    <Star size={11} fill="currentColor" /> Share on Google too?
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Rider info */}
        {ot === "delivery" && status === "dispatched" && riderName && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 mb-5">
            <p className="text-xs font-bold text-purple-800 mb-2 flex items-center gap-1.5"><Bike size={13} /> Your Delivery Rider</p>
            <div className="flex items-center justify-between">
              <div><p className="font-bold text-stone-800">{riderName}</p>{riderPhone && <p className="text-sm text-stone-500">{riderPhone}</p>}</div>
            </div>
            {/* Feature 5: rider call + WA buttons */}
            {riderPhone && (
              <div className="flex gap-2 mt-3">
                <a href={`tel:${riderPhone}`} className="flex-1 flex items-center justify-center gap-1.5 bg-green-500 text-white text-xs font-bold py-2.5 rounded-xl shadow-sm">
                  📞 Call Rider
                </a>
                <a href={`https://wa.me/91${riderPhone}?text=${encodeURIComponent("Hi, I'm waiting for my Burger Point order. Can you share your ETA?")}`}
                  target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-100 text-green-800 text-xs font-bold py-2.5 rounded-xl shadow-sm">
                  💬 WhatsApp Rider
                </a>
              </div>
            )}
          </div>
        )}

        {/* Steps */}
        {steps.map(({ key, label, sub, icon }, i) => {
          const done = i <= curIdx; const cur = i === curIdx;
          return (
            <div key={key} className="flex items-start gap-4 mb-6 relative">
              {i < steps.length - 1 && <div className={`absolute left-[19px] top-11 w-0.5 h-8 transition-all duration-700 ${done && i < curIdx ? "bg-orange-400" : "bg-stone-200"}`} />}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-lg transition-all duration-500 ${done ? "bg-orange-500 shadow-md" : "bg-stone-200"} ${cur ? "ring-4 ring-orange-200" : ""}`}>
                {done ? <span>{icon}</span> : <span className="text-stone-400 text-sm">{i + 1}</span>}
              </div>
              <div className="flex-1 pt-1.5">
                <p className={`text-sm font-bold ${done ? "text-stone-800" : "text-stone-300"}`}>{label}</p>
                <p className={`text-xs mt-0.5 ${done ? "text-stone-500" : "text-stone-300"}`}>{sub}</p>
              </div>
              {cur && status !== "served" && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-orange-500 mt-2 bg-orange-50 px-2 py-1 rounded-lg">
                  <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" /> LIVE
                </span>
              )}
            </div>
          );
        })}

        {/* Order summary */}
        <div className="bg-white rounded-2xl p-4 border border-orange-100 mt-2">
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">Your Order</p>
          {order.items?.map((it, i) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span className="text-stone-700">{it.name}{it.selectedVariant ? ` (${it.selectedVariant})` : ""} ×{it.qty}
                {it.addonLabels?.length > 0 && <span className="text-[11px] text-orange-400 ml-1">({it.addonLabels.join(", ")})</span>}
              </span>
              <span className="text-stone-500 font-semibold">₹{it.finalPrice * it.qty}</span>
            </div>
          ))}
          <div className="border-t border-stone-100 pt-2 mt-2 flex justify-between font-bold text-sm">
            <span>Total</span><span className="text-orange-600">₹{order.total}</span>
          </div>
          {order.note && <p className="text-xs text-stone-400 italic mt-2">Note: "{order.note}"</p>}
        </div>

        {/* Feature 6: WhatsApp order summary */}
        <a href={waOrderSummary} target="_blank" rel="noreferrer"
          className="mt-3 w-full flex items-center justify-center gap-2 border border-green-200 text-green-700 font-bold text-sm py-3 rounded-2xl active:scale-95 transition-transform bg-green-50">
          📲 Send to WhatsApp
        </a>

        <a href="tel:+919194008822" className="mt-3 w-full flex items-center justify-center gap-2 border border-orange-200 text-orange-600 font-bold text-sm py-3 rounded-2xl active:scale-95 transition-transform">
          <Phone size={15} /> Call Restaurant
        </a>

        {status === "served" && (
          <button onClick={onNewOrder} className="mt-5 w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-transform">
            🛒 Order More
          </button>
        )}
        <div className="mt-4 flex gap-3 justify-center">
          <button onClick={() => window.location.hash = "privacy"} className="text-xs text-stone-400 underline">Privacy Policy</button>
          <button onClick={() => window.location.hash = "contact"} className="text-xs text-stone-400 underline">Contact Us</button>
        </div>
      </div>
    </div>
  );
}

// ── ORDER HISTORY MODAL ───────────────────────────────────
function OrderHistoryModal({ onClose, onReorder }) {
  const history = (() => { try { return JSON.parse(localStorage.getItem(LS_HISTORY) || "[]"); } catch { return []; } })();
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-w-xl mx-auto flex flex-col" style={{ maxHeight: "85vh" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mt-3 flex-shrink-0" />
        <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-bold text-stone-800 text-base flex items-center gap-2"><History size={16} className="text-orange-500" /> My Orders</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-stone-100 flex items-center justify-center"><X size={14} className="text-stone-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {history.length === 0 ? (
            <div className="text-center py-12"><p className="text-4xl mb-2">📋</p><p className="text-stone-400 text-sm font-medium">No past orders yet</p></div>
          ) : history.map((order, i) => (
            <div key={i} className="bg-stone-50 rounded-2xl p-4 mb-3 border border-stone-100">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-xs font-bold text-stone-700">{order.table_label || order.customer_name || "Order"}</p>
                  <p className="text-[11px] text-stone-400">{new Date(order.created_at || Date.now()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                </div>
                <span className="text-sm font-black text-orange-600">₹{order.total}</span>
              </div>
              <div className="text-xs text-stone-500 mb-3">
                {order.items?.slice(0, 3).map((it, j) => (
                  <span key={j}>{it.name} ×{it.qty}{j < Math.min(order.items.length, 3) - 1 ? ", " : ""}</span>
                ))}
                {order.items?.length > 3 && <span className="text-stone-400"> +{order.items.length - 3} more</span>}
              </div>
              <button onClick={() => { onReorder(order.items); onClose(); }}
                className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-600 text-xs font-bold px-3 py-2 rounded-xl active:scale-95 transition-transform">
                <RefreshCw size={11} /> Reorder
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── BESTSELLERS HOOK ──────────────────────────────────────
function useBestsellers(menu) {
  const [bestsellers, setBestsellers] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(LS_BESTSELLERS) || "null");
      if (cached && Date.now() - cached.ts < 3_600_000) return new Set(cached.ids);
    } catch {}
    return new Set();
  });

  useEffect(() => {
    if (!SUPABASE_READY) return;
    const ALL = Object.values(menu).flat();
    const run = async () => {
      // 1. Manual pins from DB
      const { data: manual } = await supabase.from("menu_items")
        .select("id").eq("is_bestseller_manual", true);
      const manualIds = new Set((manual || []).map(i => i.id));

      // 2. Auto-calculate from served orders (last 30 days)
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: served } = await supabase.from("orders")
        .select("items").eq("status", "served").gte("created_at", since);

      const counts = {};
      (served || []).forEach(o =>
        (Array.isArray(o.items) ? o.items : []).forEach(it => {
          counts[it.name] = (counts[it.name] || 0) + (it.qty || 1);
        })
      );
      const topNames = Object.entries(counts)
        .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n);
      const autoIds = topNames
        .map(name => ALL.find(i => i.name === name)?.id).filter(Boolean);

      // Manual takes priority; merge both sets
      const finalIds = new Set([...manualIds, ...autoIds]);
      setBestsellers(finalIds);
      localStorage.setItem(LS_BESTSELLERS, JSON.stringify({ ids: [...finalIds], ts: Date.now() }));
    };
    run();
  }, [menu]);

  return bestsellers;
}

// ── CHECKOUT INFO SHEET ───────────────────────────────────
// Bottom sheet shown at order time — collects name/phone (and address for delivery).
// Pre-fills from saved data so returning customers just tap confirm.

function CheckoutInfoSheet({ orderType, existing, onSubmit, onClose }) {
  const [name,     setName]     = useState(existing?.name    || "");
  const [phone,    setPhone]    = useState(existing?.phone   || "");
  const [house,    setHouse]    = useState("");
  const [street,   setStreet]   = useState("");
  const [landmark, setLandmark] = useState("");
  const [coords,   setCoords]   = useState(null);
  const [locating, setLocating] = useState(false);
  const [err,      setErr]      = useState("");
  const { settings } = useBusinessSettings();
  const { addresses: savedAddrs, save: saveAddr, remove: removeAddr } = useSavedAddresses();
  const toast = useToast();

  // Pre-fill address fields if existing delivery address
  useEffect(() => {
    if (existing?.address && orderType === "delivery") {
      // parse first part as house, rest as street — best-effort
      const parts = existing.address.split(", ");
      setHouse(parts[0] || "");
      setStreet(parts[1] || "");
    }
    if (existing?.lat && existing?.lng) setCoords({ lat: existing.lat, lng: existing.lng });
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setErr("Location not supported on this browser."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setCoords({ lat, lng });
        toast.success("Location captured ✓");
        setLocating(false);
      },
      () => { setLocating(false); setErr("Couldn't get location — please allow access and try again."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const buildAddress = () => [house.trim(), street.trim(), landmark.trim() ? `Near ${landmark.trim()}` : "", "Lucknow"].filter(Boolean).join(", ");

  const applySaved = (a) => {
    setHouse(a.house || ""); setStreet(a.street || ""); setLandmark(a.landmark || "");
    if (a.lat && a.lng) setCoords({ lat: a.lat, lng: a.lng });
    toast.info("Address loaded");
  };

  const submit = () => {
    if (!name.trim())             { setErr("Please enter your name."); return; }
    if (!/^\d{10}$/.test(phone))  { setErr("Enter a valid 10-digit phone number."); return; }
    // Live location is mandatory for delivery only — dine-in is location-verified
    // via the table code, and takeaway customers are coming to the restaurant anyway.
    if (orderType === "delivery" && (!coords?.lat || !coords?.lng)) {
      setErr("Please share your location — tap 'Use my location' below to continue.");
      return;
    }
    if (orderType === "delivery") {
      if (!house.trim())  { setErr("Please enter house/flat number."); return; }
      if (!street.trim()) { setErr("Please enter street / colony."); return; }
      const full = buildAddress();
      if (full.length > 5) saveAddr({ label: house.trim().slice(0, 30), house: house.trim(), street: street.trim(), landmark: landmark.trim(), lat: coords?.lat ?? null, lng: coords?.lng ?? null, fullAddress: full });
    }
    onSubmit({ name: name.trim(), phone, address: orderType === "delivery" ? buildAddress() : null, lat: orderType === "delivery" ? (coords?.lat ?? null) : null, lng: orderType === "delivery" ? (coords?.lng ?? null) : null });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg mx-auto bg-white rounded-t-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-stone-100 z-10">
          <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-black text-stone-800 text-lg">{orderType === "delivery" ? "🛵 Delivery Details" : "📦 Your Details"}</p>
              <p className="text-xs text-stone-400 mt-0.5">Quick checkout — saved for next time</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center"><X size={14} className="text-stone-500" /></button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {/* Name */}
          <div>
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Your Name *</label>
            <div className="relative">
              <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input value={name} onChange={e => { setName(e.target.value); setErr(""); }} placeholder="e.g. Rahul Sharma"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl pl-9 pr-4 py-3 outline-none transition-colors" />
            </div>
          </div>
          {/* Phone */}
          <div>
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Phone Number *</label>
            <div className="relative">
              <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setErr(""); }} placeholder="10-digit mobile" inputMode="numeric"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl pl-9 pr-4 py-3 outline-none transition-colors" />
            </div>
          </div>

          {/* Live location — required for delivery only */}
          {orderType === "delivery" && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                <MapPin size={9} /> Your Location <span className="text-red-500">*</span>
              </p>

              {coords?.lat && coords?.lng ? (
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-600 flex-shrink-0" />
                  <span className="text-xs font-bold text-green-700">Location confirmed ✓</span>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                  We need your live location to {orderType === "delivery" ? "calculate delivery distance and fee" : "confirm you're nearby for pickup"}. Orders can't be placed without it.
                </div>
              )}

              <button type="button" onClick={useMyLocation} disabled={locating}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 rounded-xl py-2.5 disabled:opacity-60">
                <Navigation size={13} /> {locating ? "Locating…" : coords?.lat ? "Re-share location" : "Use my location"}
              </button>
            </div>
          )}

          {/* Delivery address */}
          {orderType === "delivery" && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1"><MapPin size={9} /> Delivery Address</p>

              {/* Saved addresses */}
              <SavedAddressPicker addresses={savedAddrs} onSelect={applySaved} onRemove={removeAddr} />

              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3 space-y-2">
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 block mb-1">🏠 House / Flat / Shop No. *</label>
                  <input value={house} onChange={e => { setHouse(e.target.value); setErr(""); }} placeholder="e.g. H-42, Flat 3B"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none bg-white" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 block mb-1">🛣️ Street / Colony *</label>
                  <input value={street} onChange={e => { setStreet(e.target.value); setErr(""); }} placeholder="e.g. Sector C, Jankipuram"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none bg-white" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 block mb-1">📍 Landmark <span className="font-normal text-stone-400">(optional)</span></label>
                  <input value={landmark} onChange={e => { setLandmark(e.target.value); setErr(""); }} placeholder="e.g. Near City Hospital"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none bg-white" />
                </div>
              </div>

              {(house || street) && (
                <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                  <p className="text-[10px] font-bold text-green-600 mb-0.5">📋 Address Preview</p>
                  <p className="text-xs text-stone-600">{buildAddress()}</p>
                </div>
              )}
            </div>
          )}

          {err && <p className="text-red-500 text-xs font-medium text-center">{err}</p>}

          <button onClick={submit}
            disabled={orderType === "delivery" && !(coords?.lat && coords?.lng)}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-2xl font-bold text-sm shadow-md active:scale-95 transition-transform mt-2 disabled:opacity-40 disabled:pointer-events-none">
            {existing?.name ? "✅ Confirm & Continue" : orderType === "delivery" ? "🛵 Save & Continue" : "📦 Save & Continue"}
          </button>
        </div>
      </div>

    </div>
  );
}

// ── CUSTOMER APP ──────────────────────────────────────────
export function CustomerApp({ code, tableLabel, orderType = "dine-in" }) {
  const [activeCat,     setActiveCat]     = useState("burgers");
  const [search,        setSearch]        = useState("");
  const [cart,          setCart]          = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("bp_cart") || "[]"); } catch { return []; }
  });
  useEffect(() => { sessionStorage.setItem("bp_cart", JSON.stringify(cart)); }, [cart]);
  const [showCart,      setShowCart]      = useState(false);
  const [itemModal,     setItemModal]     = useState(null);

  // ── Customer info — persisted in localStorage ────────────
  const [customerInfo, setCustomerInfoState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_CUSTOMER) || "null"); } catch { return null; }
  });
  const [showInfoModal, setShowInfoModal] = useState(false);
  const saveCustomerInfo = (info) => {
    // Save everything — name, phone, address, coords
    const toSave = {
      name:    info.name,
      phone:   info.phone,
      address: info.address || null,
      lat:     info.lat    || null,
      lng:     info.lng    || null,
    };
    localStorage.setItem(LS_CUSTOMER, JSON.stringify(toSave));
    setCustomerInfoState({ ...toSave });
  };
  const [placed, setPlaced] = useState(() => {
    try {
      const ss = sessionStorage.getItem(SS_ORDER);
      if (ss) return JSON.parse(ss);
      // Resume across browser close
      const ls = JSON.parse(localStorage.getItem(LS_ACTIVE_ORDER) || "null");
      if (ls && ACTIVE_STATUSES.has(ls.status)) return ls;
      if (ls) localStorage.removeItem(LS_ACTIVE_ORDER); // stale served order
    } catch {}
    return null;
  });
  const [placing,       setPlacing]       = useState(false);
  const [showRazorpay,  setShowRazorpay]  = useState(null);
  const [showHistory,   setShowHistory]   = useState(false);
  const [menu,          setMenu]          = useState(DEFAULT_MENU);
  const [dbCategories,  setDbCategories]  = useState(null); // null = not loaded yet
  const { settings: bizSettings } = useBusinessSettings();
  const [favs,          setFavs]          = useState(() => { try { return JSON.parse(localStorage.getItem(LS_FAVS) || "[]"); } catch { return []; } });
  const [showFavs,      setShowFavs]      = useState(false);
  const catBarRef      = useRef(null);
  const menuAreaRef    = useRef(null);
  const catSectionRefs = useRef({});
  const [menuLoaded,   setMenuLoaded]   = useState(false);
  const [cartBouncing, setCartBouncing] = useState(false);
  const toast = useToast();

  const bestsellers = useBestsellers(menu);

  // Feature 8: real-time cart unavailability
  const [unavailableCartIds, setUnavailableCartIds] = useState(new Set());
  useEffect(() => {
    if (!SUPABASE_READY) return;
    const channel = supabase.channel("menu-items-avail")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_items" }, (payload) => {
        const item = payload.new;
        if (item.is_available === false) {
          setUnavailableCartIds(prev => {
            // only flag if item is in cart
            const cartIds = cart.map(c => c.id);
            if (cartIds.includes(item.id)) return new Set([...prev, item.id]);
            return prev;
          });
        } else {
          setUnavailableCartIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-verify resumed order status on mount
  useEffect(() => {
    if (!placed || !SUPABASE_READY) return;
    supabase.from("orders").select("status, rider_name, rider_phone").eq("id", placed.id).single()
      .then(({ data }) => {
        if (!data) return;
        const updated = { ...placed, status: data.status, rider_name: data.rider_name, rider_phone: data.rider_phone };
        if (!ACTIVE_STATUSES.has(data.status)) {
          // Terminal (served / cancelled) — clear persisted copies NOW so a subsequent
          // refresh doesn't load a stale "dispatched" status and flash the wrong screen.
          localStorage.removeItem(LS_ACTIVE_ORDER);
          sessionStorage.removeItem(SS_ORDER);
          // Still update state so OrderTracker can render the correct done/cancelled screen.
          setPlaced(updated);
        } else {
          setPlaced(updated);
          sessionStorage.setItem(SS_ORDER, JSON.stringify(updated));
          localStorage.setItem(LS_ACTIVE_ORDER, JSON.stringify(updated));
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load dynamic menu from Supabase
  useEffect(() => {
    if (!SUPABASE_READY) { setMenuLoaded(true); return; }
    supabase.from("menu_items").select("*")
      .then(({ data, error }) => {
        if (!error && data?.length) {
          const grouped = {};
          data.forEach(item => {
            if (!grouped[item.category]) grouped[item.category] = [];
            const parsed = { ...item, variants: item.variants || null, addons: item.addons || [] };
            grouped[item.category].push(parsed);
          });
          setMenu(grouped);
        }
        setMenuLoaded(true);
      });
  }, []);

  // Load category enable/disable flags
  useEffect(() => {
    if (!SUPABASE_READY) { setDbCategories([]); return; }
    supabase.from("categories").select("id, enabled")
      .then(({ data }) => setDbCategories(data || []));
  }, []);

  const visibleCategories = (() => {
    if (!dbCategories || dbCategories.length === 0) return CATEGORIES; // fallback: nothing disabled yet
    const disabled = new Set(dbCategories.filter(c => c.enabled === false).map(c => c.id));
    return CATEGORIES.filter(c => !disabled.has(c.id));
  })();

  useEffect(() => {
    if (!dbCategories) return;
    if (!visibleCategories.some(c => c.id === activeCat) && visibleCategories.length > 0) {
      setActiveCat(visibleCategories[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbCategories]);

  const enabledCatIds = new Set(visibleCategories.map(c => c.id));
  const ALL = Object.values(menu).flat().filter(i => enabledCatIds.has(i.category));

  const filteredItems = (() => {
    let items;
    if (search) items = ALL.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
    else items = ALL.filter(i => favs.includes(i.id));
    if (bizSettings.hide_unavailable_items) items = items.filter(i => i.is_available !== false);
    return items;
  })();

  // IntersectionObserver — highlight category pill as user scrolls (placed after visibleCategories)
  useEffect(() => {
    if (showFavs || search) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.id.replace("cat-section-", "");
          setActiveCat(id);
          if (catBarRef.current) {
            const pill = catBarRef.current.querySelector(`[data-cat="${id}"]`);
            if (pill) pill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          }
        }
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );
    visibleCategories.forEach(c => {
      const el = document.getElementById(`cat-section-${c.id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [menuLoaded, showFavs, search, visibleCategories]);

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.finalPrice * i.qty, 0);

  const getCartQty = (name, variant = "") =>
    cart.filter(c => (c.name + (c.selectedVariant || "")) === (name + variant)).reduce((s, c) => s + c.qty, 0);

  const addItem = (item) => {
    setCart(prev => {
      const key = item.name + (item.selectedVariant || "") + (item.addonLabels?.join("") || "");
      const idx = prev.findIndex(c => (c.name + (c.selectedVariant || "") + (c.addonLabels?.join("") || "")) === key);
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + (item.qty || 1) }; return n; }
      return [...prev, { ...item, qty: item.qty || 1, finalPrice: item.finalPrice ?? item.price }];
    });
    // Cart icon bounce
    setCartBouncing(true);
    setTimeout(() => setCartBouncing(false), 380);
    // Toast confirmation
    toast.success(`${item.name} added to cart`);
  };

  const setItemQty = (name, variant, qty) => {
    const key = name + variant;
    if (qty <= 0) setCart(prev => prev.filter(c => (c.name + (c.selectedVariant || "")) !== key));
    else setCart(prev => prev.map(c => (c.name + (c.selectedVariant || "")) === key ? { ...c, qty } : c));
  };

  const handleAdd = (item) => {
    if (item.variants?.length || item.addons?.length) { setItemModal(item); return; }
    addItem({ ...item, finalPrice: item.price, qty: 1 });
  };

  const handleQty  = (i, qty) => qty <= 0 ? setCart(p => p.filter((_, x) => x !== i)) : setCart(p => p.map((c, x) => x === i ? { ...c, qty } : c));
  const toggleFav  = (id) => { const next = favs.includes(id) ? favs.filter(f => f !== id) : [...favs, id]; setFavs(next); localStorage.setItem(LS_FAVS, JSON.stringify(next)); };

  const shareCart = async () => {
    if (!code || cart.length === 0) return;
    const encoded = btoa(JSON.stringify(cart.map(i => ({ id: i.id, qty: i.qty, v: i.selectedVariant }))));
    const url = `${window.location.origin}${window.location.pathname}#table=${code}&cart=${encoded}`;
    try { await navigator.share({ title: "Burger Point Cart", url }); } catch { await navigator.clipboard?.writeText(url); toast.success("Cart link copied!"); }
  };

  const reorder = async (items) => {
    let toAdd = items;
    let skipped = [];
    // Check availability for items that have an id
    const ids = items.map(i => i.id).filter(Boolean);
    if (SUPABASE_READY && ids.length > 0) {
      const { data } = await supabase.from("menu_items").select("id, name, is_available").in("id", ids);
      if (data) {
        const unavailSet = new Set(data.filter(d => d.is_available === false).map(d => d.id));
        skipped = items.filter(i => unavailSet.has(i.id));
        toAdd = items.filter(i => !unavailSet.has(i.id));
      }
    }
    toAdd.forEach(item => addItem({ ...item, qty: item.qty || 1 }));
    if (skipped.length > 0) {
      toast.info(`Skipped: ${skipped.map(i => i.name).join(", ")} (no longer available)`);
    }
    // Scroll to menu
    setTimeout(() => menuAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };

  const updateAvailable = useAppUpdateAvailable();
  const [showUpdateGate, setShowUpdateGate] = useState(false);
  // pending checkout opts — held while we collect customer info
  const [pendingOpts, setPendingOpts] = useState(null);

  const [cartValidationError, setCartValidationError] = useState(null); // Feature 9

  const handlePlaceAttempt = async (opts) => {
    if (updateAvailable) { setShowCart(false); setShowUpdateGate(true); return; }

    // Feature 9: validate all cart items are still available
    if (SUPABASE_READY && cart.length > 0) {
      const ids = cart.map(i => i.id).filter(Boolean);
      if (ids.length > 0) {
        const { data } = await supabase.from("menu_items").select("id, name, is_available").in("id", ids);
        if (data) {
          const unavail = data.filter(d => d.is_available === false);
          if (unavail.length > 0) {
            const names = unavail.map(d => d.name).join(", ");
            setCartValidationError(`Sorry, these items are no longer available: ${names}. Please remove them to continue.`);
            return;
          }
        }
      }
    }
    setCartValidationError(null);
    setShowCart(false);
    // For delivery/takeaway, collect info at checkout time if not already saved
    const needsInfo = (orderType === "delivery" || orderType === "takeaway")
      && (!customerInfo?.name || !customerInfo?.phone
          || (orderType === "delivery" && !customerInfo?.address));
    if (needsInfo) {
      setPendingOpts(opts);
      setShowInfoModal(true);
      return;
    }
    setShowRazorpay(opts);
  };

  // Called when info modal is submitted
  const handleInfoSubmit = (info) => {
    saveCustomerInfo(info);
    setShowInfoModal(false);
    if (pendingOpts) { setShowRazorpay(pendingOpts); setPendingOpts(null); }
  };

  const [orderError,    setOrderError]    = useState(null);  // Feature 2: placement error
  const [retrying,      setRetrying]      = useState(false);

  const finaliseOrder = async ({ note, total, discount, promoCode, deliveryFee, packingCharge, gstAmount, distanceKm }, paymentMethod, razorpayPaymentId = null) => {
    setShowRazorpay(null); setPlacing(true); setOrderError(null);
    const payload = {
      id: crypto.randomUUID(),
      table_code: code || null,
      table_label: tableLabel || null,
      order_type: orderType,
      customer_name: customerInfo?.name || null,
      customer_phone: customerInfo?.phone || null,
      delivery_address: customerInfo?.address || null,
      payment_method: paymentMethod || "Cash",
      razorpay_payment_id: razorpayPaymentId || null,
      items: cart.map(i => ({ name: i.name, selectedVariant: i.selectedVariant || null, finalPrice: i.finalPrice, qty: i.qty, addonLabels: i.addonLabels || [] })),
      total, note: note || "", status: "pending",
      discount: discount || 0, promo_code: promoCode || null,
      delivery_fee: deliveryFee || 0, packing_charge: packingCharge || 0, gst_amount: gstAmount || 0,
      delivery_distance_km: distanceKm ?? null,
      customer_lat: customerInfo?.lat ?? null, customer_lng: customerInfo?.lng ?? null,
      created_at: new Date().toISOString(),
    };
    if (SUPABASE_READY) {
      try {
        const { error } = await supabase.from("orders").insert(payload);
        if (error) throw error;
      } catch (err) {
        console.error("Order save error:", err);
        setPlacing(false);
        // Feature 2: show error card — do NOT clear cart
        setOrderError({ payload, paymentMethod, razorpayPaymentId });
        return;
      }
    }
    saveHistory(payload);
    setTimeout(() => {
      setCart([]); setPlacing(false);
      sessionStorage.setItem(SS_ORDER, JSON.stringify(payload));
      localStorage.setItem(LS_ACTIVE_ORDER, JSON.stringify(payload));
      setPlaced(payload);
    }, 800);
  };

  const retryOrder = async () => {
    if (!orderError) return;
    setRetrying(true);
    const { payload, paymentMethod } = orderError;
    try {
      const { error } = await supabase.from("orders").insert({ ...payload, id: crypto.randomUUID() });
      if (error) throw error;
      setOrderError(null);
      saveHistory(payload);
      setCart([]); setRetrying(false);
      sessionStorage.setItem(SS_ORDER, JSON.stringify(payload));
      localStorage.setItem(LS_ACTIVE_ORDER, JSON.stringify(payload));
      setPlaced(payload);
    } catch (err) {
      console.error("Retry error:", err);
      setRetrying(false);
    }
  };

  // Feature 2: full-screen error card
  if (orderError) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 gap-5 p-6 text-center">
      <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center text-4xl">❌</div>
      <div>
        <p className="font-black text-stone-800 text-xl mb-2">Order couldn't be placed</p>
        <p className="text-sm text-stone-500">Check your connection and try again — your cart is still saved.</p>
      </div>
      <button onClick={retryOrder} disabled={retrying}
        className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 text-white px-8 py-4 rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-transform disabled:opacity-60">
        {retrying ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Retrying…</> : "Try Again"}
      </button>
      <button onClick={() => setOrderError(null)} className="text-xs text-stone-400 underline">Go back to cart</button>
    </div>
  );

  if (placing) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-orange-50 gap-4">
      <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center text-4xl">🍔</div>
      <p className="font-bold text-stone-700 text-lg">Sending to kitchen…</p>
      <div className="flex gap-1.5">{[0, 1, 2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
    </div>
  );

  if (placed) return <OrderTracker order={placed} tableLabel={tableLabel} onNewOrder={() => { sessionStorage.removeItem(SS_ORDER); setPlaced(null); }} />;

  if (bizSettings.emergency_close || bizSettings.holiday_mode) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-orange-50 gap-3 p-6 text-center">
      <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center text-4xl">😴</div>
      <p className="font-black text-stone-800 text-lg">We're currently closed</p>
      <p className="text-sm text-stone-500 max-w-xs">
        {bizSettings.emergency_close
          ? "We've had to pause orders temporarily. Please check back shortly!"
          : "We're closed today for a holiday. We'll be back soon — thanks for your patience!"}
      </p>
      {bizSettings.phone && <a href={`tel:${bizSettings.phone}`} className="mt-2 text-xs font-bold text-orange-600 underline">Call us: {bizSettings.phone}</a>}
    </div>
  );

  const typeLabel = orderType === "delivery" ? "🛵 Delivery" : orderType === "takeaway" ? "📦 Takeaway" : null;
  const activeCatData = visibleCategories.find(c => c.id === activeCat);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-stone-100">
        <div className="max-w-2xl mx-auto px-3 pt-2 pb-1.5">

          {/* Location bar — delivery only */}
          {orderType === "delivery" && (
            <button
              onClick={() => setShowInfoModal(true)}
              className="w-full flex items-center gap-1.5 bg-orange-50 border border-orange-200 rounded-xl px-2.5 py-1.5 mb-1.5 active:scale-[0.98] transition-transform text-left">
              <MapPin size={12} className="text-orange-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-orange-500 uppercase tracking-wider leading-none">
                  {orderType === "delivery" ? "Delivering to" : "Takeaway"}
                </p>
                <p className="text-[11px] font-bold text-stone-800 truncate leading-tight">
                  {orderType === "delivery"
                    ? (customerInfo?.address || "Add delivery address")
                    : "Burger Point, Jankipuram"}
                </p>
              </div>
              <span className="text-[9px] font-bold text-orange-500 flex-shrink-0">
                {customerInfo?.name ? "Change ›" : "Add ›"}
              </span>
            </button>
          )}

          {/* Top row — logo + actions + search */}
          <div className="flex items-center gap-2">
            <span className="text-lg flex-shrink-0">🍔</span>
            <div className="flex-1 flex items-center gap-2 bg-stone-100 rounded-xl px-2.5 py-1.5">
              <Search size={12} className="text-stone-400 flex-shrink-0" />
              <input value={search} onChange={e => { setSearch(e.target.value); setShowFavs(false); }} placeholder="Search menu…"
                className="flex-1 text-xs bg-transparent outline-none text-stone-700 placeholder-stone-400" />
              {search && <button onClick={() => setSearch("")}><X size={11} className="text-stone-400" /></button>}
            </div>
            <button onClick={() => setShowHistory(true)} className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center flex-shrink-0">
              <History size={13} className="text-stone-500" />
            </button>
            <span className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm flex-shrink-0">
              {tableLabel || typeLabel || "Menu"}
            </span>
            <button onClick={() => { clearTableSession(); window.location.hash = ""; }} className="text-[10px] text-stone-400 flex-shrink-0">✕</button>
          </div>
        </div>

        {/* 🔥 Bestsellers — compact horizontal strip */}
        {!menuLoaded ? null : bestsellers.size > 0 && !search && !showFavs ? (
          <div className="px-3 pt-1.5 pb-1">
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              <div className="flex-shrink-0 flex items-center gap-1 pr-1">
                <span className="text-xs">🔥</span>
                <p className="text-[10px] font-black text-stone-600 whitespace-nowrap">Best</p>
              </div>
              {Object.values(menu).flat().filter(i => bestsellers.has(i.id)).slice(0, 8).map(item => (
                <button key={item.id} onClick={() => handleAdd(item)}
                  className="flex-shrink-0 flex items-center gap-1.5 bg-orange-50 border border-orange-100 rounded-xl px-2 py-1 active:scale-95 transition-transform">
                  <div className="w-6 h-6 rounded-lg overflow-hidden flex-shrink-0 bg-stone-200">
                    <ItemThumb item={item} className="w-full h-full rounded-none" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-stone-800 whitespace-nowrap max-w-[70px] truncate">{item.name}</p>
                    <p className="text-[9px] font-black text-orange-600">₹{item.price}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Category bar */}
        {!search && (
          !menuLoaded ? <CategoryBarSkeleton /> : (
            <div ref={catBarRef} className="flex gap-1.5 px-3 py-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              <button onClick={() => { setShowFavs(f => !f); setActiveCat("burgers"); }}
                className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${showFavs ? "bg-red-500 text-white" : "bg-stone-100 text-stone-500"}`}>
                <Heart size={9} className={showFavs ? "fill-white" : ""} /> Favs {favs.length > 0 && `(${favs.length})`}
              </button>
              {visibleCategories.map(c => (
                <button key={c.id}
                  data-cat={c.id}
                  onClick={() => {
                    setShowFavs(false);
                    setActiveCat(c.id);
                    const el = document.getElementById(`cat-section-${c.id}`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${!showFavs && activeCat === c.id ? "bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm" : "bg-stone-100 text-stone-500"}`}>
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* Menu — continuous scroll with all categories */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 pb-32" ref={menuAreaRef}>
        {!menuLoaded ? (
          <MenuSkeleton count={5} />
        ) : (search || showFavs) ? (
          <>
            <p className="text-xs text-stone-400 font-medium py-3">
              {showFavs ? `${filteredItems.length} saved item${filteredItems.length !== 1 ? "s" : ""}` : `${filteredItems.length} result${filteredItems.length !== 1 ? "s" : ""} for "${search}"`}
            </p>
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center text-center py-16 px-4">
                <span className="text-4xl mb-3">{showFavs ? "❤️" : "🔍"}</span>
                <p className="text-sm font-bold text-stone-700">{showFavs ? "No favourites yet" : `No items match "${search}"`}</p>
                <p className="text-xs text-stone-400 mt-1 max-w-[220px]">{showFavs ? "Tap the ♡ on any item to save it here." : "Try a different spelling or browse categories."}</p>
                <button onClick={() => { setSearch(""); setShowFavs(false); }} className="mt-4 text-xs font-bold text-orange-600 bg-orange-50 px-4 py-2 rounded-full">Browse Menu</button>
              </div>
            ) : filteredItems.map(item => (
              <ItemCard key={item.id} item={item}
                cartQty={getCartQty(item.name, item.selectedVariant || "")}
                onAdd={handleAdd}
                onQtyChange={qty => setItemQty(item.name, "", qty)}
                isFav={favs.includes(item.id)}
                onToggleFav={toggleFav}
                isBestseller={bestsellers.has(item.id)} />
            ))}
          </>
        ) : (
          // Continuous scroll — all categories rendered at once
          visibleCategories.map(cat => {
            const catItems = (menu[cat.id] || []).filter(i => enabledCatIds.has(i.category));
            if (catItems.length === 0) return null;
            return (
              <div key={cat.id} id={`cat-section-${cat.id}`} className="scroll-mt-32">
                {/* Category header with image */}
                <div className="my-3 relative rounded-2xl overflow-hidden h-24">
                  <img src={cat.img} alt={cat.label}
                    onError={e => { e.target.parentElement.style.background = "linear-gradient(to right,#fed7aa,#fef3c7)"; e.target.style.display = "none"; }}
                    className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent flex items-end p-4">
                    <div>
                      <p className="text-white font-black text-base leading-tight">{cat.emoji} {cat.label}</p>
                      <p className="text-white/70 text-xs">{catItems.length} items</p>
                    </div>
                  </div>
                </div>
                {catItems.map(item => (
                  <ItemCard key={item.id} item={item}
                    cartQty={getCartQty(item.name, item.selectedVariant || "")}
                    onAdd={handleAdd}
                    onQtyChange={qty => setItemQty(item.name, "", qty)}
                    isFav={favs.includes(item.id)}
                    onToggleFav={toggleFav}
                    isBestseller={bestsellers.has(item.id)} />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Cart bar — with bounce micro-interaction */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-4">
          <button onClick={() => setShowCart(true)}
            className={`w-full max-w-2xl mx-auto flex bg-gradient-to-r from-orange-500 to-red-600 text-white px-5 py-4 rounded-2xl items-center justify-between font-bold text-sm shadow-xl active:scale-95 transition-transform ${cartBouncing ? "cart-bounce" : ""}`}>
            <div className="flex items-center gap-2.5">
              <span className={`bg-white/25 text-white text-xs font-black px-2 py-0.5 rounded-lg ${cartBouncing ? "cart-bounce" : ""}`}>{cartCount}</span>
              <span>{cartCount} item{cartCount > 1 ? "s" : ""} in cart</span>
            </div>
            <span className="font-black">₹{cartTotal} →</span>
          </button>
        </div>
      )}

      {itemModal && <ItemModal item={itemModal} onClose={() => setItemModal(null)} onAdd={entry => { addItem(entry); setItemModal(null); }} />}
      {showCart && (
        <CartDrawer cart={cart} tableLabel={tableLabel} orderType={orderType} customerInfo={customerInfo} settings={bizSettings}
          onClose={() => setShowCart(false)} onQty={handleQty} onRemove={i => { setCart(p => p.filter((_, x) => x !== i)); setCartValidationError(null); }} onPlace={handlePlaceAttempt}
          unavailableIds={unavailableCartIds} validationError={cartValidationError} />
      )}
      {showRazorpay && (
        <RazorpayModal amount={showRazorpay.total} customerName={customerInfo?.name || tableLabel || "Customer"} customerPhone={customerInfo?.phone}
          onSuccess={(paymentId) => finaliseOrder(showRazorpay, "Razorpay (Online)", paymentId)}
          onClose={() => finaliseOrder(showRazorpay, "Cash")}
          onCancel={() => setShowRazorpay(null)} />
      )}
      {showInfoModal && (
        <CheckoutInfoSheet
          orderType={orderType}
          existing={customerInfo}
          onSubmit={handleInfoSubmit}
          onClose={() => { setShowInfoModal(false); setPendingOpts(null); }}
        />
      )}
      {showHistory && <OrderHistoryModal onClose={() => setShowHistory(false)} onReorder={reorder} />}
      {showUpdateGate && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center text-3xl mx-auto mb-3">🔄</div>
            <p className="font-black text-stone-800 text-lg">Update Available</p>
            <p className="text-sm text-stone-500 mt-2">A newer version of Burger Point is ready. Please update to continue placing your order — this only takes a second and your cart will be kept.</p>
            <button onClick={() => { window.__bpApplyUpdate?.(); }}
              className="w-full mt-5 bg-gradient-to-r from-orange-500 to-red-600 text-white py-3 rounded-2xl font-bold text-sm active:scale-95 transition-transform">
              Update Now
            </button>
            <button onClick={() => setShowUpdateGate(false)} className="w-full mt-2 text-xs text-stone-400 py-2">Not now</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── LANDING PAGE ──────────────────────────────────────────
export function LandingPage({ installPrompt }) {
  const [mode,          setMode]          = useState(null);
  const [showUpdateGate, setShowUpdateGate] = useState(false);
  const [code,          setCode]          = useState("");
  const [err,           setErr]           = useState("");
  const [shake,         setShake]         = useState(false);
  const [iosHint,       setIosHint]       = useState(false);
  const [busy,          setBusy]          = useState(null);
  const inputRef = useRef(null);
  const isIos        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode:standalone)").matches;
  const { settings: bizSettings } = useBusinessSettings();
  const updateAvailable = useAppUpdateAvailable();

  const handleOrderTypePick = (id) => {
    if (updateAvailable) { setShowUpdateGate(true); return; }
    if (id === "takeaway") window.location.hash = "takeaway";
    else if (id === "delivery") window.location.hash = "delivery";
    else setMode("dine");
  };

  // Check busy/closed mode
  useEffect(() => {
    if (!SUPABASE_READY) return;
    supabase.from("busy_mode").select("*").eq("id", 1).single()
      .then(({ data }) => { if (data?.is_busy) setBusy(data); });
  }, []);

  const TABLE_CODES_REF = Object.fromEntries(
    Object.entries(
      Object.assign({}, ...Object.keys({
        "7294831056": 1, "4058379126": 2, "8163059247": 3, "2947063815": 4, "5820394176": 5,
        "3614729058": 6, "9037246815": 7, "1472958630": 8, "6895230174": 9, "4260817953": 10,
        "8531064279": 11, "3749158260": 12, "7048263591": 13, "3619470825": 14, "5283701964": 15,
        "9146852037": 16, "2705638149": 17, "6493027581": 18, "8027541693": 19, "1359820746": 20,
      }).map(k => [k, `Table ${Object.keys({ "7294831056": 1 }).length}`]))
    )
  );

  const go = (c) => {
    const tbl = {
      "7294831056": "Table 1", "4058379126": "Table 2", "8163059247": "Table 3",
      "2947063815": "Table 4", "5820394176": "Table 5", "3614729058": "Table 6",
      "9037246815": "Table 7", "1472958630": "Table 8", "6895230174": "Table 9",
      "4260817953": "Table 10", "8531064279": "Table 11", "3749158260": "Table 12",
      "7048263591": "Table 13", "3619470825": "Table 14", "5283701964": "Table 15",
      "9146852037": "Table 16", "2705638149": "Table 17", "6493027581": "Table 18",
      "8027541693": "Table 19", "1359820746": "Table 20",
    };
    if (!tbl[c.trim()]) {
      setErr("Invalid table code. Please check again.");
      setShake(true); setTimeout(() => setShake(false), 600); return;
    }
    window.location.hash = `table=${c.trim()}`;
  };

  const handleInstall = () => { if (isIos) { setIosHint(true); return; } installPrompt?.prompt(); };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 p-4">

      {/* Busy/Closed banner */}
      {busy && (
        <div className="w-full max-w-sm mb-4 bg-red-50 border-2 border-red-200 rounded-2xl p-4 text-center">
          <p className="text-lg mb-1">🔴</p>
          <p className="font-bold text-red-700 text-sm">We're Currently Closed</p>
          <p className="text-xs text-red-600 mt-1">{busy.message || "Please check back later."}</p>
          {busy.opens_at && <p className="text-xs text-red-500 font-bold mt-1">Opens at {busy.opens_at}</p>}
        </div>
      )}

      <div className="text-center mb-7">
        <div className="w-24 h-24 bg-gradient-to-br from-orange-500 to-red-600 rounded-3xl shadow-2xl flex items-center justify-center mx-auto mb-4 text-5xl overflow-hidden">
          {bizSettings.logo_url
            ? <img src={bizSettings.logo_url} alt={bizSettings.restaurant_name} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = "none"; e.target.parentElement.textContent = "🍔"; }} />
            : "🍔"}
        </div>
        <h1 className="text-4xl font-black text-stone-800 tracking-tight">{bizSettings.restaurant_name || "Burger Point"}</h1>
        <p className="text-stone-500 mt-1 text-sm">{bizSettings.address || "Jankipuram, Lucknow"}</p>
        <div className="flex items-center justify-center gap-1 mt-1.5">
          <span className="w-3.5 h-3.5 border-2 border-green-600 rounded-sm bg-white flex items-center justify-center flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-green-600" />
          </span>
          <span className="text-[11px] text-green-700 font-bold">100% Pure Vegetarian</span>
        </div>
      </div>

      {/* Order type blocks — direct 3-tile layout, no modal */}
      {!mode && !busy && (
        <div className="w-full max-w-sm space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: "dine",     icon: "🍽️", label: "Dine-In",   sub: "Table order" },
              { id: "takeaway", icon: "📦", label: "Takeaway",  sub: "Pick up" },
              { id: "delivery", icon: "🛵", label: "Delivery",  sub: "To your door" },
            ].map(m => (
              <button key={m.id} onClick={() => handleOrderTypePick(m.id)}
                className="bg-white border-2 border-orange-100 hover:border-orange-400 active:border-orange-500 rounded-3xl py-5 px-2 flex flex-col items-center gap-1.5 shadow-sm hover:shadow-md transition-all active:scale-95">
                <span className="text-4xl">{m.icon}</span>
                <span className="text-xs font-black text-stone-800">{m.label}</span>
                <span className="text-[10px] text-stone-400 text-center leading-tight">{m.sub}</span>
              </button>
            ))}
          </div>
          <button onClick={() => window.location.hash = "reservation"}
            className="w-full flex items-center justify-center gap-2 bg-white border-2 border-stone-100 text-stone-600 text-sm font-bold py-3 rounded-2xl hover:border-orange-300 hover:text-orange-600 transition-all">
            <CalendarDays size={15} /> Book a Table
          </button>
        </div>
      )}

      {mode === "dine" && (
        <div className={`bg-white rounded-3xl shadow-xl border border-orange-100 p-6 w-full max-w-sm ${shake ? "animate-pulse" : ""}`}>
          <button onClick={() => { setMode(null); setCode(""); setErr(""); }} className="text-xs text-stone-400 flex items-center gap-1 mb-4">
            <ArrowLeft size={12} /> Back
          </button>
          <h2 className="font-bold text-stone-700 text-base mb-1 text-center">Enter Table Code</h2>
          <p className="text-xs text-stone-400 text-center mb-5">10-digit code on your table card</p>
          <div className="relative mb-3">
            <input ref={inputRef} value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0, 10)); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && go(code)}
              placeholder="_ _ _ _ _ _ _ _ _ _" inputMode="numeric"
              className="w-full text-center text-2xl font-black tracking-widest border-2 border-orange-200 focus:border-orange-500 rounded-2xl px-4 py-4 outline-none text-stone-800 transition-colors placeholder:text-stone-200" />
            {code && <button onClick={() => { setCode(""); setErr(""); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300"><X size={16} /></button>}
          </div>
          {err && <p className="text-red-500 text-xs text-center mb-3 font-medium">{err}</p>}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, "←", 0, "Go"].map((k, i) => (
              <button key={i} onClick={() => {
                if (k === "←") { setCode(c => c.slice(0, -1)); setErr(""); }
                else if (k === "Go") go(code);
                else if (code.length < 10) { setCode(c => c + k); setErr(""); }
              }} className={`py-3.5 rounded-2xl font-bold text-base transition-all active:scale-95 ${k === "Go" ? "bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md" : k === "←" ? "bg-stone-100 text-stone-500" : "bg-orange-50 text-stone-700 hover:bg-orange-100"}`}>
                {k}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-stone-300 text-center">Ask staff for your table code</p>
        </div>
      )}

      {!isStandalone && (installPrompt || isIos) && (
        <div className="mt-4 w-full max-w-sm">
          <button onClick={handleInstall}
            className="w-full flex items-center justify-center gap-2 bg-white border border-orange-200 text-orange-700 text-sm font-bold py-3 rounded-2xl shadow-sm hover:shadow-md transition-all">
            <Download size={15} /> Add to Home Screen
          </button>
          {iosHint && (
            <div className="mt-2 bg-orange-50 border border-orange-200 rounded-2xl p-3 text-xs text-orange-800 text-center">
              Tap <strong>Share ↗</strong> → <strong>"Add to Home Screen"</strong> in Safari
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex gap-2 flex-wrap justify-center">
        {[
          { icon: "⭐", label: "Review Us", href: REVIEW_URL, ext: true },
          { icon: "📸", label: "Instagram", href: INSTAGRAM, ext: true },
          { icon: "💬", label: "WhatsApp", href: WHATSAPP, ext: true },
        ].map(l => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 bg-white/80 border border-white text-stone-600 text-xs font-medium px-3 py-2 rounded-2xl shadow-sm hover:shadow-md transition-all">
            {l.icon} {l.label}
          </a>
        ))}
        <button onClick={() => window.location.hash = "privacy"} className="flex items-center gap-1.5 bg-white/80 border border-white text-stone-600 text-xs font-medium px-3 py-2 rounded-2xl shadow-sm hover:shadow-md transition-all">🛡️ Privacy</button>
        <button onClick={() => window.location.hash = "contact"} className="flex items-center gap-1.5 bg-white/80 border border-white text-stone-600 text-xs font-medium px-3 py-2 rounded-2xl shadow-sm hover:shadow-md transition-all">📞 Contact</button>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <p className="text-xs text-white font-semibold">Admin? <button onClick={() => window.location.hash = "admin"} className="bg-orange-500 text-white font-bold px-3 py-1 rounded-lg ml-1 shadow">Login here</button></p>
        <span className="text-stone-200 text-[10px]">·</span>
        <p className="text-xs text-white font-semibold">Rider? <button onClick={() => window.location.hash = "rider"} className="bg-stone-700 text-white font-bold px-3 py-1 rounded-lg ml-1 shadow">Login here</button></p>
      </div>

      {/* ── Update Gate (landing) ── */}
      {showUpdateGate && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center text-3xl mx-auto mb-3">🔄</div>
            <p className="font-black text-stone-800 text-lg">Update Required</p>
            <p className="text-sm text-stone-500 mt-2">A newer version of Burger Point is available. Please update first to place your order — it only takes a second!</p>
            <button onClick={() => { window.__bpApplyUpdate?.(); }}
              className="w-full mt-5 bg-gradient-to-r from-orange-500 to-red-600 text-white py-3 rounded-2xl font-bold text-sm active:scale-95 transition-transform">
              Update Now
            </button>
            <button onClick={() => setShowUpdateGate(false)} className="w-full mt-2 text-xs text-stone-400 py-2">Not now</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CUSTOMER INFO FORM ────────────────────────────────────
export function CustomerInfoForm({ orderType, onSubmit }) {
  const [name,     setName]     = useState("");
  const [phone,    setPhone]    = useState("");
  const [house,    setHouse]    = useState("");   // House/Flat/Shop No.
  const [floor,    setFloor]    = useState("");   // Floor (optional)
  const [street,   setStreet]   = useState("");   // Street / Colony / Mohalla
  const [landmark, setLandmark] = useState("");   // Nearby landmark
  const [err,      setErr]      = useState("");
  const [coords,   setCoords]   = useState(null);  // { lat, lng }
  const [locating, setLocating] = useState(false);
  const [locErr,   setLocErr]   = useState("");
  const [pinMode,  setPinMode]  = useState(false); // manual pin drop mode
  const { settings } = useBusinessSettings();
  const { addresses: savedAddrs, save: saveAddr, remove: removeAddr } = useSavedAddresses();
  const toast = useToast();

  const [roadDistKm,   setRoadDistKm]   = useState(null);
  const [checkingDist, setCheckingDist] = useState(false);

  // Fetch real road distance when coords change
  useEffect(() => {
    if (!coords) { setRoadDistKm(null); return; }
    const rLat = settings.restaurant_lat || 26.926287;
    const rLng = settings.restaurant_lng || 80.942995;
    setCheckingDist(true);
    fetch(`https://router.project-osrm.org/route/v1/driving/${rLng},${rLat};${coords.lng},${coords.lat}?overview=false`)
      .then(r => r.json())
      .then(d => {
        const km = d.routes?.[0]?.distance / 1000;
        setRoadDistKm(km ?? null);
      })
      .catch(() => {
        setRoadDistKm(haversineKm(rLat, rLng, coords.lat, coords.lng));
      })
      .finally(() => setCheckingDist(false));
  }, [coords?.lat, coords?.lng, settings.restaurant_lat, settings.restaurant_lng]);

  const distanceKm = roadDistKm;
  const deliveryPreview = orderType === "delivery"
    ? calculateDelivery(distanceKm, 0, settings)
    : null;

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocErr("Location isn't supported on this browser."); return; }
    setLocating(true); setLocErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setCoords({ lat, lng });
        toast.success("Location captured ✓");
        setLocating(false);
      },
      () => { setLocErr("Couldn't get your location — please allow location access."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Fill form from a saved address
  const applySavedAddress = (a) => {
    setHouse(a.house || "");
    setFloor(a.floor || "");
    setStreet(a.street || "");
    setLandmark(a.landmark || "");
    if (a.lat && a.lng) setCoords({ lat: a.lat, lng: a.lng });
    toast.info("Address loaded");
  };

  const buildAddress = () => {
    const parts = [
      house.trim(),
      floor.trim() ? `Floor ${floor.trim()}` : "",
      street.trim(),
      landmark.trim() ? `Near ${landmark.trim()}` : "",
      "Lucknow",
    ].filter(Boolean);
    return parts.join(", ");
  };

  const submit = () => {
    if (!name.trim())            { setErr("Please enter your name."); return; }
    if (!/^\d{10}$/.test(phone)) { setErr("Enter a valid 10-digit phone number."); return; }
    if (orderType === "delivery") {
      if (!house.trim())   { setErr("Please enter house/flat/shop number."); return; }
      if (!street.trim())  { setErr("Please enter street / colony name."); return; }
      if (deliveryPreview?.deliverable === false) { setErr(deliveryPreview.reason); return; }
      // Save address for next time
      const full = buildAddress();
      if (full.length > 5) {
        saveAddr({
          label: house.trim().slice(0, 30),
          house: house.trim(), floor: floor.trim(),
          street: street.trim(), landmark: landmark.trim(),
          lat: coords?.lat ?? null, lng: coords?.lng ?? null,
          fullAddress: full,
        });
      }
    }
    onSubmit({ name: name.trim(), phone, address: buildAddress(), lat: coords?.lat ?? null, lng: coords?.lng ?? null });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-orange-100 p-6">
        <button onClick={() => window.location.hash = ""} className="text-xs text-stone-400 flex items-center gap-1 mb-4"><ArrowLeft size={12} /> Back</button>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-amber-100 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-3">
            {orderType === "delivery" ? "🛵" : "📦"}
          </div>
          <h2 className="font-black text-stone-800 text-xl">{orderType === "delivery" ? "Delivery Order" : "Takeaway Order"}</h2>
          <p className="text-xs text-stone-400 mt-1">Fill in your details to continue</p>
        </div>
        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Your Name *</label>
            <div className="relative">
              <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input value={name} onChange={e => { setName(e.target.value); setErr(""); }} placeholder="e.g. Rahul Sharma"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl pl-9 pr-4 py-3 outline-none text-stone-700 transition-colors" />
            </div>
          </div>
          {/* Phone */}
          <div>
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Phone Number *</label>
            <div className="relative">
              <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setErr(""); }} placeholder="10-digit mobile number" inputMode="numeric"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl pl-9 pr-4 py-3 outline-none text-stone-700 transition-colors" />
            </div>
          </div>

          {/* Address fields — delivery only */}
          {orderType === "delivery" && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1 mt-1">
                <MapPin size={9} /> Delivery Address
              </p>

              {/* Saved addresses */}
              <SavedAddressPicker
                addresses={savedAddrs}
                onSelect={applySavedAddress}
                onRemove={removeAddr}
              />

              {/* Location capture for distance-based delivery fee */}
              <div className="flex gap-2">
                <button type="button" onClick={useMyLocation} disabled={locating}
                  className="flex-1 flex items-center justify-center gap-2 text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 rounded-xl py-2.5 disabled:opacity-60">
                  <Navigation size={13} /> {locating ? "Locating…" : coords ? "📍 Location saved — refresh" : "📍 Use my location"}
                </button>
                <button type="button"
                  onClick={() => {
                    toast.info("Open Google Maps, long-press your building, then share the coordinates with us in the order note.");
                  }}
                  className="flex items-center justify-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
                  📌 Pin
                </button>
              </div>
              {locErr && <p className="text-[11px] text-amber-600">{locErr}</p>}
              {deliveryPreview && coords && (
                deliveryPreview.deliverable ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700 flex items-center justify-between">
                    <span>{checkingDist ? "Checking road distance…" : `${deliveryPreview.distanceKm.toFixed(1)} km (road) · ~${deliveryPreview.etaMinutes} min`}</span>
                    <span className="font-bold">{deliveryPreview.freeDelivery ? "FREE delivery" : `+₹${deliveryPreview.fee} delivery`}</span>
                  </div>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">
                    {deliveryPreview.reason}
                  </div>
                )
              )}

              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3 space-y-2">

                {/* House / Flat / Shop No */}
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 block mb-1">🏠 House / Flat / Shop No. *</label>
                  <input value={house} onChange={e => { setHouse(e.target.value); setErr(""); }}
                    placeholder="e.g. H-42, Flat 3B, Shop 7"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700 bg-white" />
                </div>

                {/* Floor (optional) */}
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 block mb-1">🏢 Floor <span className="font-normal text-stone-400">(optional)</span></label>
                  <input value={floor} onChange={e => { setFloor(e.target.value); setErr(""); }}
                    placeholder="e.g. Ground, 1st, 2nd"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700 bg-white" />
                </div>

                {/* Street / Colony */}
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 block mb-1">🛣️ Street / Colony / Mohalla *</label>
                  <input value={street} onChange={e => { setStreet(e.target.value); setErr(""); }}
                    placeholder="e.g. Sector C, Jankipuram"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700 bg-white" />
                </div>

                {/* Landmark */}
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 block mb-1">📍 Nearby Landmark <span className="font-normal text-stone-400">(optional)</span></label>
                  <input value={landmark} onChange={e => { setLandmark(e.target.value); setErr(""); }}
                    placeholder="e.g. Near City Hospital, Opp. Park"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700 bg-white" />
                </div>
              </div>

              {/* Address preview */}
              {(house || street) && (
                <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                  <p className="text-[10px] font-bold text-green-600 mb-0.5">📋 Address Preview</p>
                  <p className="text-xs text-stone-600">{buildAddress()}</p>
                </div>
              )}

              <p className="text-[10px] text-orange-500 flex items-center gap-1"><Navigation size={9} /> We deliver within 5 km of Jankipuram</p>
            </div>
          )}
        </div>
        {err && <p className="text-red-500 text-xs mt-3 font-medium text-center">{err}</p>}
        <button onClick={submit} className="w-full mt-5 bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-2xl font-bold text-sm shadow-md active:scale-95 transition-transform">
          {orderType === "delivery" ? "🛵 Continue to Menu" : "📦 Continue to Menu"}
        </button>
      </div>
    </div>
  );
}

// ── RESERVATION PAGE ──────────────────────────────────────
export function ReservationPage() {
  const [name,   setName]   = useState("");
  const [phone,  setPhone]  = useState("");
  const [date,   setDate]   = useState("");
  const [time,   setTime]   = useState("");
  const [guests, setGuests] = useState(2);
  const [note,   setNote]   = useState("");
  const [err,    setErr]    = useState("");
  const [done,   setDone]   = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim())            { setErr("Please enter your name."); return; }
    if (!/^\d{10}$/.test(phone)) { setErr("Enter a valid 10-digit phone number."); return; }
    if (!date)                   { setErr("Please select a date."); return; }
    if (!time)                   { setErr("Please select a time."); return; }
    setSaving(true);
    if (SUPABASE_READY) {
      await supabase.from("reservations").insert({ name: name.trim(), phone, date, time, guests, note: note.trim(), status: "pending" });
    }
    setSaving(false);
    setDone(true);
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-orange-100 p-6">
        <button onClick={() => window.location.hash = ""} className="text-xs text-stone-400 flex items-center gap-1 mb-4"><ArrowLeft size={12} /> Back</button>
        {done ? (
          <div className="text-center py-6">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="font-black text-stone-800 text-xl mb-2">Booking Requested!</h2>
            <p className="text-sm text-stone-500 mb-1">We'll confirm on WhatsApp or call within 30 mins.</p>
            <p className="text-sm text-stone-500 mb-5">For {guests} guests on {date} at {time}</p>
            <a href={WHATSAPP} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 bg-green-500 text-white font-bold text-sm px-5 py-3 rounded-2xl shadow-sm">
              💬 Chat with us on WhatsApp
            </a>
          </div>
        ) : (
          <>
            <div className="text-center mb-5">
              <div className="w-14 h-14 bg-orange-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3">📅</div>
              <h2 className="font-black text-stone-800 text-xl">Book a Table</h2>
              <p className="text-xs text-stone-400 mt-1">Reserve your spot at Burger Point</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Name *</label>
                <div className="relative">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input value={name} onChange={e => { setName(e.target.value); setErr(""); }} placeholder="Your name"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl pl-9 pr-4 py-3 outline-none text-stone-700" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Phone *</label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setErr(""); }} placeholder="10-digit number" inputMode="numeric"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl pl-9 pr-4 py-3 outline-none text-stone-700" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Date *</label>
                  <input type="date" value={date} min={today} onChange={e => { setDate(e.target.value); setErr(""); }}
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl px-3 py-3 outline-none text-stone-700" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Time *</label>
                  <select value={time} onChange={e => { setTime(e.target.value); setErr(""); }}
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl px-3 py-3 outline-none text-stone-700">
                    <option value="">Select…</option>
                    {["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM"].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">No. of Guests</label>
                <div className="flex items-center gap-3 bg-stone-50 rounded-xl px-4 py-2.5">
                  <button onClick={() => setGuests(g => Math.max(1, g - 1))} className="w-8 h-8 flex items-center justify-center"><Minus size={14} className="text-stone-600" /></button>
                  <span className="flex-1 text-center text-sm font-black text-stone-800">{guests} {guests === 1 ? "person" : "people"}</span>
                  <button onClick={() => setGuests(g => Math.min(20, g + 1))} className="w-8 h-8 flex items-center justify-center"><Plus size={14} className="text-stone-600" /></button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Special Note</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Birthday, anniversary, dietary requirements…"
                  className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-2xl px-4 py-3 outline-none text-stone-700 resize-none h-16" />
              </div>
            </div>
            {err && <p className="text-red-500 text-xs mt-3 text-center">{err}</p>}
            <button onClick={submit} disabled={saving} className="w-full mt-5 bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-2xl font-bold text-sm shadow-md active:scale-95 transition-transform disabled:opacity-60">
              {saving ? "Booking…" : "📅 Request Booking"}
            </button>
            <p className="text-[10px] text-stone-400 text-center mt-2">We'll confirm via WhatsApp or phone call</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── PRIVACY PAGE ──────────────────────────────────────────
export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="max-w-2xl mx-auto px-5 py-8">
        <button onClick={() => window.history.back()} className="flex items-center gap-2 text-stone-500 text-sm mb-6 hover:text-orange-600 transition-colors"><ArrowLeft size={15} /> Back</button>
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-orange-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center"><Shield size={22} className="text-blue-600" /></div>
            <div><h1 className="font-black text-stone-800 text-xl">Privacy Policy</h1><p className="text-xs text-stone-400">Burger Point · Last updated: July 2025</p></div>
          </div>
          {[
            { t: "Information We Collect", b: "We collect your name, phone number, and delivery address only when you place a delivery or takeaway order. For dine-in, no personal information is required. We also collect your order details to process your order." },
            { t: "How We Use Your Information", b: "Your information is used solely to process and deliver your order. We use your phone number to contact you if needed. Your address is used only for routing delivery. We do not use your data for marketing without consent." },
            { t: "Data Sharing", b: "We share your name and phone with our delivery riders only when needed to complete your delivery. We never sell or share your personal information with third parties for marketing purposes." },
            { t: "Payment Security", b: "Payments processed through Razorpay are encrypted end-to-end using 256-bit SSL. We do not store card numbers, CVV, or UPI credentials on our servers." },
            { t: "Data Storage", b: "Your order data is stored securely for up to 90 days for business purposes and then deleted. We do not store payment instrument details." },
            { t: "Your Rights", b: "You have the right to request deletion of your personal data. Contact us via WhatsApp at +91 91940 08822. We will process your request within 7 business days." },
          ].map((s, i) => (
            <div key={i} className="mb-5">
              <h2 className="font-bold text-stone-800 text-sm mb-2">{i + 1}. {s.t}</h2>
              <p className="text-sm text-stone-600 leading-relaxed">{s.b}</p>
            </div>
          ))}
          <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
            <p className="text-xs font-bold text-orange-800 mb-1">Contact for Privacy Concerns</p>
            <p className="text-xs text-stone-600">WhatsApp: <a href="https://wa.me/919194008822" className="text-orange-600 font-semibold">+91 91940 08822</a></p>
            <p className="text-xs text-stone-600 mt-0.5">Email: <a href="mailto:burgerpoint.lko@gmail.com" className="text-orange-600 font-semibold">burgerpoint.lko@gmail.com</a></p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CONTACT PAGE ──────────────────────────────────────────
export function ContactPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="max-w-2xl mx-auto px-5 py-8">
        <button onClick={() => window.history.back()} className="flex items-center gap-2 text-stone-500 text-sm mb-6 hover:text-orange-600 transition-colors"><ArrowLeft size={15} /> Back</button>
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-orange-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center text-2xl">🍔</div>
            <div><h1 className="font-black text-stone-800 text-xl">Contact Us</h1><p className="text-xs text-stone-400">We'd love to hear from you</p></div>
          </div>
          <div className="space-y-3">
            {[
              { icon: "📍", label: "Address", val: "Shop 647/020-CC, 60 Feet Road, Jankipuram, Lucknow, UP — 226021", href: "https://maps.google.com/?q=Burger+Point+Jankipuram+Lucknow", linkText: "Get Directions" },
              { icon: "📞", label: "Phone", val: "+91 91940 08822", href: "tel:+919194008822" },
              { icon: "💬", label: "WhatsApp", val: "Chat with us on WhatsApp", href: WHATSAPP },
              { icon: "📸", label: "Instagram", val: "@burgerpoint_as", href: INSTAGRAM },
              { icon: "🕐", label: "Opening Hours", val: "Mon – Sun: 11:00 AM – 10:30 PM", href: null },
            ].map((c, i) => (
              <div key={i} className="flex items-start gap-4 bg-stone-50 rounded-2xl p-4">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-xl flex-shrink-0 shadow-sm">{c.icon}</div>
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{c.label}</p>
                  <p className="text-sm text-stone-700 mt-0.5">{c.val}</p>
                  {c.href && <a href={c.href} target={c.href.startsWith("http") ? "_blank" : "_self"} rel="noreferrer" className="text-xs text-orange-500 font-semibold mt-1 inline-block">{c.linkText || "Open →"}</a>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl p-4 text-white text-center">
            <p className="font-bold text-sm">Quick Query?</p>
            <p className="text-xs text-orange-100 mt-1 mb-3">We respond within 30 mins during working hours</p>
            <a href="https://wa.me/919194008822?text=Hi%20Burger%20Point%2C%20I%20have%20a%20query..." target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 bg-white text-orange-600 font-bold text-sm px-5 py-2.5 rounded-xl shadow-sm">
              💬 WhatsApp Us Now
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
