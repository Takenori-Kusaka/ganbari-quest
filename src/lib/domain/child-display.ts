/**
 * 子どもの名前表示ユーティリティ
 *
 * 子どもの名前にまつわる表示ロジックを一元管理する。
 * 敬称（ちゃん/くん等）のハードコードを防ぎ、
 * 将来のカスタマイズ対応（保護者が敬称を設定）に備える。
 */

/** 名前の表示コンテキスト */
export type NameContext =
	| 'possessive' // 「〜の」（例: ゆうきの がんばり記録）
	| 'vocative' // 呼びかけ（例: ゆうき、すごい！）
	| 'subject' // 主語（例: ゆうきが レベル5に なったよ！）
	| 'label'; //  単純表示（例: 一覧の名前列）

/**
 * 子どもの名前を表示用にフォーマットする。
 *
 * @param name - 登録名（nickname）。null/undefined/空文字の場合はフォールバック
 * @param context - 表示コンテキスト
 * @returns フォーマット済み文字列
 *
 * @example
 * formatChildName('ゆうき', 'possessive') // => 'ゆうきの'
 * formatChildName('ゆうき', 'vocative')   // => 'ゆうき、'
 * formatChildName('ゆうき', 'subject')    // => 'ゆうきが'
 * formatChildName('ゆうき', 'label')      // => 'ゆうき'
 * formatChildName('', 'possessive')       // => ''
 * formatChildName(null, 'vocative')       // => ''
 */
export function formatChildName(
	name: string | null | undefined,
	context: NameContext = 'label',
): string {
	if (!name) return '';

	switch (context) {
		case 'possessive':
			return `${name}の`;
		case 'vocative':
			return `${name}、`;
		case 'subject':
			return `${name}が`;
		case 'label':
			return name;
	}
}

/**
 * 複数の子ども名を結合して表示する。
 *
 * @param names - 子どもの名前の配列
 * @param context - 結合後の表示コンテキスト
 * @returns フォーマット済み文字列。空配列の場合は空文字列
 *
 * @example
 * formatChildNames(['ゆうき', 'はな'], 'possessive') // => 'ゆうき、はなの'
 * formatChildNames([], 'possessive')                  // => ''
 */
export function formatChildNames(names: string[], context: NameContext = 'label'): string {
	const validNames = names.filter(Boolean);
	if (validNames.length === 0) return '';

	const joined = validNames.join('、');
	return formatChildName(joined, context);
}
