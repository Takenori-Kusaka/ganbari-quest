// tests/unit/components/child-first-screen-age-tier.test.ts
//
// 初回訪問の子供が最初に見る 2 面 — 冒険スタート演出 (`AdventureStartOverlay`) と
// 活動 0 件の空状態 (`ActivityEmptyState`) — は年齢帯を持たない平坦な定数を読んでいた。
// `FULL_FEATURES.showAdventureStart` は elementary / junior / senior に付いているので、
// 16-18 歳が受け取る最初の 1 画面が「やあ！ / きょうから いっしょに ぼうけんだよ！ /
// したのカードをタップしてみてね」という幼児文体になっていた (docs/DESIGN.md §8)。
//
// さらに overlay の表示条件 (`showAdventureStart && isFirstTime`) とカード一覧の分岐
// (`activities.length`) は独立しているため、活動 0 件のときは「したのカードをタップ
// してみてね」と言いながら押すカードが 1 枚も無い状態が起きていた。
//
// 固定する不変条件 (labels の resolver だけでなく **実際に描画される文字列**):
//   [A] junior / senior の初回演出が漢字文体になる (prop 配線の抜けを検出する)
//   [B] 活動 0 件のときは「したのカード」を指さない
//   [C] 活動 0 件の空状態も年齢帯で切り替わる

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '../../../src/lib/domain/categories';
import {
	getCategoryDisplayName,
	getChildActivityEmptyLabels,
	getChildAdventureStartLabels,
} from '../../../src/lib/domain/labels';
import ActivityEmptyState from '../../../src/lib/ui/components/ActivityEmptyState.svelte';
import AdventureStartOverlay from '../../../src/lib/ui/components/AdventureStartOverlay.svelte';

vi.mock('../../../src/lib/ui/sound', () => ({
	soundService: { play: vi.fn(), playRecordComplete: vi.fn(), configure: vi.fn() },
}));

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

const HIRAGANA_MODES = ['baby', 'preschool', 'elementary'] as const;
const KANJI_MODES = ['junior', 'senior'] as const;

/**
 * 冒険スタート演出は phase 0→4 を setTimeout で進める。最終 phase (8000ms) まで
 * 進めてから、`document.body` 全体 (Dialog は portal 配下) の文字列を返す。
 */
async function renderOverlayFinalPhase(uiMode: string, hasActivities: boolean): Promise<string> {
	vi.useFakeTimers();
	render(AdventureStartOverlay as never, {
		props: { open: true, childName: 'たろう', uiMode, hasActivities } as never,
	});
	await vi.advanceTimersByTimeAsync(8100);
	return document.body.textContent ?? '';
}

/** カテゴリチップは phase 3 (5500ms〜8000ms) にだけ出る。その区間で dump する。 */
async function renderOverlayCategoryPhase(uiMode: string): Promise<string> {
	vi.useFakeTimers();
	render(AdventureStartOverlay as never, {
		props: { open: true, childName: 'たろう', uiMode, hasActivities: true } as never,
	});
	await vi.advanceTimersByTimeAsync(5600);
	return document.body.textContent ?? '';
}

describe('[A] 初回の冒険スタート演出が年齢帯で切り替わる', () => {
	it('junior / senior は漢字文体になり、幼児向けひらがなが残らない', async () => {
		for (const uiMode of KANJI_MODES) {
			const text = await renderOverlayFinalPhase(uiMode, true);
			const t = getChildAdventureStartLabels(uiMode);
			expect(text, uiMode).toContain(t.adventureReadyText);
			expect(text, uiMode).toContain(t.adventureStartBtn);
			// 旧実装が出していた幼児文体
			expect(text, uiMode).not.toContain('したのカードをタップしてみてね');
			expect(text, uiMode).not.toContain('ぼうけんスタート！');
			cleanup();
		}
	});

	it('baby / preschool / elementary は従来どおりひらがなのまま', async () => {
		for (const uiMode of HIRAGANA_MODES) {
			const text = await renderOverlayFinalPhase(uiMode, true);
			expect(text, uiMode).toContain('したのカードをタップしてみてね');
			expect(text, uiMode).toContain('ぼうけんスタート！');
			cleanup();
		}
	});
});

