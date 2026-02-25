// src/lib/ui/sound/play-sound.ts
// Svelte action: クリック時にサウンドを再生
// 使い方: <button use:playSound={'tap'}>ボタン</button>

import type { Action } from 'svelte/action';
import { soundService } from './sound-service';
import type { SoundId } from './sounds';

export const playSound: Action<HTMLElement, SoundId> = (node, soundId) => {
	let currentSoundId = soundId;

	function handleClick() {
		soundService.ensureContext();
		soundService.play(currentSoundId);
	}

	node.addEventListener('click', handleClick);

	return {
		update(newSoundId: SoundId) {
			currentSoundId = newSoundId;
		},
		destroy() {
			node.removeEventListener('click', handleClick);
		},
	};
};
