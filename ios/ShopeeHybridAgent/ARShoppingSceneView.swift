import ARKit
import RealityKit
import SwiftUI

struct ARShoppingSceneView: UIViewRepresentable {
    @ObservedObject var viewModel: ARShoppingViewModel
    @ObservedObject var snapshotStore: ARCameraSnapshotStore

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel, snapshotStore: snapshotStore)
    }

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero)
        view.automaticallyConfigureSession = false
        view.environment.background = .cameraFeed()
        view.session.delegate = context.coordinator
        context.coordinator.attach(to: view)
        snapshotStore.arView = view

        let coachingOverlay = ARCoachingOverlayView()
        coachingOverlay.session = view.session
        coachingOverlay.goal = .horizontalPlane
        coachingOverlay.activatesAutomatically = true
        coachingOverlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(coachingOverlay)
        NSLayoutConstraint.activate([
            coachingOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            coachingOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            coachingOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            coachingOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        let tapRecognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tapRecognizer)

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .automatic
        view.session.run(configuration)

        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        context.coordinator.updateScene(
            setup: viewModel.activeSetup,
            recommendations: viewModel.recommendations,
            placementVersion: viewModel.placementVersion
        )
    }

    final class Coordinator: NSObject, ARSessionDelegate {
        private let viewModel: ARShoppingViewModel
        private let snapshotStore: ARCameraSnapshotStore
        private weak var arView: ARView?
        private var lastPlacementVersion = -1
        private var placedAnchor: AnchorEntity?
        private var pendingSetup: SpatialSetupPlan?
        private var pendingRecommendations: [DemoProduct] = []

        init(viewModel: ARShoppingViewModel, snapshotStore: ARCameraSnapshotStore) {
            self.viewModel = viewModel
            self.snapshotStore = snapshotStore
        }

        @MainActor
        func attach(to arView: ARView) {
            self.arView = arView
            snapshotStore.arView = arView
        }

        @MainActor
        func updateScene(setup: SpatialSetupPlan?, recommendations: [DemoProduct], placementVersion: Int) {
            guard placementVersion != lastPlacementVersion else { return }
            lastPlacementVersion = placementVersion
            place(setup: setup, recommendations: recommendations)
        }

        func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            let detected = anchors.contains { anchor in
                guard let plane = anchor as? ARPlaneAnchor else { return false }
                return plane.alignment == .horizontal
            }

            if detected {
                Task { @MainActor in
                    viewModel.markPlaneDetected(true)
                    retryPendingPlacementIfNeeded()
                }
            }
        }

        @objc
        func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let arView else { return }
            let location = recognizer.location(in: arView)
            guard let entity = arView.entity(at: location) else { return }

            let productID = sequence(first: entity, next: \.parent)
                .first(where: { !$0.name.isEmpty })?
                .name

            guard let productID else { return }

            Task { @MainActor in
                viewModel.selectProduct(id: productID)
            }
        }

        @MainActor
        private func retryPendingPlacementIfNeeded() {
            guard !pendingRecommendations.isEmpty else { return }
            let setup = pendingSetup
            let recommendations = pendingRecommendations
            pendingSetup = nil
            pendingRecommendations = []
            place(setup: setup, recommendations: recommendations)
        }

        @MainActor
        private func place(setup: SpatialSetupPlan?, recommendations: [DemoProduct]) {
            guard let arView else { return }
            guard !recommendations.isEmpty else { return }

            let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
            let existing = arView.raycast(from: center, allowing: .existingPlaneGeometry, alignment: .horizontal)
            let estimated = arView.raycast(from: center, allowing: .estimatedPlane, alignment: .horizontal)
            guard let result = (existing + estimated).first else {
                pendingSetup = setup
                pendingRecommendations = recommendations
                Task { @MainActor in
                    viewModel.updatePlacementStatus("Scanning the desk. Move the phone slowly so I can place the 3D setup.")
                }
                return
            }

            placedAnchor?.removeFromParent()

            let transform = Transform(matrix: result.worldTransform)
            let anchor = AnchorEntity(world: transform.matrix)
            let productsByID = Dictionary(uniqueKeysWithValues: recommendations.map { ($0.id, $0) })
            let layoutItems = buildLayoutItems(setup: setup, recommendations: recommendations, productsByID: productsByID)

            for (index, item) in layoutItems.enumerated() {
                let entity = makeProductEntity(for: item.product)
                let finalPosition = item.position ?? gridPosition(for: index)
                entity.position = finalPosition + SIMD3<Float>(0, 0.12, 0)
                anchor.addChild(entity)
                let targetTransform = Transform(scale: entity.scale, rotation: entity.orientation, translation: finalPosition)
                entity.move(to: targetTransform, relativeTo: anchor, duration: 0.45 + Double(index) * 0.12, timingFunction: .easeInOut)

                let label = makeLabelEntity(for: item.product, price: item.price)
                label.position = finalPosition + SIMD3<Float>(0, max(item.product.heightMeters * 1.1, 0.12), 0)
                anchor.addChild(label)
            }

            arView.scene.addAnchor(anchor)
            placedAnchor = anchor

            let status = setup.map {
                "\($0.setupName) placed. Total $\(Int($0.totalPrice)), fit score \($0.fitScore)/100."
            } ?? "Placed \(recommendations.count) products on the desk. Tap one to compare it."

            Task { @MainActor in
                viewModel.updatePlacementStatus(status)
            }
        }

        private func buildLayoutItems(
            setup: SpatialSetupPlan?,
            recommendations: [DemoProduct],
            productsByID: [String: DemoProduct]
        ) -> [(product: DemoProduct, position: SIMD3<Float>?, price: Double)] {
            if let setup {
                return setup.items.compactMap { item in
                    guard let product = productsByID[item.id] else { return nil }
                    return (product, zonePosition(for: item.position), item.price)
                }
            }

            return recommendations.enumerated().map { index, product in
                (product, gridPosition(for: index), product.price)
            }
        }

        private func gridPosition(for index: Int) -> SIMD3<Float> {
            let row = index / 2
            let column = index % 2
            let x: Float = column == 0 ? -0.2 : 0.2
            let z: Float = row == 0 ? -0.12 : 0.18
            return SIMD3(x, 0, z)
        }

        private func zonePosition(for zone: String) -> SIMD3<Float> {
            switch zone {
            case "center_back":
                return SIMD3(0, 0, -0.22)
            case "left_back":
                return SIMD3(-0.24, 0, -0.15)
            case "right_back":
                return SIMD3(0.24, 0, -0.14)
            case "front_center":
                return SIMD3(0, 0, 0.08)
            case "front_right":
                return SIMD3(0.21, 0, 0.1)
            case "front_left":
                return SIMD3(-0.22, 0, 0.08)
            default:
                return SIMD3(0, 0, 0)
            }
        }

        @MainActor
        private func makeProductEntity(for product: DemoProduct) -> Entity {
            if let loadedModel = loadBundledModel(for: product) {
                loadedModel.name = product.id
                loadedModel.generateCollisionShapes(recursive: true)
                return loadedModel
            }

            let root = Entity()
            root.name = product.id

            let body = ModelEntity(
                mesh: .generateBox(size: [product.widthMeters, product.heightMeters, product.depthMeters]),
                materials: [SimpleMaterial(color: UIColor(product.accentColor), roughness: 0.15, isMetallic: true)]
            )
            body.position = [0, product.heightMeters * 0.5, 0]
            root.addChild(body)
            root.generateCollisionShapes(recursive: true)

            return root
        }

        @MainActor
        private func loadBundledModel(for product: DemoProduct) -> Entity? {
            guard
                let metadata = viewModel.arMetadata(for: product.id),
                let modelName = metadata.modelName,
                let url = Bundle.main.url(forResource: modelName, withExtension: "usdz", subdirectory: "Models"),
                let entity = try? Entity.load(contentsOf: url)
            else {
                return nil
            }

            let bounds = entity.visualBounds(relativeTo: nil)
            let extents = bounds.extents
            let target = SIMD3<Float>(
                max(product.widthMeters, 0.04),
                max(product.heightMeters, 0.04),
                max(product.depthMeters, 0.04)
            )

            var uniformScale = metadata.scale ?? 1
            if extents.x > 0, extents.y > 0, extents.z > 0 {
                uniformScale *= min(target.x / extents.x, target.y / extents.y, target.z / extents.z)
            }
            entity.scale = SIMD3(repeating: uniformScale)

            let root = Entity()
            root.name = product.id
            entity.position = [0, 0.01, 0]
            root.addChild(entity)
            return root
        }

        @MainActor
        private func makeLabelEntity(for product: DemoProduct, price: Double) -> Entity {
            let labelRoot = Entity()
            let title = viewModel.arMetadata(for: product.id)?.arLabel ?? product.title
            let text = "\(title)\n$\(Int(price))"

            let textMesh = MeshResource.generateText(
                text,
                extrusionDepth: 0.001,
                font: .systemFont(ofSize: 0.06, weight: .semibold),
                containerFrame: CGRect(x: 0, y: 0, width: 0.42, height: 0.16),
                alignment: .center,
                lineBreakMode: .byWordWrapping
            )
            let textEntity = ModelEntity(
                mesh: textMesh,
                materials: [SimpleMaterial(color: .white, roughness: 0.4, isMetallic: false)]
            )

            let bounds = textEntity.visualBounds(relativeTo: nil)
            let background = ModelEntity(
                mesh: .generatePlane(width: max(bounds.extents.x + 0.08, 0.22), depth: max(bounds.extents.y + 0.05, 0.08)),
                materials: [SimpleMaterial(color: UIColor.black.withAlphaComponent(0.72), roughness: 0.8, isMetallic: false)]
            )
            background.position = [0, bounds.center.y, -0.002]

            labelRoot.addChild(background)
            labelRoot.addChild(textEntity)
            labelRoot.transform.rotation = simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))

            return labelRoot
        }
    }
}
