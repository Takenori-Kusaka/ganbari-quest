// tests/unit/services/resource-archive-service.test.ts
// #783: リソース archive / restore サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARCHIVED_REASONS } from '$lib/domain/archive-types';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';

// --- モック定義 ---
const mockFindAllChildren = vi.fn();
const mockArchiveChildren = vi.fn();
const mockRestoreArchivedChildren = vi.fn();
const mockFindArchivedChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockArchiveActivities = vi.fn();
const mockRestoreArchivedActivities = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockArchiveChecklistTemplates = vi.fn();
const mockRestoreArchivedChecklistTemplates = vi.fn();
const mockFindActivityLogs = vi.fn();

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
	archiveChildren: (...args: unknown[]) => mockArchiveChildren(...args),
	restoreArchivedChildren: (...args: unknown[]) => mockRestoreArchivedChildren(...args),
	findArchivedChildren: (...args: unknown[]) => mockFindArchivedChildren(...args),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
	archiveActivities: (...args: unknown[]) => mockArchiveActivities(...args),
	restoreArchivedActivities: (...args: unknown[]) => mockRestoreArchivedActivities(...args),
	findActivityLogs: (...args: unknown[]) => mockFindActivityLogs(...args),
}));

// #4708: archive 済み活動の件数は per-child repo (includeArchived) から数える
const mockFindActivitiesByChild = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childActivity: {
			findActivitiesByChild: (...args: unknown[]) => mockFindActivitiesByChild(...args),
		},
	}),
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: (...args: unknown[]) => mockFindTemplatesByChild(...args),
	archiveChecklistTemplates: (...args: unknown[]) => mockArchiveChecklistTemplates(...args),
	restoreArchivedChecklistTemplates: (...args: unknown[]) =>
		mockRestoreArchivedChecklistTemplates(...args),
}));

import {
	archiveExcessResources,
	getArchivedResourceSummary,
	restoreArchivedResources,
} from '../../../src/lib/server/services/resource-archive-service';

const TENANT = 'test-tenant';

function makeChild(id: number, nickname: string, createdAt = '2026-01-01') {
	return {
		id: asChildId(id),
		nickname,
		age: 4,
		theme: 'pink',
		uiMode: 'preschool',
		createdAt,
		updatedAt: '2026-01-01',
		isArchived: 0,
		archivedReason: null,
	};
}

function makeActivity(id: number, name: string, source = 'custom') {
	return {
		id: asActivityId(id),
		name,
		categoryId: asCategoryId(1),
		icon: '🏃',
		basePoints: 5,
		source,
		isVisible: 1,
		sortOrder: 0,
		isArchived: 0,
		archivedReason: null,
	};
}

function makeTemplate(id: number, childId: number, name: string) {
	return {
		id: String(id),
		childId: asChildId(childId),
		name,
		icon: '📋',
		pointsPerItem: 2,
		completionBonus: 5,
		isActive: 1,
		isArchived: 0,
		archivedReason: null,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// 既定は「記録なし」。#4585-3 の子供の並べ替えは coalesce(最終記録日, 登録日) なので、
	// 記録を渡さない既存 test は登録日 (全員同一) → id 昇順の tie-break に落ちる。
	mockFindActivityLogs.mockResolvedValue([]);
});

/** 活動ログ (recordedAt のみ使う) を作る。 */
function logsAt(...recordedAt: string[]) {
	return recordedAt.map((at, i) => ({ id: String(i + 1), recordedAt: at }));
}

/** child id → 活動ログ の対応で `findActivityLogs` を組む。 */
function mockLogsByChild(byChild: Record<string, { id: string; recordedAt: string }[]>) {
	mockFindActivityLogs.mockImplementation(
		async (childId: string) => byChild[String(childId)] ?? [],
	);
}

