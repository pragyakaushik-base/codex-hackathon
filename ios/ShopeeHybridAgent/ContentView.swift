import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var viewModel = ARShoppingViewModel()
    @StateObject private var snapshotStore = ARCameraSnapshotStore()

    var body: some View {
        ZStack {
            ARShoppingSceneView(viewModel: viewModel, snapshotStore: snapshotStore)
                .ignoresSafeArea()

            HybridAgentWebView(viewModel: viewModel, snapshotStore: snapshotStore)
                .ignoresSafeArea()
                .opacity(viewModel.showingWebOverlay ? 1 : 0)
                .allowsHitTesting(viewModel.showingWebOverlay)

            if !viewModel.showingWebOverlay {
                VStack(spacing: 12) {
                    topStatus
                    Spacer()
                    if viewModel.showingAgent {
                        VStack(spacing: 14) {
                            recommendationSheet
                            agentSheet
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 12)
            }

        }
        .background(Color.black)
    }

    private var topStatus: some View {
        HStack(spacing: 12) {
            Label(viewModel.planeDetected ? "Desk detected" : "Scanning surface", systemImage: viewModel.planeDetected ? "tablecells.fill" : "camera.metering.unknown")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.black.opacity(0.62), in: Capsule())

            Spacer()

            Button("Back To Shop") {
                viewModel.showingWebOverlay = true
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.black.opacity(0.62), in: Capsule())
        }
    }

    private var recommendationSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Shopee AR Demo")
                .font(.headline.weight(.bold))
            Text(viewModel.sceneStatus)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                TextField("Ask for filming gear", text: $viewModel.agentPrompt)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))

                Button("Recommend") {
                    viewModel.runDemoAgent()
                }
                .buttonStyle(.borderedProminent)
            }

            HStack(spacing: 10) {
                Button("Place In AR") {
                    viewModel.requestPlacement()
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.recommendations.isEmpty)

                Button("Add To Cart") {
                    viewModel.addSelectedToCart()
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.selectedProduct == nil)

                Spacer()

                Text(viewModel.cartCountText)
                    .font(.subheadline.weight(.semibold))
                Text("$\(viewModel.totalPrice, specifier: "%.0f")")
                    .font(.subheadline.weight(.bold))
            }

            if !viewModel.recommendations.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(viewModel.recommendations) { product in
                            productCard(product)
                        }
                    }
                }
            }

            if let selected = viewModel.selectedProduct {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Tradeoffs")
                        .font(.subheadline.weight(.bold))
                    Text(viewModel.comparisonSummary)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(selected.summary)
                        .font(.footnote)
                    Text("Pros: \(selected.pros.joined(separator: " • "))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Cons: \(selected.cons.joined(separator: " • "))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
    }

    private var agentSheet: some View {
        HStack(spacing: 12) {
            Button(action: {
                viewModel.showingWebOverlay = true
            }) {
                Image(systemName: "photo")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 48, height: 48)
                    .background(Color.white.opacity(0.08))
                    .overlay(Circle().stroke(Color.white.opacity(0.05), lineWidth: 1))
                    .clipShape(Circle())
            }

            Button(action: {
                viewModel.requestPlacement()
            }) {
                Image(systemName: "camera")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 48, height: 48)
                    .background(Color.white.opacity(0.08))
                    .overlay(Circle().stroke(Color.white.opacity(0.05), lineWidth: 1))
                    .clipShape(Circle())
            }

            ZStack {
                Capsule()
                    .fill(Color(red: 11/255, green: 15/255, blue: 25/255))
                    .overlay(Capsule().stroke(Color.white.opacity(0.05), lineWidth: 1))

                Capsule()
                    .fill(LinearGradient(colors: [Color(red: 66/255, green: 133/255, blue: 244/255), Color(red: 138/255, green: 180/255, blue: 248/255)], startPoint: .leading, endPoint: .trailing))
                    .frame(width: 60, height: 20)
                    .blur(radius: 6)
            }
            .frame(width: 90, height: 48)

            Button(action: {
                viewModel.addSelectedToCart()
            }) {
                Image(systemName: "cart")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 48, height: 48)
                    .background(Color.white.opacity(0.08))
                    .overlay(Circle().stroke(Color.white.opacity(0.05), lineWidth: 1))
                    .clipShape(Circle())
            }
            .disabled(viewModel.selectedProduct == nil)

            Button(action: {
                viewModel.showingAgent = false
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 48, height: 48)
                    .background(Color.white.opacity(0.08))
                    .overlay(Circle().stroke(Color.white.opacity(0.05), lineWidth: 1))
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(red: 5/255, green: 5/255, blue: 5/255).opacity(0.85))
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.3), radius: 10, y: 5)
    }

    private func productCard(_ product: DemoProduct) -> some View {
        let isSelected = viewModel.selectedProductID == product.id

        return Button {
            viewModel.selectProduct(id: product.id)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 12)
                    .fill(product.accentColor.gradient)
                    .frame(width: 120, height: 72)
                    .overlay(alignment: .bottomTrailing) {
                        Text("$\(product.price, specifier: "%.0f")")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(8)
                    }

                Text(product.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Text("⭐ \(product.rating, specifier: "%.1f") • \(product.delivery)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .frame(width: 150, alignment: .leading)
            .background(isSelected ? product.accentColor.opacity(0.16) : Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(isSelected ? product.accentColor : .clear, lineWidth: 2)
            }
        }
        .buttonStyle(.plain)
    }
}

