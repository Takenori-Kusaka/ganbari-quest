// tests/unit/architecture/route-db-boundary.test.ts
// #3152 Phase 2 (ADR-0061 決定④ / item 5): 構造不変条件の fitness function 化。
//
// CLAUDE.md の散文構造ルール「`+server.ts` から ORM 直呼び禁止 / routes に DB 直接アクセス禁止
// (必ず `$lib/server/db` facade or `$lib/server/services` 経由)」を、人手 review でなく
// 単体 fitness function (実 route FS 走査) で stage-1 PR gate 化する。
// admin 正準契約 (#3134/#3164) と同型の Architecture Fitness Function (Building Evolutionary
// Architecture / Neal Ford 他)。新規ツール導入ゼロ (既存 vitest + node fs)。
//
// 現状 (develop) は本ルールを 0 違反で満たすため hard guard として固定する。
// 以降どの route が drizzle-orm / schema / client / backend-specific repo を直 import すれば CI が即落ちる。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
		pattern: /\$lib\/server\/db\/schema/,
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

const IMPORT_LINE = /^\s*(?:import|export)\b[^\n]*\bfrom\s+['"][^'"]+['"]/;

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

function findViolations(): Violation[] {
	const violations: Violation[] = [];
	for (const file of walkServerRouteFiles(ROUTES_DIR, [])) {
		const content = readFileSync(file, 'utf-8');
		const importLines = content.split('\n').filter((l) => IMPORT_LINE.test(l));
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

	it('routes は ORM / schema / client / backend 固有 repo を直接 import しない (services / db facade 経由)', () => {
		const violations = findViolations();
		expect(
			violations,
			`route ↔ DB 境界違反:\n${violations
				.map((v) => `  - ${v.file}: ${v.reason}`)
				.join(
					'\n',
				)}\n→ DB アクセスは \`$lib/server/db/<facade>\` か \`$lib/server/services/*\` 経由にする (CLAUDE.md / ADR-0061)`,
		).toEqual([]);
	});

	it('禁止パターンが既知の違反文字列を検出する (guard 自体の動作確認)', () => {
		const sample = "import { db } from '$lib/server/db/client';";
		const hit = FORBIDDEN_IMPORT_PATTERNS.some((p) => p.pattern.test(sample));
		expect(hit).toBe(true);
	});
});
