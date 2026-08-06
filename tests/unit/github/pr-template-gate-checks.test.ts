// Issue #2944 (Phase A/A-2、親 #2942 / EPIC #2861)
// pr-template-gate.yml の 5 job の lane-aware 検証ロジック (scripts/pr-template-gate-checks.mjs)
// を 4 lane (feature / integration / hotfix / dependabot) × PASS/FAIL の fixture で網羅検証する。
//
// 目的 (#2944 実装方針):
//   各 lane で「何が検証されるか」を fixture 入力でローカル実行し、検証が
//   空洞化していない (= integration が単に skip されていない) ことを test で固定する。
//   - AC2: integration lane で 5 check が skip されず実行される (空洞化なし)。
//   - AC3: integration lane の issue-reference が含有 PR 一覧を検証する。
//   - AC4: feature / hotfix lane が現行と完全同一の観点を維持する (回帰ゼロ)。
//   - AC5: dependabot lane は全 check が skip 相当 (挙動不変)。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	CLOSING_KEYWORD_TARGET_LABELS,
	checkChangeType,
	checkClosingKeyword,
	checkCustomerValue,
	checkIssueReference,
	checkSectionPresence,
	checkTestResults,
	detectChangeTypeHeading,
	detectIssueSectionHeading,
	detectTestSectionKeyword,
	extractTemplateSections,
	INTEGRATION_REQUIRED_SECTIONS,
	parseArgs,
	stripConventionalCommitFixTitleLines,
} from '../../../scripts/pr-template-gate-checks.mjs';

// --- 最小だが現行構造に一致する template fixture ---
const TEMPLATE = `<!-- 冒頭コメント -->

## 顧客価値・目的

<!-- 「何を変更したか」ではなく -->

**対象ユーザー**: <!-- 子供 / 親 -->

**解決する課題**: <!-- 1-2 文で -->

**期待される効果**: <!-- どう改善されるか -->

## 関連 Issue

<!-- closes #123 で自動クローズ -->
closes #

## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---------|--------|---------|------------------|
| AC1 | <!-- 例 --> | <!-- 例 --> | <!-- 例 --> |

## 変更タイプ

- [ ] feat: 新機能
- [ ] fix: バグ修正
- [ ] refactor: リファクタリング
- [ ] design: デザイン・UI改善
- [ ] infra: インフラ・CI/CD
- [ ] test: テスト改善
- [ ] docs: ドキュメント
- [ ] marketing: マーケティング・LP

## 影響範囲・変更コンポーネント

**変更レイヤー**:
- [ ] DB スキーマ

## テスト & 安全装置セルフチェック

- [ ] pre-ready

### テスト実行結果

| テスト種別 | コマンド | 結果 | 備考 |
|---|---|---|---|
| Lint | \`npx biome check .\` | <!-- 例: PASS --> | |

## レビュー依頼事項・破壊的変更

**破壊的変更**:
- [ ] 含まれない

## 配布済み env / secret (ADR-0006)

- [ ] N/A

## Ready for Review チェックリスト

- [ ] pre-ready

## QM レビュー結果

[QM 手順]
`;

// SSOT JSON sections (PR_TEMPLATE_SECTIONS.json と同型)
const SSOT_SECTIONS = extractTemplateSections(TEMPLATE);

/** feature/hotfix lane で PASS する典型 PR body (現行 template を全部埋めたもの)。 */
const VALID_FEATURE_BODY = `## 顧客価値・目的

**対象ユーザー**: システム全体（開発フロー）

**解決する課題**: gate が lane を見ず偽装前提になる問題を解消する。

**期待される効果**: 統合 PR が偽装なしに gate を通過できる。

## 関連 Issue

closes #2944

## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---------|--------|---------|------------------|
| AC1 | lane 取得 | grep | HEAD abc / actions/pr-lane 経由 |

## 変更タイプ

- [x] infra: インフラ・CI/CD

## 影響範囲・変更コンポーネント

**変更レイヤー**:
- [x] 設定・CI

## テスト & 安全装置セルフチェック

- [x] pre-ready

### テスト実行結果

| テスト種別 | コマンド | 結果 | 備考 |
|---|---|---|---|
| Lint | \`npx biome check .\` | PASS | |
| 単体テスト | \`npx vitest run\` | 30 passed | |

## レビュー依頼事項・破壊的変更

**破壊的変更**:
- [x] このPRに破壊的変更は含まれない

## 配布済み env / secret (ADR-0006)

- [x] N/A

## Ready for Review チェックリスト

- [x] pre-ready 全 Step PASS

## QM レビュー結果

[QM 5 手順]
`;

describe('helper detectors (#2944)', () => {
	it('extractTemplateSections は `## ` 見出しのみ抽出 (### は除外)', () => {
		expect(SSOT_SECTIONS).toContain('## 顧客価値・目的');
		expect(SSOT_SECTIONS).toContain('## テスト & 安全装置セルフチェック');
		expect(SSOT_SECTIONS).not.toContain('### テスト実行結果');
	});
	it('detectIssueSectionHeading は closes # を含む section を返す', () => {
		expect(detectIssueSectionHeading(TEMPLATE)).toBe('## 関連 Issue');
	});
	it('detectChangeTypeHeading は 3 つ以上 [ ] を持つ section を返す', () => {
		expect(detectChangeTypeHeading(TEMPLATE)).toBe('## 変更タイプ');
	});
	it('detectTestSectionKeyword はテスト結果テーブル直近の見出しを返す', () => {
		expect(detectTestSectionKeyword(TEMPLATE)).toBe('テスト実行結果');
	});
});

