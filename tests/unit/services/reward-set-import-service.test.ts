// tests/unit/services/reward-set-import-service.test.ts
// #2136 MP-1: reward-set-import-service unit tests
//
// activity-import-service.test.ts を template として横展開。
// 重複判定が「同一 sourcePresetId + 同一 title」の組であることを検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RewardSetItem } from '../../../src/lib/server/services/reward-set-import-service';

// ---------- Top-level mocks ----------

const mockFindSpecialRewards = vi.fn();
const mockInsertSpecialReward = vi.fn();

vi.mock('$lib/server/db/special-reward-repo', () => ({
	findSpecialRewards: (...args: unknown[]) => mockFindSpecialRewards(...args),
	insertSpecialReward: (...args: unknown[]) => mockInsertSpecialReward(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------- Import after mocks ----------

import {
	importRewardSet,
	previewRewardSetImport,
} from '../../../src/lib/server/services/reward-set-import-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-001';
const CHILD_ID = 101;
const PRESET_ID = 'kinder-rewards';

function makeReward(overrides: Partial<RewardSetItem> = {}): RewardSetItem {
	return {
		title: 'テストごほうび',
		points: 20,
		icon: '🎁',
		category: 'other',
		description: '説明',
		...overrides,
	};
}

function makeExistingRow(overrides: Record<string, unknown>) {
	return {
		id: 1,
		childId: CHILD_ID,
		grantedBy: null,
		title: 'もの',
		description: null,
		points: 10,
		icon: '🎁',
		category: 'other',
		grantedAt: '2026-05-01T00:00:00Z',
		shownAt: null,
		sourcePresetId: null,
		...overrides,
	};
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockFindSpecialRewards.mockResolvedValue([]);
	mockInsertSpecialReward.mockResolvedValue({ id: 1 });
});

// ==========================================================
// previewRewardSetImport
// ==========================================================

describe('previewRewardSetImport', () => {
	it('既存ごほうびなし -> 全て新規', async () => {
		const rewards = [
			makeReward({ title: 'こうえんで30ぷんあそぶ' }),
			makeReward({ title: 'おやつをえらべる' }),
			makeReward({ title: 'すきなえいがをみる' }),
		];

		const result = await previewRewardSetImport(rewards, PRESET_ID, CHILD_ID, TENANT);

		expect(result.total).toBe(3);
		expect(result.newRewards).toBe(3);
		expect(result.duplicates).toBe(0);
		expect(result.duplicateTitles).toEqual([]);
	});

	it('同一 sourcePresetId + 同一 title -> 重複扱い', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'こうえんで30ぷんあそぶ', sourcePresetId: PRESET_ID }),
			makeExistingRow({ title: 'おやつをえらべる', sourcePresetId: PRESET_ID }),
		]);

		const rewards = [
			makeReward({ title: 'こうえんで30ぷんあそぶ' }),
			makeReward({ title: 'おやつをえらべる' }),
			makeReward({ title: '新しい reward' }),
		];

		const result = await previewRewardSetImport(rewards, PRESET_ID, CHILD_ID, TENANT);

		expect(result.total).toBe(3);
		expect(result.newRewards).toBe(1);
		expect(result.duplicates).toBe(2);
		expect(result.duplicateTitles).toEqual(['こうえんで30ぷんあそぶ', 'おやつをえらべる']);
	});

	it('別 preset の同名 reward は重複扱いしない（誤検知防止）', async () => {
		// 別 preset (例: elementary-rewards) で同名 reward が登録済みでも、
		// 現在取込中の preset が kinder-rewards なら別物として扱う。
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'おやつをえらべる', sourcePresetId: 'elementary-rewards' }),
		]);

		const rewards = [makeReward({ title: 'おやつをえらべる' })];

		const result = await previewRewardSetImport(rewards, PRESET_ID, CHILD_ID, TENANT);

		expect(result.newRewards).toBe(1);
		expect(result.duplicates).toBe(0);
	});

	it('ユーザーが手動で作った同名 reward (sourcePresetId=null) は重複扱いしない', async () => {
		// ユーザーが /admin/rewards から手動で同名 reward を grant していても、
		// sourcePresetId が異なる（null）ので preset 取込は別物として扱う。
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'おやつをえらべる', sourcePresetId: null }),
		]);

		const rewards = [makeReward({ title: 'おやつをえらべる' })];

		const result = await previewRewardSetImport(rewards, PRESET_ID, CHILD_ID, TENANT);

		expect(result.newRewards).toBe(1);
		expect(result.duplicates).toBe(0);
	});

	it('空の入力 -> 全てゼロ', async () => {
		const result = await previewRewardSetImport([], PRESET_ID, CHILD_ID, TENANT);

		expect(result.total).toBe(0);
		expect(result.newRewards).toBe(0);
		expect(result.duplicates).toBe(0);
		expect(result.duplicateTitles).toEqual([]);
	});

	it('全て重複 -> newRewards が 0', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'A', sourcePresetId: PRESET_ID }),
			makeExistingRow({ title: 'B', sourcePresetId: PRESET_ID }),
		]);

		const rewards = [makeReward({ title: 'A' }), makeReward({ title: 'B' })];

		const result = await previewRewardSetImport(rewards, PRESET_ID, CHILD_ID, TENANT);

		expect(result.total).toBe(2);
		expect(result.newRewards).toBe(0);
		expect(result.duplicates).toBe(2);
	});

	it('childId と tenantId が findSpecialRewards に渡される', async () => {
		await previewRewardSetImport([], PRESET_ID, CHILD_ID, TENANT);

		expect(mockFindSpecialRewards).toHaveBeenCalledWith(CHILD_ID, TENANT);
	});
});

