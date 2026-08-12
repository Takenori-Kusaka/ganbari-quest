// tests/e2e/child-challenge-celebration-once.spec.ts
//
// #4410: チャレンジ達成の祝福ダイアログを「1 回だけ」出す回帰テスト。
//
// 症状 (オーナー報告 2026-08-07): 「みんなクリア！」祝福が子供のホームに入るたび毎回出る。
//   `showCelebration = $state(true)` がマウントのたび true に戻り、閉じた事実がサーバにも
//   クライアントにも残っていなかった (ADR-0012 anti-engagement / DESIGN.md §10 違反)。
//
// 本 spec が固定する不変条件 (AC5):
//   - 閉じていなければ **出る** (出なくなりすぎる方向の回帰も同時に防ぐ)
//   - 一度閉じたら、リロードでも別ページ経由の再訪でも **出ない**
//   - 閉じた事実は DB (child_challenges.celebration_shown_at) に永続する
//   - 祝福を閉じてもごほうび受取カードは残る (#3333 の単一 claim 経路 / dead-end 回避)
//
// seed 方針は child-challenge-claim-flow.spec.ts と同型 (demo fixture は全 challenge が
// completed=0 で祝福が発火しないため、sentinel 行を worker DB へ直接 seed し afterEach で除去)。

import { expect, test } from './fixtures';
import { selectElementaryChild } from './helpers';

const ELEMENTARY_NICKNAME = 'けんたくん';
const SEED_SOURCE = 'e2e-4410-celebration-once';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 任意日数 offset の JST 日付を YYYY-MM-DD で返す (server の todayDateJST と同 offset)。 */
function jstDate(offsetDays: number): string {
	const ms = Date.now() + JST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000;
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * けんたくん (elementary) 用に completed=1 / rewardClaimed=0 / celebration_shown_at=NULL の
 * challenge を seed する。単一児でも `siblings=[自分]` で allCompleted=true になるため祝福が出る。
 */
async function seedCelebrationChallenge(workerDbPath: string): Promise<{ challengeId: number }> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get(ELEMENTARY_NICKNAME) as { id: number } | undefined;
		if (!child) throw new Error(`${ELEMENTARY_NICKNAME} not found in worker DB`);

		const info = db
			.prepare(
				`INSERT INTO child_challenges (
					child_id, title, description, challenge_type, period_type,
					start_date, end_date, target_config, reward_config,
					status, is_active, source_template_id,
					current_value, target_value, completed, completed_at,
					reward_claimed, reward_claimed_at, celebration_shown_at
				) VALUES (?, ?, ?, 'cooperative', 'weekly', ?, ?, ?, ?, 'completed', 1, ?, ?, ?, 1, ?, 0, NULL, NULL)`,
			)
			.run(
				child.id,
				'E2E祝福チャレンジ',
				'#4410 celebration once',
				jstDate(-3),
				jstDate(10),
				JSON.stringify({ metric: 'count', categoryId: 1, baseTarget: 5 }),
				JSON.stringify({ points: 30, message: 'よくがんばったね' }),
				SEED_SOURCE,
				5,
				5,
				jstDate(0),
			);
		return { challengeId: Number(info.lastInsertRowid) };
	} finally {
		db.close();
	}
}

/** seed 行の celebration_shown_at を読む (永続化されたかの直接確認)。 */
async function readCelebrationShownAt(
	workerDbPath: string,
	challengeId: number,
): Promise<string | null> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const row = db
			.prepare('SELECT celebration_shown_at AS shownAt FROM child_challenges WHERE id = ?')
			.get(challengeId) as { shownAt: string | null } | undefined;
		return row?.shownAt ?? null;
	} finally {
		db.close();
	}
}

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

/**
 * ログインボーナス (おみくじ) overlay が開いていれば閉じる。
 *
 * #4433 以降、子供ホームの自動演出は `DialogFSM` が「同時に 1 枚」に調停するため、
 * 祝福が出ている回のログインボーナスは queue で待つ (= ここでは開いていない)。
 * 一方、祝福より先にログインボーナスが出る回もありうるので、開いていれば閉じる形にしておく。
 * 本 spec の関心は「祝福が 1 回だけか」であり、どちらが先かではない。
 */
