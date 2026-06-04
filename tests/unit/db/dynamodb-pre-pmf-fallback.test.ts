/**
 * tests/unit/db/dynamodb-pre-pmf-fallback.test.ts
 *
 * #2263 hotfix: 本番 cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で
 * 12 個の DynamoDB repository が `throw new Error('not implemented')` を出して
 * 500 Internal Server Error を引き起こしていた。
 *
 * CloudWatch Logs 証跡:
 *   Error: season-event-repo: DynamoDB not implemented
 *   [2026-05-19T02:35:03.581Z] [ERROR] GET /preschool/home 500
 *
 * 本テストは以下を検証する:
 *   1. 全 12 repo の各 method が throw せず、Pre-PMF fallback (空配列 / undefined / 0 / no-op) を返す
 *   2. read 系は安全な空値、write 系は no-op
 *   3. SSR で呼ばれて 500 を引き起こす経路が物理的に存在しない
 *
 * これにより、本番 Lambda の `Promise.all([...])` 経路で 1 repo が throw すれば
 * Promise reject → 500 となる時限爆弾を解消する。
 *
 * 関連: ADR-0010 Pre-PMF Bucket B (まだ作らない) / ADR-0002 Critical 修正の品質ゲート
 */

import { describe, expect, it } from 'vitest';

// Pre-PMF fallback に置換された 12 repo
import * as autoChallengeRepo from '../../../src/lib/server/db/dynamodb/auto-challenge-repo';
// #2824 Wave 5A (ADR-0055): battle-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-battle-repo.test.ts (AWS SDK mock) で検証する。
// #2824 (ADR-0055): child-activity-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-child-activity-repo.test.ts (AWS SDK mock) で検証する。
import * as cloudExportRepo from '../../../src/lib/server/db/dynamodb/cloud-export-repo';
// #2824 Wave 3A (ADR-0055): message-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-message-repo.test.ts (AWS SDK mock) で検証する。
import * as reportDailySummaryRepo from '../../../src/lib/server/db/dynamodb/report-daily-summary-repo';
// #2824 Phase 2A (ADR-0055): reward-redemption-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-reward-redemption-repo.test.ts (AWS SDK mock) で検証する。
// #2295 (EPIC #2294 ①): season-event-repo / tenant-event-repo 削除済 (2026-05-19)
// #2458 (Path B sibling drop): sibling-challenge-repo 削除済 (2026-05-26)、child-challenge-repo へ移行
// #2824 Wave 5B (ADR-0055): sibling-cheer-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-sibling-cheer-repo.test.ts (AWS SDK mock) で検証する。
// #2824 Wave 3B (ADR-0055): stamp-card-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-stamp-card-repo.test.ts (AWS SDK mock) で検証する。
import * as viewerTokenRepo from '../../../src/lib/server/db/dynamodb/viewer-token-repo';

const TENANT = 'test-tenant';
const TODAY = '2026-05-19';

