// tests/unit/tutorial/child-page-guide-4864.test.ts
//
// #4864 (PO 決裁 2026-09-23 案 1): 子供の ❓ は **押した画面について説明する**。
//
// 旧実装はどの画面で ❓ を押しても固定 5 step のホームのツアー (活動カード → とりけし →
// スタンプ → 下ナビ) を開き、/checklist で押した子に **別の画面の説明を 5 枚めくらせていた**
// (実測: /checklist で ❓ → 1/5、5 step のどれもチェックリストを説明しない)。
//
// 固定する不変条件:
//   [R] route → 画面の対応。説明を持たない画面では null (= ❓ を出さない)。子供画面の route は
//       「説明あり」「❓ を出さない (理由つき)」のどちらかに必ず載る (黙って ❓ が消えない / 残らない)
//   [C] 画面ごとの章は 1 章 1〜3 step。主役 (項目 / ごほうび / ステータス) が
//       ある → spotlight / 無い → 「まだ ないよ」(指さない) / 分からない → 指さない
//   [L] 文言の年齢帯 variant: baby / preschool / elementary はひらがなのみ、junior / senior は漢字。
//       ボタン名 / リンク名 / nav 名は画面と同じ定数
//   [A] ガイドが指す data-tutorial は、その画面の source に実在する
//   [S] store: 画面を切り替えると章と進捗 key が切り替わり、開いていたガイドは閉じる
//
// 配線 (layout が画面を書く / 各画面が件数を書く) は
// tests/unit/architecture/child-tutorial-wiring-callsites-4860.test.ts の [W5] [W6] が見る。
// 実画面で ❓ を押したときの挙動は tests/e2e/child-page-guide-4864.spec.ts が見る。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (src/routes/(child) を再帰走査する)。区分は
// scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
}));

globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;

import {
	getChildNavModeLabels,
	getChildPageGuideLabels,
	getChildShopLabels,
} from '../../../src/lib/domain/labels';
import {
	CHILD_GUIDE_PAGE_BY_ROUTE,
	CHILD_PAGE_GUIDE_SELECTORS,
	CHILD_ROUTES_WITHOUT_GUIDE,
	getChildGuideChapters,
	getChildTutorialChapters,
	getChildTutorialProgressScope,
	makeChildChapterBuilder,
	resolveChildGuidePage,
} from '../../../src/lib/ui/tutorial/tutorial-chapters-child';
import {
	endTutorial,
	getChapters,
	getChildActivityPresence,
	getChildGuidePage,
	getChildGuidePresence,
	getCurrentStep,
	getProgressScope,
	isResumePromptShown,
	isTutorialActive,
	nextStep,
	setChapters,
	setChildActivityPresence,
	setChildChapterBuilder,
	setChildGuidePage,
	setChildGuidePresence,
	startTutorial,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';
import type { TutorialChapter } from '../../../src/lib/ui/tutorial/tutorial-types';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROUTES_ROOT = join(REPO_ROOT, 'src/routes');
const CHILD_ROUTES_DIR = join(ROUTES_ROOT, '(child)');

/** ❓ を出す 4 モード (baby は ❓ 自体を出さない、ADR-0011)。 */
const MODES = ['preschool', 'elementary', 'junior', 'senior'] as const;
const KANA_MODES = ['baby', 'preschool', 'elementary'] as const;
const KANJI_MODES = ['junior', 'senior'] as const;
const NON_HOME_PAGES = ['checklist', 'shop', 'status'] as const;
const PRESENCES = [true, false, undefined] as const;

/** CJK 統合漢字。ひらがな variant に 1 字でも混ざったら preschool が読めない。 */
const KANJI = /[一-鿿]/;

function steps(chapters: TutorialChapter[]) {
	return chapters.flatMap((c) => c.steps);
}

function stepIds(chapters: TutorialChapter[]) {
	return steps(chapters).map((s) => s.id);
}

/** `src/routes/(child)` 配下の +page.svelte を SvelteKit の route id に変換して列挙する。 */
function listChildRouteIds(): string[] {
	const ids: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name === '+page.svelte') {
				const rel = relative(ROUTES_ROOT, dir).split(sep).join('/');
				ids.push(`/${rel}`);
			}
		}
	};
	walk(CHILD_ROUTES_DIR);
	return ids.sort();
}

