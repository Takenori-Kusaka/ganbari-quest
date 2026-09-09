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
//
// **第 2 版で本 test 自体が破られた (adversarial 実測)**。初版は「その名前が source に
// 出てくるか」を正規表現で見ていたため、名前を残したまま意味を壊す 3 通りが素通りした:
//
//   M6: `setChildChapterBuilder(() => makeChildChapterBuilder(uiMode)(true), …)`
//       → 両方の名前は出てくる。件数は握り潰され must-A が復活する
//   M7: `setChildActivityPresence(true)`
//       → 呼び出しは在る。書く値が嘘になる
//   M8: `return () => …` を `const _resetPresence = () => …` に変える
//       → `setChildActivityPresence(undefined)` という文字列は在る。cleanup ではなくなる
//
// したがって本版は **source を AST に落として、呼び出しの形そのもの**を見る。
// 名前の出現ではなく「何が引数に渡っているか」「その arrow が cleanup として return
// されているか」を assert するので、上の 3 つはいずれも落ちる。
//
// 実行時の挙動 (mount 順に依存しない / 3 状態の出し分け) は tutorial 側の test が見る。
//
// 固定する不変条件:
//   [W1] 子供 layout は `setChildChapterBuilder(makeChildChapterBuilder(<uiMode>), …)` を呼ぶ
//        — builder を包んで件数を差し込む形を禁じる
//   [W2] 子供 layout が `setChapters` に渡すのは空配列だけ (teardown 用)。
//        件数を書く関数 (`setChildActivityPresence`) も layout からは呼ばない
//   [W3] ホームは件数の有無を **計算した値**で書く (真偽値リテラルを書かない)
//   [W4] ホームは `$effect` の cleanup として `undefined` へ戻す (return された arrow の中)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const LAYOUT = 'src/routes/(child)/+layout.svelte';
const HOME = 'src/routes/(child)/[uiMode=uiMode]/home/+page.svelte';

type Node = { type: string; [key: string]: unknown };

/** `<script>` の中身を ESTree として取り出す (テンプレート側は配線を持たない)。 */
function scriptAst(relPath: string): Node {
	const source = readFileSync(join(ROOT, relPath), 'utf8');
	const ast = parse(source, { modern: true }) as unknown as { instance?: { content: Node } };
	if (!ast.instance) throw new Error(`${relPath} に <script> が無い`);
	return ast.instance.content;
}

/** AST を全走査する (コメントは AST に載らないので、名前だけの言及は最初から数に入らない)。 */
function walk(node: unknown, visit: (n: Node) => void): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const child of node) walk(child, visit);
		return;
	}
	const n = node as Node;
	if (typeof n.type === 'string') visit(n);
	for (const [key, value] of Object.entries(n)) {
		if (key === 'type' || key === 'loc' || key === 'parent') continue;
		walk(value, visit);
	}
}

/** `name(...)` の呼び出しを集める (メンバ呼び出し `x.name()` は含めない)。 */
function callsTo(ast: Node, name: string): Node[] {
	const found: Node[] = [];
	walk(ast, (n) => {
		if (n.type !== 'CallExpression') return;
		const callee = n.callee as Node | undefined;
		if (callee?.type === 'Identifier' && callee.name === name) found.push(n);
	});
	return found;
}

function args(call: Node): Node[] {
	return (call.arguments as Node[] | undefined) ?? [];
}

