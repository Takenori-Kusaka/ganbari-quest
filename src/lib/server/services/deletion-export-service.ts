// src/lib/server/services/deletion-export-service.ts
// #740: アカウント削除前のプラン別データエクスポート
//
// プラン別エクスポート範囲:
// - free:     子供名・活動履歴サマリ（最小限の JSON）
// - standard: フルエクスポート（活動ログ全件、スタンプカード、特別報酬、メッセージ）
// - family:   上記 + きょうだい比較データ

import { jstDateOfIso } from '$lib/domain/date-utils';
import type { ExportScope } from '$lib/domain/deletion-export-scope';
import { resolveExportScope } from '$lib/domain/deletion-export-scope';
import type { ExportData } from '$lib/domain/export-format';
import { DELETION_EXPORT_NOTE_LABELS } from '$lib/domain/labels';
import { getCategoryById } from '$lib/domain/validation/activity';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import type { PlanTier } from './plan-limit-service';
import { getPlanLimits, resolveFullPlanTier } from './plan-limit-service';

// ============================================================
// Types
// ============================================================

// スコープ判定の SSOT は domain leaf (退会画面が押す前の説明に使うため client からも import する)。
// 既存 import 元を壊さないためここから再 export する。
export type { ExportScope };
export { resolveExportScope };

export interface DeletionExportOptions {
	tenantId: string;
	planTier: PlanTier;
}

export interface DeletionExportResult {
	scope: ExportScope;
	data: MinimalExportData | ExportData | FamilyExportData;
	generatedAt: string;
}

/** free プラン向けの最小限エクスポート */
export interface MinimalExportData {
	format: 'ganbari-quest-deletion-export';
	version: '1.0.0';
	exportedAt: string;
	scope: 'minimal';
	/**
	 * 顧客が JSON 単体を読んだときに値を誤解しないための但し書き (#4470)。
	 * 日付の timezone / null の意味 / 保存期間外データの扱いを事実だけ記す。
	 * `activitySummary` の各要素ではなく top-level に置く (子供の人数だけ重複させない)。
	 */
	notes: string[];
	children: MinimalChildExport[];
	activitySummary: ActivitySummaryExport[];
}

export interface MinimalChildExport {
	nickname: string;
	age: number;
	uiMode: string;
	createdAt: string;
}

export interface ActivitySummaryExport {
	childNickname: string;
	totalActivities: number;
	totalPoints: number;
	categories: { name: string; count: number }[];
	/**
	 * 活動ログの **最初の記録日** (JST 暦日 `YYYY-MM-DD`)。記録が 1 件も無ければ null (#4450)。
	 * 子供の登録日ではない (登録日は `MinimalChildExport.createdAt`)。
	 */
	firstRecordDate: string | null;
	/** 活動ログの **最後の記録日** (JST 暦日 `YYYY-MM-DD`)。記録が 1 件も無ければ null (#4450)。 */
	lastRecordDate: string | null;
}

/** family プラン向けのきょうだい比較データ */
export interface SiblingComparisonExport {
	children: Array<{
		nickname: string;
		totalPoints: number;
		level: number;
		streakRecord: number;
		categorySummary: { categoryCode: string; totalXp: number; level: number }[];
	}>;
}

/** family プラン向けエクスポート（フルエクスポート + きょうだい比較） */
export interface FamilyExportData extends ExportData {
	siblingComparison: SiblingComparisonExport;
}

// ============================================================
// Minimal export (free plan)
// ============================================================

/**
 * エクスポート JSON に載せる但し書きを組み立てる (#4470 / #4473)。
 *
 * 保存期間の日数は `PlanLimits.historyRetentionDays` が唯一の SSOT。
 * ここで 90 / 365 を書くと保存期間ポリシー変更時に JSON だけ古い日数を語る二重管理になるため、
 * 値は必ず `getPlanLimits(planTier)` から引く (labels 側も値を持たず引数で受ける)。
 *
 * `historyRetentionDays: null` = 保存期間の上限なし。「null日間」の穴埋めにせず別文を出す。
 */
export function buildDeletionExportNotes(planTier: PlanTier): string[] {
	const retentionDays = getPlanLimits(planTier).historyRetentionDays;

	return [
		DELETION_EXPORT_NOTE_LABELS.jstCalendarDate,
		DELETION_EXPORT_NOTE_LABELS.nullMeansNoRecord,
		retentionDays === null
			? DELETION_EXPORT_NOTE_LABELS.retentionUnlimited
			: DELETION_EXPORT_NOTE_LABELS.retentionLimited(retentionDays),
		DELETION_EXPORT_NOTE_LABELS.createdAtPointer,
	];
}

/**
 * free プラン向けの最小限エクスポートを生成する。
 *
 * 子供名と活動サマリのみ含む。法的要件（個人情報保護法のデータポータビリティ権）に
 * 最低限対応するためのもの。
 *
 * `planTier` は但し書きの保存期間日数を決めるために受け取る (#4473)。
 * 呼び出し側が握っているプランをそのまま渡すこと (ここで free 固定にすると、
 * 将来 minimal scope の対象プランが増えたときに嘘の日数を配ることになる)。
 */
