import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var viewModel = ARShoppingViewModel()
    @StateObject private var snapshotStore = ARCameraSnapshotStore()

    var body: some View {
        ZStack(alignment: .top) {
            ARShoppingSceneView(viewModel: viewModel, snapshotStore: snapshotStore)
                .ignoresSafeArea()

            HybridAgentWebView(viewModel: viewModel, snapshotStore: snapshotStore)
                .ignoresSafeArea()
                .opacity(viewModel.showingWebOverlay ? 1 : 0)
                .allowsHitTesting(viewModel.showingWebOverlay)

            if !viewModel.showingWebOverlay {
                HStack(spacing: 12) {
                    Label(viewModel.planeDetected ? "Surface detected" : "Scanning surface", systemImage: viewModel.planeDetected ? "tablecells.fill" : "camera.metering.unknown")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.62), in: Capsule())

                    Spacer()

                    Button("Back to shop") {
                        viewModel.showingWebOverlay = true
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.62), in: Capsule())
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
            }
        }
        .background(Color.black)
    }
}

struct HybridAgentWebView: UIViewRepresentable {
    @ObservedObject var viewModel: ARShoppingViewModel
    @ObservedObject var snapshotStore: ARCameraSnapshotStore

    private let fallbackAddress = "http://127.0.0.1:3000"

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel, snapshotStore: snapshotStore)
    }

    func makeUIView(context: Context) -> WKWebView {
        let serverAddress = Bundle.main.object(forInfoDictionaryKey: "AgentBaseURL") as? String
        let resolvedServerAddress = normalizeServerAddress(serverAddress)
        let escapedServerAddress = resolvedServerAddress
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
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        configuration.userContentController.add(context.coordinator, name: "nativeBridge")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        if let serverURL = URL(string: resolvedServerAddress) {
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
            webView.evaluateJavaScript("window.syncNativeState?.(\(json))")
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
