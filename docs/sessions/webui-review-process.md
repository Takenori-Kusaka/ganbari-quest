# WebUI レビュー & 改善プロセス定義書（がんばりクエスト適合版）

| 項目 | 内容 |
|------|------|
| 版数 | 1.0 |
| 作成者 | 日下武紀 |
| 関連 Issue | #2936 |
| 関連 ADR | ADR-0003（対症療法禁止）/ ADR-0010（Pre-PMF scope）/ ADR-0045（terms SSOT）/ ADR-0053（pixelmatch visual regression）/ ADR-0056（self-report 単独信頼禁止） |

> **位置づけ**: WebUI レビューを「特定画面の場当たり修正」から「設計・実装モデルの継続改善プロセス」に転換するための SSOT。本ファイルは本プロダクト（SvelteKit 2 + Svelte 5 + Ark UI + 3 層トークン + CI gate 群）の実ツールに即して定義する。学術・産業界の体系（Nielsen ヒューリスティック評価 / ISO 9241-210 HCD / Atomic Design / WCAG 2.2 / Google ICSE 2023 設計レビュー研究）を理論的下敷きとし、要点のみ引用する。

---

## 1. 設計背景

> **この設計書がないと何が困るか** — 本プロダクトで現に起きている実害を起点に記述する。

### 1.1 解決すべき課題

WebUI レビューが**刹那的**（特定画面を目視して「ここを直す」で完結）に運用されると、次の連鎖が起きる。

- **共通化ポリシーに反した実装が生まれる**: ある画面で見つかった配置不全・empty state の独自実装・用語の直書きを、その画面だけで修正すると、`$lib/ui/primitives` / 3 層トークン / `labels.ts` を経由しない「画面固有の対症療法」がコードベースに沈殿する。
- **同種問題が別画面で再発する**: 還元先（コンポーネント API / トークン / ガイドライン）に修正が戻らないため、同じ UX 破綻が別画面で繰り返し発生し、その都度リファクタリングが必要になる。
- **レビューの再現性が低い**: 「誰が見るか」「何を見るか」が定義されていないと、指摘内容が評価者ごとにばらつき、品質の一貫性が担保できない。

過去には、画面固有 FAB の乱立を `Menu` primitive へ集約する横断リファクタリング（DESIGN.md §10「画面あたり FAB は最大 1 個」）、独自 empty state の `UnifiedEmptyState` への統合（DESIGN.md §5）、用語直書きの `terms.ts` / `labels.ts` SSOT への巻き戻し（ADR-0045）が、いずれも「刹那的レビューで沈殿した負債の事後回収」として発生している。本プロセスはこの事後回収を**レビュー時点で前倒し**するためのものである。

### 1.2 本プロダクトのデザインシステム前提

本 repo は、属人的レビューから脱却するための前提（コンポーネントライブラリ + デザイントークン + ドキュメント + a11y 内包 + 機械 gate）を既に備えている。一般的なデザインシステム成熟度モデルでいう **Systematic 段階**に相当する。

| 前提資産 | 本 repo の実体 |
|---|---|
| コンポーネントライブラリ | `src/lib/ui/primitives/`（Ark UI ラッパ、DESIGN.md §5、再実装禁止） |
| デザイントークン | `app.css` の 3 層トークン（Base → Semantic → Component、DESIGN.md §2 / §4） |
| 用語 SSOT | `terms.ts`（atom）/ `labels.ts`（compound）の 2 階層（ADR-0045） |
| ドキュメント | `docs/DESIGN.md`（SSOT）/ Storybook story |
| a11y 内包 | `@axe-core/playwright` の CI gate（`.github/workflows/ci.yml` `a11y` job） |
| 機械 gate | biome / svelte-check / pixelmatch visual regression 3 層 / Storybook test-runner / pre-ready 全 step（一覧 SSOT は `npm run pre-ready -- --help`） |

したがって本プロセスの目的は「デザインシステムを新規に整備する」ことではなく、**既にある資産を維持・成熟させ、レビューで見つけた問題を必ずその資産へ還元する**ことにある。

### 1.3 関連ペルソナ

