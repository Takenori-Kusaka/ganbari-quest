import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			out: 'build',
		}),
		// #2125 / PR #2124 fix commit d828a8f2 完了:
		// path alias は `tsconfig.json` の baseUrl/paths ではなく **必ず `kit.alias` に書く**
		// (SvelteKit 公式推奨、CI auto-gen tsconfig warning 回避)。
		// kit.alias は SvelteKit が .svelte-kit/tsconfig.json paths + vite resolve.alias の
		// 両方に自動同期するため、ts / build / vitest / playwright で一貫した解決が得られる。
		// tsconfig.json 側に baseUrl / paths を追加すると SvelteKit が
		// "tsconfig.json paths interferes with kit-generated paths" warning を出す。
		alias: {
			$lib: 'src/lib',
			// #2097 ADR-0048 week 4: CDK 依存は infra/node_modules にのみ存在し
			// root devDeps に重複導入すると lockfile 不整合 (jsonschema 1.4.1 vs 1.5.0)。
			// kit.alias 経由で tests/unit/infra/ から `aws-cdk-lib` を resolve させる。
			'aws-cdk-lib': 'infra/node_modules/aws-cdk-lib',
			constructs: 'infra/node_modules/constructs',
		},
		csrf: {
			// Docker(NUC LAN) ビルドでは DISABLE_CSRF_ORIGIN_CHECK=true を build arg で渡し、
			// 家庭内 LAN サブネット内の任意端末からの POST を許可する (実サブネット値は repo にコミットしない、#2987)。
			// Lambda(本番) ビルドではデフォルト空配列 → ORIGIN env var のみ信頼。
			trustedOrigins: process.env.DISABLE_CSRF_ORIGIN_CHECK === 'true' ? ['*'] : [],
		},
		prerender: {
			// #832: /sitemap.xml はクローラ経由では到達できない（/ → /setup リダイレクト
			// のため）。明示的にエントリポイントに追加する。
			// '*' はデフォルトの「/ から辿れるページを全部クロール」を維持。
			entries: ['*', '/sitemap.xml'],
		},
		// #3829 (EPIC #3408 slice C): アプリ側 CSP を SvelteKit 標準 CSP (kit.csp hash mode) に一本化。
		// SvelteKit が hydration bootstrap の inline `<script>` を sha256 hash 化して `script-src` に
		// 自動注入するため、`script-src 'unsafe-inline'` を撤廃できる (stored-XSS 経路の script ベクタを
		// 構造的に塞ぐ、#3112 構造リスク 1 の根治)。旧 `hooks.server.ts buildCspHeader()` の全 directive を
		// SSOT として写経し 1:1 一致させている (img/media/font/connect 等を漏らさない)。CSP header の付与は
		// SvelteKit が担うため hooks 側の `Content-Security-Policy` `.set()` は撤去済 (clobber 除去)。
		// - SSR ページ: HTTP header で付与 / prerender ページ (sitemap 等): `<meta>` で付与。
		// - `frame-ancestors` は meta では効かない (SvelteKit が meta 生成時に自動除外) ため、prerender
		//   ページの clickjacking 防御は hooks の `X-Frame-Options: DENY` が backup として担保する。
		// - `style-src 'unsafe-inline'` は本 PR では維持 (slice B = #3408 AC2 で別途扱う)。
		// - ADR-0067 (アプリ側 script-src hash 化) / ADR-0029 (LP 側 CSP、別 origin・別スコープ、併存) 参照。
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none'],
			},
		},
	},
};

export default config;
