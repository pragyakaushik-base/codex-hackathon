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
    sessions.set(userId, { cart: [] });
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

export function classifyNeed({ message = "", imageContext = null } = {}) {
  const category = inferCategory(`${message} ${imageContext?.summary || ""}`);
  const constraints = inferConstraints(message);
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
    nextBestTool: "search_catalog"
  };
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
    case "classify_need":
      return classifyNeed(args);
    case "search_catalog":
      return searchCatalog(args);
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
