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

// js/bad-tag-filter (#3021 CodeQL): `--!>` 終端のコメントは旧 regex `/^<!--.*-->$/` が
// 検出できず空欄プレースホルダのまま gate を通過した。robust 化後は空欄扱いで検出される。
const FEATURE_AC_MAP_COMMENT_EVASION = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン | \`vitest\` | <!-- まだ書いてない --!> |
`;

const FEATURE_AC_MAP_TODO = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン | \`vitest\` | 別途追加予定 |
`;

// #3488: ファイル名 slug の "followup"（区切り無し）は完了済エビデンス参照のトークンであり、
// 未完了マーカー "follow-up" / "follow up"（区切り 1 文字必須）とは別物。
// `follow[\s-]up`（区切り必須）にすることで slug を誤検出しない（false-positive 回帰防止）。
// 拡張子 whitelist の strip 前処理は脆い（収録外拡張子で FP / 密着未完了語で bypass）ため撤去し、
// 生 cell に直接 pattern を当てる方針（#3488 定方針）。
const FEATURE_AC_MAP_FILENAME_FOLLOWUP = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC5 | research SSOT を docs/research に保存 | grep | HEAD \`f183e397a\` / docs/research/2026-06-29-followup-treadmill-root-cause.md |
`;

// #3488: 旧 strip の収録外拡張子で FP 再発していたケース（.sql / .pdf）も、slug "followup"（区切り無し）
// なので新 pattern では PASS する（strip 不要で FP 回避）。
const FEATURE_AC_MAP_SLUG_FOLLOWUP_VARIANTS = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | schema 反映 | drizzle | migrations/schema-followup.sql 適用済 |
| AC2 | 図版 | review | docs/followup.pdf レビュー済 |
`;

// #3488: 未完了マーカーは区切り 1 文字（空白 or ハイフン）を必ず持つため検出継続する。
// strip を全廃したので code span / `/` 隣接 / 日本語連続トークンに置いても生 cell に当たる。
const FEATURE_AC_MAP_TODO_FOLLOWUP_SPACE = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン | \`vitest\` | 別途 follow-up で対応 |
`;

const FEATURE_AC_MAP_TODO_FILENAME_SCHEDULED = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン | \`vitest\` | 対応予定.md を参照 |
`;

const FEATURE_AC_MAP_TODO_JP_TOKEN = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン | \`vitest\` | 後で対応する予定 |
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

	it('FAIL: `--!>` 終端のコメントプレースホルダも空欄扱い (js/bad-tag-filter, #3021)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_COMMENT_EVASION, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('空欄');
	});

	it('FAIL: 4 列目に未完了表記 (#1539)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_TODO, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未完了表記');
	});

	it('PASS: filename 中の "followup"（区切り無し slug）を未完了表記と誤検出しない (#3488)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_FILENAME_FOLLOWUP, 'feature');
		expect(r.ok).toBe(true);
	});

	// #3488: 旧 strip の収録外拡張子 FP（.sql / .pdf）も slug followup なので新 pattern で PASS。
	it('PASS: schema-followup.sql / docs/followup.pdf を誤検出しない (#3488 FP 回避)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_SLUG_FOLLOWUP_VARIANTS, 'feature');
		expect(r.ok).toBe(true);
	});

	// #3488: 区切り 1 文字を持つ未完了マーカーは検出継続する（strip 全廃で生 cell に当たる）。
	it('FAIL: "follow-up" / "follow up"（区切りあり）は検出 (#3488)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_TODO_FOLLOWUP_SPACE, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未完了表記');
	});

	it('FAIL: "対応予定.md" の "予定" を検出（strip 全廃で生 cell 検出、#3488）', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_TODO_FILENAME_SCHEDULED, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未完了表記');
	});

	it('FAIL: 未完了マーカーを日本語連続トークンに置いても検出 (#3488)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_TODO_JP_TOKEN, 'feature');
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

// --- #3071: integration lane では label / 明示コメントによる skip を無効化 (空洞化防止) ---

describe('shouldSkip integration lane = skip 無効化 (#3071)', () => {
	it('integration lane では type:docs ラベルでも skip しない', () => {
		expect(shouldSkip({ body: '', labels: ['type:docs'], lane: 'integration' }).skip).toBe(false);
	});
	it('integration lane では dependencies ラベルでも skip しない', () => {
		expect(shouldSkip({ body: '', labels: ['dependencies'], lane: 'integration' }).skip).toBe(
			false,
		);
	});
	it('integration lane では明示 skip コメントでも skip しない', () => {
		expect(
			shouldSkip({ body: '<!-- ac-verification-skip: x -->', labels: [], lane: 'integration' })
				.skip,
		).toBe(false);
	});
	it('feature lane は従来どおり type:docs で skip する (回帰なし)', () => {
		expect(shouldSkip({ body: '', labels: ['type:docs'], lane: 'feature' }).skip).toBe(true);
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
