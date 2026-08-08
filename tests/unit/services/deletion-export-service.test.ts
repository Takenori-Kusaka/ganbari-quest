// tests/unit/services/deletion-export-service.test.ts
// #740: 削除前エクスポートサービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asCategoryId } from '$lib/domain/ids';

// --- mocks ---

const mockFindAllChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockFindActivityLogs = vi.fn();
const mockFindStatuses = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		activity: { findActivities: mockFindActivities, findActivityLogs: mockFindActivityLogs },
		status: { findStatuses: mockFindStatuses },
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

/**
 * #4473: 保存期間の日数が `PlanLimits.historyRetentionDays` 由来であることを試験するための override。
 * `undefined` の間は実 SSOT をそのまま使う (既定の挙動を変えない)。
 */
const retentionDaysOverride: { value: number | null | undefined } = { value: undefined };

vi.mock('$lib/server/services/plan-limit-service', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/services/plan-limit-service')>();
	return {
		...actual,
		getPlanLimits: (tier: Parameters<typeof actual.getPlanLimits>[0]) => {
			const limits = actual.getPlanLimits(tier);
			return retentionDaysOverride.value === undefined
				? limits
				: { ...limits, historyRetentionDays: retentionDaysOverride.value };
		},
	};
});

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn().mockResolvedValue({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
	}),
}));

vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => null,
	buildPlanTierCacheKey: (...args: unknown[]) => args.join(':'),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// export-service のモック（full export 用）
const mockExportFamilyData = vi.fn().mockResolvedValue({
	format: 'ganbari-quest-backup',
	version: '1.1.0',
	exportedAt: '2026-04-17T00:00:00.000Z',
	checksum: 'sha256:abc123',
	master: { categories: [], activities: [], titles: [], achievements: [], avatarItems: [] },
	family: { children: [] },
	data: {
		activityLogs: [],
		pointLedger: [],
		statuses: [],
		statusHistory: [],
		childAchievements: [],
		childTitles: [],
		loginBonuses: [],
		evaluations: [],
		specialRewards: [],
		checklistTemplates: [],
		checklistLogs: [],
		childAvatarItems: [],
		dailyMissions: [],
		rewardRedemptions: [],
		settings: [],
	},
});

vi.mock('$lib/server/services/export-service', () => ({
	exportFamilyData: (...args: unknown[]) => mockExportFamilyData(...args),
}));

import { DELETION_EXPORT_NOTE_LABELS } from '$lib/domain/labels';
import {
	buildDeletionExportNotes,
	generateDeletionExport,
	generateMinimalExport,
	generateSiblingComparison,
	resolveExportScope,
} from '$lib/server/services/deletion-export-service';
import { getPlanLimits } from '$lib/server/services/plan-limit-service';

