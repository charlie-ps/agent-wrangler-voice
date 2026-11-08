// The board's speech-to-text helper (server/speech.js builds it with swiftc on first use and runs one
// per recording). Apple's SpeechTranscriber (macOS 26), on this Mac only: stdin is the browser's
// microphone as 16-bit little-endian mono PCM at `--rate` Hz, stdout one JSON object per line:
// {"ev":"installing","fraction"} while macOS fetches its English model, {"ev":"ready"}, {"ev":"partial","text"}
// as the words change, and once stdin closes {"ev":"final","text"}; {"ev":"error","reason","error"}
// on any failure, then a non-zero exit. `--setup` only installs the model, prints {"ev":"installed"} and
// exits without reading stdin, so Voice can do it when it is turned on rather than in the first box.
// It opens no microphone and no network connection of its own.
import Foundation
import Speech
import AVFoundation

let out = NSLock()
func emit(_ o: [String: Any]) {
    out.lock(); defer { out.unlock() }
    guard var d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) else { return }
    d.append(0x0a)
    FileHandle.standardOutput.write(d)
}
func fail(_ reason: String, _ error: String) -> Never {
    emit(["ev": "error", "reason": reason, "error": error])
    exit(1)
}

func option(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let at = args.firstIndex(of: name), at + 1 < args.count else { return nil }
    return args[at + 1]
}
let rate = option("--rate").flatMap(Double.init).flatMap { (8000...48000).contains($0) ? $0 : nil } ?? 16000
let context = option("--context")?.split(separator: ",").map(String.init) ?? []

guard SpeechTranscriber.isAvailable else { fail("unavailable", "SpeechTranscriber is not available on this Mac") }
guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US")) else { fail("no-locale", "SpeechTranscriber has no English model for this Mac") }
let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults], attributeOptions: [])

do {
    // An installed model still hands back a request, which takes a few hundred ms to do nothing.
    if await AssetInventory.status(forModules: [transcriber]) != .installed, let req = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        emit(["ev": "installing", "fraction": 0])
        let progress = req.progress
        let ticker = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(400))
                emit(["ev": "installing", "fraction": progress.fractionCompleted])
            }
        }
        defer { ticker.cancel() }
        try await req.downloadAndInstall()
    }
} catch { fail("no-model", "macOS could not install its English speech model: \(error.localizedDescription)") }
if CommandLine.arguments.contains("--setup") {
    emit(["ev": "installed"])
    exit(0)
}

let analyzer = SpeechAnalyzer(modules: [transcriber])
guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else { fail("no-format", "SpeechTranscriber offered no audio format") }
let src = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true)!
let converter = src == fmt ? nil : AVAudioConverter(from: src, to: fmt)
do {
    if !context.isEmpty {
        let ctx = AnalysisContext()
        ctx.contextualStrings[.general] = context
        try await analyzer.setContext(ctx)
    }
    try await analyzer.prepareToAnalyze(in: fmt)
} catch { fail("prepare", "SpeechAnalyzer would not start: \(error.localizedDescription)") }

let (stream, feed) = AsyncStream<AnalyzerInput>.makeStream()

func pcm(_ bytes: Data) -> AVAudioPCMBuffer? {
    let frames = AVAudioFrameCount(bytes.count / 2)
    guard frames > 0, let b = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: frames) else { return nil }
    b.frameLength = frames
    bytes.withUnsafeBytes { raw in _ = memcpy(b.int16ChannelData![0], raw.baseAddress!, Int(frames) * 2) }
    guard let converter else { return b }
    let cap = AVAudioFrameCount(Double(frames) * fmt.sampleRate / src.sampleRate) + 64
    guard let o = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { return nil }
    nonisolated(unsafe) var given: AVAudioPCMBuffer? = b
    var err: NSError?
    converter.convert(to: o, error: &err) { _, st in
        guard let next = given else { st.pointee = .noDataNow; return nil }
        given = nil; st.pointee = .haveData; return next
    }
    return err == nil && o.frameLength > 0 ? o : nil
}

// stdin on its own thread, so audio that arrives while the model loads waits in the stream.
Thread {
    var carry = Data()
    while true {
        let chunk = FileHandle.standardInput.availableData
        if chunk.isEmpty { break }
        carry.append(chunk)
        let whole = carry.count & ~1
        if whole == 0 { continue }
        if let b = pcm(carry.prefix(whole)) { feed.yield(AnalyzerInput(buffer: b)) }
        carry = Data(carry.dropFirst(whole))
    }
    feed.finish()
}.start()

actor Words {
    var done = ""
    var volatile = ""
    func take(_ text: String, final: Bool) -> String {
        if final { done += text; volatile = "" } else { volatile = text }
        return done + volatile
    }
    var all: String { done + volatile }
}
let words = Words()
let reader = Task {
    for try await r in transcriber.results {
        let text = await words.take(String(r.text.characters), final: r.isFinal)
        emit(["ev": "partial", "text": text])
    }
}

do {
    try await analyzer.start(inputSequence: stream)
    emit(["ev": "ready"])
    // Returns once stdin has closed and every word in it is final.
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    try await reader.value
} catch { fail("analyze", "SpeechAnalyzer stopped: \(error.localizedDescription)") }
emit(["ev": "final", "text": await words.all])
exit(0)
