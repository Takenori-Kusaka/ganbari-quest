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
// **第 3 版でさらに 3 通り破られた (adversarial 実測)**。AST にしても、照合が「名前」に
// 依っている限り alias 1 行で外れる:
//
//   M10: layout が `import { setChildActivityPresence as writePresence }` と alias して書く
//        → callee 名が一致しないので「呼んでいない」と数えられ、否定 assertion が通る
//   M11: `$effect` の外に `function _makeCleanup() { return () => …(undefined) }` を置く
//        → module 内の**任意の** ReturnStatement を探していたので dead code で満たせる
//   M12: `import { setChapters as applyChapters }` で章を潰す
//        → `setChapters` の呼び出しが 0 件になり、for ループが **vacuous に通る**
//
// 本版は ① import specifier を読んで **alias を解決してから**照合し、② cleanup は
// `$effect` の引数の中に限って探し、③ 0 件で通る検査を作らない (件数も assert する)。
//
// **閉じていない穴 (既知・記録として残す)**。いずれも「**コードが、その形が言っているとおりに
// 動かない**」という 1 つの class であり、形状検査では原理的に閉じられない:
//
//   M13: `setChildActivityPresence(data.activities.length >= 0)` — 形は正しいが値が常に true
//   N1:  実 `$effect` の中の**到達しない分岐**で return する
//        (`if (data.activities.length < 0) return () => …(undefined);`)
//        — W4 は ReturnStatement の**存在**を見るだけで、到達可能性は見ない
//   N2:  `import * as tutorialStore` → `tutorialStore.setChildActivityPresence(true)`
//        — `callsTo` は MemberExpression を見ない。alias 解決も ImportSpecifier までで、
//          ImportNamespaceSpecifier は対象外
//   N3:  `const writeIt = setChildActivityPresence; writeIt(true);` — 局所変数への再束縛
//
// **ここで硬化を止める** (adversarial の推奨)。v2 は M6-M9、v3 は M10-M12、v4 は N1-N3 で
// 破られており、**形状検査には常に「次の形」がある**。閉じ方は硬化ではなく層を変えること —
// home を活動 0 件 / 40 件で mount し、unmount を跨いで `getChildActivityPresence()` を
// 読む**振る舞い test 1 本**で、M13 / N1 / N2 / N3 が閉じ、いま W2a / W4 が閉じている
// M10 / M11 も**より頑健な層で閉じ直せる** (home component の依存が重く、本 PR では
// 入れていない)。
//
// つまり本 file が守るのは「**直接呼び出し (callee が Identifier) の存在と形**」までで、
// **渡している式の意味**と**到達可能性**は守らない。ここは review で見る。
// 否定側 (「layout は件数を書かない」) はさらに弱い — N2 / N3 では呼び出しが**実在しても**
// `callsTo` から見えないため、**存在すら保証しない**。
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

/**
 * `import { x as y }` を解決し、**その module で `name` を指す全ての局所名**を返す。
 *
 * 名前だけで照合すると alias 1 行で検査が外れる (adversarial M10 / M12)。
 */
function localNamesFor(ast: Node, importedName: string): Set<string> {
	const names = new Set<string>([importedName]);
	walk(ast, (n) => {
		if (n.type !== 'ImportSpecifier') return;
		const imported = n.imported as Node | undefined;
		const local = n.local as Node | undefined;
		if (imported?.name === importedName && typeof local?.name === 'string') names.add(local.name);
	});
	return names;
}

/** `name(...)` の呼び出しを集める (alias 解決済み。メンバ呼び出し `x.name()` は含めない)。 */
function callsTo(ast: Node, name: string, aliasSource: Node = ast): Node[] {
	const names = localNamesFor(aliasSource, name);
	const found: Node[] = [];
	walk(ast, (n) => {
		if (n.type !== 'CallExpression') return;
		const callee = n.callee as Node | undefined;
		if (callee?.type === 'Identifier' && names.has(callee.name as string)) found.push(n);
	});
	return found;
}