| ペルソナ | 本プロセスとの関係 |
|---------|--------------|
| Dev（実装担当） | UI 系 PR で発見した問題を A〜D に仕分け、還元先まで実装する主体 |
| QM / QA（per-PR レビュー） | 仕分けの妥当性（B/C/D を A で済ませていないか）を判定する |
| 外部品質監査チーム | develop → main 統合前に CUJ を横断し、UX / a11y 観点で体験品質を検査する（`audit-team.md`） |

---

## 2. 設計原則

> **UI レビューを設計・実装するときに守る基準**。実装者が「この指摘をどう扱うべきか」を判断する SSOT。

1. **レビュー = モデル改善（最重要）** — レビューの本質は個々の画面の見た目を直すことではない。発見した問題を**一段抽象度を上げて**コンポーネント API / 配置アルゴリズム / トークン / ガイドラインに還元し、同種問題の再発を構造的に止めることにある。「このページのここが悪い」で記録を止めず、「どの層のどの資産に起因するか」まで特定する。
2. **対症療法禁止（ADR-0003 の UI 特化）** — B（コンポーネント設計）/ C（配置・振る舞いアルゴリズム）/ D（ガイドライン欠落）に起因する問題を、A（画面固有のその場修正）で済ませてはならない。根本原因への還元を伴わない UI 修正は ADR-0003 の対症療法禁止に違反する。
3. **差分検出 = 機械 / 差分承認 = 人間** — 視覚回帰・幾何制約・a11y・機能はすべて機械が客観判定する。一方、「検出された変化が今回の意図どおりか」の承認と、「問題をどの層に還元するか」の設計判断は人間が担う。この 2 段を混同しない。
4. **既存資産の再利用（重複新設禁止）** — 新しいチェック観点・評価手順が必要になったら、まず既存の skill / CI gate / DESIGN.md ルールで賄えないかを確認する。`docs/CLAUDE.md`「使い捨てスクリプト禁止」（#1442）と同型に、レビュー観点も既存 SSOT へ追補することを優先する。
5. **Pre-PMF 整合（ADR-0010）** — レビュー自動化の各層は顧客品質の構造的担保（Bucket A）。ただし非 critical flow（最初の 5 人が触らない admin 詳細など）への過剰適用は避ける。重い full-matrix 検査でなく critical CUJ に焦点を当てる。

---

## 3. 4 層自動化モデル（本 repo の実ツール）

UI レビューの「自動化」は層ごとに意味が異なる。各層で**機械が判定する範囲**と**人間が判断する範囲**を明確にする。本 repo の実ツールにマッピングして定義する。

### 3.1 Layer 1：アクセシビリティ自動検査（導入済み）

| 項目 | 内容 |
|---|---|
| ツール | `@axe-core/playwright`（`.github/workflows/ci.yml` `a11y` job、`tests/e2e/a11y-critical-cuj.spec.ts`） |
| 性質 | 完全機械判定（WCAG 2.2 AA が判定基準、主観性なし） |
| ゲート | critical / serious 違反 0 件。既知違反は `tests/e2e/a11y-baseline.json` に rule id 単位で pin（silent cap 禁止） |

`@axe-core/playwright` は Deque 公式で、Playwright `Page` を直接受ける `AxeBuilder` により inline inject 不要（ADR インベントリ §OSS 採用記録）。本層は既に CI gate として稼働しているため、本プロセスでは**新規導入でなく既存 gate の位置づけ**として扱う。Pre-PMF（ADR-0010）に従い重い full-matrix でなく a11y-critical-cuj 1 本に絞る。

### 3.2 Layer 2：幾何学的レイアウトアサーション（既存パターンを層として明示）

| 項目 | 内容 |
|---|---|
| ツール | Playwright `locator.boundingBox()` + viewport 制約 assertion |
| 性質 | 仕様を座標・矩形制約に変換した客観テスト（制約を明文化すれば主観性なし） |
| 既存例 | `tests/e2e/page-guide-layout-invariant.spec.ts`（バブルが viewport 内に完全収容されるか / target との重なりがないかを全 step × 2 viewport で検証） |

