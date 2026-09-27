# e2e media fixtures (plans 03-04, 03-07)

| File | What it is | Why this exact shape |
|---|---|---|
| `sample.mp4` | 186 KiB, H.264 in an `mp42` container, 640×360, 2 s at 30 fps | A **real** encoded video, not a stub: the picker's `accept="video/mp4,video/quicktime"` must offer it, Storage's media-bucket mime allow-list must take it, and it must be small enough that a `@mux/upchunk` transfer is a single 5 MiB slice — so the e2e never waits on a multi-chunk upload. Regenerate on macOS with the AVFoundation script below (no ffmpeg needed). |
| `iphone.heic` | 2,908 B, HEVC-compressed HEIC | A **copy** of `packages/core/tests/fixtures/iphone.heic` (added by 03-01). It is copied, never sourced twice, so the browser case and the server case can never drift onto different captures. Re-copy with `cp packages/core/tests/fixtures/iphone.heic apps/web/e2e/fixtures/iphone.heic`. |
| `large.jpg` | 6.98 MiB, 2048×2048 | **Above** `RESUMABLE_THRESHOLD_BYTES` (6 MiB) and **below** the 8 MiB avatar cap, with its longest side at exactly the 2048 px normalisation box — so `normaliseImage` returns it untouched and the upload is forced down the TUS branch. |
| `huge.jpg` | 11.68 MiB, 2048×2048 | **Above** the avatar cap, so the browser re-encode is the only thing that can rescue it. |
| `post-a.jpg` / `post-b.jpg` | 869 B each, 320×320 flat colour | 04-09's composer fixtures. **Reused by 06-04** (`events.spec.ts`, describe `events admin`) as an event COVER: the `cover` purpose accepts any image the worker can derive, and a tiny flat file keeps the upload and the derivation inside the phone e2e's time budget; no new fixture was added. Deliberately TINY and deliberately NOT noise: the composer spec picks two of them in one file-chooser call and must stay inside the T2 feedback ceiling, so the bytes have to be uninteresting — the ladder, the TUS threshold and the re-encode branch are already proved by `large.jpg`/`huge.jpg` above. Regenerate from `packages/core` with `sharp({ create: { width: 320, height: 320, channels: 3, background: {…} } }).jpeg({ quality: 80 })`. |

Both JPEGs are deterministic incompressible noise (a counter-mode SHA-256 stream), which is what
makes a 2048 px JPEG weigh megabytes at all. Regenerate byte-for-byte from `packages/core`:

```js
// node --input-type=module, run inside packages/core (sharp lives there)
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function noise(bytes, seed) {
  const out = Buffer.alloc(bytes);
  let offset = 0, counter = 0;
  while (offset < bytes) {
    const block = createHash('sha256').update(`${seed}:${counter++}`).digest();
    block.copy(out, offset);
    offset += block.length;
  }
  return out;
}

const side = 2048;
for (const [name, quality, seed] of [['large', 92, 'tria-large'], ['huge', 100, 'tria-huge']]) {
  const raw = noise(side * side * 3, seed);
  const jpeg = await sharp(raw, { raw: { width: side, height: side, channels: 3 } })
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer();
  writeFileSync(`../../apps/web/e2e/fixtures/${name}.jpg`, jpeg);
}
```

## Regenerating `sample.mp4` (macOS, no ffmpeg)

`ffmpeg` is not a repo dependency and is absent from a clean macOS machine, so the fixture is
produced with the system's own encoder through AVFoundation. Save as `mkmp4.swift` and run
`swift mkmp4.swift apps/web/e2e/fixtures/sample.mp4`:

```swift
import AVFoundation
import CoreVideo
import Foundation

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.removeItem(at: out)

let width = 640, height = 360, fps: Int32 = 30, seconds = 2
let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 900_000],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

for frame in 0..<(Int(fps) * seconds) {
  var pb: CVPixelBuffer?
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, nil, &pb)
  guard let buffer = pb else { continue }
  CVPixelBufferLockBaseAddress(buffer, [])
  if let base = CVPixelBufferGetBaseAddress(buffer) {
    let bpr = CVPixelBufferGetBytesPerRow(buffer)
    let ptr = base.assumingMemoryBound(to: UInt8.self)
    for y in 0..<height {
      for x in 0..<width {
        let o = y * bpr + x * 4
        ptr[o + 0] = UInt8((x &+ frame &* 3) % 256)
        ptr[o + 1] = UInt8((y &+ frame &* 5) % 256)
        ptr[o + 2] = UInt8((x &+ y &+ frame &* 7) % 256)
        ptr[o + 3] = 255
      }
    }
  }
  CVPixelBufferUnlockBaseAddress(buffer, [])
  while !input.isReadyForMoreMediaData { usleep(2000) }
  adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
}
input.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
```

The moving gradient is deliberate: uniform frames compress to almost nothing, and a fixture that
weighs 2 KB would not exercise a chunked transfer at all.
