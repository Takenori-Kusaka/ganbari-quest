// tests/unit/architecture/route-db-boundary.test.ts
// #3152 Phase 2 (ADR-0061 決定④ / item 5): 構造不変条件の fitness function 化。
//
// CLAUDE.md の散文構造ルール「`+server.ts` から ORM 直呼び禁止 / routes に DB 直接アクセス禁止
// (必ず `$lib/server/db` facade or `$lib/server/services` 経由)」を、人手 review でなく
// 単体 fitness function (実 route FS 走査) で stage-1 PR gate 化する。
// admin 正準契約 (#3134/#3164) と同型の Architecture Fitness Function (Building Evolutionary
// Architecture / Neal Ford 他)。新規ツール導入ゼロ (既存 vitest + node fs)。
//
// 検出は static `import ... from '...'` に加え、dynamic `import('...')` / `require('...')` も
// 対象とする (#3152 QM BLOCK: switch/+page.server.ts が dynamic import 経由で raw ORM を直呼びし
// static-only detector をすり抜けていた)。switch は raw ORM を service (child-data-reset-service) へ
// 移譲して解消済。残る既知の dynamic import 経由 DB touch (api/health の liveness probe /
// tenant-cleanup の保守バッチ) は BASELINE_VIOLATIONS に 1 件単位で明記し migration 待ちとする。
// 以降どの route が新たに drizzle-orm / schema / client / backend-specific repo を直 import すれば
// (baseline 超過 = 新規違反として) CI が即落ちる。baseline の拡大は不可、縮小 (migration) のみ歓迎。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROUTES_DIR = resolve(REPO_ROOT, 'src/routes');

// server 専用 route module (load / actions / endpoint)。client (.svelte) は対象外。
const SERVER_ROUTE_FILES = new Set(['+server.ts', '+page.server.ts', '+layout.server.ts']);

// 禁止 import specifier (raw ORM / table 定義 / 生 client / backend 固有 repo 実装)。
// routes は `$lib/server/db/<facade>` (例 point-repo) か `$lib/server/services/*` 経由で DB に触れる。
const FORBIDDEN_IMPORT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /['"]drizzle-orm['"]/, reason: 'raw ORM (drizzle-orm) を route で直接使用' },
	{
		// `db/schema` module 本体のみ (table 定義)。`db/schema-validator` 等の
		// 別 module を巻き込まないよう module 末尾 (quote / slash) を anchor する。
		pattern: /\$lib\/server\/db\/schema(?=['"/])/,
		reason: 'テーブル定義 (db/schema) を route で直接 import',
	},
	{
		pattern: /\$lib\/server\/db\/client/,
		reason: '生 DB client (db/client) を route で直接 import',
	},
	{
		pattern: /\$lib\/server\/db\/sqlite\//,
		reason:
			'backend 固有実装 (db/sqlite/*) を route で直接 import (facade `$lib/server/db/*` 経由にする)',
	},
	{
		pattern: /\$lib\/server\/db\/dynamodb\//,
		reason: 'backend 固有実装 (db/dynamodb/*) を route で直接 import (facade 経由にする)',
	},
	{
		pattern: /\$lib\/server\/db\/demo\//,
		reason: 'backend 固有実装 (db/demo/*) を route で直接 import (facade 経由にする)',
	},
];

// 静的 import/export: `import ... from '...'` / `export ... from '...'`
const STATIC_IMPORT_LINE = /^\s*(?:import|export)\b[^\n]*\bfrom\s+['"][^'"]+['"]/;
// 動的 import / require: `import('...')` / `await import('...')` / `require('...')`
// (route が dynamic import 経由で raw ORM を直呼びする抜け道を塞ぐ、#3152 QM BLOCK)
// #3184 item3: 引数の form を問わず import(/require( 呼び出し開始を検出する (literal '...' / "..." /
// テンプレートリテラル `...` / 連結 'a'+x いずれも走査対象に含める)。実際の違反判定は
// FORBIDDEN_IMPORT_PATTERNS (DB パス文字列) が担うため、走査対象を広げても DB パスを含まない
// 正規の dynamic import は false-positive にならない (= 安全に検出網を広げられる)。
const DYNAMIC_IMPORT_LINE = /\b(?:import|require)\s*\(/;

/** 静的 import / 動的 import / require のいずれかで module を取り込む行を抽出する。 */
function isImportLike(line: string): boolean {
	return STATIC_IMPORT_LINE.test(line) || DYNAMIC_IMPORT_LINE.test(line);
}

function walkServerRouteFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walkServerRouteFiles(full, acc);
		} else if (SERVER_ROUTE_FILES.has(entry.name)) {
			acc.push(full);
		}
	}
	return acc;
}

