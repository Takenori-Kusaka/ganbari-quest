// Issue #2945 (Phase A/A-3、親 #2942) AC3/AC4: lane-aware AC 検証マップ judge の unit test。
// feature/hotfix lane = 現行 AC マップ観点 (回帰ゼロ)、integration lane = マージ判定エビデンス表観点。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	checkAcVerification,
	checkIntegrationEvidenceTable,
	checkPerPrAcMap,
	extractH2Section,
	INTEGRATION_EVIDENCE_SECTION,
	NG_DECLARATION_SECTION,
	NG_NONZERO_ACCEPTED_KEY,
	parseNgCountDeclarations,
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
// prose（inline-code 外）の `/` 隣接 / 日本語連続トークンは生 cell に当たる
// （#3846 で inline-code 内のみ strip 対象になったが、prose 検出は不変）。
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

// #3846 / #3844 BLOCK fix: inline-code (`...`) 内の定数名 \`RANGE_SSOT_TODO\` が
// TODO_PATTERN の \`todo\` に部分一致して false-positive gate fail していた。
// inline-code は機械トークン（定数名 / コマンド / ファイル参照）であり未完了宣言の prose ではない。
const FEATURE_AC_MAP_INLINE_CODE_CONSTANT = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC2 | 値域定数 SSOT 化 | grep | HEAD \`abc1234\` / \`RANGE_SSOT_TODO\` を domain 層へ集約 (src/lib/domain/range.ts:12) |
`;

// #3846: inline-code 内にコマンド由来の "todo" / "予定" 相当トークンがあっても PASS する。
const FEATURE_AC_MAP_INLINE_CODE_COMMAND = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | todo list 機能の unit 検証 | vitest | \`npx vitest run tests/unit/todo-list.test.ts\` 12 passed |
`;

// #3846: inline-code strip 後も prose 側の未完了表記は従来どおり検出する（strip し過ぎ防止）。
const FEATURE_AC_MAP_INLINE_CODE_PLUS_PROSE_TODO = `
## AC 検証マップ

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | ログイン | vitest | \`RANGE_SSOT_TODO\` は集約済、残りは後で対応 |
`;

// #4333: 残 NG 件数の宣言は `## NG 0 件 / カバレッジ宣言` section 内でのみ読む。
// 実在の統合 PR (#4253 / #3931 / #3866 …) が使っている形をそのまま fixture にする。
const NG_ZERO_SECTION = `
## NG 0 件 / カバレッジ宣言

- 残 NG 合計 0 件 (severity 3-4 + policy_compliant=false の未解決 finding なし)
- [x] adversarial evidence の反対理由が全件解消済みである
`;

const INTEGRATION_EVIDENCE_PASS = `
## 概要
develop → main 統合 PR

## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities | unit×3 / e2e×1 | pass |
| 修正 B（#3002） | child-home | unit×2 | pass |
${NG_ZERO_SECTION}`;

// #4243: evidence 表の **後ろ** に別の 4 列表がある body。
// 統合 PR template は「Accepted residual (Pre-PMF)」表を後続に持ち、その例示行が
// プレースホルダ (`<!-- ... -->`) のため、走査がセクションで閉じていないと誤検知する。
const INTEGRATION_EVIDENCE_WITH_TRAILING_TABLE = `
## 概要
develop -> main 統合 PR

## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities | unit×3 / e2e×1 | pass |

## Accepted residual (Pre-PMF)

| finding (要約) | severity (1-2 のみ) | 受容理由 (Pre-PMF) | 関連 root class |
|---|---|---|---|
| <!-- 例: 命名精度 --> | <!-- 2 --> | <!-- dev-only 診断値 --> | <!-- 完全性 --> |
${NG_ZERO_SECTION}`;

// #4243: evidence 表が **空** なのに、後続表には埋まった 4 列行がある body。
// 走査が閉じていないと `rows.length === 0` を後続表の行が満たしてしまい **見逃す**。
const INTEGRATION_EVIDENCE_EMPTY_BUT_TRAILING_FILLED = `
## 概要
develop -> main 統合 PR

## マージ判定エビデンス表

（まだ埋めていない）

## Accepted residual (Pre-PMF)

| finding (要約) | severity (1-2 のみ) | 受容理由 (Pre-PMF) | 関連 root class |
|---|---|---|---|
| 命名精度 | 2 | dev-only 診断値 | 完全性 |
${NG_ZERO_SECTION}`;

