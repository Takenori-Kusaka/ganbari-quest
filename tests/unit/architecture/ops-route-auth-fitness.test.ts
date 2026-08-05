// cspell:ignore opsedit opsx
// ↑ [O5] の負例。`/ops` に前方一致するが `/ops` ではない**実在しない route** を意図的に置く。
//   綴りを「直す」と negative case が成立せず、過剰公開を検出できないことを検出できなくなる
//   (tests/CLAUDE.md §「負例 fixture と cspell」)。global words には足さない (file scope に閉じる)。

// tests/unit/architecture/ops-route-auth-fitness.test.ts
// #4309: /ops の認可の担い手が route 側にあり、**その適用範囲に穴が無い**ことを機械強制する
//        fitness function。`cron-route-auth-fitness.test.ts` (#4206) と同型の対の装置。
//
// 背景:
//   `/ops` は `isPublicRoute()` の allowlist に載っている。これは「認証不要」ではなく
//   「**認証の担い手が認可層ではなく route 側 (requireOpsAccess) にある**」の意味である
//   (認可層の `RouteRule.roles` は owner / parent / child の 3 値しか持たず、
//   Cognito group も MFA 有無も表現できない。詳細は authorization.ts の該当注釈)。
//
//   そのため `/ops` の防御は `requireOpsAccess` **だけ**になる。ところが #4266 / PR #4284 は
//   その gate を `+layout.server.ts` にだけ置いた。**SvelteKit の `+layout.server.ts` は
//   page にしか適用されず `+server.ts` には走らない**ため、`/ops/export/+server.ts` は
//   認可ゼロのまま外部公開され、staging で `GET /ops/export?type=sales` が未認証で
//   200 + 実顧客の売上台帳 CSV を返した (#4309)。
//
//   PR #4284 が追加した `tests/unit/routes/ops-mfa-guard.test.ts` は**純関数の真理値表のみ**を
//   検証しており、「`/ops/**` の全 route が実際にその gate を通るか」は 1 件も見ていなかった。
//   本 test がその適用範囲を見る唯一の装置である。
//
// 検証範囲:
//   [O1] 母数 — 実 FS 上の src/routes/ops/**/+server.ts を列挙する (literal 固定禁止)。
//        新しい ops API を足した人が本 test を書き換えなくても自動で検査対象に入る。
//   [O2] 全 endpoint が requireOpsAccess を import し、かつ呼び出していること。
//        import だけして呼んでいない (= 素通し) を検出するため、import と呼び出しを別々に見る。
//   [O3] page 側 (+layout.server.ts) も**同じ関数**を使っていること。
//        判定が 2 つに分かれると、片方だけ直して片方が古いままになる (#4309 の再演)。
//   [O4] allowlist 側の実装が実際に /ops を認可層で通していること (認可層との突き合わせ)。
//        ここが fail する = 委譲の前提が崩れた。route 側 gate の意味づけを見直すこと。
//   [O5] 境界 — `/ops` に前方一致する**別 route** (`/opsedit` 等) まで公開していないこと。
//
// no-silent-gap: 除外リストを持たない。/ops 配下の endpoint は例外なく requireOpsAccess を
//   要求する。「この endpoint だけは別の認証」が必要になった時点で、本 test を fail させたうえで
//   除外構造を理由・追跡 Issue 付きで設計すること。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { authorizeCognito } from '../../../src/lib/server/auth/authorization';
import { stripCommentsAndStrings } from './helpers/strip-comments-and-strings';

// #4085: 走査 test の区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
// 実走査は src/routes/ops 配下の単一 dir で有界だが、静的判定は保守的に repo と見なす。
// 判定を緩めるのではなく宣言を合わせ、明示 timeout を置く (tests/CLAUDE.md §「repo 走査 test」)。
vi.setConfig({ testTimeout: 60_000 });

/** ops 画面の実体ディレクトリ (母数の SSOT。literal 列挙は禁止) */
const OPS_ROUTE_DIR = 'src/routes/ops';

/** 認可の単一強制点。ここを変えるときは ops-authz.ts と同時に変える */
const OPS_GUARD = 'requireOpsAccess';

interface OpsEndpoint {
	/** endpoint 名 (OPS_ROUTE_DIR からの相対パス) */
	name: string;
	/** repo root からの +server.ts パス */
	file: string;
	/** 認可層に渡される path */
	urlPath: string;
	/** コメント / 文字列リテラルを除去した実コード (呼び出し検査用) */
	code: string;
}