interface Violation {
	file: string;
	reason: string;
}

// ── 既知の baseline 違反 (migration 待ち、新規追加禁止) ─────────────────────────
// #3152 QM BLOCK 対応で dynamic import 検出を追加した結果、static `from` 検出では
// 漏れていた既存の dynamic import 経由 raw DB touch が顕在化した。これらは
// **switch のような "raw ORM business logic を route に直書き" とは性質が異なる
// infra liveness / 保守バッチの probe** であり、本 BLOCK の scope (switch 移譲) 外。
// migration は別 follow-up Issue で扱う。それまでの間 1 件単位で baseline 固定し、
// 「baseline 超過 = 新規違反」のみ hard-fail させる (新たな抜け道を作らせない)。
//
// 新規 route がここに該当した場合は **baseline に足すのではなく service / facade へ
// 移譲する** こと。baseline の縮小 (migration) のみ歓迎、拡大は QM 指摘対象。
// #3184 item4: 旧 baseline 3 件 (health probe ×2 / tenant-cleanup Scan) は facade 移譲で解消済。
//   - /api/health → db/probe.ts facade (probeSqlite / probeDynamoDB) 経由
//   - /api/v1/admin/tenant-cleanup → auth repo facade (listAllTenants) + client filter 経由
// baseline は空 = route↔DB 境界違反ゼロ。新規 route が違反したら baseline に足さず facade / service
// へ移譲すること (append は #3184 item3 の length-freeze test が機械禁止)。
const FROZEN_BASELINE_COUNT = 0; // #3184 item3: 以後 append 禁止 (増やすなら facade 移譲が先)
const BASELINE_VIOLATIONS: Violation[] = [];

function violationKey(v: Violation): string {
	return `${v.file}::${v.reason}`;
}

function findViolations(): Violation[] {
	const violations: Violation[] = [];
	for (const file of walkServerRouteFiles(ROUTES_DIR, [])) {
		const content = readFileSync(file, 'utf-8');
		const importLines = content.split('\n').filter(isImportLike);
		for (const { pattern, reason } of FORBIDDEN_IMPORT_PATTERNS) {
			if (importLines.some((l) => pattern.test(l))) {
				violations.push({ file: relative(REPO_ROOT, file).replace(/\\/g, '/'), reason });
			}
		}
	}
	return violations;
}

