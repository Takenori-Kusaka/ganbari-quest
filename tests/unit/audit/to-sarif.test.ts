import { describe, expect, it } from 'vitest';
import {
	buildSarifLocations,
	buildSarifRules,
	findingToResult,
	flattenFindings,
	resolveSarifLevel,
	SARIF_SCHEMA_URI,
	SARIF_VERSION,
	toSarif,
} from '../../../scripts/audit/to-sarif.mjs';

function f(overrides: Record<string, unknown> = {}) {
	return {
		id: 'security-1',
		title: 'tenant check 欠落',
		location: 'src/lib/server/auth/foo.ts:42',
		severity: 3,
		policy_candidate: false,
		detail: 'authz boundary が欠けている',
		ruleId: 'authz/missing-tenant-check',
		level: 'error',
		partialFingerprints: { primary: 'authz/missing-tenant-check::src/lib/server/auth/foo.ts' },
		locations: [{ physicalLocation: { artifactLocation: { uri: 'src/lib/server/auth/foo.ts' } } }],
		...overrides,
	};
}

describe('resolveSarifLevel', () => {
	it('finding.level が SARIF 許容値ならそれを採用する', () => {
		expect(resolveSarifLevel(f({ level: 'warning' }))).toBe('warning');
	});

	it('level 欠落時は severity から写像する (1=note / 2=warning / 3-4=error)', () => {
		expect(resolveSarifLevel({ severity: 1 })).toBe('note');
		expect(resolveSarifLevel({ severity: 2 })).toBe('warning');
		expect(resolveSarifLevel({ severity: 3 })).toBe('error');
		expect(resolveSarifLevel({ severity: 4 })).toBe('error');
	});

	it('level も severity も不正なら none (最も安全側)', () => {
		expect(resolveSarifLevel({})).toBe('none');
		expect(resolveSarifLevel({ level: 'bogus', severity: 0 })).toBe('none');
	});
});

describe('buildSarifLocations', () => {
	it('SARIF 互換 locations を持つ finding はそのまま採用する', () => {
		const locs = buildSarifLocations(f());
		expect(locs[0].physicalLocation.artifactLocation.uri).toBe('src/lib/server/auth/foo.ts');
	});

	it('locations 欠落時は location 文字列を physicalLocation に組み立てる (行/列分離)', () => {
		const locs = buildSarifLocations({ location: 'src/foo.ts:42:5', locations: [] });
		expect(locs[0].physicalLocation.artifactLocation.uri).toBe('src/foo.ts');
		expect(locs[0].physicalLocation.region).toEqual({ startLine: 42, startColumn: 5 });
	});

	it('行番号なし location は uri のみ (region なし)', () => {
		const locs = buildSarifLocations({ location: 'admin/activities 画面', locations: [] });
		expect(locs[0].physicalLocation.artifactLocation.uri).toBe('admin/activities 画面');
		expect(locs[0].physicalLocation.region).toBeUndefined();
	});

	it('location も locations も無いときは uri=unknown を返す (出所を必ず残す)', () => {
		const locs = buildSarifLocations({});
		expect(locs[0].physicalLocation.artifactLocation.uri).toBe('unknown');
	});

	it('Windows パス区切りを / に正規化する', () => {
		const locs = buildSarifLocations({ location: 'src\\lib\\foo.ts:10', locations: [] });
		expect(locs[0].physicalLocation.artifactLocation.uri).toBe('src/lib/foo.ts');
	});
});

describe('findingToResult', () => {
	it('既知 finding を SARIF result に写像する', () => {
		const r = findingToResult(f());
		expect(r.ruleId).toBe('authz/missing-tenant-check');
		expect(r.level).toBe('error');
		expect(r.message.text).toBe('tenant check 欠落');
		expect(r.partialFingerprints.primary).toBe(
			'authz/missing-tenant-check::src/lib/server/auth/foo.ts',
		);
		expect(r.locations).toHaveLength(1);
	});

	it('ruleId 欠落時は unknown-rule にフォールバックする', () => {
		const r = findingToResult({ title: 't', location: 'a.ts:1' });
		expect(r.ruleId).toBe('unknown-rule');
	});

	it('partialFingerprints 欠落時は computeFingerprint で補完する', () => {
		const r = findingToResult({
			ruleId: 'rule-x',
			title: 't',
			location: 'src/a.ts:99',
		});
		// computeFingerprint = ruleId::正規化 location (行番号除去 + 小文字化)
		expect(r.partialFingerprints.primary).toBe('rule-x::src/a.ts');
	});

	it('title 欠落時は detail を message にする', () => {
		const r = findingToResult({ ruleId: 'r', detail: '詳細のみ', location: 'a.ts:1' });
		expect(r.message.text).toBe('詳細のみ');
	});
});

