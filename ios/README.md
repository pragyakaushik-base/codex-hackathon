# Shopee Hybrid Agent iOS App

This app is a SwiftUI shell around a bundled `WKWebView`. The web UI lives in `ShopeeHybridAgent/Web` and is loaded from the app bundle, so the prototype can run without a local web server.

## Build

Open `ShopeeHybridAgent.xcodeproj` in Xcode, or build from the command line:

```sh
xcodebuild -project ios/ShopeeHybridAgent.xcodeproj -scheme ShopeeHybridAgent -destination 'platform=iOS Simulator,name=iPhone 16' build
```

The current prototype covers the mocked flow:

- Shopee screenshot background with a floating shopping agent button.
- Listening state.
- Camera/image snap state.
- Thinking checklist.
- Product suggestions.
- Cart mutation and voucher state.
- Checkout preview.
