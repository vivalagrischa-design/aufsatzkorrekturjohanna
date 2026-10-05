import Foundation
import Vision
import ImageIO

// Language correction stays OFF: spelling errors are evidence in an essay.
do {
    guard CommandLine.arguments.count == 2 else { throw NSError(domain: "OCR", code: 1) }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "Bild nicht lesbar", code: 2) }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let orientation = CGImagePropertyOrientation(rawValue: (properties?[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1) ?? .up
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["de-DE", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:]).perform([request])
    let lines = (request.results ?? []).compactMap { result -> [String: Any]? in
        guard let candidate = result.topCandidates(1).first else { return nil }
        return ["text": candidate.string, "confidence": candidate.confidence]
    }
    let data = try JSONSerialization.data(withJSONObject: ["lines": lines])
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("Texterkennung fehlgeschlagen: \(error)\n".utf8))
    exit(1)
}
