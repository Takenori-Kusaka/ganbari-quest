// tests/unit/scripts/check-action-sha-pin.test.ts
// #3298: 高権限 GitHub Actions の SHA pin gate の回帰ガード (ADR-0061 shift-left)。
//
// floating tag pin (@v3 等) は mutable で、供給元の tag 再付け替えで secret 消費 / write 権限を持つ
// CI に任意コード混入し得る。本テストは check-action-sha-pin.mjs が「高権限 action の tag pin」を
// 検出し、SHA pin / 非対象 action / コメント付き SHA を正しく扱うことを機械検証する。

import { describe, expect, it } from 'vitest';
import {
	findTagPinViolations,
	HIGH_PRIVILEGE_ACTIONS,
	scanAllWorkflows,
} from '../../../scripts/check-action-sha-pin.mjs';

const SHA = 'bcd2ba49218906704ab6c1aa796996da409d3eb1';

describe('#3298 findTagPinViolations', () => {
	it('高権限 action の tag pin を検出する', () => {
		const src = '      - uses: actions/create-github-app-token@v3\n';
		const v = findTagPinViolations(src, 'wf.yml');
		expect(v).toHaveLength(1);
		expect(v[0]?.action).toBe('actions/create-github-app-token');
		expect(v[0]?.ref).toBe('v3');
	});

	it('SHA pin (コメント付き) は違反にしない', () => {
		const src = `      - uses: actions/cache@2c8a9bd7457de244a408f35966fab2fb45fda9c8 # v6.0.0\n`;
		expect(findTagPinViolations(src, 'wf.yml')).toHaveLength(0);
	});

	it('SHA pin (コメントなし) も違反にしない', () => {
		const src = `      - uses: actions/attest@${SHA}\n`;
		expect(findTagPinViolations(src, 'wf.yml')).toHaveLength(0);
	});

	it('非対象 action の tag pin は無視する (repo 全体 pin は scope 外、PO 判断待ち)', () => {
		const src = '      - uses: actions/checkout@v7\n      - uses: actions/setup-node@v6\n';
		expect(findTagPinViolations(src, 'wf.yml')).toHaveLength(0);
	});

	it('サブパス付き高権限 action も owner/repo 前方一致で検出する', () => {
		const src = '      - uses: actions/cache/restore@v6\n';
		const v = findTagPinViolations(src, 'wf.yml');
		expect(v).toHaveLength(1);
		expect(v[0]?.action).toBe('actions/cache/restore');
	});

	it('version range / branch ref も SHA でなければ違反', () => {
		for (const ref of ['v3.2.0', 'main', 'latest']) {
			const src = `      - uses: actions/attest@${ref}\n`;
			expect(findTagPinViolations(src, 'wf.yml'), `ref=${ref}`).toHaveLength(1);
		}
	});

	it('SSOT: 3 つの高権限 action (token 発行 / attest / cache) を含む', () => {
		const names = HIGH_PRIVILEGE_ACTIONS.map((a) => a.name);
		expect(names).toContain('actions/create-github-app-token');
		expect(names).toContain('actions/attest');
		expect(names).toContain('actions/cache');
	});
});

describe('#3298 scanAllWorkflows (実 workflow)', () => {
	it('現行 .github/workflows/ は高権限 action 違反 0 (SHA pin 維持)', () => {
		expect(scanAllWorkflows()).toEqual([]);
	});
});
