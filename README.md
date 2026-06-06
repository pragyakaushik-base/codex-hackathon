# Shopee Voice Agent - SEA x OpenAI Hackathon

A voice-first, camera-aware shopping agent that helps users go from a real-world problem to catalog-backed recommendations and cart actions in one conversation.

## Run The Hybrid Voice Demo

1. Add your OpenAI key to `.env`:

```sh
OPENAI_API_KEY=sk-your-key-here
```

2. Start the local server:

```sh
HOST=0.0.0.0 PORT=3000 node server.mjs
```

The server prints one or more `iPhone LAN URL` lines. Use the URL that matches your Mac network address, for example:

```text
http://10.22.64.15:3000
```

3. For a physical iPhone, set `AgentBaseURL` in `ios/ShopeeHybridAgent/Info.plist` to that LAN URL. Confirm the phone can open this in Safari:

```text
http://10.22.64.15:3000/api/bootstrap
```

4. Open `ios/ShopeeHybridAgent.xcodeproj` in Xcode and run `ShopeeHybridAgent`.

The iOS app loads `AgentBaseURL` in its `WKWebView` when the server is reachable, with the bundled static mock as a fallback. Tap the floating agent button, then tap the microphone button to start the OpenAI Realtime WebRTC voice session.

## Implemented Agent Tools

- `classify_need`
- `search_catalog`
- `recommend_bundle`
- `compare_products`
- `add_to_cart`
- `apply_best_voucher`
- `checkout_preview`

## Shared Planning Docs

- [Build From Scratch Guide](docs/build-from-scratch.md)
- [Autonomous Agent and AR/3D Implementation Plan](docs/autonomous-agent-ar-plan.md)

Start with the build guide when working from a blank repo. Use the autonomous agent plan for the expanded Realtime tools, proactive agent behavior, backend tool contracts, iOS AR/3D work, testing, demo scripts, and three-person ownership split.
