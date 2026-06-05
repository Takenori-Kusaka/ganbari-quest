import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	computeFingerprint,
	normalizeLocation,
	URL_REQUIRED_TEAMS,
	VALID_SARIF_LEVELS,
	VALID_TEAMS,
	validateEvidence,
	validateFinding,
} from '../../../scripts/audit/evidence-schema.mjs';

/** valid な finding を生成し、上書き差分を適用するヘルパ */
function makeFinding(overrides: Record<string, unknown> = {}) {
	return {
		id: 'security-1',
		title: 'tenant filter 欠落',
		location: 'src/lib/server/auth/foo.ts:42',
		severity: 3,
		policy_candidate: false,
		detail: '再現手順 / 根拠 / 影響',
		evidence_urls: [],
		ruleId: 'authz/missing-tenant-check',
		level: 'error',
		locations: [{ physicalLocation: { artifactLocation: { uri: 'src/lib/server/auth/foo.ts' } } }],
		...overrides,
	};
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
	return {
		run_id: 'baseline-20260610',
		integration_pr: 0,
		team: 'security',
		findings: [makeFinding()],
		...overrides,
	};
}

describe('normalizeLocation', () => {
	it('行番号 (:42) を除去する', () => {
		expect(normalizeLocation('src/lib/foo.ts:42')).toBe('src/lib/foo.ts');
	});

	it('行:列 (:42:5) を除去する', () => {
		expect(normalizeLocation('src/lib/foo.ts:42:5')).toBe('src/lib/foo.ts');
	});

	it('Windows 区切りを / に統一し小文字化する', () => {
		expect(normalizeLocation('src\\Lib\\Foo.ts')).toBe('src/lib/foo.ts');
	});

	it('連続空白を 1 つに畳む', () => {
		expect(normalizeLocation('  child   home  ')).toBe('child home');
	});

	it('空文字 / 非文字列は空文字を返す', () => {
		expect(normalizeLocation('')).toBe('');
		expect(normalizeLocation(null)).toBe('');
	});
});

describe('computeFingerprint', () => {
	it('行番号違いの同一ファイル+同一 ruleId は同じ fingerprint になる', () => {
		const a = computeFingerprint(makeFinding({ location: 'src/lib/foo.ts:10' }));
		const b = computeFingerprint(makeFinding({ location: 'src/lib/foo.ts:99' }));
		expect(a).toBe(b);
	});

	it('ruleId が違えば fingerprint も違う', () => {
		const a = computeFingerprint(makeFinding({ ruleId: 'rule-a' }));
		const b = computeFingerprint(makeFinding({ ruleId: 'rule-b' }));
		expect(a).not.toBe(b);
	});

	it('partialFingerprints.primary を最優先で採用する', () => {
		const fp = computeFingerprint(
			makeFinding({ partialFingerprints: { primary: 'CANONICAL-FP' }, location: 'other.ts:1' }),
		);
		expect(fp).toBe('canonical-fp');
	});
});

