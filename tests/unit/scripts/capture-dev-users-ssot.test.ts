// tests/unit/scripts/capture-dev-users-ssot.test.ts
//
// dev 専用資格情報 (cognito-dev の DEV_USERS) の SSOT は cognito-dev.ts。撮影 flow (.mjs) と
// Playwright E2E (.ts) はそれぞれ helper (scripts/capture-specs/lib/dev-users.mjs /
// tests/e2e/helpers/dev-users.ts) で SSOT のソースを読んで取り出す。
// - 両 helper の取り出し結果が SSOT の DEV_USERS と 1:1 で一致すること (regex が書式変更で黙って壊れない)
// - scripts / tests/e2e / src / docs に password の literal 複製が残っていないこと
//   (QM #4831: 29 flow + E2E 44 箇所、#4834: login 画面の案内 3 行 + docs/security に散在していた)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEV_USERS } from '../../../src/lib/server/auth/providers/cognito-dev';
import * as e2eHelper from '../../e2e/helpers/dev-users';

// biome-ignore lint/suspicious/noExplicitAny: .mjs には型が無い
const mjsHelper: any = await import('../../../scripts/capture-specs/lib/dev-users.mjs');

// repo 走査 test (tests/CLAUDE.md §repo 走査 test、#4085): scripts / tests/e2e / src / docs を歩くため明示 timeout
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = join(__dirname, '../../..');
/** literal 複製を禁止する範囲 (SSOT 本体と helper 自身は除く) */
const SCAN_DIRS = ['scripts', 'tests/e2e', 'src', 'docs'];
const EXEMPT = new Set([
	'src/lib/server/auth/providers/cognito-dev.ts',
	'scripts/capture-specs/lib/dev-users.mjs',
	'tests/e2e/helpers/dev-users.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (name === 'node_modules') continue;
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(ts|mjs|js|cjs|svelte|md)$/.test(name)) out.push(full);
	}
	return out;
}

function pairs(list: { email: string; password: string }[]): string[] {
	return list.map((u) => `${u.email}:${u.password}`).sort();
}

describe('dev 専用資格情報 (DEV_USERS) の SSOT', () => {
	it('両 helper の取り出し結果は cognito-dev.ts の DEV_USERS と一致する', () => {
		const ssot = pairs(DEV_USERS);
		expect(ssot.length).toBeGreaterThan(0);
		expect(pairs(mjsHelper.loadDevUsers())).toEqual(ssot);
		expect(pairs(e2eHelper.loadDevUsers())).toEqual(ssot);
	});

	it('devUser / devPassword は SSOT の値を返し、未知の email は throw する', () => {
		const ops = DEV_USERS.find((u) => u.email === 'ops@example.com');
		expect(ops).toBeDefined();
		expect(mjsHelper.devPassword('ops@example.com')).toBe(ops?.password);
		expect(e2eHelper.devPassword('ops@example.com')).toBe(ops?.password);
		expect(() => mjsHelper.devUser('nobody@example.com')).toThrow();
		expect(() => e2eHelper.devUser('nobody@example.com')).toThrow();
	});

	it('scripts / tests/e2e / src / docs に DEV_USERS の password literal が複製されていない', () => {
		const passwords = DEV_USERS.map((u) => u.password);
		const offenders: string[] = [];
		for (const dir of SCAN_DIRS) {
			for (const file of walk(join(REPO_ROOT, dir))) {
				const rel = file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
				if (EXEMPT.has(rel)) continue;
				const src = readFileSync(file, 'utf8');
				for (const pw of passwords) {
					if (src.includes(pw)) offenders.push(`${rel} (${pw.slice(0, 8)}…)`);
				}
			}
		}
		expect(
			offenders,
			'DEV_USERS の password が直書きされています。scripts は scripts/capture-specs/lib/dev-users.mjs、E2E は tests/e2e/helpers/dev-users.ts の devPassword(email) を使ってください',
		).toEqual([]);
	});
});
