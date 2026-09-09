// tests/unit/tutorial/child-tutorial-wiring-order-4860.test.ts
//
// #4860 adversarial must-A の回帰固定。
//
// `child-tutorial-empty-activities.test.ts` は **純関数**
// (`getChildTutorialChapters`) が活動 0 件で説明型 step を返すことを固定していた。
// それは通っていたのに、**実機では直っていなかった**:
//
//   local + 実 sqlite に活動 0 件の子を登録 → /elementary/home → ❓
//   → {"cards":0,"tapCard":true}  ← カード 0 枚なのに「カードをタップすると」
//
// 原因は配線であって章の組み立てではない。Svelte 5 の実行順は
// **子の `$effect` → 親の `onMount`** なので、
//
//   1. home の `$effect` が実件数で章を訂正する
//   2. その **あと** で layout の `onMount` が `hasActivities: true` の仮置きで上書きする
//
// となり、訂正が消えていた。しかも home の `$effect` の依存は uiMode と件数だけなので
// 自己修復もしない。効くのは layout が mount 済みのクライアント遷移だけで、
// **活動 0 件の子が初めてアプリを開く場面** — 修正したかった当の状況 — で外れていた。
// `(child)/checklist` は home の `$effect` を一度も通らないため、常に外れたままだった。
//
// 固定する不変条件:
//   [A] layout → home の順でも、home → layout の順でも、最終的な章は同じ (順序非依存)
//   [B] 件数を誰も書いていない画面 (checklist 等) では「カードをタップ」と言わない
//   [C] 件数を書いた後に layout が再 mount しても、書いた値が失われない
//   [D] scope (子供ごとの進捗 namespace) は builder 経由でも従来どおり設定される

import { beforeEach, describe, expect, it } from 'vitest';
import { makeChildChapterBuilder } from '../../../src/lib/ui/tutorial/tutorial-chapters-child';
import {
	getChapters,
	getChildActivityPresence,
	getProgressScope,
	setChapters,
	setChildActivityPresence,
	setChildChapterBuilder,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';

const UI_MODE = 'elementary';
const SCOPE = 'child:c-1:elementary';

/**
 * layout が実際に渡している形。
 *
 * **closure をここで書き直さない** — 書き直すと「layout が件数を素通ししているか」を
 * 検証できず、layout 側だけ `hasActivities: true` に戻しても test が通ってしまう
 * (実際に mutation で確認した)。layout と同じ `makeChildChapterBuilder` を使う。
 */
function mountLayout(scope = SCOPE) {
	setChildChapterBuilder(makeChildChapterBuilder(UI_MODE), scope);
}

/** home が実際に渡している形。件数だけを書く。 */
function mountHome(activityCount: number) {
	setChildActivityPresence(activityCount > 0);
}

function firstStep() {
	const step = getChapters()[0]?.steps[0];
	if (!step) throw new Error('1 章 1 step が取れない');
	return step;
}

beforeEach(() => {
	// 章も件数も持たない初期状態に戻す
	setChapters([]);
});

describe('[A] 配線は mount 順に依存しない', () => {
	it('home の $effect が layout の onMount より先に走っても、0 件なら説明型のまま', () => {
		// Svelte 5 の実際の順序 (子が先)
		mountHome(0);
		mountLayout();

		expect(firstStep().selector, 'カード 0 枚なのに spotlight している').toBeUndefined();
		expect(firstStep().description).not.toContain('タップする');
	});

	it('layout が先に走る順序でも同じ結果になる', () => {
		mountLayout();
		mountHome(0);

		expect(firstStep().selector).toBeUndefined();
		expect(firstStep().description).not.toContain('タップする');
	});

	it('活動があるときは、どちらの順序でも従来どおり spotlight する', () => {
		mountHome(3);
		mountLayout();
		expect(firstStep().selector).toBe('[data-tutorial="activity-card"]');

		setChapters([]);
		mountLayout();
		mountHome(3);
		expect(firstStep().selector).toBe('[data-tutorial="activity-card"]');
	});
});

describe('[B] 件数を誰も書いていない画面', () => {
	it('checklist のように home を通らない画面では「カードをタップ」と言わない', () => {
		// layout だけが mount された状態 = 件数は未知
		mountLayout();

		expect(getChildActivityPresence(), '誰も書いていないので未知のはず').toBeUndefined();
		expect(firstStep().selector, '未知なのに spotlight している').toBeUndefined();
		expect(firstStep().description).not.toContain('タップする');
	});
});

describe('[C] 書いた件数は layout の再 mount で失われない', () => {
	it('home が 0 件を書いたあとに layout が再 mount しても説明型のまま', () => {
		mountHome(0);
		mountLayout();
		mountLayout(); // ナビゲーション等で layout が張り直された

		expect(getChildActivityPresence()).toBe(false);
		expect(firstStep().selector).toBeUndefined();
	});
});

describe('[D] 進捗 namespace', () => {
	it('builder 経由でも子供ごとの scope が設定される', () => {
		mountLayout('child:c-9:junior');
		expect(getProgressScope()).toBe('child:c-9:junior');
	});

	it('scope を変えても、既に書かれた件数は保たれる (別の子はホームが上書きする)', () => {
		mountHome(0);
		mountLayout('child:c-2:senior');
		expect(getChildActivityPresence()).toBe(false);
	});
});
