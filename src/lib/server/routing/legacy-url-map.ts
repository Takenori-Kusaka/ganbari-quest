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
	// #2993 (EPIC #2990): PIN 忘れ救済を email magic link 方式からパスワード再入力方式に置換。
	// 旧 /auth/forgot-pin (email 手入力) は新 /auth/reset-pin (パスワード再入力 + 新 PIN) に統合。
	// 旧 /auth/reset-pin/<token> は 30 分期限・1 回限りの使い捨て magic link のため救済対象外
	// (from: '/auth/reset-pin' は新 URL 自身に prefix match し無限ループするため登録不可)。
	{
		from: '/auth/forgot-pin',
		to: '/auth/reset-pin',
		deletedAt: '2026-06-11',
		issue: '#2993',
		reason: 'PIN 忘れ救済をパスワード再入力方式に置換 (email 手入力 + SES magic link 廃止)',
	},
	// #2371 (EPIC #2362 PO 指摘 ③): /admin/activities/introduce 廃止
	// PR #2388 で PageGuideOverlay v2 + PageGuideRegistry 経由のヘッダー `?` ボタンに統一
	// したため、旧 introduce ページは不要。ブックマーク / 外部リンク救済のため URL 層で吸収。
	{
		from: '/admin/activities/introduce',
		to: '/admin/activities',
		deletedAt: '2026-05-21',
		issue: '#2371',
		reason: 'PageGuideRegistry に統合 (PO 指摘 ③、二重ガイド撤廃)',
	},
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
	// #2097 PR-B2 (#2187): /demo/(child)/* 14 file 撤去に伴い、demo (child) routes へのアクセスは
	// 本番 (child) routes に直接 redirect する。demo Lambda 環境 (AnonymousAuth/DATA_SOURCE=demo)
	// では本番ルートが demo データで稼働するため、demo path を恒久的にホスト不要となる。
	// 旧 demo (child) URL (kinder/lower/upper/teen 含む) は永久保持で本番 path に飛ばす。
	// #571 の `/demo/kinder` → `/demo/preschool` entry は本 PR で `/preschool` 直行に書き換え（2 段 redirect 回避）。
	{
		from: '/demo/preschool',
		to: '/preschool',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/elementary',
		to: '/elementary',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/junior',
		to: '/junior',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/senior',
		to: '/senior',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/baby',
		to: '/baby',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/checklist',
		to: '/checklist',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/checklist 撤去に伴う本番ルート直接 redirect',
	},
	// 旧 legacy mode 名 (kinder/lower/upper/teen) を demo path 経由で踏んだ場合も
	// 本番 path に直行する (2 段 redirect 回避 + ブックマーク救済)。
	// 旧 `/demo/kinder → /demo/preschool` (#571) は本 PR で書き換え。
	{
		from: '/demo/kinder',
		to: '/preschool',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去 + 年齢区分リネーム連鎖を 1 段 redirect で吸収',
	},
	{
		from: '/demo/lower',
		to: '/elementary',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去 + 年齢区分リネーム連鎖を 1 段 redirect で吸収',
	},
	{
		from: '/demo/upper',
		to: '/junior',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去 + 年齢区分リネーム連鎖を 1 段 redirect で吸収',
	},
	{
		from: '/demo/teen',
		to: '/senior',
		deletedAt: '2026-05-17',
		issue: '#2187',
		reason: '#2097 PR-B2: /demo/(child)/* 撤去 + 年齢区分リネーム連鎖を 1 段 redirect で吸収',
	},
	// #1167: 活動パック詳細 → マーケットプレイス詳細に集約
	// /activity-packs/[packId] は /marketplace/activity-pack/[itemId] の二重実装だった。
	// 購入前プレビューはマーケットプレイス詳細で行う設計に変更したため、
	// マーケットに同名 item が存在する 4 パックは 301 で恒久移動させる。
	// baby 系 3 パックは #1301 でマーケットから削除。 → マーケット一覧にフォールバック。
	{
		from: '/activity-packs/baby-first',
		to: '/marketplace?type=activity-pack',
		deletedAt: '2026-04-25',
		issue: '#1301',
		reason: 'baby-first は ADR-0011 に伴いマーケットから削除。一覧へフォールバック',
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
	// #1212-A: マーケットプレイス SSOT 統合 — テーマ型 9 件廃止 + 性別バリアント 10 件を正式収録
	// otetsudai-master は kinder-starter / elementary-challenge に吸収されたため個別詳細を廃止
	{
		from: '/activity-packs/otetsudai-master',
		to: '/marketplace?type=activity-pack',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: 'おてつだいマスター廃止（年齢プリセットへ吸収）→ マーケット一覧へ',
		status: 301,
	},
	{
		from: '/activity-packs/baby-boy',
		to: '/marketplace?type=activity-pack',
		deletedAt: '2026-04-25',
		issue: '#1301',
		reason: 'baby-boy は ADR-0011 に伴いマーケットから削除。一覧へフォールバック',
		status: 301,
	},
	{
		from: '/activity-packs/baby-girl',
		to: '/marketplace?type=activity-pack',
		deletedAt: '2026-04-25',
		issue: '#1301',
		reason: 'baby-girl は ADR-0011 に伴いマーケットから削除。一覧へフォールバック',
		status: 301,
	},
	{
		from: '/activity-packs/kinder-boy',
		to: '/marketplace/activity-pack/kinder-boy',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	{
		from: '/activity-packs/kinder-girl',
		to: '/marketplace/activity-pack/kinder-girl',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	{
		from: '/activity-packs/elementary-boy',
		to: '/marketplace/activity-pack/elementary-boy',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	{
		from: '/activity-packs/elementary-girl',
		to: '/marketplace/activity-pack/elementary-girl',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	{
		from: '/activity-packs/junior-boy',
		to: '/marketplace/activity-pack/junior-boy',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	{
		from: '/activity-packs/junior-girl',
		to: '/marketplace/activity-pack/junior-girl',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	{
		from: '/activity-packs/senior-boy',
		to: '/marketplace/activity-pack/senior-boy',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	{
		from: '/activity-packs/senior-girl',
		to: '/marketplace/activity-pack/senior-girl',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '性別バリアント正式収録',
		status: 301,
	},
	// 一覧ページ自体も廃止（マーケット一覧で代替）
	{
		from: '/activity-packs',
		to: '/marketplace?type=activity-pack',
		deletedAt: '2026-04-20',
		issue: '#1212',
		reason: '/activity-packs 一覧 → マーケット一覧（activity-pack フィルタ）',
		status: 301,
	},
	// #1782: 実績機能廃止に伴い /admin/achievements を /admin/challenges に統合
	// ADR-0012 §6「収集目的の独立 UI / 称号コレクション閲覧ページ / ミッションリスト UI 駆動導線」
	// 禁止に整合し、長期の達成感はチャレンジ機能 (/admin/challenges) に統合した。
	// /admin/achievements を bookmark / 内部リンクから踏まれた場合の救済として 308 redirect。
	{
		from: '/admin/achievements',
		to: '/admin/challenges',
		deletedAt: '2026-05-01',
		issue: '#1782',
		reason:
			'実績機能廃止 + チャレンジ機能 (/admin/challenges) への統合（ADR-0012 §6 整合 / #404 廃止合意の revert 復活への対応）',
	},
	// #2175: 廃止済「実績システム」命名残存解消
	// /(child)/[uiMode]/(character)/achievements/ ルートは中身がチャレンジ画面 (週次 challenge) で
	// 命名と内容の不一致 = SSOT 違反だったため /challenges に rename。
	// 旧 URL は 5 年齢モード全て (baby/preschool/elementary/junior/senior) で発生しうるので
	// プレフィックス毎に redirect エントリを追加 (ブックマーク救済、永久保持)。
	{
		from: '/baby/achievements',
		to: '/baby/challenges',
		deletedAt: '2026-05-18',
		issue: '#2175',
		reason: '廃止済「実績システム」命名残存解消: 子供画面 (character tab) を /challenges に rename',
	},
	{
		from: '/preschool/achievements',
		to: '/preschool/challenges',
		deletedAt: '2026-05-18',
		issue: '#2175',
		reason: '廃止済「実績システム」命名残存解消: 子供画面 (character tab) を /challenges に rename',
	},
	{
		from: '/elementary/achievements',
		to: '/elementary/challenges',
		deletedAt: '2026-05-18',
		issue: '#2175',
		reason: '廃止済「実績システム」命名残存解消: 子供画面 (character tab) を /challenges に rename',
	},
	{
		from: '/junior/achievements',
		to: '/junior/challenges',
		deletedAt: '2026-05-18',
		issue: '#2175',
		reason: '廃止済「実績システム」命名残存解消: 子供画面 (character tab) を /challenges に rename',
	},
	{
		from: '/senior/achievements',
		to: '/senior/challenges',
		deletedAt: '2026-05-18',
		issue: '#2175',
		reason: '廃止済「実績システム」命名残存解消: 子供画面 (character tab) を /challenges に rename',
	},
	// #2097 PR-B3 (#2188): /demo/admin/* 29 file 撤去に伴う本番 admin ルート直接 redirect。
	// PR-B2 で /demo/(child)/* を撤去したのに続き、本 PR で /demo/(parent)/admin/* と
	// /demo/+layout.{server,svelte} + /demo/+page.{server,svelte} + /demo/signup を全削除。
	// demo Lambda は AnonymousAuth + DATA_SOURCE=demo で本番 admin routes を直接 host する。
	// 旧 /demo/admin/<sub> URL は bookmark / 内部リンク救済のため永久保持で本番 /admin/<sub> へ 308。
	//
	// 注: `findLegacyRedirect()` は length 降順評価のため、`/demo/admin/license` (長) →
	// `/demo/admin` (中) → `/demo` (短) の順でヒット候補となる。明示エントリは可読性 +
	// test 網羅性のために追加するが、`/demo/admin` 親エントリでも prefix match で同じ
	// 本番 path に到達する (前方一致のため `/demo/admin/foo → /admin/foo`)。
	// 旧 `/demo/admin/achievements → /demo/admin/challenges` (#1782) は本 PR で
	// `/admin/achievements → /admin/challenges` に統合 1 段化される (parent `/demo/admin`
	// entry より長い `/demo/admin/achievements` が先にヒットするため明示エントリで保持)。
	{
		from: '/demo/admin/achievements',
		to: '/admin/challenges',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason:
			'#2097 PR-B3: /demo/admin/* 撤去 + #1782 実績廃止 redirect を 1 段化 (旧 /demo/admin/challenges 経由を回避)',
	},
	{
		from: '/demo/admin/activities',
		to: '/admin/activities',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/challenges',
		to: '/admin/challenges',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/checklists',
		to: '/admin/checklists',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/children',
		to: '/admin/children',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/events',
		// #2295 (EPIC #2294 ①): /admin/events 自体も撤去 → /admin/challenges に統合のため、
		//   /demo/admin/events も最終 hop を /admin/challenges に更新 (中間 hop 削減 / 永久 308)
		to: '/admin/challenges',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason:
			'#2097 PR-B3: /demo/admin/* 撤去 + #2295 シーズンイベント機構廃止 → /admin/challenges redirect を 1 段化',
	},
	{
		from: '/demo/admin/license',
		// #2525 Phase 7 PR-L3 (#2818): /admin/license 自体も /admin/subscription に rename されたため、
		//   /demo/admin/license も最終 hop を /admin/subscription に更新 (中間 hop 削減 / 永久 308)
		to: '/admin/subscription',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason:
			'#2097 PR-B3: /demo/admin/* 撤去 + #2525 Phase 7 PR-L3 /admin/license → /admin/subscription rename → redirect を 1 段化',
	},
	{
		from: '/demo/admin/members',
		to: '/admin/members',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/messages',
		// #2270 / #2275 (EPIC #2266): /admin/messages 自体も廃止 → /admin/cheer に統合のため、
		//   /demo/admin/messages も最終 hop を /admin/cheer に更新 (中間 hop 削減 / 永久 308)
		to: '/admin/cheer',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason:
			'#2097 PR-B3: /demo/admin/* 撤去 + #2270 messages 廃止 → /admin/cheer redirect を 1 段化',
	},
	{
		from: '/demo/admin/points',
		to: '/admin/points',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/reports',
		to: '/admin/reports',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/rewards',
		to: '/admin/rewards',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/settings',
		to: '/admin/settings',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	{
		from: '/demo/admin/status',
		to: '/admin/status',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin/* 撤去に伴う本番ルート直接 redirect',
	},
	// 親 fallback: 明示エントリにない admin sub path も /admin/* に救済する。
	// 例: 将来追加された /demo/admin/some-future-page は本 entry でカバー (前方一致)。
	{
		from: '/demo/admin',
		to: '/admin',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/admin 親 fallback (明示エントリ未登録 sub path の救済)',
	},
	// /demo/signup → /auth/signup (本番 signup flow に直接遷移、demo flow 廃止)
	{
		from: '/demo/signup',
		to: '/auth/signup',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason: '#2097 PR-B3: /demo/signup 撤去 — demo flow 廃止により本番 signup へ直行',
	},
	// /demo/exit (旧 demo cookie clear endpoint) は demo Lambda 構成では不要、root に救済
	{
		from: '/demo/exit',
		to: '/',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason:
			'#2097 PR-B3: /demo/exit は Multi-Lambda 構成 (ADR-0048) では不要 — root LP に redirect',
	},
	// /demo (landing) → root (LP). LP CTA は #2181 で demo.ganbari-quest.com に切替済のため
	// 旧 LP リンクからの直接訪問のみが本 entry で救済される。`from: '/demo'` は短い prefix
	// だが length 降順評価のため `/demo/admin/*` 等の長い entry が先にヒットするので衝突なし。
	{
		from: '/demo',
		to: '/',
		deletedAt: '2026-05-17',
		issue: '#2188',
		reason:
			'#2097 PR-B3: /demo landing 撤去 — LP CTA は #2181 で demo.ganbari-quest.com 切替済、root LP fallback',
	},
	// #2295 (EPIC #2294 ①): /admin/events 廃止 — シーズンイベント機構を完全撤去 (ADR-0012 + ADR-0013 二重違反解消)
	// Research 2 段階で実機構ゼロ + 業界事例ゼロ + 自動配信ロジック皆無の dead UI と確定。
	// チャレンジ機構が代替価値提供のため /admin/challenges に救済。
	{
		from: '/admin/events',
		to: '/admin/challenges',
		deletedAt: '2026-05-19',
		issue: '#2295',
		reason:
			'シーズンイベント機構撤去 (ADR-0012 + ADR-0013 二重違反 + 業界事例ゼロ)、代替価値はチャレンジ機能',
	},
	// #2525 Phase 4 (#2620) / Phase 7 PR-L3 (#2818): /admin/license 廃止 + /admin/subscription 完全置換
	// Epic #2525 ライセンスキー販売モデル撤廃 → サブスクリプションモデル統一 rename。
	// Phase 1 補強 1 (#2583) で意味的整合性確定 (Spotify / Apple / Stripe / Lingokids 業界整合、
	// 家庭向け B2C SaaS で `license` URL 事例ゼロ)。Phase 3 #2567 で UI 設計の前提となり、
	// Phase 7 PR-L3 (#2818) で実 mv (git mv) + license key UI 撤去 + service 物理削除を実施。
	// 前方一致のため `/admin/license/foo` も `/admin/subscription/foo` に救済される。
	// 永久保持: src/routes/CLAUDE.md `#578` 旧 URL 廃止ルール (ブックマーク維持のため削除禁止)。
	{
		from: '/admin/license',
		to: '/admin/subscription',
		deletedAt: '2026-06-04',
		issue: '#2525',
		reason:
			'ライセンスキー販売モデル撤廃 → サブスクリプションモデル統一 rename (Epic #2525 Phase 4 / Phase 7 PR-L3、業界整合: Spotify / Apple / Stripe / Lingokids)',
	},
	// #2525 Phase 4 (#2620) / Phase 7 PR-L4 (#2836): site/help/license-key.html 完全削除 → /admin/subscription 301
	// ライセンスキー販売モデル撤廃 (Phase 1 補強 3 #2788 §3.4 OQ-3 確定) で help ページ自体が用途消失。
	// href 置換ではなくページ完全削除 + LEGACY_URL_MAP redirect で bookmark / 外部リンクを救済する。
	// GET 専用の help ページ削除のため 301 Moved Permanently (method 保持不要)。
	// 注: site/help/license-key.html は GitHub Pages 配信のため本 entry はアプリ Lambda 経由アクセスに効く
	//   (LP 直 URL の物理削除後は GitHub Pages 404)。LP 内部リンク・sitemap からの参照は本 PR で削除済。
	// 永久保持: src/routes/CLAUDE.md `#578` 旧 URL 廃止ルール (ブックマーク維持のため削除禁止)。
	{
		from: '/help/license-key',
		to: '/admin/subscription',
		status: 301,
		deletedAt: '2026-06-04',
		issue: '#2525',
		reason:
			'ライセンスキー販売モデル撤廃に伴う help ページ完全削除 (Epic #2525 Phase 7 PR-L4 / Phase 1 補強 3 #2788 §3.4 OQ-3)',
	},
	// #2270 / #2275 (EPIC #2266): /admin/messages 廃止 + 応援機能 /admin/cheer に統合
	// PO 報告 (2026-05-19) 「メッセージだけ送る機能は意味なし、応援は任意理由 + 直接 P 付与が核」
	// 旧 messages は P 付与なし = 子供から見て価値が薄いため廃止。スタンプ/メッセージは応援機能の付随要素として cheer に統合。
	{
		from: '/admin/messages',
		to: '/admin/cheer',
		deletedAt: '2026-05-19',
		issue: '#2275',
		reason:
			'メッセージ単独機能の存在意義がないため廃止、応援機能 /admin/cheer に統合 (EPIC #2266 rewards-cheer-shop 4 系統責務再整理)',
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
