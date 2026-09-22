# e2e media fixtures (plan 03-04)

| File | What it is | Why this exact shape |
|---|---|---|
| `iphone.heic` | 2,908 B, HEVC-compressed HEIC | A **copy** of `packages/core/tests/fixtures/iphone.heic` (added by 03-01). It is copied, never sourced twice, so the browser case and the server case can never drift onto different captures. Re-copy with `cp packages/core/tests/fixtures/iphone.heic apps/web/e2e/fixtures/iphone.heic`. |
| `large.jpg` | 6.98 MiB, 2048×2048 | **Above** `RESUMABLE_THRESHOLD_BYTES` (6 MiB) and **below** the 8 MiB avatar cap, with its longest side at exactly the 2048 px normalisation box — so `normaliseImage` returns it untouched and the upload is forced down the TUS branch. |
| `huge.jpg` | 11.68 MiB, 2048×2048 | **Above** the avatar cap, so the browser re-encode is the only thing that can rescue it. |

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
