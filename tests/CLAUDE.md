# tests/ — テスト品質ルール

**SSOT**: ADR-0005（テスト品質 ratchet）/ ADR-0006（assertion 弱体化禁止）

テスト品質劣化は許容しない。カバレッジ閾値引き下げ・テスト回避は CI 自動拒否。

## テスト環境セットアップ (#2476)

新規 contributor / AI 補佐は **必ず以下 2 ステップを実行** してからテストを起動する。**`npm ci` 単独では `tests/unit/infra/` と `tests/unit/marketplace/` 系テストが Cannot find module で fail する**:

```bash
npm ci                  # root 依存 install
cd infra && npm ci      # infra 配下も install (必須)
cd ..
```

`prepare` script (root `package.json`) が 2 ステップ目を自動実行するが、`prepare` の各ステップは `||` 経由で warning を出すだけで silent fail する設計のため、**手動確認推奨**:

```bash
ls node_modules/valibot/                    # marketplace schemas で必要
ls infra/node_modules/aws-cdk-lib/          # tests/unit/infra/ で必要
ls node_modules/canvas-confetti/            # tests/unit/features/reward-celebration で必要
```

### 「Cannot find module 'XXX'」が出たら

| エラー | 原因 | 対処 |
|---|---|---|
| `Cannot find module 'valibot'` (`tests/unit/marketplace/schemas/*`) | root `node_modules/` 不整合 | `npm ci` または `rm -rf node_modules && npm install` |
| `Cannot find module 'aws-cdk-lib'` (`tests/unit/infra/multi-lambda-cdk.test.ts`) | `infra/node_modules/` 未 install | `cd infra && npm ci` を手動実行 |
| `Cannot find module 'canvas-confetti'` (`tests/unit/features/reward-celebration.test.ts`) | root `node_modules/` 不整合 | `npm ci` または `rm -rf node_modules && npm install` |

### `prepare` script の挙動 (#2476)

`package.json` `prepare` script は 3 ステップ実行する: `svelte-kit sync` / `husky` / `cd infra && npm ci`。各ステップ失敗時は `[prepare] ... FAILED — ...` の warning が標準出力に出るため、`npm install` / `npm ci` の出力末尾を確認する習慣をつける。

CI ログでも同 warning が出るため、PR の CI fail 調査時にまず確認する箇所。

## テスト分類（#1500）