describe('#3152 Phase 2: route ↔ DB 境界の fitness function (ADR-0061 / CLAUDE.md)', () => {
	const serverFiles = walkServerRouteFiles(ROUTES_DIR, []);

	it('server route file を FS 走査できている (sanity)', () => {
		expect(serverFiles.length).toBeGreaterThan(0);
	});

	it('routes は ORM / schema / client / backend 固有 repo を直接 import しない (documented baseline 超過 0、static + dynamic import)', () => {
		const violations = findViolations();
		const baselineKeys = new Set(BASELINE_VIOLATIONS.map(violationKey));
		const newViolations = violations.filter((v) => !baselineKeys.has(violationKey(v)));
		expect(
			newViolations,
			`新規 route ↔ DB 境界違反:\n${newViolations
				.map((v) => `  - ${v.file}: ${v.reason}`)
				.join(
					'\n',
				)}\n→ DB アクセスは \`$lib/server/db/<facade>\` か \`$lib/server/services/*\` 経由にする (CLAUDE.md / ADR-0061)。baseline には足さず service へ移譲すること`,
		).toEqual([]);
	});

	it('baseline 違反が stale でない (migration 済みなら baseline から削除する)', () => {
		// 実コードに存在しない baseline エントリが残っていると、その file が再び違反しても
		// 黙って許容されてしまう。baseline は「現に存在する違反」と完全一致させる。
		const actualKeys = new Set(findViolations().map(violationKey));
		const staleBaseline = BASELINE_VIOLATIONS.filter((v) => !actualKeys.has(violationKey(v)));
		expect(
			staleBaseline,
			`既に解消済みの baseline エントリ (削除してください):\n${staleBaseline
				.map((v) => `  - ${v.file}: ${v.reason}`)
				.join('\n')}`,
		).toEqual([]);
	});

	it('禁止パターンが静的 import の違反文字列を検出する (guard 自体の動作確認)', () => {
		const sample = "import { db } from '$lib/server/db/client';";
		expect(isImportLike(sample)).toBe(true);
		const hit = FORBIDDEN_IMPORT_PATTERNS.some((p) => p.pattern.test(sample));
		expect(hit).toBe(true);
	});

	it('動的 import / require 経由の raw ORM 直呼びも検出する (#3152 QM BLOCK 非トートロジー証明)', () => {
		// switch/+page.server.ts が以前すり抜けていた dynamic import 形を検証対象に含めることを保証する。
		const dynamicSamples = [
			"const { db } = await import('$lib/server/db/client');",
			"const { eq } = await import('drizzle-orm');",
			"const schema = await import('$lib/server/db/schema');",
			"const { db } = require('$lib/server/db/client');",
		];
		for (const sample of dynamicSamples) {
			// (1) import-like 行として走査対象に含まれる (旧 detector はここで漏らしていた)
			expect(isImportLike(sample), `走査対象から漏れている: ${sample}`).toBe(true);
			// (2) かつ禁止パターンにマッチする
			const hit = FORBIDDEN_IMPORT_PATTERNS.some((p) => p.pattern.test(sample));
			expect(hit, `禁止パターン未検出: ${sample}`).toBe(true);
		}

		// 旧 detector (静的 from のみ) では dynamic import 行が走査対象外だったことを明示。
		expect(STATIC_IMPORT_LINE.test("const { db } = await import('$lib/server/db/client');")).toBe(
			false,
		);
		expect(DYNAMIC_IMPORT_LINE.test("const { db } = await import('$lib/server/db/client');")).toBe(
			true,
		);
	});

	it('#3184 item3: テンプレートリテラル / 連結形の dynamic import も走査対象に含める (難読化 import 検出強化)', () => {
		const obfuscatedSamples = [
			'const m = await import(`$lib/server/db/client`);', // backtick (full path)
			"const m = await import('$lib/server/db/' + 'client');", // 連結 (開始引数あり)
			'const m = await import(modPath);', // computed (path は別変数)
		];
		for (const sample of obfuscatedSamples) {
			expect(isImportLike(sample), `走査対象から漏れている: ${sample}`).toBe(true);
		}
		// backtick で full DB パスを書いた難読化は禁止パターンにもマッチする (検出される)
		const backtickFullPath = 'const m = await import(`$lib/server/db/client`);';
		expect(FORBIDDEN_IMPORT_PATTERNS.some((p) => p.pattern.test(backtickFullPath))).toBe(true);
	});

	it('#3184 item3: baseline は append 禁止 (length-freeze、増やすなら facade 移譲が先)', () => {
		// baseline への新規追加 (= 抜け道の黙認) を機械禁止する。違反が出たら facade / service へ
		// 移譲して baseline を増やさない。縮小 (migration) のみ許容。
		expect(BASELINE_VIOLATIONS.length).toBeLessThanOrEqual(FROZEN_BASELINE_COUNT);
	});
});
