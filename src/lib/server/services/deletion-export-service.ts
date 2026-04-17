// src/lib/server/services/deletion-export-service.ts
// #740: アカウント削除前のプラン別データエクスポート
//
// プラン別エクスポート範囲:
// - free:     子供名・活動履歴サマリ（最小限の JSON）
// - standard: フルエクスポート（活動ログ全件、スタンプカード、特別報酬、メッセージ）
// - family:   上記 + きょうだい比較データ

import type { ExportData, ExportOptions } from '$lib/domain/export-format';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import type { PlanTier } from './plan-limit-service';
import { resolveFullPlanTier } from './plan-limit-service';

// ============================================================
// Types
// ============================================================

export type ExportScope = 'minimal' | 'full' | 'family';

export interface DeletionExportOptions {
	tenantId: string;
	planTier: PlanTier;
}

export interface DeletionExportResult {
	scope: ExportScope;
	data: MinimalExportData | ExportData;
	generatedAt: string;
}

/** free プラン向けの最小限エクスポート */
export interface MinimalExportData {
	format: 'ganbari-quest-deletion-export';
	version: '1.0.0';
	exportedAt: string;
	scope: 'minimal';
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
	firstRecordDate: string | null;
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

// ============================================================
// Scope resolution
// ============================================================

/**
 * プランティアからエクスポートスコープを判定する。
 */
export function resolveExportScope(planTier: PlanTier): ExportScope {
	switch (planTier) {
		case 'family':
			return 'family';
		case 'standard':
			return 'full';
		case 'free':
		default:
			return 'minimal';
	}
}

// ============================================================
// Minimal export (free plan)
// ============================================================

/**
 * free プラン向けの最小限エクスポートを生成する。
 *
 * 子供名と活動サマリのみ含む。法的要件（個人情報保護法のデータポータビリティ権）に
 * 最低限対応するためのもの。
 */
export async function generateMinimalExport(tenantId: string): Promise<MinimalExportData> {
	const repos = getRepos();
	const allChildren = await repos.child.findAllChildren(tenantId);
	const allActivities = await repos.activity.findActivities(tenantId);

	const children: MinimalChildExport[] = allChildren.map((c) => ({
		nickname: c.nickname,
		age: c.age,
		uiMode: c.uiMode,
		createdAt: c.createdAt,
	}));

	const activitySummary: ActivitySummaryExport[] = [];

	for (const child of allChildren) {
		const statuses = await repos.status.findStatuses(child.id, tenantId);

		// カテゴリ別集計
		const categories = statuses.map((s) => ({
			name: getCategoryName(s.categoryId),
			count: s.totalXp,
		}));

		const totalPoints = statuses.reduce((sum, s) => sum + s.totalXp, 0);

		activitySummary.push({
			childNickname: child.nickname,
			totalActivities: allActivities.length,
			totalPoints,
			categories,
			firstRecordDate: child.createdAt.split('T')[0] ?? null,
			lastRecordDate: null, // サマリレベルでは最終記録日は省略
		});
	}

	return {
		format: 'ganbari-quest-deletion-export',
		version: '1.0.0',
		exportedAt: new Date().toISOString(),
		scope: 'minimal',
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

		const categorySummary = statuses.map((s) => ({
			categoryCode: getCategoryCode(s.categoryId),
			totalXp: s.totalXp,
			level: s.level,
		}));

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
			const data = await generateMinimalExport(tenantId);
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
			const familyData = {
				...data,
				siblingComparison: siblingData,
			};
			return { scope, data: familyData as ExportData, generatedAt };
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

// ============================================================
// Helpers
// ============================================================

const CATEGORY_NAMES: Record<number, string> = {
	1: 'うんどう',
	2: 'べんきょう',
	3: 'せいかつ',
	4: 'こうりゅう',
	5: 'そうぞう',
};

const CATEGORY_CODES: Record<number, string> = {
	1: 'undou',
	2: 'benkyou',
	3: 'seikatsu',
	4: 'kouryuu',
	5: 'souzou',
};

function getCategoryName(categoryId: number): string {
	return CATEGORY_NAMES[categoryId] ?? 'その他';
}

function getCategoryCode(categoryId: number): string {
	return CATEGORY_CODES[categoryId] ?? 'unknown';
}
