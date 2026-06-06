import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");

const products = readJson("products.json");
const sellers = readJson("sellers.json");
const vouchers = readJson("vouchers.json");
const users = readJson("users.json");

const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));
const productById = new Map(products.map((product) => [product.id, product]));
const userById = new Map(users.map((user) => [user.user_id, user]));
const sessions = new Map();

const DELIVERY_RANK = {
  same_day: 3,
  next_day: 2,
  standard: 1
};

const REPLENISHABLE_CATEGORIES = new Set(["beauty", "grocery"]);

const CATEGORY_HINTS = [
  {
    category: "home_repair",
    terms: ["sink", "leak", "pipe", "pvc", "tap", "faucet", "bathroom", "plumbing", "wrench", "seal"]
  },
  {
    category: "beauty",
    terms: ["skin", "dry", "moisturizer", "sunscreen", "cleanser", "mist", "spf", "face"]
  },
  {
    category: "fashion",
    terms: ["jeans", "pants", "belt", "tee", "shirt", "outfit", "office", "wear", "fashion"]
  },
  {
    category: "electronics",
    terms: ["charger", "usb", "cable", "plug", "smart", "bluetooth", "phone", "device"]
  },
  {
    category: "grocery",
    terms: ["coffee", "milk", "rice", "dishwashing", "pantry", "grocery", "food", "refill"]
  },
  {
    category: "home_decor",
    terms: ["lamp", "storage", "table", "hook", "decor", "home", "room", "bedside"]
  }
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalize(text = "") {
  return String(text).toLowerCase();
}

function tokenize(text = "") {
  return normalize(text)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function getSession(userId = "u_001") {
  if (!sessions.has(userId)) {
    sessions.set(userId, { cart: [], lastSetup: null });
  }
  return sessions.get(userId);
}

function getUser(userId = "u_001") {
  return userById.get(userId) || users[0];
}

function enrichProduct(product) {
  if (!product) return null;
  return {
    ...product,
    seller: sellerById.get(product.sellerId) || null
  };
}

function hydrateCart(cart = []) {
  return cart
    .map((item) => {
      const product = productById.get(item.productId);
      if (!product) return null;
      return {
        product: enrichProduct(product),
        quantity: item.quantity,
        lineTotal: roundMoney(product.price * item.quantity)
      };
    })
    .filter(Boolean);
}

function inferCategory(message = "") {
  const text = normalize(message);
  const scored = CATEGORY_HINTS.map(({ category, terms }) => ({
    category,
    score: terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].category : "home_repair";
}

function inferConstraints(message = "") {
  const text = normalize(message);
  return {
    urgency: text.includes("today") || text.includes("urgent") || text.includes("now") ? "same_day" : "soon",
    budget: text.includes("cheap") || text.includes("budget") || text.includes("affordable") ? "low" : "balanced",
    needsBundle: text.includes("fix") || text.includes("repair") || text.includes("complete") || text.includes("everything")
  };
}

function parseBudgetValue(message = "", fallback = 800) {
  const match = String(message).match(/\$?(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : fallback;
}

function getSetupRole(product) {
  return product?.attributes?.setupRole || null;
}

function roleProducts(role) {
  return products.filter((product) => getSetupRole(product) === role && product.stock > 0);
}

function styleTags(product) {
  return product?.attributes?.style || [];
}

function layoutPositionForRole(role) {
  switch (role) {
    case "monitor":
      return "center_back";
    case "lamp":
      return "left_back";
    case "laptop_stand":
      return "right_back";
    case "keyboard":
      return "front_center";
    case "mouse":
      return "front_right";
    case "plant":
      return "front_left";
    default:
      return "front_center";
  }
}

function reasonForRole(role, message, product, deskWidthCm, deskDepthCm) {
  const text = normalize(message);
  switch (role) {
    case "monitor":
      if (text.includes("smaller")) return `${product.title} keeps the setup compact for a shallower desk while preserving coding space.`;
      return `I placed ${product.title} in the center for focus and comfortable split-screen work.`;
    case "lamp":
      return `I placed ${product.title} on the left to reduce glare while keeping the keyboard area clear.`;
    case "laptop_stand":
      return `I placed ${product.title} on the right because there is more free space there on a ${deskWidthCm} by ${deskDepthCm} cm desk.`;
    case "keyboard":
      return `${product.title} stays front and center so the main typing zone remains clear and comfortable.`;
    case "mouse":
      return `${product.title} sits on the front right to preserve a natural mouse arc beside the keyboard.`;
    case "plant":
      return `${product.title} adds warmth without taking over the main work area.`;
    default:
      return product.description || `Placed ${product.title} where it fits best.`;
  }
}

function buildSetupSummary(name, totalPrice, budget, fitScore, items) {
  const roles = items.map((item) => getSetupRole(item.product)).filter(Boolean);
  const monitor = roles.includes("monitor") ? "monitor" : "display";
  const lamp = roles.includes("lamp") ? "lamp" : "lighting";
  const stand = roles.includes("laptop_stand") ? "laptop stand" : "accessory";
  return `${name} fits the desk with a ${monitor} centered, the ${lamp} offset to control glare, and the ${stand} on the right. Total: $${totalPrice}. Fit score: ${fitScore}/100. Budget used: $${totalPrice} of $${budget}.`;
}

function scoreSetupCandidate(product, mode, text) {
  const styles = styleTags(product);
  let score = product.rating * 12 - product.price / 12;
  if (mode === "budget") score += 30 - product.price / 8;
  if (mode === "aesthetic") score += styles.includes("aesthetic") || styles.includes("minimal") || styles.includes("warm") ? 20 : 0;
  if (mode === "premium") score += styles.includes("premium") ? 16 : 0;
  if (mode === "productivity") score += styles.includes("productivity") || styles.includes("student") ? 16 : 0;
  if (text.includes("student") && styles.includes("student")) score += 8;
  if (text.includes("minimal") && styles.includes("minimal")) score += 8;
  if (text.includes("aesthetic") && styles.includes("aesthetic")) score += 8;
  if (text.includes("smaller monitor") && product.title.includes("24")) score += 18;
  if (text.includes("gaming")) score += product.title.includes("27") ? 6 : 0;
  return score;
}

function chooseSetupProduct(role, { mode, message, previousSetup, keepMonitor, swapAccessories }) {
  const text = normalize(message);
  const candidates = roleProducts(role);
  if (!candidates.length) return null;

  if (role === "monitor" && keepMonitor && previousSetup?.items?.length) {
    const previousMonitor = previousSetup.items.find((item) => getSetupRole(item.product) === "monitor");
    if (previousMonitor) return previousMonitor.product;
  }

  let pool = [...candidates];
  if (role === "monitor" && text.includes("smaller monitor")) {
    pool = pool.filter((product) => product.title.includes("24")) || pool;
  }

  pool.sort((a, b) => scoreSetupCandidate(b, mode, text) - scoreSetupCandidate(a, mode, text));

  if (swapAccessories && role !== "monitor" && previousSetup?.items?.length) {
    const previousIds = new Set(previousSetup.items.map((item) => item.product.id));
    const alternate = pool.find((product) => !previousIds.has(product.id));
    if (alternate) return alternate;
  }

  return pool[0];
}

function optimizeSetupForBudget(selectedItems, budget) {
  const items = [...selectedItems];
  let total = roundMoney(items.reduce((sum, item) => sum + item.product.price, 0));
  if (total <= budget) return items;

  const plantIndex = items.findIndex((item) => getSetupRole(item.product) === "plant");
  if (plantIndex !== -1) {
    items.splice(plantIndex, 1);
    total = roundMoney(items.reduce((sum, item) => sum + item.product.price, 0));
  }
  if (total <= budget) return items;

  const cheaperMonitor = roleProducts("monitor").sort((a, b) => a.price - b.price)[0];
  const monitorIndex = items.findIndex((item) => getSetupRole(item.product) === "monitor");
  if (monitorIndex !== -1 && cheaperMonitor && cheaperMonitor.price < items[monitorIndex].product.price) {
    items[monitorIndex] = { ...items[monitorIndex], product: cheaperMonitor };
    total = roundMoney(items.reduce((sum, item) => sum + item.product.price, 0));
  }
  if (total <= budget) return items;

  const cheaperKeyboard = roleProducts("keyboard").sort((a, b) => a.price - b.price)[0];
  const keyboardIndex = items.findIndex((item) => getSetupRole(item.product) === "keyboard");
  if (keyboardIndex !== -1 && cheaperKeyboard && cheaperKeyboard.price < items[keyboardIndex].product.price) {
    items[keyboardIndex] = { ...items[keyboardIndex], product: cheaperKeyboard };
  }

  return items;
}

export function buildSpatialSetup({ message = "", userId = "u_001", deskWidthCm = 100, deskDepthCm = 60 } = {}) {
  const session = getSession(userId);
  const previousSetup = session.lastSetup;
  const text = normalize(message);
  const budget = parseBudgetValue(message, previousSetup?.budget || 800);

  const wantsAesthetic = ["aesthetic", "minimal", "warmer", "warm"].some((term) => text.includes(term));
  const wantsCheaper = ["cheaper", "budget", "affordable"].some((term) => text.includes(term));
  const wantsPremium = ["premium", "better", "upgrade"].some((term) => text.includes(term));
  const wantsGaming = text.includes("gaming");
  const removeLamp = text.includes("remove the lamp") || text.includes("without lamp");
  const keepMonitor = text.includes("keep the monitor");
  const swapAccessories = text.includes("change the accessories");

  const mode = wantsAesthetic ? "aesthetic" : wantsCheaper ? "budget" : wantsPremium || wantsGaming ? "premium" : "productivity";

  const requiredRoles = ["monitor", "keyboard", "mouse", "laptop_stand"];
  if (!removeLamp) requiredRoles.splice(1, 0, "lamp");
  if (mode === "aesthetic") requiredRoles.push("plant");

  let items = requiredRoles.map((role) => {
    const product = chooseSetupProduct(role, { mode, message, previousSetup, keepMonitor, swapAccessories });
    return product ? { role, product } : null;
  }).filter(Boolean);

  items = optimizeSetupForBudget(items, budget);

  const totalPrice = roundMoney(items.reduce((sum, item) => sum + item.product.price, 0));
  const budgetPenalty = totalPrice > budget ? Math.round((totalPrice - budget) / 8) : 0;
  const depthPenalty = deskDepthCm < 55 && items.some((item) => getSetupRole(item.product) === "monitor" && item.product.title.includes("27")) ? 6 : 0;
  const fitScore = clamp(92 - budgetPenalty - depthPenalty + (mode === "aesthetic" ? 2 : 0), 70, 97);

  const setupName = mode === "aesthetic"
    ? "Aesthetic Focus Setup"
    : mode === "budget"
      ? "Budget Coding Setup"
      : mode === "premium"
        ? "Premium Productivity Setup"
        : "Productive Student Setup";

  const result = {
    setup_name: setupName,
    total_price: totalPrice,
    fit_score: fitScore,
    budget,
    summary: buildSetupSummary(setupName, totalPrice, budget, fitScore, items),
    items: items.map(({ role, product }) => ({
      id: product.id,
      title: product.title,
      price: product.price,
      position: layoutPositionForRole(role),
      reason: reasonForRole(role, message, product, deskWidthCm, deskDepthCm),
      product: enrichProduct(product)
    }))
  };

  session.lastSetup = result;
  return result;
}

export function classifyNeed({ message = "", imageContext = null } = {}) {
  const category = inferCategory(`${message} ${imageContext?.summary || ""}`);
  const constraints = inferConstraints(message);
  const normalizedMessage = normalize(message);
  const hasExistingSetup = Boolean(getSession("u_001").lastSetup);
  const setupRequest = /setup|workspace|desk|coding station|student setup|3d|ar/.test(normalizedMessage)
    || (hasExistingSetup && /remove|swap|change|replace|more aesthetic|more premium|cheaper|smaller monitor|keep the monitor|accessories|lamp|mouse|keyboard|stand|plant/.test(normalizedMessage));
  const searchTerms = [
    ...tokenize(message),
    ...CATEGORY_HINTS.find((hint) => hint.category === category)?.terms.slice(0, 4) || []
  ];

  return {
    category,
    confidence: message ? 0.78 : 0.45,
    problemSummary: message || imageContext?.summary || "User needs shopping help.",
    constraints,
    searchTerms: [...new Set(searchTerms)].slice(0, 10),
    nextBestTool: setupRequest ? "build_spatial_setup" : "search_catalog"
  };
}

export function analyzeSurroundings({
  question = "",
  userText = "",
  imageContext = null,
  imageDataUrl = "",
  imageBase64 = "",
  imageUrl = "",
  captureError = null
} = {}) {
  const text = [question, userText, imageContext?.summary].filter(Boolean).join(" ");
  const category = inferCategory(text);
  const categoryTerms = CATEGORY_HINTS.find((hint) => hint.category === category)?.terms || [];
  const hasImage = Boolean(imageDataUrl || imageBase64 || imageUrl);
  const visualClues = buildVisualClues({ category, text, categoryTerms });
  const suggestedSearchTerms = buildSurroundingsSearchTerms({ category, text, categoryTerms });

  return {
    summary: buildSurroundingsSummary({ category, text, hasImage, captureError }),
    visualClues,
    suggestedSearchTerms,
    detectedObjects: visualClues.map((label, index) => ({
      label,
      confidence: hasImage ? roundMoney(Math.max(0.35, 0.68 - index * 0.08)) : 0
    })),
    possibleCategory: category,
    measurementHints: buildMeasurementHints(category),
    confidence: hasImage ? 0.42 : 0,
    searchQuery: suggestedSearchTerms.join(" "),
    nextBestTool: "classify_need",
    source: hasImage ? "fallback_with_image" : "fallback",
    captureError: captureError || null
  };
}

function buildVisualClues({ category, text, categoryTerms }) {
  const matched = categoryTerms.filter((term) => normalize(text).includes(term));
  const defaults = {
    home_repair: ["under-sink area", "PVC pipe", "pipe joint", "possible water leak"],
    beauty: ["skin care item", "face routine context"],
    fashion: ["outfit item", "color and fit context"],
    electronics: ["device accessory", "port or charging context"],
    grocery: ["pantry item", "replenishment context"],
    home_decor: ["room corner", "placement and color context"]
  };

  return [...new Set([...matched, ...(defaults[category] || defaults.home_repair)])].slice(0, 6);
}

function buildSurroundingsSearchTerms({ category, text, categoryTerms }) {
  const tokens = tokenize(text).filter((token) => token.length > 2);
  const defaults = {
    home_repair: ["pvc pipe", "seal tape", "waterproof sealant", "slip coupling"],
    beauty: ["moisturizer", "sunscreen", "cleanser"],
    fashion: ["daily outfit", "shirt", "belt"],
    electronics: ["charger", "usb cable", "adapter"],
    grocery: ["refill", "pantry", "household supplies"],
    home_decor: ["storage", "lamp", "adhesive hook"]
  };

  return [...new Set([...tokens, ...categoryTerms.slice(0, 4), ...(defaults[category] || [])])].slice(0, 8);
}

function buildSurroundingsSummary({ category, text, hasImage, captureError }) {
  if (captureError) {
    return `Camera capture was unavailable, so this is inferred from the user's request as a ${category.replace("_", " ")} need.`;
  }
  if (!hasImage) {
    return `No image was supplied; inferred a likely ${category.replace("_", " ")} need from the user's request.`;
  }
  if (category === "home_repair") return "Likely home repair scene with plumbing or fixture context that needs compatible parts.";
  return `Likely ${category.replace("_", " ")} scene that needs catalog-backed recommendations.`;
}

function buildMeasurementHints(category) {
  if (category === "home_repair") {
    return [
      "Check the pipe diameter before buying a coupling.",
      "Confirm whether the leak is from a threaded joint, slip joint, or cracked pipe.",
      "Turn off water before attempting a repair."
    ];
  }
  if (category === "fashion") return ["Confirm size, fit preference, and color matching before buying."];
  if (category === "electronics") return ["Confirm port type, wattage, and device compatibility before buying."];
  if (category === "home_decor") return ["Confirm dimensions and surface type before buying."];
  return ["Confirm the user's exact variant and quantity before buying."];
}

export function searchCatalog({ query = "", category = null, userId = "u_001", limit = 5 } = {}) {
  const user = getUser(userId);
  const terms = tokenize(query);
  const preferredSellers = new Set(user.preferences?.preferred_sellers || []);
  const targetCategory = category || inferCategory(query);

  const ranked = products
    .filter((product) => !targetCategory || product.category === targetCategory)
    .map((product) => {
      const seller = sellerById.get(product.sellerId);
      const searchable = [
        product.title,
        product.description,
        product.category,
        ...(product.keywords || []),
        ...(product.bestFor || []),
        ...Object.values(product.attributes || {}).flat().map(String)
      ].join(" ");
      const haystack = normalize(searchable);
      const termScore = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 3 : 0), 0);
      const categoryScore = product.category === targetCategory ? 8 : 0;
      const deliveryScore = user.preferences?.delivery_priority === "fast" ? DELIVERY_RANK[product.delivery] || 0 : 0;
      const sellerScore = preferredSellers.has(product.sellerId) ? 3 : 0;
      const stockScore = product.stock > 0 ? 2 : -20;
      const reviewScore = Math.min(product.reviewCount || 0, 700) / 350;
      const ratingScore = product.rating;
      const score = termScore + categoryScore + deliveryScore + sellerScore + stockScore + reviewScore + ratingScore;

      return {
        product: enrichProduct(product),
        score: roundMoney(score),
        reasons: [
          categoryScore ? `Matches ${targetCategory.replace("_", " ")} need` : null,
          termScore ? "Matches user search terms" : null,
          deliveryScore ? `${formatDelivery(product.delivery)} available` : null,
          sellerScore ? `Preferred seller: ${seller?.name}` : null,
          stockScore > 0 ? `${product.stock} in stock` : "Out of stock"
        ].filter(Boolean)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 8)));

  return {
    query,
    category: targetCategory,
    results: ranked
  };
}

export function recommendBundle({ primaryProductId, userId = "u_001" } = {}) {
  const primary = productById.get(primaryProductId);
  if (!primary) {
    return { primaryProductId, bundle: [], missingProductIds: [primaryProductId], reason: "Primary product not found." };
  }

  const bundle = (primary.bundleItems || [])
    .map((id) => productById.get(id))
    .filter(Boolean)
    .map(enrichProduct);

  const user = getUser(userId);
  const shouldSuggestTool = primary.category === "home_repair" && user.household_context?.has_basic_tools === false;
  if (shouldSuggestTool && primary.id !== "HW004" && productById.has("HW004")) {
    bundle.push(enrichProduct(productById.get("HW004")));
  }

  return {
    primaryProductId,
    primaryProduct: enrichProduct(primary),
    bundle: dedupeProducts(bundle),
    reason: buildBundleReason(primary, bundle, user)
  };
}

function buildBundleReason(primary, bundle, user) {
  if (primary.category === "home_repair") {
    const toolNote = user.household_context?.has_basic_tools === false ? " I also included a compact wrench because this user may not have basic tools." : "";
    return `For a repair, the main part plus sealing items gives a more complete fix than buying ${primary.title} alone.${toolNote}`;
  }
  if (bundle.length) return `These items pair naturally with ${primary.title} based on compatibility and bundle data.`;
  return `${primary.title} does not need a required add-on.`;
}

function dedupeProducts(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function compareProducts({ productIds = [], criteria = ["price", "rating", "delivery", "stock", "seller"] } = {}) {
  const found = productIds.map((id) => productById.get(id)).filter(Boolean);
  const missingProductIds = productIds.filter((id) => !productById.has(id));
  const enriched = found.map(enrichProduct);

  if (enriched.length === 0) {
    return { products: [], missingProductIds, comparison: null };
  }

  const cheapest = minBy(enriched, (product) => product.price);
  const bestRated = maxBy(enriched, (product) => product.rating);
  const fastestDelivery = maxBy(enriched, (product) => DELIVERY_RANK[product.delivery] || 0);
  const bestSeller = maxBy(enriched, (product) => product.seller?.rating || 0);
  const recommended = maxBy(enriched, productScore);

  return {
    products: enriched,
    missingProductIds,
    criteria,
    comparison: {
      cheapest: cheapest.id,
      bestRated: bestRated.id,
      fastestDelivery: fastestDelivery.id,
      bestSeller: bestSeller.id,
      recommended: recommended.id,
      reasoning: `${recommended.title} is the best overall choice because it balances price, rating, delivery speed, stock, and seller quality.`
    }
  };
}

function productScore(product) {
  return (
    (product.stock > 0 ? 20 : -50) +
    product.rating * 8 +
    (DELIVERY_RANK[product.delivery] || 0) * 4 +
    (product.seller?.rating || 0) * 3 -
    product.price / 5
  );
}

function minBy(items, getter) {
  return items.reduce((best, item) => (getter(item) < getter(best) ? item : best), items[0]);
}

function maxBy(items, getter) {
  return items.reduce((best, item) => (getter(item) > getter(best) ? item : best), items[0]);
}

export function checkUserHistory({ userId = "u_001", category = null } = {}) {
  const user = userById.get(userId);
  if (!user) {
    return {
      userId,
      requestedUserId: userId,
      usedFallbackUser: false,
      preferences: safeDefaultPreferences(),
      householdContext: null,
      pastPurchases: [],
      reorderSuggestions: [],
      guidance: category
        ? `No user profile found and no prior ${category.replace("_", " ")} purchases are available; continue with catalog search.`
        : "No user profile found; continue with classification and catalog search."
    };
  }

  const today = new Date();
  const orderHistory = user.order_history || [];
  const filteredHistory = category
    ? orderHistory.filter((order) => order.category === category)
    : orderHistory;

  const pastPurchases = filteredHistory
    .map((order) => {
      const product = productById.get(order.product_id);
      if (!product) return null;
      const purchasedAt = new Date(order.purchased_at);
      return {
        product: enrichProduct(product),
        purchasedAt: order.purchased_at,
        daysSince: daysBetween(purchasedAt, today),
        category: order.category,
        quantity: order.quantity || 1,
        satisfaction: order.satisfaction ?? null
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt));

  const reorderSuggestions = pastPurchases
    .filter((purchase) => REPLENISHABLE_CATEGORIES.has(purchase.category) && purchase.daysSince >= 30)
    .map((purchase) => ({
      productId: purchase.product.id,
      title: purchase.product.title,
      category: purchase.category,
      daysSince: purchase.daysSince,
      reason: `${purchase.title || purchase.product.title} was purchased ${purchase.daysSince} days ago and ${purchase.category.replace("_", " ")} items are likely replenishable.`
    }));

  return {
    userId: user.user_id,
    requestedUserId: userId,
    usedFallbackUser: false,
    preferences: user.preferences || safeDefaultPreferences(),
    householdContext: user.household_context || null,
    pastPurchases,
    reorderSuggestions,
    guidance: buildHistoryGuidance({ category, pastPurchases, reorderSuggestions, user })
  };
}

function daysBetween(start, end) {
  if (Number.isNaN(start.getTime())) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / msPerDay));
}

function safeDefaultPreferences() {
  return {
    delivery_priority: "fast",
    budget_sensitivity: "medium",
    preferred_sellers: [],
    preferred_payment: "ShopeePay",
    avoid: []
  };
}

function buildHistoryGuidance({ category, pastPurchases, reorderSuggestions, user }) {
  if (reorderSuggestions.length) {
    return `Mention likely replenishment options before searching. ${reorderSuggestions[0].title} is a strong reorder candidate.`;
  }

  if (pastPurchases.length) {
    return `Use these past purchases to respect the user's preferences and avoid duplicate recommendations.`;
  }

  if (category) {
    return `No prior ${category.replace("_", " ")} purchases found for ${user.name || user.user_id}; continue with catalog search.`;
  }

  return `No relevant purchase history found; continue with classification and catalog search.`;
}

export function addToCart({ productId, productIds = [], quantity = 1, userId = "u_001" } = {}) {
  const ids = productIds.length ? productIds : [productId];
  const session = getSession(userId);
  const added = [];
  const missingProductIds = [];

  for (const id of ids.filter(Boolean)) {
    const product = productById.get(id);
    if (!product) {
      missingProductIds.push(id);
      continue;
    }

    const safeQuantity = Math.max(1, Math.min(Number(quantity) || 1, product.stock || 1));
    const existing = session.cart.find((item) => item.productId === id);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + safeQuantity, product.stock);
    } else {
      session.cart.push({ productId: id, quantity: safeQuantity });
    }
    added.push(enrichProduct(product));
  }

  return {
    userId,
    added,
    missingProductIds,
    cart: hydrateCart(session.cart),
    cartCount: session.cart.reduce((sum, item) => sum + item.quantity, 0)
  };
}

export function removeFromCart({ productId, productIds = [], quantity = null, userId = "u_001" } = {}) {
  const ids = productIds.length ? productIds : [productId];
  const session = getSession(userId);
  const removed = [];
  const missingProductIds = [];
  const removeAll = quantity === null || quantity === undefined;
  const safeQuantity = removeAll ? null : Math.max(1, Number(quantity) || 1);

  for (const id of ids.filter(Boolean)) {
    const lineIndex = session.cart.findIndex((item) => item.productId === id);
    if (lineIndex === -1) {
      missingProductIds.push(id);
      continue;
    }

    const line = session.cart[lineIndex];
    const product = productById.get(id);
    const removedQuantity = removeAll ? line.quantity : Math.min(safeQuantity, line.quantity);

    if (removeAll || line.quantity <= safeQuantity) {
      session.cart.splice(lineIndex, 1);
    } else {
      line.quantity -= safeQuantity;
    }

    if (product) {
      removed.push({
        product: enrichProduct(product),
        quantity: removedQuantity
      });
    }
  }

  return {
    userId,
    removed,
    missingProductIds,
    cart: hydrateCart(session.cart),
    cartCount: session.cart.reduce((sum, item) => sum + item.quantity, 0)
  };
}

export function applyBestVoucher({ userId = "u_001", cart = null } = {}) {
  const cartLines = cart ? hydrateCart(cart) : hydrateCart(getSession(userId).cart);
  const subtotal = cartSubtotal(cartLines);
  const categoryTotals = cartLines.reduce((totals, line) => {
    const category = line.product.category;
    totals[category] = roundMoney((totals[category] || 0) + line.lineTotal);
    return totals;
  }, {});

  const candidates = vouchers
    .map((voucher) => {
      const eligibleSpend = voucher.category ? categoryTotals[voucher.category] || 0 : subtotal;
      const eligible = eligibleSpend >= voucher.minSpend;
      return {
        voucher,
        eligible,
        eligibleSpend,
        discount: eligible ? calculateVoucherDiscount(voucher, eligibleSpend) : 0
      };
    })
    .filter((candidate) => candidate.eligible && candidate.discount > 0)
    .sort((a, b) => b.discount - a.discount || b.voucher.priority - a.voucher.priority);

  const best = candidates[0] || null;

  return {
    userId,
    subtotal,
    bestVoucher: best ? best.voucher : null,
    discount: best ? roundMoney(best.discount) : 0,
    candidates: candidates.map((candidate) => ({
      voucher: candidate.voucher,
      discount: roundMoney(candidate.discount),
      eligibleSpend: roundMoney(candidate.eligibleSpend)
    })),
    message: best ? `${best.voucher.code} saves $${roundMoney(best.discount).toFixed(2)} on this cart.` : "No voucher is currently eligible."
  };
}

function calculateVoucherDiscount(voucher, spend) {
  if (voucher.discountType === "free_shipping") return voucher.value;
  if (voucher.discountType === "fixed") return Math.min(voucher.value, spend);
  if (voucher.discountType === "percent") return spend * (voucher.value / 100);
  return 0;
}

export function checkoutPreview({ userId = "u_001", voucherCode = null } = {}) {
  const cart = hydrateCart(getSession(userId).cart);
  const subtotal = cartSubtotal(cart);
  const voucherResult = voucherCode
    ? applySpecificVoucher(voucherCode, cart)
    : applyBestVoucher({ userId });
  const shippingFee = cart.length ? 2.99 : 0;
  const shippingDiscount = voucherResult.bestVoucher?.discountType === "free_shipping" ? Math.min(shippingFee, voucherResult.discount) : 0;
  const itemDiscount = voucherResult.bestVoucher?.discountType === "free_shipping" ? 0 : voucherResult.discount;
  const total = roundMoney(subtotal + shippingFee - shippingDiscount - itemDiscount);

  return {
    userId,
    cart,
    subtotal,
    shippingFee,
    voucher: voucherResult.bestVoucher,
    voucherDiscount: roundMoney(voucherResult.discount),
    total,
    estimatedDelivery: estimateDelivery(cart),
    paymentMethod: getUser(userId).preferences?.preferred_payment || "ShopeePay"
  };
}

function applySpecificVoucher(voucherCode, cart) {
  const subtotal = cartSubtotal(cart);
  const categoryTotals = cart.reduce((totals, line) => {
    totals[line.product.category] = roundMoney((totals[line.product.category] || 0) + line.lineTotal);
    return totals;
  }, {});
  const voucher = vouchers.find((item) => item.code === voucherCode);
  if (!voucher) return { bestVoucher: null, discount: 0 };
  const eligibleSpend = voucher.category ? categoryTotals[voucher.category] || 0 : subtotal;
  if (eligibleSpend < voucher.minSpend) return { bestVoucher: null, discount: 0 };
  return { bestVoucher: voucher, discount: roundMoney(calculateVoucherDiscount(voucher, eligibleSpend)) };
}

function cartSubtotal(cart) {
  return roundMoney(cart.reduce((sum, line) => sum + line.lineTotal, 0));
}

function estimateDelivery(cart) {
  if (cart.length === 0) return null;
  const slowest = Math.min(...cart.map((line) => DELIVERY_RANK[line.product.delivery] || 1));
  if (slowest >= 3) return "Today";
  if (slowest === 2) return "Tomorrow";
  return "2-4 days";
}

function formatDelivery(delivery) {
  return delivery.replace("_", "-");
}

export function getCart({ userId = "u_001" } = {}) {
  return {
    userId,
    cart: hydrateCart(getSession(userId).cart),
    checkout: checkoutPreview({ userId })
  };
}

export function resetCart({ userId = "u_001" } = {}) {
  sessions.set(userId, { cart: [] });
  return getCart({ userId });
}

export function getBootstrap({ userId = "u_001" } = {}) {
  return {
    user: getUser(userId),
    categories: [...new Set(products.map((product) => product.category))],
    featuredProducts: products.slice(0, 6).map(enrichProduct),
    cart: getCart({ userId })
  };
}

export function dispatchTool(name, args = {}) {
  switch (name) {
    case "check_user_history":
      return checkUserHistory(args);
    case "analyze_surroundings":
      return analyzeSurroundings(args);
    case "classify_need":
      return classifyNeed(args);
    case "search_catalog":
      return searchCatalog(args);
    case "build_spatial_setup":
      return buildSpatialSetup(args);
    case "recommend_bundle":
      return recommendBundle(args);
    case "compare_products":
      return compareProducts(args);
    case "add_to_cart":
      return addToCart(args);
    case "remove_from_cart":
      return removeFromCart(args);
    case "apply_best_voucher":
      return applyBestVoucher(args);
    case "checkout_preview":
      return checkoutPreview(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function getToolDefinitions() {
  return [
    {
      type: "function",
      name: "check_user_history",
      description: "Look up user preferences and past purchases for personalization, reorder detection, and duplicate avoidance.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "The user profile ID. Defaults to u_001." },
          category: { type: "string", enum: ["home_repair", "beauty", "fashion", "electronics", "grocery", "home_decor"] }
        }
      }
    },
    {
      type: "function",
      name: "analyze_surroundings",
      description: "Analyze the user's current camera view or surroundings. The client captures and passes an image automatically, so use this for prompts like 'what am I looking at?' or 'analyze my surroundings' before catalog search.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "What the user wants to understand from the scene." },
          userText: { type: "string", description: "Optional spoken context from the user." },
          imageDataUrl: { type: "string", description: "JPEG/PNG/WebP data URL captured by the client." },
          imageBase64: { type: "string", description: "Base64-encoded image without the data URL prefix." },
          imageUrl: { type: "string", description: "Fully-qualified URL for an image to analyze." },
          mimeType: { type: "string", description: "Image MIME type, usually image/jpeg." },
          userId: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "classify_need",
      description: "Classify a shopping request into category, constraints, and search terms before searching the catalog.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The user's shopping request or problem." }
        },
        required: ["message"]
      }
    },
    {
      type: "function",
      name: "search_catalog",
      description: "Search the real mock Shopee catalog and return ranked products with factual reasons.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string", enum: ["home_repair", "beauty", "fashion", "electronics", "grocery", "home_decor"] },
          userId: { type: "string" },
          limit: { type: "number" }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "build_spatial_setup",
      description: "Build and remix a full desk setup for AR/3D viewing using budget, style, and desk-space cues. Use this when the user wants to see a setup placed in their real space.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The user's setup goal or remix request, for example 'Build me a productive student setup under $800' or 'Make it more aesthetic'." },
          userId: { type: "string" },
          deskWidthCm: { type: "number", description: "Approximate desk width in centimeters. Use 100 if unknown." },
          deskDepthCm: { type: "number", description: "Approximate desk depth in centimeters. Use 60 if unknown." }
        },
        required: ["message"]
      }
    },
    {
      type: "function",
      name: "recommend_bundle",
      description: "Recommend compatible add-on products for a primary product.",
      parameters: {
        type: "object",
        properties: {
          primaryProductId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["primaryProductId"]
      }
    },
    {
      type: "function",
      name: "compare_products",
      description: "Compare two or more products and explain the best overall option using price, rating, delivery, stock, and seller quality.",
      parameters: {
        type: "object",
        properties: {
          productIds: { type: "array", items: { type: "string" } },
          criteria: { type: "array", items: { type: "string" } }
        },
        required: ["productIds"]
      }
    },
    {
      type: "function",
      name: "add_to_cart",
      description: "Add one or more products to the user's cart after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string" },
          productIds: { type: "array", items: { type: "string" } },
          quantity: { type: "number" },
          userId: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "remove_from_cart",
      description: "Remove one or more products from the user's cart after explicit user confirmation. Omit quantity to remove the full line.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string" },
          productIds: { type: "array", items: { type: "string" } },
          quantity: { type: "number", description: "Quantity to remove. Omit to remove each matching cart line completely." },
          userId: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "apply_best_voucher",
      description: "Find and apply the best eligible voucher for the current cart.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "checkout_preview",
      description: "Return cart lines, shipping, voucher discount, total, estimated delivery, and payment method.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          voucherCode: { type: "string" }
        }
      }
    }
  ];
}
