/**
 * `src/lib/domain/labels.ts` / `terms.ts` の単純な `key: 'value'` ブロックを読む SSOT helper。
 *
 * TypeScript を実行できない build-time script (LP ラベル生成 / リリース通知生成) から
 * labels.ts の値を引くための最小パーサ。値に template literal / 関数呼び出しを含む
 * namespace は対象外であり、その解決は `scripts/generate-lp-labels.mjs` 側が担う。
 *
 * #565 で generate-lp-labels.mjs 内に置かれていたものを、#4883 で
 * build-release-notes.mjs と共有するために切り出した (使い捨て script 禁止 #1442)。
 */

/**
 * labels.ts の単純な `key: 'value'` ブロックを行単位でパースする。
 *
 * @param {string} src 対象 .ts ファイルの中身
 * @param {string} constName `export const <constName>` の名前
 * @returns {Record<string, string>}
 * @throws {Error} 対象 const が見つからないとき (無言で空を返すと SSOT ずれに気付けない)
 */
export function parseSimpleBlock(src, constName) {
	const pattern = new RegExp(`export const ${constName}[^{]*{([^}]+)}`, 's');
	const match = src.match(pattern);
	if (!match || match[1] === undefined) throw new Error(`${constName} not found in labels.ts`);
	/** @type {Record<string, string>} */
	const result = {};
	for (const line of match[1].split('\n')) {
		const m = line.match(/(\w+):\s*'([^']+)'/);
		if (m && m[1] !== undefined && m[2] !== undefined) result[m[1]] = m[2];
	}
	return result;
}

export default parseSimpleBlock;