// ==========================================================
// importRewardSet
// ==========================================================

describe('importRewardSet', () => {
	it('全て新規 -> 全てインポートされる', async () => {
		const rewards = [
			makeReward({ title: 'こうえん', points: 20, icon: '🏞️', category: 'sports' }),
			makeReward({ title: 'おやつ', points: 15, icon: '🍭', category: 'other' }),
		];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(result.imported).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(2);
	});

	it('同一 preset の重複はスキップされる', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'こうえん', sourcePresetId: PRESET_ID }),
		]);

		const rewards = [makeReward({ title: 'こうえん' }), makeReward({ title: 'おやつ' })];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(1);
	});

	it('insertSpecialReward が例外をスロー -> エラー記録され処理継続', async () => {
		mockInsertSpecialReward
			.mockRejectedValueOnce(new Error('DB constraint violation'))
			.mockResolvedValueOnce({ id: 2 });

		const rewards = [
			makeReward({ title: '失敗する reward' }),
			makeReward({ title: '成功する reward' }),
		];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(result.imported).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('失敗する reward');
		expect(result.errors[0]).toContain('DB constraint violation');
		// #2830 AC4: reward-set は per-item try/catch のため failed = errors.length (1)。
		expect(result.failed).toBe(1);
	});

	it('#2830 負例: 全件成功 -> failed=0', async () => {
		const rewards = [makeReward({ title: 'a' }), makeReward({ title: 'b' })];
		const result = await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});
		expect(result.imported).toBe(2);
		expect(result.failed).toBe(0);
	});

	it('同名が入力に2回 -> 2つ目は重複扱い', async () => {
		const rewards = [makeReward({ title: '同名' }), makeReward({ title: '同名' })];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		// 1つ目はインポート成功、2つ目は同一 preset 内 -> skipped
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(1);
	});

	it('insertSpecialReward に正しい引数が渡される（sourcePresetId 含む）', async () => {
		const rewards = [
			makeReward({
				title: 'こうえんで30ぷんあそぶ',
				points: 20,
				icon: '🏞️',
				category: 'sports',
				description: 'こうえんで じゆうに あそべるよ',
			}),
		];

		await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(mockInsertSpecialReward).toHaveBeenCalledWith(
			{
				childId: CHILD_ID,
				grantedBy: null,
				title: 'こうえんで30ぷんあそぶ',
				description: 'こうえんで じゆうに あそべるよ',
				points: 20,
				icon: '🏞️',
				category: 'sports',
				sourcePresetId: PRESET_ID,
				// #3147: preset に shopCategory が無ければ null で round-trip (表示側 fallback)
				shopCategory: null,
			},
			TENANT,
		);
	});

	it('#3147: preset の shopCategory を insertSpecialReward に round-trip する', async () => {
		const rewards = [
			makeReward({
				title: 'ゲーム30ぷん',
				points: 50,
				icon: '🎮',
				category: 'other',
				shopCategory: 'privilege',
			}),
		];

		await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(mockInsertSpecialReward).toHaveBeenCalledWith(
			expect.objectContaining({ shopCategory: 'privilege' }),
			TENANT,
		);
	});

	it('description が undefined でも insertSpecialReward に undefined のまま渡される', async () => {
		const rewards = [makeReward({ title: '説明なし', description: undefined })];

		await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(mockInsertSpecialReward).toHaveBeenCalledWith(
			expect.objectContaining({ description: undefined }),
			TENANT,
		);
	});

	it('空の入力 -> 何もインポートされない', async () => {
		const result = await importRewardSet([], TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toEqual([]);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('別 preset の同名 reward が存在しても新規としてインポート', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'おやつ', sourcePresetId: 'elementary-rewards' }),
		]);

		const rewards = [makeReward({ title: 'おやつ' })];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
	});
});

