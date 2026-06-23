// tests/unit/routes/export-authz-symmetry-3246.test.ts
//
// #3246: export endpoint の role 認可境界を import と対称化する。
// 新設の special-rewards / checklists / activities export が child role で到達でき、
// ?childId 指定で兄弟データを列挙できた (家庭内 IDOR)。import 側は owner/parent gate 済で非対称。
//
// 本テストは 2 段で守る:
//   (A) 契約テスト: 全 /api/v1/**/export/**/+server.ts が requireRole(['owner','parent']) を呼ぶ
//       (新規 export 追加時の gate 漏れを機械検出 = fitness function)
//   (B) 振る舞いテスト: child role で 3 endpoint を叩くと 403、parent role は gate を通過する

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { glob } from 'glob';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');

// 認可境界を持たない正当な例外 (別 gate で守られる / 別レイヤ):
//   - admin/account/export: 既に requireRole 済
//   - export/cloud: 既に requireRole 済
// → これらも requireRole を持つので除外不要だが、将来 gate 方式が異なる endpoint を
//   ここに列挙して握り潰さないよう、原則「全 export が requireRole を呼ぶ」を要求する。
describe('#3246 (A) export 認可境界 契約テスト', () => {
	it('全 /api/v1/**/export/**/+server.ts が requireRole(owner/parent) を呼ぶ', async () => {
		const files = await glob('src/routes/api/v1/**/export/**/+server.ts', { cwd: ROOT });
		expect(files.length).toBeGreaterThan(0);

		const offenders: string[] = [];
		for (const rel of files) {
			const src = readFileSync(resolve(ROOT, rel), 'utf8');
			// requireRole(locals, [...]) を呼び、許可ロールに 'child' を含まないこと。
			// (account/export の ['owner'] のような owner 限定の更に厳格な gate も許容する)
			const m = src.match(/requireRole\s*\(\s*locals\s*,\s*\[([^\]]*)\]/);
			const allowsChild = !!m && /['"]child['"]/.test(m[1] ?? '');
			if (!m || allowsChild) offenders.push(rel);
		}
		expect(
			offenders,
			`requireRole(owner/parent) 欠落の export endpoint: ${offenders.join(', ')}`,
		).toEqual([]);
	});
});

function childLocals() {
	return {
		context: { tenantId: 't-1', role: 'child', childId: 1 },
	} as unknown as App.Locals;
}
function parentLocals() {
	return {
		context: { tenantId: 't-1', role: 'parent' },
	} as unknown as App.Locals;
}

async function callGet(
	modPath: string,
	locals: App.Locals,
	urlStr: string,
): Promise<{ status?: number; thrown?: unknown }> {
	const mod = await import(modPath);
	try {
		const res = await mod.GET({ locals, url: new URL(urlStr) } as never);
		return { status: res?.status };
	} catch (e) {
		return { thrown: e, status: (e as { status?: number })?.status };
	}
}

describe('#3246 (B) child role は export に到達できない (403)', () => {
	it('special-rewards/export: child=403 / parent はgate通過 (childId 無で 400)', async () => {
		const p = '../../../src/routes/api/v1/special-rewards/export/+server';
		const child = await callGet(
			p,
			childLocals(),
			'http://x/api/v1/special-rewards/export?childId=2',
		);
		expect(child.status).toBe(403);
		const parent = await callGet(p, parentLocals(), 'http://x/api/v1/special-rewards/export');
		expect(parent.status).not.toBe(403); // gate 通過 (childId 無で 400 になる)
	});

	it('checklists/export: child=403', async () => {
		const child = await callGet(
			'../../../src/routes/api/v1/checklists/export/+server',
			childLocals(),
			'http://x/api/v1/checklists/export?templateId=5',
		);
		expect(child.status).toBe(403);
	});

	it('activities/export: child=403', async () => {
		const child = await callGet(
			'../../../src/routes/api/v1/activities/export/+server',
			childLocals(),
			'http://x/api/v1/activities/export',
		);
		expect(child.status).toBe(403);
	});
});
