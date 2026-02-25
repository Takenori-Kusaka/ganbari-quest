// src/lib/ui/sound/index.ts
// サウンドモジュール公開API

export { playSound } from './play-sound';
export { SoundService, soundService } from './sound-service';
export {
	getSoundMuted,
	getSoundVolume,
	loadSoundSettings,
	setSoundMuted,
	setSoundVolume,
} from './sound-state.svelte';
export { SOUND_DEFS, SOUND_IDS, SOUND_TIER_CONFIG } from './sounds';
export type { SoundId, SoundTierConfig } from './sounds';
