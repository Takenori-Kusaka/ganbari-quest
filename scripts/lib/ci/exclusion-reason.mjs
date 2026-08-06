/**
 * scripts/lib/ci/exclusion-reason.mjs (#4030 AC6 — 除外理由の非強制を塞ぐ SSOT)
 *
 * 「除外してよい」と決めた記録 (allowlist / baseline / 免除リスト) の **reason** が
 * 理由として成立しているかを判定する。判定規則をここ 1 箇所に置き、
 * script 側 (orphan baseline) と test 側 (実装 export の除外リスト) が同じ規則を使う。
 *
 * ## なぜ「非空」だけでは足りないか
 *
 * - `TODO` / `n/a` / `-` は**非空だが理由ではない**。非空チェックだけだと抜け道が残る (#3956)
 * - **guard 自身の生成物**で埋まった reason も理由ではない。`--update-baseline` は検出理由
 *   (「どこからも import されていません」= 機械が書いた現象の説明) を免除理由の欄に
 *   コピーしていた。**「なぜ免除してよいか」を誰も書いていないのに欄は埋まる**状態で、
 *   reason 機構が形骸化する (#4030 AC6、PO 決裁 = 案 A「自動投入を理由なしとして弾く」)
 *
 * 現象の説明 (detection reason) と免除の正当化 (exclusion reason) は別物である。
 */

/**
 * 「理由として通用しない」定型 stub。
 * 完全一致 (trim + 小文字化) で判定する — 部分一致にすると正当な理由文中の語で誤検出する。
 */
export const STUB_REASONS = [
	'todo',
	'tbd',
	'n/a',
	'na',
	'-',
	'—',
	'未定',
	'なし',
	'?',
	'??',
	'fixme',
	'wip',
];

/**
 * 機械が生成した文字列 (= 人が理由を書いていない証拠) を表す marker。
 *
 * `--update-baseline` が過去に自動投入していた文字列と、検出理由の定型末尾を含む。
 * **生成側 (saveBaseline 経路) と検査側 (check mode) の双方がこの表を参照する**ため、
 * 「生成は止めたが既存データは通る」という片肺状態にならない。
 */
export const MACHINE_GENERATED_REASON_MARKERS = [
	'auto-added by --update-baseline',
	'から import されていません',
	'は外部から参照されていません',
	'どこからも import されていません',
	'dead code の疑い',
];

/** 理由として最低限必要な文字数。実データの最短は 20 字前後なので十分に緩い下限 (#4237)。 */
export const MIN_REASON_LENGTH = 8;

/**
 * 理由として成立しているか判定する。成立しない場合は「なぜ駄目か」を返す。
 *
 * @param {unknown} reason
 * @returns {string | null} 欠陥の説明 (成立していれば null)
 */
export function findReasonDefect(reason) {
	if (typeof reason !== 'string') return `文字列ではありません (${typeof reason})`;
	const trimmed = reason.trim();
	if (trimmed.length === 0) return '空です';
	if (STUB_REASONS.includes(trimmed.toLowerCase())) return `定型 stub です (「${trimmed}」)`;
	const machine = MACHINE_GENERATED_REASON_MARKERS.find((m) => trimmed.includes(m));
	if (machine) {
		return (
			`機械が生成した文字列です (「${machine}」を含む)。` +
			'検出理由 (何が起きているか) ではなく、**なぜ免除してよいか** を人が書いてください'
		);
	}
	if (trimmed.length < MIN_REASON_LENGTH) {
		return `短すぎます (${trimmed.length} 字: 「${trimmed}」)`;
	}
	return null;
}

/**
 * baseline (allowed[] + reasons{}) 全体を検査し、欠陥のある entry を列挙する。
 *
 * @param {{ allowed?: string[], reasons?: Record<string, unknown> }} baseline
 * @returns {Array<{ entry: string, defect: string }>}
 */
export function findBaselineReasonDefects(baseline) {
	const allowed = baseline?.allowed ?? [];
	const reasons = baseline?.reasons ?? {};
	const out = [];
	for (const entry of allowed) {
		const defect = findReasonDefect(reasons[entry]);
		if (defect) out.push({ entry, defect });
	}
	return out;
}
