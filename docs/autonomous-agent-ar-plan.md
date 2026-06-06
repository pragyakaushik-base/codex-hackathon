# Shopee Voice Agent: Autonomous Tools and AR/3D Implementation Plan

## Purpose

This document is the shared implementation context for extending the Shopee Voice Agent prototype after the initial practice build. It focuses on two areas:

1. Making the voice agent feel autonomous by exposing more commerce capabilities as Realtime API tools.
2. Expanding the iOS AR experience from camera-aware search into a more credible point-and-shop 3D shopping flow.

The goal is not to redesign the UI. UI mockups are handled separately. This plan describes the product behavior, backend contracts, agent tool strategy, code touch points, testing approach, and suggested ownership split for a three-person team.

If the team is starting from an empty repository, follow [Build From Scratch Guide](build-from-scratch.md) first, then use this document for the autonomous tool and AR/3D expansion details.

## Current Prototype Baseline

The existing prototype described in the technical design has these main parts:

- `server.mjs`: raw Node.js HTTP/HTTPS server, static file server, OpenAI Realtime SDP relay, REST tool endpoints, Vision API proxy.
- `commerce.mjs`: in-memory commerce logic over mock JSON data.
- `data/*.json`: products, sellers, vouchers, and users.
- `index.html`, `ui.js`, `styles.css`: vanilla web frontend using WebRTC and the Realtime API data channel.
- `cart.html`, `cart.js`: cart preview page.
- `ios/ShopeeARDemo`: SwiftUI + RealityKit + ARKit app embedding the web voice agent through `WKWebView`.

The Realtime agent currently has only four registered tools:

- `classify_need`
- `search_catalog`
- `add_to_cart`
- `analyze_surroundings`

Several useful commerce functions already exist but are hidden inside `runAgent()` or cart endpoints. Because the model cannot choose them independently, the conversation feels reactive: the user asks, the agent searches, then stops.

## Product Direction

The upgraded behavior should feel like a shopping assistant that drives the task forward:

- It checks relevant user history before making recommendations.
- It classifies the problem before searching.
- It searches only real catalog data.
- It suggests bundles as a separate step.
- It compares tradeoffs when multiple options are strong.
- It applies savings before checkout.
- It shows final totals after adding items.
- It asks before cart mutation, but proactively suggests the next action.
- It uses camera context when the user refers to what they are seeing, holding, wearing, or pointing at.

The key demo story is that a single query such as "My sink is leaking. What do I buy?" can trigger a multi-step chain:

```text
check_user_history
  -> classify_need
  -> search_catalog
  -> recommend_bundle
  -> compare_products
  -> add_to_cart
  -> apply_best_voucher
  -> checkout_preview
```

The agent should narrate the important decisions instead of silently hiding the commerce work.

## Feature Scope

### Phase 1: Autonomous Commerce Tools

Register existing commerce capabilities as Realtime tools:

- `recommend_bundle`
- `apply_best_voucher`
- `checkout_preview`

Build and register two new tools:

- `check_user_history`
- `compare_products`

Update the system prompt so the model has a tool-calling strategy, not just a list of tools.

### Phase 2: Camera-to-Cart Improvements

Keep the current bridge pattern:

```text
Realtime tool call
  -> web JS calls window.captureNativeCameraView()
  -> native ARView snapshot
  -> server Vision API proxy
  -> visual clues and search terms
  -> catalog search
```

Improve the structured result returned from visual analysis so downstream search and AR placement have better context:

- `summary`
- `visualClues`
- `suggestedSearchTerms`
- `detectedObjects`
- `possibleCategory`
- `measurementHints`
- `confidence`

### Phase 3: AR/3D Shopping Flow

Use existing RealityKit foundations and add shopping-specific AR actions:

- Place recommended products as selectable 3D cards or models on detected surfaces.
- Show selected product details in the native bottom sheet.
- Add native actions for compare, bundle, and add-to-cart.
- Keep voice agent embedded in `WKWebView` as the conversational layer.
- Optionally map web product IDs to iOS product/model metadata for AR preview.

## Backend Tool Contracts

All tools should return JSON only. Do not return prose that invents products, prices, sellers, voucher codes, or stock.

### `check_user_history`

Purpose: Personalization and reorder detection.

Input:

```json
{
  "userId": "u_001",
  "category": "beauty"
}
```

`category` is optional. When present, filter or prioritize matching past purchases.

Output:

