// tests/unit/helpers/strip-html-comments.ts
// 自リポジトリの .svelte / .html ソースから HTML コメントを外し、「描画される markup」だけを検査対象にする。
//
// 信頼できない入力の無害化ではない。ただし `<!--` を 1 回置換するだけだと、`<!<!-- x -->-- y -->` のように
// 除去後に新しい `<!--` が組み上がる形を取りこぼす (CodeQL js/incomplete-multi-character-sanitization)。
// 取りこぼしを「実体として」消すため、変化が止まるまで繰り返す。

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

export function stripHtmlComments(source: string): string {
	let current = source;
	for (;;) {
		const next = current.replace(HTML_COMMENT, '');
		if (next === current) return next;
		current = next;
	}
}
