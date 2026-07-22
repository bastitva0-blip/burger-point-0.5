#adminpanel 
import { useState, useEffect, useCallback, useRef } from "react";
import QRCode from "qrcode";
import { useToast, OrderCardSkeleton, SalesSkeleton, CustomerRowSkeleton, RiderCardSkeleton } from "./ui.jsx";
import {
  Plus, Trash2, Edit2, X, LogOut, RefreshCw,
  CheckCircle, Users, BarChart2, Settings, ShoppingBag,
  Wifi, WifiOff, ArrowLeft, Phone, Lock, Eye, EyeOff,
  Bike, Tag, CalendarDays, Clock, ToggleLeft, ToggleRight,
  Image, ChevronDown, ChevronUp, Save, Printer,
  Search, LayoutGrid, XCircle,
} from "lucide-react";
import { supabase } from "./supabase.js";
import {
  ADMIN_PASSWORD, SUPABASE_READY, STATUS_CFG, getNextStep, CATEGORIES, DEFAULT_MENU, ALL_ITEMS, TABLE_CODES,
  CANCEL_REASONS, ACTIVE_STATUSES,
} from "./constants.js";
import { useBusinessSettings } from "./useBusinessSettings.js";

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
const normalise = row => ({
  ...row,
  time: new Date(row.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  items: Array.isArray(row.items) ? row.items : [],
});

const currency = n => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// ─────────────────────────────────────────────────────────
//  ESC/POS THERMAL PRINTER  (WebUSB — 80 mm roll, ~42 chars)
// ─────────────────────────────────────────────────────────

/* ESC/POS byte constants */
const ESC = 0x1B;
const GS  = 0x1D;
const LF  = 0x0A;

const P_INIT        = [ESC, 0x40];          // Reset / initialize
const P_CUT         = [GS,  0x56, 0x42, 0x05]; // Partial cut + 5-line feed
const P_LEFT        = [ESC, 0x61, 0x00];    // Left align
const P_CENTER      = [ESC, 0x61, 0x01];    // Center align
const P_BOLD_ON     = [ESC, 0x45, 0x01];    // Bold on
const P_BOLD_OFF    = [ESC, 0x45, 0x00];    // Bold off
const P_DOUBLE_ON   = [ESC, 0x21, 0x30];    // 2× height + 2× width
const P_DOUBLE_OFF  = [ESC, 0x21, 0x00];    // Normal font size
const P_FEED        = [ESC, 0x64, 0x03];    // Feed 3 lines

const PW = 42; // characters per line on an 80 mm roll

/* Text layout helpers */
const pLine   = (t, w = PW) => { const s = String(t ?? ""); return s.length >= w ? s.slice(0, w) : s.padEnd(w, " "); };
const pCenter = (t, w = PW) => { const s = String(t ?? ""); if (s.length >= w) return s.slice(0, w); return " ".repeat(Math.floor((w - s.length) / 2)) + s; };
const pRow    = (l, r, w = PW) => { const ls = String(l ?? ""), rs = String(r ?? ""); const gap = w - ls.length - rs.length; return gap <= 0 ? (ls + " " + rs).slice(0, w) : ls + " ".repeat(gap) + rs; };
const pDiv    = (c = "-", w = PW) => c.repeat(w);

/* Convert a string to UTF-8 bytes (handles ₹ via code-page override below) */
function strToBytes(text) {
  // Replace ₹ with "Rs." since most budget thermal printers lack Unicode ₹
  const safe = text.replace(/₹/g, "Rs.");
  return Array.from(new TextEncoder().encode(safe));
}

/* Build final Uint8Array from a mix of byte-arrays and strings */
function buildEscPos(cmds) {
  const bytes = [];
  for (const cmd of cmds) {
    if (Array.isArray(cmd))       bytes.push(...cmd);
    else if (typeof cmd === "string") bytes.push(...strToBytes(cmd), LF);
  }
  return new Uint8Array(bytes);
}

/* ── Module-level USB state (survives React re-renders) ── */
let _usbDev = null;
let _usbEp  = null;

export async function connectUsbPrinter() {
  const dev = await navigator.usb.requestDevice({ filters: [{ classCode: 0x07 }] });
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  let found = false;
  for (let i = 0; i < (dev.configuration?.interfaces?.length ?? 0); i++) {
    try {
      await dev.claimInterface(i);
      const alt = dev.configuration.interfaces[i].alternates[0];
      for (const ep of alt.endpoints) {
        if (ep.direction === "out" && ep.type === "bulk") { _usbEp = ep.endpointNumber; found = true; break; }
      }
      if (found) break;
    } catch { /* try next interface */ }
  }
  if (!found) throw new Error("No bulk-OUT endpoint found on this printer.");
  _usbDev = dev;
  return dev.productName || "USB Printer";
}

export async function sendToPrinter(buffer) {
  if (!_usbDev) throw new Error("Printer not connected.");
  const CHUNK = 16384;
  for (let off = 0; off < buffer.length; off += CHUNK) {
    await _usbDev.transferOut(_usbEp, buffer.slice(off, off + CHUNK));
  }
}

/* ── KOT (Kitchen Order Ticket) layout ── */
export function buildKOT(order) {
  const now  = new Date();
  const ds   = now.toLocaleDateString("en-IN");
  const ts   = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const who  = order.table_label || order.customer_name || ("Order #" + (String(order.id ?? "").slice(-4)));
  const type = (order.order_type || "dine-in").toUpperCase();
  const bill = String(order.id ?? "").slice(-6).toUpperCase() || "------";

  const cmds = [
    P_INIT,
    P_CENTER, P_BOLD_ON, P_DOUBLE_ON, "BURGER POINT", P_DOUBLE_OFF,
    P_CENTER, "** KITCHEN ORDER TICKET **", P_BOLD_OFF,
    P_LEFT, pDiv("="),
    pRow("Date: " + ds, "Time: " + ts),
    pRow("Bill: " + bill,        "Type: " + type),
    "For : " + who,
    pDiv("="),
    P_BOLD_ON, pRow(pLine("ITEM", PW - 6), "  QTY"), P_BOLD_OFF,
    pDiv("-"),
  ];

  for (const it of (order.items || [])) {
    const name = it.name + (it.selectedVariant ? ` (${it.selectedVariant})` : "");
    const qty  = String(it.qty || 1);
    if (name.length > PW - qty.length - 3) {
      cmds.push(name.slice(0, PW));
      cmds.push(pRow("", qty));
    } else {
      cmds.push(pRow(name, qty));
    }
    if (it.addonLabels?.length) cmds.push("  + " + it.addonLabels.join(", "));
  }

  cmds.push(pDiv("-"));
  if (order.note) { cmds.push(P_BOLD_ON, "NOTE: " + order.note, P_BOLD_OFF, pDiv("-")); }
  cmds.push(P_CENTER, "-- KOT Printed --", "", P_FEED, P_CUT);
  return buildEscPos(cmds);
}

/* ── Customer Invoice layout ── */
export function buildInvoice(order, settings = {}) {
  const rName  = settings.restaurant_name || "Burger Point";
  const rAddr  = settings.address         || "60 Feet Road, Jankipuram, Lucknow";
  const rPhone = settings.phone           || "+91 9194008822";
  const gstNo  = settings.gst_number      || "09ACOFA177BK1ZS";
  const gstPct = Number(settings.gst_percent ?? 0);

  const now     = new Date();
  const ds      = now.toLocaleDateString("en-IN");
  const ts      = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const billNo  = String(order.id ?? "").slice(-6).toUpperCase() || "------";

  const items     = order.items || [];
  const subTotal  = items.reduce((s, it) => s + Number(it.finalPrice || it.price || 0) * Number(it.qty || 1), 0);
  const discount  = Number(order.discount || 0);
  const packing   = Number(order.packing_charge ?? order.packingCharge ?? settings.packing_charge ?? 0);
  const gstAmt    = gstPct > 0 ? Math.round((subTotal - discount) * gstPct / 100) : 0;
  const grandTotal = Number(order.total || (subTotal - discount + packing + gstAmt));
  const cur       = (n) => "Rs." + Number(n || 0).toFixed(2);

  const cmds = [
    P_INIT,
    P_CENTER, P_BOLD_ON, P_DOUBLE_ON, rName, P_DOUBLE_OFF,
    pCenter(rAddr),
    pCenter("Ph: " + rPhone),
    pCenter("GSTIN: " + gstNo),
    P_BOLD_OFF, P_LEFT, pDiv("="),
    P_BOLD_ON, pCenter("CUSTOMER INVOICE"), P_BOLD_OFF,
    pDiv("="),
  ];

  // Order meta block
  const meta = [
    ["Bill No ", billNo],
    ["Date    ", ds + "  " + ts],
    ["Type    ", (order.order_type || "dine-in").toUpperCase()],
  ];
  if (order.platform || order.source) meta.unshift(["Platform", order.platform || order.source]);
  if (order.table_label)    meta.push(["Table   ", order.table_label]);
  if (order.customer_name)  meta.push(["Customer", order.customer_name]);
  if (order.customer_phone) meta.push(["Phone   ", order.customer_phone]);
  if (order.payment_method) meta.push(["Payment ", order.payment_method.toUpperCase()]);
  meta.forEach(([k, v]) => cmds.push(pRow(k + ":", v)));

  // Items table header
  cmds.push(pDiv("-"));
  const COL = { name: 22, qty: 5, price: 7, amt: 7 }; // name+qty+price+amt = 41 + spaces
  cmds.push(
    P_BOLD_ON,
    pLine("ITEM", COL.name).padEnd(COL.name) + " " +
    "QTY".padStart(COL.qty) + " " +
    "RATE".padStart(COL.price) + " " +
    "AMT".padStart(COL.amt),
    P_BOLD_OFF,
    pDiv("-"),
  );

  for (const it of items) {
    const name  = (it.name + (it.selectedVariant ? ` (${it.selectedVariant})` : "")).slice(0, COL.name);
    const qty   = String(it.qty || 1).padStart(COL.qty);
    const rate  = ("Rs." + Number(it.finalPrice || it.price || 0).toFixed(0)).padStart(COL.price);
    const amt   = ("Rs." + (Number(it.finalPrice || it.price || 0) * Number(it.qty || 1)).toFixed(0)).padStart(COL.amt);
    cmds.push(name.padEnd(COL.name) + " " + qty + " " + rate + " " + amt);
    if (it.addonLabels?.length) cmds.push("  +Addons: " + it.addonLabels.join(", "));
  }

  // Totals
  cmds.push(pDiv("-"));
  cmds.push(pRow("Sub Total", cur(subTotal)));
  if (discount > 0)   cmds.push(pRow("Discount Fixed", "-" + cur(discount)));
  if (packing > 0)    cmds.push(pRow("Packaging Charge", cur(packing)));
  if (gstAmt > 0)     cmds.push(pRow(`GST (${gstPct}%)`, cur(gstAmt)));
  if (order.promo_code) cmds.push(pRow("Promo: " + order.promo_code, "Applied"));

  cmds.push(pDiv("="));
  cmds.push(P_BOLD_ON, pRow("GRAND TOTAL", cur(grandTotal)), P_BOLD_OFF);
  cmds.push(pDiv("="));

  // Footer
  cmds.push(
    P_CENTER,
    "Tax to be paid under section 9(5) by Eco",
    "",
    P_BOLD_ON, "*** Thanks, Visit Again! ***", P_BOLD_OFF,
    "Follow us @burgerpoint_as",
    "", "", P_FEED, P_CUT,
  );

  return buildEscPos(cmds);
}

/* ── HTML Window Print (80 mm thermal) ── */
const THERMAL_CSS = `
  @page { size: 80mm auto; margin: 1mm 2mm; }
  * { box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 14px;
    font-weight: 800;
    line-height: 1.35;
    width: 76mm;
    color: #000;
    background: #fff;
    text-shadow: 0 0 0.7px #000, 0 0 0.4px #000;
    -webkit-text-stroke: 0.2px #000;
  }
  .brand {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 20px; font-weight: 900;
    text-align: center; letter-spacing: 0.5px;
    text-shadow: 0 0 1.5px #000, 0 0 0.8px #000;
  }
  .subinfo { font-size: 12px; text-align: center; font-weight: 700; line-height: 1.3; }
  .section-head {
    font-size: 14px; font-weight: 900; text-align: center;
    text-shadow: 0 0 1px #000;
    margin: 2px 0 1px;
  }
  .div-eq   { border-top: 3px solid #000; margin: 3px 0; }
  .div-2eq  { border-top: 3px double #000; margin: 3px 0; }
  .div-dash { border-top: 2px dashed #000; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; }
  td    { vertical-align: top; padding: 2px 0; font-size: 14px; font-weight: 800; }
  td.lbl { width: 50%; }
  td.val { text-align: right; }
  td.bold-lbl { font-weight: 900; font-size: 14px; }
  .items-head td { font-size: 14px; font-weight: 900;
                   border-bottom: 2px dashed #000; padding-bottom: 2px; }
  .item-row td  { padding: 2px 0; }
  .addon  { font-size: 12px; font-weight: 700; padding-left: 6px; }
  .totals td { font-size: 14px; padding: 2px 0; }
  .grand-row td {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 19px; font-weight: 900;
    padding: 4px 0;
    text-shadow: 0 0 1.5px #000, 0 0 0.8px #000;
    -webkit-text-stroke: 0.3px #000;
  }
  .paid-badge {
    display: flex; justify-content: space-between;
    font-size: 13px; font-weight: 900;
    margin-bottom: 2px;
  }
  .footer {
    text-align: center; font-size: 13px; font-weight: 800;
    margin-top: 1px; line-height: 1.3;
  }
  .thanks {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 16px; font-weight: 900;
    text-align: center; margin-top: 2px;
    text-shadow: 0 0 1px #000;
  }
`;

function buildReceiptHTML(order, settings = {}, isKOT = false) {
  const rName  = settings.restaurant_name || "Burger Point";
  const rAddr  = settings.address         || "60 Feet Road, Jankipuram, Lucknow";
  const rPhone = settings.phone           || "+91 9194008822";
  const gstNo  = settings.gst_number      || "09ACOFA177BK1ZS";
  const gstPct = Number(settings.gst_percent ?? 0);

  const now  = new Date();
  const ds   = now.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
  const ts   = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const billNo = String(order.id ?? "").slice(-6).toUpperCase() || "------";

  const items     = order.items || [];
  const totalQty  = items.reduce((s, it) => s + Number(it.qty || 1), 0);
  const subTotal  = items.reduce((s, it) => s + Number(it.finalPrice || it.price || 0) * Number(it.qty || 1), 0);
  const discount  = Number(order.discount || 0);
  const packing   = Number(order.packing_charge ?? order.packingCharge ?? settings.packing_charge ?? 0);
  const taxable   = subTotal - discount;
  const gstAmt    = gstPct > 0 ? Math.round(taxable * gstPct / 100) : 0;
  const grandTotal = Number(order.total || (taxable + packing + gstAmt));
  const cur = (n) => "Rs." + Number(n || 0).toFixed(0);

  // ── KOT ─────────────────────────────────────────────────
  if (isKOT) {
    const kotNo = String(order.id ?? "").slice(-4).toUpperCase();
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>KOT</title><style>${THERMAL_CSS}</style></head><body>
    <div class="brand">${rName}</div>
    <div class="section-head">** KITCHEN ORDER **</div>
    <div class="div-eq"></div>
    <table>
      <tr><td class="lbl">KOT No</td><td class="val bold-lbl">${kotNo}</td></tr>
      <tr><td class="lbl">Time</td><td class="val">${ts}</td></tr>
      <tr><td class="lbl">Date</td><td class="val">${ds}</td></tr>
      <tr><td class="lbl">Type</td><td class="val">${(order.order_type||"dine-in").toUpperCase()}</td></tr>
      ${order.table_label ? `<tr><td class="lbl bold-lbl">Table</td><td class="val bold-lbl">${order.table_label}</td></tr>` : ""}
    </table>
    <div class="div-dash"></div>
    <table>
      <tr class="items-head">
        <td>ITEM</td>
        <td align="right">QTY</td>
      </tr>
      ${items.map(it => `
        <tr class="item-row">
          <td>${it.name}${it.selectedVariant ? ` (${it.selectedVariant})` : ""}</td>
          <td align="right" style="font-size:18px;font-weight:900;">${it.qty || 1}</td>
        </tr>
        ${it.addonLabels?.length ? `<tr><td class="addon" colspan="2">+ ${it.addonLabels.join(", ")}</td></tr>` : ""}
      `).join("")}
    </table>
    ${order.note ? `<div class="div-dash"></div><div style="font-size:14px;"><b>Note:</b> ${order.note}</div>` : ""}
    <div class="div-eq"></div>
    <div class="footer">-- KOT Printed --</div>
    </body></html>`;
  }

  // ── INVOICE ──────────────────────────────────────────────
  const isPaid = order.payment_method && order.payment_method.toLowerCase() !== "pending";
  const payLabel = (order.payment_method || "").toUpperCase();
  const orderType = (order.order_type || "dine-in").replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  const orderSource = order.platform || order.source || "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <title>Invoice</title><style>${THERMAL_CSS}</style></head><body>

  ${isPaid ? `<div class="paid-badge"><span>✓ PAID</span><span>PAID ✓</span></div>` : ""}

  <div class="brand">${rName}</div>
  <div class="subinfo">
    ${rAddr}<br/>
    Mob: ${rPhone}<br/>
    GSTIN: ${gstNo}
  </div>

  <div class="div-dash"></div>
  <table>
    ${orderSource ? `<tr><td class="lbl">Order Source</td><td class="val">${orderSource}</td></tr>` : ""}
    <tr><td class="lbl">Order ID</td><td class="val">#${billNo}</td></tr>
    ${order.customer_name  ? `<tr><td class="lbl">Customer</td><td class="val">${order.customer_name}</td></tr>` : ""}
    ${order.customer_phone ? `<tr><td class="lbl">Phone</td><td class="val">${order.customer_phone}</td></tr>` : ""}
  </table>

  <div class="div-dash"></div>
  <table>
    <tr><td class="lbl">Date</td><td class="val">${ds}</td></tr>
    <tr><td class="lbl">Time</td><td class="val">${ts}</td></tr>
    <tr><td class="lbl">Order Type</td><td class="val">${orderType}</td></tr>
    ${order.table_label ? `<tr><td class="lbl">Table</td><td class="val">${order.table_label}</td></tr>` : ""}
    <tr><td class="lbl bold-lbl">Bill No</td><td class="val bold-lbl">${billNo}</td></tr>
  </table>

  <div class="div-dash"></div>
  <table>
    <tr class="items-head">
      <td style="width:42%">Item</td>
      <td align="center" style="width:10%">Qty</td>
      <td align="right" style="width:20%">Rate</td>
      <td align="right" style="width:28%">Amt</td>
    </tr>
    ${items.map(it => {
      const rate = Number(it.finalPrice || it.price || 0);
      const qty  = Number(it.qty || 1);
      return `
      <tr class="item-row">
        <td>${it.name}${it.selectedVariant ? `<br/><span style="font-size:12px">(${it.selectedVariant})</span>` : ""}</td>
        <td align="center">${qty}</td>
        <td align="right">Rs.${rate.toFixed(0)}</td>
        <td align="right">Rs.${(rate*qty).toFixed(0)}</td>
      </tr>
      ${it.addonLabels?.length ? `<tr><td class="addon" colspan="4">+ ${it.addonLabels.join(", ")}</td></tr>` : ""}`;
    }).join("")}
  </table>

  <div class="div-dash"></div>
  <table class="totals">
    <tr><td class="lbl">Total Qty</td><td class="val">${totalQty}</td></tr>
    <tr><td class="lbl">Subtotal</td><td class="val">${cur(subTotal)}</td></tr>
    ${discount > 0 ? `<tr><td class="lbl">Discount</td><td class="val">-${cur(discount)}</td></tr>` : ""}
    ${packing  > 0 ? `<tr><td class="lbl">Packaging</td><td class="val">${cur(packing)}</td></tr>` : ""}
    ${gstAmt   > 0 ? `
      <tr><td class="lbl">CGST (${(gstPct/2).toFixed(1)}%)</td><td class="val">${cur(gstAmt/2)}</td></tr>
      <tr><td class="lbl">SGST (${(gstPct/2).toFixed(1)}%)</td><td class="val">${cur(gstAmt/2)}</td></tr>
    ` : ""}
  </table>

  <div class="div-2eq"></div>
  <table><tr class="grand-row">
    <td>GRAND TOTAL:</td>
    <td align="right">Rs.${grandTotal.toFixed(0)}</td>
  </tr></table>
  <div class="div-2eq"></div>

  <table class="totals" style="margin-top:4px">
    ${payLabel ? `<tr><td class="lbl">Payment</td><td class="val">${payLabel}</td></tr>` : ""}
    <tr><td class="lbl" style="font-size:12px;color:#555">Tax under Sec 9(5)</td><td></td></tr>
  </table>

  <div class="div-dash" style="margin-top:4px"></div>
  <div style="page-break-inside:avoid; text-align:center; margin: 4px 0 0;">
    <img id="bp-qr" width="100" height="100" style="display:block; margin:0 auto;" alt="QR" />
    <div style="font-size:12px; font-weight:800; margin-top:2px; margin-bottom:3px;">Scan to reorder anytime!</div>
    <div class="div-dash"></div>
    <div class="thanks">Thanks for visiting!</div>
    <div class="footer">Follow us @burgerpoint_lko</div>
  </div>

  </body></html>`;
}

const QR_URL = "https://burgerpoint.co.in/";

async function openPrintWindow(html) {
  // Generate QR code offline as a data URL
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(QR_URL, {
      width: 100,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch (e) {
    console.warn("QR generation failed:", e);
  }

  const w = window.open("", "_blank", "width=420,height=800");
  if (!w) { alert("Pop-up blocked! Please allow pop-ups for this site."); return; }
  w.document.write(html);
  w.document.close();

  // Inject the offline QR data URL into the img tag
  if (qrDataUrl) {
    const img = w.document.getElementById("bp-qr");
    if (img) img.src = qrDataUrl;
  }

  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

export async function printInvoice(order, settings) {
  await openPrintWindow(buildReceiptHTML(order, settings, false));
}

export async function printKOT(order) {
  await openPrintWindow(buildReceiptHTML(order, {}, true));
}

// ─────────────────────────────────────────────────────────
//  ADMIN LOGIN SCREEN
// ─────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [pwd, setPwd]         = useState("");
  const [show, setShow]       = useState(false);
  const [err, setErr]         = useState("");
  const loading = false;

  const login = () => {
    if (!pwd.trim()) { setErr("Enter your password."); return; }
    if (pwd === ADMIN_PASSWORD) onLogin();
    else setErr("Incorrect password.");
  };

  return (
    <div className="bg-gradient-to-br from-stone-900 to-stone-800 flex items-center justify-center p-4" style={{minHeight:"100dvh"}}>
      <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl">
        <div className="text-center mb-7">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3">🍔</div>
          <h1 className="font-black text-stone-800 text-2xl">Admin Login</h1>
          <p className="text-xs text-stone-400 mt-1">Burger Point Dashboard</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Password</label>
            <div className="relative">
              <input type={show ? "text" : "password"} value={pwd}
                onChange={e => { setPwd(e.target.value); setErr(""); }}
                onKeyDown={e => e.key === "Enter" && login()}
                placeholder="••••••••"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-4 py-3 outline-none text-stone-700 pr-10" />
              <button onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400">
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        {err && <p className="text-red-500 text-xs mt-3 text-center">{err}</p>}
        <button onClick={login} disabled={loading}
          className="w-full mt-5 bg-gradient-to-r from-orange-500 to-red-600 text-white py-4 rounded-2xl font-bold text-sm shadow-md active:scale-95 transition-transform disabled:opacity-60">
          {loading ? "Logging in…" : "🔐 Login"}
        </button>
        <button onClick={() => window.location.hash = ""} className="w-full mt-3 text-xs text-stone-400 underline">← Back to menu</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  ORDER CARD
// ─────────────────────────────────────────────────────────
function OrderCard({ order, onAdvance, onCancel, riders, onAssignDispatch, onPrintKOT, onPrintInvoice }) {
  const [open, setOpen] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const ns = getNextStep(order);
  const cfg = STATUS_CFG[order.status] || STATUS_CFG.pending;
  const typeEmoji = order.order_type === "delivery" ? "🛵" : order.order_type === "takeaway" ? "📦" : "🍽️";
  const isUnconfirmed = order.status === "pending";

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden mb-3 ${isUnconfirmed ? "border-red-300 border-2" : "border-stone-100"}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="relative">
          <div className="text-xl">{typeEmoji}</div>
          {isUnconfirmed && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-stone-800 truncate">
              {order.table_label || order.customer_name || `Order`}
            </p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
            {isUnconfirmed && (
              <span className="text-[10px] font-black text-red-600 flex-shrink-0">● NOT CONFIRMED</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-stone-400">{order.time}</span>
            {order.customer_phone && <span className="text-xs text-stone-400">{order.customer_phone}</span>}
            <span className="text-xs font-bold text-orange-600">{currency(order.total)}</span>
            {order.payment_method && <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-md">{order.payment_method}</span>}
          </div>
        </div>
        {open ? <ChevronUp size={14} className="text-stone-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-stone-400 flex-shrink-0" />}
      </div>

      {open && (
        <div className="border-t border-stone-100 px-4 pb-4">
          {/* Items */}
          <div className="py-3">
            {order.items.map((it, i) => (
              <div key={i} className="flex justify-between text-sm py-0.5">
                <span className="text-stone-700">
                  {it.name}{it.selectedVariant ? ` (${it.selectedVariant})` : ""} ×{it.qty}
                  {it.addonLabels?.length > 0 && <span className="text-[11px] text-orange-400 ml-1">({it.addonLabels.join(", ")})</span>}
                </span>
                <span className="text-stone-500 font-semibold">{currency(it.finalPrice * it.qty)}</span>
              </div>
            ))}
            {order.note && <p className="text-xs text-stone-400 italic mt-2">"{order.note}"</p>}
            {order.delivery_address && (
              <div className="mt-2 bg-stone-50 rounded-xl p-2">
                <p className="text-xs text-stone-500 mb-2">📍 {order.delivery_address}</p>
                {order.customer_lat && order.customer_lng && (
                  <p className="text-[10px] text-blue-500 font-mono mb-2">
                    📌 {Number(order.customer_lat).toFixed(6)}, {Number(order.customer_lng).toFixed(6)}
                  </p>
                )}
                <div className="flex gap-2">
                  <a
                    href={
                      order.customer_lat && order.customer_lng
                        ? `https://maps.google.com/?q=${order.customer_lat},${order.customer_lng}`
                        : `https://maps.google.com/?q=${encodeURIComponent(order.delivery_address)}`
                    }
                    target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 bg-blue-500 text-white text-[11px] font-bold py-1.5 rounded-lg">
                    🗺️ Google Maps
                  </a>
                  {order.rider_phone ? (
                    <a
                      href={`https://wa.me/91${order.rider_phone}?text=${encodeURIComponent(
                        `🛵 *Delivery Address:*
${order.delivery_address}

📍 Exact Location:
https://maps.google.com/?q=${order.customer_lat},${order.customer_lng}`
                      )}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 bg-green-500 text-white text-[11px] font-bold py-1.5 rounded-lg">
                      💬 {order.rider_name || "Rider"}
                    </a>
                  ) : (
                    <div className="flex-1 flex items-center justify-center gap-1.5 bg-stone-200 text-stone-400 text-[11px] font-bold py-1.5 rounded-lg">
                      💬 Assign Rider First
                    </div>
                  )}
                </div>
              </div>
            )}
            {order.promo_code && (
              <p className="text-xs text-green-600 mt-1">🏷️ Promo: {order.promo_code} (−{currency(order.discount)})</p>
            )}
          </div>

          {/* Rider info */}
          {order.rider_name && (
            <div className="bg-purple-50 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
              <Bike size={13} className="text-purple-600" />
              <span className="text-xs font-bold text-purple-700">{order.rider_name}</span>
              {order.rider_phone && <span className="text-xs text-purple-500">{order.rider_phone}</span>}
            </div>
          )}

          {/* Action */}
          {ns && (
            <button
              onClick={() => {
                if (ns.next === "dispatched") { onAssignDispatch(order.id); }
                else {
                  // Auto-print KOT when accepting the order
                  if (ns.next === "accepted" && onPrintKOT) onPrintKOT(order);
                  onAdvance(order.id, ns.next);
                }
              }}
              className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-2.5 rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-transform">
              {ns.next === "accepted" ? "✅ Accept & Print KOT 🍳" : ns.label}
            </button>
          )}

          {/* Print Bill + WhatsApp rider — side by side */}
          <div className="flex gap-2 mt-2">
            {onPrintInvoice && (
              <button
                onClick={() => onPrintInvoice(order)}
                className="flex-1 flex items-center justify-center gap-1.5 border-2 border-stone-200 text-stone-600 py-2 rounded-xl text-xs font-bold active:scale-95 transition-transform hover:border-orange-300 hover:text-orange-600">
                <Printer size={12} /> Print Bill
              </button>
            )}
            {order.rider_phone && (
              <a
                href={`https://wa.me/91${order.rider_phone.replace(/\D/g,"")}?text=${encodeURIComponent(
                  `🛵 *New Order — ${order.table_label || order.customer_name || "Order"}*\n\n` +
                  (order.items || []).map(it => `• ${it.name}${it.selectedVariant ? ` (${it.selectedVariant})` : ""} ×${it.qty}`).join("\n") +
                  `\n\n💰 Total: ₹${order.total}` +
                  (order.delivery_address ? `\n\n📍 Deliver to: ${order.delivery_address}` : "") +
                  (order.customer_lat && order.customer_lng ? `\n🗺️ https://maps.google.com/?q=${order.customer_lat},${order.customer_lng}` : "") +
                  (order.note ? `\n\n📝 Note: ${order.note}` : "")
                )}`}
                target="_blank" rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-500 text-white py-2 rounded-xl text-xs font-bold active:scale-95 transition-transform hover:bg-green-600">
                💬 WhatsApp Rider
              </a>
            )}
          </div>

          {/* Cancel order — admin only, requires a reason shown to the customer */}
          {onCancel && (
            <button
              onClick={() => setShowCancel(true)}
              className="w-full mt-2 flex items-center justify-center gap-1.5 border-2 border-red-100 text-red-500 py-2 rounded-xl text-xs font-bold active:scale-95 transition-transform hover:border-red-300 hover:bg-red-50">
              <XCircle size={12} /> Cancel Order
            </button>
          )}
        </div>
      )}

      {showCancel && (
        <CancelOrderModal
          order={order}
          onConfirm={(reasonId) => { onCancel(order.id, reasonId); setShowCancel(false); }}
          onClose={() => setShowCancel(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  CANCEL ORDER MODAL — admin picks one of 5 preset reasons
// ─────────────────────────────────────────────────────────
function CancelOrderModal({ order, onConfirm, onClose }) {
  const [selected, setSelected] = useState(null);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-t-3xl p-5 pb-7" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
        <p className="font-black text-stone-800 text-base mb-1">Cancel this order?</p>
        <p className="text-xs text-stone-400 mb-4">
          {order.table_label || order.customer_name || "This order"} · {currency(order.total)} — the customer will see the reason you pick below.
        </p>
        <div className="space-y-2 mb-5">
          {CANCEL_REASONS.map(r => (
            <button key={r.id} onClick={() => setSelected(r.id)}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${selected === r.id ? "border-red-400 bg-red-50 text-red-700" : "border-stone-100 text-stone-600"}`}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl text-sm font-bold border-2 border-stone-200 text-stone-600">
            Keep Order
          </button>
          <button onClick={() => selected && onConfirm(selected)} disabled={!selected}
            className="flex-1 py-3 rounded-xl text-sm font-bold bg-red-500 text-white disabled:opacity-40">
            Cancel Order
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  ASSIGN RIDER MODAL
// ─────────────────────────────────────────────────────────
function AssignModal({ orderId, onAssign, onClose }) {
  const [sel, setSel]         = useState(null); // full rider object
  const [dbRiders, setDbRiders] = useState([]);
  const [loading, setLoading]  = useState(true);

  useEffect(() => {
    supabase.from("riders").select("*").eq("active", true).eq("availability", "Available").order("full_name")
      .then(({ data }) => { setDbRiders(data || []); setLoading(false); });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-w-lg mx-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
        <h3 className="font-bold text-stone-800 text-base mb-4 flex items-center gap-2"><Bike size={16} className="text-purple-500" /> Assign Rider</h3>
        {loading ? (
          <div className="flex justify-center py-6"><RefreshCw size={18} className="animate-spin text-stone-400" /></div>
        ) : dbRiders.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-4">No available riders. Add in Riders tab.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {dbRiders.map(r => (
              <button key={r.id} onClick={() => setSel(r)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${sel?.id === r.id ? "border-purple-400 bg-purple-50" : "border-stone-100 bg-stone-50"}`}>
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-sm">🛵</div>
                <div className="text-left flex-1">
                  <p className="text-sm font-bold text-stone-800">{r.full_name}</p>
                  <p className="text-xs text-stone-400">{r.phone_number} · {r.rider_id}</p>
                </div>
                <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{r.availability}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border-2 border-stone-200 text-stone-500 text-sm font-bold">Cancel</button>
          <button onClick={() => { if (sel) onAssign(orderId, sel); }} disabled={!sel}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-bold disabled:opacity-50">
            Dispatch 🛵
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  POS BILLING TAB
// ─────────────────────────────────────────────────────────
const ORDER_SOURCES = ["Walk-in", "Zomato", "Swiggy", "Phone Call", "Website"];

function BillingTab({ bizSettings }) {
  const [menuItems,    setMenuItems]    = useState([]);
  const [search,       setSearch]       = useState("");
  const [cart,         setCart]         = useState([]);  // { id, name, price, qty, isCustom }
  const [source,       setSource]       = useState("Walk-in");
  const [orderType,    setOrderType]    = useState("dine-in");
  const [custName,     setCustName]     = useState("");
  const [custPhone,    setCustPhone]    = useState("");
  const [tableLabel,   setTableLabel]   = useState("");
  const [note,         setNote]         = useState("");
  const [payMethod,    setPayMethod]    = useState("Cash");
  const [discount,     setDiscount]     = useState(0);
  const [activeCat,    setActiveCat]    = useState(null);
  // misc custom item
  const [showCustom,   setShowCustom]   = useState(false);
  const [customName,   setCustomName]   = useState("");
  const [customPrice,  setCustomPrice]  = useState("");
  // placing
  const [placing,      setPlacing]      = useState(false);
  const [printErr,     setPrintErr]     = useState("");
  const [lastOrder,    setLastOrder]    = useState(null);
  const toast = useToast();

  // Load menu — Supabase first, fall back to DEFAULT_MENU
  useEffect(() => {
    (async () => {
      if (!SUPABASE_READY) { setMenuItems(ALL_ITEMS); return; }
      const { data, error } = await supabase
        .from("menu_items")
        .select("id,name,category,price,price_half,price_full,price_regular,price_large,is_available")
        .order("category").order("name");
      if (error || !data || data.length === 0) {
        setMenuItems(ALL_ITEMS);
      } else {
        // Merge: Supabase items take priority; any DEFAULT_MENU item not in Supabase is appended
        const sbIds = new Set(data.map(i => i.id));
        const fallback = ALL_ITEMS.filter(i => !sbIds.has(i.id));
        setMenuItems([...data, ...fallback]);
      }
    })();
  }, []);

  // Cart helpers
  const addItem = (item, variant = null) => {
    const price = variant === "Half"    ? item.price_half
                : variant === "Full"    ? item.price_full
                : variant === "Regular" ? item.price_regular
                : variant === "Large"   ? item.price_large
                : item.price;
    const key = item.id + (variant || "");
    setCart(prev => {
      const idx = prev.findIndex(c => c.key === key);
      if (idx >= 0) return prev.map((c, i) => i === idx ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { key, id: item.id, name: item.name + (variant ? ` (${variant})` : ""), price: Number(price || item.price || 0), qty: 1 }];
    });
  };

  const addCustomItem = () => {
    if (!customName.trim() || !customPrice || isNaN(Number(customPrice))) return;
    const key = "custom_" + Date.now();
    setCart(prev => [...prev, { key, id: key, name: customName.trim(), price: Number(customPrice), qty: 1, isCustom: true }]);
    setCustomName(""); setCustomPrice(""); setShowCustom(false);
  };

  const changeQty = (key, delta) => {
    setCart(prev => prev
      .map(c => c.key === key ? { ...c, qty: c.qty + delta } : c)
      .filter(c => c.qty > 0)
    );
  };

  const gstPct    = Number(bizSettings?.gst_percent ?? 5);
  const packing   = orderType === "takeaway" ? Number(bizSettings?.packing_charge ?? 0) : 0;
  const subtotal  = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const discAmt   = Math.min(Number(discount) || 0, subtotal);
  const taxable   = subtotal - discAmt;
  const gstAmt    = Math.round(taxable * gstPct / 100);
  const grandTotal = taxable + packing + gstAmt;

  // Filtered menu for search
  const visible = search.trim()
    ? menuItems.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : menuItems;

  // Group for display
  const grouped = {};
  visible.forEach(i => { if (!grouped[i.category]) grouped[i.category] = []; grouped[i.category].push(i); });

  const buildOrderPayload = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return ({
    id: crypto.randomUUID(),
    order_type: orderType,
    source,
    platform: source !== "Walk-in" ? source : null,
    customer_name: custName.trim() || null,
    customer_phone: custPhone.trim() || null,
    table_label: tableLabel.trim() || null,
    payment_method: payMethod,
    items: cart.map(c => ({ name: c.name, selectedVariant: null, finalPrice: c.price, qty: c.qty, addonLabels: [] })),
    total: grandTotal,
    discount: discAmt,
    packing_charge: packing,
    gst_amount: gstAmt,
    note: note.trim() || "",
    status: "accepted",  // POS bills go straight to accepted
    time: timeStr,
    created_at: now.toISOString(),
  });};

  const handleBill = async () => {
    if (cart.length === 0) { toast.error("Add at least one item."); return; }
    setPlacing(true); setPrintErr("");
    const payload = buildOrderPayload();

    // 1 — Save to Supabase
    if (SUPABASE_READY) {
      const { error } = await supabase.from("orders").insert(payload);
      if (error) console.error("Billing insert error:", error);
    }

    // 2 — Print invoice via Windows print dialog
    try {
      printInvoice(payload, bizSettings);
      toast.success("Billed & print dialog opened ✓");
    } catch (e) {
      setPrintErr(e.message || "Print failed — order saved.");
    }

    setLastOrder(payload);
    setCart([]);
    setNote(""); setDiscount(0);
    setCustName(""); setCustPhone(""); setTableLabel("");
    setPlacing(false);
  };

  const handleReprint = () => {
    if (!lastOrder) return;
    try {
      printInvoice(lastOrder, bizSettings);
      toast.success("Reprinted ✓");
    } catch (e) {
      setPrintErr(e.message || "Reprint failed.");
    }
  };

  const categories = Object.keys(grouped);

  // Height of the POS area below the top bar — fills the viewport
  const POS_H = "calc(100vh - 190px)";

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar: order type · source · customer fields ── */}
      <div className="bg-white border-b border-stone-100 px-4 py-2.5 flex flex-wrap items-center gap-2 flex-shrink-0">
        {/* Order type */}
        <div className="flex gap-1">
          {[["dine-in","🍽️ Dine-In"],["takeaway","📦 Takeaway"],["delivery","🛵 Delivery"]].map(([v,l]) => (
            <button key={v} onClick={() => setOrderType(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${orderType === v ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}>
              {l}
            </button>
          ))}
        </div>
        {/* Source */}
        <div className="flex gap-1 flex-wrap">
          {ORDER_SOURCES.map(s => (
            <button key={s} onClick={() => setSource(s)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${source === s ? "bg-orange-500 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}>
              {s}
            </button>
          ))}
        </div>
        {/* Customer fields */}
        <div className="flex gap-1.5 ml-auto flex-wrap">
          <input value={custName} onChange={e => setCustName(e.target.value)} placeholder="Customer name"
            className="w-32 text-xs border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-400" />
          <input value={custPhone} onChange={e => setCustPhone(e.target.value.replace(/\D/g,"").slice(0,10))} placeholder="Phone" inputMode="numeric"
            className="w-24 text-xs border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-400" />
          {orderType === "dine-in" && (
            <input value={tableLabel} onChange={e => setTableLabel(e.target.value)} placeholder="Table"
              className="w-20 text-xs border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-400" />
          )}
        </div>
      </div>

      {/* ── POS body: [category rail] [item grid] [bill panel] ── */}
      <div className="flex gap-0 flex-1 overflow-hidden" style={{ height: POS_H }}>

        {/* ── Category rail ── */}
        <div className="w-36 flex-shrink-0 flex flex-col border-r border-stone-100 bg-white overflow-hidden">
          {/* Sticky search */}
          <div className="flex-shrink-0 px-1.5 pt-2 pb-1">
            <div className="flex items-center gap-1 bg-stone-100 rounded-lg px-2 py-1.5">
              <Search size={11} className="text-stone-400 flex-shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="w-full text-[11px] bg-transparent outline-none text-stone-700 placeholder-stone-400" />
              {search && <button onClick={() => setSearch("")}><X size={10} className="text-stone-400" /></button>}
            </div>
          </div>
          {/* Scrollable category list */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-0.5">
          {categories.map(cat => (
            <button key={cat}
              onClick={() => { setActiveCat(cat); document.getElementById(`pos-cat-${cat}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] font-bold transition-colors capitalize truncate
                ${activeCat === cat ? "bg-orange-500 text-white shadow-sm" : "text-stone-600 hover:bg-orange-50 hover:text-orange-600"}`}>
              {cat}
            </button>
          ))}
          <button onClick={() => setShowCustom(s => !s)}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] font-bold flex items-center gap-1 mt-1 transition-colors ${showCustom ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-600 hover:bg-orange-100"}`}>
            <Plus size={11} /> Custom
          </button>
          </div>
        </div>

        {/* ── Item grid ── */}
        <div className="flex-1 overflow-y-auto bg-stone-50 px-3 py-2">
          {/* Custom item form */}
          {showCustom && (
            <div className="flex gap-2 items-center bg-white border border-orange-200 rounded-xl px-3 py-2 mb-3">
              <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Item name"
                className="flex-1 text-xs border border-stone-200 rounded-lg px-2.5 py-2 outline-none focus:border-orange-400" />
              <input value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="₹ Price" inputMode="numeric" type="number"
                className="w-24 text-xs border border-stone-200 rounded-lg px-2.5 py-2 outline-none focus:border-orange-400" />
              <button onClick={addCustomItem}
                className="bg-orange-500 text-white text-xs font-bold px-4 py-2 rounded-lg flex-shrink-0 hover:bg-orange-600 transition-colors">
                Add
              </button>
              <button onClick={() => setShowCustom(false)} className="text-stone-400 hover:text-stone-600"><X size={14} /></button>
            </div>
          )}

          {/* Category sections */}
          <div className="space-y-4">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} id={`pos-cat-${cat}`} className="scroll-mt-2">
                <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2 px-0.5">{cat}</p>
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                  {items.map(item => {
                    const hasVariants = item.price_half || item.price_full || item.price_regular || item.price_large;
                    // Total qty of this item across all variants in cart
                    const itemQty = cart.filter(c => c.id === item.id).reduce((s, c) => s + c.qty, 0);
                    const baseKey = item.id + "";
                    return (
                      <div key={item.id}
                        onClick={!hasVariants ? () => addItem(item) : undefined}
                        className={`bg-white border-2 rounded-xl p-2.5 flex flex-col min-h-[72px] transition-all
                          ${itemQty > 0 ? "border-orange-400 shadow-sm" : "border-stone-100"}
                          ${!hasVariants ? "cursor-pointer hover:border-orange-300 hover:shadow-sm active:scale-[0.98]" : ""}`}>
                        <p className="text-[11px] font-bold text-stone-800 leading-tight mb-1.5 flex-1">{item.name}</p>
                        {hasVariants ? (
                          <div className="flex flex-wrap gap-1">
                            {[
                              item.price_half    && ["Half",    item.price_half,    "½"],
                              item.price_full    && ["Full",    item.price_full,    "F"],
                              item.price_regular && ["Regular", item.price_regular, "R"],
                              item.price_large   && ["Large",   item.price_large,   "L"],
                            ].filter(Boolean).map(([variant, price, label]) => {
                              const vKey = item.id + variant;
                              const vQty = cart.find(c => c.key === vKey)?.qty || 0;
                              return vQty > 0 ? (
                                <div key={variant} className="flex items-center gap-0.5 bg-orange-500 rounded-md px-1 py-0.5" onClick={e => e.stopPropagation()}>
                                  <button onClick={e => { e.stopPropagation(); changeQty(vKey, -1); }} className="text-white font-black text-xs w-4 h-4 flex items-center justify-center">−</button>
                                  <span className="text-white font-black text-[10px] w-3 text-center">{vQty}</span>
                                  <button onClick={e => { e.stopPropagation(); addItem(item, variant); }} className="text-white font-black text-xs w-4 h-4 flex items-center justify-center">+</button>
                                </div>
                              ) : (
                                <button key={variant} onClick={e => { e.stopPropagation(); addItem(item, variant); }}
                                  className="text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded hover:bg-orange-100 transition-colors">
                                  {label} ₹{price}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between mt-auto" onClick={e => e.stopPropagation()}>
                            <span className="text-[11px] text-orange-600 font-black">₹{item.price}</span>
                            {itemQty > 0 ? (
                              <div className="flex items-center gap-1 bg-orange-500 rounded-lg px-1.5 py-0.5">
                                <button onClick={e => { e.stopPropagation(); changeQty(baseKey, -1); }} className="text-white font-black text-sm w-5 h-5 flex items-center justify-center">−</button>
                                <span className="text-white font-black text-xs w-4 text-center">{itemQty}</span>
                                <button onClick={e => { e.stopPropagation(); addItem(item); }} className="text-white font-black text-sm w-5 h-5 flex items-center justify-center">+</button>
                              </div>
                            ) : (
                              <button onClick={e => { e.stopPropagation(); addItem(item); }} className="w-6 h-6 rounded-md bg-orange-500 text-white flex items-center justify-center flex-shrink-0 hover:bg-orange-600 active:scale-95 transition-all">
                                <Plus size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {Object.keys(grouped).length === 0 && (
              <div className="text-center py-16 text-stone-400 text-sm">No items match "{search}"</div>
            )}
          </div>
        </div>

        {/* ── Bill panel ── */}
        <div className="w-72 flex-shrink-0 flex flex-col border-l border-stone-100 bg-white overflow-hidden">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] font-black text-stone-600 uppercase tracking-widest">Bill</span>
            <span className="text-[11px] text-stone-400 font-semibold">{cart.reduce((s,c) => s+c.qty, 0)} items</span>
          </div>

          {/* Cart items — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
                <span className="text-3xl mb-2">🧾</span>
                <p className="text-xs text-stone-400 font-medium">Tap items to add them to the bill</p>
              </div>
            ) : (
              <div>
                {cart.map(c => (
                  <div key={c.key} className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-50 last:border-0 hover:bg-stone-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-stone-800 leading-tight truncate">{c.name}</p>
                      <p className="text-[10px] text-orange-600 font-bold mt-0.5">₹{c.price} × {c.qty} = <span className="text-stone-700">₹{c.price * c.qty}</span></p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => changeQty(c.key, -1)} className="w-6 h-6 rounded bg-stone-100 flex items-center justify-center text-stone-600 text-sm font-bold hover:bg-stone-200 transition-colors">−</button>
                      <span className="text-xs font-black w-5 text-center text-stone-800">{c.qty}</span>
                      <button onClick={() => changeQty(c.key, +1)} className="w-6 h-6 rounded bg-orange-500 text-white flex items-center justify-center font-bold text-sm hover:bg-orange-600 transition-colors">+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals + payment + actions — pinned to bottom */}
          {cart.length > 0 && (
            <div className="flex-shrink-0 border-t border-stone-100">
              {/* Totals */}
              <div className="px-4 py-2.5 bg-stone-50 space-y-1.5">
                <div className="flex justify-between text-xs text-stone-600">
                  <span>Subtotal</span><span className="font-semibold">₹{subtotal}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-stone-600">
                  <span>Discount (₹)</span>
                  <input value={discount} onChange={e => setDiscount(e.target.value)} type="number" min="0"
                    className="w-20 text-right text-xs border border-stone-200 rounded-md px-2 py-0.5 outline-none focus:border-orange-400 bg-white" />
                </div>
                {packing > 0 && (
                  <div className="flex justify-between text-xs text-stone-600"><span>Packing</span><span>₹{packing}</span></div>
                )}
                {gstAmt > 0 && (
                  <div className="flex justify-between text-xs text-stone-600"><span>GST ({gstPct}%)</span><span>₹{gstAmt}</span></div>
                )}
                <div className="flex justify-between text-sm font-black text-stone-900 pt-1.5 border-t border-stone-200 mt-1">
                  <span>Grand Total</span><span className="text-orange-600">₹{grandTotal}</span>
                </div>
              </div>

              {/* Payment method */}
              <div className="px-3 py-2.5 border-t border-stone-100">
                <div className="flex gap-1 mb-2">
                  {["Cash","UPI","Card","Online"].map(m => (
                    <button key={m} onClick={() => setPayMethod(m)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${payMethod === m ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (e.g. no onion)"
                  className="w-full text-[11px] border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-400" />
              </div>

              {/* Error + actions */}
              {printErr && (
                <div className="mx-3 mb-1 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <p className="text-[10px] text-red-700">{printErr}</p>
                  <button onClick={handleReprint} className="text-[10px] font-bold text-red-600 underline flex-shrink-0">Retry</button>
                </div>
              )}
              <div className="px-3 pb-3 pt-1 space-y-1.5">
                {lastOrder && (
                  <button onClick={handleReprint}
                    className="w-full flex items-center justify-center gap-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold py-2 rounded-xl transition-colors">
                    <Printer size={12} /> Reprint last bill
                  </button>
                )}
                <button onClick={handleBill} disabled={placing || cart.length === 0}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-black text-sm py-3 rounded-xl shadow-md disabled:opacity-50 active:scale-95 transition-all">
                  {placing
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Billing…</>
                    : <><Printer size={14} /> Bill & Print — ₹{grandTotal}</>}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  TABLES GRID TAB
// ─────────────────────────────────────────────────────────
function TablesTab({ orders }) {
  const ACTIVE_TABLES = 8; // currently active tables; rest shown as coming soon
  const ACTIVE = ["pending", "accepted", "ready"];
  const tableMap = {};
  orders.forEach(o => {
    if (o.order_type !== "dine-in" || !o.table_label) return;
    if (!ACTIVE.includes(o.status)) return;
    const lbl = o.table_label.trim();
    if (!tableMap[lbl]) tableMap[lbl] = [];
    tableMap[lbl].push(o);
  });

  const allTables = Object.values(TABLE_CODES).sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ""));
    const nb = parseInt(b.replace(/\D/g, ""));
    return na - nb;
  });

  const activeTables = allTables.slice(0, ACTIVE_TABLES);
  const futureTables = allTables.slice(ACTIVE_TABLES);
  const statusPriority = { pending: 0, accepted: 1, ready: 2 };

  const renderTable = (label, future = false) => {
    const tableOrders = future ? [] : (tableMap[label] || []);
    const occupied = tableOrders.length > 0;
    const topStatus = occupied
      ? tableOrders.reduce((best, o) =>
          (statusPriority[o.status] ?? 99) < (statusPriority[best] ?? 99) ? o.status : best,
          tableOrders[0].status)
      : null;
    const total = tableOrders.reduce((s, o) => s + (o.total || 0), 0);
    const cfg = topStatus ? STATUS_CFG[topStatus] : null;
    const numLabel = label.replace(/\D/g, "");

    if (future) {
      return (
        <div key={label} className="relative rounded-2xl border-2 border-dashed border-stone-200 p-3 flex flex-col items-center gap-1 opacity-35">
          <p className="text-2xl font-black text-stone-300">{numLabel}</p>
          <p className="text-[9px] font-bold text-stone-300 uppercase tracking-widest -mt-1">Table</p>
          <p className="text-[9px] text-stone-300 font-medium mt-1">Soon</p>
        </div>
      );
    }

    const bgClass = !occupied ? "bg-stone-100 border-stone-200"
      : topStatus === "pending"  ? "bg-blue-50 border-blue-300"
      : topStatus === "accepted" ? "bg-orange-50 border-orange-300"
      : topStatus === "ready"    ? "bg-green-50 border-green-300"
      : "bg-stone-100 border-stone-200";
    const dotClass = !occupied ? "bg-stone-300"
      : topStatus === "pending"  ? "bg-blue-400 animate-pulse"
      : topStatus === "accepted" ? "bg-orange-400 animate-pulse"
      : topStatus === "ready"    ? "bg-green-400"
      : "bg-stone-300";

    return (
      <div key={label} className={`relative rounded-2xl border-2 p-3 flex flex-col items-center gap-1 transition-all ${bgClass}`}>
        <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${dotClass}`} />
        <p className="text-2xl font-black text-stone-700">{numLabel}</p>
        <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest -mt-1">Table</p>
        {occupied ? (
          <>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${cfg?.color || ""}`}>
              {cfg?.label || topStatus}
            </span>
            <p className="text-xs font-black text-orange-600">₹{total}</p>
            <p className="text-[9px] text-stone-400">{tableOrders.length} order{tableOrders.length > 1 ? "s" : ""}</p>
          </>
        ) : (
          <p className="text-[10px] text-stone-400 font-medium mt-1">Free</p>
        )}
      </div>
    );
  };

  const occupiedCount = activeTables.filter(l => tableMap[l]).length;

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px] font-bold text-stone-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-stone-300 inline-block" /> Free</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" /> Order Placed</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" /> Preparing</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" /> Ready</span>
      </div>

      {/* Active tables grid */}
      <div className="grid grid-cols-4 gap-3">
        {activeTables.map(label => renderTable(label, false))}
        {futureTables.map(label => renderTable(label, true))}
      </div>

      {/* Summary bar — active tables only */}
      <div className="bg-white rounded-2xl border border-stone-100 p-4 flex justify-around text-center">
        <div>
          <p className="text-xl font-black text-stone-800">{ACTIVE_TABLES}</p>
          <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Tables</p>
        </div>
        <div>
          <p className="text-xl font-black text-orange-500">{occupiedCount}</p>
          <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Occupied</p>
        </div>
        <div>
          <p className="text-xl font-black text-green-600">{ACTIVE_TABLES - occupiedCount}</p>
          <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Free</p>
        </div>
        <div>
          <p className="text-xl font-black text-stone-800">
            ₹{activeTables.flatMap(l => tableMap[l] || []).reduce((s, o) => s + (o.total || 0), 0)}
          </p>
          <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Active ₹</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  MENU MANAGEMENT TAB
// ─────────────────────────────────────────────────────────
function MenuTab() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // item being edited

  // Form state
  const blankForm = { name: "", category: "burgers", price: "", img_url: "", description: "", variants_raw: "", addons_raw: "", is_available: true };
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving]       = useState(false);
  const [formErr, setFormErr]     = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  const imgInputRef = useRef(null);

  const handleImgUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // JPG only
    const isJpg = file.type === "image/jpeg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg");
    if (!isJpg) {
      setFormErr("Only JPG/JPEG images are allowed.");
      if (imgInputRef.current) imgInputRef.current.value = "";
      return;
    }

    if (!SUPABASE_READY) {
      setFormErr("Storage not configured. Please set up Supabase environment variables.");
      return;
    }

    setUploadingImg(true);
    setFormErr("");
    // Fix: strip existing extension before building filename to avoid double-extension (e.g. photo.jpg.jpg)
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/gi, "_");
    const fileName = `menu/${Date.now()}_${baseName}.jpg`;
    const { data, error } = await supabase.storage
      .from("menu-images")
      .upload(fileName, file, { contentType: "image/jpeg", upsert: true });

    if (error) {
      setFormErr(`Upload failed: ${error.message}`);
    } else {
      const { data: { publicUrl } } = supabase.storage.from("menu-images").getPublicUrl(data.path);
      setForm(f => ({ ...f, img_url: publicUrl }));
    }
    setUploadingImg(false);
    // Use ref instead of e.target (which goes stale after await due to React re-renders)
    if (imgInputRef.current) imgInputRef.current.value = "";
  };

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("menu_items").select("*").order("category").order("name");
    setLoading(false);
    if (data) setItems(data);
  }, []);

  useEffect(() => { if (SUPABASE_READY) loadItems(); }, [loadItems]);

  const openAdd = () => { setForm(blankForm); setEditing(null); setFormErr(""); setShowForm(true); };
  const openEdit = (item) => {
    setForm({
      name: item.name, category: item.category, price: String(item.price),
      img_url: item.img || item.img_url || "",
      description: item.description || "",
      variants_raw: item.variants ? JSON.stringify(item.variants) : "",
      addons_raw: item.addons?.length ? JSON.stringify(item.addons) : "",
      is_available: item.is_available !== false,
    });
    setEditing(item.id); setFormErr(""); setShowForm(true);
  };

  const saveItem = async () => {
    if (!form.name.trim())          { setFormErr("Name is required."); return; }
    if (!form.price || isNaN(Number(form.price))) { setFormErr("Valid price required."); return; }

    let variants = null;
    let addons   = [];
    try { if (form.variants_raw.trim()) variants = JSON.parse(form.variants_raw); } catch { setFormErr("Variants JSON is invalid."); return; }
    try { if (form.addons_raw.trim())   addons   = JSON.parse(form.addons_raw);   } catch { setFormErr("Addons JSON is invalid."); return; }

    setSaving(true);
    const payload = {
      name: form.name.trim(), category: form.category, price: Number(form.price),
      img: form.img_url.trim() || null, description: form.description.trim(),
      variants, addons, is_available: form.is_available,
    };

    if (editing) {
      await supabase.from("menu_items").update(payload).eq("id", editing);
    } else {
      await supabase.from("menu_items").insert({ ...payload, id: `custom_${Date.now()}` });
    }
    setSaving(false); setShowForm(false); loadItems();
  };

  const [pendingDelete, setPendingDelete] = useState(null);
  const deleteItem = async (id) => {
    if (pendingDelete !== id) { setPendingDelete(id); setTimeout(() => setPendingDelete(null), 3000); return; }
    setPendingDelete(null);
    await supabase.from("menu_items").delete().eq("id", id);
    loadItems();
  };

  const toggleAvail = async (id, current) => {
    await supabase.from("menu_items").update({ is_available: !current }).eq("id", id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, is_available: !current } : i));
  };

  const toggleBestseller = async (id, current) => {
    // null = auto (not pinned), true = pinned as bestseller, false = pinned as NOT bestseller
    const next = current ? null : true;
    await supabase.from("menu_items").update({ is_bestseller_manual: next }).eq("id", id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, is_bestseller_manual: next } : i));
    // Bust customer-side cache
    localStorage.removeItem("bp_bestsellers");
  };

  // Group items by category
  const grouped = {};
  items.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  if (loading) return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-stone-100 p-3 flex items-center gap-3">
          <div className="relative overflow-hidden bg-stone-100 rounded-xl w-12 h-12 flex-shrink-0">
            <div className="shimmer-wave absolute inset-0" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="relative overflow-hidden bg-stone-100 rounded h-3 w-2/3"><div className="shimmer-wave absolute inset-0" /></div>
            <div className="relative overflow-hidden bg-stone-100 rounded h-3 w-1/3"><div className="shimmer-wave absolute inset-0" /></div>
          </div>
          <div className="relative overflow-hidden bg-stone-100 rounded-xl w-16 h-7"><div className="shimmer-wave absolute inset-0" /></div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-bold text-stone-800">Menu Items</p>
          <p className="text-xs text-stone-400">{items.length} items · managed from Supabase</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-1.5 bg-orange-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm active:scale-95 transition-transform">
          <Plus size={13} /> Add Item
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-200">
          <p className="text-3xl mb-2">🍔</p>
          <p className="text-sm font-bold text-stone-600 mb-1">No items in Supabase yet</p>
          <p className="text-xs text-stone-400 mb-4">Add items here or they'll load from the built-in default menu.</p>
          <button onClick={openAdd} className="bg-orange-500 text-white text-xs font-bold px-4 py-2 rounded-xl">Add First Item</button>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, catItems]) => {
          const catData = CATEGORIES.find(c => c.id === cat);
          return (
            <div key={cat} className="mb-5">
              <p className="text-xs font-bold text-stone-500 uppercase tracking-widest mb-2">{catData?.emoji} {catData?.label || cat}</p>
              <div className="space-y-2">
                {catItems.map(item => (
                  <div key={item.id} className={`bg-white border rounded-xl px-4 py-3 flex items-center gap-3 ${item.is_available === false ? "opacity-60 border-stone-100" : "border-stone-100"}`}>
                    {item.img && <img src={item.img} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" onError={e => e.target.style.display = "none"} />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold text-stone-800 truncate">{item.name}</p>
                        {item.is_bestseller_manual && <span className="text-[9px] font-black bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full flex-shrink-0">🔥 Bestseller</span>}
                      </div>
                      <p className="text-xs text-stone-400">₹{item.price}{item.variants ? " onwards" : ""}{item.addons?.length ? " · customisable" : ""}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Bestseller pin */}
                      <button onClick={() => toggleBestseller(item.id, item.is_bestseller_manual)}
                        title={item.is_bestseller_manual ? "Unpin Bestseller" : "Pin as Bestseller"}
                        className={`text-xs font-bold px-2 py-1 rounded-lg transition-all ${item.is_bestseller_manual ? "bg-orange-100 text-orange-600" : "bg-stone-100 text-stone-400"}`}>
                        🔥
                      </button>
                      {/* Availability toggle */}
                      <button onClick={() => toggleAvail(item.id, item.is_available !== false)} title={item.is_available !== false ? "Mark Sold Out" : "Mark Available"}
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all ${item.is_available !== false ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {item.is_available !== false ? "Avail" : "Out"}
                      </button>
                      <button onClick={() => openEdit(item)} className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center"><Edit2 size={12} className="text-stone-500" /></button>
                      <button onClick={() => deleteItem(item.id)}
                        className={`h-7 rounded-lg flex items-center justify-center px-2 transition-all ${pendingDelete === item.id ? "bg-red-500 text-white text-[10px] font-bold px-2" : "w-7 bg-red-50"}`}>
                        {pendingDelete === item.id ? "Sure?" : <Trash2 size={12} className="text-red-400" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* Add / Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full bg-white rounded-t-3xl max-w-xl mx-auto flex flex-col" style={{ maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mt-3 flex-shrink-0" />
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-stone-100 flex-shrink-0">
              <h3 className="font-bold text-stone-800">{editing ? "Edit Item" : "Add New Item"}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-stone-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Item Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Paneer Tikki Burger"
                  className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-4 py-3 outline-none text-stone-700" />
              </div>
              {/* Category + Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-3 outline-none text-stone-700">
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Base Price (₹) *</label>
                  <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="99"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-4 py-3 outline-none text-stone-700" />
                </div>
              </div>
              {/* Photo Upload */}
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1 flex items-center gap-1"><Image size={9} /> Photo <span className="normal-case font-normal text-stone-400">(JPG only)</span></label>
                {/* File picker */}
                <label className={`flex items-center gap-2 w-full border-2 border-dashed rounded-xl px-4 py-3 cursor-pointer transition-colors ${uploadingImg ? "border-orange-300 bg-orange-50" : "border-stone-200 hover:border-orange-400 bg-white"}`}>
                  <Image size={14} className="text-stone-400 flex-shrink-0" />
                  <span className="text-sm text-stone-500 flex-1">
                    {uploadingImg ? "Uploading…" : "Click to upload JPG"}
                  </span>
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept=".jpg,.jpeg,image/jpeg"
                    className="hidden"
                    disabled={uploadingImg}
                    onChange={handleImgUpload}
                  />
                </label>
                {/* URL fallback */}
                <p className="text-[10px] text-stone-400 mt-1 mb-1">Or paste a URL directly:</p>
                <input
                  value={form.img_url}
                  onChange={e => setForm(f => ({ ...f, img_url: e.target.value }))}
                  placeholder="https://…"
                  className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-4 py-3 outline-none text-stone-700"
                />
                {form.img_url && (
                  <div className="mt-2 relative">
                    <img src={form.img_url} alt="preview" className="h-24 w-full object-cover rounded-xl" onError={e => e.target.style.display = "none"} />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, img_url: "" }))}
                      className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
              {/* Description */}
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description shown under item name…"
                  className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-4 py-3 outline-none text-stone-700 resize-none h-16" />
              </div>
              {/* Variants */}
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Variants JSON <span className="normal-case font-normal">(optional — for Half/Full or Reg/Large)</span></label>
                <textarea value={form.variants_raw} onChange={e => setForm(f => ({ ...f, variants_raw: e.target.value }))}
                  placeholder={'[{"label":"Half","price":139},{"label":"Full","price":269}]'}
                  className="w-full text-xs font-mono border-2 border-stone-200 focus:border-orange-400 rounded-xl px-4 py-3 outline-none text-stone-700 resize-none h-20" />
                <p className="text-[10px] text-stone-400 mt-1">Leave empty if no size options.</p>
              </div>
              {/* Addons */}
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Add-ons JSON <span className="normal-case font-normal">(optional)</span></label>
                <textarea value={form.addons_raw} onChange={e => setForm(f => ({ ...f, addons_raw: e.target.value }))}
                  placeholder={'[\n  {"id":"cheese","label":"Extra Cheese","type":"toggle","price":20},\n  {"id":"spice","label":"Spice Level","type":"select","options":["Mild","Medium","Extra Hot"],"price":0}\n]'}
                  className="w-full text-xs font-mono border-2 border-stone-200 focus:border-orange-400 rounded-xl px-4 py-3 outline-none text-stone-700 resize-none h-32" />
                <div className="mt-1 bg-orange-50 border border-orange-100 rounded-xl p-3 text-[10px] text-stone-500 space-y-1">
                  <p className="font-bold text-orange-700">Add-on types:</p>
                  <p><code className="bg-white px-1 rounded">toggle</code> — checkbox (e.g. Extra Cheese +₹20)</p>
                  <p><code className="bg-white px-1 rounded">select</code> with <code className="bg-white px-1 rounded">id:"spice"</code> — shows Mild/Medium/Extra Hot radio buttons</p>
                </div>
              </div>
              {/* Availability */}
              <div className="flex items-center justify-between bg-stone-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-stone-700">Available on Menu</p>
                  <p className="text-xs text-stone-400">Uncheck to mark as sold out</p>
                </div>
                <button onClick={() => setForm(f => ({ ...f, is_available: !f.is_available }))}
                  className={`w-12 h-6 rounded-full transition-all ${form.is_available ? "bg-green-500" : "bg-stone-300"} relative`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.is_available ? "right-0.5" : "left-0.5"}`} />
                </button>
              </div>

              {formErr && <p className="text-red-500 text-xs text-center">{formErr}</p>}
            </div>

            <div className="px-5 pb-6 pt-3 border-t border-stone-100 flex-shrink-0">
              <button onClick={saveItem} disabled={saving}
                className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-2xl font-bold text-sm shadow-md active:scale-95 transition-transform disabled:opacity-60 flex items-center justify-center gap-2">
                <Save size={15} /> {saving ? "Saving…" : editing ? "Save Changes" : "Add to Menu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  SALES TAB
// ─────────────────────────────────────────────────────────
function SalesHistoryCard({ o }) {
  const [open, setOpen] = useState(false);
  const { settings: bizSettings } = useBusinessSettings();
  const toast = useToast();

  const handlePrint = async () => {
    try {
      await printInvoice(o, bizSettings);
      toast.success("Print dialog opened ✓");
    } catch (e) {
      toast.error(e.message || "Print failed");
    }
  };

  return (
    <div className={`rounded-xl border ${o.status === "cancelled" ? "border-red-100 bg-red-50" : "border-stone-100 bg-stone-50"}`}>
      {/* Summary row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="text-base">{o.status === "cancelled" ? "✕" : "😊"}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-stone-800 truncate">{o.table_label || o.customer_name || "Order"}</p>
          <p className="text-[10px] text-stone-400">
            {new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            {o.status === "cancelled" && o.cancel_reason && <span className="text-red-500"> · {o.cancel_reason}</span>}
          </p>
        </div>
        <span className={`text-xs font-black flex-shrink-0 mr-2 ${o.status === "cancelled" ? "text-red-500 line-through" : "text-orange-600"}`}>{currency(o.total)}</span>
        <button onClick={() => setOpen(v => !v)} className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-600 flex-shrink-0">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded: items + print */}
      {open && (
        <div className="px-3 pb-3 border-t border-stone-200/70 pt-2.5 space-y-1">
          {(o.items || []).map((it, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-stone-700">
                {it.name}{it.selectedVariant ? ` (${it.selectedVariant})` : ""} ×{it.qty}
                {it.addonLabels?.length > 0 && <span className="text-orange-400"> ({it.addonLabels.join(", ")})</span>}
              </span>
              <span className="text-stone-500 font-semibold ml-2 flex-shrink-0">₹{it.finalPrice * it.qty}</span>
            </div>
          ))}
          {o.note && <p className="text-[11px] text-stone-400 italic pt-1">Note: "{o.note}"</p>}
          <div className="flex justify-between text-xs font-black pt-1 border-t border-stone-200/70 mt-1">
            <span className="text-stone-700">Total</span>
            <span className="text-orange-600">₹{o.total}</span>
          </div>
          {o.status !== "cancelled" && (
            <button onClick={handlePrint}
              className="mt-2 w-full flex items-center justify-center gap-1.5 bg-orange-500 text-white text-xs font-bold py-2 rounded-xl active:scale-95 transition-transform shadow-sm">
              <Printer size={12} /> Print Bill
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SalesTab({ orders, loading }) {
  if (loading && orders.length === 0) return <SalesSkeleton />;
  const revenueOrders = orders.filter(o => o.status !== "cancelled");
  const today = new Date();
  const days  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });

  const byDay = {};
  days.forEach(d => { byDay[d] = { revenue: 0, count: 0 }; });
  revenueOrders.forEach(o => {
    const d = (o.created_at || "").slice(0, 10);
    if (byDay[d]) { byDay[d].revenue += Number(o.total || 0); byDay[d].count += 1; }
  });

  const maxRev   = Math.max(...Object.values(byDay).map(d => d.revenue), 1);
  const todayStr = today.toISOString().split("T")[0];
  const todayData = byDay[todayStr] || { revenue: 0, count: 0 };

  const totalRev  = revenueOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalOrds = revenueOrders.length;
  const avgOrder  = totalOrds > 0 ? Math.round(totalRev / totalOrds) : 0;

  const typeBreak = { "dine-in": 0, takeaway: 0, delivery: 0 };
  revenueOrders.forEach(o => { typeBreak[o.order_type || "dine-in"] = (typeBreak[o.order_type || "dine-in"] || 0) + 1; });

  // History — completed and cancelled orders, most recent first. This is where
  // orders land once they leave the active Orders tab.
  const history = orders
    .filter(o => o.status === "served" || o.status === "cancelled")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 40);

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Today", val: currency(todayData.revenue), sub: `${todayData.count} orders` },
          { label: "All Time", val: currency(totalRev), sub: `${totalOrds} orders` },
          { label: "Avg Order", val: currency(avgOrder), sub: "per order" },
        ].map(k => (
          <div key={k.label} className="bg-white border border-stone-100 rounded-2xl p-3 text-center shadow-sm">
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">{k.label}</p>
            <p className="text-lg font-black text-stone-800 mt-1">{k.val}</p>
            <p className="text-[10px] text-stone-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* 7-day bar chart */}
      <div className="bg-white border border-stone-100 rounded-2xl p-4 shadow-sm">
        <p className="text-xs font-bold text-stone-600 mb-4 flex items-center gap-1.5"><BarChart2 size={13} className="text-orange-400" /> Last 7 Days Revenue</p>
        <div className="flex items-end gap-2 h-32">
          {days.map(d => {
            const pct = byDay[d].revenue / maxRev;
            const isToday = d === todayStr;
            const label = new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
            return (
              <div key={d} className="flex-1 flex flex-col items-center gap-1">
                <p className="text-[9px] text-stone-500 font-bold">{byDay[d].revenue > 0 ? `₹${Math.round(byDay[d].revenue / 100) * 100 < 1000 ? byDay[d].revenue : `${(byDay[d].revenue / 1000).toFixed(1)}k`}` : ""}</p>
                <div className="w-full rounded-t-lg transition-all" style={{ height: `${Math.max(pct * 88, byDay[d].revenue > 0 ? 8 : 2)}px`, background: isToday ? "linear-gradient(to top,#f97316,#ef4444)" : "#e5e7eb" }} />
                <p className={`text-[9px] font-bold ${isToday ? "text-orange-500" : "text-stone-400"}`}>{label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Order type breakdown */}
      <div className="bg-white border border-stone-100 rounded-2xl p-4 shadow-sm">
        <p className="text-xs font-bold text-stone-600 mb-3">Order Type Breakdown</p>
        {[
          { label: "Dine-In", emoji: "🍽️", count: typeBreak["dine-in"] },
          { label: "Takeaway", emoji: "📦", count: typeBreak["takeaway"] },
          { label: "Delivery", emoji: "🛵", count: typeBreak["delivery"] },
        ].map(t => (
          <div key={t.label} className="flex items-center gap-3 py-2">
            <span className="text-base">{t.emoji}</span>
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <span className="text-xs font-bold text-stone-700">{t.label}</span>
                <span className="text-xs text-stone-400">{t.count} orders</span>
              </div>
              <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-orange-400 to-red-400 rounded-full"
                  style={{ width: totalOrds > 0 ? `${(t.count / totalOrds) * 100}%` : "0%" }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Payment methods */}
      <div className="bg-white border border-stone-100 rounded-2xl p-4 shadow-sm">
        <p className="text-xs font-bold text-stone-600 mb-3">Payment Methods</p>
        {(() => {
          const pm = {};
          revenueOrders.forEach(o => { pm[o.payment_method || "Cash"] = (pm[o.payment_method || "Cash"] || 0) + 1; });
          return Object.entries(pm).sort((a, b) => b[1] - a[1]).map(([method, count]) => (
            <div key={method} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-stone-600">{method}</span>
              <span className="text-xs font-bold text-stone-700 bg-stone-100 px-2 py-0.5 rounded-lg">{count}</span>
            </div>
          ));
        })()}
      </div>

      {/* Order history — completed & cancelled orders live here once resolved */}
      <div className="bg-white border border-stone-100 rounded-2xl p-4 shadow-sm">
        <p className="text-xs font-bold text-stone-600 mb-3">Order History</p>
        {history.length === 0 ? (
          <p className="text-xs text-stone-400 text-center py-4">No completed or cancelled orders yet</p>
        ) : (
          <div className="space-y-2">
            {history.map(o => <SalesHistoryCard key={o.id} o={o} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  CUSTOMERS TAB
// ─────────────────────────────────────────────────────────
function CustomersTab({ orders, loading }) {
  const [search, setSearch] = useState("");
  if (loading && orders.length === 0) return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: 6 }).map((_, i) => <CustomerRowSkeleton key={i} />)}
    </div>
  );

  const customers = (() => {
    const map = {};
    orders.forEach(o => {
      const phone = o.customer_phone;
      if (!phone) return;
      if (!map[phone]) map[phone] = { name: o.customer_name || "Customer", phone, orders: 0, spent: 0, lastOrder: o.created_at };
      map[phone].orders += 1;
      map[phone].spent  += Number(o.total || 0);
      if (o.created_at > map[phone].lastOrder) { map[phone].lastOrder = o.created_at; map[phone].name = o.customer_name || map[phone].name; }
    });
    return Object.values(map).sort((a, b) => b.spent - a.spent);
  })();

  const filtered = search
    ? customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
    : customers;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-bold text-stone-800">Customer Phone Book</p>
          <p className="text-xs text-stone-400">{customers.length} unique customers</p>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-stone-100 rounded-xl px-3 py-2.5 mb-4">
        <Users size={13} className="text-stone-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or phone…"
          className="flex-1 text-sm bg-transparent outline-none text-stone-700 placeholder-stone-400" />
        {search && <button onClick={() => setSearch("")}><X size={12} className="text-stone-400" /></button>}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12"><p className="text-3xl mb-2">👥</p><p className="text-sm text-stone-400">No customers yet</p></div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c, i) => (
            <div key={c.phone} className="bg-white border border-stone-100 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-orange-100 to-amber-100 rounded-full flex items-center justify-center text-sm font-black text-orange-600 flex-shrink-0">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-stone-800 truncate">{c.name}</p>
                <p className="text-xs text-stone-400">{c.phone} · {c.orders} order{c.orders !== 1 ? "s" : ""} · {currency(c.spent)}</p>
              </div>
              <a href={`tel:${c.phone}`} className="w-8 h-8 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center flex-shrink-0">
                <Phone size={13} className="text-green-600" />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  BUSINESS SETTINGS (Phase 2)
// ─────────────────────────────────────────────────────────
function BusinessSettingsSection() {
  const { settings, loading, save } = useBusinessSettings();
  const [form, setForm]       = useState(settings);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const initialised           = useRef(false);
  const toast                 = useToast();

  // Only sync form from settings once — on initial load — so typing in an
  // input never causes a re-sync that blurs / resets the field mid-keystroke.
  useEffect(() => {
    if (!loading && !initialised.current) {
      setForm(settings);
      initialised.current = true;
    }
  }, [loading, settings]);

  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e;
    setForm(f => ({ ...f, [k]: v }));
  };
  const numSet = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value === "" ? "" : Number(e.target.value) }));

  const doSave = async () => {
    setSaving(true); setSaved(false);
    const { error } = await save(form);
    setSaving(false);
    if (!error) { setSaved(true); toast.success("Settings saved!"); setTimeout(() => setSaved(false), 2000); }
    else toast.error("Save failed: " + error.message);
  };

  // Isolated single-field save (e.g. Logo URL) — smaller surface for debugging
  const [savingField, setSavingField] = useState(null);
  const [savedField,  setSavedField]  = useState(null);
  const saveOne = async (key) => {
    setSavingField(key);
    const { error } = await save({ [key]: form[key] });
    setSavingField(null);
    if (!error) { setSavedField(key); toast.success("Saved!"); setTimeout(() => setSavedField(null), 2000); }
    else toast.error(`Save failed: ${error.message}`);
  };

  const Field = ({ label, children }) => (
    <div>
      <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">{label}</label>
      {children}
    </div>
  );
  const inputCls = "w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700";

  if (loading) return <Section emoji="🏪" title="Business Settings"><p className="text-xs text-stone-400">Loading…</p></Section>;

  return (
    <Section emoji="🏪" title="Business Settings">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Restaurant Name"><input value={form.restaurant_name || ""} onChange={set("restaurant_name")} className={inputCls} /></Field>
        <Field label="Phone"><input value={form.phone || ""} onChange={set("phone")} className={inputCls} /></Field>
        <Field label="Logo URL">
          <div className="flex gap-1.5">
            <input value={form.logo_url || ""} onChange={set("logo_url")} className={inputCls} placeholder="https://…" />
            <button type="button" onClick={() => saveOne("logo_url")} disabled={savingField === "logo_url"}
              className="flex-shrink-0 px-3 rounded-xl bg-stone-800 text-white text-xs font-bold disabled:opacity-60">
              {savingField === "logo_url" ? "…" : savedField === "logo_url" ? "✓" : "Save"}
            </button>
          </div>
        </Field>
        <Field label="Version"><input value={form.version || ""} onChange={set("version")} className={inputCls} /></Field>
        <div className="col-span-2">
          <Field label="Restaurant Address"><input value={form.address || ""} onChange={set("address")} className={inputCls} /></Field>
        </div>
        <div className="col-span-2">
          <Field label="GST Number (GSTIN — printed on invoices)">
            <input value={form.gst_number || ""} onChange={set("gst_number")}
              placeholder="e.g. 09ACOFA177BK1ZS" className={inputCls} />
          </Field>
        </div>
        <Field label="Opening Time"><input type="time" value={form.opening_time || ""} onChange={set("opening_time")} className={inputCls} /></Field>
        <Field label="Closing Time"><input type="time" value={form.closing_time || ""} onChange={set("closing_time")} className={inputCls} /></Field>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        {[["emergency_close", "🚨 Emergency Close"], ["holiday_mode", "🏖️ Holiday Mode"], ["hide_unavailable_items", "🙈 Hide Unavailable Items"]].map(([k, label]) => (
          <button key={k} onClick={() => setForm(f => ({ ...f, [k]: !f[k] }))}
            className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-xs font-bold ${form[k] ? "bg-red-50 border-red-200 text-red-600" : "bg-stone-50 border-stone-200 text-stone-500"}`}>
            {label}
            <div className={`w-9 h-5 rounded-full relative transition-all ${form[k] ? "bg-red-500" : "bg-stone-300"}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form[k] ? "right-0.5" : "left-0.5"}`} />
            </div>
          </button>
        ))}
      </div>

      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-4 mb-2">Delivery Charges</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Base Delivery Charge (₹)"><input type="number" value={form.base_delivery_charge ?? ""} onChange={numSet("base_delivery_charge")} className={inputCls} /></Field>
        <Field label="Base Distance (km)"><input type="number" value={form.base_distance_km ?? ""} onChange={numSet("base_distance_km")} className={inputCls} /></Field>
        <Field label="Additional Charge / km (₹)"><input type="number" value={form.per_km_charge ?? ""} onChange={numSet("per_km_charge")} className={inputCls} /></Field>
        <Field label="Max Delivery Distance (km)"><input type="number" value={form.delivery_radius_km ?? ""} onChange={numSet("delivery_radius_km")} className={inputCls} /></Field>
        <Field label="Free Delivery Above (₹)"><input type="number" value={form.free_delivery_above ?? ""} onChange={numSet("free_delivery_above")} className={inputCls} /></Field>
        <Field label="Avg Delivery Speed (km/h)"><input type="number" value={form.avg_delivery_speed_kmph ?? ""} onChange={numSet("avg_delivery_speed_kmph")} className={inputCls} /></Field>
        <Field label="Restaurant Latitude"><input type="number" step="0.0001" value={form.restaurant_lat ?? ""} onChange={numSet("restaurant_lat")} className={inputCls} /></Field>
        <Field label="Restaurant Longitude"><input type="number" step="0.0001" value={form.restaurant_lng ?? ""} onChange={numSet("restaurant_lng")} className={inputCls} /></Field>
      </div>

      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-4 mb-2">Billing</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum Order Value (₹)"><input type="number" value={form.min_order_value ?? ""} onChange={numSet("min_order_value")} className={inputCls} /></Field>
        <Field label="Packing Charge (₹)"><input type="number" value={form.packing_charge ?? ""} onChange={numSet("packing_charge")} className={inputCls} /></Field>
        <Field label="GST Percentage (%)"><input type="number" value={form.gst_percent ?? ""} onChange={numSet("gst_percent")} className={inputCls} /></Field>
      </div>

      <button onClick={doSave} disabled={saving}
        className="w-full mt-4 bg-stone-800 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-60 flex items-center justify-center gap-1.5">
        <Save size={13} /> {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Business Settings"}
      </button>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────
//  CATEGORY ENABLE/DISABLE (Phase 2)
// ─────────────────────────────────────────────────────────
function CategoriesSection() {
  const [cats, setCats]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!SUPABASE_READY) { setLoading(false); return; }
    supabase.from("categories").select("*").order("sort_order")
      .then(({ data }) => { setCats(data && data.length ? data : CATEGORIES.map((c, i) => ({ ...c, enabled: true, sort_order: i }))); setLoading(false); });
  }, []);

  const toggle = async (id, current) => {
    setCats(prev => prev.map(c => c.id === id ? { ...c, enabled: !current } : c));
    if (SUPABASE_READY) await supabase.from("categories").update({ enabled: !current }).eq("id", id);
  };

  if (loading) return <Section emoji="📂" title="Menu Categories"><p className="text-xs text-stone-400">Loading…</p></Section>;

  return (
    <Section emoji="📂" title="Menu Categories">
      <p className="text-xs text-stone-400 mb-3">Turn off a whole category to hide it (and everything in it) from customers — items stay saved, nothing is deleted.</p>
      <div className="grid grid-cols-2 gap-2">
        {cats.map(c => (
          <button key={c.id} onClick={() => toggle(c.id, c.enabled !== false)}
            className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-xs font-bold ${c.enabled !== false ? "bg-white border-stone-100 text-stone-700" : "bg-stone-50 border-stone-200 text-stone-400 opacity-60"}`}>
            <span>{c.emoji} {c.label}</span>
            <div className={`w-9 h-5 rounded-full relative transition-all flex-shrink-0 ${c.enabled !== false ? "bg-green-500" : "bg-stone-300"}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${c.enabled !== false ? "right-0.5" : "left-0.5"}`} />
            </div>
          </button>
        ))}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────
//  SECTION WRAPPER (must be outside SettingsTab to avoid remount on every keystroke)
// ─────────────────────────────────────────────────────────
function Section({ title, emoji, children }) {
  return (
    <div className="bg-white border border-stone-100 rounded-2xl p-4 shadow-sm mb-4">
      <p className="text-sm font-bold text-stone-800 mb-3 flex items-center gap-2">{emoji} {title}</p>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  SETTINGS TAB
// ─────────────────────────────────────────────────────────
function SettingsTab({ riders, setRiders, onLogout }) {
  const toast = useToast();
  // Busy mode
  const [busy,       setBusy]       = useState({ is_busy: false, message: "We are currently closed. Please check back later.", opens_at: "" });
  const [busyLoaded, setBusyLoaded] = useState(false);
  const [busySaving, setBusySaving] = useState(false);

  // Wait times
  const [waitTimes, setWaitTimes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bp_wait_times") || '{"dine-in":15,"takeaway":20,"delivery":40}'); } catch { return { "dine-in": 15, takeaway: 20, delivery: 40 }; }
  });

  // (Riders are managed in the dedicated Riders tab)

  // Coupons
  const [coupons,   setCoupons]   = useState([]);
  const [couponForm, setCouponForm] = useState({ code: "", discount_type: "flat", discount_value: "", min_order: "", max_discount: "", expiry: "" });
  const [couponErr, setCouponErr] = useState("");
  const [couponSaving, setCouponSaving] = useState(false);

  // Reservations
  const [reservations, setReservations] = useState([]);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    // Load busy mode + riders from Supabase
    supabase.from("busy_mode").select("*").eq("id", 1).single()
      .then(({ data }) => {
        if (data) {
          setBusy(data);
          if (data.riders_json) {
            try {
              const r = JSON.parse(data.riders_json);
              setRiders(r);
              localStorage.setItem("bp_riders", JSON.stringify(r));
            } catch {}
          }
        }
        setBusyLoaded(true);
      });
    // Load coupons
    supabase.from("coupons").select("*").order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setCoupons(data); });
    // Load reservations
    supabase.from("reservations").select("*").order("date").order("time")
      .then(({ data }) => { if (data) setReservations(data); });
  }, []);

  const saveBusy = async () => {
    setBusySaving(true);
    const payload = { is_busy: busy.is_busy, message: busy.message, opens_at: busy.opens_at };
    await supabase.from("busy_mode").upsert({ id: 1, ...payload });
    setBusySaving(false);
  };

  const saveWaitTimes = () => {
    localStorage.setItem("bp_wait_times", JSON.stringify(waitTimes));
    toast.success("Wait times saved!");
  };



  const addCoupon = async () => {
    if (!couponForm.code.trim())               { setCouponErr("Code required."); return; }
    if (!couponForm.discount_value)            { setCouponErr("Discount value required."); return; }
    setCouponSaving(true);
    const { error } = await supabase.from("coupons").insert({
      code: couponForm.code.trim().toUpperCase(),
      discount_type:  couponForm.discount_type,
      discount_value: Number(couponForm.discount_value),
      min_order:      Number(couponForm.min_order) || 0,
      max_discount:   Number(couponForm.max_discount) || null,
      expiry:         couponForm.expiry || null,
      is_active:      true,
    });
    setCouponSaving(false);
    if (error) { setCouponErr(error.message); return; }
    setCouponErr(""); setCouponForm({ code: "", discount_type: "flat", discount_value: "", min_order: "", max_discount: "", expiry: "" });
    const { data } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
    if (data) setCoupons(data);
  };

  const toggleCoupon = async (id, current) => {
    await supabase.from("coupons").update({ is_active: !current }).eq("id", id);
    setCoupons(prev => prev.map(c => c.id === id ? { ...c, is_active: !current } : c));
  };

  const updateReservation = async (id, status) => {
    await supabase.from("reservations").update({ status }).eq("id", id);
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  return (
    <div className="space-y-0">
      <BusinessSettingsSection />
      <CategoriesSection />
      {/* ── BUSY MODE ── */}
      <Section emoji="🔴" title="Open / Closed Toggle">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-stone-700">{busy.is_busy ? "🔴 Restaurant is CLOSED" : "🟢 Restaurant is OPEN"}</p>
            <p className="text-xs text-stone-400">Toggle to stop / resume incoming orders</p>
          </div>
          <button onClick={() => setBusy(b => ({ ...b, is_busy: !b.is_busy }))}
            className={`w-14 h-7 rounded-full transition-all relative ${busy.is_busy ? "bg-red-500" : "bg-green-500"}`}>
            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${busy.is_busy ? "right-0.5" : "left-0.5"}`} />
          </button>
        </div>
        {busy.is_busy && (
          <div className="space-y-2 mb-3">
            <div>
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Closed Message</label>
              <input value={busy.message} onChange={e => setBusy(b => ({ ...b, message: e.target.value }))}
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Opens At <span className="font-normal normal-case">(shown to customers)</span></label>
              <input value={busy.opens_at} onChange={e => setBusy(b => ({ ...b, opens_at: e.target.value }))} placeholder="e.g. 11:00 AM"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none text-stone-700" />
            </div>
          </div>
        )}
        <button onClick={saveBusy} disabled={busySaving}
          className="w-full bg-stone-800 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-60 flex items-center justify-center gap-1.5">
          <Save size={12} /> {busySaving ? "Saving…" : "Save Busy Mode"}
        </button>
      </Section>

      {/* ── WAIT TIMES ── */}
      <Section emoji="⏱️" title="Estimated Wait Times">
        <p className="text-xs text-stone-400 mb-3">Shown to customers on the order tracker</p>
        {[
          { key: "dine-in", label: "Dine-In", emoji: "🍽️" },
          { key: "takeaway", label: "Takeaway", emoji: "📦" },
          { key: "delivery", label: "Delivery", emoji: "🛵" },
        ].map(t => (
          <div key={t.key} className="flex items-center gap-3 mb-2">
            <span className="text-base">{t.emoji}</span>
            <span className="text-sm text-stone-600 flex-1">{t.label}</span>
            <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-xl px-3 py-1.5">
              <input type="number" value={waitTimes[t.key]} onChange={e => setWaitTimes(w => ({ ...w, [t.key]: Number(e.target.value) }))}
                className="w-12 text-sm font-bold text-stone-800 bg-transparent outline-none text-center" />
              <span className="text-xs text-stone-400">mins</span>
            </div>
          </div>
        ))}
        <button onClick={saveWaitTimes} className="w-full mt-2 bg-stone-800 text-white py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5">
          <Save size={12} /> Save Wait Times
        </button>
      </Section>

      {/* ── COUPONS ── */}
      <Section emoji="🏷️" title="Promo Codes / Coupons">
        <div className="space-y-2 mb-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Code</label>
              <input value={couponForm.code} onChange={e => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="BURGER10"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2 outline-none text-stone-700 font-mono" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Type</label>
              <select value={couponForm.discount_type} onChange={e => setCouponForm(f => ({ ...f, discount_type: e.target.value }))}
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2 outline-none text-stone-700">
                <option value="flat">Flat ₹ Off</option>
                <option value="percent">% Off</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Value</label>
              <input type="number" value={couponForm.discount_value} onChange={e => setCouponForm(f => ({ ...f, discount_value: e.target.value }))}
                placeholder={couponForm.discount_type === "percent" ? "10" : "50"}
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2 outline-none text-stone-700" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Min Order ₹</label>
              <input type="number" value={couponForm.min_order} onChange={e => setCouponForm(f => ({ ...f, min_order: e.target.value }))} placeholder="0"
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2 outline-none text-stone-700" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {couponForm.discount_type === "percent" && (
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Max Discount ₹</label>
                <input type="number" value={couponForm.max_discount} onChange={e => setCouponForm(f => ({ ...f, max_discount: e.target.value }))} placeholder="100"
                  className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2 outline-none text-stone-700" />
              </div>
            )}
            <div>
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Expiry Date</label>
              <input type="date" value={couponForm.expiry} onChange={e => setCouponForm(f => ({ ...f, expiry: e.target.value }))}
                className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2 outline-none text-stone-700" />
            </div>
          </div>
        </div>
        {couponErr && <p className="text-red-500 text-xs mb-2">{couponErr}</p>}
        <button onClick={addCoupon} disabled={couponSaving}
          className="w-full bg-orange-500 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-60 flex items-center justify-center gap-1.5 mb-3">
          <Plus size={12} /> {couponSaving ? "Saving…" : "Create Coupon"}
        </button>
        {/* Coupon list */}
        <div className="space-y-2">
          {coupons.map(c => (
            <div key={c.id} className={`flex items-center gap-3 bg-stone-50 rounded-xl px-3 py-2.5 ${!c.is_active ? "opacity-50" : ""}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-stone-800 font-mono">{c.code}</p>
                <p className="text-xs text-stone-400">
                  {c.discount_type === "percent" ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                  {c.min_order ? ` · min ₹${c.min_order}` : ""}
                  {c.expiry ? ` · expires ${c.expiry}` : ""}
                </p>
              </div>
              <button onClick={() => toggleCoupon(c.id, c.is_active)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg ${c.is_active ? "bg-green-100 text-green-700" : "bg-stone-200 text-stone-500"}`}>
                {c.is_active ? "Active" : "Disabled"}
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* ── RESERVATIONS ── */}
      <Section emoji="📅" title="Table Reservations">
        {reservations.length === 0 ? (
          <p className="text-xs text-stone-400 text-center py-4">No reservations yet</p>
        ) : (
          <div className="space-y-2">
            {reservations.map(r => (
              <div key={r.id} className={`bg-stone-50 rounded-xl px-3 py-3 border ${r.status === "confirmed" ? "border-green-200" : r.status === "cancelled" ? "border-red-100 opacity-50" : "border-stone-100"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-stone-800">{r.name} · {r.guests} guests</p>
                    <p className="text-xs text-stone-500">{r.date} at {r.time} · {r.phone}</p>
                    {r.note && <p className="text-xs text-stone-400 italic mt-0.5">"{r.note}"</p>}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${r.status === "confirmed" ? "bg-green-100 text-green-700" : r.status === "cancelled" ? "bg-red-100 text-red-600" : "bg-yellow-100 text-yellow-700"}`}>
                    {r.status}
                  </span>
                </div>
                {r.status === "pending" && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => updateReservation(r.id, "confirmed")} className="flex-1 bg-green-500 text-white text-xs font-bold py-1.5 rounded-lg">✓ Confirm</button>
                    <button onClick={() => updateReservation(r.id, "cancelled")} className="flex-1 bg-stone-200 text-stone-600 text-xs font-bold py-1.5 rounded-lg">✕ Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── LOGOUT ── */}
      <div className="pt-2 pb-6">
        <button onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-500 font-bold text-sm py-3 rounded-2xl hover:bg-red-50 transition-all">
          <LogOut size={15} /> Logout from Admin
        </button>
        <button onClick={() => window.location.hash = ""} className="w-full text-xs text-stone-400 mt-3 underline">← Back to customer menu</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  RIDERS TAB
// ─────────────────────────────────────────────────────────
function RidersTab() {
  const [riders,   setRiders]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRider, setEditRider] = useState(null);
  const [stats,    setStats]    = useState({});
  const blank = { rider_id: "", full_name: "", phone_number: "", password: "" };
  const [form, setForm]         = useState(blank);
  const [saving, setSaving]     = useState(false);
  const [formErr, setFormErr]   = useState("");
  const [resetId, setResetId]   = useState(null);
  const [newPwd, setNewPwd]     = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("riders").select("*").order("created_at");
    setLoading(false);
    if (data) {
      setRiders(data);
      // Load delivery counts
      const { data: orders } = await supabase.from("orders")
        .select("rider_id, rider_status, delivered_at").eq("rider_status", "delivered");
      const today = new Date().toISOString().split("T")[0];
      const s = {};
      (orders || []).forEach(o => {
        if (!s[o.rider_id]) s[o.rider_id] = { total: 0, today: 0 };
        s[o.rider_id].total++;
        if (o.delivered_at?.slice(0, 10) === today) s[o.rider_id].today++;
      });
      setStats(s);
    }
  }, []);

  useEffect(() => { if (SUPABASE_READY) load(); }, [load]);

  const openCreate = () => {
    // Auto-generate rider_id
    const next = `BP${String(riders.length + 1).padStart(3, "0")}`;
    setForm({ ...blank, rider_id: next }); setEditRider(null); setFormErr(""); setShowForm(true);
  };
  const openEdit = (r) => {
    setForm({ rider_id: r.rider_id, full_name: r.full_name, phone_number: r.phone_number, password: "" });
    setEditRider(r); setFormErr(""); setShowForm(true);
  };

  const save = async () => {
    if (!form.rider_id.trim()) { setFormErr("Rider ID required."); return; }
    if (!form.full_name.trim()) { setFormErr("Name required."); return; }
    if (!/^\d{10}$/.test(form.phone_number)) { setFormErr("Valid 10-digit phone required."); return; }
    if (!editRider && !form.password) { setFormErr("Password required."); return; }
    setSaving(true); setFormErr("");
    if (editRider) {
      await supabase.from("riders").update({ full_name: form.full_name.trim(), phone_number: form.phone_number, updated_at: new Date().toISOString() }).eq("rider_id", editRider.rider_id);
    } else {
      const { data } = await supabase.rpc("create_rider_with_password", { p_rider_id: form.rider_id.trim().toUpperCase(), p_full_name: form.full_name.trim(), p_phone: form.phone_number, p_password: form.password });
      if (!data?.success) { setFormErr(data?.error || "Failed."); setSaving(false); return; }
    }
    setSaving(false); setShowForm(false); load();
  };

  const toggleActive = async (r) => {
    await supabase.from("riders").update({ active: !r.active, updated_at: new Date().toISOString() }).eq("rider_id", r.rider_id);
    setRiders(prev => prev.map(x => x.rider_id === r.rider_id ? { ...x, active: !x.active } : x));
  };

  const changeAvail = async (r, avail) => {
    await supabase.from("riders").update({ availability: avail, updated_at: new Date().toISOString() }).eq("rider_id", r.rider_id);
    setRiders(prev => prev.map(x => x.rider_id === r.rider_id ? { ...x, availability: avail } : x));
  };

  const [pendingRiderDelete, setPendingRiderDelete] = useState(null);
  const deleteRider = async (r) => {
    if (pendingRiderDelete !== r.rider_id) {
      setPendingRiderDelete(r.rider_id);
      setTimeout(() => setPendingRiderDelete(null), 3000);
      return;
    }
    setPendingRiderDelete(null);
    await supabase.from("riders").delete().eq("rider_id", r.rider_id);
    load();
  };

  const resetPwd = async () => {
    if (!newPwd || newPwd.length < 6) return;
    setResetting(true);
    await supabase.rpc("reset_rider_password", { p_rider_id: resetId, p_new_password: newPwd });
    setResetting(false); setResetId(null); setNewPwd("");
  };

  const AVAIL = { Available: "bg-green-100 text-green-700", Busy: "bg-orange-100 text-orange-700", Offline: "bg-stone-100 text-stone-500" };

  if (loading) return (
    <div className="space-y-3 pt-2">
      {Array.from({ length: 4 }).map((_, i) => <RiderCardSkeleton key={i} />)}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-bold text-stone-800">Rider Management</p>
          <p className="text-xs text-stone-400">{riders.length} riders · <a href="#rider" target="_blank" className="text-orange-500 underline">Open Rider Portal ↗</a></p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-1.5 bg-orange-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm active:scale-95 transition-transform">
          <Plus size={13} /> Add Rider
        </button>
      </div>

      {riders.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-200">
          <p className="text-3xl mb-2">🛵</p>
          <p className="text-sm font-bold text-stone-600 mb-1">No riders yet</p>
          <button onClick={openCreate} className="bg-orange-500 text-white text-xs font-bold px-4 py-2 rounded-xl mt-2">Add First Rider</button>
        </div>
      ) : (
        <div className="space-y-3">
          {riders.map(r => {
            const s = stats[r.rider_id] || { total: 0, today: 0 };
            return (
              <div key={r.rider_id} className={`bg-white border rounded-2xl p-4 ${!r.active ? "opacity-50" : "border-stone-100"}`}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center text-xl flex-shrink-0">🛵</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-stone-800 text-sm">{r.full_name}</p>
                      <span className="font-mono text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">{r.rider_id}</span>
                      {!r.active && <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full">Disabled</span>}
                    </div>
                    <p className="text-xs text-stone-400 mt-0.5">{r.phone_number}</p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="text-[10px] text-stone-500">📦 {s.total} total · {s.today} today</span>
                      {/* Availability quick-toggle */}
                      <div className="flex gap-1">
                        {["Available","Busy","Offline"].map(a => (
                          <button key={a} onClick={() => changeAvail(r, a)}
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-all ${r.availability === a ? AVAIL[a] : "bg-stone-50 text-stone-300"}`}>
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => openEdit(r)} className="flex-1 text-xs font-bold py-2 rounded-xl bg-stone-100 text-stone-600">✏️ Edit</button>
                  <button onClick={() => { setResetId(r.rider_id); setNewPwd(""); }} className="flex-1 text-xs font-bold py-2 rounded-xl bg-blue-50 text-blue-600">🔑 Reset Pwd</button>
                  <button onClick={() => toggleActive(r)} className={`flex-1 text-xs font-bold py-2 rounded-xl ${r.active ? "bg-orange-50 text-orange-600" : "bg-green-50 text-green-600"}`}>
                    {r.active ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => deleteRider(r)}
                    className={`rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${pendingRiderDelete === r.rider_id ? "bg-red-500 text-white text-[10px] font-bold px-2 h-9" : "w-9 h-9 bg-red-50"}`}>
                    {pendingRiderDelete === r.rider_id ? "Sure?" : <Trash2 size={13} className="text-red-400" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full bg-white rounded-t-3xl max-w-xl mx-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-stone-800 mb-4">{editRider ? "Edit Rider" : "Add New Rider"}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Rider ID *</label>
                  <input value={form.rider_id} onChange={e => setForm(f => ({ ...f, rider_id: e.target.value.toUpperCase() }))}
                    disabled={!!editRider} placeholder="BP001"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none font-mono disabled:opacity-50" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Phone *</label>
                  <input value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value.replace(/\D/g,"").slice(0,10) }))}
                    placeholder="10-digit" inputMode="numeric"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Full Name *</label>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Rider's full name"
                  className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none" />
              </div>
              {!editRider && (
                <div>
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Password *</label>
                  <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters"
                    className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none" />
                </div>
              )}
              {formErr && <p className="text-red-500 text-xs">{formErr}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border-2 border-stone-200 text-stone-500 text-sm font-bold">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-bold disabled:opacity-60">
                {saving ? "Saving…" : editRider ? "Save Changes" : "Create Rider"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setResetId(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-stone-800 mb-1">Reset Password</p>
            <p className="text-xs text-stone-400 mb-4">Rider ID: <span className="font-mono font-bold">{resetId}</span></p>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password (min 6 chars)"
              className="w-full text-sm border-2 border-stone-200 focus:border-orange-400 rounded-xl px-3 py-2.5 outline-none mb-3" />
            <div className="flex gap-2">
              <button onClick={() => setResetId(null)} className="flex-1 py-2.5 rounded-xl border-2 border-stone-200 text-stone-500 text-sm font-bold">Cancel</button>
              <button onClick={resetPwd} disabled={resetting || newPwd.length < 6}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-bold disabled:opacity-50">
                {resetting ? "Resetting…" : "Reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  NEW ORDER POPUP
// ─────────────────────────────────────────────────────────
function NewOrderPopup({ order, count, onAck }) {
  useEffect(() => {
    if (!order) return;
    const t = setTimeout(() => onAck(), 12000);
    return () => clearTimeout(t);
  }, [order, onAck]);

  if (!order) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[999] w-full max-w-sm px-4"
         style={{ animation: "slideDown 0.35s cubic-bezier(.22,1,.36,1)" }}>
      <style>{`@keyframes slideDown{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
      <div className="bg-white rounded-2xl shadow-2xl border-2 border-orange-500 overflow-hidden">
        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2.5 flex items-center gap-2">
          <span className="text-white font-black text-sm">🔔 NEW ORDER{count > 1 ? ` (+${count - 1} more)` : ""}</span>
          <span className="ml-auto text-orange-100 text-xs font-bold">₹{order.total}</span>
        </div>
        <div className="px-4 py-3">
          <p className="font-bold text-stone-800">{order.table_label || order.customer_name || "Customer"}</p>
          <p className="text-xs text-stone-400 mt-0.5">
            {order.order_type} · {order.items?.length} item{order.items?.length !== 1 ? "s" : ""} · {order.time}
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={onAck}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-bold py-2.5 rounded-xl active:scale-95 transition-transform">
              ✓ Got It
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  ORDER NOTIFICATION HOOK
// ─────────────────────────────────────────────────────────
function useOrderNotifications(orders, authed) {
  const prevIdsRef      = useRef(new Set());
  const unackedRef      = useRef(new Set());
  const repeatRef       = useRef(null);
  const flashRef        = useRef(null);
  const [popup, setPopup]           = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Request browser notification permission once
  useEffect(() => {
    if (authed && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [authed]);

  const playChime = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Mobile browsers suspend AudioContext until a user gesture — resume it first
      const doPlay = () => {
        const master = ctx.createGain();
        master.gain.value = 0.65;
        master.connect(ctx.destination);
        const note = (freq, t, dur, type = "triangle") => {
          const osc = ctx.createOscillator();
          const g   = ctx.createGain();
          osc.connect(g); g.connect(master);
          osc.type = type;
          osc.frequency.setValueAtTime(freq, ctx.currentTime + t);
          g.gain.setValueAtTime(0, ctx.currentTime + t);
          g.gain.linearRampToValueAtTime(0.7, ctx.currentTime + t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
          osc.start(ctx.currentTime + t);
          osc.stop(ctx.currentTime + t + dur + 0.02);
        };
        note(523,  0,    0.14);
        note(659,  0.13, 0.14);
        note(784,  0.26, 0.14);
        note(1047, 0.39, 0.55, "sine");
        note(880,  0.55, 0.35, "sine");
      };
      if (ctx.state === "suspended") {
        ctx.resume().then(doPlay).catch(() => {});
      } else {
        doPlay();
      }
    } catch {}
  }, []);

  const startFlash = useCallback((n) => {
    clearInterval(flashRef.current);
    const orig  = document.title;
    const alert = `🔴 ${n} New Order${n > 1 ? "s" : ""}!`;
    let vis = true;
    flashRef.current = setInterval(() => {
      document.title = vis ? alert : orig;
      vis = !vis;
    }, 650);
    setTimeout(() => { clearInterval(flashRef.current); document.title = "Burger Point Admin"; }, 12000);
  }, []);

  // Dismiss the popup banner only — does NOT silence the repeat chime.
  // The chime keeps nagging every 15s until the order is actually accepted
  // (removed from unackedRef below), so dismissing the banner can't be
  // mistaken for confirming the order.
  const dismissPopup = useCallback(() => {
    setPopup(null);
  }, []);

  // Fully stops everything — used only when there's truly nothing left unacked
  // (i.e. every pending order has been accepted/resolved).
  const stopAll = useCallback(() => {
    unackedRef.current.clear();
    setUnreadCount(0);
    setPopup(null);
    clearInterval(repeatRef.current);
    clearInterval(flashRef.current);
    document.title = "Burger Point Admin";
  }, []);

  useEffect(() => {
    const pending = orders.filter(o => o.status === "pending");
    const newOrders = pending.filter(o => !prevIdsRef.current.has(o.id));

    if (newOrders.length > 0) {
      newOrders.forEach(o => unackedRef.current.add(o.id));
      const count = unackedRef.current.size;
      setUnreadCount(count);
      setPopup(newOrders[0]);

      // Sound immediately
      playChime();

      // Browser notification
      if ("Notification" in window && Notification.permission === "granted") {
        const o = newOrders[0];
        const n = new Notification("🍔 New Order — Burger Point", {
          body: `${o.table_label || o.customer_name || "Customer"} · ₹${o.total}`,
          tag: "bp-order", renotify: true,
        });
        setTimeout(() => n.close(), 7000);
      }

      // Flash tab
      startFlash(count);

      // Repeat every 15s while unacked
      clearInterval(repeatRef.current);
      repeatRef.current = setInterval(() => {
        if (unackedRef.current.size > 0) { playChime(); startFlash(unackedRef.current.size); }
        else { clearInterval(repeatRef.current); }
      }, 15000);
    }

    // Remove orders that are no longer pending (accepted/served) from unacked
    const pendingIds = new Set(pending.map(o => o.id));
    let changed = false;
    unackedRef.current.forEach(id => {
      if (!pendingIds.has(id)) { unackedRef.current.delete(id); changed = true; }
    });
    if (changed) {
      const n = unackedRef.current.size;
      setUnreadCount(n);
      if (n === 0) stopAll();
    }

    prevIdsRef.current = new Set(orders.filter(o => o.status === "pending").map(o => o.id));
  }, [orders, playChime, startFlash, stopAll]);

  useEffect(() => () => {
    clearInterval(repeatRef.current);
    clearInterval(flashRef.current);
    document.title = "Burger Point Admin";
  }, []);

  const acknowledge = useCallback(() => dismissPopup(), [dismissPopup]);
  return { popup, unreadCount, acknowledge };
}

// ─────────────────────────────────────────────────────────
//  ADMIN APP (root)
// ─────────────────────────────────────────────────────────
export default function AdminApp() {
  const [authed,          setAuthed]          = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [orders,          setOrders]          = useState([]);
  const [loading,         setLoading]         = useState(false);
  const [online,          setOnline]          = useState(false);
  const [filter,          setFilter]          = useState("all");
  const [typeFilter,      setTypeFilter]      = useState("all");
  const [tab,             setTab]             = useState("orders");
  const [riders,          setRiders]          = useState(() => { try { return JSON.parse(localStorage.getItem("bp_riders") || "[]"); } catch { return []; } }); // Supabase sync happens in SettingsTab
  const [assignModal,     setAssignModal]     = useState(null);
  const { popup: newOrderPopup, unreadCount, acknowledge } = useOrderNotifications(orders, authed);

  // ── Business settings ──
  const { settings: bizSettings } = useBusinessSettings();
  const toast = useToast();

  const normaliseAll = useCallback(data => data.map(normalise), []);

  const fetchOrders = useCallback(async () => {
    if (!SUPABASE_READY) return;
    setLoading(true);
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    setLoading(false);
    if (!error && data) { setOrders(normaliseAll(data)); setOnline(true); } else setOnline(false);
  }, [normaliseAll]);

  useEffect(() => { setCheckingSession(false); }, []);

  useEffect(() => {
    if (!authed || !SUPABASE_READY) return;
    fetchOrders();
    const ch = supabase.channel("admin_orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, p => {
        if (p.eventType === "INSERT") setOrders(prev => [normalise(p.new), ...prev]);
        else if (p.eventType === "UPDATE") setOrders(prev => prev.map(o => o.id === p.new.id ? normalise(p.new) : o));
      }).subscribe();
    return () => supabase.removeChannel(ch);
  }, [authed, fetchOrders]);

  const updateStatus = async (id, status, extra = {}) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, ...extra } : o));
    if (SUPABASE_READY) await supabase.from("orders").update({ status, ...extra }).eq("id", id);
  };

  const handleCancel = async (id, reasonId) => {
    const reason = CANCEL_REASONS.find(r => r.id === reasonId);
    await updateStatus(id, "cancelled", {
      cancel_reason: reason?.label || "Order cancelled",
      cancelled_at: new Date().toISOString(),
    });
    toast.success("Order cancelled — customer has been notified.");
  };

  // ── Printer handlers ──
  const handlePrintKOT = useCallback((order) => {
    try {
      printKOT(order);
      toast.success("🍳 KOT print dialog opened!");
    } catch (e) {
      toast.error("KOT print failed: " + (e.message || e));
    }
  }, [toast]);

  const handlePrintInvoice = useCallback((order) => {
    try {
      printInvoice(order, bizSettings);
      toast.success("🧾 Invoice print dialog opened!");
    } catch (e) {
      toast.error("Invoice print failed: " + (e.message || e));
    }
  }, [bizSettings, toast]);

  // ── Generate road route via OSRM (free, no API key) ──
  const generateRoute = async (order) => {
    try {
      const restLat = 26.926287, restLng = 80.942995; // restaurant coords
      const custLat = order.customer_lat;
      const custLng = order.customer_lng;
      if (!custLat || !custLng) return null;

      const url = `https://router.project-osrm.org/route/v1/driving/${restLng},${restLat};${custLng},${custLat}?overview=full&geometries=geojson`;
      const res  = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return null;

      // GeoJSON coords are [lng, lat] — swap to [lat, lng] for Leaflet
      const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      return {
        route_geometry:      coords,
        route_distance_km:   Math.round((route.distance / 1000) * 10) / 10,
        route_eta_minutes:   Math.max(10, Math.ceil(route.duration / 60) + 5), // +5 min buffer
        delivery_started_at: new Date().toISOString(),
      };
    } catch (e) {
      console.warn("Route generation failed:", e);
      return null;
    }
  };

  const handleAssign = async (orderId, rider) => {
    if (!rider) return;
    const order = orders.find(o => o.id === orderId);
    const routeData = order ? await generateRoute(order) : null;

    await updateStatus(orderId, "dispatched", {
      rider_name:   rider.full_name,
      rider_phone:  rider.phone_number,
      rider_id:     rider.rider_id,
      rider_status: "assigned",
      ...(routeData || {}),
    });
    // Mark rider as Busy
    await supabase.from("riders").update({ availability: "Busy", updated_at: new Date().toISOString() }).eq("rider_id", rider.rider_id);
    setAssignModal(null);
  };

  const logout = () => { setAuthed(false); };

  if (checkingSession) return (
    <div className="bg-gradient-to-br from-stone-900 to-stone-800 flex items-center justify-center" style={{minHeight:"100dvh"}}>
      <RefreshCw size={22} className="text-white animate-spin" />
    </div>
  );

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  // Orders tab only shows orders still needing action — served/cancelled
  // move to the Sales tab as history.
  let filtered = orders.filter(o => ACTIVE_STATUSES.includes(o.status));
  if (filter !== "all")     filtered = filtered.filter(o => o.status === filter);
  if (typeFilter !== "all") filtered = filtered.filter(o => (o.order_type || "dine-in") === typeFilter);

  const pendingCount = orders.filter(o => o.status === "pending").length;
  const displayBadge = unreadCount > 0 ? unreadCount : pendingCount;

  const tabs = [
    { id: "orders",    icon: <ShoppingBag size={16} />,   label: "Orders" },
    { id: "tables",    icon: <LayoutGrid size={16} />,    label: "Tables" },
    { id: "billing",   icon: <Printer size={16} />,       label: "Billing" },
    { id: "menu",      icon: <span className="text-base">🍔</span>, label: "Menu" },
    { id: "sales",     icon: <BarChart2 size={16} />,     label: "Sales" },
    { id: "customers", icon: <Users size={16} />,         label: "Customers" },
    { id: "riders",    icon: <Bike size={16} />,          label: "Riders" },
    { id: "settings",  icon: <Settings size={16} />,      label: "Settings" },
  ];

  return (
    <div className="bg-stone-50 flex flex-col" style={{height:"100dvh", overflow: tab === "billing" ? "hidden" : "auto"}}>
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-stone-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍔</span>
            <div>
              <p className="font-black text-stone-800 text-sm leading-tight">Burger Point</p>
              <div className="flex items-center gap-1">
                {online ? <Wifi size={9} className="text-green-500" /> : <WifiOff size={9} className="text-red-400" />}
                <span className={`text-[10px] font-bold ${online ? "text-green-600" : "text-red-500"}`}>{online ? "Live" : "Offline"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {displayBadge > 0 && (
              <span className="bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full animate-pulse">{displayBadge} new</span>
            )}
            <button onClick={fetchOrders} disabled={loading}
              className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center">
              <RefreshCw size={13} className={`text-stone-500 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-stone-100 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[60px] flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-all ${tab === t.id ? "text-orange-500 border-b-2 border-orange-500" : "text-stone-400"}`}>
              {t.icon}
              {t.label}
              {t.id === "orders" && displayBadge > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 absolute mt-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Billing tab — full width, full height POS layout, outside the narrow wrapper */}
      {tab === "billing" && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <BillingTab bizSettings={bizSettings} />
        </div>
      )}

      {/* Main content — all other tabs use narrow centered layout */}
      <div className={tab === "billing" ? "hidden" : "flex-1 max-w-2xl mx-auto w-full px-4 py-4"}>

        {/* ORDERS TAB */}
        {tab === "orders" && (
          <>
            {/* Filters */}
            <div className="flex gap-2 mb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {[
                { id: "all", label: "All" },
                { id: "pending", label: "⏳ Pending" },
                { id: "accepted", label: "👨‍🍳 Preparing" },
                { id: "ready", label: "✅ Ready" },
                { id: "dispatched", label: "🛵 Dispatched" },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${filter === f.id ? "bg-orange-500 text-white" : "bg-white border border-stone-200 text-stone-500"}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {[
                { id: "all", label: "🍽️ All Types" },
                { id: "dine-in", label: "Dine-In" },
                { id: "takeaway", label: "📦 Takeaway" },
                { id: "delivery", label: "🛵 Delivery" },
              ].map(f => (
                <button key={f.id} onClick={() => setTypeFilter(f.id)}
                  className={`flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${typeFilter === f.id ? "bg-stone-700 text-white" : "bg-white border border-stone-200 text-stone-500"}`}>
                  {f.label}
                </button>
              ))}
            </div>

            {!SUPABASE_READY ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
                <p className="text-sm font-bold text-amber-800">Supabase not connected</p>
                <p className="text-xs text-amber-600 mt-1">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file</p>
              </div>
            ) : loading && orders.length === 0 ? (
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, i) => <OrderCardSkeleton key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-stone-400 text-sm">No orders {filter !== "all" ? `with status "${filter}"` : "in progress"}</p>
                <p className="text-stone-300 text-xs mt-1">Completed and cancelled orders are in the Sales tab</p>
              </div>
            ) : (
              <>
                {filtered.map(order => (
                  <OrderCard key={order.id} order={order}
                    onAdvance={updateStatus}
                    onCancel={handleCancel}
                    riders={riders}
                    onAssignDispatch={id => setAssignModal(id)}
                    onPrintKOT={handlePrintKOT}
                    onPrintInvoice={handlePrintInvoice} />
                ))}
              </>
            )}
          </>
        )}

        {tab === "tables"    && <TablesTab orders={orders} />}
        {tab === "menu"      && <MenuTab />}
        {tab === "sales"     && <SalesTab orders={orders} loading={loading} />}
        {tab === "customers" && <CustomersTab orders={orders} loading={loading} />}
        {tab === "riders"    && <RidersTab />}
        {tab === "settings"  && <SettingsTab riders={riders} setRiders={setRiders} onLogout={logout} />}
      </div>

      {/* New order popup */}
      <NewOrderPopup order={newOrderPopup} count={unreadCount} onAck={acknowledge} />

      {/* Assign rider modal */}
      {assignModal && (
        <AssignModal orderId={assignModal} onAssign={handleAssign} onClose={() => setAssignModal(null)} />
      )}
    </div>
  );
}
