// tests/e2e/child-challenge-card-badge.spec.ts
// #3333 — 子供 UI チャレンジ対象「カード演出」統合 E2E
//
// 旧 ChallengeBanner 横長バナー (`[data-testid="challenge-banners"]`) を撤廃し、チャレンジ対象は
// 対象カテゴリの CategorySection ヘッダーに静的バッジ (`[data-testid^="challenge-target-badge-"]`)
// + インライン進捗で表示する設計（#2146/#2168 カード演出統合思想への整合）。
//
// AC 検証:
// - AC1: 旧横長バナー (`[data-testid="challenge-banners"]`) は描画されない (0 件、全 5 age mode)
// - AC2: 当週チャレンジ対象カテゴリのヘッダーに challenge-target-badge が表示される
//        (auto:weekly はホーム load で冪等生成されるため demo fixture でも 1 件は存在する)
// - AC3: バッジは flow inline（モーダル禁止、ADR-0012 anti-engagement）

// #4489: worker 分離 fixture 経由にする。素の `@playwright/test` は config 既定の baseURL
// (port 5190 = worker DB 0) に固定され、どの worker で走っても DB 0 を見るため、
// 他 worker で走る spec の一時 seed を観測しうる。
import { expect, test } from './fixtures';
import {
	expandAllCategories,
	selectBabyChild,
	selectElementaryChildAndDismiss,
	selectJuniorChildAndDismiss,
	selectKinderChildAndDismiss,
	selectSeniorChildAndDismiss,
} from './helpers';

/** 本 spec が「未完了」を assert する 2 児 (demo fixture の nickname)。 */
const GATING_NICKNAMES = ['けんたくん', 'ゆうこちゃん'] as const;

/**
 * 対象 child の child_challenges を demo fixture の baseline (未完了 / 未受取) へ戻す (#4489)。
 *
 * auto:weekly は活動記録のたびに currentValue が進み、targetValue 到達で completed=1 になる。
 * worker DB は spec 間で共有されるため、先行 spec の記録量で本 test の前提が壊れる。
 * 「前に何も走っていない」に依存させないため、assert 直前に自分で前提を作る。
 *
 * 戻す先は demo fixture の初期状態そのものなので、後続 spec を汚さない (むしろ復元側)。
 */
async function resetChallengeProgressToBaseline(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const placeholders = GATING_NICKNAMES.map(() => '?').join(', ');
		db.prepare(
			`UPDATE child_challenges
			    SET completed = 0, completed_at = NULL, reward_claimed = 0, current_value = 0, status = 'active'
			  WHERE child_id IN (SELECT id FROM children WHERE nickname IN (${placeholders}))`,
		).run(...GATING_NICKNAMES);
	} finally {
		db.close();
	}
}

test.describe('#3333 チャレンジ カード演出統合 — 旧横長バナー撤廃 (AC1)', () => {
	test('preschool: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('elementary: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectElementaryChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('junior: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectJuniorChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('senior: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectSeniorChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('baby: 旧 challenge-banners が描画されない（親準備モード）', async ({ page }) => {
		await selectBabyChild(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});
});

test.describe('#3333 チャレンジ カード演出統合 — チャレンジ対象バッジ (AC2)', () => {
	test('elementary: チャレンジ対象カテゴリに challenge-target-badge が表示される', async ({
		page,
	}, testInfo) => {
		await selectElementaryChildAndDismiss(page);
		await expandAllCategories(page);
		const badge = page.locator('[data-testid^="challenge-target-badge-"]').first();
		await expect(badge).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-3333/elementary-challenge-badge-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('preschool: チャレンジ対象カテゴリに challenge-target-badge が表示される', async ({
		page,
	}, testInfo) => {
		await selectKinderChildAndDismiss(page);
		await expandAllCategories(page);
		const badge = page.locator('[data-testid^="challenge-target-badge-"]').first();
		await expect(badge).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-3333/preschool-challenge-badge-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
});

test.describe('#3333 Anti-engagement (ADR-0012)', () => {
	test('challenge target badge は flow inline で描画される（モーダル禁止）', async ({ page }) => {
		await selectElementaryChildAndDismiss(page);
		await expandAllCategories(page);
		const badge = page.locator('[data-testid^="challenge-target-badge-"]').first();
		await expect(badge).toBeVisible();
		await expect(badge).not.toHaveAttribute('role', 'dialog');
	});
});

test.describe('#3333 fix (B): ごほうび受取 gating — per-child 受取カード', () => {
	// 受取カード (challenge-reward-claim-card) は「自身の instance が completed=1 かつ rewardClaimed=0」
	// のとき常時出る per-child 個別完了の受取導線（旧 ChallengeBanner の per-instance claim の復元、
	// #2488 must-1 / per-child 報酬 ADR-0055）。#3361 (ux-3): 旧コメントの「かつ !allCompleted」排他は
	// +page.svelte で撤去済（単一児 / 兄弟全完了いずれでも dead-end にせず card で受取可能）。
	// SiblingCelebration は dismissible な祝福演出のみで claim form を持たない。
	// act→outcome (claim → card 消滅 → 残高加算) の貫通は child-challenge-claim-flow.spec.ts (#3361) が担う。
	//
	// 正常系（completed=1 → 受取カード表示 → claim 成功 → 既請求拒否）の gating は demo fixture が全件
	// completed=0 のため deterministic に再現できない（fixture を completed 化すると elementary child の
	// home visual-regression baseline を破壊する）。そのため正常系 + fail-closed は
	// tests/unit/services/child-challenge-service.test.ts の claimChildChallengeReward gating で
	// 網羅する。本 e2e は「未完了 demo 状態で受取カードが spurious に出ない」negative gating を保証する。
	//
	// #4489: 前提条件は**自分で作る**。auto:weekly チャレンジは活動を記録するたび currentValue が
	// 進み、targetValue に達すると completed=1 / rewardClaimed=0 になる (child-challenge-service.ts
	// `newValue >= challenge.targetValue` → markCompleted)。worker DB は spec 間で共有されるため、
	// 先に走った活動記録系 spec の記録が積み上がっていると本 test の前提 (全件 completed=0) が
	// 壊れ、受取カードが出て落ちる。統合 PR #4484 で shard 配分が変わった際に実際に発生した。
	// 「前に何も走っていない」に依存せず、assert 直前に demo baseline (未完了) へ戻す。
	// assertion 自体は toHaveCount(0) のまま弱めていない (ADR-0006)。
	test.beforeEach(async ({ workerDbPath }) => {
		await resetChallengeProgressToBaseline(workerDbPath);
	});

	test('elementary: 未完了 demo 状態で受取カードが描画されない（spurious 表示なし）', async ({
		page,
	}) => {
		await selectElementaryChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-reward-claim-card"]')).toHaveCount(0);
	});

	test('junior: 未完了 demo 状態で受取カードが描画されない', async ({ page }) => {
		await selectJuniorChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-reward-claim-card"]')).toHaveCount(0);
	});
});