const INTEGRATION_EVIDENCE_MISSING_SECTION = `
## 概要
統合 PR だがエビデンス表 section が無い
`;

const INTEGRATION_EVIDENCE_EMPTY_ROW = `
## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities |  | pass |
${NG_ZERO_SECTION}`;

const INTEGRATION_EVIDENCE_NO_NG_ZERO = `
## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities | unit×3 | pass |
`;

const INTEGRATION_EVIDENCE_NO_ROWS = `
## マージ判定エビデンス表

（表をまだ埋めていない）
${NG_ZERO_SECTION}`;

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

	// --- #3846 / #3844: evidence cell の inline-code strip (定数名 false-positive 解消) ---

	it('PASS: inline-code 内の定数名 `RANGE_SSOT_TODO` を未完了表記と誤検出しない (#3846 / #3844)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_INLINE_CODE_CONSTANT, 'feature');
		expect(r.ok).toBe(true);
	});

	it('PASS: inline-code 内のコマンド (`npx vitest run tests/unit/todo-list.test.ts`) を誤検出しない (#3846)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_INLINE_CODE_COMMAND, 'feature');
		expect(r.ok).toBe(true);
	});

	it('FAIL: inline-code strip 後も prose 側の未完了表記 (「後で対応」) は検出継続 (#3846 strip し過ぎ防止)', () => {
		const r = checkPerPrAcMap(FEATURE_AC_MAP_INLINE_CODE_PLUS_PROSE_TODO, 'feature');
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未完了表記');
	});
});

// --- integration lane (AC3) ---

describe('checkIntegrationEvidenceTable (integration lane、AC3)', () => {
	it('PASS: エビデンス表 4 列 + 残 NG 0 件 明示', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_PASS);
		expect(r.ok).toBe(true);
		expect(r.lane).toBe('integration');
	});

	it('#4243 後続表のプレースホルダ行を evidence の空欄と誤判定しない (false positive)', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_WITH_TRAILING_TABLE);
		expect(
			r.ok,
			'Accepted residual 表の例示行を evidence 表の空欄として拾っています (走査がセクションで閉じていない)',
		).toBe(true);
	});

	it('#4243 evidence 表が空なら、後続表に行があっても fail する (false negative)', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_EMPTY_BUT_TRAILING_FILLED);
		expect(
			r.ok,
			'evidence 表が空なのに後続表の行で通過しています。main 反映前の証跡が空洞化します',
		).toBe(false);
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

	it('FAIL: 残 NG 宣言 section が無い', () => {
		const r = checkIntegrationEvidenceTable(INTEGRATION_EVIDENCE_NO_NG_ZERO);
		expect(r.ok).toBe(false);
		expect(r.error).toContain('NG 0 件 / カバレッジ宣言');
	});
});

// --- #4333: 「残 NG 0 件」gate が内容を検証していなかった件 ---
//
// 旧実装は本文全体への 1 本の正規表現 `test()` で「0 という字があるか」だけを見ており、
// 下記 5 ケースが **すべて緑**だった（実測: `node tmp/repro-4333.mjs` on develop）。
// ここは「fail するケース」の固定が本題である（AC4）— 直すだけでは壊れても誰も気づかない。

/** 4 列を満たす evidence 表（NG 宣言以外の条件は満たす。NG 判定だけを裸にするための土台）。 */
const EVIDENCE_TABLE_ONLY = `
## マージ判定エビデンス表

| 含有 PR | 対象領域 | 対応テストケース | 結果 |
|---|---|---|---|
| 機能 A（#3001） | admin/activities | unit×3 | pass |
`;

const withNgSection = (bodyOfSection: string) =>
	`${EVIDENCE_TABLE_ONLY}\n## NG 0 件 / カバレッジ宣言\n\n${bodyOfSection}\n`;

