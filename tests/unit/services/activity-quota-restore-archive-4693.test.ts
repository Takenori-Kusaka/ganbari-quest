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

// #4693 QM 再レビュー: 上限による自動保管の耐久記録 (settings) — 行の archived_reason では
// 「親が自分で選んだ保管」と区別が付かないため、ここで残す。
const mockSetSetting = vi.fn(async (_key: string, _value: string, _tenantId: string) => {});
const mockGetSetting = vi.fn(
	async (_key: string, _tenantId: string) => undefined as string | undefined,
);
vi.mock('$lib/server/db/settings-repo', () => ({
	setSetting: (key: string, value: string, tenantId: string) =>
		mockSetSetting(key, value, tenantId),
	getSetting: (key: string, tenantId: string) => mockGetSetting(key, tenantId),
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
	ACTIVITY_QUOTA_ARCHIVE_MARKER_KEY,
	archiveActivityQuotaOverflow,
	getActivityQuotaArchiveNotice,
	RESTORE_OVER_QUOTA_ARCHIVED_REASON,
	recordActivityQuotaArchiveMarker,
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

	// #4693 QM 再レビュー: 「無料と確定したが利用状況が数えられない」と「プラン自体が分からない」を
	// 分ける。前者は保管 (無料なのでアップグレードで戻せる)、後者は保管しない (有料世帯を
	// 一時的な読み取り失敗だけで無効化しないため)。
	it('無料と確定 + 現在数を数えられない → 全件を保管し、アップグレード導線を出す', async () => {
		// プラン解決は成功 (無料) させ、現在数の集計だけを落とす
		mockFindActivitiesByChild.mockRejectedValue(new Error('OCC 40001'));
		const { byChild, names } = planOf([customRow('復元1'), customRow('復元2')]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome).toMatchObject({
			total: 2,
			activated: 0,
			archived: 2,
			reason: 'usage_unverifiable',
		});
		// 無料と確定しているので、顧客はアップグレードで自己回復できる
		expect(outcome.upgradeUrl).toBe('/admin/subscription');
		expect(outcome.message).not.toBe('');
		expect(byChild.get(CHILD)).toHaveLength(2);
	});

	it('プラン自体を判定できない → 1 行も保管せず全件有効で復元し、判定を省いたことを伝える', async () => {
		// プラン解決 (entitlement) の失敗 = free か有料かも分からない状態
		mockResolveTenantEntitlement.mockRejectedValue(new Error('DSQL connect timeout'));
		const { byChild, names } = planOf([customRow('復元1'), customRow('復元2')]);

		const outcome = await archiveActivityQuotaOverflow(TENANT, byChild, names);

		expect(outcome).toMatchObject({
			total: 2,
			activated: 2,
			archived: 0,
			reason: 'plan_unresolved',
		});
		// 有料世帯を巻き添えで無効化しない = 1 行も archived にしない
		expect(byChild.get(CHILD)?.every((r) => r.isArchived === 0)).toBe(true);
		// 「黙って上限判定をしなかった」状態にしない (顧客に伝える文言を必ず持つ)
		expect(outcome.message).not.toBe('');
		// 上限が理由ではないのでアップグレード導線は出さない
		expect(outcome.upgradeUrl).toBeNull();
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

describe('#4693 上限による自動保管の耐久記録 (行の archived_reason で区別できない分を補う)', () => {
	it('保管が発生したら settings に「いつ / 何件 / 理由」を残す', async () => {
		await recordActivityQuotaArchiveMarker(TENANT, {
			total: 119,
			activated: 3,
			archived: 116,
			reason: 'plan_limit',
			message: 'x',
			upgradeUrl: '/admin/subscription',
		});

		expect(mockSetSetting).toHaveBeenCalledTimes(1);
		const [key, value, tenant] = mockSetSetting.mock.calls[0] as unknown as [
			string,
			string,
			string,
		];
		expect(key).toBe(ACTIVITY_QUOTA_ARCHIVE_MARKER_KEY);
		expect(tenant).toBe(TENANT);
		const marker = JSON.parse(value) as Record<string, unknown>;
		expect(marker).toMatchObject({ archived: 116, activated: 3, total: 119, reason: 'plan_limit' });
		expect(typeof marker.at).toBe('string');
	});

	it('保管が 0 件なら記録しない (使っていない記録で画面を汚さない)', async () => {
		await recordActivityQuotaArchiveMarker(TENANT, {
			total: 3,
			activated: 3,
			archived: 0,
			reason: null,
			message: '',
			upgradeUrl: null,
		});
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('記録の書き込みが失敗しても復元は落とさない (記録は補助情報)', async () => {
		mockSetSetting.mockRejectedValueOnce(new Error('write failed'));
		await expect(
			recordActivityQuotaArchiveMarker(TENANT, {
				total: 2,
				activated: 0,
				archived: 2,
				reason: 'plan_limit',
				message: 'x',
				upgradeUrl: null,
			}),
		).resolves.toBeUndefined();
	});

	it('親の画面に出す常設文言を記録から組み立てる (日付は JST 暦日)', async () => {
		// JST 00:00〜09:00 は UTC 前日。slice せず JST 暦日で出すことを固定する (#4120 同型)
		mockGetSetting.mockResolvedValueOnce(
			JSON.stringify({ at: '2026-09-03T22:30:00.000Z', archived: 116, activated: 3, total: 119 }),
		);
		const notice = await getActivityQuotaArchiveNotice(TENANT);
		expect(notice).toContain('2026-09-04');
		expect(notice).toContain('116');
	});

	it('記録が無い / 壊れているときは何も出さない', async () => {
		mockGetSetting.mockResolvedValueOnce(undefined);
		expect(await getActivityQuotaArchiveNotice(TENANT)).toBeNull();
		mockGetSetting.mockResolvedValueOnce('{ broken');
		expect(await getActivityQuotaArchiveNotice(TENANT)).toBeNull();
		mockGetSetting.mockResolvedValueOnce(JSON.stringify({ at: 'not-a-date', archived: 5 }));
		expect(await getActivityQuotaArchiveNotice(TENANT)).toBeNull();
	});
});
