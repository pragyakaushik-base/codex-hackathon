import ARKit
import RealityKit
import UIKit

@MainActor
final class ARCameraSnapshotStore: ObservableObject {
    weak var arView: ARView?

    func captureSnapshotPayload() async throws -> [String: String] {
        guard let arView else {
            throw SnapshotError.cameraUnavailable
        }

        let image = try await withCheckedThrowingContinuation { continuation in
            arView.snapshot(saveToHDR: false) { image in
                if let image {
                    continuation.resume(returning: image)
                } else {
                    continuation.resume(throwing: SnapshotError.captureFailed)
                }
            }
        }

        guard let data = image.jpegData(compressionQuality: 0.7) else {
            throw SnapshotError.encodingFailed
        }

        return [
            "mimeType": "image/jpeg",
            "imageBase64": data.base64EncodedString()
        ]
    }

    enum SnapshotError: LocalizedError {
        case cameraUnavailable
        case captureFailed
        case encodingFailed

        var errorDescription: String? {
            switch self {
            case .cameraUnavailable:
                return "AR camera view is not available yet."
            case .captureFailed:
                return "Unable to capture the AR camera snapshot."
            case .encodingFailed:
                return "Unable to encode the captured image."
            }
        }
    }
}
