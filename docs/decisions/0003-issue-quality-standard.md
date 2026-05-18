# 0003. Issue 起票・クローズ品質（根本原因 + 構造的解決）

- **Status**: Accepted
- **Date**: 2026-04-20（2026-05-07 §4 内部 refactor exempt 追記、2026-05-08 §4.5 screenshot-check 連動 #2017）
- **Related Issue**: #1262 / #1265 / **#1985 / #1986（§4 追記） / #2017（§4.5 screenshot-check 連動）**
- **統合元**: 旧 ADR-0010 + ADR-0018（本 PR で削除、詳細は git 履歴）

## コンテキスト

> 旧 ADR-0010（Issue クローズ品質基準）と ADR-0018（根本原因特定 + 構造的解決）を統合。ADR 10 枠再構成（#1262）の一環。

ダイアログ管理の不具合が **4 回** 繰り返された（#543 → #611 → #633 → #671）。同様にスタンプカードでも #607 の修正が不完全で #673 のデグレを生んだ。

**根本原因**: Issue 起票者が症状の記述と曖昧な提案に終始し、根本原因の特定と構造的な解決策の設計を怠った。「ガード条件追加でも良い」「ステートマシンまたはキュー」のような選択肢を併記すると、開発チームは必ず工数の少ない方を選ぶ。また、Issue クローズ時に AC が部分的にしか満たされていない `closes` が頻発した。

**§4 追記の追加コンテキスト（#1985 / #1986、2026-05-07）**: ADR-0045 (terms.ts SSOT 2 階層化) Phase 2 で発生した「PLAN リテラル → `PLAN_GATE_LABELS` template 経由化」refactor PR (Wave 3、#1980-1984) で、`design-doc-check` workflow が `src/routes/` 変更 → `docs/design/` 同期必須ルール (本 ADR §1) により一律 fail し、各 PR で `docs/design/06-UI設計書.md §10.7` への形式的 1 行追記で乗り切る運用が頻発。Wave 4-7 (api/v1/admin / Phase 7 H1-H6 など 30+ PR) で再発する前に「機能仕様変化なし refactor」の exempt を構造化する必要が生じた。

## 決定

### 1. Issue 起票時の必須要件

- **根本原因の特定**: 症状ではなく原因を明記。同一領域の過去 Issue を必ず参照し、過去の修正がなぜ不十分だったかを記載
- **構造的解決策の提示**: 再発問題は **スクラップ & ビルド**（再設計・再実装）を前提とする。パッチの上にパッチを重ねることを禁止
- **解決策は 1 つに絞る**: 「A または B」の曖昧な併記は禁止。どちらが正しいかを Issue 起票者が判断
- **境界条件の列挙**: Acceptance Criteria に全ての境界条件を列挙

### 2. 禁止パターン

| パターン | あるべき姿 |
|---------|----------|
| 解決策の併記（A または B） | 根拠付きで 1 つに絞る |
| 症状だけの記述 | 根本原因を明記 |
| 対症療法の許容 | 構造的解決（スクラップ & ビルド） |
| 過去 Issue の無視 | 同一領域 Issue を必ず参照 |

### 3. Issue クローズ時の規則

- PR で `closes #N` を使用する場合、Issue の AC を全て満たしていること
- 部分実装の場合は `closes` ではなく `ref #N` を使い、未達 AC は別 Issue に切り出してからクローズ

### 4. 設計書同期の例外: 内部 refactor exempt（#1985 / #1986、2026-05-07 追記）

ADR-0001（設計書 SSOT）は維持しつつ、**「機能仕様変化なしの内部 refactor」は設計書同期義務の例外**とする。例外条件と運用は以下に明文化する。

#### 4.1 内部 refactor の判定基準（4 条件すべて満たす）

1. **機能仕様変化なし**: UI / API / DB スキーマの外形変化なし。エンドユーザーー観点で挙動が同一
2. **atom と compound 階層化**: ADR-0045 の `terms.ts → labels.ts → 利用箇所` 階層内での参照経路書換
3. **リテラル置換のみ**: 例 `'スタンダードプラン以上で...'` を `${PLAN_GATE_LABELS.standardOrAboveFor(...)}` 経由に置換（同等文字列を出力）
4. **diff パターン**: import 追加 + literal removal のみ。新規ロジック追加・分岐追加なし

4 条件のうち **1 つでも逸脱**するなら通常の設計書同期義務（§1-§3）が適用される。判断に迷う場合は同期する側に倒す（ADR-0001 SSOT 原則優先）。

#### 4.2 exempt ラベルと workflow exempt

- **ラベル**: `refactor:internal-no-doc-impact`（色 #BFD4F2、#1985 で作成済）
- **workflow**: `.github/workflows/pr-quality-gate.yml` の `design-doc-check` job が PR labels を取得し、`scripts/check-design-doc-sync.mjs` の `checkDesignDocSync({ files, labels })` 純粋関数で判定
- **判定優先順位** (workflow 内、上から評価):
  1. `src/routes/` 変更なし → skip
  2. `docs/design/` 同期あり → pass
  3. 全ファイルが既存 file-pattern exempt (CLAUDE.md / scripts/ / docs/ / infra/ / .github/ / site/) → skip
  4. **`refactor:internal-no-doc-impact` ラベル付与 → skip（本 §4 の構造化、#1985）**
  5. それ以外 → fail

#### 4.3 ラベル付与・確認の責任

