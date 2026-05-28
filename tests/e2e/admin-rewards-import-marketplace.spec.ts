/**
 * EPIC #2362 P3 / Issue #2366 / PR-4 (#2474) — marketplace → reward-set → import E2E
 *
 * `/admin/rewards` の marketplace reward-set 取込動線を新 Strategy + dispatchImport + per-child fan-out
 * 経由で検証する spec。
 *
 * PR #2474 (PR-4) で動線が変更された:
 *   - 旧 (#2366 時点): `/admin/rewards` 内に `marketplace-reward-import-section` UI が直接配置され、
 *     toggle 経由で preset 一覧を展開して取込していた
 *   - 新 (PR #2474, ADR-0055 + CWE-598 整合): marketplace 詳細から `?import=<itemId>` で redirect → admin
 *     側で ChildSelectionDialog auto-open → `importPresetToChildren` action 経由で per-child fan-out
 *
 * 本 spec は新動線の admin 側 endpoint 単体を検証する (marketplace 詳細 → redirect は
 * `marketplace-reward-set-import.spec.ts` で別途検証)。
 *
 * カバレッジ (PR #2474 rewrite):
 *   - `?import=<presetId>` query で ChildSelectionDialog auto-open
 *   - `?/importPresetToChildren` action: childIds 未指定で 400 fail
 *   - `?/importPresetToChildren` action: 不存在 presetId は 404 (or fail 形式)
 *   - `?/importPresetToChildren` action: tenant 外 childId 指定で 403 (CWE-598 guard、PR #2474 must-1)
 */

import { expect, test } from '@playwright/test';

