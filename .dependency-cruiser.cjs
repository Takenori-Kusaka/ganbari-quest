// .dependency-cruiser.cjs — app (src/) 依存境界の宣言的 gate (#3871 / ADR-0061 Phase 2)
//
// ADR-0061 決定④「構造不変条件の fitness function 化」が Phase 2 の機械化手段として
// dependency-cruiser を明示的に指名した (§35 / §48)。本 config は CLAUDE.md の散文構造
// ルール (routes↛DB 直 access / +server.ts↛raw ORM) を AST 依存解決ベースで宣言的に encode し、
// 加えて **循環依存 (error)** と **orphan module (warn)** という既存 Vitest fitness が未カバーの
// 領域を閉塞する。
//
// 責務境界 (AC5、rip-replace 禁止): depcruise は「import 境界 + 循環 + orphan」に責務限定。
// domain 論理を持つ Vitest fitness (dsql-* / schema-range-ssot 等の値域/OCC/tenant 述語) は
// Vitest 継続。CSS Base token ratchet (base-token-routes-ratchet) は CSS custom property の
// 使用回数 ratchet であり module import graph ではないため depcruise で表現不能 → Vitest 継続。
//
// module 名解決: SvelteKit の `$lib` alias は tsconfig.depcruise.json (baseUrl='.' + repo root 相対
// paths) を tsConfig に指定して解決する。SvelteKit 生成の `.svelte-kit/tsconfig.json` は baseUrl 無し
// + `.svelte-kit/` 相対 paths のため depcruise の path 解決で `$lib` が couldNotResolve になり、
// routes↛DB 等の forbidden ルールが resolved path にマッチせず inert 化する (これを防ぐ)。
// node_modules は doNotFollow で葉ノードとして残し (drizzle-orm 等への forbidden 判定に必要)、
// graph には含めるが辿らない。

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		// ── AC1: 循環依存 = error ──────────────────────────────────────────────
		{
			name: 'no-circular',
			severity: 'error',
			comment:
				'循環依存を検出した。barrel の serial 順依存 pollution や相互参照は初期化順の非決定性・' +
				'tree-shaking 阻害を招く。依存を一方向に整理する (ADR-0061 Phase 2 / #3871)。',
			from: {},
			to: { circular: true },
		},

		// ── AC1: orphan module = warn (既存許容 → 新規 0) ──────────────────────
		// どこからも import されず、かつ何も import しない module (dead code の疑い)。
		// 意図的 entry / 型宣言 / config は pathNot で除外し、新規 orphan のみ warn。
		{
			name: 'no-orphans',
			severity: 'warn',
			comment:
				'orphan module (どこからも参照されず何も参照しない)。dead code / 取り残し export の疑い。' +
				'意図的な entry / 型定義 / 宣言ファイルは pathNot 例外に追加する (#3871)。',
			from: {
				orphan: true,
				pathNot: [
					'(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$', // dotfiles (config 類)
					'\\.d\\.ts$', // 型宣言ファイル
					'(^|/)(app\\.d\\.ts|service-worker\\.ts|hooks\\.(server|client)\\.ts)$', // SvelteKit framework entry
					'\\.(config|conf)\\.(js|cjs|mjs|ts)$', // config
				],
			},
			to: {},
		},

		// ── AC2: routes ↛ DB backend/client/schema 直 import (facade/service 経由) ─
		// CLAUDE.md「routes に DB 直接アクセス禁止 (必ず $lib/server/db facade or services 経由)」。
		// route-db-boundary.test.ts の FORBIDDEN_IMPORT_PATTERNS を AST 解決で再表現する。
		{
			name: 'routes-no-db-internals',
			severity: 'error',
			comment:
				'route が DB backend 固有実装 / 生 client / table 定義を直接 import している。' +
				'$lib/server/db/<facade> または $lib/server/services/* 経由にする (CLAUDE.md / ADR-0061)。',
			from: { path: '^src/routes/' },
			to: {
				path: [
					'^src/lib/server/db/schema(\\.|/|$)', // table 定義
					'^src/lib/server/db/client(\\.|/|$)', // 生 DB client
					'^src/lib/server/db/sqlite/', // backend 固有 (sqlite)
					'^src/lib/server/db/dsql/', // backend 固有 (dsql)
					'^src/lib/server/db/demo/', // backend 固有 (demo)
				],
			},
		},

		// ── AC2: route ↛ raw ORM (drizzle-orm) 直呼び ─────────────────────────
		// CLAUDE.md「+server.ts から ORM 直呼び禁止」。ORM は service / db facade に閉じ込める。
		{
			name: 'routes-no-raw-orm',
			severity: 'error',
			comment:
				'route が raw ORM (drizzle-orm) を直接 import している。ORM 直呼びは service / db facade に' +
				'閉じ込める (CLAUDE.md「+server.ts から ORM 直呼び禁止」/ ADR-0061)。',
			from: { path: '^src/routes/' },
			to: { dependencyTypes: ['npm'], path: '(^|/)drizzle-orm(/|$)' },
		},
	],
	options: {
		tsConfig: { fileName: 'tsconfig.depcruise.json' },
		tsPreCompilationDeps: true,
		// node_modules は葉ノードとして残す (drizzle-orm への forbidden 判定に必要) が辿らない。
		// exclude に node_modules を含めるとノード自体が graph から消え routes-no-raw-orm が inert 化
		// するため、node_modules は exclude せず doNotFollow のみで扱う。
		doNotFollow: { path: 'node_modules' },
		// 生成物のみ解析対象外 (node_modules は上記 doNotFollow で扱う)。
		exclude: {
			path: '(^|/)(\\.svelte-kit|build|coverage|storybook-static)/',
		},
		enhancedResolveOptions: {
			exportsFields: ['exports'],
			conditionNames: ['import', 'require', 'node', 'default', 'types'],
			extensions: ['.ts', '.js', '.mjs', '.cjs', '.svelte', '.json'],
		},
	},
};