/** `$effect(() => { … })` の引数 (= effect 本体) を集める。 */
function effectBodies(ast: Node): Node[] {
	return callsTo(ast, '$effect')
		.map((call) => args(call)[0])
		.filter((a): a is Node => a !== undefined);
}

/** module スコープの `function f(){}` / `const f = () => {}` を名前で引く。 */
function findLocalFunction(ast: Node, name: string): Node | undefined {
	let found: Node | undefined;
	walk(ast, (n) => {
		if (found) return;
		if (n.type === 'FunctionDeclaration' && (n.id as Node | undefined)?.name === name) found = n;
		if (n.type === 'VariableDeclarator' && (n.id as Node | undefined)?.name === name) {
			const init = n.init as Node | undefined;
			if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')
				found = init;
		}
	});
	return found;
}

function args(call: Node): Node[] {
	return (call.arguments as Node[] | undefined) ?? [];
}

/** その関数本体に `setChildActivityPresence(undefined)` があるか。 */
function clearsPresence(fn: Node, aliasSource: Node): boolean {
	return callsTo(fn, 'setChildActivityPresence', aliasSource).some((call) => {
		const first = args(call)[0];
		return first?.type === 'Identifier' && first.name === 'undefined';
	});
}

/** `return X` の X が関数を指すとき、その名前 (`return f` / `return f()`) を返す。 */
function returnedFunctionName(returned: Node): string | undefined {
	if (returned.type === 'Identifier') return returned.name as string;
	const callee = returned.callee as Node | undefined;
	if (returned.type === 'CallExpression' && callee?.type === 'Identifier') {
		return callee.name as string;
	}
	return undefined;
}

/**
 * `return` された値が「件数の記憶を捨てる関数」か。
 *
 * 直接 arrow を返す形に加え、`return makeCleanup()` / `return cleanup` のように 1 段
 * 挟む形も認める (安全な抽出を false-positive で落とさないため。名前は module スコープで解決)。
 */
function returnedFunctionClearsPresence(returned: Node | undefined, ast: Node): boolean {
	if (!returned) return false;
	if (returned.type === 'ArrowFunctionExpression' || returned.type === 'FunctionExpression') {
		return clearsPresence(returned, ast);
	}
	const refName = returnedFunctionName(returned);
	if (!refName) return false;
	const target = findLocalFunction(ast, refName);
	return target ? clearsPresence(target, ast) : false;
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
		const calls = callsTo(ast, 'setChapters');
		// 0 件だと for ループが vacuous に通る (adversarial M12)。teardown は実在が要件でもある
		expect(
			calls.length,
			`${LAYOUT} が setChapters を呼んでいない。子供画面を離れるときに章を空へ戻す ` +
				'teardown が無いと、親画面に子供の章が残る (#4654)',
		).toBeGreaterThan(0);
		for (const call of calls) {
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

	it('$effect の cleanup として undefined へ戻す ($effect の中で return された関数)', () => {
		let cleared = false;
		// module 内の任意の ReturnStatement ではなく **`$effect` の本体の中**だけを見る。
		// 外に置いた dead code (`function _makeCleanup(){ return () => …(undefined) }`) では
		// 満たせない (adversarial M11)。
		for (const body of effectBodies(ast)) {
			walk(body, (n) => {
				if (cleared || n.type !== 'ReturnStatement') return;
				if (returnedFunctionClearsPresence(n.argument as Node | undefined, ast)) cleared = true;
			});
		}
		expect(
			cleared,
			`${HOME} が離脱時に件数の記憶を捨てていない ($effect の中で return される cleanup に ` +
				'setChildActivityPresence(undefined) が無い)。' +
				'持ち越すと、活動のある子が /checklist へ移ったときに「カードをタップ」と案内し、' +
				'その画面にカードは 1 枚も無い (#4860 adversarial 実測)',
		).toBe(true);
	});
});