describe('#4333 残 NG 0 件 gate は件数を検証する（見出しがあるだけで緑にしない）', () => {
	it('FAIL: 「残 NG は 10 件」と正直に書いた本文を通さない（旧実装は 0 と読んでいた）', () => {
		const r = checkIntegrationEvidenceTable(
			withNgSection('- 残 NG は 10 件 (未解決 finding あり)'),
		);
		expect(r.ok, '「10 件」の末尾 0 を 0 件として読んでいます').toBe(false);
		expect(r.error).toContain('残 NG が 0 件ではありません');
		expect(r.error).toContain('10 件');
	});

	it('FAIL: 残 NG 合計 1 件（#4304 の実際の宣言。severity 4 = #4309 を残したまま merge した）', () => {
		const r = checkIntegrationEvidenceTable(
			withNgSection(
				'**残 NG 合計 1 件**: `security-1`（/ops/export 未認証、severity 4）→ **#4309**',
			),
		);
		expect(r.ok, '#4304 は正直に 1 件と宣言したのに緑だった。それを再現してはいけない').toBe(false);
	});

	it('FAIL: 見出しはあるが section 本体に件数の宣言が無い（検査できないものを pass にしない）', () => {
		const r = checkIntegrationEvidenceTable(withNgSection('（まだ書いていない）'));
		expect(r.ok).toBe(false);
		expect(r.error).toContain('残 NG 件数の宣言がありません');
	});

	it('FAIL: HTML コメント内の template 説明文では通らない（AC1）', () => {
		const r = checkIntegrationEvidenceTable(
			withNgSection('<!-- 4 列のデータ行 + 残 NG 0 件 明示を検証する -->'),
		);
		expect(r.ok, 'template の HTML コメントは顧客にも監査にも見えない').toBe(false);
	});

	it('FAIL: code block 内で本 gate の regex を引用しただけでは通らない', () => {
		const r = checkIntegrationEvidenceTable(
			withNgSection('```\nconst NG = /残 NG 合計 0 件/;\n```'),
		);
		expect(r.ok).toBe(false);
	});

	it('FAIL: 否定文（「残 NG 0 件」を偽って宣言しない）を宣言として拾わない（AC2）', () => {
		const r = checkIntegrationEvidenceTable(
			`${EVIDENCE_TABLE_ONLY}\n**「残 NG 0 件」を偽って宣言しない。**\n`,
		);
		expect(r.ok, 'section 外の否定文を宣言として読んでいます').toBe(false);
	});

	it('FAIL: 見出し行そのもの（## NG 0 件 / カバレッジ宣言）を match 源にしない（AC3）', () => {
		const r = checkIntegrationEvidenceTable(
			`${EVIDENCE_TABLE_ONLY}\n## NG 0 件 / カバレッジ宣言\n`,
		);
		expect(r.ok, '見出し文字列だけで緑になっています（本欠陥そのもの）').toBe(false);
	});

	it('FAIL: 0 件 と 1 件 を同時に主張している本文は通さない', () => {
		const r = checkIntegrationEvidenceTable(
			withNgSection('- 残 NG 合計 0 件\n- ただし残 NG 1 件 は次 release へ繰り延べる'),
		);
		expect(r.ok).toBe(false);
	});

	it('PASS: 実在の統合 PR (#4253) と同形の宣言は従来どおり通る（回帰）', () => {
		const r = checkIntegrationEvidenceTable(
			withNgSection(
				'- 残 NG 合計 0 件 (severity 3-4 + policy_compliant=false の未解決 finding なし)\n' +
					'- [x] 8 領域 finding のうち severity 閾値以上の未解決 NG が **0 件**である',
			),
		);
		expect(r.ok, r.error).toBe(true);
	});

	it('PASS: 実在の統合 PR (#3357) の言い回し「残る blocking NG = 0 件」も通る（回帰）', () => {
		const r = checkIntegrationEvidenceTable(
			withNgSection(
				'- diff 起因の sev4=0。実害直結 sev3 は 1 件（ux-2）を follow-up #3361 化。残る blocking NG = 0 件',
			),
		);
		expect(r.ok, r.error).toBe(true);
	});
});

