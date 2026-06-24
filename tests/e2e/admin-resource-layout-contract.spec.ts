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

/** 全 resource の全 slot 代表 testid 集合 (drift 検出時の「正準 testid か」判定に使う)。 */
const ALL_CANONICAL_TESTIDS = new Set<string>(
	RESOURCES.flatMap((r) =>
		CANONICAL_SLOT_ORDER.map((slot) => slot.testid(r.resource)).filter((t): t is string =>
			Boolean(t),
		),
	),
);

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

/**
 * canonical スロット間に「非正準の slot-level 兄弟要素」が割り込んでいないか検出する。
 *
 * `readVisibleSlotsInDomOrder` は **canonical-named testid だけ** を query するため、スロットとスロットの
 * 間に正準でない section / banner が挿入されても部分列照合では見えない (順序は崩れていないため PASS)。
 * これを塞ぐため、canonical スロット要素の共通親 (LCA) を求め、その **直接の子要素**を document 順に
 * 走査し、「canonical スロットを含む子」の連続帯 (first〜last canonical child) の中に、
 * canonical でない `data-testid` を持つ slot-level 兄弟が割り込んでいないかを assert する。
 *
 * 返り値: 割り込んでいた非正準 testid の配列 (空なら drift なし)。
 */
async function findIntruderTestidsBetweenSlots(
	page: Page,
	resource: AdminResourceModel['resource'],
): Promise<string[]> {
	const canonicalTestids = CANONICAL_SLOT_ORDER.map((slot) => slot.testid(resource)).filter(
		(t): t is string => Boolean(t),
	);
	return page.evaluate(
		({ canonicalTestids, allCanonicalTestids }) => {
			// canonical スロット要素群の lowest common ancestor (LCA) を返す (browser context helper)。
			const findLca = (els: Element[]): Element | null => {
				let lca: Element | null = els[0] ?? null;
				for (let i = 1; i < els.length && lca; i++) {
					const ancestors = new Set<Element>();
					for (let a: Element | null = lca; a; a = a.parentElement) ancestors.add(a);
					let b: Element | null = els[i] ?? null;
					while (b && !ancestors.has(b)) b = b.parentElement;
					lca = b;
				}
				return lca;
			};

			const present = canonicalTestids
				.map((t) => document.querySelector(`[data-testid="${t}"]`))
				.filter((el): el is Element => el !== null);
			if (present.length < 2) return [];

			const lca = findLca(present);
			if (!lca) return [];

			// LCA の直接の子のうち「canonical スロットを内包する子」の index 範囲を求める。
			const children = Array.from(lca.children);
			const containsCanonical = (child: Element): boolean =>
				present.some((slot) => child === slot || child.contains(slot));
			const canonicalChildIdx = children
				.map((c, i) => (containsCanonical(c) ? i : -1))
				.filter((i) => i >= 0);
			const firstIdx = canonicalChildIdx[0];
			const lastIdx = canonicalChildIdx[canonicalChildIdx.length - 1];
			if (firstIdx === undefined || lastIdx === undefined) return [];

			// first〜last の帯の中で、canonical スロットを含まないのに「slot 名前空間 testid」を持つ
			// 直接の子 = 割り込み (drift)。
			//
			// 判定対象は **slot 名前空間** `admin-<res>-*` (+ `<res>-action-message` /
			// `<res>-child-context-banner` の variant) とする。`admin-<res>-` で始まる testid を持つ
			// 直接の子は「page-level slot」を名乗っているとみなし、canonical 集合外なら割り込み (新規 slot)
			// として捕捉する (例: `admin-checklists-promo-banner` を search と list の間に追加)。
			//
			// (B) 正当なドメインセクション (marketplace-import-section / checklist-distribution-section-*
			// 等) は `admin-<res>-` 接頭辞を持たない固有 testid であり、かつ各自の canonical スロット内に
			// 置かれる限り「canonical を含む子」として帯から除外されるため誤検出しない。
			const slotNamespaceRe =
				/^admin-(activities|rewards|checklists)-|-(action-message|child-context-banner)$/;
			const isIntruder = (child: Element): string | null => {
				if (containsCanonical(child)) return null;
				const tid = child.getAttribute('data-testid');
				return tid && slotNamespaceRe.test(tid) && !allCanonicalTestids.includes(tid) ? tid : null;
			};

			const intruders: string[] = [];
			for (let i = firstIdx + 1; i < lastIdx; i++) {
				const child = children[i];
				const tid = child ? isIntruder(child) : null;
				if (tid) intruders.push(tid);
			}
			return intruders;
		},
		{ canonicalTestids, allCanonicalTestids: Array.from(ALL_CANONICAL_TESTIDS) },
	);
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

			test('(a) 出現スロットが正準順 (CANONICAL_SLOT_ORDER の部分列) かつ間に非正準 slot が割り込まない', async ({
				page,
			}) => {
				const observed = await readVisibleSlotsInDomOrder(page, model.resource);
				expect(
					isSubsequence(observed, CANONICAL_NAMES),
					`observed slot order ${JSON.stringify(observed)} は canonical ${JSON.stringify(CANONICAL_NAMES)} の部分列ではない (順序違反)`,
				).toBe(true);

				// 部分列照合は canonical-named testid しか見ないため、スロット間に非正準の slot-level 要素
				// (例: 新規 `admin-checklists-promo-banner` を search と list の間に挿入) が割り込んでも
				// 順序は崩れず見逃す。共通親の直接子帯を走査し、slot 名前空間の割り込みが 0 件であることを assert する。
				const intruders = await findIntruderTestidsBetweenSlots(page, model.resource);
				expect(
					intruders,
					`canonical スロット間に非正準の slot-level 要素が割り込んでいる: ${JSON.stringify(intruders)} (正準スロット契約逸脱)`,
				).toEqual([]);
			});

			test('(b) 必須スロット (header / child-tabs / search / list) が存在する', async ({
				page,
			}) => {
				const observed = await readVisibleSlotsInDomOrder(page, model.resource);
				for (const required of REQUIRED_SLOT_NAMES) {
					expect(observed, `必須スロット "${required}" が描画されていない`).toContain(required);
				}
			});

			test('(c) 共有 component を使用している (AdminResourceHeader は画面に 1 個 / list は canonical 共有スロット)', async ({
				page,
			}) => {
				// 共有 AdminResourceHeader を**ちょうど 1 個**使う。inline header を独自再実装すると
				// 0 個 (testid 無し) か、共有 + inline の 2 個になるため、count===1 で「共有 component を
				// 正しく 1 回だけ使っている」ことを assert する (beforeEach の visible 再確認では検出不可)。
				await expect(page.getByTestId('admin-resource-header')).toHaveCount(1);

				// 一覧 slot は canonical 共有 testid (`admin-<res>-list`) で描画される。この container の
				// 空時 branch は UnifiedEmptyState SSOT を使う契約 (demo fixture はデータ投入済のため空に
				// ならず、ここでは「canonical list slot が存在する」= 共有スロット使用を assert する)。
				const listTestid = CANONICAL_SLOT_ORDER.find((s) => s.name === 'list')?.testid(
					model.resource,
				);
				expect(listTestid, 'list スロットの testid が registry に定義されていない').toBeTruthy();
				await expect(page.getByTestId(listTestid as string)).toHaveCount(1);
			});

			test('(d) registry 宣言と DOM (子供タブ / child-binding モデル) が整合する', async ({
				page,
			}) => {
				// 子供タブ: 3 資源とも per-child-tabs で child タブを常時描画する。
				await expect(page.getByTestId(model.childTabsTestid)).toBeVisible();

				// #3233: #3098/#3126 で checklist も child 主軸 (binding='child-selection-dialog' /
				//   visibilityChipTestid=null) に統一済。registry 上 family-distribute を binding に持つ
				//   資源は現存しないため、旧 if/else の else (family-distribute 配信導線 assert) は
				//   到達不能な dead branch だった (前回監査 sev2 mp-3)。registry SSOT を唯一の真実とし、
				//   全資源で「配信 VisibilityChip を page-top に surface しない」契約だけを表明する。
				expect(
					model.binding,
					`registry binding が child-selection-dialog 以外 (${model.binding})。family-distribute 資源を再導入する場合は本契約 test を拡張すること`,
				).toBe('child-selection-dialog');
				expect(model.visibilityChipTestid, 'registry visibilityChipTestid は null 契約').toBeNull();

				// checklist は配信 VisibilityChip を「配信先編集 dialog」(二次導線、初期 close) 内にのみ
				// 持つ。activity / reward は DOM に存在しない。いずれも page 初期表示で surface しない
				// (= page-top に配信 chip を常設しない契約)。per-child リソースが配信 chip を page-top に
				// 常設したら toBeHidden が fail する。
				await expect(page.getByTestId('checklist-distribution-visibility')).toBeHidden();
			});
		});
	}
});