describe('[A] カテゴリチップは背後の画面と同じ SSOT で解決する', () => {
	// 旧実装は `cat.name` (全年齢ひらがな固定) で、overlay が覆っている dashboard の
	// `CategorySection` / `StatusBar` / `XpGainRow` (いずれも getCategoryDisplayName(uiMode))
	// と食い違っていた。elementary は SSOT 上 kanjiName 側なので、本 PR で表記が変わる
	// (= 背後の画面と一致する)。これは意図した変更であり、事故ではない。
	it('elementary / junior / senior は SSOT どおり漢字カテゴリ名になる', async () => {
		for (const uiMode of ['elementary', 'junior', 'senior'] as const) {
			const text = await renderOverlayCategoryPhase(uiMode);
			expect(text, uiMode).toContain(getCategoryDisplayName('undou', uiMode));
			expect(text, uiMode).not.toContain(CATEGORIES.undou.name);
			cleanup();
		}
	});

	it('baby / preschool は従来どおりひらがなカテゴリ名', async () => {
		for (const uiMode of ['baby', 'preschool'] as const) {
			const text = await renderOverlayCategoryPhase(uiMode);
			expect(text, uiMode).toContain(CATEGORIES.undou.name);
			cleanup();
		}
	});
});

describe('[B] 活動 0 件のとき「下のカード」を指さない', () => {
	it('hasActivities=false では押すカードを案内しない (5 年齢モード)', async () => {
		for (const uiMode of [...HIRAGANA_MODES, ...KANJI_MODES]) {
			const text = await renderOverlayFinalPhase(uiMode, false);
			const t = getChildAdventureStartLabels(uiMode);
			expect(text, uiMode).toContain(t.adventureReadySubEmpty);
			expect(text, uiMode).not.toContain(t.adventureReadySub);
			cleanup();
		}
	});

	it('hasActivities=true では従来どおりカードを案内する', async () => {
		const text = await renderOverlayFinalPhase('elementary', true);
		const t = getChildAdventureStartLabels('elementary');
		expect(text).toContain(t.adventureReadySub);
		expect(text).not.toContain(t.adventureReadySubEmpty);
	});
});

describe('[B] 呼出側が hasActivities を渡していること', () => {
	it('子供ホームが activities.length を overlay に配線している', () => {
		// prop に既定値を持たせると、この 1 行を落としても型検査も 3000 件の test も通り、
		// 「カードが無いのにカードを指す」が無警告で戻る (adversarial が mutation で実証)。
		// prop は必須にしたうえで、配線そのものもここで固定する。
		const src = readFileSync(
			resolve(REPO_ROOT, 'src/routes/(child)/[uiMode=uiMode]/home/+page.svelte'),
			'utf-8',
		);
		expect(src).toMatch(/hasActivities=\{data\.activities\.length > 0\}/);
	});

	it('overlay の hasActivities に既定値が付いていない (渡し忘れが型で落ちる)', () => {
		const src = readFileSync(
			resolve(REPO_ROOT, 'src/lib/ui/components/AdventureStartOverlay.svelte'),
			'utf-8',
		);
		expect(src).toContain('hasActivities: boolean;');
		expect(src).not.toContain('hasActivities?: boolean');
		expect(src).not.toMatch(/hasActivities\s*=\s*true/);
	});
});

describe('[C] 活動 0 件の空状態が年齢帯で切り替わる', () => {
	function renderEmpty(uiMode: string): string {
		render(ActivityEmptyState as never, { props: { uiMode } as never });
		return screen.getByTestId('activity-empty-state').textContent ?? '';
	}

	it('junior / senior は漢字文体になる', () => {
		for (const uiMode of KANJI_MODES) {
			const text = renderEmpty(uiMode);
			const t = getChildActivityEmptyLabels(uiMode);
			expect(text, uiMode).toContain(t.activityEmptyTitle);
			expect(text, uiMode).toContain(t.activityEmptyDesc);
			expect(text, uiMode).not.toContain('ぼうけんの じゅんびちゅう');
			expect(text, uiMode).not.toContain('もうすこし まってね');
			cleanup();
		}
	});

	it('baby / preschool / elementary は従来どおりひらがなのまま', () => {
		for (const uiMode of HIRAGANA_MODES) {
			const text = renderEmpty(uiMode);
			expect(text, uiMode).toContain('ぼうけんの じゅんびちゅう');
			expect(text, uiMode).toContain('もうすこし まってね');
			cleanup();
		}
	});
});
