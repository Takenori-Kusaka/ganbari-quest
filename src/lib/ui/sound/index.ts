// src/lib/ui/sound/index.ts
// サウンドモジュール公開API

// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { playSound } from './play-sound';
export { SoundService, soundService } from './sound-service';
export { loadSoundSettings } from './sound-state.svelte';
export { SOUND_TIER_CONFIG } from './sounds';
