import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addToCart,
  applyBestVoucher,
  checkoutPreview,
  classifyNeed,
  compareProducts,
  dispatchTool,
  getBootstrap,
  getCart,
  getToolDefinitions,
  recommendBundle,
  resetCart,
  searchCatalog
} from "./commerce.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env"));

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const webRoot = path.join(__dirname, "ios", "ShopeeHybridAgent", "Web");

const TOOL_ROUTES = {
  "/api/tools/classify-need": classifyNeed,
  "/api/tools/search-catalog": searchCatalog,
  "/api/tools/recommend-bundle": recommendBundle,
  "/api/tools/compare-products": compareProducts,
  "/api/tools/add-to-cart": addToCart,
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
      const result = dispatchTool(body.name, body.arguments || {});
      sendJson(res, { name: body.name, result });
      return;
    }

    if (req.method === "POST" && TOOL_ROUTES[url.pathname]) {
      const body = await readJsonBody(req);
      sendJson(res, TOOL_ROUTES[url.pathname](body));
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

function buildRealtimeSessionConfig() {
  return {
    type: "realtime",
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2",
    instructions: REALTIME_INSTRUCTIONS,
    audio: {
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
2. Search only the catalog tool for recommendations.
3. Explain recommendations using factual product fields such as bestFor, tradeoffs, rating, delivery, seller, and stock.
4. Suggest compatible bundles when the user is solving a practical task.
5. Compare products when multiple options are plausible.
6. Never add items to cart without explicit user confirmation.
7. After cart mutation, apply the best voucher and call checkout_preview.

Keep spoken replies concise and demo-friendly. Ask one clear follow-up only when required.
`.trim();

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
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
