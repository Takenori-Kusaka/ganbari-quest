// tests/e2e/plan-gated-features.spec.ts
// #776: プラン別ゲート UI の E2E 検証
//
// ローカル auth モードでは plan-limit-service の resolvePlanTier が
// 早期 return で常に 'family' を返すため、プランゲートを E2E で検証できない。
// この spec は AUTH_MODE=cognito + COGNITO_DEV_MODE=true 前提で実行し、
// DevCognitoAuthProvider のプラン別ダミーユーザー（free/standard/family）で
// ログイン → 実際のプランゲート UI を検証する。
//
// #1535: loginAsPlan() を storageState ベースに移行（describe ブロック分割）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-gated-features
//
// 対応ゲート:
//  - /admin/rewards: 「+ 追加」manual の locked-but-active（free のみ lock マーカー、EPIC #3533 §10.2.3）
//
// #2316 削除済 ゲート:
//  - /admin/messages: ひとことメッセージボタン (free/standard disabled, family enabled)
//    → #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
//      メッセージ機能は応援機能の付随要素として全プラン解放された
//      (ADR-0006 assertion erosion ban に従い skip ではなく削除)

import { expect, type Page, test } from '@playwright/test';
import { PLAN_FULL_TERMS, REWARD_ADMIN_TERMS } from '../../src/lib/domain/terms';
import { openMenu } from './helpers/goal-flows';

// ============================================================
// #4992: 「編集」のロック表示を検証するためのごほうび seed
// ============================================================
// cognito-dev の DB (global-setup が作る data/ganbari-quest.db、全 dev tenant で共有) は
// お子さまにごほうびが入っている保証が無い (実測: はなこちゃん / けんたくん とも 0 件)。
// fullyParallel で他 test (standard の取込等) と同じ DB を触るため、各 test が**自分専用の 1 件**を
// 直接 seed し、自分の行だけを検証して afterEach で消す (account-deletion.spec の DB 直接操作と同型)。
const E2E_DB_PATH = 'data/ganbari-quest.db';
const REWARD_4992_TITLE_PREFIX = 'E2E編集ゲート4992';

interface SeededReward4992 {
	childId: number;
	rewardId: number;
}

async function seedReward4992(suffix: string): Promise<SeededReward4992> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(E2E_DB_PATH);
	try {
		// admin/rewards のタブに出るのは archive されていないお子さまだけ
		// (cognito-dev の DB では id 最小のたろうくんが archive 済み)
		const child = db
			.prepare('SELECT MIN(id) AS id FROM children WHERE COALESCE(is_archived, 0) = 0')
			.get() as { id: number | null } | undefined;
		if (!child?.id) throw new Error('No active children seeded (global-setup.ts)');
		const result = db
			.prepare(
				`INSERT INTO special_rewards (child_id, title, points, icon, category, granted_at)
				 VALUES (?, ?, 50, '🎁', 'とくべつ', CURRENT_TIMESTAMP)`,
			)
			.run(child.id, `${REWARD_4992_TITLE_PREFIX}-${suffix}-${Date.now()}`);
		return { childId: child.id, rewardId: Number(result.lastInsertRowid) };
	} finally {
		db.close();
	}
}

async function deleteReward4992(rewardId: number): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(E2E_DB_PATH);
	try {
		db.prepare('DELETE FROM special_rewards WHERE id = ?').run(rewardId);
	} finally {
		db.close();
	}
}

/** seed したごほうびのお子さまを SSR で選択済みにして /admin/rewards を開く (タブ click の hydration race 回避) */
async function gotoSeededReward4992(page: Page, seeded: SeededReward4992): Promise<void> {
	await page.goto(`/admin/rewards?childId=${seeded.childId}`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId(`reward-item-${seeded.rewardId}`)).toBeVisible({
		timeout: 15_000,
	});
}

/**
 * 無料プランの「編集」: 押す前に理由が読め、押すと拒否ではなくプランの案内が開く (#4992)。
 */
