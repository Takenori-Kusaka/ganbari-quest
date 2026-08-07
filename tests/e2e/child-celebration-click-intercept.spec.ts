// cspell:ignore dismissable
// ↑ `@zag-js/dismissable` は実在の package 名。英語としては dismissible が正しいが、
//   参照している実装の名前なので綴りは変えない (global words には足さない = file scope)。
// tests/e2e/child-celebration-click-intercept.spec.ts
//
// #4433: ログインボーナス overlay が祝福ダイアログの click を intercept する回帰テスト。
//
// 症状: 子供のホームに「達成祝福 (SiblingCelebration)」と「ログインボーナス (StampPressOverlay)」が
//   同時に立ち上がる。祝福は `--z-celebration` (200)、ログインボーナスは `--z-modal` (50) なので
//   **祝福が手前に見えている**が、Ark UI (zag-js) の dismissable-layer は「最後に開いた layer」だけを
//   操作可能にするため、下の layer になった祝福は pointer-events を失う。
//   → 子供には押せるように見えて押せない。祝福を閉じられなければ、その先の活動記録にも進めない。
//
// 本 spec が固定する不変条件:
//   ① 見えている dialog は必ず押せる (見えているのに click が intercept される状態を作らない)
//   ② docs/DESIGN.md §10「侵襲的演出を重ねない」— 着地時に開いている全画面 dialog は 1 枚だけ
//
// seed 方針は child-challenge-celebration-once.spec.ts (#4410) と同型。あわせて
// login_streaks を「昨日まで」に巻き戻し、ログインボーナスが必ず発火する状態を作る
// (これをやらないと overlap 自体が起きず、テストが素通りする)。

import { expect, test } from './fixtures';
import { selectElementaryChild } from './helpers';

