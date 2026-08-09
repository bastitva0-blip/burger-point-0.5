import { useState, useEffect } from "react";
import { getRoute, clearTableSession } from "./constants.js";
import {
  LandingPage, CustomerApp,
  PrivacyPage, ContactPage, ReservationPage,
} from "./CustomerApp.jsx";
import AdminApp from "./AdminApp.jsx";
import RiderApp from "./RiderApp.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

// ── Reset confirmation screen ─────────────────────────────
// Shown briefly after #reset-order clears the stuck order, then redirects.
function ResetOrderPage() {
  useEffect(() => {
    const t = setTimeout(() => {
      window.location.replace(window.location.pathname + window.location.search);
    }, 2000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-orange-50 gap-4 p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">✅</div>
      <p className="font-black text-stone-800 text-lg">Screen cleared!</p>
      <p className="text-sm text-stone-500">Taking you back to the menu…</p>
      <div className="flex gap-1.5">
        {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay:`${i*0.15}s` }} />)}
      </div>
    </div>
  );
}

export default function App() {
  const [route,         setRoute]         = useState(getRoute);
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    const onHash = () => { setRoute(getRoute()); };
    const onBeforeInstall = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const { page, code, label } = route;

  const content = (() => {
    if (page === "admin")        return <AdminApp />;
    if (page === "rider")        return <RiderApp />;
    if (page === "privacy")      return <PrivacyPage />;
    if (page === "contact")      return <ContactPage />;
    if (page === "reservation")  return <ReservationPage />;
    if (page === "takeaway")     return <CustomerApp orderType="takeaway" />;
    if (page === "delivery")     return <CustomerApp orderType="delivery" />;
    if (page === "customer")     return <CustomerApp code={code} tableLabel={label} orderType="dine-in" />;
    if (page === "reset-order")  return <ResetOrderPage />;
    return <LandingPage installPrompt={installPrompt} />;
  })();

  const boundaryLabel = page === "admin" ? "Admin dashboard" : page === "rider" ? "Rider app" : "This page";
  return <ErrorBoundary label={boundaryLabel}>{content}</ErrorBoundary>;
}