// =====================================================================
// AC4: feature / hotfix lane = 現行と完全同一観点 (回帰ゼロ)
// =====================================================================
describe('feature lane: 現行観点維持 (#2944 AC4)', () => {
	const base = {
		labels: [],
		template: TEMPLATE,
		ssotSections: SSOT_SECTIONS,
		lane: 'feature' as const,
	};

	it('section-presence PASS: 全 section 存在', () => {
		const r = checkSectionPresence({ ...base, body: VALID_FEATURE_BODY });
		expect(r.ok).toBe(true);
		expect(r.skipped).toBeFalsy();
	});
	it('section-presence FAIL: section 欠落で fail', () => {
		const r = checkSectionPresence({
			...base,
			body: VALID_FEATURE_BODY.replace('## QM レビュー結果', '## (削除済)'),
		});
		expect(r.ok).toBe(false);
		expect(r.message).toContain('QM レビュー結果');
	});
	it('issue-reference PASS: closes #2944', () => {
		expect(checkIssueReference({ ...base, body: VALID_FEATURE_BODY }).ok).toBe(true);
	});
	it('issue-reference FAIL: closes # 空欄', () => {
		const r = checkIssueReference({
			...base,
			body: VALID_FEATURE_BODY.replace('closes #2944', 'closes #'),
		});
		expect(r.ok).toBe(false);
	});
	it('change-type PASS: 1 つ [x]', () => {
		expect(checkChangeType({ ...base, body: VALID_FEATURE_BODY }).ok).toBe(true);
	});
	it('change-type FAIL: 0 件 [x]', () => {
		const r = checkChangeType({
			...base,
			body: VALID_FEATURE_BODY.replace(
				'- [x] infra: インフラ・CI/CD',
				'- [ ] infra: インフラ・CI/CD',
			),
		});
		expect(r.ok).toBe(false);
	});
	it('customer-value PASS: placeholder 残存なし', () => {
		expect(checkCustomerValue({ ...base, body: VALID_FEATURE_BODY }).ok).toBe(true);
	});
	// #4097: 旧実装は「2 番目の `## `」を狙う findIndex だったため、template が HTML コメントで
	// 始まると抽出範囲が先頭コメントに縮退し field 0 件 = 常に PASS する no-op になっていた。
	// (#2944 が「検証ロジックを一切変えない」方針でこの挙動を pin していた。#4097 で pin を解除)
	it('customer-value FAIL: 先頭コメント始まりの template でも placeholder を検出する (#4097 no-op 解消)', () => {
		const tplWithLeadingComment = `<!-- 冒頭コメント -->\n\n${TEMPLATE}`;
		const r = checkCustomerValue({
			...base,
			template: tplWithLeadingComment,
			body: VALID_FEATURE_BODY.replace(
				'**対象ユーザー**: システム全体（開発フロー）',
				'**対象ユーザー**: <!-- 子供 / 親 -->',
			),
		});
		expect(r.ok).toBe(false);
		expect(r.message).toContain('対象ユーザー');
	});
	it('customer-value FAIL: 先頭コメントなし template では placeholder を検出して fail (検出機構の実証)', () => {
		// 顧客価値 section を 1 番目に置いた template なら inline field を検出する
		const tplNoComment = `## 顧客価値・目的

**対象ユーザー**: <!-- 子供 / 親 -->

**解決する課題**: <!-- 1-2 文で -->

## 関連 Issue
`;
		const body = `## 顧客価値・目的

**対象ユーザー**: <!-- 子供 / 親 -->

**解決する課題**: gate が lane を見ない問題を解消。

## 関連 Issue
`;
		const r = checkCustomerValue({ ...base, template: tplNoComment, body });
		expect(r.ok).toBe(false);
		expect(r.message).toContain('対象ユーザー');
	});
	it('customer-value FAIL: `--!>` 終端の placeholder も未記入扱いで検出 (js/bad-tag-filter, #3021)', () => {
		// 旧 regex `/^<!--.*-->$/` は `--!>` 終端を comment と認識せず gate を通過させた。
		const tplNoComment = `## 顧客価値・目的

**対象ユーザー**: <!-- 子供 / 親 -->

## 関連 Issue
`;
		const body = `## 顧客価値・目的

**対象ユーザー**: <!-- 子供 / 親 --!>

## 関連 Issue
`;
		const r = checkCustomerValue({ ...base, template: tplNoComment, body });
		expect(r.ok).toBe(false);
		expect(r.message).toContain('対象ユーザー');
	});
	it('test-results PASS: 結果列記入済み', () => {
		expect(checkTestResults({ ...base, body: VALID_FEATURE_BODY }).ok).toBe(true);
	});
	it('test-results FAIL: 結果列 placeholder 残存', () => {
		const r = checkTestResults({
			...base,
			body: VALID_FEATURE_BODY.replace(
				'| Lint | `npx biome check .` | PASS | |',
				'| Lint | `npx biome check .` | <!-- PASS / FAIL --> | |',
			),
		});
		expect(r.ok).toBe(false);
	});
	it('test-results skip: type:docs label', () => {
		const r = checkTestResults({ ...base, labels: ['type:docs'], body: VALID_FEATURE_BODY });
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
	});
});

