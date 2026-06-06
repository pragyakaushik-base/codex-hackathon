import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        HybridAgentWebView()
            .ignoresSafeArea()
            .background(Color.white)
    }
}

struct HybridAgentWebView: UIViewRepresentable {
    private let fallbackAddress = "http://127.0.0.1:3000"

    func makeCoordinator() -> Coordinator {
        Coordinator()
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
        } else if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

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

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "nativeBridge" else { return }

            if let body = message.body as? [String: Any],
               let event = body["event"] as? String {
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

        private func loadBundledFallback(in webView: WKWebView) {
            guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
                return
            }

            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }
}