// ==========================================================
// #3168: dedupMode='content' (backup/restore 冪等)
// ==========================================================
//
// restore は固定 sentinel presetId で取込むため、preset-scope dedup では既存の手動/seed reward
// (sourcePresetId=NULL) を重複検知できず二重 INSERT していた (#3163 worker DB 汚染 / 本番 restore 非冪等)。
// dedupMode='content' は sourcePresetId 非依存で (title+points) を全既存 reward と照合し冪等化する。
// preset-scope (#1254 G1) は既定のまま不変であることも併せて固定する。

describe("#3168 dedupMode='content' (restore 冪等)", () => {
	const RESTORE_PRESET = 'backup-restore:reward-set';

	it('preview: sourcePresetId=NULL の既存 reward を content で重複検知 (preset-scope では検知しない対比)', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'E2Eごほうび', points: 10000, sourcePresetId: null }),
		]);
		const rewards = [makeReward({ title: 'E2Eごほうび', points: 10000 })];

		const contentPreview = await previewRewardSetImport(
			rewards,
			RESTORE_PRESET,
			CHILD_ID,
			TENANT,
			'content',
		);
		expect(contentPreview.newRewards).toBe(0);
		expect(contentPreview.duplicates).toBe(1);

		// 既定 (preset-scope) は同じ入力で「新規」と判定する (#1254 G1 不変の対比)
		const presetScopePreview = await previewRewardSetImport(
			rewards,
			RESTORE_PRESET,
			CHILD_ID,
			TENANT,
		);
		expect(presetScopePreview.newRewards).toBe(1);
		expect(presetScopePreview.duplicates).toBe(0);
	});

	it('import: 自分のバックアップ復元は既存 reward を二重化しない (冪等)', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: '交換可', points: 50, sourcePresetId: null }),
			makeExistingRow({ title: '交換不可', points: 10000, sourcePresetId: null }),
		]);
		const rewards = [
			makeReward({ title: '交換可', points: 50 }),
			makeReward({ title: '交換不可', points: 10000 }),
		];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: RESTORE_PRESET,
			childId: CHILD_ID,
			dedupMode: 'content',
		});

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(2);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});

	it('import: 失われた reward (バックアップにあり DB に無い) は content でも復元する', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: '交換可', points: 50, sourcePresetId: null }),
		]);
		const rewards = [
			makeReward({ title: '交換可', points: 50 }), // 既存 → skip
			makeReward({ title: '消えたごほうび', points: 30 }), // DB に無い → 復元
		];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: RESTORE_PRESET,
			childId: CHILD_ID,
			dedupMode: 'content',
		});

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(mockInsertSpecialReward).toHaveBeenCalledTimes(1);
	});

	it('content: 同一 title でも points が異なれば別物として復元する (title+points 複合キー)', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: 'ごほうび', points: 50, sourcePresetId: null }),
		]);
		const rewards = [makeReward({ title: 'ごほうび', points: 80 })];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: RESTORE_PRESET,
			childId: CHILD_ID,
			dedupMode: 'content',
		});

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
	});

	it('preset 取込 (dedupMode 未指定) は content の影響を受けず preset-scope のまま (#1254 G1 不変)', async () => {
		mockFindSpecialRewards.mockResolvedValue([
			makeExistingRow({ title: '手動ごほうび', points: 20, sourcePresetId: null }),
		]);
		const rewards = [makeReward({ title: '手動ごほうび', points: 20 })];

		const result = await importRewardSet(rewards, TENANT, {
			presetId: PRESET_ID,
			childId: CHILD_ID,
		});

		// 手動 reward (sourcePresetId=null) を preset 取込が clobber しない = 新規追加される
		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(0);
	});
});