export async function generateMinimalExport(
	tenantId: string,
	planTier: PlanTier,
): Promise<MinimalExportData> {
	const repos = getRepos();
	const allChildren = await repos.child.findAllChildren(tenantId);

	const children: MinimalChildExport[] = allChildren.map((c) => ({
		nickname: c.nickname,
		age: c.age,
		uiMode: c.uiMode,
		createdAt: c.createdAt,
	}));

	const activitySummary: ActivitySummaryExport[] = [];

	for (const child of allChildren) {
		const statuses = await repos.status.findStatuses(child.id, tenantId);
		const childLogs = await repos.activity.findActivityLogs(child.id, tenantId);

		// カテゴリ別集計
		const categories = statuses.map((s) => {
			const catDef = getCategoryById(s.categoryId);
			return {
				name: catDef?.name ?? 'その他',
				count: s.totalXp,
			};
		});

		const totalPoints = statuses.reduce((sum, s) => sum + s.totalXp, 0);

		// 記録期間は活動ログの実データから出す (#4450)。repo の返却順に依存しないよう
		// min/max を取る (sqlite / dsql は recordedAt DESC、demo repo は無順序)。
		// 暦日は JST 固定 — ISO 文字列の slice は UTC 暦日になり JST 00:00〜09:00 の記録が
		// 前日へ落ちる (#4120 / ADR-0049 retention 監査との突き合わせが 1 日ずれる)。
		const recordedDates = childLogs
			.map((log) => log.recordedAt)
			.filter((recordedAt): recordedAt is string => typeof recordedAt === 'string' && !!recordedAt)
			.map(jstDateOfIso)
			.sort();

		activitySummary.push({
			childNickname: child.nickname,
			totalActivities: childLogs.length,
			totalPoints,
			categories,
			firstRecordDate: recordedDates[0] ?? null,
			lastRecordDate: recordedDates[recordedDates.length - 1] ?? null,
		});
	}

	return {
		format: 'ganbari-quest-deletion-export',
		version: '1.0.0',
		exportedAt: new Date().toISOString(),
		scope: 'minimal',
		notes: buildDeletionExportNotes(planTier),
		children,
		activitySummary,
	};
}

// ============================================================
// Full export (standard+)
// ============================================================

/**
 * standard 以上向けのフルエクスポートを生成する。
 * 既存の export-service.ts の exportFamilyData をそのまま利用する。
 */
export async function generateFullExport(tenantId: string): Promise<ExportData> {
	// dynamic import で循環参照を回避
	const { exportFamilyData } = await import('./export-service');
	return exportFamilyData({ tenantId });
}

// ============================================================
// Family export (family plan additional data)
// ============================================================

/**
 * family プラン向けのきょうだい比較データを生成する。
 */
export async function generateSiblingComparison(
	tenantId: string,
): Promise<SiblingComparisonExport> {
	const repos = getRepos();
	const allChildren = await repos.child.findAllChildren(tenantId);

	const children: SiblingComparisonExport['children'] = [];

	for (const child of allChildren) {
		const statuses = await repos.status.findStatuses(child.id, tenantId);

		const categorySummary = statuses.map((s) => {
			const catDef = getCategoryById(s.categoryId);
			return {
				categoryCode: catDef?.code ?? 'unknown',
				totalXp: s.totalXp,
				level: s.level,
			};
		});

		const totalPoints = statuses.reduce((sum, s) => sum + s.totalXp, 0);
		const maxLevel = statuses.reduce((max, s) => Math.max(max, s.level), 0);

		children.push({
			nickname: child.nickname,
			totalPoints,
			level: maxLevel,
			streakRecord: 0, // 最大連続記録は別途取得が必要（将来拡張）
			categorySummary,
		});
	}

	return { children };
}

// ============================================================
// Unified deletion export
// ============================================================

/**
 * 削除前エクスポートを生成する（プラン別スコープ適用）。
 *
 * アカウント削除確認画面から呼び出される。
 */
export async function generateDeletionExport(
	options: DeletionExportOptions,
): Promise<DeletionExportResult> {
	const { tenantId, planTier } = options;
	const scope = resolveExportScope(planTier);

	logger.info('[deletion-export] Generating export', {
		context: { tenantId, planTier, scope },
	});

	const generatedAt = new Date().toISOString();

	switch (scope) {
		case 'minimal': {
			const data = await generateMinimalExport(tenantId, planTier);
			return { scope, data, generatedAt };
		}
		case 'full': {
			const data = await generateFullExport(tenantId);
			return { scope, data, generatedAt };
		}
		case 'family': {
			const data = await generateFullExport(tenantId);
			const siblingData = await generateSiblingComparison(tenantId);
			// family エクスポートでは sibling comparison を data に追加
			const familyData: FamilyExportData = {
				...data,
				siblingComparison: siblingData,
			};
			return { scope, data: familyData, generatedAt };
		}
	}
}

/**
 * テナントのプランを解決してからエクスポートを生成する便利関数。
 */
export async function generateDeletionExportForTenant(
	tenantId: string,
	licenseStatus: string,
	planId?: string,
): Promise<DeletionExportResult> {
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, planId);
	return generateDeletionExport({ tenantId, planTier });
}