```json
{
  "userId": "u_001",
  "preferences": {
    "delivery_priority": "fast",
    "budget_sensitivity": "medium",
    "preferred_sellers": ["S001"]
  },
  "pastPurchases": [
    {
      "product": {
        "id": "SK001",
        "title": "Barrier Repair Moisturizer",
        "category": "beauty",
        "price": 12.9,
        "rating": 4.8,
        "seller": {
          "id": "S002",
          "name": "GlowLab"
        }
      },
      "purchasedAt": "2026-04-18T00:00:00.000Z",
      "daysSince": 49,
      "category": "beauty"
    }
  ],
  "reorderSuggestions": [
    {
      "productId": "SK001",
      "title": "Barrier Repair Moisturizer",
      "reason": "Purchased 49 days ago and beauty items are likely replenishable."
    }
  ]
}
```

Implementation notes:

- Read from existing `users.json`.
- Hydrate `order_history.product_id` through `products.json`.
- Enrich products with seller info using the same logic as `searchCatalog()`.
- Calculate `daysSince` from the current server date.
- Treat `beauty` and `grocery` as replenishable categories.
- A reorder suggestion is eligible when `daysSince >= 30`.
- If user is unknown, return empty history and safe default preferences.

### `compare_products`

Purpose: Let the agent explain tradeoffs instead of only listing search results.

Input:

```json
{
  "productIds": ["HW001", "HW002", "HW003"],
  "criteria": ["price", "rating", "delivery", "seller"]
}
```

`criteria` is optional. Default to price, rating, delivery, stock, and seller.

Output:

```json
{
  "products": [
    {
      "id": "HW001",
      "title": "15mm PVC Slip Coupling",
      "price": 4.2,
      "rating": 4.8,
      "delivery": "next_day",
      "stock": 28,
      "seller": {
        "id": "S001",
        "name": "SG Hardware Pro",
        "rating": 4.9,
        "isPreferred": true
      }
    }
  ],
  "comparison": {
    "cheapest": "HW001",
    "bestRated": "HW001",
    "fastestDelivery": "HW002",
    "bestSeller": "HW001",
    "recommended": "HW001",
    "reasoning": "HW001 is the best overall value because it is the cheapest, highest-rated, in stock, and sold by the strongest seller."
  }
}
```

Implementation notes:

- Support 2-3 products for a clean demo, but accept a larger list safely.
- Ignore unknown product IDs and return them in `missingProductIds`.
- Delivery ranking: `same_day` > `next_day` > `standard`.
- Recommendation heuristic:
  - Prefer in-stock products.
  - Add weight for low price, high rating, faster delivery, and preferred or highly rated seller.
  - Keep the reasoning short and factual.

### `recommend_bundle`

Purpose: Expose existing bundle logic as a model-callable step.

Input:

```json
{
  "primaryProductId": "HW001"
}
```

Output:

```json
{
  "primaryProductId": "HW001",
  "bundle": [
    {
      "id": "HW002",
      "title": "PTFE Sealant Tape",
      "price": 3.5,
      "rating": 4.7,
      "delivery": "same_day",
      "seller": {
        "name": "SG Hardware Pro"
      }
    }
  ],
  "reasoning": "These items are commonly bought together for a small leak repair."
}
```

Implementation notes:

- Reuse `recommendBundle({ primaryProductId })`.
- Enrich bundled products with sellers.
- Return an empty bundle when there are no `bundleItems`.

### `apply_best_voucher`

Purpose: Let the agent explicitly announce savings.

Input:

```json
{
  "userId": "u_001",
  "category": "home_repair"
}
```

Alternative input for stateless calls:

```json
{
  "cart": [
    {
      "productId": "HW001",
      "quantity": 1
    }
  ],
  "category": "home_repair"
}
```

Output:

```json
{
  "voucher": {
    "id": "V002",
    "code": "REPAIR10",
    "description": "10% off repair essentials"
  },
  "discount": 1.46,
  "message": "REPAIR10 saves $1.46 on this cart."
}
```

Implementation notes:

- Existing endpoint exists as `/api/tools/apply-voucher`; align the Realtime tool name to `apply_best_voucher`.
- If `userId` is supplied, resolve the session cart.
- If `cart` is supplied, use it directly.
- Return `voucher: null` and `discount: 0` when nothing applies.

### `checkout_preview`

Purpose: Make final price and delivery visible after cart mutation.

Input:

```json
{
  "userId": "u_001",
  "voucherCode": "REPAIR10"
}
```

Alternative input:

```json
{
  "cart": [
    {
      "productId": "HW001",
      "quantity": 1
    }
  ],
  "voucher": {
    "id": "V002",
    "code": "REPAIR10"
  }
}
```

Output:

```json
{
  "subtotal": 14.6,
  "discount": 1.46,
  "shipping": 2.99,
  "total": 16.13,
  "estimatedDelivery": "Same day for eligible items",
  "appliedVoucher": {
    "code": "REPAIR10"
  }
}
```

Implementation notes:

- Use existing `checkoutPreview({ cart, voucher })`.
- If only `userId` is supplied, hydrate the session cart.
- If `voucherCode` is supplied, resolve it from `vouchers.json`.
- Round money values consistently to two decimals.

## Code Touch Points

### `commerce.mjs`

Add exports:

- `checkUserHistory({ userId, category })`
- `compareProducts({ productIds, criteria })`

Expose existing functions if they are not currently exported:

- `recommendBundle`
- `applyBestVoucher`
- `checkoutPreview`

Update:

- `getToolDefinitions()`
- `runTool(name, args)`

Suggested Realtime tool names:

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

Keep names snake_case at the Realtime/API boundary and camelCase internally.

### `server.mjs`

Add REST endpoints:

```text
POST /api/tools/check-user-history
POST /api/tools/compare-products
POST /api/tools/recommend-bundle
POST /api/tools/checkout-preview
```

Review existing endpoint:

```text
POST /api/tools/apply-voucher
```

Either keep it and map `apply_best_voucher` to it in `ui.js`, or add an alias:

```text
POST /api/tools/apply-best-voucher
```

Update the `/session` system instructions with the proactive tool strategy from this document.

### `ui.js`

Update `runRealtimeTool()` routing:

```text
check_user_history      -> /api/tools/check-user-history
recommend_bundle        -> /api/tools/recommend-bundle
compare_products        -> /api/tools/compare-products
apply_best_voucher      -> /api/tools/apply-voucher or /api/tools/apply-best-voucher
checkout_preview        -> /api/tools/checkout-preview
```

UI work is intentionally out of scope for this plan, but the current renderer should at least:

- Update product cards after `search_catalog`.
- Update cart UI after `add_to_cart`.
- Update assistant text after voucher and checkout responses.
- Send every tool result back to Realtime as `function_call_output`.

### `data/users.json`

Ensure demo history supports personalization:

- Beauty reorder example bought 30+ days ago.
- Grocery replenish example bought 30+ days ago.
- Optional home repair example to avoid accidental duplicate purchase.

Example order history:

```json
{
  "product_id": "SK001",
  "category": "beauty",
  "purchased_at": "2026-04-18T00:00:00.000Z"
}
```

### iOS AR Files

Likely touch points:

- `ios/ShopeeARDemo/ShopeeARDemo/ContentView.swift`
- `ios/ShopeeARDemo/ShopeeARDemo/Features/AR/ARViewContainer.swift`
- `ios/ShopeeARDemo/ShopeeARDemo/ViewModels/AgentViewModel.swift`
- `ios/ShopeeARDemo/ShopeeARDemo/Services/ProductCatalogService.swift`
- `ios/ShopeeARDemo/ShopeeARDemo/Resources/Products.json`

Implementation focus:

- Keep `WKWebView` as the voice brain.
- Keep ARKit as the camera and spatial presentation layer.
- Use native UI only for AR product selection, placement state, and cart overlay.

## System Prompt Draft

Use this as the new session instruction body, then tune for length if the Realtime endpoint has practical size constraints.

```text
You are Shopee's Universal Shopping Agent, a proactive multi-step shopping assistant that turns real-world uncertainty into a completed cart.

Behavior:
1. Understand first. When a user describes a problem, classify their need before searching.
2. Personalize. Check purchase history early when it may help with reorders, duplicate avoidance, preferences, or replenishment.
3. Search, then explain. Recommend only catalog products returned by tools. Explain why each product fits the user's specific situation.
4. Bundle proactively. After recommending a primary product, check complementary items and suggest the bundle as a separate step.
5. Compare when useful. If multiple options are strong, compare tradeoffs in price, rating, delivery, seller, and stock.
6. Apply savings. Before finalizing a cart, check applicable vouchers and mention the savings.
7. Show the total. After adding items to cart, call checkout_preview so the user knows the final price and delivery estimate.
8. Ask before acting. Never add items to cart without explicit user confirmation.
9. Use the camera. If the user refers to what they are seeing, holding, wearing, pointing at, or looking at, call analyze_surroundings before answering.

Typical tool sequence:
check_user_history -> classify_need -> search_catalog -> recommend_bundle -> compare_products -> add_to_cart -> apply_best_voucher -> checkout_preview

Use judgment. You do not need every tool every time. Always classify before catalog search. Always preview checkout after adding to cart.

Category playbooks:
HOME_REPAIR: Prioritize compatibility, size, material, and safety. Mention measurements when needed.
BEAUTY: Prioritize skin type, routine fit, delivery speed, and practical non-medical language.
FASHION: Prioritize color matching, style coherence, fit, and outfit compatibility.
ELECTRONICS: Prioritize device compatibility, ports, stock, seller reliability, and delivery.
GROCERY: Prioritize replenishment, price per unit, stock, and fast delivery.
HOME_DECOR: Prioritize dimensions, color palette, placement, and bundle potential.

Rules:
Only recommend products that exist in the catalog.
Never invent products, prices, sellers, vouchers, stock, or delivery times.
Keep spoken responses short, practical, and conversational.
```