describe('archiveExcessResources', () => {
	it('free 上限を超える子供を archive する（古い順に残す）', async () => {
		// free: maxChildren=2、子供3人 → id=3 を archive
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'たろう'),
			makeChild(2, 'はなこ'),
			makeChild(3, 'じろう'),
		]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChildren).toHaveBeenCalledWith(['3'], 'trial_expired', TENANT);
		expect(result.archivedChildIds).toEqual(['3']);
		expect(result.archivedActivityIds).toEqual([]);
		expect(result.archivedChecklistTemplateIds).toEqual([]);
	});

	it('free 上限を超える custom 活動を archive する', async () => {
		// free: maxActivities=3、custom 5件 → id=4,5 を archive
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, '活動1', 'custom'),
			makeActivity(2, '活動2', 'custom'),
			makeActivity(3, '活動3', 'custom'),
			makeActivity(4, '活動4', 'custom'),
			makeActivity(5, '活動5', 'custom'),
		]);
		mockArchiveActivities.mockResolvedValue(undefined);
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveActivities).toHaveBeenCalledWith(['4', '5'], 'trial_expired', TENANT);
		expect(result.archivedActivityIds).toEqual(['4', '5']);
	});

	it('seed 活動は archive 対象外', async () => {
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, 'seed活動1', 'seed'),
			makeActivity(2, 'seed活動2', 'seed'),
			makeActivity(3, 'seed活動3', 'seed'),
			makeActivity(4, 'seed活動4', 'seed'),
			makeActivity(5, 'seed活動5', 'seed'),
		]);
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveActivities).not.toHaveBeenCalled();
		expect(result.archivedActivityIds).toEqual([]);
	});

	it('free 上限を超えるチェックリストを子供ごとに archive する', async () => {
		// free: maxChecklistTemplates=3、子供1の テンプレート5件 → id=4,5 を archive
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([
			makeTemplate(1, 1, 'テンプレ1'),
			makeTemplate(2, 1, 'テンプレ2'),
			makeTemplate(3, 1, 'テンプレ3'),
			makeTemplate(4, 1, 'テンプレ4'),
			makeTemplate(5, 1, 'テンプレ5'),
		]);
		mockArchiveChecklistTemplates.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChecklistTemplates).toHaveBeenCalledWith(['4', '5'], 'trial_expired', TENANT);
		expect(result.archivedChecklistTemplateIds).toEqual(['4', '5']);
	});

	it('上限以内なら何も archive しない', async () => {
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう'), makeChild(2, 'はなこ')]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, '活動1', 'custom'),
			makeActivity(2, '活動2', 'custom'),
		]);
		mockFindTemplatesByChild.mockResolvedValue([makeTemplate(1, 1, 'テンプレ1')]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChildren).not.toHaveBeenCalled();
		expect(mockArchiveActivities).not.toHaveBeenCalled();
		expect(mockArchiveChecklistTemplates).not.toHaveBeenCalled();
		expect(result.archivedChildIds).toEqual([]);
		expect(result.archivedActivityIds).toEqual([]);
		expect(result.archivedChecklistTemplateIds).toEqual([]);
	});

	it('冪等: 既に archive 済みなら何もしない（findAll は非アーカイブのみ返す前提）', async () => {
		// archive 後は findAllChildren が2件以下を返す → archive は実行されない
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう'), makeChild(2, 'はなこ')]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChildren).not.toHaveBeenCalled();
		expect(result.archivedChildIds).toEqual([]);
	});
});

