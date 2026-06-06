import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addToCart,
  analyzeSurroundings,
  applyBestVoucher,
  checkoutPreview,
  checkUserHistory,
  classifyNeed,
  buildSpatialSetup,
  compareProducts,
  dispatchTool,
  getBootstrap,
  getCart,
  getToolDefinitions,
  recommendBundle,
  removeFromCart,
  resetCart,
  searchCatalog
} from "./commerce.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env"));

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const publicBaseUrl = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || process.env.AGENT_BASE_URL);
const webRoot = path.join(__dirname, "ios", "ShopeeHybridAgent", "Web");

const TOOL_ROUTES = {
  "/api/tools/check-user-history": checkUserHistory,
  "/api/tools/analyze-surroundings": analyzeSurroundingsWithVision,
  "/api/tools/classify-need": classifyNeed,
  "/api/tools/search-catalog": searchCatalog,
  "/api/tools/build-spatial-setup": buildSpatialSetup,
  "/api/tools/recommend-bundle": recommendBundle,
  "/api/tools/compare-products": compareProducts,
  "/api/tools/add-to-cart": addToCart,
  "/api/tools/remove-from-cart": removeFromCart,
  "/api/tools/apply-best-voucher": applyBestVoucher,
  "/api/tools/checkout-preview": checkoutPreview
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      sendNoContent(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      sendJson(res, getBootstrap({ userId: url.searchParams.get("userId") || "u_001" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tools") {
      sendJson(res, { tools: getToolDefinitions() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cart") {
      sendJson(res, getCart({ userId: url.searchParams.get("userId") || "u_001" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/cart/reset") {
      const body = await readJsonBody(req);
      sendJson(res, resetCart({ userId: body.userId || "u_001" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/realtime-tool") {
      const body = await readJsonBody(req);
      const result = await dispatchRealtimeTool(body.name, body.arguments || {});
      sendJson(res, { name: body.name, result });
      return;
    }

    if (req.method === "POST" && TOOL_ROUTES[url.pathname]) {
      const body = await readJsonBody(req);
      sendJson(res, await TOOL_ROUTES[url.pathname](body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/session") {
      await createRealtimeSession(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, { error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || "Internal server error" }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Shopee Hybrid Agent server running at http://localhost:${port}`);
  for (const address of getLanAddresses()) {
    console.log(`iPhone LAN URL: http://${address}:${port}`);
  }
  if (publicBaseUrl) {
    console.log(`Public URL: ${publicBaseUrl}`);
  }
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function getLanAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function normalizeBaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function readTextBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

async function readJsonBody(req) {
  const body = await readTextBody(req);
  if (!body) return {};
  return JSON.parse(body);
}

async function createRealtimeSession(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(res, { error: "OPENAI_API_KEY is missing. Add it to .env before starting voice mode." }, 500);
    return;
  }

  const sdp = await readTextBody(req);
  const fd = new FormData();
  fd.set("sdp", sdp);
  fd.set("session", JSON.stringify(buildRealtimeSessionConfig()));

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": process.env.OPENAI_SAFETY_IDENTIFIER || "demo-user"
    },
    body: fd
  });

  const text = await response.text();
  if (!response.ok) {
    console.error("Realtime session failed:", text);
    sendJson(res, { error: "Failed to create Realtime session", details: safeJson(text) || text }, response.status);
    return;
  }

  sendText(res, text, 200, "application/sdp");
}

async function dispatchRealtimeTool(name, args) {
  const toolName = normalizeRealtimeToolName(name);
  if (toolName === "analyze_surroundings") {
    return analyzeSurroundingsWithVision(args);
  }
  return dispatchTool(toolName, args);
}

function normalizeRealtimeToolName(name = "") {
  if (name === "analyse_surroundings") return "analyze_surroundings";
  return name;
}

async function analyzeSurroundingsWithVision(args = {}) {
  const fallback = analyzeSurroundings(args);
  const imageUrl = normalizeVisionImageInput(args);

  if (!imageUrl) {
    return fallback;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ...fallback,
      source: "fallback",
      visionStatus: "openai_api_key_missing"
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": process.env.OPENAI_SAFETY_IDENTIFIER || args.userId || "demo-user"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildVisionPrompt(args) },
              { type: "input_image", image_url: imageUrl, detail: "low" }
            ]
          }
        ],
        max_output_tokens: 650
      })
    });

    const text = await response.text();
    if (!response.ok) {
      console.error("Vision analysis failed:", text);
      return {
        ...fallback,
        source: "fallback",
        visionStatus: "vision_api_error",
        visionError: safeVisionError(text)
      };
    }

    const payload = safeJson(text) || {};
    const outputText = extractOutputText(payload);
    const parsed = parseJsonObject(outputText);
    if (!parsed) {
      return {
        ...fallback,
        source: "fallback",
        visionStatus: "vision_output_unparseable",
        rawVisionSummary: outputText?.slice(0, 500) || ""
      };
    }

    return normalizeVisionResult(parsed, fallback);
  } catch (error) {
    console.error("Vision analysis unavailable:", error);
    return {
      ...fallback,
      source: "fallback",
      visionStatus: "vision_request_failed",
      visionError: error.message || "Vision request failed."
    };
  }
}

function normalizeVisionImageInput(args = {}) {
  if (args.imageDataUrl && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(args.imageDataUrl)) {
    return args.imageDataUrl;
  }
  if (args.imageBase64) {
    const mimeType = args.mimeType || "image/jpeg";
    return `data:${mimeType};base64,${args.imageBase64}`;
  }
  if (args.imageUrl && /^https?:\/\//i.test(args.imageUrl)) {
    return args.imageUrl;
  }
  return "";
}

function buildVisionPrompt(args = {}) {
  const userContext = args.question || args.userText || "What does the user need to buy for this scene?";
  return `
Analyze this image for an ecommerce shopping assistant. Return only valid JSON with this exact shape:
{
  "summary": "short scene summary",
  "visualClues": ["specific visual evidence"],
  "suggestedSearchTerms": ["catalog search terms"],
  "detectedObjects": [{"label":"object", "confidence":0.0}],
  "possibleCategory": "home_repair|beauty|fashion|electronics|grocery|home_decor",
  "measurementHints": ["practical checks before buying"],
  "confidence": 0.0,
  "searchQuery": "short query for catalog search",
  "nextBestTool": "classify_need"
}

User context: ${userContext}
Use practical shopping language. Do not identify people. Do not invent products, prices, sellers, stock, or discounts.
`.trim();
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseJsonObject(text = "") {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeVisionResult(parsed, fallback) {
  const category = normalizeCategory(parsed.possibleCategory) || fallback.possibleCategory;
  const visualClues = normalizeStringArray(parsed.visualClues, fallback.visualClues);
  const suggestedSearchTerms = normalizeStringArray(parsed.suggestedSearchTerms, fallback.suggestedSearchTerms);
  const detectedObjects = Array.isArray(parsed.detectedObjects)
    ? parsed.detectedObjects.map((item) => normalizeDetectedObject(item)).filter(Boolean).slice(0, 8)
    : fallback.detectedObjects;

  return {
    ...fallback,
    summary: stringOr(parsed.summary, fallback.summary),
    visualClues,
    suggestedSearchTerms,
    detectedObjects,
    possibleCategory: category,
    measurementHints: normalizeStringArray(parsed.measurementHints, fallback.measurementHints),
    confidence: clampConfidence(parsed.confidence, Math.max(fallback.confidence, 0.65)),
    searchQuery: stringOr(parsed.searchQuery, suggestedSearchTerms.join(" ")),
    nextBestTool: parsed.nextBestTool === "search_catalog" ? "search_catalog" : "classify_need",
    source: "vision",
    visionStatus: "ok"
  };
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
}

function normalizeDetectedObject(item) {
  if (typeof item === "string") return { label: item, confidence: 0.5 };
  if (!item || typeof item !== "object" || !item.label) return null;
  return {
    label: String(item.label),
    confidence: clampConfidence(item.confidence, 0.5)
  };
}

function normalizeCategory(value) {
  const allowed = new Set(["home_repair", "beauty", "fashion", "electronics", "grocery", "home_decor"]);
  return allowed.has(value) ? value : null;
}

function stringOr(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function clampConfidence(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function safeVisionError(text) {
  const payload = safeJson(text);
  return payload?.error?.message || String(text || "").slice(0, 240);
}

function buildRealtimeSessionConfig() {
  return {
    type: "realtime",
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2",
    instructions: REALTIME_INSTRUCTIONS,
    audio: {
      input: {
        turn_detection: {
          type: "server_vad",
          threshold: Number(process.env.OPENAI_REALTIME_VAD_THRESHOLD || 0.68),
          prefix_padding_ms: Number(process.env.OPENAI_REALTIME_VAD_PREFIX_PADDING_MS || 500),
          silence_duration_ms: Number(process.env.OPENAI_REALTIME_VAD_SILENCE_MS || 900),
          create_response: true,
          interrupt_response: true
        }
      },
      output: {
        voice: process.env.OPENAI_REALTIME_VOICE || "marin"
      }
    },
    tool_choice: "auto",
    tools: getToolDefinitions()
  };
}

const REALTIME_INSTRUCTIONS = `
You are Shopee's Universal Shopping Agent, a proactive voice shopping assistant.

Use tools for factual commerce work. Do not invent products, prices, sellers, stock, vouchers, totals, or delivery estimates.

Tool strategy:
1. Classify the user's need before searching the catalog.
2. Check user history early when the request may involve replenishment, prior preferences, duplicate avoidance, or context such as home setup.
3. If the user refers to what they are seeing, holding, pointing at, wearing, or photographing, call analyze_surroundings before classification or catalog search.
4. For visual questions like "what am I looking at?", "what do you see?", "analyze my surroundings", or "what is this?", you must call analyze_surroundings first. Do not say you cannot access the camera if that tool is available.
5. Search only the catalog tool for recommendations.
6. When the user wants to build, place, preview, or remix a desk setup in AR or 3D, call build_spatial_setup.
7. Treat short follow-up edits like "remove the lamp", "make it more aesthetic", "make it cheaper", or "keep the monitor but change the accessories" as build_spatial_setup requests when a setup already exists.
8. Explain recommendations using factual product fields such as bestFor, tradeoffs, rating, delivery, seller, stock, fit score, and total price.
9. Suggest compatible bundles when the user is solving a practical task.
10. Compare products when multiple options are plausible.
11. Never add items to or remove items from cart without explicit user confirmation.
12. After cart mutation, apply the best voucher and call checkout_preview.

Keep spoken replies concise and demo-friendly. Ask one clear follow-up only when required.
`.trim();

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = path.normalize(path.join(webRoot, cleanPath));
  if (!target.startsWith(webRoot)) {
    sendJson(res, { error: "Forbidden" }, 403);
    return;
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    sendJson(res, { error: "Not found" }, 404);
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentTypeFor(target),
    "Access-Control-Allow-Origin": "*"
  });
  fs.createReadStream(target).pipe(res);
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, payload, status = 200, contentType = "text/plain") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(payload);
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end();
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