- **PR 作成者の申告責任**: §4.1 の 4 条件すべて満たすことを自己確認のうえラベル付与。AC 検証マップ (ADR-0004) に「§4.1 4 条件充足の根拠」を 1 行記載
- **Reviewer の確認責任**: PR diff を実際に開き「import 追加 + literal removal のみ」「機能仕様変化なし」を目視確認。逸脱を検出したらラベル除去を要請（design-doc-check が再走して fail → 設計書同期を要求）
- **悪用防止**: 機能変更を含む PR にラベル付与した場合、ADR-0006 (Safety Assertion Erosion Ban) §2 「assertion 弱体化」と同等の重大違反として扱う（PR 作成者・reviewer 双方に責任）

#### 4.4 既存 ADR との関係性

| ADR | 関係 | 本 §4 における扱い |
|-----|------|-----------------|
| ADR-0001（設計書 SSOT） | 上位原則 | SSOT 原則は維持。本 §4 は「機能仕様変化なし」という限定条件下での例外規定 |
| ADR-0010（Pre-PMF scope） | 整合 | 過剰防衛禁止原則と整合。「機能変化ゼロ refactor で都度 docs/design/ を 1 行更新」は ADR-0010 §4 「破棄する過剰設計」と同型の不要工数 |
| ADR-0045（terms.ts SSOT 2 階層化） | 代表ユースケース | Phase 2 (#1925-1940) は §4.1 4 条件すべて満たす典型例。Phase 3 (LP) / Phase 4 (法務) も同様に exempt 対象 |
| ADR-0006（Safety Assertion Erosion Ban） | 違反時の制裁基準 | ラベル悪用は assertion 弱体化と同等の重大違反 |

#### 4.5 screenshot-check 連動（atom 化 refactor は SS 不要、#2017、2026-05-08 追記）

§4 の `refactor:internal-no-doc-impact` ラベルは、screenshot-check workflow にも同条件で適用する。

**背景**: ADR-0045 Phase 2-3 の atom 化 refactor で `site/shared-labels.js` (LP 用 generated 配信ファイル) や `.svelte` ファイルの **literal → template 経由参照書換** が発生する。これらは visual diff ゼロ (md5 一致 / 画面表示は同一文字列) でも `pr-quality-gate.yml` の `screenshot-check` job が `^site/` / `\.svelte$` パターンに引っ掛けて UI PR 扱いし、SS 4 スロット添付を要求する。Wave 5-8 で 5+ PR (PR-1990 / 1991 / 2011) が同問題に遭遇し、毎回 SS 補完 Agent 工数を消費していた。

**判定優先順位** (`pr-quality-gate.yml` 内、上から評価):

1. UI 関連ファイル変更なし → skip
2. PR body に「該当なし（refactor / docs / chore）」「UI 変更なし」明示記述 → skip
3. **`refactor:internal-no-doc-impact` ラベル付与 → skip（本 §4.5、#2017）**
4. それ以外 → 通常の SS 必須判定 (legacy `screenshot-check` job + `screenshot-quality-check` job の before/after / DOM 検証)

**実装**: `scripts/check-pr-screenshot.mjs` の `hasInternalRefactorLabel()` 純粋関数 + `pr-quality-gate.yml` の `PR_LABELS` env 注入 (#2017 PR で導入、PR-1987 と同パターン)。

**ラベル付与責任**: §4.3 と同等。§4.1 の 4 条件 (機能仕様変化なし / atom-compound 階層化 / リテラル置換のみ / import 追加 + literal removal の diff) すべて満たす場合に限り PR 作成者が自己申告で付与。Reviewer は diff 目視で逸脱を検出したらラベル除去を要請。悪用は ADR-0006 §2 「assertion 弱体化」と同等の重大違反。

**md5 一致判定 (Issue #2017 AC3) を採用しなかった理由**: 「shared-labels.js のみ変更 + 文字列 md5 一致」は技術的に pre/post 状態の両取得が必要で workflow が肥大化する。一方、Wave 5-8 で実際に observed された exempt 対象 PR (PR-1990 / 1991 / 2011) は `.svelte` 変更も含む広範囲で、`shared-labels.js のみ` という絞込みでは捕捉できない。§4.1 の 4 条件をラベル付与判断で運用上担保する方が現実のユースケースに整合する (YAGNI 原則)。

## 結果

- PR レビューで AC 充足を確認するチェックポイントが追加される
- 「closes したが AC 未達」が構造的に検出される
- Issue 起票に時間がかかるが、手戻り（再発 → 再起票 → 再実装）のコストが大幅に減少
- **§4 追記の効果（#1985 / #1986）**: ADR-0045 Phase 2-4 の 30+ refactor PR で形式的 docs 追記が不要となり、PR スループットが改善。`design-doc-check` workflow は本来の目的（機能変更時の SSOT 同期保証）に集中可能

## 関連

- ADR-0001（設計書 SSOT）— 本 ADR §4 の上位原則（SSOT 維持、限定例外を §4 で規定）
- ADR-0004（レビュー & AC 検証品質）— AC 検証を CI で機械強制
- ADR-0006（Safety Assertion Erosion Ban）— §4.3 ラベル悪用時の制裁基準
- ADR-0010（Pre-PMF スコープ判断）— 起票自体のバイアス是正、過剰防衛禁止原則と整合
- ADR-0045（terms.ts SSOT 2 階層化）— §4 内部 refactor の代表ユースケース
- `scripts/check-design-doc-sync.mjs` / `.github/workflows/pr-quality-gate.yml`（§4.2 workflow 実装、PR-1987 で導入）
- `scripts/check-pr-screenshot.mjs` (`hasInternalRefactorLabel()`) / `.github/workflows/pr-quality-gate.yml` `screenshot-check` + `screenshot-quality-check` jobs（§4.5 workflow 実装、#2017 PR で導入）