| 分類 | 置き場所 | 特徴 |
|------|---------|------|
| **Unit** | `tests/unit/` | モック可、単一関数/モジュール |
| **Integration** | `tests/unit/` or `tests/integration/` | `page.route()` / DB in-memory。実サーバー不要 |
| **E2E** | `tests/e2e/` | モックなし、実アプリ全体 (`npm run dev` / `preview` 必要) |
| **Demo Lambda E2E** | `tests/e2e/demo-lambda/` | demo Lambda 環境専用 (#2205、`playwright.demo.config.ts`) |

判断: 実サーバー必要 → E2E / 不要 + モックで完結 → Integration / それ以外 → Unit。
`tests/e2e/integration/upgrade-checkout.spec.ts` は `page.route()` で Stripe モック (Integration 相当) だが cognito-dev 認証必要のため `playwright.cognito-dev.config.ts` 管理。

## demo Lambda E2E (`tests/e2e/demo-lambda/`、#2205)

ADR-0048 Multi-Lambda Demo Deployment で導入された demo Lambda (`demo.ganbari-quest.com`、
`AUTH_MODE=anonymous + DATA_SOURCE=demo`) 固有の動作 (匿名認証 / Bug 4 `/switch` クリック動作 /
marketplace seed 等) を検証する専用 spec 群。本番 cognito E2E では再現不可なため別 config で分離。

- **ローカル実行** (preview server 自動起動、port 5180):
  ```bash
  npm run test:e2e:demo
  ```
- **deploy 済 demo Lambda 検証** (preview server 起動せず prod URL を叩く):
  ```bash
  DEMO_BASE_URL=https://demo.ganbari-quest.com npm run test:e2e:demo
  ```
- **CI 実行条件** (`.github/workflows/ci.yml` §`e2e-demo-lambda` ジョブ):
  - `area:demo` ラベル付きの PR
  - main 押し up (`push` トリガー)
  - 手動実行 (`gh workflow run ci.yml`)
- **追加対象**: 新規 demo Lambda 固有動作 / `AnonymousAuthProvider` 仕様変更 / DEMO_WRITE_ALLOWLIST 増減 /
  `src/lib/server/demo/demo-data.ts` 仕様変更 を伴う PR は本ディレクトリに回帰テスト追加

## interactive flow は「操作 → 結果」を必須検証する (render-only 禁止) — #2544 / #2459 / UnifiedImportHub 事故

初顧客レビュー直前、実ユーザーが marketplace 取込ダイアログを 1 分操作しただけで「追加ボタン無反応・キャンセル不能」(機能 dead-end) を発見した。一方 E2E `admin-unified-import-hub.spec.ts` は **ダイアログが render される / testid visible だけを assert して PASS**。「追加 click → 活動が増える」= ユーザーの goal 完遂を一度も検証していなかった (render proxy は緑、goal 完遂は壊れている)。同じ機能を `marketplace-checklist-import.spec.ts:109-113` は **正しく `importBtn.click()` → imported バッジ visible を assert** している (= dead-end なら必ず fail)。**正解 pattern はリポジトリ内に既に存在**し、不足しているのは「それを default に強制する規律」である (#2544 research、既存ツールの過小活用が原因)。

### 原則 (render-only 禁止 / act → outcome assert 必須)

- **click / fill / submit を行う test は、その後に「結果の state 変化」を必ず assert する**。visible / count / attribute だけで終える test は interactive flow に対しては不可。
- 検証すべき「結果」(副作用 verify) は次のいずれか 1 つ以上:
  1. **network**: `page.waitForResponse(...)` + `resp.ok()` (form action / API が実際に発火したか)
  2. **UI 反映**: `toHaveText` / `toContainText` / 完了バッジ visible / dialog が `toBeHidden` / `toHaveCount(0)`
  3. **永続**: 一覧件数の増減 (`toHaveCount(before ± 1)`) / 残高数値の変化
- **dead-end 検出**: submit 系は必ず ① 発火 (network or loading) と ② 結果反映 を両方 assert する。「ボタンを押しても何も起きない」を捕捉する。
- **cancel 経路を別 assert で検証**: dialog を開く test は「close / cancel / backdrop → `toBeHidden`」も置く (今回 cancel も壊れていた)。
- **query 方針**: `getByRole` / text / label を優先。`getByTestId` は他で取れない場合の最終手段 (Testing Library 原則)。既存 testid を消す必要はないが、新規は role/text を先に検討する。

### render-only が許容される例外 (interactive flow ではないため対象外)

- 純粋表示 component (Logo / Badge 等、操作なし) の表示検証
- LP CSP / legal docs render / 404 fallback 等、**そもそも表示検証が目的**のもの
- アクセシビリティ / レイアウト回帰 (Storybook visual / a11y addon)

### dialog / form / menu の必須パターン

「open → act → 副作用 verify」を 1 セットで書く。helper `tests/e2e/helpers/goal-flows.ts` の `completeImportFlow` / `expectListGrew` / `expectDialogClosed` / `expectDialogCancellable` を使う (assertion 内包、`playwright/expect-expect` の `assertFunctionNames` に登録済)。

```ts
// before (render-only、PASS するが dead-end を見逃す)
await page.getByTestId('menu-item-import').click();
await expect(page.getByTestId('add-activity-dialog')).toBeVisible(); // ← ここで終了 = NG

// after (goal 完遂、無反応 / cancel 不能なら必ず fail)
import { completeImportFlow, expectDialogCancellable } from '../helpers/goal-flows';
await completeImportFlow(page, { /* trigger → act → result assert */ });
await expectDialogCancellable(page, { /* cancel → dialog 閉じる assert */ });
```

### 2 層 cadence (検証の段階分け、ADR-0007 EPIC-merge tier)

全 PR で全 critical journey を貫通させると CI が肥大化するため、検証は 2 層に分ける。**横断 cadence ポリシーの SSOT は ADR-0007** (本節はその tests/ 視点の抜粋)。

| 層 | いつ | 何を (機械・高速 / 半自動・人間判断) |
|---|---|---|
| **per-PR (軽量)** | 全 PR / push | 変更領域の targeted E2E (該当 spec のみ、`npx playwright test tests/e2e/<spec>`) + 型 (svelte-check) + Storybook 目視 / play (`npm run test:storybook`) + 用語 coherence lint (`check-internal-terms` / `check-add-path-coherence`) + add-path check。機械・高速。 |
| **EPIC-merge / 顧客レビュー gate (この規模だけ)** | EPIC 完了時 / 顧客レビュー前 | 全 critical user journey の goal 完遂貫通 E2E + Cognitive Walkthrough 4 質問 (#2459 C-2) + a11y (addon-a11y) + visual (pixelmatch) + 実機 1 クリック貫通。per-PR では重すぎるものをここに集約。 |

per-PR で「render-only 禁止 / act → outcome 必須」を守りつつ、CUJ 全網羅貫通や Cognitive Walkthrough は EPIC-merge gate に置く。「rendering + 型 + targeted で per-PR は十分、ただし interactive flow には outcome 必須」が原則 (#2459 やらないこと #3 の precise 化と整合)。

### CUJ (Critical User Journey) — EPIC-merge gate で完遂貫通

本アプリの core CUJ は最低限以下を「起動」でなく「goal 1 つ完遂」で持つ。各 CUJ は「途中で詰まる (dead-end)」を検出する assert を 1 つ以上含む:

1. 活動を追加する (admin → `+` → import dialog → 一覧に反映) ← 今回壊れた経路、最優先
2. 子供が活動を記録する (確認 → 記録 → ポイント加算 → home 復帰)
3. ごほうびを交換する (交換 → ポイント残高減 → 交換済み反映)
4. 報酬リクエスト承認 (child 申請 → admin 承認 → 状態変化)
5. チェックリスト import → child で表示

#### マーケットプレイス インポート CUJ (#2554 follow-up P1 / 研究 SSOT)

5 type (activity-pack / reward-set / checklist / rule-preset / challenge-set) の B1 dead-end 5 type 横展開を担保するため、以下 3 type の terminal goal verify を `?import=<presetId>` ＋ ChildSelectionDialog 確定動線で配備済 (research `tmp/research-marketplace-import-coverage-matrix-2026-05-29.md` §4-A P1):

- **CUJ-A3** (activity-pack): `tests/e2e/admin-activities-import-marketplace.spec.ts` — `?import=kinder-starter` → `import-child-selection-dialog` 全員選択 → 確定 → 全 child タブ件数 sum が grew
- **CUJ-R2** (reward-set): `tests/e2e/admin-rewards-import-marketplace.spec.ts` — `?import=kinder-rewards` → `reward-import-child-selection-dialog` 全員選択 → 確定 → 全 child タブ件数 sum が grew
- **CUJ-CH2** (challenge-set): `tests/e2e/admin-challenges-import-marketplace.spec.ts` — `?marketplace-import=japan-annual-events` → `challenge-import-child-selection-dialog` 全員選択 → 確定 → admin チャレンジ group 数が grew (#2554 follow-up で partial → 完全 terminal verify に upgrade、admin-rewards CUJ-R2 と同型の `grew || hadSkips` dual condition、PR-CH2 #2638)

既存 `tests/e2e/marketplace-checklist-import.spec.ts` の checklist 「`marketplace-preset-import-event-pool` click → imported badge visible + reload で永続」が exemplar (#2362 PR-5)。本 follow-up はその pattern を残 4 type に横展開する第 1 弾。**2026-05-29 時点 5 type 中 4 type (checklist / activity-pack / reward-set / challenge-set) が完全 terminal verify**。残 1 type (rule-preset) の terminal verify + 残 gap (B5 per-child dedup unit regression / B10 永続化 5 type 揃い / B7 5 age mode 取込後表示) は research SSOT §4-B Phase 1-4 で別 PR で順次扱う。

### Storybook interaction test (component 層、server 不要で配線健全性検証)

interactive component (Dialog / Form / UnifiedImportHub / Menu) は `play` 関数で「操作 → callback 発火 (`fn()` spy) / disabled 制御 / cancel 発火」を component 層で検証する。server 反映 (DB) は Playwright (統合層) に委ね、component 層は配線健全性に限定する (二重防御)。`play` 内 `expect` / `userEvent` / `fn` は **`storybook/test`** (Storybook 10 同梱) から import し、`npm run test:storybook` (`vitest run --project storybook`) で CI 実行する。exemplar: `src/lib/marketplace/ui/UnifiedImportHub.stories.svelte`。

## 顧客レビュー前 CX 版 DoR (12 条件 SSOT、#2553 + #2657 後段フェーズ拡張 2026-05-30)

初顧客レビューで機能 E2E (#2544 goal 完遂) が緑でも実ユーザーが 1 分で 4 件発見した教訓 (#2558 bug-1〜4)。**機能 + UX + visual + accessibility + exploratory を統合した 12 条件**を顧客レビュー前の Definition of Ready (DoR) として SSOT 化する。設計根拠は `tmp/research-cx-quality-verification.md` §4 / §G (DoR #1-#8 起源、Issue #2553) + `tmp/research-usability-test-comprehensiveness-2026-05-30.md` §3 (DoR #9-#12 拡張、PR #2657 後段フェーズ Round 1 deep research)。

**2026-05-30 拡張経緯** (PR #2657 後段フェーズ): User 直接指針「**機能テストだけでは顧客品質になりません。UI/UX など見た目、導線、情報の統一性、体験の統一性などあらゆるユーザビリティが含まれていなければなりません**」を受け、業界 usability test 体系 (NN/G 10 Heuristics / ISO 9241-110 / WCAG 2.2 / Cognitive Walkthrough / Heuristic Evaluation / Empty-Error-Loading audit) と本 product 既存 DoR 8 条件の gap 分析の結果、**8 条件 = 約 50% カバー、機能 E2E PASS のみ = 20-30% カバー** と判明。Pre-PMF 適合性 (ADR-0010、5-user rule、4-5 evaluator で 80% 検出) を満たす最小有効セットとして **DoR #9-#12 を Bucket A 必須として追加**。

**過剰防止 (ADR-0010、Bucket B/C 不採用)**: critical user journey (活動追加 / 報酬交換 / マーケットプレイス インポート 等、CUJ §「2 層 cadence」を参照) のみに限定。**Bucket B (PMF gate 追加候補) 不採用**: First-Click Test 5+ / Tree Testing 15-20+ / Think-Aloud 5+ / SUS 12-15+ / Card sorting 20+ — いずれも実 user 確保コストが Pre-PMF で過剰。**Bucket C (Scale gate 追加候補) 不採用**: A/B testing / heatmap / 5 age mode × 2 viewport completeness matrix / 国際化 (現状日本語 only)。

| # | 条件 | 層 | 検証手段 | 担当 SSOT |
|---|---|---|---|---|
| 1 | critical user journey が機能的に goal 完遂する (dead-end ゼロ) | 機能 | 上記「act → outcome assert」E2E (helper `goal-flows.ts`) + Storybook play | **#2544 (実装済 基盤)** |
| 2 | 同一 CUJ を **Cognitive Walkthrough 4 質問**で 1 周し全 Yes | UX (体験) | PO or AI が初見 persona × 4 質問 (Q1 正しい結果を得ようとするか / Q2 正しい操作が利用可能と気づくか / Q3 操作 ↔ 結果結びつけ / Q4 進捗 visible)。AI は H2 / H4 / H8 担当、**H3 / H6 / H9 は人間が必ず検証** (AI 弱点、Baymard false-positive 80% 抑制、research §3-1) | **`.claude/skills/cognitive-walkthrough/SKILL.md` (#2554、本 skill SSOT)** |
| 3 | UI 実テキストが用語 SSOT 準拠 (謎用語 / 内部語彙ゼロ) | 情報統一性 | [`check-terminology-coherence.ts`](../scripts/check-terminology-coherence.ts) 警告 0 + [`check-hardcoded-strings.mjs`](../scripts/check-hardcoded-strings.mjs) / [`check-no-plan-literals.mjs`](../scripts/check-no-plan-literals.mjs) を `pre-ready` Step 4 で自動実行 | **PR #2587 (#2555) で `terms.ts` 直接 import 拡充済** |
| 4 | 同一リソースの add 経路 ≤ 4 + 用語重複なし (Hick's Law) | 導線 + 統一性 | [`check-terminology-coherence.ts`](../scripts/check-terminology-coherence.ts) (旧 `check-add-path-coherence.mjs` from PR #2587 rename) warning 0 | **#2544 で最小導入 → PR #2587 で拡充済 (DESIGN.md §10 構造ルール整合)** |
| 5 | critical flow の screenshot を vision LLM に task-grounded prompt で review → 人間 filter 済 | 見た目 | §3 flow (research §3-3 prompt)、capture.mjs 連番 → vision LLM → PO filter | **C-5 別 Issue (POC 中、opt-in)** |
| 6 | charter ベース exploratory 1 セッション (add/cancel 連打・空送信) で dead-end ゼロ | 体験 + dead-end | AI exploratory agent or 人間 45 分 session | **C-6 別 Issue (POC 中、opt-in)** |
| 7 | 実機 1 クリック貫通 (人間 or AI が実ブラウザで critical flow を 1 回貫通) | 機能+CX | Playwright trace/video 証跡 + 実機操作 (NUC or `AUTH_MODE=anonymous DATA_SOURCE=demo` preview) | **#2544 AC6 と合流 (実装済)** |
| 8 | 5 mode visual baseline + primitives 準拠 (独自 UI 逸脱なし) | 見た目 | 既存 pixelmatch (`scripts/check-lp-visual-regression.mjs`) + Storybook play (#2544 AC4) + 5 年齢モード SS | **既存 + #2544 (実装済)** |
| **9 (新規 2026-05-30)** | **Heuristic Evaluation 10 原則 × critical flow matrix で severity 3-4 違反ゼロ** | 体験 + 見た目 + 導線 | NN/G 10 原則 ([How to Conduct Heuristic Evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/)) を AI 1 次 + User 2 次 review で 2 evaluator 扱い (業界基準 3-5 で 60-80% 検出、Pre-PMF AI + 人間で部分実施)。各違反に severity 0-4 付け、3-4 ゼロを Ready 化条件。AI は NN/G #1/#2/#4/#7/#8/#10 担当、**#3 (User control) / #5 (Error prevention) / #6 (Recognition) / #9 (Error help) は人間検証必須** (主観・mental model 判断、Baymard 95% vs GPT-4 20% 精度差) | **Round 1 deep research `tmp/research-usability-test-comprehensiveness-2026-05-30.md` §3.3 (本 Round 1 起源 SSOT)、別 Issue #XXX で実装手順書化検討** |
| **10 (新規 2026-05-30)** | **Accessibility audit (WCAG 2.2 AA、axe-core) で critical / serious violation ゼロ** | accessibility | [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) ([WebAIM checklist](https://webaim.org/standards/wcag/checklist)) + Material 3 default。AI 80% 主分担 (`@axe-core/playwright` 等で機械化)、User 20% は子供 ターゲット読字発達整合判断 (font size / contrast / tapSize per age) | **実装済 (PR-A11Y-2)**: `tests/e2e/helpers/a11y.ts` (`expectNoA11yViolations`、`@axe-core/playwright` AxeBuilder + WCAG 2.2 AA tag) + `tests/e2e/a11y-critical-cuj.spec.ts` (critical CUJ 7 page) + CI `a11y` job (`.github/workflows/ci.yml`、`app` 変更時 hard-fail)。既知違反は `tests/e2e/a11y-baseline.json` に rule id 単位で pin (silent cap 禁止)。`age-tier.ts` tapSize SSOT + DESIGN.md §8 既存 |
| **11 (新規 2026-05-30)** | **3 状態 (Empty / Error / Loading) inventory + audit で「default error」「blank empty」「無限 loading」ゼロ** | 体験統一性 | critical flow 各 state を grep + 目視で inventory ([Raw Studio: hidden UX moments](https://raw.studio/blog/empty-states-error-states-onboarding-the-hidden-ux-moments-users-notice/))、AI 70% 主分担 + User 30% filter。Empty state は既存 `UnifiedEmptyState.svelte` (#2362) を SSOT として活用 | **`UnifiedEmptyState.svelte` / `UnifiedImportHub.svelte` 既存、inventory script 別 Issue #XXX で検討** |
| **12 (新規 2026-05-30)** | **Mental model / glossary audit (`check-internal-terms` lint + atom 用語 SSOT 整合)** | 情報統一性 | atom 用語 SSOT (`terms.ts`、ADR-0045) を起点に critical flow UI 文言を audit ([Terminology spine](https://www.1stopasia.com/blog/terminology-drift-enterprise-software-localization/) drift 防止)。AI 80% 主分担 (lint 既存)、User 20% は親の自然言語 vs 内部用語の mental model 適合判断 | **`check-internal-terms.mjs` 既存 (DoR #3 と連携)、Mental model audit 別 Issue #XXX で検討** |

### 適用タイミング (2 層 cadence 整合)

- **per-PR (軽量)**: 条件 3 / 4 / 12 = 自動 lint 必須 (`pre-ready` で実行)。条件 1 / 8 = 該当領域変更時に targeted E2E + Storybook play (CI 自動実行)。条件 10 (Accessibility axe-core) = CI `a11y` job が `app` 変更時に自動実行 (PR-A11Y-2 で導入済、`tests/e2e/a11y-critical-cuj.spec.ts`)
- **EPIC-merge / 顧客レビュー gate (重量)**: 全 12 条件を満たした証跡 (条件 2 = walkthrough session sheet 添付 / 条件 7 = 実機貫通 trace / 条件 9 = Heuristic Evaluation 違反 matrix / 条件 10 = axe-core report / 条件 11 = 3 状態 inventory) を PR body or EPIC umbrella に集約。条件 5 / 6 は opt-in (C-5/C-6 POC 採用後に必須化判定)

### 禁忌

- **「機能 E2E 緑 = 顧客レビュー可」と判定する**: #2558 で実証された通り、機能緑のまま bug-2/3/4 が露出する。条件 2-4 を必ず併走させる
- **「DoR 8 条件で十分」と判定する** (2026-05-30 拡張根拠): User 指摘「機能テストだけでは顧客品質にならない、見た目/導線/情報統一性/体験統一性などあらゆるユーザビリティ含む」+ 業界網羅 Heuristic Evaluation / Accessibility / 3 状態 / Mental model audit のいずれかが欠落 = DoR 8 条件のみは約 50% カバー (gap = NN/G #1 Loading state / #3 undo / #5 error prevention / #9 error help / Empty state inventory / Mental model audit)
- **条件 5 (AI vision review) を主担保にする**: open-ended audit は false-positive 80% (Baymard)。task-grounded persona prompt + 人間 filter 必須 (research §3-1)
- **条件 9 (Heuristic Evaluation) を AI 単独で運用する**: Baymard 95% 精度は専用 training、GPT-4 一般用途 20% / false positive 80% ([NN/G AI tool accuracy](https://www.nngroup.com/articles/baymard-ai-tool-accuracy/))。**人間 2 次 review 必須**
- **条件 11 (3 状態 inventory) を SS 自動撮影だけで Done とする**: Empty / Error は意図的に発生させる試行錯誤 (空 form 送信 / network 切断 simulation) が必要、AI 単独で網羅困難
- **多人数 user testing 招集を Pre-PMF で要求する**: 5-user rule (NN/G) で 85% UX 問題は捕捉できる、それ以上は ROI 低 (research §B-4 / §7、Bucket B 不採用根拠)

### 関連

- 親 EPIC: #2459 (Test Strategy 全体最適化、Pyramid 55/30/15)
- 基盤: #2544 (機能基盤、ADR-0007 EPIC-merge tier)
- 兄弟: C-2 #2554 (Cognitive Walkthrough skill、`.claude/skills/cognitive-walkthrough/SKILL.md` で実装) / C-3 #2555 (用語 coherence lint、PR #2587 で実装)
- 拡張根拠: **PR #2657 後段フェーズ Round 1 deep research** (`tmp/research-usability-test-comprehensiveness-2026-05-30.md` §3 業界網羅 + DoR gap 分析、2026-05-30)
- 横展開: `.claude/skills/dev-open-pr/SKILL.md` (PR 起票時 CX-DoR 12 条件ガイダンス) / `.github/PULL_REQUEST_TEMPLATE.md` (customer-facing PR 用 12 条件チェック)
- 研究: `tmp/research-cx-quality-verification.md` §4 / §G / §3 (DoR 1-8 起源) + `tmp/research-usability-test-comprehensiveness-2026-05-30.md` §1-§9 (DoR 9-12 拡張根拠)

## 禁止事項

- **カバレッジ閾値の引き下げ** — `vite.config.ts` `thresholds` 引き下げ PR は CI 自動拒否（`scripts/check-coverage-threshold.js`）。引き下げ必要なら ADR で復元計画と同時コミット
- **バグ隠蔽ヘルパー（ダイアログゴースト除去等）** — アプリ側を修正
- **`test.skip()` 安易使用** — 通らないならアプリを直す
- **`waitForTimeout()` 新規使用** — `waitForSelector()` / `waitForResponse()` / `waitForURL()` / `waitForFunction()` / Web Animations API を使う。**ESLint `playwright/no-wait-for-timeout: error` 自動拒否** (#1259 Phase 3)
- **`{ waitUntil: 'networkidle' }`** — Playwright 公式 DISCOURAGED。`domcontentloaded` + web-first assertion を使う。**ESLint `playwright/no-networkidle: error` 自動拒否**
- **`isVisible()` + `expect(...).toBe(true)` の assertion** — 同期評価で auto-retry が効かず flake (#1768)。`await expect(locator).toBeVisible()` を使う。`isVisible()` 許容用途は条件分岐 (`if (await x.isVisible().catch(() => false))`) のみ
- **サービスを呼ばないサービステスト** — `xxx-service.test.ts` は公開 API を import して呼ぶ
- **テスト内で実装ロジック再実装** — 実装の関数を呼んで結果検証

## 機能追加 PR のテスト要件

新規サービスファイル追加時は同 PR 内に対応テストファイル必須。「テストは後で」禁止。テストなし機能追加 PR は Draft 据え置き。

## スキーマ変更 PR のテスト要件（#962 教訓）

`src/lib/server/db/schema.ts` 変更 PR の必須事項:

### カラム追加時
- 新カラムに `default()` 設定（NULL を業務的意味で使う場合を除く）
- マイグレーション script の `ALTER TABLE ADD COLUMN` に対応する `UPDATE table SET col = <default> WHERE col IS NULL` を同 script 内に書く
- 新カラムを `WHERE` / `eq()` / `and()` に使うクエリがあるなら **NULL 混在行**動作の検証テストを `tests/unit/db/` または `tests/unit/services/` に 1 件追加

```ts
it('is_archived が NULL の既存行もアクティブとして返される', () => {
  sqlite.exec(`INSERT INTO children (tenant_id, nickname, age, is_archived) VALUES ('t1', 'legacy', 5, NULL)`);
  expect(findAllChildren('t1').map((c) => c.nickname)).toContain('legacy');
});
```

### クエリ側 NULL 安全性

「NULL = 既定値扱い」セマンティクスなら `or(eq(col, default), isNull(col))` または **マイグレーションで backfill**。片側だけは不十分。

CI 自動チェック (`scripts/check-schema-change-tests.mjs`、warn): `schema.ts` diff があるのに `tests/unit/db/` または `tests/unit/services/` diff が無い場合警告。skip 必要時は PR 本文に `[skip-schema-test-check]`。

### DynamoDB 並行実装の整合性

`src/lib/server/db/sqlite/*.ts` と `src/lib/server/db/dynamodb/*.ts` のペアは新カラム追加時に undefined / null / 既定値ハンドリングを両実装で一致させる。

## E2E 固有

- DB スキーマ変更時は `tests/e2e/global-setup.ts` のテストデータ投入も更新
- 全 4 年齢コアモード (preschool/elementary/junior/senior) のテストデータ必要
- 活動記録の完全フロー (確認→記録→コンボ→スタンプ→レベルアップ→ホーム復帰) を検証

## プラン別 seed fixture（#759）

`tests/helpers/plan-fixtures.ts` を使用。ローカル SQLite に `licenses` テーブルが存在しないため、プラン状態は `AuthContext` + `trial_history` 組み合わせで表現（詳細はファイル冒頭の設計メモ）。

### Unit (vitest)

```ts
import { makeFreeContext, makeStandardContext, makeFamilyContext, seedTrialActiveContext, seedTrialExpired } from '../helpers/plan-fixtures';

const freeCtx = makeFreeContext({ tenantId: 't-1' });
const { context } = seedTrialActiveContext(sqlite, { tenantId: 't-trial', tier: 'family', daysOffset: 5 });
seedTrialExpired(sqlite, { tenantId: 't-used' });
```

### E2E (Playwright)

E2E ローカル認証モードは常に `plan=family` を返すため seeder ではプラン切替不可。`DEBUG_PLAN` / `DEBUG_TRIAL` env (#758) を使う:
```bash
DEBUG_PLAN=free npx playwright test tests/e2e/some-spec.ts
DEBUG_PLAN=standard DEBUG_TRIAL=active DEBUG_TRIAL_TIER=family npx playwright test ...
```

詳細: `src/lib/server/debug-plan.ts` / `.env.example`

## 局所テストコマンド (#2184)

tests 配下のみ修正 / 個別 spec デバッグ時は全体実行を待たず以下で高速検証:

```bash
npx vitest run tests/unit/<subdir>/                             # unit test 個別実行
npx vitest run tests/unit/db/                                   # DB 層 unit test
npx vitest run tests/unit/services/                             # service 層 unit test
npx playwright test tests/e2e/<spec>.spec.ts                    # E2E 個別 spec
npx playwright test tests/e2e/<spec>.spec.ts --grep "<title>"   # spec 内テスト個別
npx playwright test tests/e2e/<spec>.spec.ts --debug            # ヘッドフルデバッグ
npm run test:storybook                                          # Storybook test
```

SSOT: `docs/CLAUDE.md` §「サブディレクトリ別局所テストコマンド SSOT」。Ready 化前は `npm run pre-ready -- --pr <num>` で全 step PASS が必須。

## cron E2E テスト

`/api/cron/*` エンドポイントは `tests/e2e/helpers.ts` の cron ヘルパー必須:

| 関数 | 用途 |
|------|------|
| `getCronHeaders()` | cron 認証用ヘッダー（`CRON_SECRET` 設定時のみ `x-cron-secret` を含む） |
| `isCronAuthSkipped()` | cron 認証スキップ環境判定（`CRON_SECRET` 未設定 + `AUTH_MODE=local`） |

3 パターン分岐: ① `CRON_SECRET` 設定 + ヘッダー一致 → 200 / ② 設定 + 不一致 → 401 / ③ 未設定 + `AUTH_MODE=local` → `[200, 500]`（DB 未初期化で 500 あり）/ ④ 未設定 + その他 → 500。

```ts
const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test('正常リクエスト', async ({ request }) => {
  if (!cronSecret && !authSkipped) {
    expect((await request.post('/api/cron/my-endpoint')).status()).toBe(500);
    return;
  }
  const res = await request.post('/api/cron/my-endpoint', { headers: getCronHeaders(), data: { dryRun: true } });
  if (!cronSecret && authSkipped) {
    expect([200, 500]).toContain(res.status());
  } else {
    expect(res.status()).toBe(200);
  }
});
```

注意: インライン `process.env` 参照禁止、必ずヘルパー使用。`cron-auth.ts` ロジック変更時はヘルパーも更新。