## AR/3D Implementation Plan

### AR Product Representation

Use two levels of fidelity:

1. Real USDZ model when the iOS product has `modelName`.
2. Procedural fallback model for products without a model.

For commerce catalog products that do not have USDZ assets, create a mapping table:

```json
{
  "HW001": {
    "modelName": "GenericHardwarePart",
    "accentHex": "#EE4D2D",
    "arLabel": "PVC Coupling"
  }
}
```

This can live in:

```text
ios/ShopeeARDemo/ShopeeARDemo/Resources/ProductARMetadata.json
```

### AR Placement Behavior

When products are returned from `search_catalog`:

- Send product IDs to native through the existing bridge or a new message handler.
- Native resolves AR metadata for each product ID.
- `ARViewContainer` places up to four selectable product models/cards on the detected plane.
- Tapping a model selects it and updates the bottom sheet.

Selection state:

```text
selectedProductID
selectedProductDetails
comparisonCandidateIds
placementRequestID
```

### Native-to-Web Actions

Add bridge messages so native AR buttons can ask the web agent to run tools:

```text
compareSelectedProducts(productIds)
recommendBundle(primaryProductId)
addSelectedToCart(productId)
```

These should call into web JS, which then routes through the same backend and Realtime data channel path where possible. Do not create a separate native commerce stack unless the team intentionally decides to split architecture.

### Visual Analysis Expansion

Enhance the Vision API prompt to request structured shopping context:

```json
{
  "summary": "A small leak under a sink near a white PVC pipe joint.",
  "visualClues": ["sink", "PVC pipe", "joint", "water leak"],
  "suggestedSearchTerms": ["PVC coupling", "sealant tape", "waterproof sealant"],
  "detectedObjects": ["pipe", "sink cabinet", "pipe joint"],
  "possibleCategory": "home_repair",
  "measurementHints": ["Check pipe diameter before buying coupling."],
  "confidence": 0.82
}
```

Feed `visualClues`, `suggestedSearchTerms`, and `possibleCategory` into `search_catalog`.

## Suggested Three-Person Ownership Split

### Person A: Backend and Agent Tools

Primary files:

- `commerce.mjs`
- `server.mjs`
- `data/*.json`

Responsibilities:

- Add `checkUserHistory`.
- Add `compareProducts`.
- Register all tool definitions.
- Add REST endpoints.
- Update Realtime system prompt.
- Add focused backend tests or curl scripts.

Done when:

- All nine tools return deterministic JSON.
- The `/session` payload includes all tool definitions.
- Demo curl requests work without the web or iOS clients.

### Person B: Web Realtime Tool Routing

Primary files:

- `ui.js`
- `index.html` only if needed for hooks
- `cart.js` only if checkout rendering needs adjustment

Responsibilities:

- Route new Realtime tool names to backend endpoints.
- Send tool results back to OpenAI as `function_call_output`.
- Keep recommendation and cart state in sync.
- Add debug logging for tool call sequence during demos.

Done when:

- A voice conversation can execute the expanded tool chain.
- Failed tools return graceful output to the model rather than breaking the session.
- Text fallback still works.

### Person C: iOS AR/3D Experience

Primary files:

- `ContentView.swift`
- `ARViewContainer.swift`
- `AgentViewModel.swift`
- `ProductCatalogService.swift`
- `Resources/*.json`

Responsibilities:

- Add AR metadata mapping for commerce products.
- Place recommended products in AR.
- Support selection and selected-product detail state.
- Connect native AR actions back to the web agent bridge.
- Preserve camera snapshot bridge behavior.

Done when:

- "What am I looking at?" captures AR camera context and returns search results.
- Recommended products can be represented in AR.
- Selecting an AR object updates native state and can trigger compare or add flows.

## Testing Plan

### Backend Smoke Tests

Run the server:

```bash
node server.mjs
```

Expected checks:

```bash
curl -s http://localhost:3000/api/bootstrap
curl -s -X POST http://localhost:3000/api/tools/check-user-history \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u_001","category":"beauty"}'
curl -s -X POST http://localhost:3000/api/tools/compare-products \
  -H 'Content-Type: application/json' \
  -d '{"productIds":["HW001","HW002","HW003"]}'
curl -s -X POST http://localhost:3000/api/tools/recommend-bundle \
  -H 'Content-Type: application/json' \
  -d '{"primaryProductId":"HW001"}'
```

### Web Demo Tests

Text-mode prompts:

- `My sink is leaking. What do I buy?`
- `I'm running low on moisturizer before an interview tomorrow.`
- `What pants match these boots and a black jacket?`
- `Can you compare the top two options?`
- `Add the bundle to cart.`

Expected behavior:

- Product drawer shows catalog-backed products.
- Cart updates only after explicit add confirmation.
- Voucher savings are announced.
- Checkout preview shows subtotal, discount, shipping, and total.

### Realtime Voice Tests

Use browser console logs or a visible debug panel to verify the sequence:

```text
check_user_history
classify_need
search_catalog
recommend_bundle
compare_products
add_to_cart
apply_best_voucher
checkout_preview
```

The exact sequence can vary, but classification should precede search and checkout preview should follow cart mutation.

### iOS AR Tests

Expected checks:

- `WKWebView` loads the local HTTPS server.
- Microphone permission is granted for voice.
- Camera button opens the AR experience.
- Plane detection state appears.
- `ARView.snapshot()` returns a base64 JPEG payload.
- `analyze_surroundings` receives the image and returns structured visual context.
- AR recommendations are selectable.

## Demo Script

### Home Repair

User:

```text
My sink is leaking. What do I buy?
```

Expected agent behavior:

- Checks history briefly.
- Classifies as `home_repair`.
- Searches for coupling, sealant tape, and waterproof sealant.
- Suggests bundle.
- Offers comparison.
- Asks before adding.

User:

```text
Add the repair bundle.
```

Expected agent behavior:

- Adds items to cart.
- Applies best voucher.
- Shows checkout total and delivery estimate.

### Beauty Reorder

User:

```text
I'm running low on moisturizer before an interview tomorrow.
```

Expected agent behavior:

- Checks history.
- Finds prior moisturizer if present.
- Mentions reorder option.
- Prioritizes fast delivery and practical routine fit.

### iOS Camera

User points camera at the issue and says:

```text
What do I need to fix this?
```

Expected agent behavior:

- Calls `analyze_surroundings`.
- Uses visual clues in catalog search.
- Places matching products in AR.
- Explains what to buy and why.

## Acceptance Criteria

The implementation is ready for hackathon demo when:

- Realtime session registers all nine tools.
- The model can autonomously choose more than search and cart tools.
- New tools have deterministic JSON outputs and graceful empty states.
- The prompt tells the agent how to sequence actions.
- The web client routes every registered tool.
- Cart mutations require user confirmation.
- Voucher and checkout preview are explicit conversational steps.
- Camera analysis produces structured search terms.
- iOS AR can show or select recommended products without breaking the voice bridge.

## Risks and Decisions

### Risk: Too Many Tool Calls Increase Latency

Mitigation:

- Keep tool functions local and deterministic.
- Avoid calling Vision API unless the user references visual context.
- Let the prompt say "use judgment" rather than requiring every tool.

### Risk: Model Adds to Cart Without Confirmation

Mitigation:

- Prompt rule: never add without explicit confirmation.
- In `ui.js`, optionally guard `add_to_cart` if there is no recent user confirmation phrase.

### Risk: iOS Catalog Schema Differs from Backend Catalog

Mitigation:

- Add an AR metadata mapping instead of forcing one schema immediately.
- Keep backend as source of truth for commerce.

### Risk: Mock Data Too Small for Good Comparisons

Mitigation:

- Add 2-3 additional products per demo category.
- Ensure each category has meaningful price, rating, delivery, and seller tradeoffs.

## Near-Term Task Checklist

- [ ] Add `checkUserHistory` to `commerce.mjs`.
- [ ] Add `compareProducts` to `commerce.mjs`.
- [ ] Export and register `recommendBundle`, `applyBestVoucher`, and `checkoutPreview`.
- [ ] Add backend endpoints for all new tools.
- [ ] Update Realtime system prompt.
- [ ] Update `ui.js` Realtime tool routing.
- [ ] Add demo-ready user history entries.
- [ ] Expand Vision API structured output.
- [ ] Add iOS AR product metadata mapping.
- [ ] Place recommended products in AR.
- [ ] Add compare/bundle/add actions from AR selection.
- [ ] Run backend, web, voice, and iOS smoke tests.
