// tests/unit/services/activity-quota-restore-archive-4693.test.ts (#4693)
//
// PO 回答 (2026-09-03) #2:
//   「上限を超える復元で顧客のデータを落とさない。超過分は取り込んだうえで archived (無効) にし、
//    アップグレードで復帰できるようにする (既存のダウングレード時 archive と同じ意味論)。
//    復元結果の文言は『119 件のうち 3 件を有効化し、116 件はプランの上限のため保管しました
//    （アップグレードで使えます）』のように、入った数・入らなかった数・理由・次の行動を必ず出す。
//    『復元しました』だけで黙って落とすのは不可。」
//
// 旧実装 (QM #4784) は超過分を **計画から削除**していたため、無料プランに戻った世帯が backup を
// 復元すると 116 件が黙って消えていた。本 test は「捨てずに archived で入る」ことを固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asCategoryId, asChildId, type ChildId } from '$lib/domain/ids';
import { SETTINGS_LABELS } from '$lib/domain/labels';
import type { InsertChildActivityInput } from '$lib/server/db/types';

const mockFindAllChildren = vi.fn();
const mockFindActivitiesByChild = vi.fn();
const mockResolveTenantEntitlement = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		childActivity: { findActivitiesByChild: mockFindActivitiesByChild },
	}),
}));

vi.mock('$lib/server/auth/tenant-entitlement', () => ({
	resolveTenantEntitlement: (...args: unknown[]) => mockResolveTenantEntitlement(...args),
}));

// #4723: モード判定の実体は auth-mode.ts (factory は re-export)。plan-limit-service は実体を
// 直接 import するため、両方を差し替えないと selfhost 扱い (上限なし) になる。
vi.mock('$lib/server/auth/auth-mode', () => ({ getAuthMode: () => 'cognito' }));
vi.mock('$lib/server/auth/factory', () => ({ getAuthMode: () => 'cognito' }));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: async () => ({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
		convertedToPaid: false,
	}),
}));

import {
	archiveActivityQuotaOverflow,
	RESTORE_OVER_QUOTA_ARCHIVED_REASON,
} from '$lib/server/services/activity-quota';

const TENANT = 'tenant-1';
const CHILD = asChildId(1);
const SIBLING = asChildId(2);
const CAT = asCategoryId(2);

function customRow(name: string, childId: ChildId = CHILD): InsertChildActivityInput {
	return {
		childId,
		name,
		categoryId: CAT,
		icon: '✏️',
		basePoints: 5,
		source: 'custom',
		isArchived: 0,
	};
}

function seedRow(name: string, childId: ChildId = CHILD): InsertChildActivityInput {
	return {
		childId,
		name,
		categoryId: CAT,
		icon: '🌱',
		basePoints: 5,
		source: 'seed',
		isArchived: 0,
	};
}

/** 既存の custom 活動 n 件 (quota の分母) */
function existing(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		id: String(i + 1),
		name: `既存${i + 1}`,
		source: 'custom',
		isArchived: 0,
	}));
}

function planOf(rows: InsertChildActivityInput[]) {
	const byChild = new Map<ChildId, InsertChildActivityInput[]>();
	for (const row of rows) {
		const list = byChild.get(row.childId) ?? [];
		list.push(row);
		byChild.set(row.childId, list);
	}
	return { byChild, names: new Set(rows.map((r) => r.name)) };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindAllChildren.mockResolvedValue([{ id: CHILD, nickname: 'たろう' }]);
	mockResolveTenantEntitlement.mockResolvedValue({ licenseStatus: 'none', plan: undefined });
});

