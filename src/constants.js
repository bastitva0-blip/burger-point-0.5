// ─────────────────────────────────────────────────────────
//  BURGER POINT — shared constants
// ─────────────────────────────────────────────────────────

export const ADMIN_PASSWORD = "Burger@2026"; // 👈 change this to whatever password you want
export const REVIEW_URL  = "https://qr-review-saas.vercel.app/q/0U9GC7";
export const SITE_URL    = "https://burgerpoint.co.in";
export const WHATSAPP    = "https://wa.me/919194008822";
export const INSTAGRAM   = "https://www.instagram.com/burgerpoint_as";

export const TABLE_CODES = {
  "7294831056":"Table 1","4058379126":"Table 2","8163059247":"Table 3",
  "2947063815":"Table 4","5820394176":"Table 5","3614729058":"Table 6",
  "9037246815":"Table 7","1472958630":"Table 8","6895230174":"Table 9",
  "4260817953":"Table 10","8531064279":"Table 11","3749158260":"Table 12",
  "7048263591":"Table 13","3619470825":"Table 14","5283701964":"Table 15",
  "9146852037":"Table 16","2705638149":"Table 17","6493027581":"Table 18",
  "8027541693":"Table 19","1359820746":"Table 20",
};

export const BP_SESSION_KEY = "bp_table_session";
export const clearTableSession = () => sessionStorage.removeItem(BP_SESSION_KEY);

export const getRoute = () => {
  const hash = window.location.hash;
  if (hash === "#admin")       return { page:"admin" };
  if (hash === "#rider")       return { page:"rider" };
  if (hash === "#privacy")     return { page:"privacy" };
  if (hash === "#contact")     return { page:"contact" };
  if (hash === "#reservation") return { page:"reservation" };
  if (hash.startsWith("#table=")) {
    const code = hash.slice(7);
    if (TABLE_CODES[code]) {
      sessionStorage.setItem(BP_SESSION_KEY, JSON.stringify({ code, label:TABLE_CODES[code] }));
      history.replaceState(null,"",window.location.pathname+window.location.search);
      return { page:"customer", code, label:TABLE_CODES[code], orderType:"dine-in" };
    }
  }
  if (hash === "#takeaway") return { page:"takeaway" };
  if (hash === "#delivery") return { page:"delivery" };
  const raw = sessionStorage.getItem(BP_SESSION_KEY);
  if (raw) {
    try {
      const { code, label } = JSON.parse(raw);
      if (TABLE_CODES[code]) return { page:"customer", code, label, orderType:"dine-in" };
    } catch { clearTableSession(); }
  }
  return { page:"landing" };
};

export const SUPABASE_URL   = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_READY = !!SUPABASE_URL && SUPABASE_URL.startsWith("https://");

export const STATUS_CFG = {
  pending:    { label:"Order Placed",     color:"bg-blue-100 text-blue-700",    icon:"🕐" },
  accepted:   { label:"Preparing",        color:"bg-orange-100 text-orange-700", icon:"👨‍🍳" },
  ready:      { label:"Ready! 🎉",        color:"bg-green-100 text-green-700",   icon:"✅" },
  dispatched: { label:"Out for Delivery", color:"bg-purple-100 text-purple-700", icon:"🛵" },
  served:     { label:"Completed",        color:"bg-stone-100 text-stone-500",   icon:"😊" },
  cancelled:  { label:"Cancelled",        color:"bg-red-100 text-red-600",       icon:"✕" },
};

// Orders still needing kitchen/floor attention — shown on the Orders tab.
// "served" and "cancelled" are historical and live in Sales instead.
export const ACTIVE_STATUSES = ["pending", "accepted", "ready", "dispatched"];

// Preset cancellation reasons — shown to admin when cancelling, and to the customer's tracker.
export const CANCEL_REASONS = [
  { id: "item_unavailable", label: "Item(s) out of stock" },
  { id: "kitchen_busy",     label: "Kitchen too busy to fulfil in time" },
  { id: "customer_request", label: "Customer requested cancellation" },
  { id: "payment_issue",    label: "Payment could not be verified" },
  { id: "other",            label: "Other reason" },
];