/**
 * `/ops` 配下の `+server.ts` を**再帰的に**集める。
 *
 * 認可層の allowlist は `/ops/` の**任意深度**を通すため、深さ 1 だけを見る母数収集では
 * 「公開されるが検査されない」endpoint が生まれる。母数は公開範囲と一致させる。
 */
function collectOpsEndpoints(): OpsEndpoint[] {
	const root = path.resolve(process.cwd(), OPS_ROUTE_DIR);
	if (!fs.existsSync(root)) return [];

	const endpoints: OpsEndpoint[] = [];

	const walk = (absDir: string, relSegments: string[]): void => {
		for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
			const abs = path.join(absDir, entry.name);

			if (entry.isDirectory()) {
				walk(abs, [...relSegments, entry.name]);
				continue;
			}
			if (entry.name !== '+server.ts') continue;

			const rel = relSegments.join('/');
			endpoints.push({
				name: rel === '' ? '(root)' : rel,
				file: path.posix.join(OPS_ROUTE_DIR, rel, '+server.ts'),
				// SvelteKit の route group `(name)` は URL に現れない
				urlPath: `/ops${relSegments
					.filter((s) => !s.startsWith('('))
					.map((s) => `/${s}`)
					.join('')}`,
				code: stripCommentsAndStrings(fs.readFileSync(abs, 'utf-8')),
			});
		}
	};

	walk(root, []);
	return endpoints;
}

const opsEndpoints = collectOpsEndpoints();

describe('/ops の認可は route 側が担い、適用範囲に穴が無い (#4309)', () => {
	it('[O1] 母数: /ops 配下の +server.ts が 1 本以上検出される', () => {
		// 0 件なら「全部通った」ではなく「1 本も検査していない」。
		// ディレクトリ移動やリネームで本 test が空振りするのを防ぐ。
		expect(opsEndpoints.length).toBeGreaterThan(0);
	});

	describe(`[O2] 全 endpoint が ${OPS_GUARD} を呼ぶ`, () => {
		for (const endpoint of opsEndpoints) {
			it(`${endpoint.name} が ${OPS_GUARD} を import している`, () => {
				expect(endpoint.code).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${OPS_GUARD}\\b[^}]*\\}`));
			});

			it(`${endpoint.name} が ${OPS_GUARD} を呼び出している`, () => {
				// import しただけで呼んでいない = 素通し。import 検査だけでは捕まらない。
				// 判定は code (コメント / 文字列除去済) に対して行う。
				expect(endpoint.code).toMatch(new RegExp(`\\b${OPS_GUARD}\\s*\\(`));
			});
		}
	});

	it(`[O3] page 側 (+layout.server.ts) も同じ ${OPS_GUARD} を使う`, () => {
		// page と API で判定を分けると、片方だけ直して片方が古いままになる。
		// #4309 はまさに「page だけ新しい鍵で守り、API は鍵をかけないまま」で起きた。
		const layout = stripCommentsAndStrings(
			fs.readFileSync(path.resolve(process.cwd(), OPS_ROUTE_DIR, '+layout.server.ts'), 'utf-8'),
		);
		expect(layout).toMatch(new RegExp(`\\b${OPS_GUARD}\\s*\\(`));
	});

	describe('[O4] 認可層は /ops を route 側に委譲している', () => {
		for (const endpoint of opsEndpoints) {
			it(`${endpoint.urlPath} は認可層を通過し route 側 gate に到達する`, () => {
				// ここが fail する = allowlist から /ops が消えた。
				// route 側 gate との二重防御になるだけで危険側には倒れないが、
				// 前提が変わったので本 test の意味づけ (委譲) を見直すこと。
				expect(authorizeCognito(endpoint.urlPath, null, null).allowed).toBe(true);
			});
		}
	});

	describe('[O5] 前方一致で別 route を巻き込まない', () => {
		// 素朴な startsWith('/ops') はこれらまで公開してしまう (cron の #4206 と同型)。
		const notOpsPaths = ['/opsedit', '/ops-admin', '/opsx'];

		for (const notOps of notOpsPaths) {
			it(`${notOps} は公開しない`, () => {
				expect(authorizeCognito(notOps, null, null).allowed).toBe(false);
			});
		}
	});
});
