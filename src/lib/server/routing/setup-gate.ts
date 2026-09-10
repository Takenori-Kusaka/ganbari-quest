// src/lib/server/routing/setup-gate.ts
//
// **セットアップ必須 redirect の除外判定** (PO 決裁 2026-09-10c)。
//
// ## なぜ独立した module か
//
// 除外リストは `hooks.server.ts` のインラインの `&&` 連鎖として育っており、
// **local 向けに育ったまま cognito へ広げると、cognito にしか無い導線を塞ぐ**。
// 判定を 1 箇所に出して、何を除外したかを列挙できる形にする
// (PO: 「除外したものを PR body に列挙してください。次に導線が増えたとき、
// 同じ判断をやり直せるようにしておきたい」)。
//
// ## 除外の考え方
//
// セットアップは「子供を 1 人も登録していない世帯を、登録へ連れて行く」ためのもの。
// **顧客がセットアップより先にやる必要があること**は塞がない:
//
//   1. お金の確認・操作 (請求 / 領収書 / 解約 / 決済の完了確認)
//   2. 認証 (とくにログアウト — 塞ぐと「setup を終えるまでログアウトできない」)
//   3. 同意 (再同意が要る顧客を setup に飛ばすと、同意できないまま何もできない)
//   4. 法務文書 (規約・プライバシーはいつでも読めなければならない)
//
// ## `session_id` を path でなく query で見る理由
//
// Stripe checkout の success_url は `returnPath` 指定で **任意の相対パス**になり得る
// (`api/stripe/checkout/+server.ts` の `successBase`)。着地先を path で列挙すると
// 取りこぼすので、**`session_id` が付いた要求は path を問わず通す**。
// 金の確認が先、設定は後 (PO 決裁)。

/** Stripe checkout の完了確認が乗る query key (`success_url` に `{CHECKOUT_SESSION_ID}` で載る)。 */
export const CHECKOUT_SESSION_QUERY_KEY = 'session_id';

/**
 * セットアップ必須 redirect の除外 path。
 *
 * `kind: 'prefix'` は前方一致、`kind: 'exact'` は完全一致。
 * `reason` は「なぜ塞いではいけないか」— 次に導線が増えたときの判断材料。
 */
export const SETUP_REDIRECT_EXEMPT_PATHS: readonly {
	path: string;
	kind: 'prefix' | 'exact';
	reason: string;
}[] = [
	// --- ウィザード本体と静的資産 ---
	{ path: '/setup', kind: 'prefix', reason: 'ウィザード自身 (除外しないと無限 redirect)' },
	{ path: '/_app', kind: 'prefix', reason: 'SvelteKit のビルド成果物' },
	{ path: '/favicon', kind: 'prefix', reason: '静的資産 (redirect すると favicon が壊れる)' },
	{ path: '/api/health', kind: 'prefix', reason: 'ヘルスチェック (認証も setup も無関係)' },
	{
		path: '/sitemap.xml',
		kind: 'exact',
		reason:
			'#832 公開 SEO エンドポイント。プリレンダも hooks を通るため、塞ぐとビルド時に静的化できない',
	},
	{
		path: '/robots.txt',
		kind: 'exact',
		reason: '#832 公開 SEO エンドポイント (sitemap.xml と同じくプリレンダ対象)',
	},
	{
		path: '/offline',
		kind: 'exact',
		reason: '#4644 オフライン着地。塞ぐと「オフラインなのに /setup へ飛ばして更に失敗する」',
	},

	// --- 顧客の権利・法令に基づく導線 ---
	{
		path: '/unsubscribe/',
		kind: 'prefix',
		reason: '#1601 特定電子メール法。クリックしたら確実に解除できる必要がある',
	},
	{ path: '/inquiry/founder', kind: 'prefix', reason: '#1594 ADR-0023 I8 直接相談 (公開ページ)' },
	{
		path: '/api/v1/inquiry/founder',
		kind: 'prefix',
		reason: '#1594 ADR-0023 I8 直接相談の送信経路 (画面だけ開けても送れないと意味が無い)',
	},
	{
		path: '/survey/',
		kind: 'prefix',
		reason: '#1598 ADR-0023 I7 PMF アンケート (HMAC トークン認証)',
	},

	// --- バックアップからの復元 ---
	{
		path: '/admin/settings/data',
		kind: 'exact',
		reason:
			'#4696 全削除の直後は子供 0 人 = setup 必須になる。ここを塞ぐと「エクスポートしておいてください」と案内しておきながらバックアップから戻せない',
	},
	{
		path: '/api/v1/import',
		kind: 'prefix',
		reason: '#4696 復元の実行経路。画面だけ開けても戻せないと意味が無い',
	},

	// --- PO 決裁 2026-09-10c: cognito へ広げるにあたって足した 4 系統 ---
	{
		path: '/admin/subscription',
		kind: 'prefix',
		reason:
			'課金。契約直後に「請求はどうなっている」と見に来る人を setup に閉じ込めない。解約・領収書もここ',
	},
	{
		path: '/api/stripe',
		kind: 'prefix',
		reason: '課金の実行経路。塞ぐと画面は開けても「解約する」「ポータルを開く」が動かない',
	},
	{
		path: '/auth',
		kind: 'prefix',
		reason:
			'認証。**local にはログアウトが無い**。cognito で塞ぐと setup を終えるまでログアウトできない人が出る',
	},
	{
		path: '/api/v1/auth',
		kind: 'prefix',
		reason: '認証の実行経路 (ログアウト等)。画面だけ開けても実行できないと出られない',
	},
	{
		path: '/consent',
		kind: 'exact',
		reason: '同意。再同意が必要な顧客を setup に飛ばすと、同意できないまま何もできない',
	},
	{
		path: '/legal',
		kind: 'prefix',
		reason: '法務。規約・プライバシーは、いつでも読めなければいけない',
	},
];

/**
 * この要求をセットアップ必須 redirect の対象から外すか。
 *
 * @param pathname 判定対象の path
 * @param search   query 文字列 (`url.search`)。Stripe checkout の完了確認を先に通すために見る
 */
export function isSetupRedirectExempt(pathname: string, search = ''): boolean {
	// 金の確認が先、設定は後 (PO 決裁 2026-09-10c)。
	// 着地先は returnPath 次第で任意の path になるため、path でなく query で判定する。
	if (new URLSearchParams(search).has(CHECKOUT_SESSION_QUERY_KEY)) return true;

	return SETUP_REDIRECT_EXEMPT_PATHS.some((entry) =>
		entry.kind === 'exact' ? pathname === entry.path : pathname.startsWith(entry.path),
	);
}

/**
 * セットアップ必須 redirect を適用するテナント。`undefined` なら gate 自体を回さない。
 *
 * - `local`: 単一世帯なので、context が無くても `'local'` を使う (旧実装の挙動)
 * - `cognito`: **テナントが解決できたときだけ**。未認証で倒すと、ログインしに来た人を
 *   `/setup` へ飛ばしてログインできなくする
 * - `anonymous` (demo): **適用しない**。demo は書き込みが no-op で セットアップを完了できず、
 *   一度入れたら永久に出られない
 */
export function resolveSetupGateTenantId(params: {
	authMode: string;
	tenantId: string | undefined;
}): string | undefined {
	if (params.authMode === 'local') return params.tenantId ?? 'local';
	if (params.authMode === 'cognito') return params.tenantId;
	return undefined;
}
