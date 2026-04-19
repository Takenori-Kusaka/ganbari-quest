/**
 * 旧 URL → 新 URL への中央リダイレクトテーブル
 *
 * #578: 個別ページや hooks に散在していた「旧 URL の 404 救済」ロジックを
 * この 1 ファイルに集約する。新規リネームが発生したら必ずここにエントリを
 * 追加すること（個別ページで redirect() を書くのは禁止）。
 *
 * ## ルール
 * - `from` は完全一致ではなく **パス前方一致** で処理される
 *   （例: `/kinder` は `/kinder/home` や `/kinder/status` にもマッチする）
 * - クエリ文字列 / ハッシュは自動的に保持される
 * - `status` を省略した場合は `308 Permanent Redirect` を使用する
 *   （ブラウザ履歴・検索エンジンに永続移動を伝達し、メソッドを保持する）
 * - 一時的な A/B テストや実験のリダイレクトにこのテーブルを使ってはならない
 *   （その用途は個別ルートで対応すること）
 *
 * ## エントリ追加時の必須項目
 * - `deletedAt`: 旧 URL を削除した日付（YYYY-MM-DD）
 * - `issue`: 関連する GitHub Issue 番号
 * - `reason`: なぜリネームしたか（将来の棚卸しで参照する）
 */

export interface LegacyUrlEntry {
	/** 旧 URL の前方一致プレフィックス（例: "/kinder"） */
	from: string;
	/** 新 URL プレフィックス（例: "/preschool"） */
	to: string;
	/** 旧 URL を廃止した日付 (YYYY-MM-DD) */
	deletedAt: string;
	/** 関連 GitHub Issue 番号（例: "#571"） */
	issue: string;
	/** リネームの背景・理由 */
	reason: string;
	/** リダイレクトステータス（既定: 308 Permanent） */
	status?: 301 | 302 | 308;
}

/**
 * 旧 URL → 新 URL のマッピング。
 *
 * ### エントリが長いプレフィックスから順に評価されることを保証するため、
 * 追加時は手動でソートせず、呼び出し側（hooks.server.ts）で length 降順に
 * 並べ替えたものを使うこと。これにより `/demo/kinder` が `/kinder` より
 * 先に評価され、誤ったマッチングを防ぐ。
 */
export const LEGACY_URL_MAP: readonly LegacyUrlEntry[] = [
	// #537 / #539 で年齢区分コードを全面リネーム
	// 旧コード (kinder/lower/upper/teen) は DB の ui_mode カラムにも残存しており、
	// #571 で SQLite 側の normalize 処理を入れたが、ブックマーク / 外部リンク /
	// PWA ショートカット経由でアクセスされる可能性があるため URL 層でも救済する
	{
		from: '/kinder',
		to: '/preschool',
		deletedAt: '2026-04-06',
		issue: '#571',
		reason: '年齢区分リネーム: kinder (幼稚園) → preschool (未就学)',
	},
	{
		from: '/lower',
		to: '/elementary',
		deletedAt: '2026-04-06',
		issue: '#571',
		reason: '年齢区分リネーム: lower (低学年) → elementary (小学生)',
	},
	{
		from: '/upper',
		to: '/junior',
		deletedAt: '2026-04-06',
		issue: '#571',
		reason: '年齢区分リネーム: upper (高学年) → junior (高学年)',
	},
	{
		from: '/teen',
		to: '/senior',
		deletedAt: '2026-04-06',
		issue: '#571',
		reason: '年齢区分リネーム: teen (中学生) → senior (中高生)',
	},
	// デモページも同様にリネームされている
	{
		from: '/demo/kinder',
		to: '/demo/preschool',
		deletedAt: '2026-04-06',
		issue: '#571',
		reason: 'デモページ年齢区分リネーム',
	},
	// #1167: 活動パック詳細 → マーケットプレイス詳細に集約
	// /activity-packs/[packId] は /marketplace/activity-pack/[itemId] の二重実装だった。
	// 購入前プレビューはマーケットプレイス詳細で行う設計に変更したため、
	// マーケットに同名 item が存在する 6 パックは 301 で恒久移動させる。
	// 性別バリアント (baby-boy/girl 等 11 pack) はマーケット未収録のため redirect しない。
	// 性別バリアントを含む完全統合は #1169 で扱う。
	{
		from: '/activity-packs/baby-first',
		to: '/marketplace/activity-pack/baby-first',
		deletedAt: '2026-04-18',
		issue: '#1167',
		reason: '活動パック詳細をマーケットプレイス詳細に集約（購入前プレビュー強化）',
		status: 301,
	},
	{
		from: '/activity-packs/kinder-starter',
		to: '/marketplace/activity-pack/kinder-starter',
		deletedAt: '2026-04-18',
		issue: '#1167',
		reason: '活動パック詳細をマーケットプレイス詳細に集約',
		status: 301,
	},
	{
		from: '/activity-packs/elementary-challenge',
		to: '/marketplace/activity-pack/elementary-challenge',
		deletedAt: '2026-04-18',
		issue: '#1167',
		reason: '活動パック詳細をマーケットプレイス詳細に集約',
		status: 301,
	},
	{
		from: '/activity-packs/otetsudai-master',
		to: '/marketplace/activity-pack/otetsudai-master',
		deletedAt: '2026-04-18',
		issue: '#1167',
		reason: '活動パック詳細をマーケットプレイス詳細に集約',
		status: 301,
	},
	{
		from: '/activity-packs/junior-high-challenge',
		to: '/marketplace/activity-pack/junior-high-challenge',
		deletedAt: '2026-04-18',
		issue: '#1167',
		reason: '活動パック詳細をマーケットプレイス詳細に集約',
		status: 301,
	},
	{
		from: '/activity-packs/senior-high-challenge',
		to: '/marketplace/activity-pack/senior-high-challenge',
		deletedAt: '2026-04-18',
		issue: '#1167',
		reason: '活動パック詳細をマーケットプレイス詳細に集約',
		status: 301,
	},
] as const;

/**
 * パスから旧 URL エントリを検索する。
 *
 * 長いプレフィックスを優先的に評価することで、`/demo/kinder` が `/kinder` より
 * 先にヒットするようにする。
 *
 * @param pathname URL.pathname（クエリ・ハッシュを含まない）
 * @returns マッチしたエントリ、またはマッチしない場合は null
 */
export function findLegacyRedirect(pathname: string): LegacyUrlEntry | null {
	// length 降順でソート（インライン処理で毎回ソートするのは非効率だが、
	// エントリ数が少ないため許容範囲。エントリ数が増えたら事前ソートへ移行する）
	const sorted = [...LEGACY_URL_MAP].sort((a, b) => b.from.length - a.from.length);

	for (const entry of sorted) {
		if (pathname === entry.from || pathname.startsWith(`${entry.from}/`)) {
			return entry;
		}
	}
	return null;
}

/**
 * 旧 URL を新 URL に書き換える。
 *
 * クエリ文字列・ハッシュは保持される。
 *
 * @param pathname 旧 URL のパス
 * @param entry `findLegacyRedirect()` の返り値
 * @returns 新 URL のパス
 */
export function rewriteLegacyPath(pathname: string, entry: LegacyUrlEntry): string {
	return entry.to + pathname.slice(entry.from.length);
}