// ============================================================
// #4585-3: fallback 規則 = 子供だけ「直近の利用順」(PO 決裁 Q1 / Q3)
// ============================================================
//
// 実害が非対称なため、子供のみ coalesce(最終記録日, 登録日) の新しい順に残す。
// 活動 / チェックリストは登録順のまま (決裁で「子供だけ」と明示)。
describe('#4585-3 子供の fallback は直近の利用順', () => {
	it('最近記録がある下の子が残り、放置された上の子が archive される', async () => {
		// free: maxChildren=2。id 昇順 (旧規則) なら id=3 が archive されるが、
		// 実際に使われているのは id=2 / id=3 で、放置されているのは id=1。
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'あにき', '2026-01-01T00:00:00Z'),
			makeChild(2, 'まんなか', '2026-02-01T00:00:00Z'),
			makeChild(3, 'すえっこ', '2026-03-01T00:00:00Z'),
		]);
		mockLogsByChild({
			'1': logsAt('2026-01-05T01:00:00Z'),
			'2': logsAt('2026-08-10T01:00:00Z'),
			'3': logsAt('2026-08-12T01:00:00Z'),
		});
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedChildIds).toEqual(['1']);
		expect(mockArchiveChildren).toHaveBeenCalledWith(['1'], 'trial_expired', TENANT);
	});

	it('記録が 1 件も無い子供は登録日で代替する（登録したばかりの子が残る）', async () => {
		// id=1 は昔登録して昔の記録だけ / id=2 は昔登録して記録なし / id=3 は登録したてで記録なし。
		// coalesce(最終記録日, 登録日): 1 → 2026-01-05、2 → 2026-01-02、3 → 2026-08-12
		// → 残るのは 3 と 1、archive は 2。
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'あにき', '2026-01-01T00:00:00Z'),
			makeChild(2, 'まんなか', '2026-01-02T00:00:00Z'),
			makeChild(3, 'すえっこ', '2026-08-12T00:00:00Z'),
		]);
		mockLogsByChild({ '1': logsAt('2026-01-05T01:00:00Z') });
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedChildIds).toEqual(['2']);
	});

	it('最終記録日は JST 暦日で比較する（UTC 暦日で切ると結果が変わる）', async () => {
		// JST では 3 人とも 2026-08-13 (同点) → id 昇順の tie-break で id=3 が archive。
		// UTC 暦日 (`recordedAt.slice(0,10)`) で切ると id=1 だけ 08-12 になり id=1 が archive される。
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'たろう', '2026-01-01T00:00:00Z'),
			makeChild(2, 'はなこ', '2026-01-01T00:00:00Z'),
			makeChild(3, 'じろう', '2026-01-01T00:00:00Z'),
		]);
		mockLogsByChild({
			'1': logsAt('2026-08-12T16:00:00Z'), // JST 2026-08-13 01:00
			'2': logsAt('2026-08-13T02:00:00Z'), // JST 2026-08-13 11:00
			'3': logsAt('2026-08-13T03:00:00Z'), // JST 2026-08-13 12:00
		});
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedChildIds).toEqual(['3']);
	});

	it('同点は id 昇順で解く / 入力順が変わっても結果は同じ（安定ソート）', async () => {
		const children = [
			makeChild(1, 'たろう', '2026-01-01T00:00:00Z'),
			makeChild(2, 'はなこ', '2026-01-01T00:00:00Z'),
			makeChild(3, 'じろう', '2026-01-01T00:00:00Z'),
			makeChild(4, 'さぶろう', '2026-01-01T00:00:00Z'),
		];
		// 全員同じ最終記録日 → 完全な同点。
		mockLogsByChild({
			'1': logsAt('2026-08-01T01:00:00Z'),
			'2': logsAt('2026-08-01T02:00:00Z'), // 同じ JST 暦日
			'3': logsAt('2026-08-01T03:00:00Z'),
			'4': logsAt('2026-08-01T04:00:00Z'),
		});
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		mockFindAllChildren.mockResolvedValue(children);
		const first = await archiveExcessResources(TENANT);
		// 同じ入力を順番だけ変えて 2 回目
		mockFindAllChildren.mockResolvedValue([...children].reverse());
		const second = await archiveExcessResources(TENANT);

		expect(first.archivedChildIds).toEqual(['3', '4']);
		expect(second.archivedChildIds).toEqual(first.archivedChildIds);
	});

	it('活動 / チェックリストは登録順のまま（決裁で子供だけと明示）', async () => {
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, '活動1'),
			makeActivity(2, '活動2'),
			makeActivity(3, '活動3'),
			makeActivity(4, '活動4'),
		]);
		mockFindTemplatesByChild.mockResolvedValue([
			makeTemplate(1, 1, 'テンプレ1'),
			makeTemplate(2, 1, 'テンプレ2'),
			makeTemplate(3, 1, 'テンプレ3'),
			makeTemplate(4, 1, 'テンプレ4'),
		]);
		// 子供 1 人 = 上限内なので最終記録日の導出は不要。
		mockArchiveActivities.mockResolvedValue(undefined);
		mockArchiveChecklistTemplates.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(result.archivedActivityIds).toEqual(['4']);
		expect(result.archivedChecklistTemplateIds).toEqual(['4']);
	});

	it('子供が上限以内なら活動ログを読まない（クエリを増やさない、ADR-0065）', async () => {
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう'), makeChild(2, 'はなこ')]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);

		await archiveExcessResources(TENANT);

		expect(mockFindActivityLogs).not.toHaveBeenCalled();
	});

	it('超過時に読む活動ログは 1 子供につき 1 回だけ', async () => {
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'たろう'),
			makeChild(2, 'はなこ'),
			makeChild(3, 'じろう'),
		]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		await archiveExcessResources(TENANT);

		expect(mockFindActivityLogs).toHaveBeenCalledTimes(3);
	});
});