describe('validateFinding', () => {
	it('valid な finding は違反なし', () => {
		expect(validateFinding(makeFinding(), 'security')).toEqual([]);
	});

	it('最小 field 欠落を検出する', () => {
		const errs = validateFinding(makeFinding({ id: '', title: '', detail: '' }), 'security');
		expect(errs.some((e: string) => e.includes('id'))).toBe(true);
		expect(errs.some((e: string) => e.includes('title'))).toBe(true);
		expect(errs.some((e: string) => e.includes('detail'))).toBe(true);
	});

	it('severity 範囲外 (0 / 5 / 非整数) を検出する', () => {
		expect(
			validateFinding(makeFinding({ severity: 0 }), 'security').some((e: string) =>
				e.includes('severity'),
			),
		).toBe(true);
		expect(
			validateFinding(makeFinding({ severity: 5 }), 'security').some((e: string) =>
				e.includes('severity'),
			),
		).toBe(true);
		expect(
			validateFinding(makeFinding({ severity: 2.5 }), 'security').some((e: string) =>
				e.includes('severity'),
			),
		).toBe(true);
	});

	it('policy_candidate が boolean でないと違反', () => {
		expect(
			validateFinding(makeFinding({ policy_candidate: 'yes' }), 'security').some((e: string) =>
				e.includes('policy_candidate'),
			),
		).toBe(true);
	});

	it('SARIF 互換 field (ruleId / level / locations) 欠落を検出する', () => {
		expect(
			validateFinding(makeFinding({ ruleId: '' }), 'security').some((e: string) =>
				e.includes('ruleId'),
			),
		).toBe(true);
		expect(
			validateFinding(makeFinding({ level: 'fatal' }), 'security').some((e: string) =>
				e.includes('level'),
			),
		).toBe(true);
		expect(
			validateFinding(makeFinding({ locations: [] }), 'security').some((e: string) =>
				e.includes('locations'),
			),
		).toBe(true);
	});

	it('VALID_SARIF_LEVELS の全値を許容する', () => {
		for (const level of VALID_SARIF_LEVELS) {
			expect(validateFinding(makeFinding({ level }), 'security')).toEqual([]);
		}
	});

	it('competitive / cuj は evidence_urls 必須 (欠落で違反)', () => {
		for (const team of URL_REQUIRED_TEAMS) {
			const errs = validateFinding(makeFinding({ evidence_urls: [] }), team);
			expect(errs.some((e: string) => e.includes('evidence_urls'))).toBe(true);
		}
	});

	it('competitive は URL があれば違反なし', () => {
		expect(
			validateFinding(makeFinding({ evidence_urls: ['https://example.com'] }), 'competitive'),
		).toEqual([]);
	});

	it('security は evidence_urls 空でも違反なし (URL 必須 team でない)', () => {
		expect(validateFinding(makeFinding({ evidence_urls: [] }), 'security')).toEqual([]);
	});

	it('partialFingerprints の型不正を検出する', () => {
		expect(
			validateFinding(makeFinding({ partialFingerprints: [] }), 'security').some((e: string) =>
				e.includes('partialFingerprints'),
			),
		).toBe(true);
		expect(
			validateFinding(makeFinding({ partialFingerprints: { primary: '' } }), 'security').some(
				(e: string) => e.includes('partialFingerprints'),
			),
		).toBe(true);
	});

	it('partialFingerprints 省略は許容する', () => {
		const f = makeFinding();
		delete (f as Record<string, unknown>).partialFingerprints;
		expect(validateFinding(f, 'security')).toEqual([]);
	});

	it('非オブジェクトを拒否する', () => {
		expect(validateFinding(null, 'security').length).toBeGreaterThan(0);
		expect(validateFinding([], 'security').length).toBeGreaterThan(0);
	});
});

describe('validateEvidence', () => {
	it('valid な evidence は ok=true', () => {
		const r = validateEvidence(makeEvidence());
		expect(r.ok).toBe(true);
		expect(r.findingCount).toBe(1);
	});

	it('baseline run の integration_pr=0 を許容する', () => {
		expect(validateEvidence(makeEvidence({ integration_pr: 0 })).ok).toBe(true);
	});

	it('integration_pr が負数だと違反', () => {
		expect(validateEvidence(makeEvidence({ integration_pr: -1 })).ok).toBe(false);
	});

	it('未知 team を拒否する', () => {
		const r = validateEvidence(makeEvidence({ team: 'unknown-team' }));
		expect(r.ok).toBe(false);
		expect(r.errors.some((e: string) => e.includes('team'))).toBe(true);
	});

	it('VALID_TEAMS 全値を許容する (competitive/cuj は URL 付きで)', () => {
		for (const team of VALID_TEAMS) {
			const findings = [makeFinding({ evidence_urls: ['https://example.com'] })];
			expect(validateEvidence(makeEvidence({ team, findings })).ok).toBe(true);
		}
	});

	it('findings が配列でないと違反', () => {
		expect(validateEvidence(makeEvidence({ findings: {} })).ok).toBe(false);
	});

	it('findings 内の違反に index と id を添える', () => {
		const r = validateEvidence(makeEvidence({ findings: [makeFinding({ id: '', severity: 9 })] }));
		expect(r.ok).toBe(false);
		expect(r.errors.some((e: string) => e.startsWith('findings[0]'))).toBe(true);
	});

	it('非オブジェクトを拒否する', () => {
		expect(validateEvidence(null).ok).toBe(false);
		expect(validateEvidence('x').ok).toBe(false);
	});

	it('CI 共有 fixture (sample-evidence.json) が schema に適合する (workflow との drift 防止)', () => {
		// audit-run.yml pipeline-selftest job が cp する固定 fixture。schema が変わっても
		// fixture が追従していなければここで fail させ、CI smoke の偽 PASS を防ぐ。
		// Vitest cwd = リポジトリ root。import.meta.url は runner 下で file:// にならず
		// fileURLToPath が throw するため process.cwd() 起点で解決する。
		const fixturePath = path.resolve(process.cwd(), 'scripts/audit/fixtures/sample-evidence.json');
		const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
		const r = validateEvidence(fixture);
		expect(r.ok).toBe(true);
		expect(r.findingCount).toBeGreaterThan(0);
	});
});