describe('deletion-export-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ============================================================
	// resolveExportScope
	// ============================================================

	describe('resolveExportScope', () => {
		it('free プランは minimal スコープ', () => {
			expect(resolveExportScope('free')).toBe('minimal');
		});

		it('standard プランは full スコープ', () => {
			expect(resolveExportScope('standard')).toBe('full');
		});

		it('family プランは family スコープ', () => {
			expect(resolveExportScope('family')).toBe('family');
		});
	});

	// ============================================================
	// generateMinimalExport
	// ============================================================

	describe('generateMinimalExport', () => {
		it('子供名とサマリを含む最小限のエクスポートを生成する', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: '2',
					nickname: 'はなこ',
					age: 4,
					uiMode: 'preschool',
					createdAt: '2026-02-01T00:00:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([
				{
					categoryId: asCategoryId(1),
					totalXp: 100,
					level: 3,
					peakXp: 100,
					updatedAt: '2026-04-17',
				},
				{ categoryId: asCategoryId(2), totalXp: 50, level: 2, peakXp: 50, updatedAt: '2026-04-17' },
			]);
			// たろう: 5件、はなこ: 3件の活動ログ
			mockFindActivityLogs
				.mockResolvedValueOnce([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }])
				.mockResolvedValueOnce([{ id: '6' }, { id: '7' }, { id: '8' }]);

			const result = await generateMinimalExport('tenant-1', 'free');

			expect(result.format).toBe('ganbari-quest-deletion-export');
			expect(result.scope).toBe('minimal');
			expect(result.children).toHaveLength(2);
			expect(result.children[0]?.nickname).toBe('たろう');
			expect(result.activitySummary).toHaveLength(2);
			expect(result.activitySummary[0]?.totalPoints).toBe(150);
			// 子供ごとの活動数が正しくカウントされること
			expect(result.activitySummary[0]?.totalActivities).toBe(5);
			expect(result.activitySummary[1]?.totalActivities).toBe(3);
			// カテゴリ名がSSOTから取得されること
			expect(result.activitySummary[0]?.categories[0]?.name).toBe('うんどう');
			expect(result.activitySummary[0]?.categories[1]?.name).toBe('べんきょう');
		});

		// #4450: `firstRecordDate` / `lastRecordDate` は「活動ログの最初 / 最後の記録日」であり、
		// 子供の登録日 (`child.createdAt`) ではない。退会時に顧客へ手渡す成果物
		// (ADR-0049 / GDPR 第 15 条) なので、フィールド名と中身が食い違ってはならない。
		// #4120: 日付は JST 暦日。ISO UTC を素朴に slice(0, 10) すると JST 00:00〜09:00 の記録が
		// 前日として書き出され、削除受領証 / retention 監査との突き合わせで 1 日食い違う。
		// 本 test は **暦日の timezone と、値の意味 (登録日ではなく記録日である) の両方**を固定する。
		it('firstRecordDate / lastRecordDate に活動ログの最初・最後の記録日が JST 暦日で入る', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					// UTC 2026-06-30 15:10 = JST 2026-07-01 00:10 (登録日。記録日ではない)
					createdAt: '2026-06-30T15:10:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([]);
			// repo は recordedAt DESC で返す (sqlite / dsql)
			mockFindActivityLogs.mockResolvedValue([
				{ id: '2', recordedAt: '2026-08-05T13:00:00.000Z' }, // JST 2026-08-05 22:00
				{ id: '1', recordedAt: '2026-07-31T15:10:00.000Z' }, // JST 2026-08-01 00:10
			]);

			const result = await generateMinimalExport('tenant-1', 'free');

			expect(result.activitySummary[0]?.firstRecordDate).toBe('2026-08-01');
			expect(result.activitySummary[0]?.lastRecordDate).toBe('2026-08-05');
			// UTC 暦日 (素朴な slice) なら前日になる = 本 assert は UTC 実装で必ず落ちる
			expect(result.activitySummary[0]?.firstRecordDate).not.toBe('2026-07-31');
			// 登録日 (JST 2026-07-01) を「最初の記録日」として出さない
			expect(result.activitySummary[0]?.firstRecordDate).not.toBe('2026-07-01');
			// 登録日そのものは children[] 側で引き続き開示される
			expect(result.children[0]?.createdAt).toBe('2026-06-30T15:10:00.000Z');
		});

		it('記録日は repo の返却順に依存しない (昇順で返しても同じ)', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-06-30T15:10:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([]);
			// demo repo は順序を保証しない
			mockFindActivityLogs.mockResolvedValue([
				{ id: '1', recordedAt: '2026-07-31T15:10:00.000Z' },
				{ id: '2', recordedAt: '2026-08-05T13:00:00.000Z' },
			]);

			const result = await generateMinimalExport('tenant-1', 'free');

			expect(result.activitySummary[0]?.firstRecordDate).toBe('2026-08-01');
			expect(result.activitySummary[0]?.lastRecordDate).toBe('2026-08-05');
		});

		it('活動ログが 0 件なら firstRecordDate / lastRecordDate とも null (登録日で埋めない)', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-06-30T15:10:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([]);
			mockFindActivityLogs.mockResolvedValue([]);

			const result = await generateMinimalExport('tenant-1', 'free');

			expect(result.activitySummary[0]?.firstRecordDate).toBeNull();
			expect(result.activitySummary[0]?.lastRecordDate).toBeNull();
		});

		it('子供がいない場合も空の結果を返す', async () => {
			mockFindAllChildren.mockResolvedValue([]);

			const result = await generateMinimalExport('tenant-1', 'free');

			expect(result.children).toHaveLength(0);
			expect(result.activitySummary).toHaveLength(0);
		});

		// #4470 (#4450 follow-up、PO 決裁 Q2=Yes): 顧客へ手渡す JSON の日付は裸の値だと
		// 読み手が誤解する (JST か UTC か / null の意味 / retention 削除済みデータが期間に
		// 含まれないこと)。但し書きは top-level `notes` に置き、文言は labels.ts SSOT
		// (DELETION_EXPORT_NOTE_LABELS) から取る。
		it('notes に日付の但し書きが SSOT の文言で入る', async () => {
			mockFindAllChildren.mockResolvedValue([]);

			const result = await generateMinimalExport('tenant-1', 'free');

			expect(result.notes).toEqual(buildDeletionExportNotes('free'));
			// 但し書きは「日付の timezone」「null の意味」「保存期間」の 3 点を必ず触れる
			// (どれか 1 つでも消えたら顧客が値を誤読しうるため、文言 refactor 時の網を残す)
			const joined = result.notes.join('\n');
			expect(joined).toContain('firstRecordDate');
			expect(joined).toContain('lastRecordDate');
			expect(joined).toContain('日本標準時');
			expect(joined).toContain('null');
			expect(joined).toContain('保存期間');
			expect(joined).toContain('children[].createdAt');
			// createdAt は JST 暦日ではなく ISO UTC 日時。形式を併記しないと上の JST 暦日と混同され、
			// JST 00:00〜09:00 に登録した子供の登録日が前日に見える (#4120 と同型の誤読)
			expect(joined).toContain('UTC');
		});

		it('notes を足しても既存フィールドの構造・意味は変わらない', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-07-31T15:10:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([]);
			mockFindActivityLogs.mockResolvedValue([]);

			// 顧客が受け取るのは JSON 化された値。notes は文字列配列として往復できる必要がある
			const result = JSON.parse(JSON.stringify(await generateMinimalExport('tenant-1', 'free')));

			expect(result.format).toBe('ganbari-quest-deletion-export');
			expect(result.version).toBe('1.0.0');
			expect(result.scope).toBe('minimal');
			expect(result.children).toHaveLength(1);
			expect(result.children[0]?.createdAt).toBe('2026-07-31T15:10:00.000Z');
			expect(result.activitySummary).toHaveLength(1);
			expect(result.activitySummary[0]?.childNickname).toBe('たろう');
			expect(result.notes).toEqual(buildDeletionExportNotes('free'));
			// 但し書きは top-level にだけ置く (子供の人数だけ重複させない)
			expect(result.activitySummary[0]).not.toHaveProperty('notes');
		});
	});

	// ============================================================
	// buildDeletionExportNotes — 保存期間の日数 (#4473)
	// ============================================================

	// PO 決裁「日数の二重管理は論外。SSOT の原則を守って対応せよ」。
	// 保存期間の実値 SSOT は PlanLimits.historyRetentionDays であり、
	// 但し書きに 90 / 365 を直書きしたら本 describe が落ちる形にしてある。
	describe('buildDeletionExportNotes (#4473)', () => {
		it('保存期間の文言に getPlanLimits の日数がそのまま入る (free / standard)', () => {
			for (const tier of ['free', 'standard'] as const) {
				const days = getPlanLimits(tier).historyRetentionDays;
				// 前提: 有限プランは日数を持つ (null なら本 case の検証対象外)
				expect(days).not.toBeNull();

				const joined = buildDeletionExportNotes(tier).join('\n');

				// 文言は labels.ts SSOT の関数に日数を渡した結果と完全一致する
				expect(joined).toContain(
					DELETION_EXPORT_NOTE_LABELS.retentionLimited(days as unknown as number),
				);
				expect(joined).toContain(String(days));
				// 無期限プラン向けの別文が紛れ込まない
				expect(joined).not.toContain(DELETION_EXPORT_NOTE_LABELS.retentionUnlimited);
			}
		});

		it('free と standard で文面が変わる (単一の日数を直書きしていたら落ちる)', () => {
			const freeNote = buildDeletionExportNotes('free').join('\n');
			const standardNote = buildDeletionExportNotes('standard').join('\n');

			expect(freeNote).not.toBe(standardNote);
			expect(freeNote).toContain(String(getPlanLimits('free').historyRetentionDays));
			expect(standardNote).toContain(String(getPlanLimits('standard').historyRetentionDays));
		});

		it('historyRetentionDays が null のプランは日数ではなく「上限なし」の別文を出す', () => {
			// family は保存期間の上限を持たない (= null)
			expect(getPlanLimits('family').historyRetentionDays).toBeNull();

			const joined = buildDeletionExportNotes('family').join('\n');

			expect(joined).toContain(DELETION_EXPORT_NOTE_LABELS.retentionUnlimited);
			// 「null日間」「undefined日間」のような値の穴埋めをしていない
			expect(joined).not.toContain('null日間');
			expect(joined).not.toContain('undefined日間');
			// 有限プラン向けの日数入り文型も出さない
			expect(joined).not.toContain('保存期間は');
		});

		it('日数は SSOT (getPlanLimits) 由来で、値を差し替えると文面も変わる', () => {
			// 値を直書きしていたら override しても文面が変わらず落ちる。
			// 実際の保存期間ポリシー変更 (90 → 別値) と同じ経路を試験する。
			retentionDaysOverride.value = 7;
			try {
				expect(buildDeletionExportNotes('free').join('\n')).toContain(
					DELETION_EXPORT_NOTE_LABELS.retentionLimited(7),
				);
			} finally {
				retentionDaysOverride.value = undefined;
			}
		});

		it('無期限は override でも別文に切り替わる (null 判定が日数側に漏れない)', () => {
			retentionDaysOverride.value = null;
			try {
				const joined = buildDeletionExportNotes('free').join('\n');
				expect(joined).toContain(DELETION_EXPORT_NOTE_LABELS.retentionUnlimited);
			} finally {
				retentionDaysOverride.value = undefined;
			}
		});

		it('法的主張ではなく事実だけを述べる', () => {
			for (const tier of ['free', 'standard', 'family'] as const) {
				const joined = buildDeletionExportNotes(tier).join('\n');
				for (const claim of ['GDPR', '準拠', '法令', '個人情報保護法']) {
					expect(joined).not.toContain(claim);
				}
			}
		});
	});

	// ============================================================
	// generateSiblingComparison
	// ============================================================

	describe('generateSiblingComparison', () => {
		it('きょうだい比較データを生成する', async () => {
			mockFindAllChildren.mockResolvedValue([
				{ id: '1', nickname: 'たろう', age: 6 },
				{ id: '2', nickname: 'はなこ', age: 4 },
			]);
			mockFindStatuses
				.mockResolvedValueOnce([
					{
						categoryId: asCategoryId(1),
						totalXp: 200,
						level: 5,
						peakXp: 200,
						updatedAt: '2026-04-17',
					},
				])
				.mockResolvedValueOnce([
					{
						categoryId: asCategoryId(1),
						totalXp: 100,
						level: 3,
						peakXp: 100,
						updatedAt: '2026-04-17',
					},
				]);

			const result = await generateSiblingComparison('tenant-1');

			expect(result.children).toHaveLength(2);
			expect(result.children[0]?.nickname).toBe('たろう');
			expect(result.children[0]?.totalPoints).toBe(200);
			expect(result.children[1]?.nickname).toBe('はなこ');
			expect(result.children[1]?.totalPoints).toBe(100);
		});
	});

	// ============================================================
	// generateDeletionExport
	// ============================================================

	describe('generateDeletionExport', () => {
		it('free プランで minimal エクスポートを生成する', async () => {
			mockFindAllChildren.mockResolvedValue([]);

			const result = await generateDeletionExport({
				tenantId: 'tenant-1',
				planTier: 'free',
			});

			expect(result.scope).toBe('minimal');
		});

		it('standard プランで full エクスポートを生成する', async () => {
			const result = await generateDeletionExport({
				tenantId: 'tenant-1',
				planTier: 'standard',
			});

			expect(result.scope).toBe('full');
			expect(mockExportFamilyData).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
		});

		it('family プランで family エクスポート（full + sibling）を生成する', async () => {
			mockFindAllChildren.mockResolvedValue([{ id: '1', nickname: 'たろう', age: 6 }]);
			mockFindStatuses.mockResolvedValue([]);

			const result = await generateDeletionExport({
				tenantId: 'tenant-1',
				planTier: 'family',
			});

			expect(result.scope).toBe('family');
			expect(mockExportFamilyData).toHaveBeenCalled();
		});
	});
});