describe('[W1][W2] 子供 layout の配線', () => {
	const ast = scriptAst(LAYOUT);

	it('builder を「包まずに」渡す (件数を差し込む形を禁じる)', () => {
		const calls = callsTo(ast, 'setChildChapterBuilder');
		expect(
			calls.length,
			`${LAYOUT} が setChildChapterBuilder を呼んでいない。` +
				'layout が章を組み立てると件数を推測することになり、#4860 の配線バグに戻る',
		).toBe(1);

		const first = args(calls[0] as Node)[0];
		expect(first, `${LAYOUT}: setChildChapterBuilder に引数が無い`).toBeDefined();
		// `makeChildChapterBuilder(uiMode)` そのものであること。
		// `() => makeChildChapterBuilder(uiMode)(true)` は ArrowFunctionExpression になり落ちる。
		expect(
			first?.type,
			`${LAYOUT}: setChildChapterBuilder の第 1 引数が ${first?.type}。` +
				'builder を関数で包むと、包んだ側が件数を決めてしまい must-A が復活する',
		).toBe('CallExpression');
		const callee = (first as Node).callee as Node;
		expect(
			callee?.type === 'Identifier' && callee.name === 'makeChildChapterBuilder',
			`${LAYOUT}: 第 1 引数が makeChildChapterBuilder(...) ではない`,
		).toBe(true);
		// builder は uiMode だけを受け取る。件数を追加で渡していないこと。
		expect(
			args(first as Node).length,
			`${LAYOUT}: makeChildChapterBuilder に uiMode 以外を渡している`,
		).toBe(1);
	});

	it('layout は件数を書かない (setChildActivityPresence を呼ばない)', () => {
		expect(
			callsTo(ast, 'setChildActivityPresence').length,
			`${LAYOUT} が件数を書いている。件数を知っているのはホームだけで、` +
				'layout が書くとホームの訂正を上書きする (#4860 must-A)',
		).toBe(0);
	});

	it('setChapters に渡すのは空配列だけ (teardown 用)', () => {
		for (const call of callsTo(ast, 'setChapters')) {
			const first = args(call)[0];
			const isEmptyArray =
				first?.type === 'ArrayExpression' && (first.elements as unknown[]).length === 0;
			expect(
				isEmptyArray,
				`${LAYOUT} の setChapters に空配列以外を渡している (${first?.type})。` +
					'章を組み立てて渡すと builder を null にしてしまい、ホームの件数が反映されなくなる',
			).toBe(true);
		}
	});
});

describe('[W3][W4] ホームの配線', () => {
	const ast = scriptAst(HOME);

	it('件数の有無を「計算した値」で書く (真偽値リテラルを書かない)', () => {
		const calls = callsTo(ast, 'setChildActivityPresence');
		expect(
			calls.length,
			`${HOME} が setChildActivityPresence を呼んでいない。` +
				'件数を知っているのはこの画面だけで、書かなければガイドは永久に「分からない」のまま',
		).toBeGreaterThan(0);

		const writes = calls.map((c) => args(c)[0]).filter((a): a is Node => a !== undefined);
		const literalWrite = writes.find(
			(a) => a.type === 'Literal' && typeof (a as { value?: unknown }).value === 'boolean',
		);
		expect(
			literalWrite,
			`${HOME} が setChildActivityPresence に真偽値リテラルを渡している。` +
				'実データではなく決め打ちの件数を書くことになり、ガイドが嘘をつく',
		).toBeUndefined();
		// 実データ由来の書き込みが 1 つ以上ある (undefined へ戻すだけで終わっていない)
		expect(
			writes.some((a) => a.type !== 'Literal' && a.type !== 'Identifier'),
			`${HOME} に実データ由来の件数の書き込みが無い`,
		).toBe(true);
	});

	it('$effect の cleanup として undefined へ戻す (return された arrow の中)', () => {
		let cleared = false;
		walk(ast, (n) => {
			if (n.type !== 'ReturnStatement') return;
			const returned = n.argument as Node | undefined;
			if (returned?.type !== 'ArrowFunctionExpression' && returned?.type !== 'FunctionExpression')
				return;
			for (const call of callsTo(returned, 'setChildActivityPresence')) {
				const first = args(call)[0];
				if (first?.type === 'Identifier' && first.name === 'undefined') cleared = true;
			}
		});
		expect(
			cleared,
			`${HOME} が離脱時に件数の記憶を捨てていない (return された cleanup の中に` +
				'setChildActivityPresence(undefined) が無い)。' +
				'持ち越すと、活動のある子が /checklist へ移ったときに「カードをタップ」と案内し、' +
				'その画面にカードは 1 枚も無い (#4860 adversarial 実測)',
		).toBe(true);
	});
});
