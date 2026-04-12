import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			out: 'build',
		}),
		alias: {
			$lib: 'src/lib',
		},
		csrf: {
			// Docker(NUC LAN) ビルドでは DISABLE_CSRF_ORIGIN_CHECK=true を build arg で渡し、
			// 192.168.68.0/23 内の任意端末からの POST を許可する。
			// Lambda(本番) ビルドではデフォルト空配列 → ORIGIN env var のみ信頼。
			trustedOrigins: process.env.DISABLE_CSRF_ORIGIN_CHECK === 'true' ? ['*'] : [],
		},
		prerender: {
			// #832: /sitemap.xml はクローラ経由では到達できない（/ → /setup リダイレクト
			// のため）。明示的にエントリポイントに追加する。
			// '*' はデフォルトの「/ から辿れるページを全部クロール」を維持。
			entries: ['*', '/sitemap.xml'],
		},
	},
};

export default config;
