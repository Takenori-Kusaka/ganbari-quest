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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Pre-PMF fallback に置換されていた repo は Wave 群 (#2824) ですべて DynamoDB 本実装に移行済。
// #3213 (EPIC #3193): auto-challenge-repo 削除済 (auto_challenges 廃止、child_challenges へ一本化)。
// #2824 Wave 5A (ADR-0055): battle-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-battle-repo.test.ts (AWS SDK mock) で検証する。
// #2824 (ADR-0055): child-activity-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-child-activity-repo.test.ts (AWS SDK mock) で検証する。
// #2824 Wave 3A (ADR-0055): message-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-message-repo.test.ts (AWS SDK mock) で検証する。
// #2824 Phase 2A (ADR-0055): reward-redemption-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-reward-redemption-repo.test.ts (AWS SDK mock) で検証する。
// #2824 Wave 6B (ADR-0055、本 PR): cloud-export-repo / report-daily-summary-repo /
//   viewer-token-repo を DynamoDB 本実装に置換し stub を全廃 (baseline 0)。これら 3 repo の
//   機能等価性は dynamodb-{cloud-export,report-daily-summary,viewer-token}-repo.test.ts
//   (AWS SDK mock) で検証する。本実装後 stub に退行していないことの guard は本ファイル末尾の
//   describe('#2824 Wave 6B 本実装 repo の stub 退行禁止') が担う。
// #2295 (EPIC #2294 ①): season-event-repo / tenant-event-repo 削除済 (2026-05-19)
// #2458 (Path B sibling drop): sibling-challenge-repo 削除済 (2026-05-26)、child-challenge-repo へ移行
// #2824 Wave 5B (ADR-0055): sibling-cheer-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-sibling-cheer-repo.test.ts (AWS SDK mock) で検証する。
// #2824 Wave 3B (ADR-0055): stamp-card-repo は本実装済のため stub fallback テスト対象外。
//   機能等価性は tests/unit/db/dynamodb-stamp-card-repo.test.ts (AWS SDK mock) で検証する。

const TENANT = 'test-tenant';
const TODAY = '2026-05-19';

describe('#2263 hotfix: DynamoDB Pre-PMF fallback 動作検証', () => {
	// #2295 (EPIC #2294 ①): season-event-repo describe 削除済 (2026-05-19、repo 自体撤去)

	// #3213 (EPIC #3193): auto-challenge-repo 削除済 (auto_challenges 廃止、child_challenges へ一本化)。

	// #2824 Wave 5A (ADR-0055): battle-repo は本実装済 (stub 除外)。
	//   LP machine-tour ④ feature-rpg-battle 訴求の日次バトル (進行 / 勝敗 / 報酬 / 敵図鑑) が
	//   本番 DynamoDB Lambda で永続する。本実装の機能等価性テストは dynamodb-battle-repo.test.ts
	//   に分離。ここで stub 前提の assert を残すと「実装済なのに stub 期待」で誤った退行 gate に
	//   なるため除外する (他 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	// #2824 (ADR-0055): child-activity-repo は本実装済 (stub 除外)。
	//   marketplace per-child 取込 (importActivities → insertActivitiesBulk) が本番 DynamoDB
	//   Lambda で永続する。本実装の機能等価性テストは dynamodb-child-activity-repo.test.ts に分離。
	//   ここで stub 前提の assert を残すと「実装済なのに stub 期待」で誤った退行 gate になるため
	//   除外する (残 fallback repo の assert は維持 = assertion 弱体化に該当しない)。

	// #2824 Wave 3A (ADR-0055): message-repo は本実装済 (stub 除外)。
	//   おうえんメッセージ (親→子、LP feature-cheer-message 訴求) が本番 DynamoDB Lambda で
	//   永続する。本実装の機能等価性テストは dynamodb-message-repo.test.ts に分離。

	// #2824 Phase 2A (ADR-0055): reward-redemption-repo は本実装済 (stub 除外)。
	//   ごほうび交換 (記録 → ポイント → 交換) が本番 DynamoDB Lambda で永続する。本実装の
	//   機能等価性テストは dynamodb-reward-redemption-repo.test.ts に分離。

	// #2824 Wave 6B (ADR-0055、本 PR): cloud-export-repo / report-daily-summary-repo /
	//   viewer-token-repo は DynamoDB 本実装に置換し stub を全廃 (baseline 0)。これら 3 repo の
	//   機能等価性テストは dynamodb-{cloud-export,report-daily-summary,viewer-token}-repo.test.ts
	//   に分離。stub 退行禁止 guard は本ファイル末尾の describe を参照。

	// #2458 (Path B sibling drop): sibling-challenge-repo describe 削除済 (2026-05-26)、
	// repo / table 物理 drop 済。per-child child-challenge-repo に移行 (ADR-0055 / User §6)。

	// #2824 Wave 5B (ADR-0055): sibling-cheer-repo は本実装済 (stub 除外)。
	//   きょうだいおうえん送信 (SiblingCheerOverlay) が本番 DynamoDB Lambda で永続する。
	//   本実装の機能等価性テストは dynamodb-sibling-cheer-repo.test.ts に分離。ここで stub 前提の
	//   assert を残すと「実装済なのに stub 期待」で誤った退行 gate になるため除外する
	//   (他 repo の fallback assert は維持 = assertion 弱体化に該当しない)。

	// #2824 Wave 3B (ADR-0055): stamp-card-repo は本実装済 (stub 除外)。
	//   子供 home 自動押印 (?/loginStamp) → スタンプ獲得 → 週末 redeem が本番 DynamoDB Lambda
	//   で永続する。本実装の機能等価性テストは dynamodb-stamp-card-repo.test.ts に分離。

	// #2295 (EPIC #2294 ①): tenant-event-repo describe 削除済 (2026-05-19、repo 自体撤去)

	// #2824 Wave 6A (main / #2854) + Wave 6B (本 PR) の両 Wave 完了により、SSR 経路で
	//   呼ばれる DynamoDB repo はすべて本実装に移行し stub fallback は全廃した
	//   (stub baseline = 空)。これにより本ファイルの「method が throw しない」型の
	//   stub fallback assert (cloud-export / report-daily-summary / viewer-token /
	//   auto-challenge) は不要となり全て除外する。本実装後の機能等価性は各 repo 個別の
	//   dynamodb-*-repo.test.ts (AWS SDK mock) で、stub 退行禁止は末尾 describe で担保する。
	//
	// #2295 (EPIC #2294 ①): seasonEventRepo / tenantEventRepo 削除済 (2026-05-19)、12 → 10 repo
	// #2458 (Path B sibling drop): siblingChallengeRepo 削除済 (2026-05-26)、10 → 9 repo
	// #2263 regression hotfix: childActivityRepo を stub fallback に置換 (9 → 10 repo)
	// #2824 系で childActivity / rewardRedemption / message / stampCard / battle /
	//   siblingCheer / autoChallenge / cloudExport / reportDailySummary / viewerToken を
	//   本実装化 (10 → 0 repo)。これで stub fallback repo は SSR 経路から消滅した。
	//   (#3213 で autoChallenge repo は auto_challenges 廃止に伴い削除済)
	describe('regression guard: stub fallback repo が SSR 経路から全廃された', () => {
		it('Pre-PMF stub fallback baseline は空 (新規 stub なし) である', () => {
			// #2263 root cause: SSR の Promise.all 経路で 1 repo でも throw すると 500 になる。
			//   本実装移行後は stub fallback repo がゼロのため、並列呼び出しで reject される
			//   stub fallback 自体が存在しない。stub への退行は parity guard
			//   (scripts/check-dynamodb-stub-parity.mjs、baseline=空) と末尾 describe が機械検出する。
			const baselinePath = join(
				dirname(fileURLToPath(import.meta.url)),
				'../../../scripts/dynamodb-stub-baseline.json',
			);
			const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, string[]>;
			expect(Object.keys(baseline)).toEqual([]);
		});
	});

	// #2824 Wave 6B 本実装 repo の stub 退行禁止 (read=空 / write=no-op への退行 guard)。
	//   本実装した 3 repo が将来うっかり stub (read=[] / write=no-op) に差し戻されると、
	//   有料本番 SaaS で write 永続 gap が再発する (#2263 / #2824 の根本 defect)。AWS SDK を
	//   呼ばずに「stub 化 = read が必ず空を返す」を検出するため、各 repo を mock client で
	//   1 件返すよう仕込み、空配列が返ってこない (= 実 Query を発行している) ことを確認する。
	describe('#2824 Wave 6B 本実装 repo の stub 退行禁止', () => {
		it('cloud-export / report-daily-summary / viewer-token は mock client 経由で実 Query を発行する', async () => {
			vi.resetModules();
			const mockSend = vi.fn().mockResolvedValue({ Items: [], Count: 0 });
			vi.doMock('../../../src/lib/server/db/dynamodb/client', () => ({
				getDocClient: () => ({ send: mockSend }),
				TABLE_NAME: 'test-table',
			}));

			const cloudExport = await import('../../../src/lib/server/db/dynamodb/cloud-export-repo');
			const reportDailySummary = await import(
				'../../../src/lib/server/db/dynamodb/report-daily-summary-repo'
			);
			const viewerToken = await import('../../../src/lib/server/db/dynamodb/viewer-token-repo');

			await cloudExport.findByTenant(TENANT);
			await reportDailySummary.findByTenantAndDateRange(TENANT, TODAY, TODAY);
			await viewerToken.findByTenant(TENANT);

			// stub なら client.send は 1 度も呼ばれず空配列を直返しする。本実装は必ず send する。
			expect(mockSend).toHaveBeenCalled();
			vi.doUnmock('../../../src/lib/server/db/dynamodb/client');
			vi.resetModules();
		});
	});
});