「ツールチップ・popover が見切れる / 重なる」という配置不全は、「bounding box が viewport 内に収まるか」「アンカー要素との矩形交差がないか」という幾何制約に変換でき、機械判定できる。本 repo には既に viewport-containment 検証が存在するため、Layer 2 は**ゼロからの新設ではなく、配置系コンポーネント検証の標準層として明示・拡張する**位置づけとする。新規に floating 系（tooltip / popover / dropdown）の配置不全を直したときは、本層に geometry assertion を追加する（§4 C サイクル）。

> **本プロダクトでの選定（配置エンジン）**: 原典は配置エンジンとして Floating UI の単体導入を挙げるが、本 repo の primitives は Ark UI ラッパであり、DESIGN.md §5 / §9「プリミティブ再実装禁止」に抵触する。本 repo では **Ark UI 内蔵の positioning 設定**（`Menu` / `OverflowMenu` / `Select` の `positioning={{ placement, sameWidth }}`、内部実装は Floating UI）を配置の SSOT とし、その正しさを **Layer 2 の geometry assertion で機械検証する**方式を採る。tutorial / page-guide のように Ark UI 配下にない overlay は driver.js 等の collision-aware positioning に委譲し、同じく Layer 2 で検証する。

### 3.3 Layer 3：ビジュアル回帰テスト（pixelmatch + Storybook）

| 項目 | 内容 |
|---|---|
| ツール | pixelmatch visual regression 3 層（ADR-0053）+ Storybook test-runner（play 関数、CX-DoR #8） |
| 性質 | 「意図しない変化の検出」は機械判定 / 「意図された変化の承認」は人間 |

VRT の pass/fail は 2 段に分離する。

1. **機械判定ゲート**: pixelmatch のピクセル差分が閾値（LP は per-image diff > 10%）を超えたら fail（人間の判断不要）。
2. **変化の承認**: 検出差分が今回の仕様変更どおりか、レビュアーが確認し、意図的なら baseline を更新する（`node scripts/check-lp-visual-regression.mjs --update-baseline` + git commit）。

pixelmatch 3 層の対象（`docs/CLAUDE.md`「visual regression 3 層」）:

| 層 | baseline dir | 対象 | 段階 |
|---|---|---|---|
| LP | `scripts/lp-screenshot-baseline/` | LP 全 SS（mobile + desktop） | hard-fail（diff > 10%） |
| child home | `scripts/child-home-baseline/` | child home 4 mode + battle | warn |
| app | `scripts/app-screenshot-baseline/` | baby home + admin/activities + admin/checklists | warn |

baseline 更新フロー・triage 手順は [runbooks/lp-visual-regression-baseline.md](../runbooks/lp-visual-regression-baseline.md) に集約する。
コンポーネント単位の操作回帰（クリック → callback / disabled / role / aria）は Storybook story の play 関数（`npm run test:storybook`、CX-DoR #8）で検証する。

> **本プロダクトでの選定（VRT）**: 原典は Story 単位 VRT として Chromatic を挙げるが、本 repo は外部 SaaS への依存を避ける Pre-PMF 方針（ADR-0010）のもと、OSS 比較（ADR-0053、6 件比較）を経て **pixelmatch を採用済み**である。「差分検出 = 機械 / 差分承認 = 人間（baseline 更新 + git commit）」という 2 段構造は原典どおり維持し、既存 runbook に接続する。

### 3.4 Layer 4：機能・インタラクションテスト

| 項目 | 内容 |
|---|---|
| ツール | Playwright E2E / Vitest |
| 性質 | 完全機械判定 |

クリック・フォーカス順・aria 属性・ナビゲーション・状態遷移は E2E / unit で機械判定する。CUJ（Critical User Journey）の goal 完遂検証（`tests/CLAUDE.md` CX-DoR）は本層が担う。ただし「動くが分かりにくい」UX 破綻は本層では捕捉できないため、§5 の cognitive-walkthrough で補完する。

### 3.5 ゲートポリシー（PR 時の自動実行）

