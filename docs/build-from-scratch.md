# Shopee Voice Agent: Build From Scratch Guide

## Purpose

Use this guide when starting from a blank repository. It explains how to create the full Shopee Voice Agent prototype from zero: backend, mock data, web client, OpenAI Realtime voice flow, Vision API proxy, cart flow, and iOS AR bridge.

This document is implementation-oriented. It does not require an existing codebase. A teammate should be able to follow the milestones in order and produce a working demo.

## Target Outcome

By the end, the app should support:

- A Node.js server with no framework dependencies.
- Mock Shopee catalog, sellers, vouchers, and users.
- Text-mode shopping assistant for fast local testing.
- OpenAI Realtime API voice session through WebRTC.
- Realtime tool calls routed through the web client to the backend.
- Vision analysis from a camera snapshot.
- Cart mutation, voucher application, and checkout preview.
- A vanilla web UI.
- An iOS SwiftUI + RealityKit app that embeds the web agent and provides AR camera snapshots.

## Build Order

Build in this order:

1. Repository skeleton.
2. Mock data.
3. Commerce logic engine.
4. Backend HTTP server.
5. Text-mode web UI.
6. Realtime voice session.
7. Realtime tool routing.
8. Cart page.
9. Vision API proxy.
10. iOS project skeleton.
11. Native `WKWebView` bridge.
12. AR camera snapshot capture.
13. AR product placement.
14. Autonomous agent tools.
15. Demo polish and verification.

Do not start with iOS. The backend and web flow should work first because iOS embeds the same web agent.

## Final Repository Structure

Create this structure:

```text
.
|-- .env.example
|-- .gitignore
|-- README.md
|-- server.mjs
|-- commerce.mjs
|-- index.html
|-- ui.js
|-- styles.css
|-- cart.html
|-- cart.js
|-- data/
|   |-- products.json
|   |-- sellers.json
|   |-- vouchers.json
|   `-- users.json
|-- docs/
|   |-- build-from-scratch.md
|   `-- autonomous-agent-ar-plan.md
`-- ios/
    |-- project.yml
    |-- README.md
    `-- ShopeeARDemo/
        |-- ARShoppingApp.swift
        |-- ContentView.swift
        |-- DesignSystem.swift
        |-- Info.plist
        |-- Models/
        |   |-- Product.swift
        |   `-- CartItem.swift
        |-- Services/
        |   |-- CartService.swift
        |   |-- ProductCatalogService.swift
        |   `-- OpenAIService.swift
        |-- ViewModels/
        |   `-- AgentViewModel.swift
        |-- Features/
        |   |-- AR/
        |   |   |-- ARViewContainer.swift
        |   |   `-- ProductCarousel.swift
        |   |-- Cart/
        |   |   `-- CartSheet.swift
        |   `-- Recommendations/
        |       `-- AgentOrb.swift
        `-- Resources/
            |-- Products.json
            |-- sellers.json
            `-- ProductARMetadata.json
```

## Environment Setup

Create `.env.example`:

```text
OPENAI_API_KEY=sk-your-key-here
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=marin
OPENAI_VISION_MODEL=gpt-4.1-mini
OPENAI_SAFETY_IDENTIFIER=demo-user
HOST=0.0.0.0
PORT=3000

