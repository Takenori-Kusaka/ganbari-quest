// src/lib/ui/actions/budoux.ts
// 日本語の文節で折り返す Svelte action (docs/DESIGN.md §3「日本語テキスト折り返し」)。
//
// - `word-break: auto-phrase` を解釈するブラウザ (Chromium 系) では CSS に任せ、BudouX は読み込まない
//   (`[data-budoux]` に auto-phrase を掛けるのは app.css)
// - 解釈しないブラウザ (Safari / Firefox) では BudouX を遅延読込し、文節の境界に ZWSP を差し込む。
//   `[data-budoux-applied]` に keep-all を掛け、ZWSP の位置でだけ折り返させる
//
// text node を分割しない (値だけを書き換える) のは、Svelte が text node への参照を保持して
// 値を直接更新するため。分割すると更新時に先頭の断片だけが書き換わり、残りの断片が重複して残る。
// 値が Svelte に書き換えられたら (ZWSP が消えたら) MutationObserver で差し込み直す。
// action はクライアントでだけ動く (SSR では何もしない) ため、SSR 出力に ZWSP が混ざることはない。

import type { Action } from 'svelte/action';

export const BUDOUX_ATTR = 'data-budoux';
export const BUDOUX_APPLIED_ATTR = 'data-budoux-applied';

/** ゼロ幅スペース (U+200B)。見えない文字をソースに直接書かない */
const ZWSP = String.fromCharCode(0x200b);
/** かな・漢字を含むときだけ分節する (英数字だけの文字列を触らない)。 */
const JAPANESE_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

export type Segmenter = (text: string) => string[];

interface BudouxDeps {
	supportsAutoPhrase: () => boolean;
	loadSegmenter: () => Promise<Segmenter>;
}

function browserSupportsAutoPhrase(): boolean {
	return (
		typeof CSS !== 'undefined' &&
		typeof CSS.supports === 'function' &&
		CSS.supports('word-break', 'auto-phrase')
	);
}

let segmenterPromise: Promise<Segmenter> | null = null;

function loadBudouxSegmenter(): Promise<Segmenter> {
	segmenterPromise ??= import('budoux')
		.then(({ Parser, jaModel }) => {
			const parser = new Parser(jaModel);
			return (text: string) => parser.parse(text);
		})
		.catch((err: unknown) => {
			// 読込に失敗したら次の mount で読み直せるようにする (失敗した promise を使い回さない)
			segmenterPromise = null;
			throw err;
		});
	return segmenterPromise;
}

/** text node 1 つの値に、文節の境界ごとに ZWSP を差し込む。値が変わらなければ書き込まない。 */
export function segmentTextNode(node: Text, segment: Segmenter): void {
	const current = node.nodeValue ?? '';
	const plain = current.replaceAll(ZWSP, '');
	if (!JAPANESE_RE.test(plain)) return;
	const next = segment(plain).join(ZWSP);
	if (next !== current) node.nodeValue = next;
}

/** 要素配下のすべての text node を分節し、適用済みの印を付ける。 */
export function applyBudoux(root: HTMLElement, segment: Segmenter): void {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
	for (const node of nodes) segmentTextNode(node, segment);
	root.setAttribute(BUDOUX_APPLIED_ATTR, '');
}

export function createBudouxAction(deps: BudouxDeps): Action<HTMLElement> {
	return (node) => {
		node.setAttribute(BUDOUX_ATTR, '');
		if (deps.supportsAutoPhrase()) return;

		let destroyed = false;
		let observer: MutationObserver | undefined;

		void deps
			.loadSegmenter()
			.then((segment) => {
				if (destroyed) return;
				const observe = () =>
					observer?.observe(node, { subtree: true, childList: true, characterData: true });
				observer = new MutationObserver(() => {
					// 自分の書き込みで observer が再発火しないよう、差し込み中は外す
					observer?.disconnect();
					applyBudoux(node, segment);
					observe();
				});
				applyBudoux(node, segment);
				observe();
			})
			// 読めなければ通常の折り返しのまま表示する (文字は欠けない)
			.catch(() => {});

		return {
			destroy() {
				destroyed = true;
				observer?.disconnect();
			},
		};
	};
}

export const budoux: Action<HTMLElement> = createBudouxAction({
	supportsAutoPhrase: browserSupportsAutoPhrase,
	loadSegmenter: loadBudouxSegmenter,
});
