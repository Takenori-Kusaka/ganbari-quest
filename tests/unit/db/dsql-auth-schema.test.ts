// tests/unit/db/dsql-auth-schema.test.ts
// EPIC #3424 / 実装 #3528 (#N2-1 Phase B) / 設計 SSOT: docs/design/dsql-data-model.md §6.6 / §11.2 / §13.1
//
// auth ドメイン 5 表 (users/families/memberships/invites/consents) の構造不変条件:
//   - PK 凍結: AUTH_PK_MANIFEST == §6.6 markdown 表 (doc-parse 突合、fitness#9 と同方式)
//   - §11.2 例外ルール: users/invites/consents は family_id 先頭でない (test list [5])
//   - owner_guard 生成列 + UNIQUE (owner ≤ 1 の DB 強制、spike#3/#6 F6)
//   - email_lower 生成列 + UNIQUE (case-insensitive 重複防止、spike#6 F7)
//   - stripe_customer_id UNIQUE (複数 NULL 許容、spike#6 F8)
//
// ⚠️ owner_guard は「owner ≤ 1」のみを守る。「誰が role を書けるか」は requireRole(['owner'])
//   の route guard (fitness#3、implementation-plan §2.3) が担う — 本テストの scope 外で
//   repo/route 実装時に positive + negative(parent→403) test を先に red で書く。
//
// ── Canon TDD test list (cycle (a) = users/families/memberships) ──
//   [A1] AUTH_PK_MANIFEST == §6.6 表 (5 表、doc-parse)
//   [A2] PK 例外ルール: users/invites/consents は単独 PK、families/memberships は family_id 先頭
//   [A3] pg schema の auth 表 PK == AUTH_PK_MANIFEST (pk-freeze-manifest.test.ts [3] の union で検証)
//   [A4] memberships.owner_guard = STORED 生成列 + UNIQUE
//   [A5] users.email_lower = 生成列 + UNIQUE / families.stripe_customer_id = UNIQUE
//   CHECK (role/status/provider) の SSOT 生成は dsql-check-from-ssot.test.ts に追記。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

/**
 * docs/design/dsql-data-model.md §6.6 の auth DDL 表 (markdown) から
 * 「表名 → 凍結 PK 列リスト」を抽出する (§11.2 parser と同方式)。
 * 行形式: | `users`(global) | `(user_id uuid)` | ... |
 */
const parseAuthPkTable = (): Record<string, string[]> => {
	const doc = readFileSync(join(__dirname, '../../../docs/design/dsql-data-model.md'), 'utf-8');
	const lines = doc.split('\n');
	const start = lines.findIndex((l) => l.includes('§6.6 auth ドメイン確定 DDL'));
	const end = lines.findIndex((l, i) => i > start && l.startsWith('## §7'));
	expect(start, '§6.6 見出しが設計書に存在する').toBeGreaterThanOrEqual(0);
	expect(end, '§7 見出しが設計書に存在する').toBeGreaterThan(start);

	const frozen: Record<string, string[]> = {};
	for (const line of lines.slice(start, end)) {
		if (!line.startsWith('|')) continue;
		const cells = line.split('|').map((c) => c.trim());
		const name = (cells[1] ?? '').match(/^`([a-z0-9_]+)`/)?.[1];
		const pkTuple = (cells[2] ?? '').match(/^`\(([^)<]+)\)`$/)?.[1];
		if (!name || !pkTuple) continue;
		frozen[name] = pkTuple.split(',').map((p) => p.trim().split(/\s+/)[0] ?? '');
	}
	return frozen;
};

describe('#N2-1: auth 5 表 PK 凍結 + 構造不変条件 (§6.6 / spike#3,#6)', () => {
	it('[A1] AUTH_PK_MANIFEST == §6.6 auth DDL 表 (doc-parse 突合)', async () => {
		const { AUTH_PK_MANIFEST } = await import('../../../src/lib/server/db/pk-freeze-manifest');
		const frozen = parseAuthPkTable();

		// parser 空振り防止: 5 表が必ず抽出される。
		expect(Object.keys(frozen).sort()).toEqual([
			'consents',
			'families',
			'invites',
			'memberships',
			'users',
		]);
		expect({ ...AUTH_PK_MANIFEST }).toEqual(frozen);
	});

	it('[A2] PK 例外ルール (§11.2): users/invites/consents は単独 PK、families/memberships は family_id 先頭', async () => {
		const { AUTH_PK_MANIFEST } = await import('../../../src/lib/server/db/pk-freeze-manifest');
		expect(AUTH_PK_MANIFEST.users).toEqual(['user_id']);
		expect(AUTH_PK_MANIFEST.invites).toEqual(['invite_id']);
		expect(AUTH_PK_MANIFEST.consents).toEqual(['consent_id']);
		expect(AUTH_PK_MANIFEST.families[0]).toBe('family_id');
		expect(AUTH_PK_MANIFEST.memberships[0]).toBe('family_id');
	});

	it('[A4] memberships.owner_guard = 生成列 + UNIQUE (owner ≤ 1 の DB 強制)', async () => {
		const { memberships } = await import('../../../src/lib/server/db/dsql/schema');
		const cfg = getTableConfig(memberships);
		const guard = cfg.columns.find((c) => c.name === 'owner_guard');
		expect(guard, 'owner_guard 列が存在する').toBeDefined();
		// STORED 生成列 (pg は STORED のみ)。role='owner' の行だけ family_id が入り UNIQUE が効く。
		expect(guard?.generated, 'owner_guard は generated 列').toBeDefined();
		expect(guard?.isUnique, 'owner_guard は UNIQUE (2 人目 owner を 23505 で拒否)').toBe(true);
	});

	it('[A5] users.email_lower = 生成列 + UNIQUE / families.stripe_customer_id = UNIQUE', async () => {
		const { users, families } = await import('../../../src/lib/server/db/dsql/schema');

		const emailLower = getTableConfig(users).columns.find((c) => c.name === 'email_lower');
		expect(emailLower?.generated, 'email_lower は lower(email) 生成列').toBeDefined();
		expect(emailLower?.isUnique, 'email_lower UNIQUE (case-insensitive 重複防止)').toBe(true);

		const stripeCustomer = getTableConfig(families).columns.find(
			(c) => c.name === 'stripe_customer_id',
		);
		expect(stripeCustomer?.isUnique, 'stripe_customer_id UNIQUE (複数 NULL 許容)').toBe(true);
	});
});