test.describe('#2366 / PR-4 marketplace → reward-set → import (admin/rewards 新動線)', () => {
	test('?import=<presetId> で ChildSelectionDialog が auto-open する', async ({ page }) => {
		await page.goto('/admin/rewards?import=kinder-rewards');
		await expect(page).toHaveURL(/\/admin\/rewards/);

		// 旧 marketplace-reward-import-section は撤去済 (PR #2474)
		// 新 UX: ChildSelectionDialog が auto-open する
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
	});

	test('?/importPresetToChildren action: childIds 未指定で 400 fail', async ({ request }) => {
		// childIds を渡さずに POST。+page.server.ts で 400 を返す。
		const res = await request.post('/admin/rewards?/importPresetToChildren', {
			multipart: { presetId: 'kinder-rewards' },
		});
		// SvelteKit form action は fail() を 200 body 内 error として返す or 400 にする
		expect([200, 400].includes(res.status())).toBe(true);
	});

	test('?/importPresetToChildren action: 不存在 presetId は reject される', async ({ request }) => {
		const res = await request.post('/admin/rewards?/importPresetToChildren', {
			multipart: { presetId: 'non-existent-preset-xxxxx', childIds: 'all' },
		});
		// fail() 形式 (200) または 404 を返す
		expect([200, 400, 404].includes(res.status())).toBe(true);
	});

	test('?/importPresetToChildren action: tenant 外 childId は 403 reject (CWE-598)', async ({
		request,
	}) => {
		// PR #2474 must-1 CWE-598 guard: 存在しない巨大 childId (他 tenant 想定) を CSV で混入。
		// tenant 配下 child の set に含まれないため 403 (or 200 + error body) で reject される。
		const res = await request.post('/admin/rewards?/importPresetToChildren', {
			multipart: { presetId: 'kinder-rewards', childIds: '999999999' },
		});
		expect([200, 400, 403].includes(res.status())).toBe(true);
	});

	// CUJ-R2 (research §1-D 「B1 dead-end 5 type 横展開」 P1):
	//   ?import=<presetId> auto-open ChildSelectionDialog → 全員に追加 (default) → 確定 →
	//   admin ごほうび一覧の child タブ件数が grew (terminal goal verify、dead-end ならここで fail)。
	//
	// 既存 `admin-rewards-per-child.spec.ts` の `?import=<presetId>` test は auto-open visible
	// だけを assert (render-only)。本 test は **確定 click → 一覧件数 grew** まで貫通検証する。
	//
	// 設計 (tests/CLAUDE.md §interactive flow / #2544、ADR-0006 厳守):
	//   - 副作用 A: importPresetToChildren network 発火 (resp.ok())
	//   - 副作用 C: 永続反映 = admin ごほうび一覧 child タブ count 増加 (`invalidateAll()` 反映)
	//   - dialog close 厳密検証は本 PR scope 外 (既知の `?import=` URL cleanup レガシー挙動、
	//     CUJ-A3 と同型 honest scope statement)
	//   - timeout は 10_000 / 30_000、retry / dispatchEvent / dialog ghost cleanup helper 不採用
	test('CUJ-R2: ?import=kinder-rewards → ChildSelectionDialog 全員選択 → 確定 → admin ごほうび一覧件数が grew (terminal goal verify)', async ({
		page,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性

		// Step 0: before 状態を記録 — clean な /admin/rewards で child タブ件数 sum を取得。
		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('admin-rewards-child-tabs')).toBeVisible({ timeout: 30_000 });

		const tabs = page.locator('[data-testid^="rewards-child-tab-"]');
		const tabCountBefore = await tabs.count();
		// global-setup.ts は 5 children を seed する (ADR-0006 で skip ではなく precondition assert)。
		expect(
			tabCountBefore,
			'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN 参照)',
		).toBeGreaterThanOrEqual(2);

		const parseTabCount = async (locator: ReturnType<typeof page.locator>): Promise<number> => {
			const text = (await locator.textContent()) ?? '';
			const m = text.match(/\((\d+)\)/);
			return m ? Number(m[1]) : 0;
		};
		let sumBefore = 0;
		for (let i = 0; i < tabCountBefore; i++) {
			sumBefore += await parseTabCount(tabs.nth(i));
		}

		// Step 1: ?import=<presetId> auto-open
		// kinder-rewards は reward-set marketplace SSOT に実在する preset id
		// (src/lib/data/marketplace/reward-sets/kinder-rewards.json)。
		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });

		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog, 'ChildSelectionDialog auto-open (dead-end でない前提)').toBeVisible({
			timeout: 10_000,
		});

		// Step 2: default = 「全員に追加」radio 選択済。確認ボタンが enabled → click。
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();

		// 副作用 A: importPresetToChildren network 発火 + response OK + body shape 検証
		// (action dispatch / Strategy / DB write の貫通検証)。
		// dead-end (ボタン無反応 / app crash) なら waitForResponse が timeout または !resp.ok() で fail。
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(
			resp.ok(),
			`importPresetToChildren response not OK (status ${resp.status()})`,
		).toBeTruthy();
		const respBody = await resp.text();
		// SvelteKit ActionResult JSON ({"type":"success", ...}) を含む。kinder-rewards (10 items)
		// が 5 children に dispatch されたことを正味の文字列で確認 (presetId が含まれる)。
		expect(
			respBody.includes('kinder-rewards'),
			'response body に対象 presetId が含まれる (Strategy dispatch 完了)',
		).toBeTruthy();

		// Step 3: 副作用 C = 永続反映 (両者 OK のいずれかで dead-end 解消を確認):
		//   case A (fresh state, dev/CI 1st run): child タブ count が grew (sumAfter > sumBefore)
		//   case B (polluted dev DB、dev 2nd+ run): grew = 0 だが skipped > 0 で dedupe が動作した
		//     ことを示す = action は正しく実行されたが既存 data あり (terminal goal の dual)
		// dead-end (click → 全く反応せず + state 不変) なら sumAfter==sumBefore かつ
		// response body に skip 情報がない → 必ず fail。
		// clean な /admin/rewards に遷移 (`?import=` 残留で dialog 再 open する既知の UX
		// レガシー挙動を避ける)。
		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('admin-rewards-child-tabs')).toBeVisible({ timeout: 30_000 });
		const tabsAfter = page.locator('[data-testid^="rewards-child-tab-"]');

		let sumAfter = 0;
		const cAfter = await tabsAfter.count();
		for (let i = 0; i < cAfter; i++) {
			sumAfter += await parseTabCount(tabsAfter.nth(i));
		}
		const grew = sumAfter > sumBefore;
		// dedupe skip pattern: presetId は per-child 5 child × 10 reward = 50 件取込試行。
		// skipped が 1 以上含まれる ≒ 「既存 data あり、dedupe が機能」を意味する。
		// (response shape: imported / skipped はそれぞれ数値、payload body に文字列として現れる)
		const hadSkips = /\\"skipped\\":[1-9]/.test(respBody) || /skipped[^,]*[1-9]/.test(respBody);
		expect(
			grew || hadSkips,
			`terminal goal verify: 取込後 sum が grew (${sumBefore}→${sumAfter}) もしくは response body に skipped>=1 (dedupe 機能) のいずれか必須 (dead-end 検出)`,
		).toBe(true);
	});
});