describe('buildSarifRules', () => {
	it('ruleId を重複排除して rules を構築する', () => {
		const rules = buildSarifRules([
			f({ ruleId: 'rule-a', title: 'A' }),
			f({ ruleId: 'rule-a', title: 'A-dup' }),
			f({ ruleId: 'rule-b', title: 'B' }),
		]);
		expect(rules.map((r) => r.id)).toEqual(['rule-a', 'rule-b']);
		// 最初に出現した title を採用
		expect(rules[0].shortDescription.text).toBe('A');
	});

	it('空入力は空 rules', () => {
		expect(buildSarifRules([])).toEqual([]);
	});
});

describe('toSarif', () => {
	it('既知 findings を valid SARIF 2.1.0 document に変換する', () => {
		const sarif = toSarif([f()], { toolName: 'ganbari-quest-audit', toolVersion: 'abc123' });
		expect(sarif.$schema).toBe(SARIF_SCHEMA_URI);
		expect(sarif.version).toBe(SARIF_VERSION);
		expect(sarif.runs).toHaveLength(1);
		expect(sarif.runs[0].tool.driver.name).toBe('ganbari-quest-audit');
		expect(sarif.runs[0].tool.driver.version).toBe('abc123');
		expect(sarif.runs[0].tool.driver.rules).toHaveLength(1);
		expect(sarif.runs[0].results).toHaveLength(1);
		expect(sarif.runs[0].results[0].ruleId).toBe('authz/missing-tenant-check');
	});

	it('rules は finding 群から ruleId 重複排除して構築される', () => {
		const sarif = toSarif([
			f({ id: 'a', ruleId: 'rule-a' }),
			f({ id: 'b', ruleId: 'rule-a' }),
			f({ id: 'c', ruleId: 'rule-b' }),
		]);
		expect(sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toEqual([
			'rule-a',
			'rule-b',
		]);
		expect(sarif.runs[0].results).toHaveLength(3);
	});

	it('空入力で valid な空 SARIF を返す', () => {
		const sarif = toSarif([]);
		expect(sarif.version).toBe(SARIF_VERSION);
		expect(sarif.runs[0].results).toEqual([]);
		expect(sarif.runs[0].tool.driver.rules).toEqual([]);
		// 必須 driver.name は存在
		expect(sarif.runs[0].tool.driver.name).toBe('ganbari-quest-audit');
	});

	it('非配列入力 (null) でも例外なく空 SARIF を返す', () => {
		// @ts-expect-error 不正入力の防御確認
		const sarif = toSarif(null);
		expect(sarif.runs[0].results).toEqual([]);
	});

	it('toolVersion / informationUri 省略時は driver から省かれる', () => {
		const sarif = toSarif([f()]);
		expect(sarif.runs[0].tool.driver.version).toBeUndefined();
		expect(sarif.runs[0].tool.driver.informationUri).toBeUndefined();
	});

	it('level 欠落 finding は severity から level を写像して result に出す', () => {
		const sarif = toSarif([{ ruleId: 'r', title: 't', location: 'a.ts:1', severity: 4 }]);
		expect(sarif.runs[0].results[0].level).toBe('error');
	});
});

describe('flattenFindings', () => {
	it('複数 evidence の findings を flatten する', () => {
		const out = flattenFindings([
			{ team: 'security', findings: [f({ id: 'a' })] },
			{ team: 'tech', findings: [f({ id: 'b' }), f({ id: 'c' })] },
		]);
		expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
	});

	it('findings を持たない evidence は無視する', () => {
		const out = flattenFindings([{ team: 'x' }, { team: 'y', findings: [f({ id: 'z' })] }]);
		expect(out.map((x) => x.id)).toEqual(['z']);
	});

	it('空 / undefined 入力は空配列', () => {
		expect(flattenFindings([])).toEqual([]);
		// @ts-expect-error 防御確認
		expect(flattenFindings(undefined)).toEqual([]);
	});
});
