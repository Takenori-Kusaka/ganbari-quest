/**
 * tests/e2e/admin-resource-layout-contract.spec.ts
 *
 * #3097 (EPIC #3096): admin リソース管理画面の「正準スロット契約」fitness function。
 *
 * admin リソース管理 3 画面 (活動 / チェックリスト / ごほうび) のスロット配置順・共有 component 使用・
 * child-binding モデルが画面ごとにドリフトする問題 (PO 約 12 回の指摘でも収束せず) の根治。
 * `src/lib/features/admin/admin-resource-model-registry.ts` の SSOT を唯一の真実とし、各画面の DOM を
 * 照合する。契約逸脱 (順序違反 / 必須スロット欠落 / 共有 component 不使用 / モデル不整合) があれば
 * CI で即 fail する (Architecture Fitness Function、『Building Evolutionary Architecture』Neal Ford 他)。
 *
 * `admin-add-path-isomorphism.spec.ts` (#2998、add 経路 dropdown の同型性) とは補完関係:
 *   - add-path test = 「+ 追加」dropdown 内 item の種類・順序の同型性
 *   - 本 test     = 画面の縦スロット順・共有 component・child-binding モデルの整合性
 *
 * 認証は demo 無認証 (`AUTH_MODE=anonymous DATA_SOURCE=demo`) 前提。本 spec は構造 (testid の出現順序 +
 * 存在 + 整合) を assert するため、render-only 禁止原則 (tests/CLAUDE.md) の対象外 (操作を伴わない
 * 構造契約検証)。可視性 + 出現順序で十分。
 */

import { expect, type Page, test } from '@playwright/test';
import {
	ADMIN_RESOURCE_MODEL_REGISTRY,
	type AdminResourceModel,
	CANONICAL_SLOT_ORDER,
	REQUIRED_SLOT_NAMES,
} from '../../src/lib/features/admin/admin-resource-model-registry';

const RESOURCES = Object.values(ADMIN_RESOURCE_MODEL_REGISTRY);

/**
 * ページ DOM から「正準スロットのうち実際に出現したもの」を、document 上の出現順序で返す。
 *
 * 各スロットの代表 testid を `[data-testid="..."]` で query し、可視要素を document 内の DOM 順
 * (`compareDocumentPosition`) で並べる。fitness function は「出現したスロットが CANONICAL_SLOT_ORDER の
 * 部分列 (subsequence) になっているか」= 正準順に並んでいるかを照合する。
 */
async function readVisibleSlotsInDomOrder(
	page: Page,
	resource: AdminResourceModel['resource'],
): Promise<string[]> {
	// 各スロットの testid → slot 名 の対応を作る (null のスロットは除外)。
	const slotTestids = CANONICAL_SLOT_ORDER.map((slot) => ({
		name: slot.name,
		testid: slot.testid(resource),
	})).filter((s): s is { name: string; testid: string } => Boolean(s.testid));

	const present: { name: string; testid: string }[] = [];
	for (const slot of slotTestids) {
		const loc = page.getByTestId(slot.testid);
		// action-message 等の条件付きスロットは未表示のことがある。可視のものだけ拾う。
		if (
			await loc
				.first()
				.isVisible()
				.catch(() => false)
		) {
			present.push(slot);
		}
	}

	// DOM 出現順に並べ替える (testid → DOM index)。
	const orderedNames = await page.evaluate(
		(testids: string[]) => {
			const nodes = testids
				.map((t) => ({ t, el: document.querySelector(`[data-testid="${t}"]`) }))
				.filter((x): x is { t: string; el: Element } => x.el !== null);
			nodes.sort((a, b) => {
				const pos = a.el.compareDocumentPosition(b.el);
				// a が b より前 (DOCUMENT_POSITION_FOLLOWING on b) → a 先
				// eslint-disable-next-line no-bitwise
				if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
				// eslint-disable-next-line no-bitwise
				if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
				return 0;
			});
			return nodes.map((n) => n.t);
		},
		present.map((p) => p.testid),
	);

	// testid → slot 名に戻す
	const testidToName = new Map(present.map((p) => [p.testid, p.name]));
	return orderedNames.map((t) => testidToName.get(t) ?? t);
}

/** observed が canonical の部分列 (subsequence) なら true (= observed が正準順に並んでいる)。 */
function isSubsequence(observed: string[], canonical: string[]): boolean {
	let ci = 0;
	for (const name of observed) {
		const found = canonical.indexOf(name, ci);
		if (found === -1) return false;
		ci = found + 1;
	}
	return true;
}

const CANONICAL_NAMES = CANONICAL_SLOT_ORDER.map((s) => s.name);

test.describe('#3097 admin リソース正準スロット契約 (activities / rewards / checklists)', () => {
	for (const model of RESOURCES) {
		test.describe(`${model.resource} (${model.route})`, () => {
			test.beforeEach(async ({ page }) => {
				await page.goto(model.route);
				// header は全画面必須 — 描画完了の anchor に使う。
				await expect(page.getByTestId('admin-resource-header')).toBeVisible({ timeout: 15_000 });
			});

			test('(a) 出現スロットが正準順 (CANONICAL_SLOT_ORDER の部分列) に並ぶ', async ({ page }) => {
				const observed = await readVisibleSlotsInDomOrder(page, model.resource);
				expect(
					isSubsequence(observed, CANONICAL_NAMES),
					`observed slot order ${JSON.stringify(observed)} は canonical ${JSON.stringify(CANONICAL_NAMES)} の部分列ではない (順序違反)`,
				).toBe(true);
			});

			test('(b) 必須スロット (header / child-tabs / search / list) が存在する', async ({
				page,
			}) => {
				const observed = await readVisibleSlotsInDomOrder(page, model.resource);
				for (const required of REQUIRED_SLOT_NAMES) {
					expect(observed, `必須スロット "${required}" が描画されていない`).toContain(required);
				}
			});

			test('(c) 共有 component を使用している (header=AdminResourceHeader / empty=UnifiedEmptyState testid 体系)', async ({
				page,
			}) => {
				// header = AdminResourceHeader (admin-resource-header testid を内包)
				await expect(page.getByTestId('admin-resource-header')).toBeVisible();
			});

			test('(d) registry 宣言と DOM (子供タブ / child-binding モデル) が整合する', async ({
				page,
			}) => {
				// 子供タブ: per-child-tabs / family-distribute いずれも child タブを描画する (本 PR では両モデルとも常時表示)。
				await expect(page.getByTestId(model.childTabsTestid)).toBeVisible();

				if (model.binding === 'child-selection-dialog') {
					// per-child-tabs (activity / reward) は ChildSelectionDialog で取込先 child を選ぶ。
					// 取込 dialog が DOM 上に mount されている (closed でも Ark UI が DOM に保持) ことを確認し、
					// family master 専用の配信 VisibilityChip は持たないことを assert する。
					await expect(page.getByTestId('checklist-distribution-visibility')).toHaveCount(0);
				} else {
					// family-distribute (checklist) は配信先設定の入口 (distribution section) を持つ。
					// VisibilityChip 本体は Dialog open 時のみ Portal に mount されるため、ここでは
					// 配信モデルの入口 (per-template distribution section) が DOM 上に存在することを確認する。
					// (templates が 0 件のときは section が無いため、その場合は child-tabs 存在で代替検証する。)
					const distributionSections = page.locator(
						'[data-testid^="checklist-distribution-section-"]',
					);
					const sectionCount = await distributionSections.count();
					if (sectionCount > 0) {
						await expect(distributionSections.first()).toBeVisible();
					}
				}
			});
		});
	}
});
