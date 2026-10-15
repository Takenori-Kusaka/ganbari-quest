// workflow の `run:` 本文に直接現れる `${{ }}` のうち、注入 / 露出の経路になる式を検出する (#4570)。
//
// 背景: `run:` 本文の `${{ }}` は shell に渡る前に文字列として展開される。値に `"` / `$(...)` /
// 改行が入ると、その場で shell やスクリプトの構文になる (script injection)。トークンを URL に
// 埋めると argv / トレースにも出る。値は `env:` に渡し、本文では `"$VAR"` で参照する。
//
// 検出する式 (注入の入口になりうる、または出力が実行時に決まる):
//   - github.head_ref / base_ref / ref / ref_name  (branch / tag 名は書き手が決める)
//   - github.event.* (下記の数値・SHA を除く)       (title / body / label 名 / branch 名 ...)
//   - inputs.* / github.event.inputs.*              (workflow_dispatch の自由入力)
//   - steps.*.outputs.* / needs.*.outputs.*         (前段が何を書くか run: からは分からない。token も含む)
//
// 検出しない式 (理由つき):
//   - github.event.pull_request.number / github.event.number / pull_request.{base,head}.sha:
//     数値 / 40 桁 hex で、書き手が任意の文字列を入れられない
//   - github.sha / run_id / run_number / run_attempt / repository / repository_owner / actor / workflow:
//     書式が固定されている (actor は GitHub のログイン名で shell 特殊文字を含められない)
//   - matrix.* / env.* / vars.* / secrets.*: リポジトリ管理者が決める値。secrets は log で伏せ字になる
//     (cdk の `-c key=${{ secrets.X }}` のように大量にあり、env 経由への一括移行はこの検査の対象外)

const SAFE_EVENT_FIELDS = new Set([
	'github.event.number',
	'github.event.pull_request.number',
	'github.event.pull_request.base.sha',
	'github.event.pull_request.head.sha',
]);

const RISKY_CONTEXT = [
	/^github\.(head_ref|base_ref|ref|ref_name)\b/,
	/^github\.event\./,
	/^inputs\./,
	/^steps\.[^.\s]+\.outputs\./,
	/^needs\.[^.\s]+\.outputs\./,
];

/**
 * @param {string} expr `${{ }}` の中身 (前後の空白は除去済み)
 * @returns {boolean}
 */
export function isRiskyExpression(expr) {
	// `a || b` のような式は各項を別々に見る
	const terms = expr.split(/\s*(?:\|\||&&|==|!=)\s*/);
	return terms.some((term) => {
		const t = term.trim();
		if (SAFE_EVENT_FIELDS.has(t)) return false;
		return RISKY_CONTEXT.some((re) => re.test(t));
	});
}

/**
 * workflow の YAML テキストから、`run:` 本文内の危険な `${{ }}` を行番号つきで返す。
 *
 * `run:` の判定は行ベース (block scalar `|` / `>` と 1 行 inline の両方)。`with: script:`
 * (actions/github-script) は JS で `${{ }}` を展開するが `run:` ではないので対象外。
 *
 * @param {string} text
 * @returns {Array<{ line: number, expr: string, text: string }>}
 */
export function findRunExpressionViolations(text) {
	const lines = text.split(/\r?\n/);
	/** @type {Array<{ line: number, expr: string, text: string }>} */
	const found = [];
	let inRun = false;
	let runIndent = -1;

	/**
	 * @param {string} str
	 * @param {number} lineNo
	 * @param {string} original
	 */
	const scan = (str, lineNo, original) => {
		for (const m of str.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)) {
			const expr = m[1] ?? '';
			if (isRiskyExpression(expr)) found.push({ line: lineNo, expr, text: original.trim() });
		}
	};

	lines.forEach((line, i) => {
		const start = line.match(/^(\s*)(?:- )?run:\s*(.*)$/);
		if (start) {
			runIndent = (start[1] ?? '').length;
			const rest = start[2] ?? '';
			inRun = rest === '' || /^[|>]/.test(rest);
			if (!inRun) scan(rest, i + 1, line);
			return;
		}
		if (!inRun) return;
		const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
		if (line.trim() !== '' && indent <= runIndent) {
			inRun = false;
			return;
		}
		scan(line, i + 1, line);
	});

	return found;
}