```
PR 作成
  │
  ├── [Layer 1] @axe-core/playwright（a11y job）
  │      → critical / serious 違反 1 件で fail
  │
  ├── [Layer 2] Playwright geometry assertion
  │      → viewport overflow / overlap 制約を機械判定
  │
  ├── [Layer 3] pixelmatch VRT + Storybook play
  │      → 差分検出: 機械. 承認: レビュアーが baseline 更新で意図反映
  │
  └── [Layer 4] Playwright E2E / Vitest
         → 機能・インタラクション・CUJ goal 完遂
```

- Layer 1 / 2 / 4: 違反 1 件で merge 不可（完全機械判定）。
- Layer 3: 差分なし → 自動通過。差分あり → レビュアーが意図を確認し baseline を更新（または修正）。

---

## 4. 課題一般化フロー（Phase 4：最重要）

レビューまたは CI 失敗で問題が見つかった後、それを**どの抽象度に還元するか**を A〜D で仕分ける。このフローがなければレビューは場当たり修正に留まる。本 repo の還元先を明示する。

```
問題発見
    │
    ├── [A] 特定の画面固有の問題か？
    │       → Yes: その画面を直して PR に反映（還元不要）
    │       → No: 下へ
    │
    ├── [B] コンポーネントの設計問題か？
    │       → Yes: primitives の API / props を修正（DESIGN.md §5）
    │              + Storybook story（play 含む）を追加
    │              + 3 層トークン（app.css）の見直しが必要なら更新
    │
    ├── [C] 配置・振る舞いアルゴリズムの問題か？
    │       → Yes: Ark UI positioning 設定 or 共通ロジックを修正
    │              + Layer 2 の geometry assertion を追加
    │
    └── [D] ガイドライン・チェックリストの欠落か？
            → Yes: DESIGN.md / CX-DoR / qa-checklist-ui-quality.md / 該当 skill に観点を追補
                   + 次回レビューから適用
```

| 仕分け | 還元先（本 repo の実体） | 同 PR で行うこと |
|---|---|---|
| **A** 画面固有 | 当該 `*.svelte` / route | 画面修正のみ |
| **B** コンポーネント設計 | `src/lib/ui/primitives/` の API / props + `app.css` 3 層トークン | primitive 修正 + Storybook story（play）追加 + 必要ならトークン更新 |
| **C** 配置・振る舞いアルゴリズム | Ark UI `positioning` 設定 / 共通ロジック / overlay positioning | ロジック修正 + Layer 2 geometry assertion 追加 |
| **D** ガイドライン欠落 | `docs/DESIGN.md` / `tests/CLAUDE.md` CX-DoR / `qa-checklist-ui-quality.md` / 該当 skill | 観点追補 + 本 PR or 後続 issue 起票 |

**仕分け運用**: B / C / D に該当する問題を A で済ませることは禁止（原則 2、ADR-0003）。B / C は同 PR で還元先まで実装する（段階的リリース禁止、dev-session.md）。D の追補は本 PR で行うか、scope が大きい場合は 後続 issue を起票したうえで Done とする。

---

## 5. 役割分担

| 役割 | 担当 | レビュー段階 |
|---|---|---|
| **A〜D 仕分けの実施 + 還元先実装** | Dev | UI 系 fix / design PR の作成時。仕分け結果を PR body に記載する（dev-session.md §「必ず守ること」） |
| **仕分けの妥当性レビュー** | QM / QA | per-PR review（`qa-session.md` Tier 2 手順 1〜2）。B/C/D を A で済ませていないか、還元先実装が同 PR にあるかを判定する |
| **CUJ 横断 UX / a11y レビュー** | 外部品質監査チーム | develop → main 統合前（`audit-team.md` §3.1「ユーザビリティ・a11y」チーム）。CUJ を仮ユーザ persona で通し、NN/G 観点 + WCAG 2.2 AA を検査する |

### 5.1 「動くが分かりにくい」UX 破綻の捕捉（cognitive-walkthrough）

