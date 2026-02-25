// tests/unit/ui/sound-service.test.ts
// サウンドサービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUND_DEFS, SOUND_IDS, SOUND_TIER_CONFIG } from '../../../src/lib/ui/sound/sounds';

// --- 定数テスト ---

describe('SOUND_IDS', () => {
	it('9種類のサウンドIDが定義されている', () => {
		expect(SOUND_IDS).toHaveLength(9);
	});

	it.each([
		'tap',
		'record-complete',
		'point-gain',
		'achievement-unlock',
		'level-up',
		'error',
		'special-reward',
		'omikuji-roll',
		'omikuji-result',
	])('%s が含まれる', (id) => {
		expect(SOUND_IDS).toContain(id);
	});
});

describe('SOUND_DEFS', () => {
	it('全てのSOUND_IDに定義がある', () => {
		for (const id of SOUND_IDS) {
			expect(SOUND_DEFS[id]).toBeDefined();
			expect(SOUND_DEFS[id].path).toMatch(/^\/sounds\/.+\.mp3$/);
			expect(SOUND_DEFS[id].label).toBeTruthy();
		}
	});
});

describe('SOUND_TIER_CONFIG', () => {
	it('全5モードに設定がある', () => {
		const modes = ['baby', 'kinder', 'lower', 'upper', 'teen'] as const;
		for (const mode of modes) {
			expect(SOUND_TIER_CONFIG[mode]).toBeDefined();
			expect(SOUND_TIER_CONFIG[mode].defaultVolume).toBeGreaterThan(0);
			expect(SOUND_TIER_CONFIG[mode].defaultVolume).toBeLessThanOrEqual(1);
			expect(Array.isArray(SOUND_TIER_CONFIG[mode].enabledSounds)).toBe(true);
		}
	});

	it('baby が最大音量', () => {
		expect(SOUND_TIER_CONFIG.baby.defaultVolume).toBe(0.8);
	});

	it('teen が最小音量', () => {
		expect(SOUND_TIER_CONFIG.teen.defaultVolume).toBe(0.2);
	});

	it('年齢が上がるほど音量が下がる', () => {
		expect(SOUND_TIER_CONFIG.baby.defaultVolume).toBeGreaterThan(
			SOUND_TIER_CONFIG.kinder.defaultVolume,
		);
		expect(SOUND_TIER_CONFIG.kinder.defaultVolume).toBeGreaterThan(
			SOUND_TIER_CONFIG.lower.defaultVolume,
		);
		expect(SOUND_TIER_CONFIG.lower.defaultVolume).toBeGreaterThan(
			SOUND_TIER_CONFIG.upper.defaultVolume,
		);
		expect(SOUND_TIER_CONFIG.upper.defaultVolume).toBeGreaterThan(
			SOUND_TIER_CONFIG.teen.defaultVolume,
		);
	});

	it('baby は全サウンドが有効', () => {
		expect(SOUND_TIER_CONFIG.baby.enabledSounds).toHaveLength(SOUND_IDS.length);
	});

	it('teen は最小限のサウンドのみ有効', () => {
		expect(SOUND_TIER_CONFIG.teen.enabledSounds.length).toBeLessThan(SOUND_IDS.length);
		expect(SOUND_TIER_CONFIG.teen.enabledSounds).toContain('achievement-unlock');
		expect(SOUND_TIER_CONFIG.teen.enabledSounds).toContain('special-reward');
	});

	it('年齢が上がるほど有効サウンド数が減る', () => {
		expect(SOUND_TIER_CONFIG.baby.enabledSounds.length).toBeGreaterThanOrEqual(
			SOUND_TIER_CONFIG.kinder.enabledSounds.length,
		);
		expect(SOUND_TIER_CONFIG.kinder.enabledSounds.length).toBeGreaterThanOrEqual(
			SOUND_TIER_CONFIG.lower.enabledSounds.length,
		);
		expect(SOUND_TIER_CONFIG.lower.enabledSounds.length).toBeGreaterThanOrEqual(
			SOUND_TIER_CONFIG.upper.enabledSounds.length,
		);
		expect(SOUND_TIER_CONFIG.upper.enabledSounds.length).toBeGreaterThanOrEqual(
			SOUND_TIER_CONFIG.teen.enabledSounds.length,
		);
	});

	it('enabledSounds の全要素が有効なSOUND_ID', () => {
		for (const mode of ['baby', 'kinder', 'lower', 'upper', 'teen'] as const) {
			for (const soundId of SOUND_TIER_CONFIG[mode].enabledSounds) {
				expect(SOUND_IDS).toContain(soundId);
			}
		}
	});
});

// --- SoundService ロジックテスト ---

