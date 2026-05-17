// tests/unit/services/rule-preset-import-service.test.ts
// #2138 MP-3: rule-preset-import-service unit tests
//
// 4 ruleType 全分岐 (exchange / bonus / penalty / special) と
// 重複検出 / KVS 読み書き / penalty audit log を検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RulePresetPayload } from '../../../src/lib/domain/marketplace-item';

// ---------- Top-level mocks ----------

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockGetSettings = vi.fn();
const mockFindSpecialRewards = vi.fn();
const mockInsertSpecialReward = vi.fn();

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
	getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

vi.mock('$lib/server/db/special-reward-repo', () => ({
	findSpecialRewards: (...args: unknown[]) => mockFindSpecialRewards(...args),
	insertSpecialReward: (...args: unknown[]) => mockInsertSpecialReward(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	BONUS_OVERRIDES_KEY,
	importRulePreset,
	loadBonusOverrides,
	previewRulePresetImport,
	RULE_PRESET_WARNINGS_KEY,
	removeBonusPreset,
	saveBonusOverrides,
	setBonusPresetEnabled,
} from '../../../src/lib/server/services/rule-preset-import-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-001';
const CHILD_ID = 101;

function bonusPayload(): RulePresetPayload {
	return {
		ruleType: 'bonus',
		rules: [
			{ title: '3にちれんぞくボーナス', description: '', icon: '🔥', pointBonus: 10 },
			{ title: '7にちれんぞくボーナス', description: '', icon: '🔥', pointBonus: 30 },
		],
	};
}

function exchangePayload(): RulePresetPayload {
	return {
		ruleType: 'exchange',
		rules: [
			{ title: 'ゲーム15分', description: '', icon: '🎮', pointCost: 15 },
			{ title: 'YouTube15分', description: '', icon: '▶️', pointCost: 15 },
		],
	};
}

function penaltyPayload(): RulePresetPayload {
	return {
		ruleType: 'penalty',
		rules: [{ title: '遅刻ペナルティ', description: '', icon: '⏰', pointCost: 5 }],
	};
}

function specialPayload(): RulePresetPayload {
	return {
		ruleType: 'special',
		rules: [{ title: 'スペシャルルール', description: '将来枠', icon: '🌟' }],
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetSetting.mockResolvedValue(null);
	mockSetSetting.mockResolvedValue(undefined);
	mockFindSpecialRewards.mockResolvedValue([]);
	mockInsertSpecialReward.mockResolvedValue({ id: 1 });
});

// ==========================================================
// previewRulePresetImport (AC1 ruleType 分岐)
// ==========================================================

describe('previewRulePresetImport', () => {
	it('bonus 未取込 -> alreadyImported=false', async () => {
		const r = await previewRulePresetImport(
			'streak-bonus',
			'ストリーク',
			'🔥',
			bonusPayload(),
			TENANT,
		);
		expect(r.ruleType).toBe('bonus');
		expect(r.alreadyImported).toBe(false);
		expect(r.ruleCount).toBe(2);
	});

	it('bonus 取込済 -> alreadyImported=true', async () => {
		mockGetSetting.mockResolvedValueOnce(
			JSON.stringify({
				presets: [
					{
						presetId: 'streak-bonus',
						presetName: 'ストリーク',
						presetIcon: '🔥',
						enabled: true,
						rules: [],
						importedAt: '2026-05-01T00:00:00Z',
					},
				],
			}),
		);
		const r = await previewRulePresetImport(
			'streak-bonus',
			'ストリーク',
			'🔥',
			bonusPayload(),
			TENANT,
		);
		expect(r.alreadyImported).toBe(true);
	});

	it('exchange + 同一 sourcePresetId reward 存在 -> alreadyImported=true', async () => {
		mockFindSpecialRewards.mockResolvedValueOnce([
			{ id: 1, title: 'ゲーム15分', sourcePresetId: 'screen-time-exchange' } as never,
		]);
		const r = await previewRulePresetImport(
			'screen-time-exchange',
			'スクリーンタイム交換',
			'📱',
			exchangePayload(),
			TENANT,
			CHILD_ID,
		);
		expect(r.alreadyImported).toBe(true);
	});

	it('penalty -> 常に alreadyImported=false', async () => {
		const r = await previewRulePresetImport(
			'penalty-1',
			'ペナルティ',
			'⏰',
			penaltyPayload(),
			TENANT,
		);
		expect(r.alreadyImported).toBe(false);
		expect(r.ruleType).toBe('penalty');
	});

	it('special -> 常に alreadyImported=false', async () => {
		const r = await previewRulePresetImport(
			'special-1',
			'スペシャル',
			'🌟',
			specialPayload(),
			TENANT,
		);
		expect(r.alreadyImported).toBe(false);
		expect(r.ruleType).toBe('special');
	});
});

// ==========================================================
// importRulePreset - bonus
// ==========================================================

describe('importRulePreset - bonus', () => {
	it('未取込 bonus -> settings KVS に追加 + imported=1', async () => {
		const r = await importRulePreset('streak-bonus', 'ストリーク', '🔥', bonusPayload(), TENANT);
		expect(r.imported).toBe(1);
		expect(r.skipped).toBe(0);
		expect(r.errors).toEqual([]);
		expect(mockSetSetting).toHaveBeenCalledWith(BONUS_OVERRIDES_KEY, expect.any(String), TENANT);

		const saved = JSON.parse(mockSetSetting.mock.calls[0]?.[1] as string);
		expect(saved.presets).toHaveLength(1);
		expect(saved.presets[0].presetId).toBe('streak-bonus');
		expect(saved.presets[0].enabled).toBe(true);
		expect(saved.presets[0].rules).toHaveLength(2);
	});

	it('既取込 bonus -> skipped=1', async () => {
		mockGetSetting.mockResolvedValueOnce(
			JSON.stringify({
				presets: [
					{
						presetId: 'streak-bonus',
						presetName: 'old',
						presetIcon: '🔥',
						enabled: true,
						rules: [],
						importedAt: '2026-01-01',
					},
				],
			}),
		);
		const r = await importRulePreset('streak-bonus', 'ストリーク', '🔥', bonusPayload(), TENANT);
		expect(r.imported).toBe(0);
		expect(r.skipped).toBe(1);
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('saveBonusOverrides の例外 -> errors に記録', async () => {
		mockSetSetting.mockRejectedValueOnce(new Error('disk full'));
		const r = await importRulePreset('streak-bonus', 'ストリーク', '🔥', bonusPayload(), TENANT);
		expect(r.imported).toBe(0);
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toContain('disk full');
	});
});

// ==========================================================
// importRulePreset - exchange
// ==========================================================

describe('importRulePreset - exchange', () => {
	it('exchange + childId 指定 -> 各 rule を special_rewards に挿入', async () => {
		const r = await importRulePreset(
			'screen-time-exchange',
			'スクリーンタイム交換',
			'📱',
			exchangePayload(),
			TENANT,
			{ childId: CHILD_ID },
		);
		expect(r.imported).toBe(2);
		expect(r.skipped).toBe(0);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(2);

		const firstCall = mockInsertSpecialReward.mock.calls[0]?.[0];
		expect(firstCall?.sourcePresetId).toBe('screen-time-exchange');
		expect(firstCall?.category).toBe('rule-preset-exchange');
		expect(firstCall?.points).toBe(15); // pointCost
	});

	it('exchange + childId 未指定 -> errors 記録 & imported=0', async () => {
		const r = await importRulePreset(
			'screen-time-exchange',
			'スクリーンタイム交換',
			'📱',
			exchangePayload(),
			TENANT,
		);
		expect(r.imported).toBe(0);
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toContain('childId');
	});

	it('同一 preset + 同一 title 既存 -> skipped カウント', async () => {
		mockFindSpecialRewards.mockResolvedValueOnce([
			{ id: 1, title: 'ゲーム15分', sourcePresetId: 'screen-time-exchange' } as never,
		]);
		const r = await importRulePreset(
			'screen-time-exchange',
			'スクリーンタイム交換',
			'📱',
			exchangePayload(),
			TENANT,
			{ childId: CHILD_ID },
		);
		expect(r.imported).toBe(1);
		expect(r.skipped).toBe(1);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(1);
	});

	it('insertSpecialReward 例外 -> errors に記録、処理は続行', async () => {
		mockInsertSpecialReward
			.mockRejectedValueOnce(new Error('constraint'))
			.mockResolvedValueOnce({ id: 2 });
		const r = await importRulePreset(
			'screen-time-exchange',
			'スクリーンタイム交換',
			'📱',
			exchangePayload(),
			TENANT,
			{ childId: CHILD_ID },
		);
		expect(r.imported).toBe(1);
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toContain('ゲーム15分');
	});
});

// ==========================================================
// importRulePreset - penalty / special (AC4)
// ==========================================================

describe('importRulePreset - penalty/special (ADR-0012 §6)', () => {
	it('penalty -> imported=0 + warnings に reason + audit log 記録', async () => {
		const r = await importRulePreset('penalty-1', 'ペナルティ', '⏰', penaltyPayload(), TENANT);
		expect(r.imported).toBe(0);
		expect(r.skipped).toBe(0);
		expect(r.warnings).toHaveLength(1);
		expect(r.warnings[0]).toContain('penalty');
		expect(r.warnings[0]).toContain('ADR-0012');

		// audit log への記録 (setSetting が rule_preset_import_warnings キーで呼ばれる)
		const warningCalls = mockSetSetting.mock.calls.filter((c) => c[0] === RULE_PRESET_WARNINGS_KEY);
		expect(warningCalls.length).toBeGreaterThan(0);
		const saved = JSON.parse(warningCalls[0]?.[1] as string);
		expect(saved).toHaveLength(1);
		expect(saved[0].ruleType).toBe('penalty');
		expect(saved[0].presetId).toBe('penalty-1');
	});

	it('special -> imported=0 + warnings + audit log 記録', async () => {
		const r = await importRulePreset('special-1', 'スペシャル', '🌟', specialPayload(), TENANT);
		expect(r.imported).toBe(0);
		expect(r.warnings).toHaveLength(1);
		expect(r.warnings[0]).toContain('special');
		const saved = JSON.parse(
			mockSetSetting.mock.calls.find((c) => c[0] === RULE_PRESET_WARNINGS_KEY)?.[1] as string,
		);
		expect(saved[0].ruleType).toBe('special');
	});

	it('penalty 複数回試行 -> audit log が累積', async () => {
		// 1 回目
		await importRulePreset('penalty-1', 'A', '⏰', penaltyPayload(), TENANT);
		// 2 回目 (前回の audit log を mock で返す)
		const firstSaved = mockSetSetting.mock.calls.find(
			(c) => c[0] === RULE_PRESET_WARNINGS_KEY,
		)?.[1];
		mockGetSetting.mockImplementation((key: string) => {
			if (key === RULE_PRESET_WARNINGS_KEY) return Promise.resolve(firstSaved);
			return Promise.resolve(null);
		});
		mockSetSetting.mockClear();
		await importRulePreset('penalty-2', 'B', '⏰', penaltyPayload(), TENANT);

		const secondCall = mockSetSetting.mock.calls.find((c) => c[0] === RULE_PRESET_WARNINGS_KEY);
		const saved = JSON.parse(secondCall?.[1] as string);
		expect(saved).toHaveLength(2);
		expect(saved[0].presetId).toBe('penalty-1');
		expect(saved[1].presetId).toBe('penalty-2');
	});
});

// ==========================================================
// loadBonusOverrides / saveBonusOverrides
// ==========================================================

describe('loadBonusOverrides / saveBonusOverrides', () => {
	it('未設定 -> 空 state', async () => {
		const state = await loadBonusOverrides(TENANT);
		expect(state).toEqual({ presets: [] });
	});

	it('不正 JSON -> 空 state にフォールバック', async () => {
		mockGetSetting.mockResolvedValueOnce('not-a-json');
		const state = await loadBonusOverrides(TENANT);
		expect(state).toEqual({ presets: [] });
	});

	it('正しい JSON -> parse 結果', async () => {
		mockGetSetting.mockResolvedValueOnce(
			JSON.stringify({
				presets: [
					{
						presetId: 'a',
						presetName: 'A',
						presetIcon: '🔥',
						enabled: true,
						rules: [],
						importedAt: '2026',
					},
				],
			}),
		);
		const state = await loadBonusOverrides(TENANT);
		expect(state.presets).toHaveLength(1);
		expect(state.presets[0]?.presetId).toBe('a');
	});

	it('saveBonusOverrides -> setSetting が呼ばれる', async () => {
		await saveBonusOverrides({ presets: [] }, TENANT);
		expect(mockSetSetting).toHaveBeenCalledWith(BONUS_OVERRIDES_KEY, '{"presets":[]}', TENANT);
	});
});

// ==========================================================
// setBonusPresetEnabled / removeBonusPreset
// ==========================================================

describe('setBonusPresetEnabled / removeBonusPreset', () => {
	it('setBonusPresetEnabled -> 既存 preset の enabled を切替', async () => {
		mockGetSetting.mockResolvedValueOnce(
			JSON.stringify({
				presets: [
					{
						presetId: 'a',
						presetName: 'A',
						presetIcon: '🔥',
						enabled: true,
						rules: [],
						importedAt: '2026',
					},
				],
			}),
		);
		await setBonusPresetEnabled('a', false, TENANT);
		const saved = JSON.parse(mockSetSetting.mock.calls[0]?.[1] as string);
		expect(saved.presets[0].enabled).toBe(false);
	});

	it('setBonusPresetEnabled - 存在しない preset -> no-op (setSetting 呼ばれない)', async () => {
		mockGetSetting.mockResolvedValueOnce(JSON.stringify({ presets: [] }));
		await setBonusPresetEnabled('a', false, TENANT);
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('removeBonusPreset -> 該当 preset を除去', async () => {
		mockGetSetting.mockResolvedValueOnce(
			JSON.stringify({
				presets: [
					{
						presetId: 'a',
						presetName: 'A',
						presetIcon: '🔥',
						enabled: true,
						rules: [],
						importedAt: '2026',
					},
					{
						presetId: 'b',
						presetName: 'B',
						presetIcon: '🌟',
						enabled: true,
						rules: [],
						importedAt: '2026',
					},
				],
			}),
		);
		await removeBonusPreset('a', TENANT);
		const saved = JSON.parse(mockSetSetting.mock.calls[0]?.[1] as string);
		expect(saved.presets).toHaveLength(1);
		expect(saved.presets[0].presetId).toBe('b');
	});

	it('removeBonusPreset - 存在しない -> no-op', async () => {
		mockGetSetting.mockResolvedValueOnce(JSON.stringify({ presets: [] }));
		await removeBonusPreset('a', TENANT);
		expect(mockSetSetting).not.toHaveBeenCalled();
	});
});