/** route id → その画面の +page.svelte の source。 */
function pageSource(routeId: string): string {
	return readFileSync(join(ROUTES_ROOT, ...routeId.slice(1).split('/'), '+page.svelte'), 'utf8');
}

describe('[R] route → 画面の対応', () => {
	it('説明を持つ 4 画面は自分の章を開く', () => {
		expect(resolveChildGuidePage('/(child)/[uiMode=uiMode]/home')).toBe('home');
		expect(resolveChildGuidePage('/(child)/checklist')).toBe('checklist');
		expect(resolveChildGuidePage('/(child)/[uiMode=uiMode]/shop')).toBe('shop');
		expect(resolveChildGuidePage('/(child)/[uiMode=uiMode]/(character)/status')).toBe('status');
	});

	it('説明を持たない画面 / route が無いときは null (= ❓ を出さない)', () => {
		expect(resolveChildGuidePage('/(child)/[uiMode=uiMode]/(character)/history')).toBeNull();
		expect(resolveChildGuidePage('/(child)/[uiMode=uiMode]/(character)/challenges')).toBeNull();
		expect(resolveChildGuidePage('/(child)/[uiMode=uiMode]/(character)/battle')).toBeNull();
		expect(resolveChildGuidePage('/(child)/[uiMode=uiMode]/home/initial-points')).toBeNull();
		expect(resolveChildGuidePage(null)).toBeNull();
		expect(resolveChildGuidePage(undefined)).toBeNull();
		// 親画面の route を渡しても子供の章は開かない
		expect(resolveChildGuidePage('/(parent)/admin/checklists')).toBeNull();
	});

	it('子供画面の route は「説明あり」「❓ を出さない」のどちらか 1 つに必ず載る', () => {
		const routeIds = listChildRouteIds();
		// 走査が空振りしていない (0 件で下の for が vacuous に通らない)
		expect(routeIds.length).toBeGreaterThanOrEqual(8);
		for (const routeId of routeIds) {
			const inGuide = routeId in CHILD_GUIDE_PAGE_BY_ROUTE;
			const inNoGuide = routeId in CHILD_ROUTES_WITHOUT_GUIDE;
			expect(
				inGuide !== inNoGuide,
				`${routeId}: 説明を書くか ❓ を出さないかを決めて CHILD_GUIDE_PAGE_BY_ROUTE / ` +
					'CHILD_ROUTES_WITHOUT_GUIDE のどちらか一方に載せる (tutorial-chapters-child.ts)',
			).toBe(true);
		}
	});

	it('表の key は実在する route を指す (消した画面の行を残さない)', () => {
		const routeIds = new Set(listChildRouteIds());
		for (const key of [
			...Object.keys(CHILD_GUIDE_PAGE_BY_ROUTE),
			...Object.keys(CHILD_ROUTES_WITHOUT_GUIDE),
		]) {
			expect(routeIds.has(key), `${key} に対応する +page.svelte が無い`).toBe(true);
		}
	});

	it('❓ を出さない画面には理由が書いてある', () => {
		for (const [routeId, reason] of Object.entries(CHILD_ROUTES_WITHOUT_GUIDE)) {
			expect(reason.length, `${routeId} の理由が空`).toBeGreaterThanOrEqual(12);
		}
	});
});