export const getNextStep = (order) => {
  const { status, order_type } = order;
  if (status==="pending")    return { next:"accepted",   label:"Accept Order" };
  if (status==="accepted")   return { next:"ready",      label:"Mark Ready" };
  if (status==="ready") {
    if (order_type==="delivery") return { next:"dispatched", label:"Assign & Dispatch 🛵" };
    return { next:"served", label: order_type==="takeaway" ? "Mark Collected" : "Mark Served" };
  }
  if (status==="dispatched") return { next:"served", label:"Mark Delivered ✅" };
  return null;
};

export const getTrackerSteps = (ot) => {
  if (ot==="delivery") return [
    { key:"pending",    label:"Order Placed",       sub:"Kitchen notified",          icon:"📋" },
    { key:"accepted",   label:"Accepted",           sub:"Preparing your food 👨‍🍳",  icon:"🍳" },
    { key:"ready",      label:"Packed",             sub:"Ready to dispatch",         icon:"📦" },
    { key:"dispatched", label:"Out for Delivery 🛵",sub:"Rider is on the way!",      icon:"🛵" },
    { key:"served",     label:"Delivered ✅",        sub:"Enjoy your meal!",          icon:"😊" },
  ];
  if (ot==="takeaway") return [
    { key:"pending",  label:"Order Placed",         sub:"We received your order",    icon:"📋" },
    { key:"accepted", label:"Accepted",             sub:"Preparing your food 👨‍🍳",  icon:"🍳" },
    { key:"ready",    label:"Ready to Collect 🎉",  sub:"Please collect at counter", icon:"✅" },
    { key:"served",   label:"Collected",            sub:"Thank you! Enjoy!",         icon:"😊" },
  ];
  return [
    { key:"pending",  label:"Order Placed",   sub:"Kitchen has been notified",       icon:"📋" },
    { key:"accepted", label:"Accepted",       sub:"Preparing your food 👨‍🍳",        icon:"🍳" },
    { key:"ready",    label:"Ready! 🎉",      sub:"Coming to your table soon",       icon:"✅" },
    { key:"served",   label:"Served",         sub:"Enjoy your meal!",                icon:"😊" },
  ];
};

// ── MENU DATA ──────────────────────────────────────────────

