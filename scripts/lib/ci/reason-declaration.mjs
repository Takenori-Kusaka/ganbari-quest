/**
 * scripts/lib/ci/reason-declaration.mjs
 *
 * gate の例外宣言 (`<!-- <key>: <理由> -->`) における **理由の実体判定 SSOT**。
 *
 * # なぜ共有するか
 *
 * 「例外は宣言できるが理由は必須」は本 repo の一貫した設計 (#3956 教訓 —
 * 理由の非強制を作らない)。各 gate が独自に stub 一覧を持つと、片方だけ `n/a` を通す
 * ドリフトが起きる。判定を 1 箇所に集約する。
 *
 * 利用側: `scripts/check-ss-blob-sha-uniqueness.mjs` (#4084) /
 *         `scripts/check-new-required-env.mjs` (#4129 AC5)
 */

/**
 * 理由記述を要求する宣言の最小長 (全角前提の目安)。
 *
 * 「理由の非強制」を作らないための下限。空欄・`TODO`・`n/a` のような定型 stub は
 * 理由として認めない。lint の `-- <reason>` 付き抑制コメントと同じ思想。
 */
export const MIN_REASON_LENGTH = 12;

/** 理由として認めない定型 stub (小文字化して完全一致で判定)。 */
export const STUB_REASONS = new Set([
	'todo',
	'tbd',
	'n/a',
	'na',
	'-',
	'—',
	'なし',
	'後で書く',
	'あとで書く',
	'理由',
	'wip',
	'fixme',
]);

/**
 * 理由文字列に実体があるかを判定する。
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function isSubstantiveReason(reason) {
	const trimmed = (reason ?? '').trim();
	return (
		trimmed.length >= MIN_REASON_LENGTH &&
		!STUB_REASONS.has(trimmed.toLowerCase()) &&
		!/^[-—\s]*$/.test(trimmed)
	);
}

/**
 * `<!-- <key>: <理由> -->` 形式の宣言を読み、理由の実体があるかを判定する。
 *
 * @param {string} body
 * @param {string} key 例: `ss-identical-ok` / `ss-pair-none`
 * @returns {{ present: boolean; reason: string; valid: boolean }}
 */
export function parseReasonDeclaration(body, key) {
	const m = (body ?? '').match(new RegExp(`<!--\\s*${key}\\s*:([^>]*?)-->`));
	if (!m) return { present: false, reason: '', valid: false };
	const reason = (m[1] ?? '').trim();
	return { present: true, reason, valid: isSubstantiveReason(reason) };
}