describe('[C] 画面ごとの章', () => {
	it('どの画面・どの状態でも 1 章 1〜3 step (ホームは従来の 5 step をそのまま使う)', () => {
		for (const uiMode of MODES) {
			for (const page of NON_HOME_PAGES) {
				for (const presence of PRESENCES) {
					const chapters = getChildGuideChapters(page, uiMode, presence);
					const ctx = `${uiMode} / ${page} / presence=${String(presence)}`;
					expect(chapters.length, ctx).toBe(1);
					expect(steps(chapters).length, ctx).toBeGreaterThanOrEqual(1);
					expect(steps(chapters).length, ctx).toBeLessThanOrEqual(3);
				}
			}
		}
	});

	it('ホームは #4652 の 3 章 5 step と同じ (PO 決裁: そのまま使う)', () => {
		for (const uiMode of MODES) {
			for (const presence of PRESENCES) {
				expect(getChildGuideChapters('home', uiMode, presence)).toEqual(
					getChildTutorialChapters(uiMode, { hasActivities: presence }),
				);
			}
		}
	});

	it('ホーム以外の画面の章には、ホームの step (活動カード / スタンプ / 下ナビ) が 1 つも無い', () => {
		const homeIds = new Set(
			stepIds(getChildTutorialChapters('elementary', { hasActivities: true })),
		);
		for (const uiMode of MODES) {
			for (const page of NON_HOME_PAGES) {
				for (const presence of PRESENCES) {
					for (const id of stepIds(getChildGuideChapters(page, uiMode, presence))) {
						expect(homeIds.has(id), `${uiMode} / ${page}: ホームの step ${id} が混ざっている`).toBe(
							false,
						);
					}
				}
			}
		}
	});

	it('説明を持たない画面 (null / 未知の page) は章が空 = ガイドは起動しない', () => {
		expect(getChildGuideChapters(null, 'elementary', true)).toEqual([]);
		expect(getChildGuideChapters('history', 'elementary', true)).toEqual([]);
	});

	describe('チェックリスト', () => {
		it('項目がある → 項目と「全部で」ポイント欄を光らせる', () => {
			const chapters = getChildGuideChapters('checklist', 'preschool', true);
			expect(stepIds(chapters)).toEqual(['child-checklist-check', 'child-checklist-points']);
			expect(steps(chapters).map((s) => s.selector)).toEqual([
				CHILD_PAGE_GUIDE_SELECTORS.checklistItem,
				CHILD_PAGE_GUIDE_SELECTORS.checklistPoints,
			]);
		});

		it('項目が無い → 1 step の「まだ ないよ」だけ。何も指さない', () => {
			for (const uiMode of MODES) {
				const s = steps(getChildGuideChapters('checklist', uiMode, false));
				expect(
					s.map((x) => x.id),
					uiMode,
				).toEqual(['child-checklist-empty']);
				expect(s[0]?.selector, uiMode).toBeUndefined();
				expect(s[0]?.description, uiMode).toMatch(/まだ/);
				expect(s[0]?.description, uiMode).not.toMatch(/タップすると/);
			}
		});

		it('分からない → 同じ説明だが何も指さない (あるとも無いとも言わない)', () => {
			const s = steps(getChildGuideChapters('checklist', 'elementary', undefined));
			expect(s.map((x) => x.id)).toEqual(['child-checklist-check', 'child-checklist-points']);
			expect(s.every((x) => x.selector === undefined)).toBe(true);
			expect(s.some((x) => /まだ/.test(x.description))).toBe(false);
		});
	});

	describe('ショップ', () => {
		it('ごほうびがある → カードと「交換の記録」リンクを光らせる', () => {
			const s = steps(getChildGuideChapters('shop', 'preschool', true));
			expect(s.map((x) => x.id)).toEqual(['child-shop-exchange', 'child-shop-history']);
			expect(s.map((x) => x.selector)).toEqual([
				CHILD_PAGE_GUIDE_SELECTORS.shopRewardCard,
				CHILD_PAGE_GUIDE_SELECTORS.shopHistory,
			]);
		});

		it('ごほうびが無い → カードを指さず「まだ ないよ」。記録リンクは常に在るので光らせる', () => {
			for (const uiMode of MODES) {
				const s = steps(getChildGuideChapters('shop', uiMode, false));
				expect(
					s.map((x) => x.id),
					uiMode,
				).toEqual(['child-shop-empty', 'child-shop-history']);
				expect(s[0]?.selector, uiMode).toBeUndefined();
				expect(s[0]?.description, uiMode).toMatch(/まだ/);
				expect(s[1]?.selector, uiMode).toBe(CHILD_PAGE_GUIDE_SELECTORS.shopHistory);
			}
		});

		it('分からない → カードを指さない', () => {
			const s = steps(getChildGuideChapters('shop', 'junior', undefined));
			expect(s[0]?.id).toBe('child-shop-exchange');
			expect(s[0]?.selector).toBeUndefined();
		});
	});

	describe('つよさ / ステータス', () => {
		it('表示できている → チャートと先頭の行を光らせる', () => {
			const s = steps(getChildGuideChapters('status', 'senior', true));
			expect(s.map((x) => x.id)).toEqual(['child-status-growth', 'child-status-level']);
			expect(s.map((x) => x.selector)).toEqual([
				CHILD_PAGE_GUIDE_SELECTORS.statusGrowth,
				CHILD_PAGE_GUIDE_SELECTORS.statusLevels,
			]);
		});

		it('表示できていない / 分からない → 何も指さない', () => {
			for (const presence of [false, undefined] as const) {
				const s = steps(getChildGuideChapters('status', 'elementary', presence));
				expect(
					s.every((x) => x.selector === undefined),
					String(presence),
				).toBe(true);
			}
		});
	});
});