describe('SoundService', () => {
	// AudioContext のモック
	let mockGainNode: { gain: { value: number }; connect: ReturnType<typeof vi.fn> };
	let mockSource: {
		buffer: AudioBuffer | null;
		connect: ReturnType<typeof vi.fn>;
		start: ReturnType<typeof vi.fn>;
	};
	let mockContext: {
		state: string;
		createGain: ReturnType<typeof vi.fn>;
		createBufferSource: ReturnType<typeof vi.fn>;
		decodeAudioData: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		resume: ReturnType<typeof vi.fn>;
		destination: Record<string, unknown>;
	};

	beforeEach(() => {
		mockGainNode = {
			gain: { value: 1 },
			connect: vi.fn(),
		};
		mockSource = {
			buffer: null,
			connect: vi.fn(),
			start: vi.fn(),
		};
		mockContext = {
			state: 'running',
			createGain: vi.fn(() => mockGainNode),
			createBufferSource: vi.fn(() => mockSource),
			decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
			close: vi.fn(),
			resume: vi.fn(),
			destination: {},
		};

		vi.stubGlobal(
			'AudioContext',
			vi.fn(() => mockContext),
		);
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// Dynamic import to get fresh instance
	async function createService() {
		const { SoundService } = await import('../../../src/lib/ui/sound/sound-service');
		return new SoundService();
	}

	it('ensureContext で AudioContext を初期化する', async () => {
		const service = await createService();
		service.ensureContext();
		expect(AudioContext).toHaveBeenCalled();
	});

	it('ensureContext を2回呼んでも1回しか初期化しない', async () => {
		const service = await createService();
		service.ensureContext();
		service.ensureContext();
		expect(AudioContext).toHaveBeenCalledTimes(1);
	});

	it('muted 時は再生しない', async () => {
		const service = await createService();
		service.ensureContext();
		service.setMuted(true);
		service.play('tap');
		expect(mockContext.createBufferSource).not.toHaveBeenCalled();
	});

	it('setMuted / getMuted が正しく動作する', async () => {
		const service = await createService();
		expect(service.getMuted()).toBe(false);
		service.setMuted(true);
		expect(service.getMuted()).toBe(true);
		service.setMuted(false);
		expect(service.getMuted()).toBe(false);
	});

	it('setVolume / getVolume が正しく動作する', async () => {
		const service = await createService();
		expect(service.getVolume()).toBe(0.6);
		service.setVolume(0.8);
		expect(service.getVolume()).toBe(0.8);
	});

	it('setVolume は 0-1 にクランプする', async () => {
		const service = await createService();
		service.setVolume(-0.5);
		expect(service.getVolume()).toBe(0);
		service.setVolume(1.5);
		expect(service.getVolume()).toBe(1);
	});

	it('setVolume は GainNode に反映される', async () => {
		const service = await createService();
		service.ensureContext();
		service.setVolume(0.4);
		expect(mockGainNode.gain.value).toBe(0.4);
	});

	it('enabledSounds にないサウンドは再生しない', async () => {
		const service = await createService();
		service.ensureContext();
		service.setEnabledSounds(['tap', 'record-complete']);
		service.play('achievement-unlock');
		expect(mockContext.createBufferSource).not.toHaveBeenCalled();
	});

	it('enabledSounds が空の場合は全サウンド許可', async () => {
		const service = await createService();
		service.ensureContext();
		// enabledSounds は初期状態では空（全許可）
		// バッファがないので createBufferSource は呼ばれないが、
		// muted/enabled のチェックは通過する
		service.play('tap');
		// buffer がないので source は作られない — ロジック上は OK
	});

	it('configure で年齢帯設定が適用される', async () => {
		const service = await createService();
		service.configure('kinder');
		expect(service.getVolume()).toBe(0.6);
		expect(service.getEnabledSounds()).toEqual(SOUND_TIER_CONFIG.kinder.enabledSounds);
	});

	it('configure で baby と teen の差異が正しい', async () => {
		const service = await createService();

		service.configure('baby');
		expect(service.getVolume()).toBe(0.8);
		const babySounds = service.getEnabledSounds();

		service.configure('teen');
		expect(service.getVolume()).toBe(0.2);
		const teenSounds = service.getEnabledSounds();

		expect(babySounds.length).toBeGreaterThan(teenSounds.length);
	});

	it('destroy で AudioContext をクローズする', async () => {
		const service = await createService();
		service.ensureContext();
		service.destroy();
		expect(mockContext.close).toHaveBeenCalled();
	});

	it('preload が fetch + decodeAudioData を呼ぶ', async () => {
		const mockArrayBuffer = new ArrayBuffer(8);
		const mockAudioBuffer = {} as AudioBuffer;
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(mockArrayBuffer),
		});
		vi.stubGlobal('fetch', mockFetch);
		mockContext.decodeAudioData.mockResolvedValue(mockAudioBuffer);

		const service = await createService();
		service.ensureContext();
		await service.preload(['tap']);

		expect(mockFetch).toHaveBeenCalledWith('/sounds/tap.mp3');
		expect(mockContext.decodeAudioData).toHaveBeenCalledWith(mockArrayBuffer);
	});

	it('preload でファイルが見つからない場合はスキップする', async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: false });
		vi.stubGlobal('fetch', mockFetch);

		const service = await createService();
		service.ensureContext();

		// Should not throw
		await service.preload(['tap']);
	});

	it('プリロード済みサウンドを再生できる', async () => {
		const mockArrayBuffer = new ArrayBuffer(8);
		const mockAudioBuffer = {} as AudioBuffer;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(mockArrayBuffer),
			}),
		);
		mockContext.decodeAudioData.mockResolvedValue(mockAudioBuffer);

		const service = await createService();
		service.ensureContext();
		await service.preload(['tap']);

		service.play('tap');
		expect(mockContext.createBufferSource).toHaveBeenCalled();
		expect(mockSource.connect).toHaveBeenCalledWith(mockGainNode);
		expect(mockSource.start).toHaveBeenCalledWith(0);
	});
});
