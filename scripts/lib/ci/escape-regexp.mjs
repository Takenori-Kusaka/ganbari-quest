/**
 * scripts/lib/ci/escape-regexp.mjs (#3766)
 *
 * 正規表現メタ文字を完全にエスケープする SSOT helper。
 *
 * 背景: CodeQL `js/incomplete-sanitization` は「一部のメタ文字だけを置換する」
 * 部分サニタイズ (例: `.replace(/\./g, '\\.')` で `.` だけ escape) を報告する。
 * リテラル文字列を `new RegExp()` に埋め込む用途では、`.` 以外の `*+?^$()[]{}|\/-` も
 * escape しないと意図しないマッチを招く。本 helper で全メタ文字を 1 度に escape する。
 *
 * pattern は MDN 推奨の `[.*+?^${}()|[\]\\]` に `/` `-` を加えた集合
 * (character class 内でも安全側)。「全メタ文字を漏れなく」を優先する。
 *
 * @param {string} str エスケープ対象のリテラル文字列
 * @returns {string} 正規表現内でリテラルとして扱える文字列
 */
export function escapeRegExp(str) {
	return String(str).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}
