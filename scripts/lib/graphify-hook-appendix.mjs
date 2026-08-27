// scripts/lib/graphify-hook-appendix.mjs — `graphify hook install` の自己追記を捨てる (#4638 ①)
//
// `graphify hook install` は **git 追跡下の** `.husky/post-commit` に自分自身を追記し、
// その中へ install したマシンの絶対パスを焼き込む:
//
//     _PINNED='C:\Users\<開発者名>\AppData\Roaming\uv\tools\graphify\Scripts\python.exe'
//
// `scripts/prepare.mjs` が `npm ci` / `npm install` のたびに hook install を呼ぶ (#4442:
// merge driver を local git config に登録する目的) ため、**clone するたび working tree が汚れる**。
// 汚れたまま `git add -A` すると PR に混入する — PR #4635 は実際にこれで main を汚し、
// #4639 で戻すことになった (#4638)。
//
// 追記ブロック自体は `.husky/post-commit` 先頭の branch guard (#4536) が feature branch で
// `exit 0` するため到達せず、develop / main では直前の `graphify update .` と二重になる。
// つまり追跡ファイルに残す価値が無い。一方 merge driver の登録先は local git config なので、
// 追記を捨てても #4442 の目的は損なわれない。

/** `graphify hook install` が追記するブロックの開始マーカー。 */
export const GRAPHIFY_APPENDIX_MARKER = '# graphify-hook-start';

/**
 * hook ファイルの中身から graphify の追記ブロックだけを取り除く。
 *
 * **追記ブロック以外には触らない** — 開発者が hook 本体に加えた編集を巻き添えで捨てないため
 * (`git checkout --` で丸ごと戻す実装は、未コミットの作業を復元不能に捨てるので採らない)。
 *
 * @param {string} source hook ファイルの中身
 * @returns {string | null} 追記があれば取り除いた中身、無ければ `null` (呼び出し側で no-op)
 */
export function stripGraphifyHookAppendix(source) {
	const index = source.indexOf(GRAPHIFY_APPENDIX_MARKER);
	if (index === -1) return null;

	// マーカー行の手前までを残す。マーカーの前に空行が積まれるので合わせて畳み、
	// 末尾は改行 1 本で終わらせる (元ファイルの体裁を変えない)。
	return `${source.slice(0, index).replace(/\n+$/, '')}\n`;
}
