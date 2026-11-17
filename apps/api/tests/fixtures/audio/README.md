# Voice message fixtures (plan 12.5-01, VOICE-13)

Three tiny REAL recordings, about 2 seconds of a 440 Hz sine tone each, one per container the
`audio/voice` media pair accepts (`VOICE_MIMES` in `packages/contracts/src/media.ts`). The pipeline tests
of Phase 12.5 (the signature check and the duration probe at `complete`) use them as the happy path.

| File | Container and codec | Size | Probed duration |
|---|---|---|---|
| `voice-2s.webm` | WebM (Matroska), Opus, mono 48 kHz, 32 kbit/s | 11,013 B | 2.008 s |
| `voice-2s.mp4` | MP4 (ISO-BMFF), AAC, mono 44.1 kHz, 48 kbit/s, `+faststart` | 13,509 B | 2.000 s |
| `voice-2s.ogg` | Ogg, Opus, mono 48 kHz, 32 kbit/s | 10,171 B | 2.007 s |

Every file is under 40 KiB and its `ffprobe` duration is 2.0 seconds within 0.1.

## How they were made

Produced once with ffmpeg 9.0.2 (Homebrew, macOS) and committed as bytes. No npm package is involved.

```sh
cd apps/api/tests/fixtures/audio

ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ac 1 -ar 48000 -c:a libopus -b:a 32k voice-2s.webm
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ac 1 -ar 44100 -c:a aac -b:a 48k -movflags +faststart voice-2s.mp4
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ac 1 -ar 48000 -c:a libopus -b:a 32k voice-2s.ogg
```

Check a file with:

```sh
ffprobe -v error -show_entries format=format_name,duration:stream=codec_name -of csv=p=0 voice-2s.webm
```

## What is NOT committed

Longer or invalid inputs are generated AT TEST TIME and never committed: a take over 300 seconds
(for the duration refusal), a file that declares `audio/webm` but holds other bytes (for the signature
refusal), and a truncated or empty container. A test builds them in a temporary directory so the
repository carries only the three small recordings above.