describe('[L] 文言の年齢帯 variant', () => {
	function allGuideTexts(uiMode: string): string[] {
		const texts: string[] = [];
		for (const page of NON_HOME_PAGES) {
			for (const presence of PRESENCES) {
				for (const chapter of getChildGuideChapters(page, uiMode, presence)) {
					texts.push(chapter.title);
					for (const s of chapter.steps) texts.push(s.title, s.description);
				}
			}
		}
		return texts;
	}

	it('baby / preschool / elementary はひらがなのみ (漢字を 1 字も含まない)', () => {
		for (const uiMode of KANA_MODES) {
			for (const text of allGuideTexts(uiMode)) {
				expect(KANJI.test(text), `${uiMode}: 「${text}」に漢字が混ざっている`).toBe(false);
			}
		}
	});

	it('junior / senior の説明文は漢字表記 (ひらがな版の据え置きではない)', () => {
		for (const uiMode of KANJI_MODES) {
			for (const page of NON_HOME_PAGES) {
				for (const presence of PRESENCES) {
					for (const s of steps(getChildGuideChapters(page, uiMode, presence))) {
						expect(KANJI.test(s.description), `${uiMode} / ${s.id}: 「${s.description}」`).toBe(
							true,
						);
						const kana = steps(getChildGuideChapters(page, 'preschool', presence)).find(
							(k) => k.id === s.id,
						);
						expect(s.description, `${uiMode} / ${s.id}: ひらがな版と同じ文`).not.toBe(
							kana?.description,
						);
					}
				}
			}
		}
	});

	it('ボタン名・リンク名は画面と同じ定数 (画面の表記とガイドの表記がずれない)', () => {
		for (const uiMode of MODES) {
			const shop = getChildShopLabels(uiMode);
			const L = getChildPageGuideLabels(uiMode);
			expect(L.shopExchangeDesc, uiMode).toContain(`「${shop.exchangeButton}」`);
			expect(L.shopHistoryDesc, uiMode).toContain(`「${shop.historyLinkLabel}」`);
		}
	});

	it('章の名前は下ナビの名前と同じ', () => {
		for (const uiMode of MODES) {
			const nav = getChildNavModeLabels(uiMode);
			expect(getChildGuideChapters('status', uiMode, true)[0]?.title, uiMode).toBe(nav.status);
			expect(getChildGuideChapters('checklist', uiMode, true)[0]?.title, uiMode).toBe(
				nav.checklist,
			);
		}
	});
});

