import Foundation
import SwiftUI

struct DemoProduct: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let category: String
    let price: Double
    let rating: Double
    let seller: String
    let delivery: String
    let summary: String
    let pros: [String]
    let cons: [String]
    let accentHex: String
    let widthMeters: Float
    let heightMeters: Float
    let depthMeters: Float
}

struct ProductARMetadata: Codable, Equatable {
    let modelName: String?
    let accentHex: String?
    let arLabel: String?
    let scale: Float?
}

struct CartEntry: Identifiable, Equatable {
    let id = UUID()
    let product: DemoProduct
}

struct WebAgentState: Encodable, Equatable {
    struct ProductSnapshot: Encodable, Equatable {
        let id: String
        let title: String
        let price: Double
        let rating: Double
        let delivery: String
        let summary: String
        let accentHex: String
    }

    let prompt: String
    let sceneStatus: String
    let planeDetected: Bool
    let selectedProductID: String?
    let recommendations: [ProductSnapshot]
    let cart: [ProductSnapshot]
}

struct SpatialSetupPlan: Codable, Equatable {
    struct Item: Codable, Equatable, Identifiable {
        let id: String
        let title: String
        let price: Double
        let position: String
        let reason: String
    }

    let setupName: String
    let totalPrice: Double
    let fitScore: Int
    let budget: Double?
    let summary: String
    let items: [Item]

    enum CodingKeys: String, CodingKey {
        case setupName = "setup_name"
        case totalPrice = "total_price"
        case fitScore = "fit_score"
        case budget
        case summary
        case items
    }
}

@MainActor
final class ARShoppingViewModel: ObservableObject {
    @Published var catalog: [DemoProduct] = []
    @Published var arMetadataByProductID: [String: ProductARMetadata] = [:]
    @Published var recommendations: [DemoProduct] = []
    @Published var selectedProductID: String?
    @Published var cart: [CartEntry] = []
    @Published var agentPrompt = "I need filming equipment for product videos under $1000."
    @Published var sceneStatus = "Move your phone to detect a desk or table."
    @Published var planeDetected = false
    @Published var placementVersion = 0
    @Published var showingAgent = true
    @Published var showingWebOverlay = true
    @Published var activeSetup: SpatialSetupPlan?

    init() {
        loadCatalog()
        loadARMetadata()
    }

    var selectedProduct: DemoProduct? {
        recommendations.first(where: { $0.id == selectedProductID }) ?? recommendations.first
    }

    var cartCountText: String {
        "\(cart.count) item" + (cart.count == 1 ? "" : "s")
    }

    var totalPrice: Double {
        cart.reduce(0) { $0 + $1.product.price }
    }

    var webState: WebAgentState {
        WebAgentState(
            prompt: agentPrompt,
            sceneStatus: sceneStatus,
            planeDetected: planeDetected,
            selectedProductID: selectedProductID,
            recommendations: recommendations.map(Self.snapshot(for:)),
            cart: cart.map { Self.snapshot(for: $0.product) }
        )
    }

    var comparisonSummary: String {
        if let activeSetup {
            let budgetText: String
            if let budget = activeSetup.budget {
                budgetText = "$\(Int(activeSetup.totalPrice)) of $\(Int(budget))"
            } else {
                budgetText = "$\(Int(activeSetup.totalPrice)) total"
            }
            return "\(activeSetup.setupName) scores \(activeSetup.fitScore)/100 and uses \(budgetText)."
        }

        guard let selected = selectedProduct else { return "Ask for a product, place it in AR, then tap one to compare it." }
        let cheaper = recommendations.filter { $0.id != selected.id && $0.price < selected.price }.count
        let higherRated = recommendations.filter { $0.id != selected.id && $0.rating > selected.rating }.count

        if cheaper == 0 && higherRated == 0 {
            return "\(selected.title) is the strongest overall pick: best balance of price, rating, and filming flexibility."
        }
        if cheaper > 0 && higherRated == 0 {
            return "\(selected.title) costs more than at least one alternative, but it leads on overall video quality and creator value."
        }
        if cheaper == 0 && higherRated > 0 {
            return "\(selected.title) is the budget leader, but one alternative edges it on rating."
        }
        return "\(selected.title) sits in the middle: not the cheapest and not the top-rated, but the most balanced filming tradeoff."
    }

    func loadCatalog() {
        guard
            let url = Bundle.main.url(forResource: "products", withExtension: "json", subdirectory: "DemoCatalog"),
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode([DemoProduct].self, from: data)
        else {
            sceneStatus = "Catalog failed to load."
            return
        }

        catalog = decoded
    }

    func loadARMetadata() {
        guard
            let url = Bundle.main.url(forResource: "product-ar-metadata", withExtension: "json", subdirectory: "DemoCatalog"),
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode([String: ProductARMetadata].self, from: data)
        else {
            return
        }

        arMetadataByProductID = decoded
    }