describe('#4693 復元の超過分は捨てずに archived として取り込む', () => {
	it('無料 0/3 に custom 5 件を復元 → 3 件が有効、2 件が archived。1 行も落とさない', async () => {
		mockFindActivitiesByChild.mockResolvedValue(existing(0));
		const { byChild, names } = planOf([
			customRow('復元1'),
			customRow('復元2'),
			customRow('復元3'),
			customRow('復元4'),
			customRow('復元5'),
		]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome).toMatchObject({ total: 5, activated: 3, archived: 2, reason: 'plan_limit' });
		// 計画から 1 行も消えていない (= 捨てていない)
		expect(byChild.get(CHILD)).toHaveLength(5);
		expect(names.size).toBe(5);
		const archived = byChild.get(CHILD)?.filter((r) => r.isArchived === 1) ?? [];
		expect(archived.map((r) => r.name)).toEqual(['復元4', '復元5']);
		// ダウングレード時 archive と同じ意味論 = アップグレードで自動復帰する reason を使う
		for (const row of archived) {
			expect(row.archivedReason).toBe(RESTORE_OVER_QUOTA_ARCHIVED_REASON);
		}
		expect(outcome.upgradeUrl).toBe('/admin/subscription');
	});

	it('3/3 到達済みなら custom は全件 archived (それでも 1 行も落とさない)', async () => {
		mockFindActivitiesByChild.mockResolvedValue(existing(3));
		const { byChild, names } = planOf([customRow('復元1'), customRow('復元2')]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome).toMatchObject({ total: 2, activated: 0, archived: 2, reason: 'plan_limit' });
		expect(byChild.get(CHILD)?.every((r) => r.isArchived === 1)).toBe(true);
	});

	it('seed 行 (プリセット / 初期 seed) は数えず archived にもしない', async () => {
		mockFindActivitiesByChild.mockResolvedValue(existing(3)); // 残枠 0
		const { byChild, names } = planOf([
			seedRow('seed-a'),
			seedRow('seed-b'),
			customRow('custom-1'),
		]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome.total).toBe(1); // custom 1 行だけが母集団
		expect(outcome.archived).toBe(1);
		const rows = byChild.get(CHILD) ?? [];
		expect(rows.filter((r) => r.isArchived === 1).map((r) => r.name)).toEqual(['custom-1']);
		expect(rows.filter((r) => r.source === 'seed').every((r) => r.isArchived === 0)).toBe(true);
	});

	it('backup にもともと archived だった custom 行は母集団に入らない (二重に数えない)', async () => {
		mockFindActivitiesByChild.mockResolvedValue(existing(3)); // 残枠 0
		const alreadyArchived: InsertChildActivityInput = {
			...customRow('もともと保管'),
			isArchived: 1,
		};
		const { byChild, names } = planOf([alreadyArchived, customRow('あたらしい')]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome.total).toBe(1);
		expect(outcome.archived).toBe(1);
		// もともと archived な行の reason は書き換えない (元の archive 事由を保つ)
		expect(byChild.get(CHILD)?.[0]?.archivedReason).toBeUndefined();
	});

	it('単位は行数 — 2 人の子に同じ名前を復元すると 2 行として数える', async () => {
		mockFindAllChildren.mockResolvedValue([
			{ id: CHILD, nickname: 'たろう' },
			{ id: SIBLING, nickname: 'はなこ' },
		]);
		mockFindActivitiesByChild.mockResolvedValue(existing(1)); // 2 child 合算で current=2、残枠 1
		const { byChild, names } = planOf([customRow('共通', CHILD), customRow('共通', SIBLING)]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		// 「共通」は 2 行を要するので残枠 1 に収まらない → 2 行とも archived
		expect(outcome).toMatchObject({ total: 2, activated: 0, archived: 2 });
		expect(byChild.get(CHILD)?.[0]?.isArchived).toBe(1);
		expect(byChild.get(SIBLING)?.[0]?.isArchived).toBe(1);
	});

	it('有料プラン (上限なし) では 1 行も archived にしない', async () => {
		mockResolveTenantEntitlement.mockResolvedValue({
			licenseStatus: 'active',
			plan: 'standard_monthly',
		});
		const { byChild, names } = planOf([customRow('復元1'), customRow('復元2')]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome).toMatchObject({ total: 2, activated: 2, archived: 0, reason: null });
		expect(byChild.get(CHILD)?.every((r) => r.isArchived === 0)).toBe(true);
	});

	it('プランを確認できないときも復元は中止せず、全 custom 行を archived にする (fail-closed + データ保全)', async () => {
		mockFindActivitiesByChild.mockRejectedValue(new Error('OCC 40001'));
		const { byChild, names } = planOf([customRow('復元1'), customRow('復元2')]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome).toMatchObject({
			total: 2,
			activated: 0,
			archived: 2,
			reason: 'plan_unverifiable',
		});
		// 上限が理由ではないのでアップグレード導線は出さない
		expect(outcome.upgradeUrl).toBeNull();
		expect(outcome.message).not.toBe('');
		expect(byChild.get(CHILD)).toHaveLength(2);
	});
});

describe('#4693 復元結果の文言 (入った数 / 保管した数 / 理由 / 次の行動)', () => {
	it('PO 回答の例文どおりに 3 つの数を出す', () => {
		expect(SETTINGS_LABELS.dataImportResultQuotaArchived(119, 3, 116)).toBe(
			'119 件のうち 3 件を有効化し、116 件はプランの上限のため保管しました（アップグレードで使えます）',
		);
	});

	it('「保管した」ことと「アップグレードで使える」ことを必ず含む (黙って落とす表現にしない)', () => {
		const text = SETTINGS_LABELS.dataImportResultQuotaArchived(5, 3, 2);
		expect(text).toContain('保管しました');
		expect(text).toContain('アップグレード');
		expect(text).not.toContain('復元しませんでした');
	});
});