describe('hotfix lane: feature と完全同一観点 (#2944 AC4)', () => {
	const fixBody = VALID_FEATURE_BODY;
	const baseF = {
		labels: [],
		template: TEMPLATE,
		ssotSections: SSOT_SECTIONS,
		lane: 'feature' as const,
	};
	const baseH = {
		labels: [],
		template: TEMPLATE,
		ssotSections: SSOT_SECTIONS,
		lane: 'hotfix' as const,
	};
	it('section-presence: feature と hotfix で ok 値が一致', () => {
		expect(checkSectionPresence({ ...baseH, body: fixBody }).ok).toBe(
			checkSectionPresence({ ...baseF, body: fixBody }).ok,
		);
	});
	it('issue-reference FAIL: hotfix も closes # 空欄を fail (現行維持)', () => {
		const r = checkIssueReference({ ...baseH, body: fixBody.replace('closes #2944', 'closes #') });
		expect(r.ok).toBe(false);
	});
	it('issue-reference: hotfix は含有 PR 一覧観点に切り替わらない (1 件参照で PASS)', () => {
		// integration なら 2 件未満で fail するが、hotfix は単一 #参照で PASS する (feature と同じ)
		expect(checkIssueReference({ ...baseH, body: fixBody }).ok).toBe(true);
	});
});