    func runDemoAgent() {
        activeSetup = nil

        let budget = parseBudget(from: agentPrompt) ?? 1000
        let query = agentPrompt.lowercased()
        let wantsFilmingGear = query.isEmpty || [
            "film", "filming", "camera", "creator", "video", "vlog", "dslr", "mirrorless", "shoot"
        ].contains(where: query.contains)

        recommendations = catalog
            .filter { $0.category == "filming_equipment" && $0.price <= budget && wantsFilmingGear }
            .sorted {
                if $0.rating == $1.rating {
                    return $0.price < $1.price
                }
                return $0.rating > $1.rating
            }
            .prefix(3)
            .map { $0 }

        selectedProductID = recommendations.first?.id

        if recommendations.isEmpty {
            sceneStatus = "No filming equipment in the demo catalog matches that request."
        } else {
            sceneStatus = "Recommended \(recommendations.count) filming products. Place them on the detected desk."
            showingWebOverlay = true
            showingAgent = true
        }
    }

    func handleAgentUtterance(_ utterance: String) {
        let normalized = utterance.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }

        agentPrompt = normalized

        if let rank = parseOrdinalSelection(from: normalized) {
            selectRecommendation(rank: rank)
            return
        }

        if normalized.lowercased().contains("add") && selectedProduct != nil {
            addSelectedToCart()
            return
        }

        if normalized.lowercased().contains("place") || normalized.lowercased().contains("show them in ar") {
            requestPlacement()
            return
        }

        runDemoAgent()
    }

    func requestPlacement() {
        guard !recommendations.isEmpty else {
            sceneStatus = "Generate recommendations before placing products in AR."
            return
        }
        placementVersion += 1
    }

    func applySpatialSetup(_ setup: SpatialSetupPlan) {
        let productsByID = Dictionary(uniqueKeysWithValues: catalog.map { ($0.id, $0) })
        let resolvedItems = setup.items.compactMap { item -> SpatialSetupPlan.Item? in
            productsByID[item.id] == nil ? nil : item
        }
        let resolvedProducts = resolvedItems.compactMap { productsByID[$0.id] }

        guard !resolvedProducts.isEmpty else {
            sceneStatus = "The setup plan did not match any bundled 3D products."
            return
        }

        activeSetup = SpatialSetupPlan(
            setupName: setup.setupName,
            totalPrice: setup.totalPrice,
            fitScore: setup.fitScore,
            budget: setup.budget,
            summary: setup.summary,
            items: resolvedItems
        )
        recommendations = resolvedProducts
        selectedProductID = resolvedProducts.first?.id
        sceneStatus = setup.summary
        showingWebOverlay = false
        showingAgent = true
        placementVersion += 1
    }

    func markPlaneDetected(_ detected: Bool) {
        planeDetected = detected
        if detected && sceneStatus == "Move your phone to detect a desk or table." {
            sceneStatus = "Desk detected. Ask for a product or place the recommendations."
        }
    }

    func updatePlacementStatus(_ message: String) {
        sceneStatus = message
    }

    func selectProduct(id: String) {
        selectedProductID = id

        if let activeSetup,
           let setupItem = activeSetup.items.first(where: { $0.id == id }) {
            sceneStatus = setupItem.reason
            return
        }

        if let product = selectedProduct {
            sceneStatus = "Selected \(product.title). Review the tradeoffs below."
        }
    }

    func addSelectedToCart() {
        guard let product = selectedProduct else { return }
        if !cart.contains(where: { $0.product.id == product.id }) {
            cart.append(CartEntry(product: product))
        }
        sceneStatus = "\(product.title) added to mock cart."
    }

    func arMetadata(for productID: String) -> ProductARMetadata? {
        arMetadataByProductID[productID]
    }

    func selectRecommendation(rank: Int) {
        guard rank > 0, rank <= recommendations.count else { return }
        selectProduct(id: recommendations[rank - 1].id)
    }

    private func parseBudget(from prompt: String) -> Double? {
        let pattern = #"\$?(\d+(?:\.\d+)?)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(prompt.startIndex..., in: prompt)
        guard let match = regex.firstMatch(in: prompt, range: range), match.numberOfRanges > 1 else { return nil }
        guard let valueRange = Range(match.range(at: 1), in: prompt) else { return nil }
        return Double(prompt[valueRange])
    }

    private func parseOrdinalSelection(from utterance: String) -> Int? {
        let lowered = utterance.lowercased()

        if lowered.contains("first") || lowered.contains("1st") {
            return 1
        }
        if lowered.contains("second") || lowered.contains("2nd") {
            return 2
        }
        if lowered.contains("third") || lowered.contains("3rd") {
            return 3
        }
        return nil
    }

    private static func snapshot(for product: DemoProduct) -> WebAgentState.ProductSnapshot {
        .init(
            id: product.id,
            title: product.title,
            price: product.price,
            rating: product.rating,
            delivery: product.delivery,
            summary: product.summary,
            accentHex: product.accentHex
        )
    }
}

extension DemoProduct {
    var accentColor: Color {
        Color(hex: accentHex)
    }
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)

        let red = Double((value >> 16) & 0xFF) / 255
        let green = Double((value >> 8) & 0xFF) / 255
        let blue = Double(value & 0xFF) / 255
        self.init(red: red, green: green, blue: blue)
    }
}