async function dismissLoginBonusOverlay(page: import('@playwright/test').Page): Promise<void> {
	const confirm = page.getByTestId('login-bonus-confirm');
	if (await confirm.isVisible().catch(() => false)) {
		await confirm.click();
		await expect(page.getByTestId('stamp-press-overlay')).toBeHidden();
	}
}

/**
 * 遷移し、**client hydration が完了するまで待つ**。
 *
 * 祝福ダイアログは Ark UI の Portal 経由で client でのみ mount されるため、
 * hydration 前に `toHaveCount(0)` を評価すると「まだ mount していないだけ」で無条件に通り、
 * 再表示バグを検出できない (本 spec 作成時に mutation で実証: 表示される状態でも通った)。
 * `(child)/+layout.svelte` が mount 時に fire する `POST /api/v1/usage` の応答を待つことで、
 * client 側の初期化が走り終えた後にだけ「出ない」を判定する。
 */
async function hydratedNavigation(
	page: import('@playwright/test').Page,
	navigate: () => Promise<unknown>,
): Promise<void> {
	// dev server は初回到達 route を on-demand compile するため遷移自体が数秒かかる。
	// 待ち time は伸ばすが「必ず来ること」は緩めない (来なければ fail)。
	const usagePost = page.waitForResponse(
		(res) => res.url().includes('/api/v1/usage') && res.request().method() === 'POST',
		{ timeout: 45_000 },
	);
	await navigate();
	await usagePost;
}

test.describe('#4410 達成祝福は 1 回だけ (閉じた事実の永続化)', () => {
	// dev server の on-demand compile で初回遷移が長引くため (claim-flow spec と同方針)。
	test.slow();

	test.afterEach(async ({ workerDbPath }) => {
		await cleanupSeededChallenges(workerDbPath);
	});

	test('閉じていなければ出る → 閉じる → リロードでも再訪でも出ない', async ({
		page,
		workerDbPath,
	}) => {
		const { challengeId } = await seedCelebrationChallenge(workerDbPath);

		// --- ① 未表示なら出る (出なくなりすぎる方向の回帰ガード) ---
		// helpers の dismissOverlays は開いている dialog を無差別に閉じてしまい祝福まで消すため、
		// 本 spec では使わず、ログインボーナス (おみくじ) だけを実ユーザーと同じ手順で閉じる。
		await selectElementaryChild(page);

		const celebration = page.getByTestId('sibling-celebration');
		await expect(celebration).toBeVisible();
		// AC4: 閉じたあとどこで受け取るのかがダイアログ内に示されている
		await expect(page.getByTestId('sibling-celebration-claim-hint')).toBeVisible();
		expect(await readCelebrationShownAt(workerDbPath, challengeId)).toBeNull();

		// 祝福の上に重なるログインボーナス overlay を先に閉じる (実ユーザーと同じ順序)
		await dismissLoginBonusOverlay(page);
		await expect(celebration).toBeVisible();

		// --- ② 閉じる = サーバに「見せた」を永続化する ---
		const shownPost = page.waitForResponse(
			(res) =>
				res.url().includes('markChallengeCelebrationShown') && res.request().method() === 'POST',
		);
		await page.getByTestId('sibling-celebration-close').click();
		const res = await shownPost;
		expect(res.ok()).toBe(true);
		await expect(celebration).toBeHidden();

		// DB に記録されている (localStorage ではなくサーバ = 端末を変えても再発しない)
		await expect
			.poll(async () => await readCelebrationShownAt(workerDbPath, challengeId))
			.not.toBeNull();

		// --- ③ リロードしても出ない (旧実装はここで再表示されていた) ---
		await hydratedNavigation(page, () => page.reload());
		await expect(celebration).toHaveCount(0);

		// --- ④ 別ページに行って戻っても出ない (component 再マウント経路) ---
		await hydratedNavigation(page, () => page.goto('/elementary/status'));
		await hydratedNavigation(page, () => page.goto('/elementary/home'));
		await expect(celebration).toHaveCount(0);

		// --- ⑤ AC3 / #3333: 祝福を閉じてもごほうび受取カードは残る (dead-end にしない) ---
		await expect(page.getByTestId('challenge-reward-claim-card')).toBeVisible();
	});
});
