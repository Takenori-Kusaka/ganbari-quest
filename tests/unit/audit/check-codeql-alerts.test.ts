import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BASELINE_PATH,
	evaluateCodeqlAlerts,
	formatCodeqlMarkdown,
	groupAlerts,
	normalizeAlerts,
	validateBaseline,
} from '../../../scripts/audit/check-codeql-alerts.mjs';

/** 2026-08-01 実測の open alert 7 件 (Issue #4155 本文の表と一致)。 */
const OBSERVED_2026_08_01 = [
	{
		number: 43,
		state: 'open',
		rule: { id: 'js/regex-injection', security_severity_level: 'high' },
		most_recent_instance: { location: { path: 'scripts/check-recent-deploy-deletion.mjs' } },
	},
	{
		number: 42,
		state: 'open',
		rule: { id: 'js/incomplete-sanitization', security_severity_level: 'high' },
		most_recent_instance: { location: { path: 'scripts/audit/close-leak-report.mjs' } },
	},
	{
		number: 44,
		state: 'open',
		rule: { id: 'js/bad-code-sanitization', security_severity_level: 'medium' },
		most_recent_instance: {
			location: { path: 'tests/unit/scripts/pre-ready-order-and-base.test.ts' },
		},
	},
	{
		number: 41,
		state: 'open',
		rule: { id: 'js/overly-large-range', security_severity_level: 'medium' },
		most_recent_instance: { location: { path: 'scripts/lib/ci/screenshot-helpers.mjs' } },
	},
	...[6, 7, 8].map((n) => ({
		number: n,
		state: 'open',
		rule: { id: 'actions/missing-workflow-permissions', security_severity_level: 'medium' },
		most_recent_instance: { location: { path: '.github/workflows/ci.yml' } },
	})),
];

/**
 * 2026-08-13 実測で追加受容した open alert 1 件 (第21回統合監査 PR #4565)。
 *
 * `OBSERVED_2026_08_01` は #4155 起票時点の実測 snapshot なので**書き換えない**。
 * ledger が正当に増えたぶんは本 fixture を足して「現時点の受容集合」を組み立てる
 * (ledger を増やしたら本 test も必ず触ることになる = 無自覚な baseline 肥大の tripwire を残す)。
 */
const OBSERVED_2026_08_13 = [
	{
		number: 47,
		state: 'open',
		rule: {
			id: 'js/incomplete-multi-character-sanitization',
			security_severity_level: 'high',
		},
		most_recent_instance: {
			location: { path: 'tests/unit/architecture/ai-suggest-gate-derivation.test.ts' },
		},
	},
];

/** 現時点で ledger が受容している alert 集合 (= 起票時点 7 件 + 以後の追加受容)。 */
const OBSERVED_CURRENT = [...OBSERVED_2026_08_01, ...OBSERVED_2026_08_13];

const realBaseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

describe('validateBaseline (ledger 自体の健全性)', () => {
	it('リポジトリの codeql-baseline.json は妥当', () => {
		const r = validateBaseline(realBaseline);
		expect(r.errors).toEqual([]);
		expect(r.valid).toBe(true);
	});

	it('全 entry に resolutionTrigger がある (期限なし pin を作らない、AC4)', () => {
		for (const e of realBaseline.entries) {
			expect(typeof e.resolutionTrigger).toBe('string');
			expect(e.resolutionTrigger.trim().length).toBeGreaterThan(3);
		}
	});

	it('resolutionTrigger 欠落は ledger 不正として検出する', () => {
		const r = validateBaseline({
			entries: [{ rule: 'js/foo', path: 'scripts/a.mjs', count: 1 }],
		});
		expect(r.valid).toBe(false);
		expect(r.errors.join('\n')).toMatch(/resolutionTrigger/);
	});

	it('src/ 配下 (顧客経路) を baseline に載せることを禁止する', () => {
		const r = validateBaseline({
			entries: [
				{
					rule: 'js/incomplete-url-substring-sanitization',
					path: 'src/lib/server/stripe/checkout.ts',
					count: 1,
					resolutionTrigger: '触るとき',
				},
			],
		});
		expect(r.valid).toBe(false);
		expect(r.errors.join('\n')).toMatch(/production コード/);
	});

	it('(rule, path) の重複登録を検出する', () => {
		const entry = {
			rule: 'js/foo',
			path: 'scripts/a.mjs',
			count: 1,
			resolutionTrigger: '触るとき',
		};
		const r = validateBaseline({ entries: [entry, { ...entry }] });
		expect(r.valid).toBe(false);
		expect(r.errors.join('\n')).toMatch(/重複/);
	});

	it('entries が配列でない ledger は不正', () => {
		expect(validateBaseline({}).valid).toBe(false);
		expect(validateBaseline(null).valid).toBe(false);
	});
});

describe('normalizeAlerts / groupAlerts', () => {
	it('rule.id + location.path を取り出し (rule, path) 単位で数える', () => {
		const groups = groupAlerts(normalizeAlerts(OBSERVED_2026_08_01));
		expect(groups.size).toBe(5);
		expect(groups.get('actions/missing-workflow-permissions .github/workflows/ci.yml')?.count).toBe(
			3,
		);
		expect(groups.get('js/regex-injection scripts/check-recent-deploy-deletion.mjs')?.count).toBe(
			1,
		);
	});

	it('欠損フィールドは unknown に倒して落とさない', () => {
		const normalized = normalizeAlerts([{}]);
		expect(normalized).toHaveLength(1);
		expect(normalized[0]?.rule).toBe('unknown-rule');
		expect(normalized[0]?.path).toBe('unknown-path');
	});
});

