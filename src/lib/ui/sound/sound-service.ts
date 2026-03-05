// src/lib/ui/sound/sound-service.ts
// Web Audio API ベースのサウンド再生サービス

import type { UiMode } from '$lib/domain/validation/age-tier';
import { SOUND_DEFS, SOUND_TIER_CONFIG, type SoundId } from './sounds';

export class SoundService {
	private context: AudioContext | null = null;
	private buffers: Map<SoundId, AudioBuffer> = new Map();
	private gainNode: GainNode | null = null;
	private _volume = 0.6;
	private _muted = false;
	private _enabledSounds: Set<SoundId> = new Set();
	private _preloading = false;

	/** AudioContext を遅延初期化（ユーザー操作後に呼出） */
	ensureContext(): void {
		if (this.context) return;
		if (typeof window === 'undefined') return;

		this.context = new AudioContext();
		this.gainNode = this.context.createGain();
		this.gainNode.gain.value = this._volume;
		this.gainNode.connect(this.context.destination);

		// suspended 状態の場合は resume
		if (this.context.state === 'suspended') {
			this.context.resume();
		}
	}

	/** サウンドをプリロード */
	async preload(soundIds: SoundId[]): Promise<void> {
		if (this._preloading) return;
		this._preloading = true;

		this.ensureContext();
		if (!this.context) {
			this._preloading = false;
			return;
		}

		const promises = soundIds.map(async (id) => {
			if (this.buffers.has(id)) return;

			const def = SOUND_DEFS[id];
			if (!def) return;

			try {
				const response = await fetch(def.path);
				if (!response.ok) return;
				const arrayBuffer = await response.arrayBuffer();
				const audioBuffer = await this.context?.decodeAudioData(arrayBuffer);
				if (!audioBuffer) return;
				this.buffers.set(id, audioBuffer);
			} catch {
				// File not found or decode error — silent fallback
			}
		});

		await Promise.allSettled(promises);
		this._preloading = false;
	}

	/** サウンドを再生 */
	play(soundId: SoundId): void {
		if (this._muted) return;
		if (!this.context || !this.gainNode) {
			this.ensureContext();
			if (!this.context || !this.gainNode) return;
		}
		if (this._enabledSounds.size > 0 && !this._enabledSounds.has(soundId)) return;

		const buffer = this.buffers.get(soundId);
		if (!buffer) return;

		const ctx = this.context;
		const gain = this.gainNode;

		const doPlay = () => {
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(gain);
			source.start(0);
		};

		// suspended 状態の場合は resume 完了後に再生
		if (ctx.state === 'suspended') {
			ctx.resume().then(doPlay);
		} else {
			doPlay();
		}
	}

	/** 音量設定 (0.0 - 1.0) */
	setVolume(volume: number): void {
		this._volume = Math.max(0, Math.min(1, volume));
		if (this.gainNode) {
			this.gainNode.gain.value = this._volume;
		}
	}

	/** 音量取得 */
	getVolume(): number {
		return this._volume;
	}

	/** ミュート設定 */
	setMuted(muted: boolean): void {
		this._muted = muted;
	}

	/** ミュート取得 */
	getMuted(): boolean {
		return this._muted;
	}

	/** 有効サウンドを設定 */
	setEnabledSounds(sounds: SoundId[]): void {
		this._enabledSounds = new Set(sounds);
	}

	/** 有効サウンドを取得 */
	getEnabledSounds(): SoundId[] {
		return [...this._enabledSounds];
	}

	/** 年齢帯に応じて音量・有効サウンドを一括設定 */
	configure(uiMode: UiMode): void {
		const config = SOUND_TIER_CONFIG[uiMode];
		this.setVolume(config.defaultVolume);
		this.setEnabledSounds(config.enabledSounds);
	}

	/** AudioContext を破棄 */
	destroy(): void {
		if (this.context) {
			this.context.close();
			this.context = null;
			this.gainNode = null;
		}
		this.buffers.clear();
	}
}

/** シングルトンインスタンス */
export const soundService = new SoundService();
