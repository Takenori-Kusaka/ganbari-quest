// Issue #2945 (Phase A/A-3、親 #2942) AC3/AC4: lane-aware AC 検証マップ judge の unit test。
// feature/hotfix lane = 現行 AC マップ観点 (回帰ゼロ)、integration lane = マージ判定エビデンス表観点。
import { describe, expect, it } from 'vitest';
import {
	checkAcVerification,
	checkIntegrationEvidenceTable,
	checkPerPrAcMap,
	shouldSkip,
} from '../../../scripts/check-ac-verification-map.mjs';

// --- fixtures ---

const FEATURE_AC_MAP_PASS = `
## 概要
closes #1234

## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン後にダッシュボードが表示される | \`npx playwright test auth.spec.ts\` | PASS |
| AC2 | 未認証は 302 redirect | \`npx vitest run hooks.test.ts\` | PASS (SS #3) |
`;

const FEATURE_AC_MAP_EMPTY_CELL = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン後 | \`vitest\` |  |
`;

const FEATURE_AC_MAP_TODO = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン | \`vitest\` | 別途追加予定 |
`;

const FEATURE_AC_MAP_MISSING_SECTION = `
## 概要
AC マップ section が無い PR
`;

const INTEGRATION_EVIDENCE_PASS = `
## 概要
develop → main 統合 PR

## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities | unit×3 / e2e×1 | pass |
| 修正 B（#3002） | child-home | unit×2 | pass |

残 NG 合計 0 件。adversarial evidence の反対理由は解消済。
`;

const INTEGRATION_EVIDENCE_MISSING_SECTION = `
## 概要
統合 PR だがエビデンス表 section が無い
`;

const INTEGRATION_EVIDENCE_EMPTY_ROW = `
## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities |  | pass |

残 NG 0 件。
`;

const INTEGRATION_EVIDENCE_NO_NG_ZERO = `
## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities | unit×3 | pass |
`;

const INTEGRATION_EVIDENCE_NO_ROWS = `
## マージ判定エビデンス表

（表をまだ埋めていない）
残 NG 0 件。
`;

// --- feature / hotfix lane (AC4 回帰ゼロ) ---

describe('checkPerPrAcMap (feature/hotfix lane、AC4)', () => {
	it('PASS: 4 列全行が埋まっている', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_PASS, 'feature');
		expect(r.ok).toBe(true);
		expect(r.lane).toBe('feature');
	});

	it('FAIL: AC マップ section が無い', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_MISSING_SECTION, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('AC 検証マップ');
	});

	it('FAIL: 空欄セルがある', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_EMPTY_CELL, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('空欄');
	});

	it('FAIL: 4 列目に未完了表記 (#1539)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_TODO, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未完了表記');
	});

	it('hotfix lane も同観点 (PASS)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_PASS, 'hotfix');
		expect(r.ok).toBe(true);
		expect(r.lane).toBe('hotfix');
	});
});

// --- integration lane (AC3) ---

describe('checkIntegrationEvidenceTable (integration lane、AC3)', () => {
	it('PASS: エビデンス表 4 列 + 残 NG 0 件 明示', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_PASS);
		expect(r.ok).toBe(true);
		expect(r.lane).toBe('integration');
	});

	it('FAIL: エビデンス表 section が欠落', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_MISSING_SECTION);
		expect(r.ok).toBe(false);
		expect(r.error).toContain('マージ判定エビデンス表');
	});

	it('FAIL: 4 列のデータ行が 0 件 (偽装空欄を素通りさせない)', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_NO_ROWS);
		expect(r.ok).toBe(false);
		expect(r.error).toContain('1 件もありません');
	});

	it('FAIL: 空欄セルがある', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_EMPTY_ROW);
		expect(r.ok).toBe(false);
		expect(r.error).toContain('空欄');
	});

	it('FAIL: 残 NG 0 件 明示が無い', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_NO_NG_ZERO);
		expect(r.ok).toBe(false);
		expect(r.error).toContain('残 NG 0 件');
	});
});

// --- shouldSkip ---

describe('shouldSkip (全 lane 共通の skip 条件)', () => {
	it('type:docs ラベルで skip', () => {
		expect(shouldSkip({ body: '', labels: ['type:docs'] }).skip).toBe(true);
	});
	it('dependencies ラベルで skip', () => {
		expect(shouldSkip({ body: '', labels: ['dependencies'] }).skip).toBe(true);
	});
	it('明示 skip コメントで skip', () => {
		expect(shouldSkip({ body: '<!-- ac-verification-skip: infra PR -->', labels: [] }).skip).toBe(
			true,
		);
	});
	it('通常 PR は skip しない', () => {
		expect(shouldSkip({ body: '通常', labels: ['type:infra'] }).skip).toBe(false);
	});
});

// --- checkAcVerification (lane エントリ、観点切替を一気通貫で検証) ---

describe('checkAcVerification (lane エントリ、AC3/AC4)', () => {
	it('feature lane: AC マップ観点 (PASS)', () => {
		const r = checkAcVerification({
			body: FEATURE_AC_MAP_PASS,
			labels: ['type:feat'],
			lane: 'feature',
		});
		expect(r.ok).toBe(true);
	});

	it('feature lane: AC マップ観点 (FAIL = 空欄)', () => {
		const r = checkAcVerification({
			body: FEATURE_AC_MAP_EMPTY_CELL,
			labels: ['type:feat'],
			lane: 'feature',
		});
		expect(r.ok).toBe(false);
	});

	it('integration lane: エビデンス表観点 (PASS)', () => {
		const r = checkAcVerification({
			body: INTEGRATION_EVIDENCE_PASS,
			labels: ['type:infra'],
			lane: 'integration',
		});
		expect(r.ok).toBe(true);
		expect(r.lane).toBe('integration');
	});

	it('integration lane: feature 用 AC マップを書いてもエビデンス表が無ければ FAIL (観点切替を確認)', () => {
		// feature 用 AC マップ section を持つが、integration lane では別観点なので fail する
		const r = checkAcVerification({
			body: FEATURE_AC_MAP_PASS,
			labels: ['type:infra'],
			lane: 'integration',
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain('マージ判定エビデンス表');
	});

	it('hotfix lane: 現行 AC マップ観点を維持 (PASS)', () => {
		const r = checkAcVerification({
			body: FEATURE_AC_MAP_PASS,
			labels: ['type:fix'],
			lane: 'hotfix',
		});
		expect(r.ok).toBe(true);
		expect(r.lane).toBe('hotfix');
	});

	it('skip 条件: type:docs はどの lane でも skip=PASS', () => {
		const r = checkAcVerification({ body: '', labels: ['type:docs'], lane: 'feature' });
		expect(r.ok).toBe(true);
		expect(r.reason).toContain('skip');
	});
});