# Optional local HTTPS for iOS and browser microphone access
# SSL_KEY_FILE=certs/dev-key.pem
# SSL_CERT_FILE=certs/dev-cert.pem
```

Create `.gitignore`:

```text
.env
certs/
node_modules/
.DS_Store
ios/*.xcodeproj/
ios/DerivedData/
```

Runtime requirements:

- Node.js 18 or newer.
- OpenAI API key with Realtime access.
- Xcode 15 or newer for iOS.
- XcodeGen for iOS project generation.

## Milestone 1: Mock Data

Create `data/products.json`.

Minimum categories:

- `home_repair`
- `beauty`
- `fashion`
- `electronics`
- `grocery`
- `home_decor`

Product schema:

```json
{
  "id": "HW001",
  "title": "15mm PVC Slip Coupling",
  "category": "home_repair",
  "description": "Replacement coupling for small PVC pipe repairs.",
  "keywords": ["sink", "pipe", "leak", "pvc", "coupling", "repair"],
  "price": 4.2,
  "rating": 4.8,
  "sellerId": "S001",
  "delivery": "next_day",
  "stock": 28,
  "imageUrl": "/assets/hw001.png",
  "attributes": {
    "size": "15mm",
    "material": "PVC"
  },
  "bundleItems": ["HW002", "HW003"]
}
```

Create at least 3 products for each demo category:

- Home repair: coupling, sealant tape, waterproof sealant.
- Beauty: moisturizer, mist, sunscreen or cleanser.
- Fashion: dark denim, black belt, tailored pants.

Create `data/sellers.json`:

```json
{
  "id": "S001",
  "name": "SG Hardware Pro",
  "rating": 4.9,
  "isPreferred": true,
  "location": "Singapore"
}
```

Create `data/vouchers.json`:

```json
{
  "id": "V002",
  "code": "REPAIR10",
  "description": "10% off repair essentials",
  "discountType": "percent",
  "value": 10,
  "minSpend": 10,
  "category": "home_repair"
}
```

Create `data/users.json`:

```json
{
  "user_id": "u_001",
  "location": "Singapore",
  "preferences": {
    "delivery_priority": "fast",
    "budget_sensitivity": "medium",
    "preferred_sellers": ["S001"]
  },
  "order_history": [
    {
      "product_id": "SK001",
      "category": "beauty",
      "purchased_at": "2026-04-18T00:00:00.000Z"
    }
  ]
}
```

Use JSON arrays in each file, not newline-delimited JSON.

Acceptance gate:

- All JSON files parse.
- Product `sellerId` values exist in `sellers.json`.
- Product `bundleItems` reference existing product IDs.
- User `order_history.product_id` values exist in `products.json`.

## Milestone 2: Commerce Logic Engine

Create `commerce.mjs`.

Responsibilities:

- Load JSON data at startup.
- Hold in-memory session carts.
- Classify user needs.
- Search and rank products.
- Recommend bundles.
- Add products to cart.
- Apply best voucher.
- Calculate checkout preview.
- Check user history.
- Compare products.
- Return Realtime tool definitions.
- Dispatch tool calls by name.

### Module-Level State

Use:

```text
products: Product[]
sellers: Seller[]
vouchers: Voucher[]
users: User[]
sessions: Map<userId, { cart: CartItem[] }>
```

Cart item shape:

```json
{
  "productId": "HW001",
  "quantity": 1
}
```

### Required Functions

Implement these exports:

```text
classifyNeed({ message, imageDescription })
searchCatalog({ query, category, visualClues, budgetMax, minRating, deliveryPreference })
rankProducts({ products, userPreference })
recommendBundle({ primaryProductId })
addToCart({ userId, productIds })
applyBestVoucher({ cart, category })
checkoutPreview({ cart, voucher })
getCartSnapshot({ userId, category })
runAgent({ message, imageBase64, cart, userId })
checkUserHistory({ userId, category })
compareProducts({ productIds, criteria })
getToolDefinitions()
runTool(name, args)
```

### Classification

Use keyword matching first. Keep it deterministic.

Category keyword examples:

```text
home_repair: sink, leak, pipe, sealant, coupling, faucet, repair
beauty: moisturizer, skin, skincare, interview, face, mist, sunscreen
fashion: pants, boots, jacket, outfit, denim, belt, match
electronics: charger, cable, phone, laptop, usb, adapter
grocery: rice, coffee, milk, snack, restock, running low
home_decor: lamp, room, sofa, curtain, shelf, decor
```

Return:

```json
{
  "category": "home_repair",
  "confidence": 0.85,
  "reasoning": "Matched leak, sink, and pipe repair terms."
}
```

### Catalog Search

Scoring rules:

- `+5` category match.
- `+2` per keyword match.
- `+1` rating at least 4.7.
- `+1` same-day or next-day delivery.
- `+1` stock greater than 0.
- `-10` stock is 0.
- `+2` delivery matches preference.
- `-4` price exceeds `budgetMax`.
- `-5` rating below `minRating`.

Return top 5 enriched products:

```json
{
  "products": [
    {
      "id": "HW001",
      "title": "15mm PVC Slip Coupling",
      "price": 4.2,
      "rating": 4.8,
      "delivery": "next_day",
      "seller": {
        "name": "SG Hardware Pro",
        "rating": 4.9
      },
      "matchReason": "Matches sink leak repair and pipe coupling keywords."
    }
  ],
  "uiAction": "SHOW_PRODUCTS"
}
```

### History and Comparison

Implement `checkUserHistory` and `compareProducts` using the contracts in [Autonomous Agent and AR/3D Implementation Plan](autonomous-agent-ar-plan.md).

Acceptance gate:

- `node -e "import('./commerce.mjs').then(m => console.log(m.getToolDefinitions().length))"` prints `9`.
- `runAgent()` returns products for `My sink is leaking`.
- `checkUserHistory()` returns reorder suggestions for beauty/grocery history older than 30 days.
- `compareProducts()` identifies cheapest, best rated, fastest delivery, and recommended product.

## Milestone 3: Backend Server

Create `server.mjs`.

Use only Node built-ins:

```text
http
https
fs/promises
path
url
```

Node 18+ also provides global `fetch` and `FormData`.

### Required Server Behavior

- Load `.env` manually.
- Start HTTP by default.
- Start HTTPS if `SSL_KEY_FILE` and `SSL_CERT_FILE` are set.
- Serve static files from repo root.
- Expose JSON API endpoints.
- Relay SDP offers to OpenAI Realtime API.
- Proxy camera snapshots to OpenAI Vision API.

### Endpoint List

```text
POST /session
GET  /api/bootstrap
GET  /api/cart
POST /api/agent
POST /api/tools/check-user-history
POST /api/tools/classify-need
POST /api/tools/search-catalog
POST /api/tools/recommend-bundle
POST /api/tools/compare-products
POST /api/tools/add-to-cart
POST /api/tools/apply-voucher
POST /api/tools/apply-best-voucher
POST /api/tools/checkout-preview
POST /api/tools/analyze-surroundings
GET  /*
```

### `/session` Realtime Relay

Client sends raw SDP offer text.

Server sends:

```text
POST https://api.openai.com/v1/realtime/calls
Authorization: Bearer <OPENAI_API_KEY>
Content-Type: multipart/form-data
```

Form fields:

```text
sdp: client SDP offer
session: JSON session config
```

Session config should include:

```json
{
  "type": "realtime",
  "model": "gpt-realtime-2",
  "audio": {
    "output": {
      "voice": "marin"
    }
  },
  "instructions": "<system prompt>",
  "tool_choice": "auto",
  "tools": []
}
```

Fill `tools` from `getToolDefinitions()`.

Return the OpenAI SDP answer as `application/sdp`.

### System Prompt

Use the prompt from [Autonomous Agent and AR/3D Implementation Plan](autonomous-agent-ar-plan.md). Keep three hard rules:

- Classify before search.
- Never add to cart without explicit confirmation.
- Always call checkout preview after cart mutation.

### Vision Proxy

Endpoint:

```text
POST /api/tools/analyze-surroundings
```

Input:

```json
{
  "question": "What do I need to fix this?",
  "imageBase64": "<base64 JPEG>",
  "mimeType": "image/jpeg"
}
```

Call:

```text
POST https://api.openai.com/v1/responses
```

Expected structured output:

```json
{
  "summary": "A small leak near a white PVC pipe joint.",
  "visualClues": ["sink", "PVC pipe", "pipe joint", "leak"],
  "suggestedSearchTerms": ["PVC coupling", "sealant tape", "waterproof sealant"],
  "detectedObjects": ["pipe", "sink cabinet"],
  "possibleCategory": "home_repair",
  "measurementHints": ["Check the pipe diameter before buying a coupling."],
  "confidence": 0.82
}
```

If no image is supplied, return a graceful fallback JSON with `confidence: 0`.

Acceptance gate:

- `node server.mjs` starts.
- `GET /api/bootstrap` returns JSON.
- `POST /api/agent` works without OpenAI.
- Tool endpoints work without the web UI.
- `/session` fails clearly if `OPENAI_API_KEY` is missing.

## Milestone 4: Web UI

Create:

- `index.html`
- `styles.css`
- `ui.js`

Keep the first version simple. The UI only needs to prove the product flow.

### Required DOM Elements

Use stable IDs:

```text
remote-audio
mic-button
camera-button
message
ask-button
assistant-message
products-grid
cart-items
cart-count
checkout-summary
state-label
agent-line
customer-line
```

### Text Mode

In `ui.js`, implement:

```text
sendAgentRequest()
renderProducts(products)
renderCart(snapshot)
setState(state)
```

Text flow:

```text
user submits message
  -> POST /api/agent
  -> render assistant reply
  -> render products
  -> render bundle if present
```

This must work before Realtime voice is attempted.

### Product Cards

Each product card should include:

- Title.
- Description.
- Price.
- Rating.
- Delivery.
- Seller.
- Match reason.
- Add button with `data-add-product="<productId>"`.

Clicking add:

```text
POST /api/tools/add-to-cart
GET /api/cart
renderCart()
```

Acceptance gate:

- Browser opens `http://localhost:3000`.
- Text prompt returns products.
- Add-to-cart updates the cart.

## Milestone 5: Realtime Voice

Add WebRTC support in `ui.js`.

### Client Connection Flow

```text
navigator.mediaDevices.getUserMedia({ audio: true })
new RTCPeerConnection()
pc.addTrack(micTrack)
pc.createDataChannel("oai-events")
pc.createOffer()
POST /session with offer.sdp
pc.setRemoteDescription(answer)
```

Pipe remote audio to:

```html
<audio id="remote-audio" autoplay></audio>
```

### Realtime Event Handling

Handle:

```text
input_audio_buffer.speech_started
response.created
response.output_audio.delta
response.audio_transcript.delta
response.done
conversation.item.created
response.output_item.done
```

Tool calls can appear in `conversation.item.created` or `response.output_item.done`. If `item.type === "function_call"`, route it to `runRealtimeTool(item)`.

### Tool Routing

Map tool names:

```text
check_user_history      -> /api/tools/check-user-history
classify_need           -> /api/tools/classify-need
search_catalog          -> /api/tools/search-catalog
recommend_bundle        -> /api/tools/recommend-bundle
compare_products        -> /api/tools/compare-products
add_to_cart             -> /api/tools/add-to-cart
apply_best_voucher      -> /api/tools/apply-best-voucher
checkout_preview        -> /api/tools/checkout-preview
analyze_surroundings    -> /api/tools/analyze-surroundings
```

After backend response:

```text
dataChannel.send({
  type: "conversation.item.create",
  item: {
    type: "function_call_output",
    call_id: item.call_id,
    output: JSON.stringify(result)
  }
})

dataChannel.send({ type: "response.create" })
```

Acceptance gate:

- Mic button starts a session.
- User speech reaches OpenAI.
- Agent audio plays back.
- Tool calls produce backend requests.
- Tool outputs are sent back over the data channel.

## Milestone 6: Cart Page

Create:

- `cart.html`
- `cart.js`

Cart page behavior:

```text
GET /api/cart?userId=u_001
render cart lines
render subtotal
render voucher discount
render shipping
render total
render estimated delivery
```

Acceptance gate:

- Product page add button can link to `/cart.html`.
- Cart page reflects server session cart.

## Milestone 7: Camera and Vision

For web-only mode, the camera button can initially show a fallback message.

For iOS, `ui.js` should support:

```js
window.captureNativeCameraView({ question })
```

Function behavior:

- Returns a Promise.
- Resolves with `{ imageBase64, mimeType }`.
- Rejects or times out gracefully if native camera is unavailable.

When Realtime calls `analyze_surroundings`:

```text
call captureNativeCameraView()
POST /api/tools/analyze-surroundings
send result as function_call_output
```

Acceptance gate:

- If native bridge is missing, the app does not crash.
- If native bridge is present, image payload reaches the backend.

## Milestone 8: iOS App Skeleton

Create `ios/project.yml` for XcodeGen.

Target:

```text
iOS 17+
Swift 5.10
SwiftUI
RealityKit
ARKit
WebKit
AVFoundation
Speech
```

Create app entry:

```text
ARShoppingApp.swift
```

Responsibilities:

- Create shared `CartService`.
- Create shared `AgentViewModel`.
- Show `ContentView`.

Create `Info.plist`:

Required keys:

```text
AgentBaseURL
NSCameraUsageDescription
NSMicrophoneUsageDescription
NSMotionUsageDescription
NSSpeechRecognitionUsageDescription
```

`AgentBaseURL` example:

```text
https://192.168.1.73:3000
```

Acceptance gate:

- `cd ios && xcodegen generate` succeeds.
- Xcode project opens.
- App builds to simulator or device before AR features are added.

## Milestone 9: Shared Web Agent in iOS

In `ContentView.swift`, implement:

```text
SharedAgentWebView
AgentWebViewStore
```

`SharedAgentWebView`:

- Loads `AgentBaseURL`.
- Allows inline media playback.
- Grants microphone permission.
- Accepts self-signed TLS for local development.

`AgentWebViewStore`:

- Owns `WKWebView`.
- Injects bridge JavaScript.
- Handles messages from web to native.

Injected JS should define:

```text
window.captureNativeCameraView({ question })
window.__resolveNativeCameraCapture(requestId, payload)
window.__rejectNativeCameraCapture(requestId, message)
```

Message handlers:

```text
cameraTapped
captureSurroundings
```

Acceptance gate:

- iOS app loads web UI.
- Mic permission works in `WKWebView`.
- Tapping web camera button can switch to native camera mode.

## Milestone 10: AR Camera Mode

Create:

- `ARViewContainer.swift`
- `ARCameraSnapshotStore`

`ARViewContainer` responsibilities:

- Wrap `ARView` in `UIViewRepresentable`.
- Start `ARWorldTrackingConfiguration`.
- Enable horizontal plane detection.
- Add `ARCoachingOverlayView`.
- Report plane detection state.
- Keep weak reference for snapshots.

`ARCameraSnapshotStore` responsibilities:

```text
captureSnapshotPayload()
  -> arView.snapshot(saveToHDR: false)
  -> JPEG data, quality 0.7
  -> base64 string
  -> { mimeType: "image/jpeg", imageBase64 }
```

Acceptance gate:

- Camera mode opens on device.
- Plane detection works.
- Snapshot payload can resolve the web Promise.
- `analyze_surroundings` can run from voice prompt.

## Milestone 11: AR Product Placement

Create iOS product schema in `Resources/Products.json`:

```json
{
  "id": "HW001",
  "title": "15mm PVC Slip Coupling",
  "subtitle": "Best match for small PVC pipe repairs",
  "price": 4.2,
  "keywords": ["pipe", "leak", "coupling"],
  "modelName": "GenericHardwarePart",
  "accentHex": "#EE4D2D"
}
```

Create `ProductARMetadata.json` if backend catalog and iOS AR assets are separate:

```json
{
  "HW001": {
    "modelName": "GenericHardwarePart",
    "accentHex": "#EE4D2D",
    "arLabel": "PVC Coupling"
  }
}
```

In `ARViewContainer`:

- Place up to 4 recommendations.
- Use a 2x2 grid on the detected plane.
- Load USDZ if available.
- Otherwise create a procedural fallback model.
- Add collision shapes.
- Handle tap selection.

Acceptance gate:

- Products appear in AR after recommendations are available.
- Tapping a product updates selected product state.
- Selected product can be added to cart or compared through the bridge.

## Milestone 12: Autonomous Agent Tools

After baseline web, backend, voice, and iOS bridge work, implement the autonomous tools from [Autonomous Agent and AR/3D Implementation Plan](autonomous-agent-ar-plan.md).

Required registered tool set:

```text
check_user_history
classify_need
analyze_surroundings
search_catalog
recommend_bundle
compare_products
add_to_cart
apply_best_voucher
checkout_preview
```

Expected demo chain:

```text
history -> classify -> search -> bundle -> compare -> add -> voucher -> checkout
```

Acceptance gate:

- `/session` includes all nine tools.
- `ui.js` routes all nine tools.
- Each tool has a backend endpoint.
- The system prompt describes sequencing behavior.

## Implementation Details by File

### `server.mjs`

Recommended internal helpers:

```text
loadEnv(filePath)
parseJsonBody(req)
readRequestText(req)
respondJson(res, status, body)
respondText(res, status, text, contentType)
handleStatic(req, res)
handleSession(req, res)
handleAnalyzeSurroundings(req, res)
extractResponseText(payload)
```

Routing can be a plain `if` or `switch` on method and pathname.

### `commerce.mjs`

Recommended internal helpers:

```text
loadJson(relativePath)
getSession(userId)
findProduct(productId)
findSeller(sellerId)
enrichProduct(product)
hydrateCart(cart)
money(value)
tokenize(text)
deliveryRank(delivery)
buildReply(result)
```

Keep this module pure and deterministic except for reading files at startup and using the current date in history calculations.

### `ui.js`

Recommended state:

```text
currentState
peerConnection
dataChannel
localStream
activeUserId = "u_001"
recommendationState
lastProducts
```

Recommended functions:

```text
startSession()
stopSession()
handleRealtimeEvent(event)
runRealtimeTool(item)
sendToolOutput(callId, result)
sendAgentRequest()
requestNativeCameraSnapshot(question)
renderProducts(products)
renderCart(snapshot)
setState(state)
```

### iOS Swift Files

Keep iOS responsibilities separated:

- `ContentView.swift`: mode switching, web view, bridge, high-level layout.
- `ARViewContainer.swift`: ARKit/RealityKit only.
- `AgentViewModel.swift`: selected products, recommendations, plane state.
- `CartService.swift`: native cart state.
- `ProductCatalogService.swift`: iOS resource loading.

## Local Development Commands

Start server:

```bash
node server.mjs
```

Generate TLS cert for iOS:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -keyout certs/dev-key.pem \
  -out certs/dev-cert.pem -days 365 -nodes \
  -subj "/CN=192.168.1.73"
```

Add to `.env`:

```text
SSL_KEY_FILE=certs/dev-key.pem
SSL_CERT_FILE=certs/dev-cert.pem
```

Generate iOS project:

```bash
cd ios
xcodegen generate
```

## Verification Checklist

Backend:

- [ ] `node server.mjs` starts.
- [ ] `GET /api/bootstrap` returns scenarios and cart.
- [ ] `POST /api/agent` returns a reply and products.
- [ ] Every `/api/tools/*` endpoint returns JSON.
- [ ] Missing API key produces a clear error for OpenAI-only paths.

Web:

- [ ] Text prompt works.
- [ ] Product cards render.
- [ ] Add-to-cart works.
- [ ] Cart preview updates.
- [ ] Realtime voice session connects.
- [ ] Tool calls route and return outputs.

iOS:

- [ ] App builds.
- [ ] `WKWebView` loads the server.
- [ ] Microphone permission works.
- [ ] Camera mode opens.
- [ ] AR plane detection works.
- [ ] Snapshot bridge resolves.
- [ ] Vision analysis runs from voice prompt.
- [ ] AR product placement works.

Demo:

- [ ] Home repair scenario produces bundle and voucher.
- [ ] Beauty scenario uses purchase history.
- [ ] Fashion scenario can compare options.
- [ ] iOS camera scenario uses visual clues.

## Recommended Team Split

Backend owner:

- Mock data.
- `commerce.mjs`.
- `server.mjs`.
- Tool contracts and prompt.

Web owner:

- `index.html`.
- `styles.css`.
- `ui.js`.
- Realtime event and tool routing.
- Cart page.

iOS owner:

- XcodeGen project.
- `WKWebView` bridge.
- AR snapshot capture.
- AR product placement.
- Native cart and selected product state.

Integration rule:

- Backend owner defines JSON contracts.
- Web owner consumes those contracts first.
- iOS owner reuses web bridge and does not duplicate commerce logic.

## Common Failure Modes

### Browser Microphone Fails

Cause:

- Browser requires HTTPS for `getUserMedia`.

Fix:

- Use localhost where allowed.
- Use local HTTPS certs.
- For iOS, always use HTTPS LAN URL.

### Realtime Tool Calls Do Nothing

Cause:

- Tool is registered in `getToolDefinitions()` but not routed in `ui.js`.

Fix:

- Add mapping in `runRealtimeTool()`.
- Always send `function_call_output`.
- Always send `response.create` after tool output.

### Model Invents Products

Cause:

- Prompt is too loose or tool output is missing.

Fix:

- Strengthen prompt rule.
- Return enough product fields in search output.
- Tell model only to recommend catalog results.

### iOS Snapshot Times Out

Cause:

- AR mode is not active, `ARView` reference is nil, or bridge callback was not injected.

Fix:

- Reject with a clear message when camera unavailable.
- Confirm `captureSurroundings` message handler exists.
- Confirm `ARCameraSnapshotStore` holds the current `ARView`.

### Cart Totals Are Inconsistent

Cause:

- Web and backend calculate totals separately.

Fix:

- Backend is source of truth.
- Web and iOS only render totals returned by `/api/cart` or `checkout_preview`.

## Definition of Done

The app is demo-ready from a blank repo when:

- A fresh clone plus `.env` can run `node server.mjs`.
- Text mode can complete a shopping recommendation and cart flow.
- Realtime voice can call backend tools.
- The agent can use all autonomous tools.
- iOS app can load the web agent and capture AR snapshots.
- Camera analysis feeds catalog search.
- AR can display or select recommended products.
- Demo scripts are repeatable without manual database edits.
