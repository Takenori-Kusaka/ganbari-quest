// tests/unit/scripts/check-action-sha-pin.test.ts
// #3298: 高権限 GitHub Actions の SHA pin gate の回帰ガード (ADR-0061 shift-left)。
//
// floating tag pin (@v3 等) は mutable で、供給元の tag 再付け替えで secret 消費 / write 権限を持つ
// CI に任意コード混入し得る。本テストは check-action-sha-pin.mjs が「高権限 action の tag pin」を
// 検出し、SHA pin / 非対象 action / コメント付き SHA を正しく扱うことを機械検証する。

import { describe, expect, it } from 'vitest';
import {
	findHighPrivilegeContextViolations,
	findMissingTopLevelPermissionsViolations,
	findTagPinViolations,
	HIGH_PRIVILEGE_ACTIONS,
	isHighPrivilegeWorkflow,
	listWorkflowFiles,
	scanAllWorkflows,
	scanDefaultTokenPremise,
	verifyDefaultTokenReadOnly,
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

describe('#3483 findHighPrivilegeContextViolations (網羅性 gate / no-silent-gap class-lock)', () => {
	it('id-token: write を持つ workflow 内の未 pin third-party action を検出する', () => {
		const src = [
			'permissions:',
			'  id-token: write',
			'jobs:',
			'  deploy:',
			'    steps:',
			'      - uses: evilcorp/some-action@v1',
		].join('\n');
		const v = findHighPrivilegeContextViolations(src, 'wf.yml');
		expect(v).toHaveLength(1);
		expect(v[0]?.action).toBe('evilcorp/some-action');
	});

	it('contents: write でも高権限 context として検出する', () => {
		const src = 'permissions:\n  contents: write\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1';
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(1);
	});

	it('high-priv 文脈でも first-party (actions/*) の floating は許容する (GitHub 公式)', () => {
		const src =
			'permissions:\n  id-token: write\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v4';
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(0);
	});

	it('LOW_RISK_THIRD_PARTY_ALLOWLIST の setup/metadata action は floating 許容', () => {
		const src =
			'permissions:\n  id-token: write\njobs:\n  x:\n    steps:\n      - uses: docker/setup-buildx-action@v4';
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(0);
	});

	it('SHA pin 済 third-party は high-priv でも違反にしない', () => {
		const src = `permissions:\n  id-token: write\njobs:\n  x:\n    steps:\n      - uses: docker/build-push-action@${SHA}`;
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(0);
	});

	it('低権限 workflow (write 権限なし) は third-party floating でも対象外', () => {
		const src = 'permissions:\n  contents: read\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1';
		expect(isHighPrivilegeWorkflow(src)).toBe(false);
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(0);
	});

	// #3489 回帰: pull-requests: write クラスの取りこぼし是正。id-token / contents が無くても
	// pull-requests: write (auto-merge 等の context) 内の未 pin third-party を検出する (no-silent-gap)。
	it('pull-requests: write (id-token/contents 無) 内の未 pin third-party を検出する (#3489)', () => {
		const src = [
			'on: pull_request',
			'permissions:',
			'  pull-requests: write',
			'jobs:',
			'  x:',
			'    steps:',
			'      - uses: evilcorp/metadata@v3',
		].join('\n');
		expect(isHighPrivilegeWorkflow(src)).toBe(true);
		const v = findHighPrivilegeContextViolations(src, 'wf.yml');
		expect(v).toHaveLength(1);
		expect(v[0]?.action).toBe('evilcorp/metadata');
	});

	it('packages: write クラスも高権限 context として検出する (#3489)', () => {
		const src =
			'permissions:\n  packages: write\njobs:\n  x:\n    steps:\n      - uses: evil/publish@v2';
		expect(isHighPrivilegeWorkflow(src)).toBe(true);
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(1);
	});

	it('permissions: write-all も高権限 context として検出する (#3489)', () => {
		const src = 'permissions: write-all\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1';
		expect(isHighPrivilegeWorkflow(src)).toBe(true);
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(1);
	});

	it('permissions 明示なしの workflow は高権限 context 対象外 (default token は repo 設定に委譲、#3489 トレードオフ)', () => {
		const src = 'on: push\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1';
		expect(isHighPrivilegeWorkflow(src)).toBe(false);
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(0);
	});
});

// #3494: #3483→#3489 で 5 クラス固定だった HIGH_PRIVILEGE_PERMISSION_RE の残余 gap
// (issues/pages/security-events/checks/deployments/statuses/actions:write が trigger 外)。
// 個別列挙の追加は #3318→#3457→#3483→#3489 と同じ treadmill を再生産するため、
// 「任意の permission scope への write 付与」を generic に検出する class-lock を要求する。
describe('#3494 残り write クラスの generic class-lock', () => {
	const remainingWriteScopes = [
		'issues',
		'pages',
		'security-events',
		'checks',
		'deployments',
		'statuses',
		'actions',
	];
	for (const scope of remainingWriteScopes) {
		it(`${scope}: write を高権限 context として検出する (#3494)`, () => {
			const src = `permissions:\n  ${scope}: write\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1`;
			expect(isHighPrivilegeWorkflow(src)).toBe(true);
			const v = findHighPrivilegeContextViolations(src, 'wf.yml');
			expect(v).toHaveLength(1);
			expect(v[0]?.action).toBe('evil/a');
		});
	}

	it('列挙外の write scope (attestations: write) も generic に検出する (列挙 treadmill 根絶)', () => {
		const src =
			'permissions:\n  attestations: write\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1';
		expect(isHighPrivilegeWorkflow(src)).toBe(true);
		expect(findHighPrivilegeContextViolations(src, 'wf.yml')).toHaveLength(1);
	});

	it('read 権限のみ (issues: read / read-all 含む) は高権限 context にしない', () => {
		const src =
			'permissions:\n  contents: read\n  issues: read\n  actions: read\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1';
		expect(isHighPrivilegeWorkflow(src)).toBe(false);
		const readAll = 'permissions: read-all\njobs:\n  x:\n    steps:\n      - uses: evil/a@v1';
		expect(isHighPrivilegeWorkflow(readAll)).toBe(false);
	});
});

// #3494 AC2: 網羅性 gate の permissionless 除外は「repo デフォルト GITHUB_TOKEN = read-only」
// 前提に依存する (#3489 トレードオフ)。この前提が repo 設定 drift で崩れても検知できない gap を、
// ① 静的 gate (全 workflow に top-level permissions 必須 = default token 依存を構造的に排除) +
// ② repo 設定の実測 assert (verifyDefaultTokenReadOnly、gh api 経由 opt-in) の 2 層で機械担保する。
describe('#3494 default GITHUB_TOKEN 前提の機械担保', () => {
	it('top-level permissions を持たない workflow を violation にする (default token 依存)', () => {
		const src = 'on: push\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7';
		const v = findMissingTopLevelPermissionsViolations(src, 'wf.yml');
		expect(v).toHaveLength(1);
		expect(v[0]?.file).toBe('wf.yml');
	});

	it('top-level permissions がある workflow は violation にしない', () => {
		const src =
			'on: push\npermissions:\n  contents: read\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7';
		expect(findMissingTopLevelPermissionsViolations(src, 'wf.yml')).toHaveLength(0);
	});

	it('job-level permissions のみでは不足 (将来追加 job が default token に落ちる)', () => {
		const src = [
			'on: push',
			'jobs:',
			'  x:',
			'    permissions:',
			'      contents: read',
			'    steps:',
			'      - uses: actions/checkout@v7',
		].join('\n');
		expect(findMissingTopLevelPermissionsViolations(src, 'wf.yml')).toHaveLength(1);
	});

	it('verifyDefaultTokenReadOnly: default_workflow_permissions=read なら ok', () => {
		const exec = () => JSON.stringify({ default_workflow_permissions: 'read' });
		expect(verifyDefaultTokenReadOnly(exec).ok).toBe(true);
	});

	it('verifyDefaultTokenReadOnly: write なら fail (前提崩れ = 設定 drift 検知)', () => {
		const exec = () => JSON.stringify({ default_workflow_permissions: 'write' });
		const r = verifyDefaultTokenReadOnly(exec);
		expect(r.ok).toBe(false);
		expect(r.detail).toContain('write');
	});

	it('verifyDefaultTokenReadOnly: API 照会不能も fail (silent skip 禁止、ADR-0024)', () => {
		const exec = () => {
			throw new Error('gh: Not Found (HTTP 404)');
		};
		expect(verifyDefaultTokenReadOnly(exec).ok).toBe(false);
	});
});

describe('#3298/#3483 scanAllWorkflows (実 workflow)', () => {
	it('現行 .github/workflows/ は高権限 action 違反 0 (named list + 網羅性 gate 両方)', () => {
		expect(scanAllWorkflows()).toEqual([]);
	});

	it('現行 .github/workflows/ は全 workflow が top-level permissions を宣言済 (#3494 AC2)', () => {
		expect(scanDefaultTokenPremise(listWorkflowFiles())).toEqual([]);
	});
});
