// tests/unit/scripts/capture-dev-users-ssot.test.ts
//
// 撮影 flow (scripts/capture-specs/flows/*.mjs) が使う DEV_USERS の資格情報は
// scripts/capture-specs/lib/dev-users.mjs が cognito-dev.ts (SSOT) から取り出す。
// - 取り出し結果が SSOT の DEV_USERS と 1:1 で一致すること (regex が書式変更で黙って壊れない)
// - flow に password の literal 複製が残っていないこと (QM #4804 レビュー: 8 script に散在していた)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_USERS } from '../../../src/lib/server/auth/providers/cognito-dev';

// biome-ignore lint/suspicious/noExplicitAny: .mjs には型が無い
const helper: any = await import('../../../scripts/capture-specs/lib/dev-users.mjs');

const FLOWS_DIR = join(__dirname, '../../../scripts/capture-specs/flows');

describe('撮影 flow の DEV_USERS 資格情報 SSOT', () => {
	it('helper の取り出し結果は cognito-dev.ts の DEV_USERS と一致する', () => {
		const fromHelper = (helper.loadDevUsers() as { email: string; password: string }[])
			.map((u) => `${u.email}:${u.password}`)
			.sort();
		const fromSsot = DEV_USERS.map((u) => `${u.email}:${u.password}`).sort();
		expect(fromHelper).toEqual(fromSsot);
		expect(fromSsot.length).toBeGreaterThan(0);
	});

	it('devUser / devPassword は SSOT の値を返し、未知の email は throw する', () => {
		const ops = DEV_USERS.find((u) => u.email === 'ops@example.com');
		expect(ops).toBeDefined();
		expect(helper.devPassword('ops@example.com')).toBe(ops?.password);
		expect(() => helper.devUser('nobody@example.com')).toThrow();
	});

	it('flow に DEV_USERS の password literal が複製されていない', () => {
		const passwords = DEV_USERS.map((u) => u.password);
		const offenders: string[] = [];
		for (const name of readdirSync(FLOWS_DIR)) {
			if (!name.endsWith('.mjs')) continue;
			const src = readFileSync(join(FLOWS_DIR, name), 'utf8');
			for (const pw of passwords) {
				if (src.includes(pw)) offenders.push(`${name} (${pw.slice(0, 8)}…)`);
			}
		}
		expect(
			offenders,
			'撮影 flow に DEV_USERS の password が直書きされています。scripts/capture-specs/lib/dev-users.mjs の devPassword(email) を使ってください',
		).toEqual([]);
	});
});