describe('#4333 残 NG > 0 の受容宣言（正直な宣言を罰して嘘に倒させない）', () => {
	const NONZERO = '**残 NG 合計 1 件**: security-1（severity 4）';

	it('PASS: 理由 + 追跡 Issue 付きの受容宣言があれば通る', () => {
		const r = checkIntegrationEvidenceTable(
			`<!-- ng-nonzero-accepted: /ops/export の認可修正は本 release の scope 外で #4309 で追跡する -->\n${withNgSection(NONZERO)}`,
		);
		expect(r.ok, r.error).toBe(true);
		expect(r.reason).toContain('受容宣言あり');
	});

	it('FAIL: 受容宣言の理由が定型 stub（TODO）なら通さない', () => {
		const r = checkIntegrationEvidenceTable(
			`<!-- ng-nonzero-accepted: TODO -->\n${withNgSection(NONZERO)}`,
		);
		expect(r.ok).toBe(false);
		expect(r.error).toContain('理由が受理できません');
	});

	it('FAIL: 追跡 Issue 番号を含まない理由は通さない', () => {
		const r = checkIntegrationEvidenceTable(
			`<!-- ng-nonzero-accepted: 次のリリースでまとめて対応するので今回は見送る -->\n${withNgSection(NONZERO)}`,
		);
		expect(r.ok).toBe(false);
		expect(r.error).toContain('理由が受理できません');
	});

	it('受容宣言は 残 NG 0 件 の PR には不要（宣言なしでも通る）', () => {
		const r = checkIntegrationEvidenceTable(withNgSection('- 残 NG 合計 0 件'));
		expect(r.ok, r.error).toBe(true);
	});
});

// --- 生成側 assert (#4333): template / SECTIONS.json と judge のズレを検出する ---
//
// judge 側だけ直しても、template の見出しや宣言文が変われば **判定が空振り**する。
// #4324 (#4255) で SS gate に入れたのと同じ「生成側にも assert を置く」対処。

describe('#4333 生成側 assert: 統合 PR template と judge の同期', () => {
	const templatePath = resolve(process.cwd(), '.github/INTEGRATION_PR_TEMPLATE.md');
	const sectionsPath = resolve(process.cwd(), '.github/INTEGRATION_PR_TEMPLATE_SECTIONS.json');
	const template = readFileSync(templatePath, 'utf8');
	const sections: string[] = JSON.parse(readFileSync(sectionsPath, 'utf8')).sections;

	it('SECTIONS.json が judge の見る見出しを宣言している', () => {
		expect(sections).toContain(`## ${NG_DECLARATION_SECTION}`);
		expect(sections).toContain(`## ${INTEGRATION_EVIDENCE_SECTION}`);
	});

	it('template に judge と同一文字列の見出しが行として存在する', () => {
		const lines = template.split('\n').map((l) => l.trim());
		expect(lines).toContain(`## ${NG_DECLARATION_SECTION}`);
		expect(lines).toContain(`## ${INTEGRATION_EVIDENCE_SECTION}`);
	});

	it('template の既定宣言文が judge に「0 件」として読み取れる（文言変更で空振りしない）', () => {
		const section = extractH2Section(template, NG_DECLARATION_SECTION);
		expect(section.found).toBe(true);
		const declarations = parseNgCountDeclarations(section.text);
		expect(
			declarations.length,
			'template の「残 NG 合計 0 件」行が judge の宣言パターンから外れています',
		).toBeGreaterThan(0);
		expect(declarations.every((d) => d.count === 0)).toBe(true);
	});

	it('template は受容宣言の書き方を案内している（宣言 key の drift 検出）', () => {
		expect(template).toContain(NG_NONZERO_ACCEPTED_KEY);
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
	it('feature lane: AC マップ観点 (always PASS, check removed)', () => {
		const r = checkAcVerification({
			body: FEATURE_AC_MAP_EMPTY_CELL,
			labels: ['type:feat'],
			lane: 'feature',
		});
		expect(r.ok).toBe(true);
		expect(r.reason).toContain('removed');
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

	it('hotfix lane: always PASS, check removed', () => {
		const r = checkAcVerification({
			body: FEATURE_AC_MAP_EMPTY_CELL,
			labels: ['type:fix'],
			lane: 'hotfix',
		});
		expect(r.ok).toBe(true);
		expect(r.reason).toContain('removed');
	});
});
