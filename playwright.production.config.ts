// playwright.production.config.ts
// 本番環境（ganbari-quest.com）に対するスモークテスト用設定
// 実行: npx playwright test --config playwright.production.config.ts

import { defineConfig, devices } from '@playwright/test';

// #4280: 本 smoke は **Lambda Function URL を直接**叩く (`E2E_BASE_URL` = Function URL)。
// 本番 CloudFront は geoRestriction JP で、GitHub Actions runner は日本国外にあるため
// CloudFront 経由には切り替えられない (staging は geo 制限が無いので CloudFront 経由、#4204)。
//
// front door 検査 (`/admin` `/api/v1/admin` `/ops` で `x-origin-verify` 必須) が入ったため、
// smoke は CloudFront が付けるのと同じ header を自分で付ける。付けないと login 後の
// `/admin` 遷移が 404 になり、deploy のたびに偽の赤が出る。
const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET;

// **secret を持つときは trace を録らない**。本リポジトリは public で、`test-results/` は
// artifact として 14 日間**誰でもダウンロードできる**。Playwright の trace は request header を
// そのまま記録するため、trace を残すと front door secret が公開される。
// secret を持たないローカル実行では従来どおり trace を録る (漏れるものが無いため)。
const trace = originVerifySecret ? 'off' : 'on-first-retry';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: 'production-smoke.spec.ts',
	fullyParallel: false,
	retries: 1,
	workers: 1,
	timeout: 60_000,
	reporter: [['list'], ['json', { outputFile: 'test-results/production.json' }]],
	use: {
		baseURL: process.env.E2E_BASE_URL || 'https://ganbari-quest.com',
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace,
		screenshot: 'only-on-failure',
		...(originVerifySecret ? { extraHTTPHeaders: { 'x-origin-verify': originVerifySecret } } : {}),
	},
	projects: [
		{
			name: 'production-smoke',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
		},
	],
	// webServer 不要（本番環境を直接テスト）
});
