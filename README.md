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

3. For the iOS Simulator, the app defaults to `http://127.0.0.1:3000`. For a physical iPhone, set the Xcode build setting `AGENT_BASE_URL` to either the LAN URL printed by the server or the current ngrok forwarding URL. Do not edit `Info.plist` directly. Confirm the phone can open the chosen URL in Safari:

```text
http://10.22.64.15:3000/api/bootstrap
```

or:

```text
https://your-current-ngrok-url.ngrok-free.app/api/bootstrap
```

If you are using ngrok instead of LAN, add your tunnel URL to `.env` and use the same URL for `AgentBaseURL`:

```sh
PUBLIC_BASE_URL=https://your-ngrok-subdomain.ngrok-free.dev
```

```text
https://your-ngrok-subdomain.ngrok-free.dev/api/bootstrap
```

4. Open `ios/ShopeeHybridAgent.xcodeproj` in Xcode and run `ShopeeHybridAgent`.

The iOS app loads `AgentBaseURL` from the `AGENT_BASE_URL` build setting in its `WKWebView` when the server is reachable, with the bundled static mock as a fallback. It does not assume `127.0.0.1:3000` unless you set that value explicitly. Tap the floating agent button, then tap the microphone button to start the OpenAI Realtime WebRTC voice session.

## Implemented Agent Tools

- `classify_need`
- `check_user_history`
- `analyze_surroundings`
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
