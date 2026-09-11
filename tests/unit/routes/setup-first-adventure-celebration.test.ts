// tests/unit/routes/setup-first-adventure-celebration.test.ts
//
// #4908: 初期セットアップ 8/9「はじめてのぼうけん」の記録演出で 3 つの不具合があった
// (PO の本番 (DSQL) 実機確認、2026-09-11)。
//
//   [A] `Lv. → Lv.` のように数値が空になる。
//       原因: 画面が `resultLevelUp.levelBefore` / `.levelAfter` を読んでいたが、
//       server (`+page.server.ts`) が返す `levelUp` の実体は `LevelUpInfo`
//       (`$lib/server/services/status-service.ts`) で、フィールド名は
//       `oldLevel` / `newLevel`。存在しないプロパティなので常に `undefined` → 空文字。
//   [B] 「+pt ポイントゲット！」の文字がゴールドのグラデーション背景に溶けて読めない
//       (WCAG 1.4.3 AA 未達)。`--color-gold-700` はゴールド系背景に対して 4.5:1 に届かない。
//   [C] カードに表示した基礎ポイント (例: +10pt) と、演出の合計ポイント (例: +20pt) が
//       食い違う。ストリーク / 習熟 / ボーナスルール等で合計が膨らむが、画面は内訳を
//       一切出さず「10 と言ったのに 20」に見える。
//
// 固定する不変条件:
//   [F-A] levelUp は `oldLevel` / `newLevel` を実数で描画する (型で結ばれている)
//   [F-B] ポイント表示の文字色トークンは `--color-text-gold` (AA 実測済、#4645) を使い、
//         `--color-gold-700` (ゴールド背景に対して AA 未達) を使わない
//   [F-C] server が返す `basePoints` (倍率適用後の基礎点) と `totalPoints` が食い違うときは
//         内訳を出す。一致するときは出さない (breakdown は `form` だけで決まる —
//         クリック等の client 状態に依存しない、#4908 実装で意図的にそう設計した)

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { asActivityId } from '../../../src/lib/domain/ids';
import { SETUP_FIRST_ADVENTURE_LABELS } from '../../../src/lib/domain/labels';
import FirstAdventurePage from '../../../src/routes/setup/first-adventure/+page.svelte';

const ACTIVITIES = [
	{
		id: asActivityId('activity-1'),
		name: 'しゅくだいをした',
		icon: '📝',
		basePoints: 10,
		isVisible: true,
	},
	{
		id: asActivityId('activity-2'),
		name: 'どくしょした',
		icon: '📖',
		basePoints: 10,
		isVisible: true,
	},
];

// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の PageData 型を test で最小化する
function renderPage(form: unknown): any {
	return render(FirstAdventurePage as never, {
		props: {
			data: {
				child: { id: 'child-1', nickname: 'てすとくん' },
				children: [{ id: 'child-1', nickname: 'てすとくん' }],
				activities: ACTIVITIES,
				imported: 0,
				skipped: 0,
				challengesRequested: 0,
				challengesAdded: 0,
				challengesFailed: 0,
			},
			form,
		} as never,
	});
}

describe('[F-A] レベルアップ表示が実数で出る (#4908 現象 a)', () => {
	afterEach(() => cleanup());

	it('oldLevel / newLevel を読み、Lv. が空文字にならない', () => {
		renderPage({
			success: true,
			activityName: 'しゅくだいをした',
			totalPoints: 10,
			levelUp: {
				oldLevel: 1,
				oldTitle: 'かけだし',
				newLevel: 2,
				newTitle: 'みならい',
				categoryId: 'benkyou',
				categoryName: '勉強',
				spGranted: 0,
			},
		});

		expect(screen.getByText('Lv.1')).toBeTruthy();
		expect(screen.getByText('Lv.2')).toBeTruthy();
		// 旧実装のバグ再現防止: 空の "Lv." だけが出ていないこと
		expect(screen.queryByText('Lv.')).toBeNull();
	});

	it('levelUp が null のときはレベルアップ表示自体を出さない', () => {
		renderPage({ success: true, activityName: 'しゅくだいをした', totalPoints: 10, levelUp: null });
		expect(screen.queryByText(SETUP_FIRST_ADVENTURE_LABELS.levelUpLabel)).toBeNull();
	});
});

describe('[F-B] ポイント表示が AA コントラストを満たすトークンを使う (#4908 現象 b)', () => {
	afterEach(() => cleanup());

	it('points-display の文字色トークンに AA 未達の --color-gold-700 を使わない', () => {
		const { container } = renderPage({
			success: true,
			activityName: 'しゅくだいをした',
			totalPoints: 10,
			levelUp: null,
		});
		const pointsDisplay = container.querySelector('[data-testid="first-adventure-points-display"]');
		expect(pointsDisplay).not.toBeNull();
		expect(pointsDisplay?.innerHTML).not.toContain('--color-gold-700');
		// AA 実測済 (#4645 color-contrast-tokens.test.ts) の text-gold トークンを使う
		expect(pointsDisplay?.innerHTML).toContain('--color-text-gold');
	});
});

describe('[F-C] server の basePoints と totalPoints の食い違いに内訳を出す (#4908 現象 c)', () => {
	afterEach(() => cleanup());

	it('basePoints 10 に対し totalPoints が 20 のとき内訳を出す (#4908 実測パターン: ボーナスルールで倍化)', () => {
		renderPage({
			success: true,
			activityName: 'しゅくだいをした',
			totalPoints: 20,
			basePoints: 10,
			levelUp: null,
		});

		expect(screen.getByText('+20pt')).toBeTruthy();
		expect(screen.getByText(SETUP_FIRST_ADVENTURE_LABELS.pointsBreakdown(10, 20))).toBeTruthy();
	});

	it('basePoints と totalPoints が一致するときは内訳を出さない', () => {
		renderPage({
			success: true,
			activityName: 'しゅくだいをした',
			totalPoints: 10,
			basePoints: 10,
			levelUp: null,
		});

		expect(screen.getByText('+10pt')).toBeTruthy();
		expect(screen.queryByText(SETUP_FIRST_ADVENTURE_LABELS.pointsBreakdown(10, 10))).toBeNull();
	});

	it('basePoints が欠けているとき (旧 form shape 互換) は内訳を出さない', () => {
		renderPage({ success: true, activityName: 'しゅくだいをした', totalPoints: 10, levelUp: null });
		expect(screen.getByText('+10pt')).toBeTruthy();
		expect(screen.queryByText(SETUP_FIRST_ADVENTURE_LABELS.pointsBreakdown(10, 10))).toBeNull();
	});
});
