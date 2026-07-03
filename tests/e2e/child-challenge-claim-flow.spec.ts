// tests/e2e/child-challenge-claim-flow.spec.ts
//
// #3361 (第10回監査 ux-2, sev3/harm=T): 再設計 challenge claim-card の act→outcome 統合テスト。
//
// 背景:
//   再設計後の受取カード (challenge-reward-claim-card、単一 claim 経路) は #3333 で導入されたが、
//   claim 実行 → card 消滅 → 残高加算 の act→outcome カバレッジが欠落していた。既存
//   child-challenge-card-badge.spec.ts は「未完了 demo 状態で spurious 表示なし」の negative gating
//   のみで、実際に claim ボタンを押して goal が完遂するかを一度も検証していなかった
//   (tests/CLAUDE.md「render-only 禁止 / act→outcome assert 必須」= #2544 CX-DoR #1 違反相当の gap)。
//
// なぜ demo fixture でなく worker DB 直接 seed か:
//   demo fixture は全 child_challenges が completed=0 (child-home visual-regression baseline を
//   壊さないため意図的、child-challenge-card-badge.spec.ts:89- 参照)。正常系 (completed=1) を
//   deterministic に再現するには、baseline に映らない sentinel row を test 内で seed し afterEach で
//   除去する (child-shop-exchange.spec.ts の workerDbPath 直接操作 pattern と同型)。
//
// AC (#3361):
//   - AC1: claim 実行 → card 消滅 + 残高 (point_ledger child_challenge 行) 加算を assert
//   - AC3 (ux-4): claim 失敗 (既請求) 経路が role=alert (Toast) で可視フィードバックを返す (dead-end 回避)

import { expect, test } from './fixtures';
import { selectElementaryChildAndDismiss } from './helpers';

const ELEMENTARY_NICKNAME = 'けんたくん';
// sentinel: auto:weekly unique index (child_id, start_date) を避けつつ cleanup を精密化する。
const SEED_SOURCE = 'e2e-3361-claim-flow';
const CLAIM_POINTS = 30;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 任意日数 offset の JST 日付を YYYY-MM-DD で返す (server の todayDateJST と同 offset)。 */
function jstDate(offsetDays: number): string {
	const ms = Date.now() + JST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000;
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * けんたくん (elementary) 用に completed=1 / rewardClaimed=0 の受取可能な child_challenge を
 * seed する。start/end は今日を中心とした広い window にして JST↔ローカル境界 skew を吸収する。
 * @returns {childId, challengeId}
 */
async function seedClaimableChallenge(
	workerDbPath: string,
): Promise<{ childId: number; challengeId: number }> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get(ELEMENTARY_NICKNAME) as { id: number } | undefined;
		if (!child) throw new Error(`${ELEMENTARY_NICKNAME} not found in worker DB`);
		const childId = child.id;

		const info = db
			.prepare(
				`INSERT INTO child_challenges (
					child_id, title, description, challenge_type, period_type,
					start_date, end_date, target_config, reward_config,
					status, is_active, source_template_id,
					current_value, target_value, completed, completed_at,
					reward_claimed, reward_claimed_at
				) VALUES (?, ?, ?, 'cooperative', 'weekly', ?, ?, ?, ?, 'completed', 1, ?, ?, ?, 1, ?, 0, NULL)`,
			)
			.run(
				childId,
				'E2E受取チャレンジ',
				'#3361 act→outcome test',
				jstDate(-3),
				jstDate(10),
				JSON.stringify({ metric: 'count', categoryId: 1, baseTarget: 5 }),
				JSON.stringify({ points: CLAIM_POINTS, message: 'よくがんばったね' }),
				SEED_SOURCE,
				5,
				5,
				jstDate(0),
			);
		return { childId, challengeId: Number(info.lastInsertRowid) };
	} finally {
		db.close();
	}
}

/** seed した challenge の reward_claimed を強制的に 1 に flip (並行 claim シミュレーション)。 */
async function forceMarkClaimed(workerDbPath: string, challengeId: number): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare('UPDATE child_challenges SET reward_claimed = 1 WHERE id = ?').run(challengeId);
	} finally {
		db.close();
	}
}

