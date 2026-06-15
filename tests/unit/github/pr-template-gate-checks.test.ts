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
import { describe, expect, it } from 'vitest';
import {
	checkChangeType,
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
	// customer-value の placeholder 検出は「1 番目の ## section が顧客価値 section」前提で動く。
	// 現行 PULL_REQUEST_TEMPLATE.md は先頭コメント (<!-- ... -->) で始まるため、検出ロジックは
	// 先頭コメントを「1 番目の section」とみなし inline field 0 件 → 常に PASS する (現行の no-op 挙動)。
	// #2944 は lane-aware 化のみで検証ロジックを一切変えないため、この pre-existing 挙動を固定する (AC4)。
	it('customer-value: 先頭コメント template では field 0 件 → placeholder でも PASS (現行 no-op 挙動の固定、AC4)', () => {
		const r = checkCustomerValue({
			...base,
			body: VALID_FEATURE_BODY.replace(
				'**対象ユーザー**: システム全体（開発フロー）',
				'**対象ユーザー**: <!-- 子供 / 親 -->',
			),
		});
		// 先頭コメント template (現行 PR template と同型) では検出されず PASS (production と byte 一致)
		expect(r.ok).toBe(true);
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

### テスト実行結果

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
			/### テスト実行結果[\s\S]*?(?=## レビュー依頼事項)/,
			'### テスト実行結果\n\n（表なし）\n\n',
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