async function expectFreeEditExplainedBeforePress(page: Page, rewardId: number): Promise<void> {
	// 押す前に: 理由の注記が常時見えている
	const note = page.getByTestId('reward-edit-gate-note');
	await expect(note).toBeVisible();
	await expect(note).toContainText(`「${REWARD_ADMIN_TERMS.edit}」`);
	await expect(note).toContainText(`${PLAN_FULL_TERMS.standard}以上`);

	// 本物の編集ボタン (説明なしの disabled を含む) は出さず、🔒 付きのロック表示にする
	await expect(page.getByTestId(`reward-edit-btn-${rewardId}`)).toHaveCount(0);
	const locked = page.getByTestId(`reward-edit-locked-btn-${rewardId}`);
	await expect(locked).toBeVisible();
	await expect(locked).toContainText(REWARD_ADMIN_TERMS.edit);
	await expect(locked).toContainText('🔒');
	// 支援技術にも「実行できない」と「その理由」を伝える (理由 = 上の注記)
	await expect(locked).toHaveAttribute('aria-disabled', 'true');
	await expect(locked).toHaveAttribute('aria-describedby', 'reward-edit-gate-note');

	// 理由はボタンの近く (一覧の直上 = ボタンより上) にある
	const noteBox = await note.boundingBox();
	const lockedBox = await locked.boundingBox();
	expect(noteBox).not.toBeNull();
	expect(lockedBox).not.toBeNull();
	expect(noteBox?.y ?? 0).toBeLessThan(lockedBox?.y ?? 0);

	// 押すと理由とプラン画面へのリンクが開く。編集 dialog は開かない。
	// aria-disabled の要素は Playwright の actionability で「disabled」扱いになるため force で押す
	// (実ブラウザでは押せる = 押して理由を読めることがこの UI の仕様)。
	// hydration 前の click は握り潰されるので、開くまで押し直す。
	const popover = page.locator('[data-testid="feature-gate-popover"]:visible');
	await expect(async () => {
		if ((await popover.count()) === 0) await locked.click({ force: true });
		await expect(popover).toHaveCount(1, { timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(popover).toContainText(`${PLAN_FULL_TERMS.standard}以上`);
	await expect(popover.getByTestId('feature-gate-popover-link')).toHaveAttribute(
		'href',
		'/admin/subscription',
	);
	await expect(page.getByTestId('reward-edit-dialog')).toBeHidden();
}

// ============================================================
// /admin/rewards — #728 カスタムごほうびプランゲート
// ============================================================
test.describe('#776 /admin/rewards プランゲート — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	// EPIC #3533 §10.2.3: 旧 rewards-upgrade-banner (slot 4 常設 CTA バナー) は撤去。
	//   free の gate は「+ 追加」dropdown の manual 項目が locked-but-active (lock マーカー +
	//   選択でプラン画面遷移) で表現される。banner が消え、gate signal が manual 項目へ移ったことを検証する
	//   (ADR-0006: assertion は弱体化でなく新 UX 機構への置換。click→プラン画面遷移の goal 完遂は AC6 で担保)。
	test('free プランでは manual 追加が locked-but-active (lock マーカー) + 常設バナーなし', async ({
		page,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
		// #4609: Ark UI Menu の trigger は hydration 前 click が握り潰される。共有 helper で開く
		await openMenu(page, 'rewards-add-menu', 'menu-item-manual');
		await expect(page.getByTestId('menu-item-manual')).toContainText('🔒');
	});

	// #4992 (PO 決裁 Q2): 取り込んだごほうびの編集は有料のまま。ただし無料で「編集」を**黙って**
	// 押せない状態にしない — 押せない理由 (スタンダード以上の機能) を押す前にボタンの近くで読める。
	// 旧実装は説明なしの disabled だった (押しても何も起きず、理由はどこにも出なかった)。
	test('free プランの「編集」は押す前に理由が読め、押すと拒否ではなくプランの案内が開く (#4992)', async ({
		page,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性

		const seeded = await seedReward4992('free');
		try {
			await gotoSeededReward4992(page, seeded);
			await expectFreeEditExplainedBeforePress(page, seeded.rewardId);
		} finally {
			await deleteReward4992(seeded.rewardId);
		}
	});

	// #4928: プリセットの取込は全プラン可 (初期セットアップと同じ、#4915 の PO 判断)。
	// free でも marketplace の取込 CTA から着地したら子供選択 dialog が開く。
	// 有料で止まるのはオリジナルの登録 (上の manual 追加の lock) だけ。
	test('free プランで reward-set 取込 URL に着地 → 子供選択 dialog が開き、プラン案内は出さない (#4928)', async ({
		page,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性

		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });

		await expect(page.getByTestId('reward-import-child-selection-dialog')).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId('rewards-upgrade-link')).toHaveCount(0);
	});

	test('free プランで reward-set 詳細 → 取込 CTA がそのまま出る (#4928)', async ({ page }) => {
		test.slow();

		await page.goto('/marketplace/reward-set/kinder-rewards', { waitUntil: 'domcontentloaded' });
		const cta = page.getByTestId('reward-set-import-cta');
		await expect(cta).toBeVisible({ timeout: 15_000 });
		await expect(cta).toHaveAttribute('href', '/admin/rewards?import=kinder-rewards');
		await expect(page.getByTestId('marketplace-import-locked')).toHaveCount(0);
	});

	// 交換型ルール (rule-preset exchange) も取込先が /admin/rewards なので同じ扱い。
	test('free プランで 交換型ルール詳細 → 取込 CTA がそのまま出る (#4928)', async ({ page }) => {
		test.slow();

		await page.goto('/marketplace/rule-preset/night-owl-pass', {
			waitUntil: 'domcontentloaded',
		});
		await expect(page.getByTestId('rule-preset-import-cta')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('marketplace-import-locked')).toHaveCount(0);
	});
});

test.describe('#776 /admin/rewards プランゲート — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランでは manual 追加が gate なし (lock マーカーなし) + 常設バナーなし', async ({
		page,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
		// #4609: Ark UI Menu の trigger は hydration 前 click が握り潰される。共有 helper で開く
		await openMenu(page, 'rewards-add-menu', 'menu-item-manual');
		await expect(page.getByTestId('menu-item-manual')).not.toContainText('🔒');
	});

	// #4992: free の注記・ロック表示の対 (standard では編集できるので、ゲート痕跡を一切出さない)
	test('standard プランでは「編集」がそのまま押せ、ロック表示も理由の注記も出ない (#4992)', async ({
		page,
	}) => {
		test.slow();

		const seeded = await seedReward4992('standard');
		try {
			await gotoSeededReward4992(page, seeded);

			await expect(page.getByTestId('reward-edit-gate-note')).toHaveCount(0);
			await expect(page.getByTestId(`reward-edit-locked-btn-${seeded.rewardId}`)).toHaveCount(0);
			const editBtn = page.getByTestId(`reward-edit-btn-${seeded.rewardId}`);
			await expect(editBtn).toBeVisible();
			await expect(editBtn).toBeEnabled();
			await expect(editBtn).not.toContainText('🔒');
			// 押すと編集 dialog が開く (standard は実際に編集できる = ロックの対が成立している)。
			// hydration 前の click は握り潰されるので、開くまで押し直す。
			const dialog = page.getByTestId('reward-edit-dialog');
			await expect(async () => {
				if (!(await dialog.isVisible())) await editBtn.click();
				await expect(dialog).toBeVisible({ timeout: 2_000 });
			}).toPass({ timeout: 20_000 });
			await expect(page.locator('[data-testid="feature-gate-popover"]:visible')).toHaveCount(0);
		} finally {
			await deleteReward4992(seeded.rewardId);
		}
	});

	// #2894 AC5: paid tier (standard) は reward-set 取込が成功し一覧に反映される
	// (free の 403 と対になる positive case)。upgrade 導線は出ない。
	test('standard プランで reward-set 取込 → 成功 + upgrade 導線なし (#2894 AC5)', async ({
		page,
	}) => {
		test.slow();

		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 15_000 });

		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(resp.ok()).toBeTruthy();

		// 成功 banner が出て `[object Object]` も upgrade 導線も出ない。
		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 10_000 });
		await expect(banner).not.toContainText('[object Object]');
		await expect(banner).not.toContainText('スタンダードプラン以上');
		await expect(page.getByTestId('rewards-upgrade-link')).toHaveCount(0);
	});
});

