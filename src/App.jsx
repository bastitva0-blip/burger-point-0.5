import { useState, useEffect } from "react";
import { getRoute, clearTableSession } from "./constants.js";
import {
  LandingPage, CustomerApp,
  PrivacyPage, ContactPage, ReservationPage,
} from "./CustomerApp.jsx";
import AdminApp from "./AdminApp.jsx";
import RiderApp from "./RiderApp.jsx";

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

  if (page === "admin")       return <AdminApp />;
  if (page === "rider")       return <RiderApp />;
  if (page === "privacy")     return <PrivacyPage />;
  if (page === "contact")     return <ContactPage />;
  if (page === "reservation") return <ReservationPage />;
  if (page === "takeaway")    return <CustomerApp orderType="takeaway" />;
  if (page === "delivery")    return <CustomerApp orderType="delivery" />;
  if (page === "customer")    return <CustomerApp code={code} tableLabel={label} orderType="dine-in" />;
  return <LandingPage installPrompt={installPrompt} />;
}