// =====================================================================
// AC2 / AC3: integration lane = 観点切替 (skip されず実行)
// =====================================================================
describe('integration lane: 観点切替・空洞化なし (#2944 AC2/AC3)', () => {
	const base = {
		labels: [],
		template: TEMPLATE,
		ssotSections: SSOT_SECTIONS,
		lane: 'integration' as const,
	};

	// 統合 PR body: closes # 単一でなく含有 PR 一覧、AC マップ section 等は持たなくてよい
	const INTEGRATION_BODY = `## 顧客価値・目的

**対象ユーザー**: システム全体

**解決する課題**: 本リリースバッチで複数 PR を本番反映する。

**期待される効果**: develop の累積変更を main に届ける。

## 関連 Issue

本統合 PR が含む PR:
- #3010
- #3012
- #3015

## 変更タイプ

- [x] feat: 新機能
- [x] fix: バグ修正
- [x] docs: ドキュメント

## テスト & 安全装置セルフチェック

- [x] 重量レーン CI 緑

## マージ判定エビデンス表

<!-- #4348: 統合 PR の test-results 観点が読むのは統合 PR template の本 section
     (.github/INTEGRATION_PR_TEMPLATE_SECTIONS.json の SSOT)。旧 fixture は feature template の
     H3「テスト実行結果」を流用しており、実 CI では **一度もこの分岐に入っていなかった**
     (実測: merged 統合 PR 12 本すべてで skip)。fixture を実 template の形に揃える。 -->

| 検証観点 | 集約結果 | エビデンス |
|---|---|---|
| 重量レーン E2E | PASS (含有 3 PR 分) | run #12345 |

## レビュー依頼事項・破壊的変更

**破壊的変更**:
- [x] 含まれない

## Ready for Review チェックリスト

- [x] 統合確認済み

## QM レビュー結果

[統合 PR QM 手順]
`;

	it('section-presence は dependabot skip でなく integration section set で実行される (AC2)', () => {
		const r = checkSectionPresence({ ...base, body: INTEGRATION_BODY });
		expect(r.skipped).toBeFalsy(); // 空洞化 (skip) していない
		expect(r.ok).toBe(true);
		expect(r.message).toContain('INTEGRATION_REQUIRED_SECTIONS');
	});
	// #3071: integration PR に誤って dependencies / type:docs label が付いても skip しない (空洞化防止)
	it('integration + dependencies label でも section-presence は skip しない (#3071)', () => {
		const r = checkSectionPresence({ ...base, labels: ['dependencies'], body: INTEGRATION_BODY });
		expect(r.skipped).toBeFalsy();
		expect(r.ok).toBe(true);
	});
	it('integration + type:docs label でも test-results は skip しない (#3071)', () => {
		const r = checkTestResults({ ...base, labels: ['type:docs'], body: INTEGRATION_BODY });
		expect(r.skipped).toBeFalsy();
	});
	it('section-presence FAIL: 統合必須 section 欠落で fail (空洞化していない証跡)', () => {
		const r = checkSectionPresence({
			...base,
			body: INTEGRATION_BODY.replace('## QM レビュー結果', '## (削除)'),
		});
		expect(r.ok).toBe(false);
		expect(r.message).toContain('## QM レビュー結果');
	});
	it('issue-reference PASS: 含有 PR 一覧 (2 件以上) で通過 (AC3)', () => {
		const r = checkIssueReference({ ...base, body: INTEGRATION_BODY });
		expect(r.ok).toBe(true);
		expect(r.message).toContain('含有 PR 一覧');
	});
	it('issue-reference FAIL: 含有 PR 1 件のみは fail (統合 PR は束ねが本質、AC3)', () => {
		const r = checkIssueReference({
			...base,
			body: INTEGRATION_BODY.replace(/- #3012\n- #3015\n/, ''),
		});
		expect(r.ok).toBe(false);
		expect(r.message).toContain('含有 PR 一覧がありません');
	});
	it('issue-reference: integration は closes #<単一> を必須としない (closes # 空欄でも PR 一覧あれば PASS)', () => {
		// 統合 PR には closes # 行が無いが #NNNN 2 件以上あれば PASS = 偽装 closes 不要
		expect(checkIssueReference({ ...base, body: INTEGRATION_BODY }).ok).toBe(true);
		expect(INTEGRATION_BODY).not.toContain('closes #');
	});
	it('change-type PASS: 複数タイプ混在を許容 (AC2)', () => {
		const r = checkChangeType({ ...base, body: INTEGRATION_BODY });
		expect(r.ok).toBe(true);
		expect(r.message).toContain('複数混在 OK');
	});
	it('change-type FAIL: 0 件 [x] は integration でも fail (1 つ以上は維持)', () => {
		const r = checkChangeType({
			...base,
			body: INTEGRATION_BODY.replace(/- \[x\]/g, '- [ ]'),
		});
		expect(r.ok).toBe(false);
	});
	it('test-results PASS: 統合エビデンス表 (1 行) があれば通過', () => {
		const r = checkTestResults({ ...base, body: INTEGRATION_BODY });
		expect(r.ok).toBe(true);
		expect(r.message).toContain('統合エビデンス表');
	});
	it('test-results FAIL: エビデンス表 0 行は integration で fail (skip でなく fail = 空洞化なし)', () => {
		const noTable = INTEGRATION_BODY.replace(
			/## マージ判定エビデンス表[\s\S]*?(?=## レビュー依頼事項)/,
			'## マージ判定エビデンス表\n\n（表なし）\n\n',
		);
		const r = checkTestResults({ ...base, body: noTable });
		expect(r.ok).toBe(false);
		expect(r.skipped).toBeFalsy();
		expect(r.message).toContain('統合エビデンス表');
	});
	it('customer-value PASS: placeholder 残存なし (リリースバッチサマリ)', () => {
		const r = checkCustomerValue({ ...base, body: INTEGRATION_BODY });
		expect(r.ok).toBe(true);
		expect(r.message).toContain('リリースバッチ');
	});

	it('INTEGRATION_REQUIRED_SECTIONS は AC 検証マップ等 per-PR 前提 section を含まない', () => {
		expect(INTEGRATION_REQUIRED_SECTIONS).not.toContain('## AC 検証マップ (ADR-0004)');
		expect(INTEGRATION_REQUIRED_SECTIONS).not.toContain('## スクリーンショット / ビジュアルデモ');
		// 統合 PR でも意味を持つ section は含む
		expect(INTEGRATION_REQUIRED_SECTIONS).toContain('## 顧客価値・目的');
		expect(INTEGRATION_REQUIRED_SECTIONS).toContain('## 関連 Issue');
	});
});

// =====================================================================
// #3688: integration lane の section-presence は INTEGRATION_PR_TEMPLATE_SECTIONS.json
// (統合 PR 用 SSOT、#2950) を検証し、feature 用 section を要求しない。
// 実 SSOT JSON を読み込んで fixture に使い、正規統合 body (#3686 型) が素で PASS することを固定する。
// =====================================================================
describe('integration lane: INTEGRATION_PR_TEMPLATE_SECTIONS.json ベース検証 (#3688)', () => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const integrationSsot = JSON.parse(
		readFileSync(
			resolve(__dirname, '../../../.github/INTEGRATION_PR_TEMPLATE_SECTIONS.json'),
			'utf-8',
		),
	) as { sections: string[] };
	const INTEGRATION_SSOT_SECTIONS = integrationSsot.sections;

	// #3686 型の正規統合 body: INTEGRATION_PR_TEMPLATE.md の 7 section を埋めたもの。
	// feature 用 template の 5 section (変更タイプ / テスト & 安全装置セルフチェック /
	// レビュー依頼事項・破壊的変更 / Ready for Review チェックリスト / QM レビュー結果) を持たない。
	const CANONICAL_INTEGRATION_BODY = `## 統合サマリ

develop の累積変更 5 PR を main に統合する。

## 含有 PR 一覧

- #3010
- #3012
- #3015

## マージ判定エビデンス表

| 含有 PR | 領域 | テスト | 結果 |
|---|---|---|---|
| #3010 | admin | 重量レーン E2E | PASS |

## 監査 run 結果リンク

- run https://github.com/example/actions/runs/12345

## NG 0 件 / カバレッジ宣言

- [x] 残 NG 0 件

## Accepted residual (Pre-PMF)

なし

## back-merge / drift 状態

- [x] back-merge 済 / drift なし
`;

	const base = {
		labels: [],
		template: TEMPLATE,
		ssotSections: SSOT_SECTIONS,
		integrationSsotSections: INTEGRATION_SSOT_SECTIONS,
		lane: 'integration' as const,
	};

	it('AC1/AC3: 正規統合 body が素で PASS する (feature 用 section を要求しない)', () => {
		const r = checkSectionPresence({ ...base, body: CANONICAL_INTEGRATION_BODY });
		expect(r.ok).toBe(true);
		expect(r.skipped).toBeFalsy();
		expect(r.message).toContain('INTEGRATION_PR_TEMPLATE_SECTIONS.json');
	});
	it('AC1: 統合 section 欠落で fail する (JSON ベース検証の空洞化なし)', () => {
		const r = checkSectionPresence({
			...base,
			body: CANONICAL_INTEGRATION_BODY.replace('## マージ判定エビデンス表', '## (削除)'),
		});
		expect(r.ok).toBe(false);
		expect(r.message).toContain('## マージ判定エビデンス表');
	});
	it('AC1: feature 用 5 section の欠落は integration では fail 要因にならない (#3686 再現の否定)', () => {
		// CANONICAL_INTEGRATION_BODY は feature 用 5 section を一切含まないが PASS する
		expect(CANONICAL_INTEGRATION_BODY).not.toContain('## 変更タイプ');
		expect(CANONICAL_INTEGRATION_BODY).not.toContain('## Ready for Review チェックリスト');
		expect(checkSectionPresence({ ...base, body: CANONICAL_INTEGRATION_BODY }).ok).toBe(true);
	});
	it('AC2: feature lane は integrationSsotSections を渡されても現行 SSOT (feature JSON) を検証 (不変)', () => {
		const r = checkSectionPresence({
			...base,
			lane: 'feature' as const,
			body: VALID_FEATURE_BODY,
		});
		expect(r.ok).toBe(true);
		expect(r.message).toContain('PR_TEMPLATE_SECTIONS.json (SSOT)');
		// feature lane に正規統合 body を渡すと feature 用 section 欠落で fail する (観点が切り替わっていない証跡)
		expect(
			checkSectionPresence({ ...base, lane: 'feature' as const, body: CANONICAL_INTEGRATION_BODY })
				.ok,
		).toBe(false);
	});
	it('fallback: integrationSsotSections 未提供時は暫定 set (INTEGRATION_REQUIRED_SECTIONS) を維持', () => {
		const r = checkSectionPresence({
			labels: [],
			template: TEMPLATE,
			ssotSections: SSOT_SECTIONS,
			lane: 'integration' as const,
			body: CANONICAL_INTEGRATION_BODY,
		});
		// 暫定 set は feature 用 section を要求するため、正規統合 body は fallback 経路では fail する
		expect(r.ok).toBe(false);
		expect(r.message).toContain('INTEGRATION_REQUIRED_SECTIONS');
	});
});

