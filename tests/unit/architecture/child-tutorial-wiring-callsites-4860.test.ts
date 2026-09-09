// tests/unit/architecture/child-tutorial-wiring-callsites-4860.test.ts
//
// #4860 adversarial must-2 の回帰固定。
//
// `tests/unit/tutorial/child-tutorial-wiring-order-4860.test.ts` は store と builder の
// **契約**を固定する。しかし契約が正しくても、**その契約を呼ぶ側が呼ばなければ**画面は直らない。
// 実測で確認された抜け:
//
//   M4: `home/+page.svelte` から `setChildActivityPresence` を消す      → 278 tests 緑のまま
//   M5: `(child)/+layout.svelte` を旧 `setChapters(builder(true), …)` に戻す → 278 tests 緑のまま
//
// M5 は must-A のバグそのものであり、それを戻しても既存 test が 1 件も落ちなかった。
// 純関数 / store の test だけでは配線が守れない — must-A を生んだ構造と同じ。
//
// ここでは **呼び出し側の 2 file を読んで**、配線が生きていることを直接固定する。
// 実行時の挙動 (mount 順に依存しない / 3 状態の出し分け) は tutorial 側の test が見る。
//
// 固定する不変条件:
//   [W1] 子供 layout は builder を渡す (`setChildChapterBuilder`)。件数を推測して渡さない
//   [W2] 子供 layout が `setChapters` に渡すのは空配列だけ (teardown 用)。章を組み立てて渡さない
//   [W3] ホームは件数の有無を書く (`setChildActivityPresence`)
//   [W4] ホームは離脱時に `undefined` へ戻す (持ち越すと他画面で嘘になる)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const LAYOUT = 'src/routes/(child)/+layout.svelte';
const HOME = 'src/routes/(child)/[uiMode=uiMode]/home/+page.svelte';

function read(relPath: string): string {
	return readFileSync(join(ROOT, relPath), 'utf8');
}

/** コメント行を落とす (説明文の中の関数名を配線と誤認しないため)。 */
function code(relPath: string): string {
	return read(relPath)
		.split('\n')
		.filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
		.join('\n');
}

describe('[W1][W2] 子供 layout の配線', () => {
	it('builder を渡す (件数を推測して章を組み立てない)', () => {
		const src = code(LAYOUT);
		expect(
			src.includes('setChildChapterBuilder('),
			`${LAYOUT} が setChildChapterBuilder を呼んでいない。` +
				'layout が章を組み立てると件数を推測することになり、#4860 の配線バグに戻る',
		).toBe(true);
		expect(
			src.includes('makeChildChapterBuilder('),
			`${LAYOUT} が makeChildChapterBuilder を使っていない。` +
				'closure を直書きすると「件数を素通しするか」が test から見えなくなる',
		).toBe(true);
	});

	it('件数を直接渡さない (hasActivities の真偽値を書かない)', () => {
		const src = code(LAYOUT);
		expect(
			/hasActivities\s*:\s*(true|false)/.test(src),
			`${LAYOUT} が hasActivities を真偽値で渡している。` +
				'layout は件数を知らない — 推測して渡すと、ホームの訂正を上書きする (#4860 must-A)',
		).toBe(false);
	});

	it('setChapters に渡すのは空配列だけ (teardown 用)', () => {
		const src = code(LAYOUT);
		const calls = [...src.matchAll(/setChapters\(([^)]*)\)/g)].map((m) => m[1]?.trim() ?? '');
		for (const arg of calls) {
			expect(
				arg === '[]',
				`${LAYOUT} の setChapters(${arg}) は空配列以外を渡している。` +
					'章を組み立てて渡すと builder を null にしてしまい、ホームの件数が反映されなくなる',
			).toBe(true);
		}
	});
});

describe('[W3][W4] ホームの配線', () => {
	it('件数の有無を store に書く', () => {
		expect(
			code(HOME).includes('setChildActivityPresence('),
			`${HOME} が setChildActivityPresence を呼んでいない。` +
				'件数を知っているのはこの画面だけで、書かなければガイドは永久に「分からない」のまま',
		).toBe(true);
	});

	it('離脱時に undefined へ戻す ($effect の cleanup)', () => {
		const src = code(HOME);
		expect(
			/setChildActivityPresence\(\s*undefined\s*\)/.test(src),
			`${HOME} が離脱時に件数の記憶を捨てていない。` +
				'持ち越すと、活動のある子が /checklist へ移ったときに「カードをタップ」と案内し、' +
				'その画面にカードは 1 枚も無い (#4860 adversarial 実測)',
		).toBe(true);
	});
});
