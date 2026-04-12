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
			// CSRF 検証は ORIGIN 環境変数（adapter-node がランタイムで読む）で制御。
			// ハードコード IP 禁止 — deploy-nuc.yml が LAN IP を自動検出して .env に書き出す。
			checkOrigin: true,
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
