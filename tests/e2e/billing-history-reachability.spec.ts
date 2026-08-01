// tests/e2e/billing-history-reachability.spec.ts
// #4156 退行 1: 解約済みの顧客が請求書・領収書に到達できない
//
// #4146 の統合後、請求導線は `{#if hasSubscription}` (= `stripeSubscriptionId` あり) の中にしか
// 無かった。解約が確定すると `TERMINAL_CONTRACT_STATE` が `stripeSubscriptionId` を NULL にする
// (`stripeCustomerId` は意図的に残す) ため、請求セクションごと画面から消え、旧 `/admin/billing`
// も 308 で統合先に飛ぶので退路が無かった。唯一残った経路が「解約をご検討の方 → 解約理由を送信
// → Portal」で、**領収書 1 枚のために解約理由レコードを書かされる**状態だった。
//
// 契約状態は local モードでは `families` ではなく settings (`local_tenant_contract`) が持つ
// (`src/lib/server/db/sqlite/auth-repo.ts`、#4156 で固定値 → 永続に変更)。本 spec は worker DB に
// 直接 S5 (解約済み) を書いてから画面を検証し、書いた状態は必ず戻す。

import { expect, test } from './fixtures';

const CONTRACT_KEY = 'local_tenant_contract';

/** contract-state-matrix.md §4 の組み合わせをそのまま書く */
const CONTRACTS = {
	/** S5 契約終了 — 解約確定。customer は残り subscription は消える */
	cancelled: JSON.stringify({ status: 'suspended', stripeCustomerId: 'cus_e2e_4156' }),
	/** S2 課金中 */
	active: JSON.stringify({
		status: 'active',
		plan: 'standard_monthly',
		stripeCustomerId: 'cus_e2e_4156',
		stripeSubscriptionId: 'sub_e2e_4156',
	}),
} as const;

async function setContract(workerDbPath: string, value: string | null): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		if (value === null) {
			db.prepare('DELETE FROM settings WHERE key = ?').run(CONTRACT_KEY);
			return;
		}
		db.prepare(
			"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
				'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
		).run(CONTRACT_KEY, value);
	} finally {
		db.close();
	}
}

test.describe('#4156 請求履歴の到達性は契約の有無から独立している', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ workerDbPath }) => {
		// 他 spec は既定 (未課金) を前提にしているため必ず戻す
		await setContract(workerDbPath, null);
	});

	test('解約済みの顧客が、解約理由の送信を経由せずに請求履歴へ到達できる', async ({
		page,
		workerDbPath,
	}) => {
		await setContract(workerDbPath, CONTRACTS.cancelled);

		// 解約フロー (/admin/subscription/cancel) を通らず、プラン画面を直接開く
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });

		const panel = page.getByTestId('saas-license-panel');
		await expect(panel).toBeVisible();
		// fixture が効いていること (効いていなければ以下の assertion は無意味になる)
		await expect(panel).toHaveAttribute('data-has-subscription', 'false');

		const section = page.getByTestId('billing-history-section');
		await expect(section).toBeVisible();
		const button = page.getByTestId('open-billing-history-button');
		await expect(button).toBeVisible();
		await expect(button).toBeEnabled();

		// 押した結果が必ず可視化されること。決済が有効な配備なら確認ダイアログ、
		// 無効な配備なら理由の提示 (#4161 と同じ扱い)。どちらが走ったかは DOM で確定させる。
		const stripeEnabled = await panel.getAttribute('data-stripe-enabled');
		await button.click();
		if (stripeEnabled === 'true') {
			await expect(page.getByTestId('portal-confirm-button')).toBeVisible();
		} else {
			await expect(page.getByTestId('billing-unavailable-alert')).toBeVisible();
		}
	});

	test('解約済みの告知が「記録できない」と言わない (認可の実挙動と一致、#3993)', async ({
		page,
		workerDbPath,
	}) => {
		await setContract(workerDbPath, CONTRACTS.cancelled);
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });

		const notice = page.getByTestId('contract-state-notice');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAttribute('data-contract-state', 'cancelled');

		const text = (await notice.innerText()).replace(/\s/g, '');
		expect(text).not.toContain('記録やポイントの付与はできません');
		expect(text).not.toContain('ご利用いただけません');
		// 認可は無料プラン相当で書き込みを許可している。その事実を告知が伝えること。
		expect(text).toContain('記録・ポイント付与を続けられます');
	});

	test('契約中は請求履歴セクションを重複させない (出口は同時に 1 つ、#4139 の原則)', async ({
		page,
		workerDbPath,
	}) => {
		await setContract(workerDbPath, CONTRACTS.active);
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });

		const panel = page.getByTestId('saas-license-panel');
		await expect(panel).toHaveAttribute('data-has-subscription', 'true');
		// 契約中は「プラン管理」の Portal ボタンが請求書も含めて担う
		await expect(page.getByTestId('billing-history-section')).toHaveCount(0);
	});

	test('一度も取引が無い顧客には請求履歴を出さない', async ({ page, workerDbPath }) => {
		await setContract(workerDbPath, null);
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });

		await expect(page.getByTestId('saas-license-panel')).toBeVisible();
		await expect(page.getByTestId('billing-history-section')).toHaveCount(0);
	});

	test('解約導線がプラン画面から見えている (特商法の表示義務に接続、AC6)', async ({
		page,
		workerDbPath,
	}) => {
		await setContract(workerDbPath, CONTRACTS.active);
		await page.goto('/admin/subscription', { waitUntil: 'domcontentloaded' });

		const cancelLink = page.getByTestId('subscription-to-cancel');
		await expect(cancelLink).toBeVisible();
		await expect(cancelLink).toHaveAttribute('href', '/admin/subscription/cancel');
	});
});