describe('#4585-3 archive reason（体験終了と支払い失敗を区別する）', () => {
	it('既定は trial_expired', async () => {
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'たろう'),
			makeChild(2, 'はなこ'),
			makeChild(3, 'じろう'),
		]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		await archiveExcessResources(TENANT);

		expect(mockArchiveChildren).toHaveBeenCalledWith(['3'], 'trial_expired', TENANT);
	});

	it('dunning_canceled を渡すと 3 資源すべてがその reason で archive される', async () => {
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'たろう'),
			makeChild(2, 'はなこ'),
			makeChild(3, 'じろう'),
		]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, '活動1'),
			makeActivity(2, '活動2'),
			makeActivity(3, '活動3'),
			makeActivity(4, '活動4'),
		]);
		mockFindTemplatesByChild.mockResolvedValue([
			makeTemplate(1, 1, 'テンプレ1'),
			makeTemplate(2, 1, 'テンプレ2'),
			makeTemplate(3, 1, 'テンプレ3'),
			makeTemplate(4, 1, 'テンプレ4'),
		]);
		mockArchiveChildren.mockResolvedValue(undefined);
		mockArchiveActivities.mockResolvedValue(undefined);
		mockArchiveChecklistTemplates.mockResolvedValue(undefined);

		await archiveExcessResources(TENANT, 'dunning_canceled');

		expect(mockArchiveChildren).toHaveBeenCalledWith(['3'], 'dunning_canceled', TENANT);
		expect(mockArchiveActivities).toHaveBeenCalledWith(['4'], 'dunning_canceled', TENANT);
		expect(mockArchiveChecklistTemplates).toHaveBeenCalledWith(['4'], 'dunning_canceled', TENANT);
	});
});

describe('restoreArchivedResources', () => {
	it('trial_expired の全リソースを復元する', async () => {
		mockRestoreArchivedChildren.mockResolvedValue(undefined);
		mockRestoreArchivedActivities.mockResolvedValue(undefined);
		mockRestoreArchivedChecklistTemplates.mockResolvedValue(undefined);

		await restoreArchivedResources(TENANT);

		expect(mockRestoreArchivedChildren).toHaveBeenCalledWith('trial_expired', TENANT);
		expect(mockRestoreArchivedActivities).toHaveBeenCalledWith('trial_expired', TENANT);
		expect(mockRestoreArchivedChecklistTemplates).toHaveBeenCalledWith('trial_expired', TENANT);
	});

	// #4585-3: reason を 1 つでも復元し漏らすと、その顧客は再契約しても記録が戻らない。
	// 復元は enum SSOT を全件回すことで、reason が増えたときの取りこぼしを構造的に防ぐ。
	it('ARCHIVED_REASONS の全 reason を復元する（dunning_canceled を含む）', async () => {
		mockRestoreArchivedChildren.mockResolvedValue(undefined);
		mockRestoreArchivedActivities.mockResolvedValue(undefined);
		mockRestoreArchivedChecklistTemplates.mockResolvedValue(undefined);

		await restoreArchivedResources(TENANT);

		for (const reason of ARCHIVED_REASONS) {
			expect(mockRestoreArchivedChildren).toHaveBeenCalledWith(reason, TENANT);
			expect(mockRestoreArchivedActivities).toHaveBeenCalledWith(reason, TENANT);
			expect(mockRestoreArchivedChecklistTemplates).toHaveBeenCalledWith(reason, TENANT);
		}
		expect(mockRestoreArchivedChildren).toHaveBeenCalledTimes(ARCHIVED_REASONS.length);
	});
});

