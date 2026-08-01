// tests/unit/architecture/cron-route-auth-fitness.test.ts
// #4206: cron route の認証の担い手が route 側にあることを機械強制する fitness function
//
// 背景:
//   #4206 で `/api/cron/` を `isPublicRoute()` の allowlist に追加した。これは
//   「認証不要」の意味ではなく、「**認証の担い手が認可層ではなく route 側 (verifyCronAuth) にある**」
//   の意味である。cron dispatcher (EventBridge → Lambda → Function URL への HTTP POST) は
//   Cognito セッションを持たないため、認可層で弾くと handler に到達できず、本番 AWS で
//   1 ヶ月・成功率 0.8% の全滅を起こしていた。
//
//   したがって allowlist 追加以降、cron route の防御は各 route の `verifyCronAuth`
//   (CRON_SECRET / OPS_SECRET_KEY 検証) **だけ**になる。1 本でも呼び忘れれば
//   **無認証で外部公開される**。本 test がその唯一の防波堤である。
//
// 検証範囲:
//   [C1] 母数 — 実 FS 上の src/routes/api/cron/*/+server.ts を列挙する (literal 固定禁止)。
//        新しい cron route を足した人が本 test を書き換えなくても自動で検査対象に入る。
//   [C2] 全 route が verifyCronAuth を import し、かつ呼び出していること。
//        import だけして呼んでいない (= 素通し) を検出するため、import と呼び出しを別々に見る。
//   [C3] allowlist 側の実装が実際に cron route を公開していること (認可層との突き合わせ)。
//        allowlist から誤って消された場合、[C3] が fail して #4206 の再発を即検出する。
//   [C4] 境界 — `/api/cron` に前方一致する**別 route** (`/api/cronjobs` 等) まで
//        公開していないこと。素朴な startsWith による過剰公開の回帰 guard。
//
// no-silent-gap: 除外リストを持たない。cron route は例外なく verifyCronAuth を要求する。
//   「この route だけは別の認証」が必要になった時点で、本 test を fail させたうえで
//   除外構造を理由・追跡 Issue 付きで設計すること (schedule-consistency.test.ts の
//   DOCUMENTED_EXCLUSIONS の作法に倣う)。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。区分は
// scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

import { authorizeCognito } from '../../../src/lib/server/auth/authorization';

/** cron endpoint の実体ディレクトリ (母数の SSOT。literal 列挙は禁止) */
const CRON_ROUTE_DIR = 'src/routes/api/cron';

interface CronRoute {
	/** endpoint 名 (ディレクトリ名) */
	name: string;
	/** repo root からの +server.ts パス */
	file: string;
	/** 認可層に渡される path */
	urlPath: string;
	source: string;
}

function collectCronRoutes(): CronRoute[] {
	const dir = path.resolve(process.cwd(), CRON_ROUTE_DIR);
	if (!fs.existsSync(dir)) return [];

	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const file = path.join(CRON_ROUTE_DIR, entry.name, '+server.ts');
			return {
				name: entry.name,
				file,
				urlPath: `/api/cron/${entry.name}`,
				source: fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8'),
			};
		})
		.filter((route) => fs.existsSync(path.resolve(process.cwd(), route.file)));
}

const cronRoutes = collectCronRoutes();

describe('cron route の認証は route 側が担う (#4206)', () => {
	it('[C1] 母数: cron route が FS から 1 本以上検出される', () => {
		// 0 件なら「全部通った」ではなく「1 本も検査していない」。
		// ディレクトリ移動やリネームで本 test が空振りするのを防ぐ。
		expect(cronRoutes.length).toBeGreaterThan(0);
	});

	describe('[C2] 全 route が verifyCronAuth を呼ぶ', () => {
		for (const route of cronRoutes) {
			it(`${route.name} が verifyCronAuth を import している`, () => {
				expect(route.source).toMatch(/import\s*\{[^}]*\bverifyCronAuth\b[^}]*\}/);
			});

			it(`${route.name} が verifyCronAuth を呼び出している`, () => {
				// import しただけで呼んでいない = 素通し。import 検査だけでは捕まらない。
				expect(route.source).toMatch(/\bverifyCronAuth\s*\(/);
			});
		}
	});

	describe('[C3] 認可層は cron route を通す', () => {
		for (const route of cronRoutes) {
			it(`${route.urlPath} は Cognito セッション無しでも通過する`, () => {
				// ここが fail する = allowlist から /api/cron が消えた = #4206 の再発。
				// 本番 AWS で cron が全滅するが、cron は「動かなくても画面は正常」なので
				// 顧客からの申告では発覚しない。
				const result = authorizeCognito(route.urlPath, null, null);
				expect(result.allowed).toBe(true);
			});
		}
	});

	describe('[C4] 前方一致で別 route を巻き込まない', () => {
		const notCronPaths = ['/api/cronjobs', '/api/cron-admin', '/api/crontab'];

		for (const notCron of notCronPaths) {
			it(`${notCron} は公開しない`, () => {
				const result = authorizeCognito(notCron, null, null);
				expect(result.allowed).toBe(false);
			});
		}
	});
});