describe('#2263 hotfix: DynamoDB Pre-PMF fallback 動作検証', () => {
	// #2295 (EPIC #2294 ①): season-event-repo describe 削除済 (2026-05-19、repo 自体撤去)

	describe('auto-challenge-repo', () => {
		it('全 read method は安全値を返す', async () => {
			await expect(
				autoChallengeRepo.findByChildAndWeek(1, '2026-05-12', TENANT),
			).resolves.toBeUndefined();
			await expect(autoChallengeRepo.findActiveByChild(1, TENANT)).resolves.toBeUndefined();
			await expect(autoChallengeRepo.findByChild(1, TENANT)).resolves.toEqual([]);
		});

		it('write method は throw しない', async () => {
			await expect(
				autoChallengeRepo.insert(
					{ childId: 1, weekStart: '2026-05-12', categoryId: 1, targetCount: 5 },
					TENANT,
				),
			).resolves.toBeTruthy();
			await expect(
				autoChallengeRepo.update(1, { currentCount: 3 }, TENANT),
			).resolves.toBeUndefined();
			await expect(autoChallengeRepo.expireOldChallenges('2026-05-01', TENANT)).resolves.toBe(0);
			await expect(autoChallengeRepo.deleteByTenantId(TENANT)).resolves.toBeUndefined();
		});
	});

	// #2824 Wave 5A (ADR-0055): battle-repo は本実装済 (stub 除外)。
	//   LP machine-tour ④ feature-rpg-battle 訴求の日次バトル (進行 / 勝敗 / 報酬 / 敵図鑑) が
	//   本番 DynamoDB Lambda で永続する。本実装の機能等価性テストは dynamodb-battle-repo.test.ts
	//   に分離。ここで stub 前提の assert を残すと「実装済なのに stub 期待」で誤った退行 gate に
	//   なるため除外する (他 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	// #2824 (ADR-0055): child-activity-repo は本実装済 (stub 除外)。
	//   marketplace per-child 取込 (importActivities → insertActivitiesBulk) が本番 DynamoDB
	//   Lambda で永続する。本実装の機能等価性テストは dynamodb-child-activity-repo.test.ts に分離。
	//   ここで stub 前提の assert を残すと「実装済なのに stub 期待」で誤った退行 gate になるため
	//   除外する (他 11 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	describe('cloud-export-repo', () => {
		it('全 method が throw しない', async () => {
			await expect(cloudExportRepo.findByTenant(TENANT)).resolves.toEqual([]);
			await expect(cloudExportRepo.findByPin('1234')).resolves.toBeUndefined();
			await expect(cloudExportRepo.findById(1, TENANT)).resolves.toBeUndefined();
			await expect(
				cloudExportRepo.insert({
					tenantId: TENANT,
					exportType: 'full',
					pinCode: '1234',
					s3Key: 'k',
					fileSizeBytes: 0,
					expiresAt: TODAY,
				}),
			).resolves.toBeTruthy();
			await expect(cloudExportRepo.incrementDownloadCount(1)).resolves.toBeUndefined();
			await expect(cloudExportRepo.deleteById(1, TENANT)).resolves.toBeUndefined();
			await expect(cloudExportRepo.deleteExpired(TODAY)).resolves.toBe(0);
			await expect(cloudExportRepo.countByTenant(TENANT)).resolves.toBe(0);
		});
	});

	// #2824 Wave 3A (ADR-0055): message-repo は本実装済 (stub 除外)。
	//   おうえんメッセージ (親→子、LP feature-cheer-message 訴求) が本番 DynamoDB Lambda で
	//   永続する。本実装の機能等価性テストは dynamodb-message-repo.test.ts に分離。ここで stub
	//   前提の assert を残すと「実装済なのに stub 期待」で誤った退行 gate になるため除外する
	//   (他 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	describe('report-daily-summary-repo', () => {
		it('全 method が throw しない', async () => {
			await expect(
				reportDailySummaryRepo.findByChildAndDateRange(1, TODAY, TODAY, TENANT),
			).resolves.toEqual([]);
			await expect(
				reportDailySummaryRepo.findByTenantAndDateRange(TENANT, TODAY, TODAY),
			).resolves.toEqual([]);
			await expect(
				reportDailySummaryRepo.upsert({
					tenantId: TENANT,
					childId: 1,
					date: TODAY,
					activityCount: 0,
					categoryBreakdown: '{}',
					checklistCompletion: '{}',
					level: 1,
					totalPoints: 0,
					streakDays: 0,
					newAchievements: 0,
				}),
			).resolves.toBeUndefined();
			await expect(reportDailySummaryRepo.deleteOlderThan(TENANT, TODAY)).resolves.toBe(0);
			await expect(reportDailySummaryRepo.deleteByTenantId(TENANT)).resolves.toBeUndefined();
		});
	});

	// #2824 Phase 2A (ADR-0055): reward-redemption-repo は本実装済 (stub 除外)。
	//   ごほうび交換 (記録 → ポイント → 交換) が本番 DynamoDB Lambda で永続する。本実装の
	//   機能等価性テストは dynamodb-reward-redemption-repo.test.ts に分離。ここで stub 前提の
	//   assert を残すと「実装済なのに stub 期待」で誤った退行 gate になるため除外する
	//   (他 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	// #2458 (Path B sibling drop): sibling-challenge-repo describe 削除済 (2026-05-26)、
	// repo / table 物理 drop 済。per-child child-challenge-repo に移行 (ADR-0055 / User §6)。

	// #2824 Wave 5B (ADR-0055): sibling-cheer-repo は本実装済 (stub 除外)。
	//   きょうだいおうえん送信 (SiblingCheerOverlay) が本番 DynamoDB Lambda で永続する。
	//   本実装の機能等価性テストは dynamodb-sibling-cheer-repo.test.ts に分離。ここで stub 前提の
	//   assert を残すと「実装済なのに stub 期待」で誤った退行 gate になるため除外する
	//   (他 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	// #2824 Wave 3B (ADR-0055): stamp-card-repo は本実装済 (stub 除外)。
	//   子供 home 自動押印 (?/loginStamp) → スタンプ獲得 → 週末 redeem が本番 DynamoDB Lambda
	//   で永続する。本実装の機能等価性テストは dynamodb-stamp-card-repo.test.ts に分離。ここで
	//   stub 前提の assert を残すと「実装済なのに stub 期待」で誤った退行 gate になるため除外する
	//   (他 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	// #2295 (EPIC #2294 ①): tenant-event-repo describe 削除済 (2026-05-19、repo 自体撤去)

	describe('viewer-token-repo', () => {
		it('全 method が throw しない', async () => {
			await expect(viewerTokenRepo.findByTenant(TENANT)).resolves.toEqual([]);
			await expect(viewerTokenRepo.findByToken('tok')).resolves.toBeUndefined();
			await expect(viewerTokenRepo.insert({ token: 'tok' }, TENANT)).resolves.toBeTruthy();
			await expect(viewerTokenRepo.revoke(1, TENANT)).resolves.toBeUndefined();
			await expect(viewerTokenRepo.deleteById(1, TENANT)).resolves.toBeUndefined();
		});
	});

	describe('regression guard: 全 4 repo の Promise.all で reject されない', () => {
		it('SSR /preschool/home の典型的な 4 repo 並列呼び出しが全 fulfill する', async () => {
			// #2295 (EPIC #2294 ①): seasonEventRepo / tenantEventRepo 削除済 (2026-05-19)、12 → 10 repo
			// #2458 (Path B sibling drop): siblingChallengeRepo 削除済 (2026-05-26)、10 → 9 repo
			// #2263 regression hotfix: childActivityRepo を stub fallback に置換 (9 → 10 repo)
			// #2824 (ADR-0055): childActivityRepo を本実装化したため stub fallback guard から除外
			//   (本実装は AWS SDK mock 必須 → dynamodb-child-activity-repo.test.ts で検証)。10 → 9 repo
			// #2824 Phase 2A (ADR-0055): rewardRedemptionRepo を本実装化したため除外
			//   (本実装は AWS SDK mock 必須 → dynamodb-reward-redemption-repo.test.ts で検証)。9 → 8 repo
			// #2824 Wave 3A (ADR-0055): messageRepo を本実装化したため除外
			//   (本実装は AWS SDK mock 必須 → dynamodb-message-repo.test.ts で検証)。8 → 7 repo
			// #2824 Wave 3B (ADR-0055): stampCardRepo を本実装化したため除外
			//   (本実装は AWS SDK mock 必須 → dynamodb-stamp-card-repo.test.ts で検証)。7 → 6 repo
			// #2824 Wave 5A (ADR-0055): battleRepo を本実装化したため除外
			//   (本実装は AWS SDK mock 必須 → dynamodb-battle-repo.test.ts で検証)。6 → 5 repo
			// #2824 Wave 5B (ADR-0055): siblingCheerRepo を本実装化したため除外
			//   (本実装は AWS SDK mock 必須 → dynamodb-sibling-cheer-repo.test.ts で検証)。5 → 4 repo
			const results = await Promise.allSettled([
				autoChallengeRepo.findActiveByChild(1, TENANT),
				cloudExportRepo.findByTenant(TENANT),
				reportDailySummaryRepo.findByChildAndDateRange(1, TODAY, TODAY, TENANT),
				viewerTokenRepo.findByTenant(TENANT),
			]);

			// 1 件でも rejected があれば 500 を引き起こす (#2263 root cause)
			const rejected = results.filter((r) => r.status === 'rejected');
			expect(rejected).toEqual([]);
		});
	});
});