describe('getArchivedResourceSummary', () => {
	beforeEach(() => {
		mockFindAllChildren.mockResolvedValue([]);
		mockFindActivitiesByChild.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
	});

	it('archive 済みの子供がいない場合', async () => {
		mockFindArchivedChildren.mockResolvedValue([]);

		const summary = await getArchivedResourceSummary(TENANT);

		expect(summary.archivedChildCount).toBe(0);
		expect(summary.hasArchivedResources).toBe(false);
	});

	it('archive 済みの子供がいる場合', async () => {
		mockFindArchivedChildren.mockResolvedValue([
			{ ...makeChild(3, 'じろう'), isArchived: 1, archivedReason: 'trial_expired' },
		]);

		const summary = await getArchivedResourceSummary(TENANT);

		expect(summary.archivedChildCount).toBe(1);
		expect(summary.hasArchivedResources).toBe(true);
	});

	// #4708: 3 資源の件数を返す (banner「お子さま N 人 / 活動 N 件 / チェックリスト N 件」の根拠)
	it('表示中の子供に紐づく archive 済み活動 / チェックリストも数える (template は id で dedupe)', async () => {
		mockFindArchivedChildren.mockResolvedValue([]);
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう'), makeChild(2, 'はなこ')]);
		mockFindActivitiesByChild.mockImplementation(async (childId: unknown) =>
			String(childId) === '1'
				? [
						{ ...makeActivity(10, 'A'), isArchived: 1, archivedReason: 'trial_expired' },
						{ ...makeActivity(11, 'B'), isArchived: 1, archivedReason: 'trial_expired' },
						makeActivity(12, 'C'),
					]
				: [{ ...makeActivity(20, 'D'), isArchived: 1, archivedReason: 'downgrade_user_selected' }],
		);
		// 同じ template (id=100) が 2 人に配信されていても 1 件
		mockFindTemplatesByChild.mockImplementation(async (childId: unknown) => [
			{ ...makeTemplate(100, Number(childId), '朝のしたく'), isArchived: 1 },
			{ ...makeTemplate(200 + Number(childId), Number(childId), '表示中'), isArchived: 0 },
		]);

		const summary = await getArchivedResourceSummary(TENANT);

		expect(mockFindActivitiesByChild).toHaveBeenCalledWith(asChildId(1), TENANT, {
			includeArchived: true,
		});
		expect(mockFindTemplatesByChild).toHaveBeenCalledWith(asChildId(1), TENANT, true, true);
		expect(summary).toEqual({
			archivedChildCount: 0,
			archivedActivityCount: 3,
			archivedChecklistTemplateCount: 1,
			totalCount: 4,
			hasArchivedResources: true,
		});
	});

	it('子供の archive が無くても活動だけ archive されていれば hasArchivedResources=true', async () => {
		mockFindArchivedChildren.mockResolvedValue([]);
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivitiesByChild.mockResolvedValue([
			{ ...makeActivity(10, 'A'), isArchived: 1, archivedReason: 'trial_expired' },
		]);

		const summary = await getArchivedResourceSummary(TENANT);
		expect(summary.hasArchivedResources).toBe(true);
		expect(summary.totalCount).toBe(1);
	});
});
