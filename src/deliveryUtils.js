// ─────────────────────────────────────────────────────────
//  Delivery distance + fee calculation.
//
//  Distance is straight-line (haversine), not true road distance —
//  a real road-routing figure needs a paid API (Google Distance
//  Matrix, OSRM, etc.) with a server-side key. Haversine is the
//  standard lightweight approximation used by most small delivery
//  apps for tiered pricing; swap `haversineKm` for a routing-API
//  call later if you get a maps API key.
// ─────────────────────────────────────────────────────────

export function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v == null || Number.isNaN(v))) return null;
  const R = 6371; // km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Returns { deliverable, distanceKm, fee, reason, freeDelivery, etaMinutes }
 * settings = row from business_settings table
 */
export function calculateDelivery(distanceKm, subtotal, settings) {
  if (distanceKm == null) {
    return { deliverable: null, distanceKm: null, fee: 0, reason: null, freeDelivery: false, etaMinutes: null };
  }
  const {
    delivery_radius_km = 8,
    base_delivery_charge = 25,
    base_distance_km = 2,
    per_km_charge = 8,
    free_delivery_above = 499,
    avg_delivery_speed_kmph = 25,
  } = settings || {};

  if (distanceKm > delivery_radius_km) {
    return {
      deliverable: false,
      distanceKm,
      fee: 0,
      reason: `Sorry, you're ${distanceKm.toFixed(1)} km away — we currently deliver up to ${delivery_radius_km} km. Try Takeaway instead, or check back once you're closer!`,
      freeDelivery: false,
      etaMinutes: null,
    };
  }

  const freeDelivery = free_delivery_above > 0 && subtotal >= free_delivery_above;
  let fee = base_delivery_charge;
  if (distanceKm > base_distance_km) {
    fee += Math.ceil(distanceKm - base_distance_km) * per_km_charge;
  }
  if (freeDelivery) fee = 0;

  const etaMinutes = Math.max(15, Math.round((distanceKm / Math.max(avg_delivery_speed_kmph, 1)) * 60) + 15); // + prep time

  return { deliverable: true, distanceKm, fee, reason: null, freeDelivery, etaMinutes };
}