const ELEMENTARY_NICKNAME = 'けんたくん';
const SEED_SOURCE = 'e2e-4433-click-intercept';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 任意日数 offset の JST 日付を YYYY-MM-DD で返す (server の todayDateJST と同 offset)。 */
function jstDate(offsetDays: number): string {
	const ms = Date.now() + JST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000;
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 「祝福が未表示」かつ「ログインボーナス未受領」の状態を作る。
 * 両方が同時に立ち上がる条件を DB 側で確定させ、overlap が偶然に左右されないようにする。
 */
async function seedBothPending(workerDbPath: string): Promise<{ challengeId: number }> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get(ELEMENTARY_NICKNAME) as { id: number } | undefined;
		if (!child) throw new Error(`${ELEMENTARY_NICKNAME} not found in worker DB`);

		// ログインボーナスを「今日はまだ受け取っていない」状態に戻す (#3330 counter 縮約後の table)。
		db.prepare('UPDATE login_streaks SET last_login_date = ? WHERE child_id = ?').run(
			jstDate(-1),
			child.id,
		);

		// 未表示の「兄弟の応援」も 1 件積む。**祝福より先に出る演出を必ず 1 つ作る**ことで、
		// 「祝福が queue で待っている間は描画しない」ところまで検証範囲に入れる
		// (これが無いと祝福が常に先頭になり、描画 gate を外しても overlap が起きず素通りする)。
		const sender = db.prepare('SELECT id FROM children WHERE id != ? LIMIT 1').get(child.id) as
			| { id: number }
			| undefined;
		if (!sender) throw new Error('応援の送り主にする別の子供が worker DB に居ません');
		db.prepare(
			`INSERT INTO sibling_cheers (from_child_id, to_child_id, stamp_code, tenant_id, sent_at, shown_at)
			 VALUES (?, ?, 'sugoi', 'e2e-4433', CURRENT_TIMESTAMP, NULL)`,
		).run(sender.id, child.id);

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
				'E2E祝福重なりチャレンジ',
				'#4433 click intercept',
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

async function cleanupSeededChallenges(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		// worker DB は spec 間で共有されるため、seed した応援も必ず除去する
		// (tests/CLAUDE.md「共有 worker DB を汚染しない」)。
		db.prepare("DELETE FROM sibling_cheers WHERE tenant_id = 'e2e-4433'").run();
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
 * 子供ホームで自動的に開く「全画面の侵襲的演出」と、その閉じるボタン。
 * 出す順序は実装の判断に委ねるが、**同時に 2 枚開いてはいけない** (DESIGN.md §10)。
 */
const AUTO_OVERLAYS = [
	{ name: 'ログインボーナス', overlay: 'stamp-press-overlay', close: 'login-bonus-confirm' },
	{ name: '兄弟の応援', overlay: 'cheer-overlay', close: 'cheer-overlay-close' },
	{ name: '達成祝福', overlay: 'sibling-celebration', close: 'sibling-celebration-close' },
] as const;

/** いま見えている自動 overlay の名前一覧 (同時に開いている枚数の判定に使う)。 */
async function visibleAutoOverlays(page: import('@playwright/test').Page): Promise<string[]> {
	const names: string[] = [];
	for (const o of AUTO_OVERLAYS) {
		if (
			await page
				.getByTestId(o.overlay)
				.isVisible()
				.catch(() => false)
		)
			names.push(o.name);
	}
	return names;
}

test.describe('#4433 祝福とログインボーナスが重なっても子供は祝福を閉じられる', () => {
	// dev server の on-demand compile で初回遷移が長引くため (#4410 spec と同方針)。
	test.slow();

	test.afterEach(async ({ workerDbPath }) => {
		await cleanupSeededChallenges(workerDbPath);
	});

	test('子供は必ず祝福を閉じられる (見えている overlay の click が intercept されない)', async ({
		page,
		workerDbPath,
	}) => {
		await seedBothPending(workerDbPath);
		await selectElementaryChild(page);

		const celebration = page.getByTestId('sibling-celebration');
		const loginBonus = page.getByTestId('stamp-press-overlay');

		// ① 何かが出るまで待つ (どれが先に出るかは実装の判断に委ねる)
		await expect
			.poll(async () => (await visibleAutoOverlays(page)).length, { timeout: 30_000 })
			.toBeGreaterThan(0);

		// ② 祝福が出るまで、先に出ている演出を閉じて queue を進める
		for (let i = 0; i < AUTO_OVERLAYS.length; i++) {
			if (await celebration.isVisible().catch(() => false)) break;
			const other = AUTO_OVERLAYS.filter((o) => o.overlay !== 'sibling-celebration');
			let closedAny = false;
			for (const o of other) {
				if (
					await page
						.getByTestId(o.overlay)
						.isVisible()
						.catch(() => false)
				) {
					await page.getByTestId(o.close).click({ timeout: 5_000 });
					await expect(page.getByTestId(o.overlay)).toBeHidden();
					closedAny = true;
					break;
				}
			}
			if (!closedAny) break;
		}

		// ③ 祝福は seed (celebration_shown_at IS NULL) で必ず pending なので、**必ず出る**。
		//    ここを hard assertion にしておかないと「祝福が一度も出ない」実装でも素通りする。
		await expect(celebration).toBeVisible();

		// ④ 見えているなら押せる。現行実装は祝福が見えたまま click を intercept されて落ちる
		//    (= #4433 の defect。z-index ではなく zag-js の layer 順で pointer-events を失う)。
		await page.getByTestId('sibling-celebration-close').click({ timeout: 5_000 });
		await expect(celebration).toBeHidden();

		// ⑤ 祝福の裏で待たされていたログインボーナスが、閉じたあとに出て来て**閉じられる**。
		//    seed で未受領を保証しているので必ず pending。ここが出なければ
		//    「queue に積んだきり次を出さない」= 子供がボーナスを受け取れない別 dead-end になる。
		await expect(loginBonus).toBeVisible();
		await page.getByTestId('login-bonus-confirm').click({ timeout: 5_000 });
		await expect(loginBonus).toBeHidden();
	});

	test('DESIGN.md §10: 侵襲的演出を 2 枚同時に開かない', async ({ page, workerDbPath }) => {
		await seedBothPending(workerDbPath);
		await selectElementaryChild(page);

		await expect
			.poll(async () => (await visibleAutoOverlays(page)).length, { timeout: 30_000 })
			.toBeGreaterThan(0);

		// 着地直後、および各 overlay を閉じた直後のいずれでも同時 2 枚にならない。
		for (let i = 0; i < AUTO_OVERLAYS.length; i++) {
			const open = await visibleAutoOverlays(page);
			expect(open, `同時に開いている演出: ${open.join(' + ')}`).toHaveLength(1);

			const current = AUTO_OVERLAYS.find((o) => o.name === open[0]);
			if (!current) break;
			await page.getByTestId(current.close).click({ timeout: 5_000 });
			await expect(page.getByTestId(current.overlay)).toBeHidden();

			// 次の 1 枚が出るのを待つ。出なければ (= queue が空) そこで終わり。
			// 固定待ちは使わない (tests/CLAUDE.md: waitForTimeout 禁止)。
			const hasNext = await expect
				.poll(async () => (await visibleAutoOverlays(page)).length, { timeout: 5_000 })
				.toBeGreaterThan(0)
				.then(() => true)
				.catch(() => false);
			if (!hasNext) break;
		}
	});
});
