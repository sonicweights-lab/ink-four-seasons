# Same code. Four seasons. (ink-wash Reel in code)

A 24 s, 1080×1920 Reel: one procedurally drawn ink landscape that lives through spring, monsoon,
autumn and winter. No images, no footage, no AI image generator: every frame is computed.
by @sonicweights · style recipe via @viashaan

## Run it
```
npm install
npm run studio     # preview in the browser
npm run render     # writes out/ink-four-seasons.mp4
```
Fonts (Crimson Pro, JetBrains Mono, both OFL) and the soundtrack are already in `public/`.
To regenerate the soundtrack: `pip install numpy && npm run audio`.

## How it works
- `scene.ts` paints the landscape once: noise-based mountain washes (paler with distance), a bristle-brush
  simulation for the cliff, pine, river and boat.
- `Seasons.tsx` layers the weather on top every frame, from four functions:
  `drawSpring` (blossoms bloom with a wet edge, petals drift), `drawMonsoon` (clouds spread behind a ragged
  front, rain and river ripples), `drawAutumn` (tumbling leaves, the sun sinks), `drawWinter` (snow accumulates
  down the slopes in streaks).
- Timing lives in the `T` object at the top of `Seasons.tsx`.