/** point_ledger の child_challenge 加算行 (reference_id = challengeId) を返す。 */
async function getChallengeLedger(
	workerDbPath: string,
	challengeId: number,
): Promise<Array<{ amount: number }>> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		return db
			.prepare(
				"SELECT amount FROM point_ledger WHERE reference_id = ? AND type = 'child_challenge'",
			)
			.all(challengeId) as Array<{ amount: number }>;
	} finally {
		db.close();
	}
}

/** sentinel seed 行 + その claim ledger を worker DB から除去する (共有 DB 汚染防止)。 */
async function cleanupSeededChallenges(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const rows = db
			.prepare('SELECT id FROM child_challenges WHERE source_template_id = ?')
			.all(SEED_SOURCE) as Array<{ id: number }>;
		for (const { id } of rows) {
			db.prepare(
				"DELETE FROM point_ledger WHERE reference_id = ? AND type = 'child_challenge'",
			).run(id);
		}
		db.prepare('DELETE FROM child_challenges WHERE source_template_id = ?').run(SEED_SOURCE);
	} finally {
		db.close();
	}
}

test.describe('#3361 challenge claim-card act→outcome (受取 → card 消滅 → 残高加算)', () => {
	// dev (`npm run dev`) は初回 route 到達時に vite が on-demand compile するため、
	// 冷え server では /switch → /elementary/home の初回遷移が既定 30s を超えうる (CI は
	// `npm run preview` = ビルド済で該当しない)。act→outcome 検証が server 温度で flake しないよう
	// 本 spec のみ timeout を広げる (assertion は弱めない)。
	test.slow();

	test.afterEach(async ({ workerDbPath }) => {
		await cleanupSeededChallenges(workerDbPath);
	});

	test('AC1: claim ボタン押下で card が消え、point_ledger に報酬が加算される', async ({
		page,
		workerDbPath,
	}) => {
		const { challengeId } = await seedClaimableChallenge(workerDbPath);

		// seed 後にホームを開くと load が seed 済 challenge を activeChallenges に含める
		await selectElementaryChildAndDismiss(page);

		const card = page.locator('[data-testid="challenge-reward-claim-card"]');
		await expect(card).toBeVisible();

		// 加算前は child_challenge ledger 行が存在しない
		expect(await getChallengeLedger(workerDbPath, challengeId)).toHaveLength(0);

		// act: 受取 → form action 発火を待つ
		const claimBtn = page.locator('[data-testid="challenge-reward-claim-btn"]');
		await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('claimChallengeReward') && res.request().method() === 'POST',
			),
			claimBtn.click(),
		]);

		// outcome ①: card が消滅 (dead-end でない = 押したら状態遷移する)
		await expect(card).toHaveCount(0);

		// outcome ②: 残高 (point_ledger child_challenge 行) がちょうど 1 件 +CLAIM_POINTS 加算
		await expect
			.poll(async () => await getChallengeLedger(workerDbPath, challengeId))
			.toEqual([{ amount: CLAIM_POINTS }]);
	});

	test('AC3 (ux-4): 既請求 claim は role=alert (Toast) で可視フィードバックを返す（dead-end 回避）', async ({
		page,
		workerDbPath,
	}, testInfo) => {
		const { challengeId } = await seedClaimableChallenge(workerDbPath);

		await selectElementaryChildAndDismiss(page);
		const card = page.locator('[data-testid="challenge-reward-claim-card"]');
		await expect(card).toBeVisible();

		// 並行 claim を DB 側で先行させ、この後の submit を fail(400) 「すでに受け取り済みです」に落とす
		await forceMarkClaimed(workerDbPath, challengeId);

		const claimBtn = page.locator('[data-testid="challenge-reward-claim-btn"]');
		await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('claimChallengeReward') && res.request().method() === 'POST',
			),
			claimBtn.click(),
		]);

		// outcome: role=alert (Toast) で失敗が可視化される (押しても無反応 = dead-end ではない)
		const alert = page.locator('[role="alert"]', { hasText: 'うけとれなかったよ' });
		await expect(alert).toBeVisible();
		await expect(alert).toContainText('すでに受け取り済みです');

		await page.screenshot({
			path: `docs/screenshots/pr-3361/claim-error-toast-${testInfo.project.name}.png`,
			fullPage: true,
		});

		// 二重付与なし: 既請求のため ledger 加算は発生しない
		expect(await getChallengeLedger(workerDbPath, challengeId)).toHaveLength(0);
	});
});
