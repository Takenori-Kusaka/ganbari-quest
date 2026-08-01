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
	/** endpoint 名 (CRON_ROUTE_DIR からの相対パス。入れ子なら 'a/b') */
	name: string;
	/** repo root からの +server.ts パス */
	file: string;
	/** 認可層に渡される path */
	urlPath: string;
	/** 原文 */
	source: string;
	/** コメント / 文字列リテラルを除去した実コード (呼び出し検査用) */
	code: string;
}

/**
 * コメント (`//` / 文末 `/* … *​/`) と文字列リテラル (' " `) を空白に潰す。
 *
 * これを挟まないと、**コメントに書かれた関数名が呼び出しとして誤検出される**。
 * 実測 (#4206 の adversarial review): `src/routes/api/cron/pglite-backup/+server.ts:8` の
 * 「認証は既存 cron 群と同じ verifyCronAuth (x-cron-secret …)」というコメントだけで
 * [C2] が緑になり、L33 の実呼び出しを消しても検出できなかった。
 * **guard が「唯一の防波堤」である以上、コメントで満たせる検査は防波堤ではない。**
 *
 * 完全な字句解析ではない (正規表現の限界) が、コメント / 文字列という
 * 最も現実的なすり抜け経路は閉じる。
 */
function stripCommentsAndStrings(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\/[^\n]*/g, ' ')
		.replace(/`(?:\\.|[^`\\])*`/g, ' ')
		.replace(/'(?:\\.|[^'\\\n])*'/g, ' ')
		.replace(/"(?:\\.|[^"\\\n])*"/g, ' ');
}

/**
 * `+server.ts` を**再帰的に**集める。
 *
 * 認可層の allowlist は `startsWith('/api/cron/')` で**任意深度**を公開するため、
 * 深さ 1 だけを見る母数収集では「公開されるが検査されない」route が生まれる
 * (入れ子 route / route group `(group)` / パラメータ route)。母数は公開範囲と一致させる。
 */
function collectCronRoutes(): CronRoute[] {
	const root = path.resolve(process.cwd(), CRON_ROUTE_DIR);
	if (!fs.existsSync(root)) return [];

	const routes: CronRoute[] = [];

	const walk = (absDir: string, relSegments: string[]): void => {
		for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
			const abs = path.join(absDir, entry.name);

			if (entry.isDirectory()) {
				walk(abs, [...relSegments, entry.name]);
				continue;
			}
			if (entry.name !== '+server.ts') continue;

			const source = fs.readFileSync(abs, 'utf-8');
			const rel = relSegments.join('/');
			routes.push({
				name: rel === '' ? '(root)' : rel,
				file: path.posix.join(CRON_ROUTE_DIR, rel, '+server.ts'),
				// SvelteKit の route group `(name)` は URL に現れない
				urlPath: `/api/cron${relSegments
					.filter((s) => !s.startsWith('('))
					.map((s) => `/${s}`)
					.join('')}`,
				source,
				code: stripCommentsAndStrings(source),
			});
		}
	};

	walk(root, []);
	return routes;
}

const cronRoutes = collectCronRoutes();

describe('cron route の認証は route 側が担う (#4206)', () => {
	it('[C1] 母数: cron route が FS から 1 本以上検出される', () => {
		// 0 件なら「全部通った」ではなく「1 本も検査していない」。
		// ディレクトリ移動やリネームで本 test が空振りするのを防ぐ。
		expect(cronRoutes.length).toBeGreaterThan(0);
	});

	describe('[C2] 全 route が verifyCronAuth を呼び、戻り値を捨てない', () => {
		for (const route of cronRoutes) {
			it(`${route.name} が verifyCronAuth を import している`, () => {
				expect(route.code).toMatch(/import\s*\{[^}]*\bverifyCronAuth\b[^}]*\}/);
			});

			it(`${route.name} が verifyCronAuth を呼び出している`, () => {
				// import しただけで呼んでいない = 素通し。import 検査だけでは捕まらない。
				// 判定は code (コメント / 文字列除去済) に対して行う。
				expect(route.code).toMatch(/\bverifyCronAuth\s*\(/);
			});

			it(`${route.name} が verifyCronAuth の戻り値を使っている`, () => {
				// 呼ぶだけで結果を無視する実装 (`verifyCronAuth(request);` の呼び捨て) は
				// 認証していないのと同じ。代入 (`const e = verifyCronAuth(`) か
				// 直接分岐 (`if (verifyCronAuth(` / `return verifyCronAuth(`) を要求する。
				expect(route.code).toMatch(
					/(?:=|if\s*\(|return|\?\?|&&|\|\|)\s*(?:await\s+)?verifyCronAuth\s*\(/,
				);
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
