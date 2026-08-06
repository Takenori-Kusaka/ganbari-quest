// tests/unit/architecture/helpers/strip-comments-and-strings.ts
// route の「認可関数を実際に呼んでいるか」を検査する fitness function 群の共有ヘルパ (#4206 / #4309)。

/**
 * コメント (`//` / `/* … *​/`) と文字列リテラル (' " `) を空白に潰す。
 *
 * これを挟まないと、**コメントに書かれた関数名が呼び出しとして誤検出される**。
 * 実測 (#4206 の adversarial review): `src/routes/api/cron/pglite-backup/+server.ts:8` の
 * 「認証は既存 cron 群と同じ verifyCronAuth (x-cron-secret …)」というコメントだけで
 * 呼び出し検査が緑になり、実呼び出しを消しても検出できなかった。
 * **guard が「唯一の防波堤」である以上、コメントで満たせる検査は防波堤ではない。**
 *
 * 完全な字句解析ではない (正規表現の限界) が、コメント / 文字列という
 * 最も現実的なすり抜け経路は閉じる。
 */
export function stripCommentsAndStrings(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\/[^\n]*/g, ' ')
		.replace(/`(?:\\.|[^`\\])*`/g, ' ')
		.replace(/'(?:\\.|[^'\\\n])*'/g, ' ')
		.replace(/"(?:\\.|[^"\\\n])*"/g, ' ');
}