// =====================================================================
// AC5: dependabot lane = 全 check skip 相当 (挙動不変)
// =====================================================================
describe('dependabot lane: 全 check skip 相当 (#2944 AC5)', () => {
	// 意図的に全部 violation な body を渡しても dependabot は ok:true skipped:true になる
	const broken = '（テンプレートを満たさない壊れた body）';
	const base = {
		body: broken,
		labels: [],
		template: TEMPLATE,
		ssotSections: SSOT_SECTIONS,
		lane: 'dependabot' as const,
	};
	for (const [name, fn] of [
		['section-presence', checkSectionPresence],
		['issue-reference', checkIssueReference],
		['change-type', checkChangeType],
		['customer-value', checkCustomerValue],
		['test-results', checkTestResults],
		['closing-keyword', checkClosingKeyword],
	] as const) {
		it(`${name}: dependabot は skip 相当 (ok:true skipped:true)`, () => {
			const r = fn(base);
			expect(r.ok).toBe(true);
			expect(r.skipped).toBe(true);
			expect(r.message).toContain('dependabot');
		});
	}
});

// =====================================================================
// 直交 skip: dependencies label (lane と独立)
// =====================================================================
describe('dependencies label skip (lane と直交)', () => {
	it('feature lane でも dependencies label があれば section-presence は skip', () => {
		const r = checkSectionPresence({
			body: 'broken',
			labels: ['dependencies'],
			template: TEMPLATE,
			ssotSections: SSOT_SECTIONS,
			lane: 'feature',
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
	});
});

// =====================================================================
// #3458: closing keyword 必須 gate (develop 向け feat/fix、#3423 AC1)
//   検出規約は integration-pr-body.mjs extractClosedIssues と共有 (二重実装なし、AC4)。
// =====================================================================
describe('closing-keyword gate (#3458)', () => {
	const base = {
		labels: ['type:fix'],
		template: TEMPLATE,
		ssotSections: SSOT_SECTIONS,
		lane: 'feature' as const,
	};

	/** `## 関連 Issue` section に任意行を持つ最小 body を組み立てる。 */
	const bodyWith = (issueSectionLines: string) => `## 顧客価値・目的

gate の検証用 body。

## 関連 Issue

${issueSectionLines}

## 変更タイプ

- [x] fix: バグ修正
`;

	// --- PASS: closing keyword 各形 (AC1) ---
	it('PASS: Closes #N (基本形)', () => {
		const r = checkClosingKeyword({ ...base, body: bodyWith('Closes #3458') });
		expect(r.ok).toBe(true);
		expect(r.skipped).toBeFalsy();
		expect(r.message).toContain('#3458');
	});
	it('PASS: fixes #N (小文字 + 別 keyword)', () => {
		expect(checkClosingKeyword({ ...base, body: bodyWith('fixes #123') }).ok).toBe(true);
	});
	it('PASS: Resolves: #N (コロン形)', () => {
		expect(checkClosingKeyword({ ...base, body: bodyWith('Resolves: #3458') }).ok).toBe(true);
	});
	it('PASS: closes ＃N (全角 ＃)', () => {
		expect(checkClosingKeyword({ ...base, body: bodyWith('closes ＃3458') }).ok).toBe(true);
	});
	it('PASS: list marker 付き (- closes #N)', () => {
		expect(checkClosingKeyword({ ...base, body: bodyWith('- closes #3458') }).ok).toBe(true);
	});
	it('PASS: type:feat label でも検証対象', () => {
		const r = checkClosingKeyword({
			...base,
			labels: ['type:feat'],
			body: bodyWith('Closes #3458'),
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBeFalsy();
	});

	// --- FAIL: closing keyword なし (AC2) ---
	it('FAIL: bare #N 参照のみ', () => {
		const r = checkClosingKeyword({ ...base, body: bodyWith('#3458') });
		expect(r.ok).toBe(false);
		expect(r.message).toContain('closing keyword');
	});
	it('FAIL: 関連: #N のみ', () => {
		expect(checkClosingKeyword({ ...base, body: bodyWith('関連: #3458') }).ok).toBe(false);
	});
	it('FAIL: 本文中の言及 (see closes #N) は行頭アンカーで除外 (#3444 規約共有)', () => {
		expect(
			checkClosingKeyword({ ...base, body: bodyWith('前 PR では closes #3458 と書いた') }).ok,
		).toBe(false);
	});
	it('FAIL: code fence 内の closes #N は strip される (#3444 規約共有)', () => {
		expect(checkClosingKeyword({ ...base, body: bodyWith('```\ncloses #999\n```') }).ok).toBe(
			false,
		);
	});
	it('FAIL: closing keyword が 関連 Issue section 外にあると section 限定走査で除外 (#3444 規約共有)', () => {
		const body = `## 顧客価値・目的

Closes #3458

## 関連 Issue

#3458 のみ参照

## 変更タイプ

- [x] fix: バグ修正
`;
		expect(checkClosingKeyword({ ...base, body }).ok).toBe(false);
	});

	// --- conventional-commit prefix を closing と誤認しない ---
	it('FAIL: conventional-commit title 引用 (fix: #N subject) のみでは closing と誤認しない', () => {
		const r = checkClosingKeyword({
			...base,
			body: bodyWith('fix: #3458 closing keyword gate を追加'),
		});
		expect(r.ok).toBe(false);
	});
	it('PASS: title 引用 + 正規の closes #N が併記されていれば PASS', () => {
		const r = checkClosingKeyword({
			...base,
			body: bodyWith('fix: #3458 closing keyword gate を追加\n\ncloses #3458'),
		});
		expect(r.ok).toBe(true);
	});
	it('stripConventionalCommitFixTitleLines: fix(scope): #N subject 行を除去し、Fixes: #N 説明 (正規コロン形) は残す', () => {
		const text = [
			'fix: #3458 subject あり',
			'fix(admin): #3458 scope 付き',
			'Fixes: #3458 ログインバグ',
			'fix: #3458',
			'closes #3458',
		].join('\n');
		const stripped = stripConventionalCommitFixTitleLines(text);
		expect(stripped).not.toContain('subject あり');
		expect(stripped).not.toContain('scope 付き');
		expect(stripped).toContain('Fixes: #3458 ログインバグ');
		expect(stripped).toContain('fix: #3458'); // subject なし単独行は closing 宣言として尊重
		expect(stripped).toContain('closes #3458');
	});

	// --- skip: no-issue-close 宣言 (AC3) ---
	it('SKIP: <!-- no-issue-close: 理由 --> 宣言で skip', () => {
		const r = checkClosingKeyword({
			...base,
			body: bodyWith('<!-- no-issue-close: follow-up 修正で対応 issue なし -->\n#3458 関連'),
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
		expect(r.message).toContain('follow-up 修正で対応 issue なし');
	});
	it('FAIL: no-issue-close 宣言の理由が空 (空洞化防止)', () => {
		const r = checkClosingKeyword({
			...base,
			body: bodyWith('<!-- no-issue-close: -->'),
		});
		expect(r.ok).toBe(false);
		expect(r.message).toContain('理由');
	});

	// --- skip: 対象外 lane / label ---
	it('SKIP: type:feat / type:fix 以外 (refactor) は対象外', () => {
		const r = checkClosingKeyword({
			...base,
			labels: ['type:refactor'],
			body: bodyWith('#3458 のみ'),
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
	});
	it('SKIP: integration lane (#3423 集約側が担う)', () => {
		const r = checkClosingKeyword({
			...base,
			lane: 'integration',
			body: bodyWith('#3458 のみ'),
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
	});
	it('SKIP: hotfix lane (main 直行は GitHub 直接 auto-close)', () => {
		const r = checkClosingKeyword({
			...base,
			lane: 'hotfix',
			body: bodyWith('#3458 のみ'),
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
	});
	it('SKIP: back-merge label (機械生成 PR)', () => {
		const r = checkClosingKeyword({
			...base,
			labels: ['type:fix', 'back-merge'],
			body: bodyWith('#3458 のみ'),
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
	});
	it('SKIP: dependencies label', () => {
		const r = checkClosingKeyword({
			...base,
			labels: ['type:fix', 'dependencies'],
			body: bodyWith('#3458 のみ'),
		});
		expect(r.ok).toBe(true);
		expect(r.skipped).toBe(true);
	});
	it('CLOSING_KEYWORD_TARGET_LABELS は type:feat / type:fix の 2 種', () => {
		expect([...CLOSING_KEYWORD_TARGET_LABELS]).toEqual(['type:feat', 'type:fix']);
	});
});

describe('parseArgs (#2944 CLI)', () => {
	it('空白区切りをパース', () => {
		expect(
			parseArgs(['--check', 'section-presence', '--lane', 'integration', '--body-file', '/tmp/b']),
		).toEqual({ check: 'section-presence', lane: 'integration', 'body-file': '/tmp/b' });
	});
	it('= 区切りをパース', () => {
		expect(parseArgs(['--check=issue-reference', '--lane=feature'])).toEqual({
			check: 'issue-reference',
			lane: 'feature',
		});
	});
});

// =====================================================================
// #4097: gate 空洞化の fitness function (ADR-0061)。
//
// 本 describe だけは fixture ではなく **実 template** (.github/PULL_REQUEST_TEMPLATE.md) を
// 入力にする。fixture ベースの検証は実 template が改訂されて gate が no-op に縮退しても
// 緑のままになり、実際 #2944〜#4097 の間そのまま放置された (customer-value は常時 PASS /
// test-results は常時 skip)。以後、template を「gate が効かない形」に変えたら本 test が落ちる。
// =====================================================================
describe('実 PULL_REQUEST_TEMPLATE.md に対して gate が空洞化しない (#4097 fitness)', () => {
	const realTemplate = readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), '../../../.github/PULL_REQUEST_TEMPLATE.md'),
		'utf-8',
	);
	const base = {
		labels: [] as string[],
		template: realTemplate,
		ssotSections: null,
		lane: 'feature' as const,
	};

	it('customer-value: 未記入の素の template は fail する (= field を検出できている)', () => {
		const r = checkCustomerValue({ ...base, body: realTemplate });
		expect(r.ok, 'placeholder 残存を検出できていない = gate が no-op').toBe(false);
		expect(r.message).toContain('対象ユーザー');
	});

	// 現行 template はたまたま `## ` 始まりなので、旧 no-op 実装でも上の test は通ってしまう。
	// 「template の先頭に HTML コメントを足す」= #4097 以前の形に戻す変更で gate が再び空洞化
	// しないことを、実 template + 先頭コメントの組み合わせで固定する。
	it('customer-value: 実 template の先頭に HTML コメントを足しても検出力が落ちない (#4097 再発防止)', () => {
		const withLeadingComment = `<!-- hotfix は --kind critical-fix を使う -->\n\n${realTemplate}`;
		const r = checkCustomerValue({
			...base,
			template: withLeadingComment,
			body: realTemplate,
		});
		expect(r.ok, '先頭コメントで field 抽出範囲が縮退している = #4097 の回帰').toBe(false);
		expect(r.message).toContain('対象ユーザー');
	});

	it('customer-value: 3 field すべてを抽出対象にしている', () => {
		const filled = realTemplate
			.replace(
				'**対象ユーザー**: <!-- 子供 / 親（管理者） / 運営 / システム全体 -->',
				'**対象ユーザー**: 親',
			)
			.replace(
				'**解決する課題**: <!-- ユーザーが抱えている問題、または実現したい体験を 1-2 文で -->',
				'**解決する課題**: 課題',
			)
			.replace(
				'**期待される効果**: <!-- この変更により、ユーザー体験がどう改善されるか -->',
				'**期待される効果**: 効果',
			);
		const r = checkCustomerValue({ ...base, body: filled });
		expect(r.ok).toBe(true);
		expect(r.message, '3 field 全部を見ているか').toContain('3 フィールド');
	});

	it('test-results: 実 template から結果表セクションを解決でき skip に落ちない', () => {
		expect(detectTestSectionKeyword(realTemplate)).toBe('テスト・品質セルフチェック');
		const r = checkTestResults({ ...base, body: realTemplate });
		expect(r.skipped, 'セクション未解決で skip = gate が no-op').toBeFalsy();
		expect(r.ok, '結果列 placeholder 残存を検出できていない').toBe(false);
	});

	it('change-type / issue-reference の見出し解決も実 template で成立する', () => {
		expect(detectChangeTypeHeading(realTemplate)).toBe('## 変更タイプ');
		expect(detectIssueSectionHeading(realTemplate)).toBe('## 関連 Issue');
	});
});

// =====================================================================
// #4348: 見出し / section の探索を「本文の部分一致」から「見出し行の完全一致」に是正
//
// 旧実装:
//   - section-presence: `sections.filter((s) => !body.includes(s))`
//   - test-results:     `body.indexOf(keyword)` / 見つからなければ **skip (= pass)**
//
// いずれも HTML コメント / code block / 本文中の言及 / 前方一致する別見出しを
// 「見出しがある」と誤判定した。実 corpus で観測した壊れ方は本 describe の各 it に対応する。
// =====================================================================
describe('#4348: 見出し探索は行の完全一致 + 見つからなければ fail', () => {
	const SECTIONS = ['## 顧客価値・目的', '## テスト・品質セルフチェック'];
	const base = {
		labels: [],
		template: readFileSync(
			resolve(dirname(fileURLToPath(import.meta.url)), '../../../.github/PULL_REQUEST_TEMPLATE.md'),
			'utf8',
		),
		ssotSections: SECTIONS,
		lane: 'feature' as const,
	};
	const REAL_BODY = ['## 顧客価値・目的', '', '本文', '', '## テスト・品質セルフチェック', ''].join(
		'\n',
	);

	it('section-presence: HTML コメント内の見出し文字列では「存在する」と判定しない', () => {
		const body = [
			'## 顧客価値・目的',
			'',
			'<!-- 次に ## テスト・品質セルフチェック を書く -->',
			'',
		].join('\n');
		const r = checkSectionPresence({ ...base, body });
		expect(r.ok, 'コメント内の文字列で section-presence が緑になっている').toBe(false);
		expect(r.message).toContain('## テスト・品質セルフチェック');
	});

	it('section-presence: code block 内の引用でも「存在する」と判定しない', () => {
		const body = [
			'## 顧客価値・目的',
			'',
			'```markdown',
			'## テスト・品質セルフチェック',
			'```',
			'',
		].join('\n');
		expect(checkSectionPresence({ ...base, body }).ok).toBe(false);
	});

	it('section-presence: 前方一致する別見出し (## X の補足) では満たさない', () => {
		const body = ['## 顧客価値・目的', '', '## テスト・品質セルフチェック の補足', ''].join('\n');
		expect(checkSectionPresence({ ...base, body }).ok).toBe(false);
	});

	it('section-presence: 見出しが実在すれば従来どおり PASS (回帰なし)', () => {
		expect(checkSectionPresence({ ...base, body: REAL_BODY }).ok).toBe(true);
	});

	it('test-results: section 不在は skip でなく fail (検査できなかったものを pass にしない)', () => {
		const r = checkTestResults({ ...base, body: '## 顧客価値・目的\n\n本文だけ\n' });
		expect(r.skipped, 'skip に倒れると gate が no-op になる').toBeFalsy();
		expect(r.ok).toBe(false);
	});

	it('test-results: 本文中の言及が見出しより前にあっても本物の表を読む (#4325 / #4311 実例)', () => {
		// 実 merged PR で観測: AC 表のセルに「下記「テスト・品質セルフチェック」参照」があり、
		// 旧実装はそのセルから section を切り出して表 0 行 → skip していた。
		const body = [
			'## 顧客価値・目的',
			'',
			'| AC1 | 内容 | 手段 | 下記「テスト・品質セルフチェック」参照 |',
			'',
			'## テスト・品質セルフチェック',
			'',
			'| テスト種別 | コマンド | 結果 |',
			'|---|---|---|',
			'| pre-ready | `npm run pre-ready` | |',
			'',
		].join('\n');
		const r = checkTestResults({ ...base, body });
		expect(r.skipped).toBeFalsy();
		expect(r.ok, '結果列が空の行を検出できていない').toBe(false);
	});

	it('test-results: 結果列が HTML コメントだけの行は未記入として検出する (#4278 実例)', () => {
		const body = [
			'## テスト・品質セルフチェック',
			'',
			'| テスト種別 | コマンド | 結果 |',
			'|---|---|---|',
			'| pre-ready | `npm run pre-ready` | <!-- 実行後に記入 --> |',
			'',
		].join('\n');
		expect(checkTestResults({ ...base, body }).ok).toBe(false);
	});

	it('test-results: integration lane は統合 PR template のエビデンス表を読む (feature 見出しを探さない)', () => {
		const body = [
			'## マージ判定エビデンス表',
			'',
			'| 含有 PR | 領域 | テスト | 結果 |',
			'|---|---|---|---|',
			'| #1 | admin | unit×3 | pass |',
			'',
		].join('\n');
		const r = checkTestResults({ ...base, lane: 'integration', body });
		expect(r.skipped, 'feature template の見出しを探して skip していた (#4348)').toBeFalsy();
		expect(r.ok).toBe(true);
	});
});