機能 E2E（Layer 4）が緑でも、「分離ボタン乱立 / 謎用語 / 独自 UI / dead-end」などの UX 破綻は捕捉できない。customer-facing PR の Ready 化前 / 顧客レビュー前 / 新規 critical flow 設計時には、[cognitive-walkthrough skill](../../.claude/skills/cognitive-walkthrough/SKILL.md) で初見ユーザー persona を演じ、NN/G の 4 質問（Q1〜Q4）を各ステップに問う。本 skill は customer-voice skill を walkthrough 4 質問へ specialize したもので、`tests/CLAUDE.md` CX-DoR 条件 2 を担当する。

---

## 6. 既存資産対応表（原典概念 × 本 repo の実体）

原典（学術・産業界の手法）の各概念を、本 repo の既存 skill / CI gate / ガイドラインへマッピングする。新規複製はせず、既存資産で賄えない観点のみ追補する（原則 4）。

| 原典の概念 | 本 repo の実体 |
|---|---|
| ヒューリスティック評価（Nielsen 10 原則） | [cognitive-walkthrough skill](../../.claude/skills/cognitive-walkthrough/SKILL.md) の NN/G 4 質問 / [brand-check skill](../../.claude/skills/brand-check/SKILL.md)（DESIGN.md §9 禁忌照合） |
| コグニティブウォークスルー（タスク単位 inspection） | [cognitive-walkthrough skill](../../.claude/skills/cognitive-walkthrough/SKILL.md)（critical flow を step 走査） |
| ユーザビリティテスト（実ユーザー観点） | [customer-voice skill](../../.claude/skills/customer-voice/SKILL.md)（3 ペルソナ × 評価軸） |
| 年齢帯別の使用性 | [age-mode-check skill](../../.claude/skills/age-mode-check/SKILL.md)（5 age mode の fontScale / tapSize） |
| WCAG a11y 自動検査 | `@axe-core/playwright`（ci.yml `a11y` job）= Layer 1 |
| 幾何レイアウト制約 | Playwright `boundingBox()` geometry assertion = Layer 2 |
| ビジュアル回帰テスト | pixelmatch 3 層（ADR-0053）+ Storybook play（CX-DoR #8）= Layer 3 |
| 機能・インタラクションテスト | Playwright E2E / Vitest（CUJ goal 完遂）= Layer 4 |
| Atomic Design（システムを育てる） | DESIGN.md §5 primitives + §2/§4 3 層トークン + §6 用語 SSOT への還元（§4 B サイクル） |
| デザインクリティーク（批評→根拠→提案の 3 部） | `qa-session.md` 手順 2 の「気になった点だけ具体記述」+ PR body レビュー依頼事項 |
| SmartHR 使用性チェックリスト | `tests/CLAUDE.md` CX-DoR 条件群 + `qa-checklist-ui-quality.md`（10 項目）+ DESIGN.md §9 禁忌（既存と対応づけ、不足観点のみ追補） |
| 情報設計レビュー（Phase 1、OOUI 成果物） | 新規画面 / EPIC 級のみ適用。既存 skill で代替できない場合に Issue の設計セクションで概念モデル・ナビ整合を確認 |
| 定期システム監査（Phase 5） | ADR 月 1 棚卸（`docs/CLAUDE.md`）+ codebase-map 4 半期 retrospective + visual regression 3 層の baseline 維持 |

---

## 参考文献

| 資料 | 参照内容 |
|---|---|
| [Nielsen's 10 Usability Heuristics — NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/) | ヒューリスティック評価原典 |
| [Cognitive walkthroughs — ScienceDirect](https://www.sciencedirect.com/science/article/pii/002073739290039N) | コグニティブウォークスルー原典 |
| [ISO 9241-210:2019](https://www.iso.org/standard/77520.html) | 人間中心設計ライフサイクル |
| [WCAG 2 Overview — W3C WAI](https://www.w3.org/WAI/standards-guidelines/wcag/) | Web アクセシビリティ基準 |
| [Atomic Design — Brad Frost](https://atomicdesign.bradfrost.com) | UI システム設計方法論 |
| [Improving Design Reviews at Google — research.google](https://research.google/pubs/improving-design-reviews-at-google/) | 構造化レビューの効果 |
| [axe-core — Deque](https://www.deque.com/axe/axe-core/) | a11y 自動検査エンジン |