test.describe('#776 /admin/rewards プランゲート — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランでは manual 追加が gate なし (lock マーカーなし) + 常設バナーなし', async ({
		page,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
		// #4609: Ark UI Menu の trigger は hydration 前 click が握り潰される。共有 helper で開く
		await openMenu(page, 'rewards-add-menu', 'menu-item-manual');
		await expect(page.getByTestId('menu-item-manual')).not.toContainText('🔒');
	});
});

// ============================================================
// /admin/challenges — #2402 QM must-3 (OWASP A01) challenge-set import family ゲート
// ============================================================
// 兄弟チャレンジは family-only 機能。client-side `{#if !isFamily}` UI ゲートを
// 直接 POST でバイパスできないよう、サーバー側でも family プラン厳密比較を実施。
//
// **検証層**: unit テスト (`tests/unit/routes/admin-challenges-marketplace-import-plan-gate.test.ts`)
// で action handler を直接呼び出して検証する。
//
// E2E (`request.post`) で同等の検証を試みたところ、SvelteKit の CSRF 保護
// (`Cross-site POST form submissions are forbidden`) が family ゲートに到達する前に
// レスポンスを差し替えるため、E2E 層で gate メッセージを assert できない問題があった
// (PR #2402 e2e-cognito-dev failure)。
// unit テストで action handler を直接呼ぶことで CSRF を回避しつつ、ADR-0006 に従い
// 403 family gate の assertion 強度は維持する (検証層を移動するだけで弱体化させない)。
