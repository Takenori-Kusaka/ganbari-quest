// src/lib/ui/sound/sound-state.svelte.ts
// サウンド設定の状態管理 + localStorage 永続化

import { soundService } from './sound-service';

const STORAGE_KEY_VOLUME = 'ganbari-sound-volume';
const STORAGE_KEY_MUTED = 'ganbari-sound-muted';

let volume = $state(0.6);
let muted = $state(false);

/** localStorage からサウンド設定を読み込み、soundService に反映 */
export function loadSoundSettings(): void {
	if (typeof window === 'undefined') return;

	try {
		const storedVolume = localStorage.getItem(STORAGE_KEY_VOLUME);
		if (storedVolume !== null) {
			const parsed = Number.parseFloat(storedVolume);
			if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
				volume = parsed;
			}
		}

		const storedMuted = localStorage.getItem(STORAGE_KEY_MUTED);
		if (storedMuted !== null) {
			muted = storedMuted === 'true';
		}
	} catch {
		// localStorage unavailable — use defaults
	}

	soundService.setVolume(volume);
	soundService.setMuted(muted);
}
