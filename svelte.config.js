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
