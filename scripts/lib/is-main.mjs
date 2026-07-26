/**
 * CLI script が「直接実行された」かを判定する SSOT helper (Issue #3969)。
 *
 * ## なぜ helper が必要か
 *
 * 従来 `scripts/` 配下の各 script は末尾で以下のような自前の判定を書いていた:
 *
 * ```js
 * const isMain = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
 * if (isMain) main();
 * ```
 *
 * この形は **symlink / junction 経由で起動すると必ず false になる**。
 * `import.meta.url` は Node が実体パスへ解決するのに対し、`process.argv[1]` は
 * ユーザーが与えたパスのまま絶対化されるだけだからである。結果として
 * `main()` が呼ばれず、**何も検査しないまま exit 0 (= PASS)** になる。
 *
 * gate script でこれが起きると「壊れていることに誰も気付かない」ため、
 * 誤った plan を黙って書き込む silent fallback と同じ class の事故になる。
 *
 * さらに `import.meta.url === \`file://${process.argv[1]}\`` という手組み URL 比較は
 * Windows で `file:///E:/...` と `file://E:\...` を比較することになり、
 * symlink の有無に関係なく**常に false** になる。
 *
 * ## 判定方針
 *
 * 両辺を `realpath` で正規化してから比較する。symlink / junction / 相対パス /
 * 大文字小文字ゆれ (Windows) のいずれでも同じ結論になる。
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * パスを比較可能な正規形へ落とす。
 *
 * - symlink / junction は実体へ解決する
 * - 解決できない場合 (ファイルが消えている等) は絶対パス化のみに fallback する
 * - Windows は path が case-insensitive なので小文字へ寄せる
 *
 * @param {string} p
 * @returns {string}
 */
function canonicalize(p) {
	const absolute = resolve(p);
	let real;
	try {
		// realpathSync.native は Windows でドライブレターの表記ゆれも正規化する
		real = realpathSync.native ? realpathSync.native(absolute) : realpathSync(absolute);
	} catch {
		real = absolute;
	}
	return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * 呼び出し元 module が CLI として直接実行されたかを返す。
 *
 * `import` 経由 (unit test 等) では false を返すため、
 * `if (isMain(import.meta.url)) main();` の形で使う。
 *
 * @param {string} importMetaUrl 呼び出し元の `import.meta.url`
 * @param {string | undefined} [argv1] 既定は `process.argv[1]` (テスト用に注入可能)
 * @returns {boolean}
 */
export function isMain(importMetaUrl, argv1 = process.argv[1]) {
	if (typeof importMetaUrl !== 'string' || importMetaUrl === '') return false;
	if (typeof argv1 !== 'string' || argv1 === '') return false;
	try {
		return canonicalize(fileURLToPath(importMetaUrl)) === canonicalize(argv1);
	} catch {
		return false;
	}
}

export default isMain;