describe('evaluateCodeqlAlerts (AC5 — baseline 一致で PASS / 1 件追加で FAIL)', () => {
	it('現時点の受容集合 8 件は baseline に載っており PASS する', () => {
		const r = evaluateCodeqlAlerts({
			alerts: OBSERVED_CURRENT,
			baseline: realBaseline,
			analysisCount: 1,
			ref: 'refs/pull/4155/merge',
		});
		expect(r.newAlerts).toEqual([]);
		expect(r.observedCount).toBe(8);
		expect(r.acceptedCount).toBe(8);
		expect(r.staleEntries).toEqual([]);
		expect(r.pass).toBe(true);
	});

	it('未登録 rule の alert を 1 件足すと FAIL する', () => {
		const r = evaluateCodeqlAlerts({
			alerts: [
				...OBSERVED_CURRENT,
				{
					number: 99,
					state: 'open',
					rule: {
						id: 'js/incomplete-url-substring-sanitization',
						security_severity_level: 'high',
					},
					most_recent_instance: { location: { path: 'tests/e2e/checkout.spec.ts' } },
				},
			],
			baseline: realBaseline,
			analysisCount: 1,
			ref: 'refs/pull/4155/merge',
		});
		expect(r.pass).toBe(false);
		expect(r.newAlerts).toHaveLength(1);
		expect(r.newAlerts[0]).toMatchObject({
			rule: 'js/incomplete-url-substring-sanitization',
			path: 'tests/e2e/checkout.spec.ts',
			excess: 1,
		});
		expect(formatCodeqlMarkdown(r)).toMatch(/❌ FAIL/);
	});

	it('baseline 済み (rule, path) でも count 超過 (4 件目) は FAIL する', () => {
		const r = evaluateCodeqlAlerts({
			alerts: [
				...OBSERVED_2026_08_01,
				{
					number: 100,
					state: 'open',
					rule: { id: 'actions/missing-workflow-permissions', security_severity_level: 'medium' },
					most_recent_instance: { location: { path: '.github/workflows/ci.yml' } },
				},
			],
			baseline: realBaseline,
			analysisCount: 1,
		});
		expect(r.pass).toBe(false);
		expect(r.newAlerts[0]).toMatchObject({
			rule: 'actions/missing-workflow-permissions',
			excess: 1,
		});
		// 受容分 3 件は accepted に数え、超過 1 件だけを new として扱う
		expect(r.acceptedCount).toBe(7);
	});

	it('closed / fixed な alert は数えない', () => {
		const r = evaluateCodeqlAlerts({
			alerts: [
				...OBSERVED_2026_08_01,
				{
					number: 101,
					state: 'fixed',
					rule: { id: 'js/new-rule', security_severity_level: 'high' },
					most_recent_instance: { location: { path: 'scripts/x.mjs' } },
				},
			],
			baseline: realBaseline,
			analysisCount: 1,
		});
		expect(r.pass).toBe(true);
	});

	it('解消済み baseline entry は stale として報告する (fail はさせない)', () => {
		const r = evaluateCodeqlAlerts({
			alerts: OBSERVED_CURRENT.filter((a) => a.number !== 41),
			baseline: realBaseline,
			analysisCount: 1,
		});
		expect(r.pass).toBe(true);
		expect(r.staleEntries).toEqual([
			{
				rule: 'js/overly-large-range',
				path: 'scripts/lib/ci/screenshot-helpers.mjs',
				count: 1,
			},
		]);
		expect(formatCodeqlMarkdown(r)).toMatch(/解消済み baseline entry/);
	});
});

describe('evaluateCodeqlAlerts (検査できなかった状態を PASS にしない)', () => {
	it('analysis 0 件 (未スキャン) は alert 0 件でも FAIL する', () => {
		const r = evaluateCodeqlAlerts({
			alerts: [],
			baseline: realBaseline,
			analysisCount: 0,
			ref: 'refs/pull/4155/merge',
		});
		expect(r.pass).toBe(false);
		expect(r.reasons.join('\n')).toMatch(/analysis が 0 件/);
	});

	it('fetch 失敗は FAIL する', () => {
		const r = evaluateCodeqlAlerts({
			alerts: [],
			baseline: realBaseline,
			analysisCount: null,
			fetchError: 'HTTP 403',
		});
		expect(r.pass).toBe(false);
		expect(r.reasons.join('\n')).toMatch(/取得に失敗/);
	});

	it('ledger 不正 (src/ 混入) は alert が baseline 内でも FAIL する', () => {
		const r = evaluateCodeqlAlerts({
			alerts: [],
			baseline: {
				entries: [
					{
						rule: 'js/foo',
						path: 'src/lib/server/x.ts',
						count: 1,
						resolutionTrigger: '触るとき',
					},
				],
			},
			analysisCount: 1,
		});
		expect(r.pass).toBe(false);
		expect(r.baselineErrors.length).toBeGreaterThan(0);
	});
});

describe('formatCodeqlMarkdown', () => {
	it('PASS 時は required 非該当の代替条件であることを明示する', () => {
		const md = formatCodeqlMarkdown(
			evaluateCodeqlAlerts({
				alerts: OBSERVED_2026_08_01,
				baseline: realBaseline,
				analysisCount: 1,
				ref: 'refs/pull/4155/merge',
			}),
		);
		expect(md).toMatch(/✅ PASS/);
		expect(md).toMatch(/required_status_checks 非該当/);
		expect(md).toMatch(/refs\/pull\/4155\/merge/);
	});
});