struct HybridAgentWebView: UIViewRepresentable {
    @ObservedObject var viewModel: ARShoppingViewModel
    @ObservedObject var snapshotStore: ARCameraSnapshotStore

    private let fallbackAddress = "bundle://Web/index.html"

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel, snapshotStore: snapshotStore)
    }

    func makeUIView(context: Context) -> WKWebView {
        let serverAddress = Bundle.main.object(forInfoDictionaryKey: "AgentBaseURL") as? String
        let resolvedServerAddress = normalizeServerAddress(serverAddress)
        let injectedBaseURL = resolvedServerAddress.hasPrefix("bundle://") ? "" : resolvedServerAddress
        let escapedServerAddress = injectedBaseURL
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__AGENT_BASE_URL = '\(escapedServerAddress)';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))
        configuration.userContentController.add(context.coordinator, name: "nativeBridge")
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        if resolvedServerAddress.hasPrefix("bundle://") {
            context.coordinator.loadBundledFallback(in: webView)
        } else if let serverURL = URL(string: resolvedServerAddress) {
            webView.load(URLRequest(url: serverURL))
        } else {
            context.coordinator.loadBundledFallback(in: webView)
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.syncStateIfNeeded(to: webView)
    }

    private func normalizeServerAddress(_ rawAddress: String?) -> String {
        let trimmedAddress = rawAddress?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmedAddress, !trimmedAddress.isEmpty else {
            return fallbackAddress
        }

        if trimmedAddress.hasPrefix("bundle://") {
            return trimmedAddress
        }

        let addressWithScheme = trimmedAddress.contains("://") ? trimmedAddress : "http://\(trimmedAddress)"
        guard var components = URLComponents(string: addressWithScheme) else {
            return fallbackAddress
        }

        if components.scheme == "https", components.port == 3000 {
            components.scheme = "http"
        }

        return components.url?.absoluteString ?? fallbackAddress
    }

    private static let bridgeScript = """
    window.__nativeCameraCaptureResolvers = {};
    window.captureNativeCameraView = function captureNativeCameraView(options = {}) {
      return new Promise((resolve, reject) => {
        const requestId = `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.__nativeCameraCaptureResolvers[requestId] = { resolve, reject };
        window.webkit?.messageHandlers?.nativeBridge?.postMessage({
          event: "captureSurroundings",
          requestId,
          question: options.question || ""
        });
      });
    };
    window.__resolveNativeCameraCapture = function(requestId, payload) {
      const pending = window.__nativeCameraCaptureResolvers[requestId];
      if (!pending) return;
      pending.resolve(payload);
      delete window.__nativeCameraCaptureResolvers[requestId];
    };
    window.__rejectNativeCameraCapture = function(requestId, message) {
      const pending = window.__nativeCameraCaptureResolvers[requestId];
      if (!pending) return;
      pending.reject(new Error(message));
      delete window.__nativeCameraCaptureResolvers[requestId];
    };
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let viewModel: ARShoppingViewModel
        private let snapshotStore: ARCameraSnapshotStore
        private weak var webView: WKWebView?
        private var lastSyncedState = ""

        init(viewModel: ARShoppingViewModel, snapshotStore: ARCameraSnapshotStore) {
            self.viewModel = viewModel
            self.snapshotStore = snapshotStore
        }

        func syncStateIfNeeded(to webView: WKWebView) {
            self.webView = webView

            let encoder = JSONEncoder()
            guard
                let data = try? encoder.encode(viewModel.webState),
                let json = String(data: data, encoding: .utf8),
                json != lastSyncedState
            else { return }

            lastSyncedState = json
            webView.evaluateJavaScript("window.syncNativeState(\(json))")
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "nativeBridge" else { return }
            guard
                let body = message.body as? [String: Any],
                let event = body["event"] as? String
            else { return }

            switch event {
            case "web_ready":
                if let webView {
                    syncStateIfNeeded(to: webView)
                }
            case "cameraTapped":
                Task { @MainActor in
                    viewModel.showingWebOverlay = false
                    viewModel.showingAgent = true
                }
            case "captureSurroundings":
                guard let requestId = body["requestId"] as? String else { return }
                Task { @MainActor in
                    await resolveSnapshot(requestId: requestId)
                }
            case "agent_prompt":
                if let prompt = body["prompt"] as? String {
                    Task { @MainActor in
                        viewModel.handleAgentUtterance(prompt)
                    }
                }
            case "run_demo":
                if let prompt = body["prompt"] as? String, !prompt.isEmpty {
                    Task { @MainActor in
                        viewModel.handleAgentUtterance(prompt)
                    }
                } else {
                    Task { @MainActor in
                        viewModel.runDemoAgent()
                    }
                }
            case "place_recommendations":
                Task { @MainActor in
                    viewModel.requestPlacement()
                }
            case "select_product":
                if let productID = body["productId"] as? String {
                    Task { @MainActor in
                        viewModel.selectProduct(id: productID)
                    }
                }
            case "select_rank":
                if let rank = body["rank"] as? Int {
                    Task { @MainActor in
                        viewModel.selectRecommendation(rank: rank)
                    }
                }
            case "add_selected_to_cart":
                Task { @MainActor in
                    viewModel.addSelectedToCart()
                }
            case "apply_spatial_setup":
                guard let setupBody = body["setup"] else { return }
                guard
                    JSONSerialization.isValidJSONObject(setupBody),
                    let data = try? JSONSerialization.data(withJSONObject: setupBody),
                    let setup = try? JSONDecoder().decode(SpatialSetupPlan.self, from: data)
                else { return }
                Task { @MainActor in
                    viewModel.applySpatialSetup(setup)
                }
            default:
                print("Hybrid web event:", event)
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            loadBundledFallback(in: webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            loadBundledFallback(in: webView)
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }

        func loadBundledFallback(in webView: WKWebView) {
            guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
                return
            }

            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        @MainActor
        private func resolveSnapshot(requestId: String) async {
            guard let webView else { return }

            do {
                let payload = try await snapshotStore.captureSnapshotPayload()
                let data = try JSONSerialization.data(withJSONObject: payload)
                guard let json = String(data: data, encoding: .utf8) else {
                    throw ARCameraSnapshotStore.SnapshotError.encodingFailed
                }
                _ = try await webView.evaluateJavaScript("window.__resolveNativeCameraCapture('\(requestId)', \(json))")
            } catch {
                let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                let escaped = message
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "'", with: "\\'")
                _ = try? await webView.evaluateJavaScript("window.__rejectNativeCameraCapture('\(requestId)', '\(escaped)')")
            }
        }
    }
}
