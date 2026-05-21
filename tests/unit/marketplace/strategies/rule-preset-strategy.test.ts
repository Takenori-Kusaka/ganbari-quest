/**
 * tests/unit/marketplace/strategies/rule-preset-strategy.test.ts
 *
 * rule-preset ImportStrategy unit tests — Issue #2368 / ADR-0052 P3
 *
 * 検証 (Strategy 内部 sub-dispatcher 4 ruleType 全網羅):
 *   - parse() の Valibot validation
 *   - exchange:   special_rewards 挿入 + sourcePresetId 重複検知 + childId 必須
 *   - bonus:      settings KVS state 追記 + 重複 presetId skip + bonus-hook 連動
 *   - penalty:    ADR-0012 §6 意図的 no-op (imported=0 / warnings 1 件 / audit log 記録)
 *   - special:    将来枠 no-op (imported=0 / warnings 1 件 / audit log 記録)
 *   - tenant isolation: ctx.tenantId が全 sub-strategy に伝播
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks (settings repo + special-reward repo + logger) ----------

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockFindSpecialRewards = vi.fn();
const mockInsertSpecialReward = vi.fn();

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

vi.mock('$lib/server/db/special-reward-repo', () => ({
	findSpecialRewards: (...args: unknown[]) => mockFindSpecialRewards(...args),
	insertSpecialReward: (...args: unknown[]) => mockInsertSpecialReward(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import { loadBonusOverrides } from '../../../../src/lib/marketplace/strategies/rule-preset/bonus-state';
import { rulePresetStrategy } from '../../../../src/lib/marketplace/strategies/rule-preset-strategy';

const TENANT = 'test-tenant-001';
const PRESET_ID = 'streak-bonus';
const IDENTITY = {
	presetId: PRESET_ID,
	presetName: '連続ボーナス',
	presetIcon: '🔥',
};

function makeBonusPayload(overrides: Record<string, unknown> = {}) {
	return {
		ruleType: 'bonus' as const,
		rules: [
			{
				title: '3日連続ボーナス',
				description: '3日連続で記録するとボーナス',
				icon: '🔥',
				pointBonus: 10,
			},
		],
		...overrides,
	};
}

function makeExchangePayload() {
	return {
		ruleType: 'exchange' as const,
		rules: [
			{
				title: 'アイス交換',
				description: 'アイスと交換',
				icon: '🍦',
				pointCost: 50,
			},
		],
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetSetting.mockResolvedValue(null);
	mockSetSetting.mockResolvedValue(undefined);
	mockFindSpecialRewards.mockResolvedValue([]);
	mockInsertSpecialReward.mockResolvedValue({ id: 1 });
});

// =====================================================
// parse()
// =====================================================

describe('rulePresetStrategy.parse', () => {
	it('有効な bonus payload を parse して同等 object を返す', () => {
		const input = makeBonusPayload();
		const result = rulePresetStrategy.parse(input);
		expect(result.ruleType).toBe('bonus');
		expect(result.rules).toHaveLength(1);
	});

	it('ruleType が RULE_TYPES 外なら error throw', () => {
		expect(() => rulePresetStrategy.parse({ ruleType: 'unknown', rules: [] })).toThrow(/ruleType/);
	});

	it('rules が空配列なら error throw', () => {
		expect(() => rulePresetStrategy.parse({ ruleType: 'bonus', rules: [] })).toThrow(/rules/);
	});

	it('title が空文字なら error throw', () => {
		const input = {
			ruleType: 'bonus',
			rules: [{ title: '', description: 'x', icon: '🔥', pointBonus: 5 }],
		};
		expect(() => rulePresetStrategy.parse(input)).toThrow();
	});
});

// =====================================================
// exchange ruleType
// =====================================================

describe('rulePresetStrategy.applyRulePreset — exchange', () => {
	it('childId 必須: 未指定なら errors で fail-fast', async () => {
		const result = await rulePresetStrategy.applyRulePreset(IDENTITY, makeExchangePayload(), {
			tenantId: TENANT,
		});
		expect(result.imported).toBe(0);
		expect(result.errors[0]).toMatch(/childId が必要/);
	});

	it('special_rewards に rule を挿入し imported=1 を返す', async () => {
		const result = await rulePresetStrategy.applyRulePreset(IDENTITY, makeExchangePayload(), {
			tenantId: TENANT,
			childId: 42,
		});
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
		expect(mockInsertSpecialReward).toHaveBeenCalledOnce();
		const [insertedRow, tenantArg] = mockInsertSpecialReward.mock.calls[0]!;
		expect(insertedRow.childId).toBe(42);
		expect(insertedRow.points).toBe(50); // pointCost → points
		expect(insertedRow.sourcePresetId).toBe(PRESET_ID);
		expect(tenantArg).toBe(TENANT); // tenant isolation 伝播
	});

	it('同 sourcePresetId + 同 title が既存なら skipped++', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			{ id: 1, title: 'アイス交換', sourcePresetId: PRESET_ID },
		]);
		const result = await rulePresetStrategy.applyRulePreset(IDENTITY, makeExchangePayload(), {
			tenantId: TENANT,
			childId: 42,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});
});

describe('rulePresetStrategy.previewRulePreset — exchange', () => {
	it('alreadyImported=true: 同 sourcePresetId が存在する', async () => {
		mockFindSpecialRewards.mockResolvedValue([{ id: 1, sourcePresetId: PRESET_ID }]);
		const result = await rulePresetStrategy.previewRulePreset(IDENTITY, makeExchangePayload(), {
			tenantId: TENANT,
			childId: 42,
		});
		expect(result.alreadyImported).toBe(true);
		expect(result.ruleType).toBe('exchange');
	});

	it('childId 未指定なら alreadyImported=false (preview のみは fail しない)', async () => {
		const result = await rulePresetStrategy.previewRulePreset(IDENTITY, makeExchangePayload(), {
			tenantId: TENANT,
		});
		expect(result.alreadyImported).toBe(false);
	});
});

// =====================================================
// bonus ruleType (+ bonus-hook-service 連動の確認)
// =====================================================

describe('rulePresetStrategy.applyRulePreset — bonus', () => {
	it('settings KVS に preset を追記して imported=1', async () => {
		const result = await rulePresetStrategy.applyRulePreset(IDENTITY, makeBonusPayload(), {
			tenantId: TENANT,
		});
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
		expect(mockSetSetting).toHaveBeenCalledOnce();
		const [key, value, tenantArg] = mockSetSetting.mock.calls[0]!;
		expect(key).toBe('rule_preset_bonus_overrides');
		expect(tenantArg).toBe(TENANT);
		const parsed = JSON.parse(value);
		expect(parsed.presets[0].presetId).toBe(PRESET_ID);
		expect(parsed.presets[0].enabled).toBe(true);
		expect(parsed.presets[0].rules[0].pointBonus).toBe(10);
	});

	it('同 presetId が既存なら skipped=1 で no-op', async () => {
		mockGetSetting.mockResolvedValue(
			JSON.stringify({
				presets: [
					{
						presetId: PRESET_ID,
						presetName: '連続ボーナス',
						presetIcon: '🔥',
						enabled: true,
						rules: [],
						importedAt: '2026-01-01T00:00:00.000Z',
					},
				],
			}),
		);
		const result = await rulePresetStrategy.applyRulePreset(IDENTITY, makeBonusPayload(), {
			tenantId: TENANT,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('保存後 loadBonusOverrides() で bonus-hook-service が読み出せる形になる', async () => {
		// apply → setSetting に渡された JSON を mock storage として戻し、loadBonusOverrides で復元
		await rulePresetStrategy.applyRulePreset(IDENTITY, makeBonusPayload(), {
			tenantId: TENANT,
		});
		const savedJson = mockSetSetting.mock.calls[0]![1] as string;
		mockGetSetting.mockResolvedValue(savedJson);

		const state = await loadBonusOverrides(TENANT);
		expect(state.presets).toHaveLength(1);
		expect(state.presets[0]?.presetId).toBe(PRESET_ID);
		expect(state.presets[0]?.rules[0]?.pointBonus).toBe(10);
	});
});

describe('rulePresetStrategy.previewRulePreset — bonus', () => {
	it('alreadyImported=true: settings KVS に同 presetId が存在する', async () => {
		mockGetSetting.mockResolvedValue(
			JSON.stringify({
				presets: [
					{
						presetId: PRESET_ID,
						presetName: '',
						presetIcon: '',
						enabled: true,
						rules: [],
						importedAt: '',
					},
				],
			}),
		);
		const result = await rulePresetStrategy.previewRulePreset(IDENTITY, makeBonusPayload(), {
			tenantId: TENANT,
		});
		expect(result.alreadyImported).toBe(true);
	});
});

// =====================================================
// penalty / special ruleType (ADR-0012 §6 意図的 no-op)
// =====================================================

describe('rulePresetStrategy.applyRulePreset — penalty (ADR-0012 §6 no-op)', () => {
	const penaltyPayload = {
		ruleType: 'penalty' as const,
		rules: [{ title: '減点', description: 'x', icon: '⚠️' }],
	};

	it('imported=0 / skipped=0 / warnings 1 件 (黒帽 game design 規制)', async () => {
		const result = await rulePresetStrategy.applyRulePreset(IDENTITY, penaltyPayload, {
			tenantId: TENANT,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/ADR-0012/);
		expect(result.errors).toHaveLength(0);
	});

	it('settings.rule_preset_import_warnings に audit log を append', async () => {
		await rulePresetStrategy.applyRulePreset(IDENTITY, penaltyPayload, { tenantId: TENANT });
		const warningWrite = mockSetSetting.mock.calls.find(
			(c) => c[0] === 'rule_preset_import_warnings',
		);
		expect(warningWrite).toBeDefined();
		const [, value, tenantArg] = warningWrite!;
		expect(tenantArg).toBe(TENANT);
		const parsed = JSON.parse(value);
		expect(parsed[0].ruleType).toBe('penalty');
		expect(parsed[0].presetId).toBe(PRESET_ID);
	});
});

describe('rulePresetStrategy.applyRulePreset — special (将来枠 no-op)', () => {
	const specialPayload = {
		ruleType: 'special' as const,
		rules: [{ title: '将来枠', description: 'x', icon: '✨' }],
	};

	it('imported=0 / warnings 1 件 + audit log', async () => {
		const result = await rulePresetStrategy.applyRulePreset(IDENTITY, specialPayload, {
			tenantId: TENANT,
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.warnings[0]).toMatch(/将来枠/);

		const warningWrite = mockSetSetting.mock.calls.find(
			(c) => c[0] === 'rule_preset_import_warnings',
		);
		expect(warningWrite).toBeDefined();
		const parsed = JSON.parse(warningWrite![1] as string);
		expect(parsed[0].ruleType).toBe('special');
	});
});

// =====================================================
// dryRun 等価動作
// =====================================================

describe('rulePresetStrategy.applyRulePreset — dryRun', () => {
	it('dryRun=true なら DB write せず空結果を返す (4 ruleType 全て)', async () => {
		for (const ruleType of ['bonus', 'exchange', 'penalty', 'special'] as const) {
			vi.clearAllMocks();
			mockGetSetting.mockResolvedValue(null);
			const payload = { ruleType, rules: [{ title: 't', description: 'd', icon: 'i' }] };
			const result = await rulePresetStrategy.applyRulePreset(IDENTITY, payload, {
				tenantId: TENANT,
				childId: 42,
				dryRun: true,
			});
			expect(result.imported).toBe(0);
			expect(result.skipped).toBe(0);
			expect(mockInsertSpecialReward).not.toHaveBeenCalled();
			expect(mockSetSetting).not.toHaveBeenCalled();
		}
	});
});
