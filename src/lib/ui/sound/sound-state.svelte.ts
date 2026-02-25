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

/** 現在の設定を localStorage に保存 */
function saveSoundSettings(): void {
	if (typeof window === 'undefined') return;

	try {
		localStorage.setItem(STORAGE_KEY_VOLUME, String(volume));
		localStorage.setItem(STORAGE_KEY_MUTED, String(muted));
	} catch {
		// localStorage unavailable — ignore
	}
}

export function getSoundVolume(): number {
	return volume;
}

export function setSoundVolume(v: number): void {
	volume = Math.max(0, Math.min(1, v));
	soundService.setVolume(volume);
	saveSoundSettings();
}

export function getSoundMuted(): boolean {
	return muted;
}

export function setSoundMuted(m: boolean): void {
	muted = m;
	soundService.setMuted(muted);
	saveSoundSettings();
}
