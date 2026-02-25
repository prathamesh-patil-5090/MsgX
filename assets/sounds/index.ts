// ─── Ringtone Asset References ──────────────────────────────────────────────
//
// To add ringtone sounds:
// 1. Place your audio files in this directory (assets/sounds/)
//    - ringtone.mp3       → played on incoming call
//    - outgoing_ring.mp3  → played while waiting for callee to answer
//    - call_end.mp3       → played when a call ends (optional)
//
// 2. Uncomment the corresponding line below
//
// 3. Rebuild the app (npx expo run:android / npx expo run:ios)
//
// Supported formats: .mp3, .wav, .m4a, .aac
// Recommended: short loops (3-5 seconds) for ringtone/outgoing_ring
// ────────────────────────────────────────────────────────────────────────────

// Uncomment these lines once you've added the sound files:
// export const RINGTONE = require('./ringtone.mp3');
// export const OUTGOING_RING = require('./outgoing_ring.mp3');
// export const CALL_END = require('./call_end.mp3');

// Placeholder exports — the audio service checks for null/undefined
export const RINGTONE: number | null = null;
export const OUTGOING_RING: number | null = null;
export const CALL_END: number | null = null;
