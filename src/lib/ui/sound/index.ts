// src/lib/ui/sound/index.ts
// サウンドモジュール公開API

// biome-ignore lint/performance/noBarrelFile: 既存コード、別Issueで対応予定
export { playSound } from './play-sound';
export { SoundService, soundService } from './sound-service';
export { loadSoundSettings } from './sound-state.svelte';
export { SOUND_TIER_CONFIG } from './sounds';
