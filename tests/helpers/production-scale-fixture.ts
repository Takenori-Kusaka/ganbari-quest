// tests/helpers/production-scale-fixture.ts
//
// 「本番相当データ量」(活動 N 件・子供 M 人・bonus rule セット K 件) の tenant を
// repo 層 (PGlite / DSQL) に直接 seed する共通ヘルパ。
//
// sqlite の少量 fixture では再現しない不具合クラス (#4907 / #4923、PO 指摘 2026-09-11)
// が繰り返し発生したため、既存 integration test (`tests/integration/db/pg-backend-parity.test.ts`
// 等) 個別実装の seed ロジックを汎用化した。新規に「本番相当データ量で再現する」regression
// test を書くときはこのヘルパを再利用し、都度 seed コードを書き下さない。
//
// 関連: ADR-0064 (PGlite integration test 基盤) / #3531

import { CATEGORY_CODES } from '../../src/lib/domain/categories';
import { asCategoryId, type ChildId } from '../../src/lib/domain/ids';
import type { getRepos } from '../../src/lib/server/db/factory';

type Repos = ReturnType<typeof getRepos>;

export interface ProductionScaleFixtureOptions {
	/** 対象テナント id */
	tenantId: string;
	/** 子供の人数 (既定 2) */
	childCount?: number;
	/** 活動の総数 (子供間に均等分配、既定 45) */
	activityCount?: number;
	/** ボーナスルールセット数 (`rule_preset_bonus_overrides` settings KVS、既定 5) */
	bonusRuleSetCount?: number;
}

export interface ProductionScaleFixtureResult {
	/** 作成した子供 id (childCount 件) */
	childIds: ChildId[];
}

/**
 * 活動 N 件・子供 M 人・bonus rule セット K 件を repo 層に直接 seed する。
 *
 * 少量 fixture (子供 1 人・活動数件) では顕在化しない「本番相当データ量」依存の不具合
 * (#4907: 本番のみ setup questionnaire のチェックリスト自動作成が空振り) を PGlite /
 * DSQL staging で再現するための共通ヘルパ。
 */
export async function seedProductionScaleFixture(
	repos: Repos,
	{
		tenantId,
		childCount = 2,
		activityCount = 45,
		bonusRuleSetCount = 5,
	}: ProductionScaleFixtureOptions,
): Promise<ProductionScaleFixtureResult> {
	const childIds: ChildId[] = [];
	for (let i = 0; i < childCount; i++) {
		const child = await repos.child.insertChild(
			{ nickname: `本番相当こども${i + 1}`, age: 8 + (i % 8) },
			tenantId,
		);
		childIds.push(child.id);
	}

	for (let i = 0; i < activityCount; i++) {
		const childId = childIds[i % childIds.length];
		const categoryCode = CATEGORY_CODES[i % CATEGORY_CODES.length];
		if (!childId || !categoryCode) {
			throw new Error(
				'[production-scale-fixture] childCount / CATEGORY_CODES が空 — activityCount の分配元が無い',
			);
		}
		await repos.childActivity.insertActivity(
			{
				childId,
				name: `本番相当活動${i + 1}`,
				categoryId: asCategoryId(categoryCode),
				icon: '📝',
				basePoints: 5,
			},
			tenantId,
		);
	}

	// #4907 教訓: この module は integration test から `beforeAll` 実行前 (test file の
	// 静的 import 解決時) に読み込まれるため、`saveBonusOverrides` を top-level で静的 import
	// すると `vi.resetModules()` + `initPgliteConnection()` より前に factory/connection の
	// モジュールインスタンスが確定してしまい、「init 未完了」で失敗する。動的 import で
	// 呼び出し時点 (init 完了後) まで解決を遅延させる。
	const { saveBonusOverrides } = await import(
		'../../src/lib/marketplace/strategies/rule-preset/bonus-state'
	);
	await saveBonusOverrides(
		{
			presets: Array.from({ length: bonusRuleSetCount }, (_, i) => ({
				presetId: `production-scale-bonus-${i + 1}`,
				presetName: `本番相当ボーナスルール${i + 1}`,
				presetIcon: '🎯',
				enabled: true,
				rules: [
					{
						title: `ボーナス${i + 1}`,
						description: '本番相当データ量 fixture (production-scale-fixture)',
						icon: '🎯',
						pointBonus: 5,
					},
				],
				importedAt: new Date().toISOString(),
			})),
		},
		tenantId,
	);

	return { childIds };
}