const IMG = (id,w=400,h=300) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format&q=80`;
const VB1 = IMG("1550547660-d9450f859349");
const VB2 = IMG("1571091718767-18b5b1457add");
const VB3 = IMG("1550317138-10000687a72b");

// Each item has: id, name, category, price, img, variants|null, description, addons[], is_available
const s  = (p,i,d="") => ({ price:p, img:i||null, variants:null,                                              description:d, addons:[], is_available:true });
const hf = (h,f,i,d="") => ({ price:h, img:i||null, variants:[{label:"Half",price:h},{label:"Full",price:f}],  description:d, addons:[], is_available:true });
const rl = (r,l,i,d="") => ({ price:r, img:i||null, variants:[{label:"Regular",price:r},{label:"Large",price:l}], description:d, addons:[], is_available:true });

export const CATEGORIES = [
  { id:"burgers",    label:"Burgers",         emoji:"🍔", img:VB1 },
  { id:"grilled",    label:"Grilled Burgers",  emoji:"🌿", img:VB2 },
  { id:"pizza",      label:"Pizza",            emoji:"🍕", img:IMG("1565299624946-b28f40a0ae38") },
  { id:"pasta",      label:"Pasta",            emoji:"🍝", img:IMG("1555949258-eb67b1ef0ceb") },
  { id:"sandwiches", label:"Sandwiches",       emoji:"🥪", img:IMG("1528735602780-2552fd46c7af") },
  { id:"wraps",      label:"Wraps",            emoji:"🌯", img:IMG("1626700051175-6818013e1d4f") },
  { id:"chinese",    label:"Chinese",          emoji:"🥡", img:IMG("1563245372-f21724e3856d") },
  { id:"noodles",    label:"Noodles",          emoji:"🍜", img:IMG("1612929633738-8fe44f7ec841") },
  { id:"rice",       label:"Rice & Combos",    emoji:"🍚", img:IMG("1563379926898-05f4575a45d8") },
  { id:"momos",      label:"Momos",            emoji:"🥟", img:IMG("1563245372-f21724e3856d",400,400) },
  { id:"quickbites", label:"Quick Bites",      emoji:"🍟", img:IMG("1598679253544-2c97992403ea") },
  { id:"sizzlers",   label:"Sizzlers",         emoji:"🔥", img:IMG("1565557623262-b51c2513a641") },
  { id:"sides",      label:"On The Side",      emoji:"🍟", img:IMG("1598679253544-2c97992403ea",400,400) },
  { id:"maggi",      label:"Maggi",            emoji:"🍲", img:IMG("1574894709629-ddcf6d8a7b1f") },
  { id:"soup",       label:"Soup",             emoji:"🥣", img:IMG("1547592166-23ac45744acd") },
  { id:"corn",       label:"Corn & Café",      emoji:"🌽", img:IMG("1551754655-cd27e38d2076") },
  { id:"shakes",     label:"Shakes & Coffee",  emoji:"🥤", img:IMG("1579954115545-a95591f28bfc") },
  { id:"mocktails",  label:"Mocktails",        emoji:"🍹", img:IMG("1556679343-c7306c1976bc") },
  { id:"tea",        label:"Tea & Coffee",     emoji:"☕", img:IMG("1509042239860-f550ce710b93") },
  { id:"sweets",     label:"Sweets",           emoji:"🧁", img:IMG("1551615593-ef5fe247e8f7") },
];

export const DEFAULT_MENU = {
  burgers:[
    {id:"b01",name:"Aloo Tikki Burger",category:"burgers",...s(49,VB1,"Classic aloo tikki in a soft bun with fresh lettuce and sauces.")},
    {id:"b02",name:"Supreme Tikki Burger",category:"burgers",...s(79,VB1,"Loaded tikki burger with extra fillings and signature sauce.")},
    {id:"b03",name:"Aloo Tikki Cheese Burger",category:"burgers",...s(99,VB3,"Aloo tikki topped with melted processed cheese slice.")},
    {id:"b04",name:"Hash Brown Burger",category:"burgers",...s(69,VB1,"Crispy hash brown patty in a toasted bun.")},
    {id:"b05",name:"Hash Brown Cheese Burger",category:"burgers",...s(89,VB3,"Crispy hash brown with cheese and special sauce.")},
    {id:"b06",name:"Corn Palak Burger",category:"burgers",...s(59,VB1,"Healthy corn and spinach patty burger.")},
    {id:"b07",name:"Corn Palak Cheese Burger",category:"burgers",...s(89,VB3,"Corn palak burger loaded with cheese.")},
    {id:"b08",name:"Veg. Burger",category:"burgers",...s(79,VB1,"Classic vegetable burger with fresh veggies.")},
    {id:"b09",name:"Veg Burger with Cheese",category:"burgers",...s(99,VB3)},
    {id:"b10",name:"Veg. N Crispy Burger",category:"burgers",...s(99,VB2)},
    {id:"b11",name:"Veg. Korean Burger",category:"burgers",...s(99,VB2,"Korean-style veg burger with gochujang mayo.")},
    {id:"b12",name:"Veg. Cheese Korean Burger",category:"burgers",...s(129,VB3)},
    {id:"b13",name:"Paneer Tikki Korean",category:"burgers",...s(139,VB2,"Juicy paneer tikki in Korean-inspired sauce.")},
    {id:"b14",name:"Paneer Tikki Cheese Korean",category:"burgers",...s(149,VB3)},
    {id:"b15",name:"Veg. Surprise Burger",category:"burgers",...s(129,VB2)},
    {id:"b16",name:"Veg. Chilli Lava Burger",category:"burgers",...s(149,VB2,"Spicy lava sauce oozes out of every bite.")},
    {id:"b17",name:"Veg. Double Cheese Burger",category:"burgers",...s(169,VB3,"Double cheese slices, double happiness.")},
    {id:"b18",name:"Double Veg. N Crisp Burger",category:"burgers",...s(139,VB2)},
    {id:"b19",name:"Veg Crispy N Crunchy Burger",category:"burgers",...s(120,VB2)},
    {id:"b20",name:"Veg. Maharaja Supreme Burger",category:"burgers",...s(160,VB2,"Our biggest, most loaded veg burger.")},
    {id:"b21",name:"Paneer Tikki Burger",category:"burgers",...s(129,VB2)},
    {id:"b22",name:"Paneer Chilli Lava Burger",category:"burgers",...s(120,VB2)},
    {id:"b23",name:"Paneer Crisp N Crunchy Burger",category:"burgers",...s(140,VB2)},
    {id:"b24",name:"Paneer Maharaja Burger",category:"burgers",...s(180,VB2,"Premium paneer burger with all the works.")},
  ],
  grilled:[
    {id:"g01",name:"Veg. Grilled Burger",category:"grilled",...s(99,VB2,"Charcoal-grilled veggie patty in a toasted bun.")},
    {id:"g02",name:"Double Veg. Grilled Burger",category:"grilled",...s(159,VB2)},
    {id:"g03",name:"Triple Veg. Grilled Burger",category:"grilled",...s(179,VB2,"Three grilled patties stacked high.")},
  ],
  pizza:[
    {id:"p01",name:"Handi Pizza",category:"pizza",...s(99,IMG("1565299624946-b28f40a0ae38"),"Personal-size handi-style pizza.")},
    {id:"p02",name:"Classic Corn Pizza",category:"pizza",...rl(159,199,IMG("1565299585323-38d6b0865b47"))},
    {id:"p03",name:"Paneer Makhni Pizza",category:"pizza",...rl(179,249,IMG("1574071318508-1cdbab80d002"),"Rich paneer makhni sauce topped pizza.")},
    {id:"p04",name:"Onion & Paneer Pizza",category:"pizza",...rl(129,159,IMG("1565299624946-b28f40a0ae38"))},
    {id:"p05",name:"Jalapeno Pizza",category:"pizza",...rl(119,149,IMG("1565299624946-b28f40a0ae38"))},
    {id:"p06",name:"Veggie Pizza",category:"pizza",...rl(139,179,IMG("1574071318508-1cdbab80d002"))},
    {id:"p07",name:"Mushroom Paneer Pizza",category:"pizza",...rl(159,199,IMG("1574071318508-1cdbab80d002"))},
    {id:"p08",name:"Maharaja Pizza",category:"pizza",...rl(199,245,IMG("1574071318508-1cdbab80d002"),"Fully loaded with premium toppings.")},
    {id:"p09",name:"Margherita Pizza",category:"pizza",...rl(120,149,IMG("1565299624946-b28f40a0ae38"))},
    {id:"p10",name:"Tandoori Paneer Pizza",category:"pizza",...rl(169,229,IMG("1574071318508-1cdbab80d002"))},
  ],
  pasta:[
    {id:"pa01",name:"White Cheese Pasta",category:"pasta",...s(149,IMG("1555949258-eb67b1ef0ceb"),"Creamy white sauce pasta with cheese.")},
    {id:"pa02",name:"Red Sauce Pasta",category:"pasta",...s(149,IMG("1621996346565-e3dbc646d9a9"),"Tangy tomato-based pasta.")},
    {id:"pa03",name:"Mix Sauce Pasta",category:"pasta",...s(169,IMG("1555949258-eb67b1ef0ceb"),"Best of both — red and white sauce.")},
  ],
  sandwiches:[
    {id:"s01",name:"Coleslaw Sandwich",category:"sandwiches",...s(79,IMG("1528735602780-2552fd46c7af"))},
    {id:"s02",name:"Veg. Cheese Sandwich",category:"sandwiches",...s(89,IMG("1509722747041-616f39b57169"))},
    {id:"s03",name:"Veg. Raseela Sandwich",category:"sandwiches",...s(89,IMG("1528735602780-2552fd46c7af"))},
    {id:"s04",name:"Veg. Raseela Cheese Sandwich",category:"sandwiches",...s(89,IMG("1509722747041-616f39b57169"))},
    {id:"s05",name:"Veg. Chilli Sandwich",category:"sandwiches",...s(89,IMG("1528735602780-2552fd46c7af"))},
    {id:"s06",name:"Veg. Chilli Cheese Sandwich",category:"sandwiches",...s(109,IMG("1509722747041-616f39b57169"))},
    {id:"s07",name:"Garlic Sandwich",category:"sandwiches",...s(89,IMG("1619535860434-ba1d8fa12536"))},
    {id:"s08",name:"Garlic Cheese Sandwich",category:"sandwiches",...s(109,IMG("1619535860434-ba1d8fa12536"))},
    {id:"s09",name:"Veg. Mexican Sandwich",category:"sandwiches",...s(89,IMG("1528735602780-2552fd46c7af"))},
    {id:"s10",name:"Veg. Mexican Cheese Sandwich",category:"sandwiches",...s(99,IMG("1509722747041-616f39b57169"))},
    {id:"s11",name:"Paneer Tandoori Sandwich",category:"sandwiches",...s(119,IMG("1509722747041-616f39b57169"))},
  ],
  wraps:[
    {id:"w01",name:"Aloo Tikki Thick Wrap",category:"wraps",...s(129,IMG("1626700051175-6818013e1d4f"))},
    {id:"w02",name:"Veg. Thick Wrap",category:"wraps",...s(129,IMG("1626700051175-6818013e1d4f"))},
    {id:"w03",name:"Paneer Thick Wrap",category:"wraps",...s(159,IMG("1626700051175-6818013e1d4f"))},
  ],
  chinese:[
    {id:"c01",name:"Veg. Manchurian Gravy",category:"chinese",...hf(139,269,IMG("1563245372-f21724e3856d"))},
    {id:"c02",name:"Veg. Manchurian Dry",category:"chinese",...hf(139,269,IMG("1563245372-f21724e3856d"))},
    {id:"c03",name:"Paneer Manchurian Dry",category:"chinese",...hf(149,289,IMG("1569050467447-ce54b3bbc37d"))},
    {id:"c04",name:"Paneer Manchurian Gravy",category:"chinese",...hf(149,289,IMG("1569050467447-ce54b3bbc37d"))},
    {id:"c05",name:"Chilli Paneer Gravy",category:"chinese",...hf(149,289,IMG("1569050467447-ce54b3bbc37d"))},
    {id:"c06",name:"Chilli Paneer Dry",category:"chinese",...hf(149,289,IMG("1569050467447-ce54b3bbc37d"))},
    {id:"c07",name:"Paneer 65",category:"chinese",...hf(149,289,IMG("1569050467447-ce54b3bbc37d"))},
    {id:"c08",name:"Paneer Dragon",category:"chinese",...hf(149,289,IMG("1565557623262-b51c2513a641"))},
    {id:"c09",name:"Mushroom Chilli",category:"chinese",...hf(149,289,IMG("1565557623262-b51c2513a641"))},
    {id:"c10",name:"Veg Chilli",category:"chinese",...hf(149,289,IMG("1563245372-f21724e3856d"))},
    {id:"c11",name:"Crispy Baby Corn",category:"chinese",...hf(149,289,IMG("1551754655-cd27e38d2076"))},
  ],
  noodles:[
    {id:"n01",name:"Veg. Noodles",category:"noodles",...hf(89,169,IMG("1612929633738-8fe44f7ec841"))},
    {id:"n02",name:"Paneer Noodles",category:"noodles",...hf(139,269,IMG("1612929633738-8fe44f7ec841"))},
    {id:"n03",name:"Chilli Garlic Noodles",category:"noodles",...hf(149,249,IMG("1569050467447-ce54b3bbc37d"))},
    {id:"n04",name:"Singapore Noodles",category:"noodles",...hf(149,249,IMG("1612929633738-8fe44f7ec841"))},
    {id:"n05",name:"Schezwan Noodles",category:"noodles",...hf(149,249,IMG("1612929633738-8fe44f7ec841"))},
    {id:"n06",name:"Mushroom Noodles",category:"noodles",...hf(149,249,IMG("1612929633738-8fe44f7ec841"))},
    {id:"n07",name:"Hakka Noodles",category:"noodles",...hf(169,269,IMG("1569050467447-ce54b3bbc37d"))},
  ],
  rice:[
    {id:"r01",name:"Veg Fried Rice",category:"rice",...rl(110,220,IMG("1563379926898-05f4575a45d8"))},
    {id:"r02",name:"Paneer Fried Rice",category:"rice",...rl(150,250,IMG("1563379926898-05f4575a45d8"))},
    {id:"r03",name:"Chilli Garlic Fried Rice",category:"rice",...rl(150,250,IMG("1563379926898-05f4575a45d8"))},
    {id:"r04",name:"Singapuri Rice",category:"rice",...rl(150,250,IMG("1563379926898-05f4575a45d8"))},
    {id:"r05",name:"Schezwan Rice",category:"rice",...rl(150,250,IMG("1563379926898-05f4575a45d8"))},
    {id:"r06",name:"Mushroom Rice",category:"rice",...rl(150,250,IMG("1563379926898-05f4575a45d8"))},
    {id:"r07",name:"Rice/Noodles + Manchurian (Combo)",category:"rice",...hf(200,400,IMG("1563379926898-05f4575a45d8"))},
    {id:"r08",name:"Rice/Noodles + Paneer Chilly (Combo)",category:"rice",...hf(220,440,IMG("1563379926898-05f4575a45d8"))},
  ],
  momos:[
    {id:"m01",name:"Steam Veg Momos",category:"momos",...hf(79,149,IMG("1563245372-f21724e3856d"))},
    {id:"m02",name:"Steam Paneer Momos",category:"momos",...hf(99,199,IMG("1563245372-f21724e3856d"))},
    {id:"m03",name:"Fry Veg Momos",category:"momos",...hf(89,159,IMG("1563245372-f21724e3856d"))},
    {id:"m04",name:"Fry Paneer Momos",category:"momos",...hf(109,199,IMG("1563245372-f21724e3856d"))},
  ],
  quickbites:[
    {id:"qb01",name:"Macaroni",category:"quickbites",...hf(79,149,IMG("1555949258-eb67b1ef0ceb"))},
    {id:"qb02",name:"Chilli Potato",category:"quickbites",...hf(99,189,IMG("1598679253544-2c97992403ea"))},
    {id:"qb03",name:"Honey Chilli Potato",category:"quickbites",...hf(129,249,IMG("1598679253544-2c97992403ea"))},
    {id:"qb04",name:"Crispy Corn",category:"quickbites",...hf(149,269,IMG("1551754655-cd27e38d2076"))},
    {id:"qb05",name:"Crispy Baby Corn Chilli",category:"quickbites",...hf(169,279,IMG("1551754655-cd27e38d2076"))},
    {id:"qb06",name:"Spring Roll",category:"quickbites",...s(160,IMG("1563245372-f21724e3856d"))},
  ],
  sizzlers:[
    {id:"sz01",name:"Veg Manchurian + Veg Noodles + Veg Fry Momos",category:"sizzlers",...s(375,IMG("1565557623262-b51c2513a641"),"A full sizzler platter for one.")},
    {id:"sz02",name:"Paneer Manchurian + Paneer Noodles + Spring Roll",category:"sizzlers",...s(430,IMG("1565557623262-b51c2513a641"))},
    {id:"sz03",name:"Chilli Paneer + Chilli Garlic Noodles + Fries",category:"sizzlers",...s(350,IMG("1565557623262-b51c2513a641"))},
    {id:"sz04",name:"Veg Fried Rice + Paneer Momos Fry + Chilli Potato",category:"sizzlers",...s(405,IMG("1565557623262-b51c2513a641"))},
  ],
  sides:[
    {id:"si01",name:"French Fries (S)",category:"sides",...s(75,IMG("1598679253544-2c97992403ea"))},
    {id:"si02",name:"French Fries (L)",category:"sides",...s(100,IMG("1598679253544-2c97992403ea"))},
    {id:"si03",name:"French Fries Peri-Peri (S)",category:"sides",...s(90,IMG("1598679253544-2c97992403ea"))},
    {id:"si04",name:"French Fries Peri-Peri (L)",category:"sides",...s(120,IMG("1598679253544-2c97992403ea"))},
    {id:"si05",name:"Loaded French Fries",category:"sides",...s(130,IMG("1598679253544-2c97992403ea"))},
    {id:"si06",name:"Veg Nuggets (10 Pc.)",category:"sides",...s(90,IMG("1598679253544-2c97992403ea"))},
    {id:"si07",name:"Cheese Corn Nugget (8 Pc.)",category:"sides",...s(120,IMG("1551754655-cd27e38d2076"))},
    {id:"si08",name:"Cheese Ball (8 Pc.)",category:"sides",...s(100,IMG("1619535860434-ba1d8fa12536"))},
    {id:"si09",name:"Meal Box",category:"sides",...s(100,IMG("1598679253544-2c97992403ea"))},
  ],
  maggi:[
    {id:"mg01",name:"Plain Maggi",category:"maggi",...s(69,IMG("1574894709629-ddcf6d8a7b1f"))},
    {id:"mg02",name:"Veg Maggi",category:"maggi",...s(79,IMG("1574894709629-ddcf6d8a7b1f"))},
    {id:"mg03",name:"Cheese Maggi",category:"maggi",...s(89,IMG("1574894709629-ddcf6d8a7b1f"))},
    {id:"mg04",name:"Masala Maggi",category:"maggi",...s(99,IMG("1574894709629-ddcf6d8a7b1f"))},
    {id:"mg05",name:"Corn Maggi",category:"maggi",...s(99,IMG("1574894709629-ddcf6d8a7b1f"))},
  ],
  soup:[
    {id:"so01",name:"Veg. Soup",category:"soup",...s(119,IMG("1547592166-23ac45744acd"))},
    {id:"so02",name:"Hot & Sour Soup",category:"soup",...s(119,IMG("1547592166-23ac45744acd"))},
    {id:"so03",name:"Corn Soup",category:"soup",...s(119,IMG("1547592166-23ac45744acd"))},
    {id:"so04",name:"Tomato Soup",category:"soup",...s(119,IMG("1547592166-23ac45744acd"))},
  ],
  corn:[
    {id:"co01",name:"Salted Corn Cup",category:"corn",...s(59,IMG("1551754655-cd27e38d2076"))},
    {id:"co02",name:"Butter Sweet Corn",category:"corn",...s(69,IMG("1551754655-cd27e38d2076"))},
    {id:"co03",name:"Masala Corn",category:"corn",...s(69,IMG("1551754655-cd27e38d2076"))},
    {id:"co04",name:"Lemon Pepper Corn",category:"corn",...s(69,IMG("1551754655-cd27e38d2076"))},
    {id:"co05",name:"Chatpata Corn",category:"corn",...s(69,IMG("1551754655-cd27e38d2076"))},
    {id:"co06",name:"Peri Peri Corn",category:"corn",...s(69,IMG("1551754655-cd27e38d2076"))},
    {id:"co07",name:"Butter Garlic Bread (2 Pcs)",category:"corn",...s(79,IMG("1619535860434-ba1d8fa12536"))},
    {id:"co08",name:"Cheese Garlic Bread (2 Pcs)",category:"corn",...s(99,IMG("1619535860434-ba1d8fa12536"))},
    {id:"co09",name:"Potato Cheese Shotz (6 Pcs)",category:"corn",...s(99,IMG("1598679253544-2c97992403ea"))},
    {id:"co10",name:"Cheese Nachos",category:"corn",...s(99,IMG("1604467715878-83e57e8bc129"))},
    {id:"co11",name:"Cheese Samosa (4 Pcs)",category:"corn",...s(99,IMG("1598679253544-2c97992403ea"))},
    {id:"co12",name:"Avocado Toast (2 Pcs)",category:"corn",...s(149,IMG("1619535860434-ba1d8fa12536"))},
  ],
  shakes:[
    {id:"sh01",name:"Cold Coffee",category:"shakes",...s(99,IMG("1509042239860-f550ce710b93"))},
    {id:"sh02",name:"Irish Frappe",category:"shakes",...s(119,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh03",name:"Hazelnut Frappe",category:"shakes",...s(119,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh04",name:"Vanilla Choco",category:"shakes",...s(119,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh05",name:"Oreo Shake",category:"shakes",...s(129,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh06",name:"Kit Kat Shake",category:"shakes",...s(129,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh07",name:"Chocolate Shake",category:"shakes",...s(129,IMG("1534353436294-0dbd4bdac845"))},
    {id:"sh08",name:"Strawberry Shake",category:"shakes",...s(129,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh09",name:"Mango Shake",category:"shakes",...s(119,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh10",name:"ButterScotch Shake",category:"shakes",...s(129,IMG("1579954115545-a95591f28bfc"))},
    {id:"sh11",name:"Banana Shake",category:"shakes",...s(119,IMG("1579954115545-a95591f28bfc"))},
  ],
  mocktails:[
    {id:"mc01",name:"Mint Mojito",category:"mocktails",...s(99,IMG("1556679343-c7306c1976bc"))},
    {id:"mc02",name:"Watermelon Mojito",category:"mocktails",...s(99,IMG("1556679343-c7306c1976bc"))},
    {id:"mc03",name:"Virgin Mojito",category:"mocktails",...s(99,IMG("1556679343-c7306c1976bc"))},
    {id:"mc04",name:"Kala Khatta",category:"mocktails",...s(99,IMG("1528823872057-9c018a7a7553"))},
    {id:"mc05",name:"Khatta Meetha",category:"mocktails",...s(99,IMG("1528823872057-9c018a7a7553"))},
    {id:"mc06",name:"Blue Lagoon",category:"mocktails",...s(99,IMG("1556679343-c7306c1976bc"))},
    {id:"mc07",name:"Iced Tea",category:"mocktails",...s(99,IMG("1576092768241-dec231879fc3"))},
  ],
  tea:[
    {id:"t01",name:"Gossip Tea (Normal)",category:"tea",...s(40,IMG("1576092768241-dec231879fc3"))},
    {id:"t02",name:"Gossip Kulhad Tea",category:"tea",...s(45,IMG("1576092768241-dec231879fc3"))},
    {id:"t03",name:"Lemon Tea",category:"tea",...s(40,IMG("1576092768241-dec231879fc3"))},
    {id:"t04",name:"Green Tea",category:"tea",...s(40,IMG("1576092768241-dec231879fc3"))},
    {id:"t05",name:"Hot Coffee",category:"tea",...s(69,IMG("1509042239860-f550ce710b93"))},
    {id:"t06",name:"Black Coffee",category:"tea",...s(59,IMG("1509042239860-f550ce710b93"))},
    {id:"t07",name:"Kulhad Coffee",category:"tea",...s(74,IMG("1509042239860-f550ce710b93"))},
    {id:"t08",name:"Iced Tea (Medium Glass)",category:"tea",...s(79,IMG("1576092768241-dec231879fc3"))},
  ],
  sweets:[
    {id:"sw01",name:"Vanilla Pocket",category:"sweets",...s(59,IMG("1551615593-ef5fe247e8f7"))},
    {id:"sw02",name:"Apple Pocket",category:"sweets",...s(59,IMG("1551615593-ef5fe247e8f7"))},
  ],
};

export const ALL_ITEMS = Object.values(DEFAULT_MENU).flat();