describe('[A] ガイドが指す要素は画面に実在する', () => {
	/** selector → その要素を描く画面 (route id)。 */
	const OWNER: Record<keyof typeof CHILD_PAGE_GUIDE_SELECTORS, string> = {
		checklistItem: '/(child)/checklist',
		checklistPoints: '/(child)/checklist',
		shopRewardCard: '/(child)/[uiMode=uiMode]/shop',
		shopHistory: '/(child)/[uiMode=uiMode]/shop',
		statusGrowth: '/(child)/[uiMode=uiMode]/(character)/status',
		statusLevels: '/(child)/[uiMode=uiMode]/(character)/status',
	};

	it.each(
		Object.entries(CHILD_PAGE_GUIDE_SELECTORS),
	)('%s の anchor が画面の source に在る', (key, selector) => {
		const match = /^\[data-tutorial="([^"]+)"\]$/.exec(selector);
		expect(match, `${key}: selector の形が [data-tutorial="…"] ではない`).not.toBeNull();
		const owner = OWNER[key as keyof typeof CHILD_PAGE_GUIDE_SELECTORS];
		expect(pageSource(owner)).toContain(`data-tutorial="${match?.[1]}"`);
	});
	// 各画面が自分の page key で「主役があるか」を書く配線は
	// tests/unit/architecture/child-tutorial-wiring-callsites-4860.test.ts [W6] が AST で見る。
});

describe('[S] store: 画面の切り替え', () => {
	const BASE_SCOPE = getChildTutorialProgressScope('c-1', 'elementary');

	beforeEach(() => {
		endTutorial();
		setChapters([]);
		localStorage.clear();
		setChildChapterBuilder(makeChildChapterBuilder('elementary'), BASE_SCOPE);
	});

	it('画面を切り替えると章がその画面のものになる', () => {
		setChildGuidePage('checklist');
		setChildGuidePresence('checklist', true);
		expect(stepIds(getChapters())).toEqual(['child-checklist-check', 'child-checklist-points']);

		setChildGuidePage('shop');
		setChildGuidePresence('shop', false);
		expect(stepIds(getChapters())).toEqual(['child-shop-empty', 'child-shop-history']);

		setChildGuidePage(null);
		expect(getChapters()).toEqual([]);
	});

	it('既定 (layout が書く前) はホーム = #4864 以前と同じ振る舞い', () => {
		expect(getChildGuidePage()).toBe('home');
		expect(stepIds(getChapters())[0]).toBe('child-record-card');
	});

	it('「主役があるか」は画面ごとに別の枠 (前の画面の cleanup が次の画面の値を消さない)', () => {
		setChildGuidePresence('checklist', true);
		setChildActivityPresence(undefined); // ホームの cleanup
		expect(getChildGuidePresence('checklist')).toBe(true);
		setChildGuidePresence('checklist', undefined);
		expect(getChildActivityPresence()).toBeUndefined();
	});

	it('進捗 key は画面ごと。ホームだけは #4864 以前と同じ key', () => {
		expect(getProgressScope()).toBe(BASE_SCOPE);
		setChildGuidePage('checklist');
		expect(getProgressScope()).toBe(`${BASE_SCOPE}:checklist`);
		setChildGuidePage('home');
		expect(getProgressScope()).toBe(BASE_SCOPE);
	});

	it('/checklist で ❓ → チェックリストの章から始まる (ホームのツアーを開かない)', async () => {
		setChildGuidePage('checklist');
		setChildGuidePresence('checklist', true);
		await startTutorial();
		expect(isTutorialActive()).toBe(true);
		expect(getCurrentStep()?.id).toBe('child-checklist-check');
	});

	it('ガイドを開いたまま画面が変わったら閉じ、進捗は前の画面の key に残る', async () => {
		setChildGuidePage('shop');
		setChildGuidePresence('shop', true);
		await startTutorial();
		await nextStep();
		expect(getCurrentStep()?.id).toBe('child-shop-history');

		setChildGuidePage('status');
		expect(isTutorialActive()).toBe(false);
		expect(localStorage.getItem(`tutorial-progress:${BASE_SCOPE}:shop:step`)).toBe('1');

		// 別の画面の中断進捗で「つづきから？」を出さない
		await startTutorial();
		expect(isResumePromptShown()).toBe(false);
		expect(getCurrentStep()?.id).toBe('child-status-growth');
	});
});
