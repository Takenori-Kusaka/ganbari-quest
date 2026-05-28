---
name: impact-analysis
description: 大規模リファクタリング/モデル変更/rename の影響範囲調査 (Change Impact Analysis)。grep 単独は禁止、4 layer 防御 (構文/意味/構造/派生 artifact 21 カテゴリ) で網羅性を担保する
trigger: rename PR / モデル変更 / API 廃止 / DB schema 変更 / 大規模リファクタリング着手前
---

# 影響範囲調査 (Change Impact Analysis) Skill

## 起動タイミング

以下のいずれかに該当する変更を着手する**前**に必ず本 skill を実行:

- 識別子 rename (関数名・コンポーネント名・URL・atom・enum 値・DB column / table)
- API 廃止 / endpoint 変更
- DB schema 変更 (column 追加・削除・rename・型変更)
- プラン / プライシング / 用語の根本変更
- 設計層の境界変更 (feature 移動・モジュール分割)
- LP / 法務文書 / 用語辞書の改訂
- 50 ファイル超の影響を伴う可能性のある変更

**禁止**: 「grep で○○件確認、影響範囲調査完了」と書くこと。grep は L1 構文層の一部のみ。

## 業界用語

- **Change Impact Analysis (CIA)** — 標準用語 (Bohner & Arnold 1996)
- 関連: Ripple Effect / Dependency Analysis / Blast Radius (SRE) / Program Slicing

## Bohner & Arnold 3 分類 (必ず併用)

| 分類 | 内容 | 取りこぼし時の典型例 |
|---|---|---|
| **Traceability IA** | 要件 / 設計 / テスト / 顧客接点の link 追跡 | LP 文言・Help Center・FAQ・法務文書 |
| **Dependency IA** | code-level 静的・動的依存 (call graph / dataflow) | template literal / dispatch table / 同名異義 |
| **Experiential IA** | 過去類似変更の経験・暗黙知 | 「Cognito attribute rename 不可」等の制約 |

grep は Dependency IA の syntactic 層のみ。3 つを併用しないと派生影響を取りこぼす。

## 4 layer 防御 (実行順)

### L1: 構文層 (grep + AST 構造マッチ)

```bash
# 文字列 grep (高速、network なし)
rg -n "pattern" --type-add 'svelte:*.svelte' -t svelte -t ts -t md path/

# AST 構造マッチ (template literal / 動的構築まで捉える)
npx ast-grep --pattern '$VAR.family' --lang ts src/
npx ast-grep --pattern 'PLAN_TERMS.$KEY' --lang ts src/
```

検出するもの: template literal / dispatch table / 動的構築

### L2: 意味層 (型情報経由)

```typescript
// ts-morph script (例: rename safety)
import { Project } from 'ts-morph';
const project = new Project({ tsConfigFilePath: './tsconfig.json' });
const sourceFile = project.getSourceFileOrThrow('src/lib/domain/terms.ts');
const propDecl = sourceFile.getVariableDeclarationOrThrow('PLAN_TERMS')
  .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  .getPropertyOrThrow('family');
const refs = propDecl.findReferences();
// refs に template literal 経由の参照も型解決済で含まれる
```

または LSP `Find All References` (IDE 経由、ただし CI 統合不可)。

検出するもの: 同名異義の区別 / 型経由の参照 / template literal 内の意味的依存

### L3: 構造層 (call graph / 依存グラフ)

```bash
# dead code / 取り残し export
npx knip --reporter symbols

# モジュール依存グラフ可視化
npx madge --circular --extensions ts,svelte src/
npx depcruise --include-only "^src" src/ --output-type dot | dot -T svg > deps.svg

# call graph (TypeScript)
npx jelly --target src/lib/server/services/stripe-service.ts
```

検出するもの: N hop 先の依存 / 取り残し / boundary 違反

### L4: 派生 artifact (21 カテゴリ checklist、人間目視)

下記 §「21 カテゴリ checklist」を 1 件ずつ確認。grep / AST では原理的に検出できない。

## 21 カテゴリ Checklist (Pre-flight、PR body に記載)

```markdown
## 影響範囲調査 (Change Impact Analysis)

### L1 構文 (ast-grep / ripgrep)
- [ ] 旧名称 grep 結果: N 件
- [ ] ast-grep 構文マッチ結果: N 件 (template literal / 動的構築含む)

### L2 意味 (ts-morph / LSP)
- [ ] ts-morph findReferences: N 件 (型経由参照含む)
- [ ] 同名異義の区別: ○/×

### L3 構造 (Knip / Madge / dependency-cruiser)
- [ ] Knip 取り残し export: N 件
- [ ] 依存グラフで N hop 先確認: 完了/未完了

### L4 派生 artifact (人間目視 21 カテゴリ)

#### A. データ永続層
- [ ] 1. DB schema (column / table / enum / FK / view / trigger / BI tool)
- [ ] 2. DB 保存済 string value (既存 row migration)
- [ ] 3. search index (Elasticsearch / Algolia / DynamoDB GSI)

#### B. キャッシュ層
- [ ] 4. Service Worker / browser cache (file hash)
- [ ] 5. CDN cache (CloudFront / Fastly TTL)
- [ ] 6. server-side cache (Redis / Memcached key prefix)

#### C. 外部 SaaS 連携
- [ ] 7. Stripe (Product / Price slug / Webhook event / past invoice)
- [ ] 8. Cognito (group name / custom attribute、rename 不可、ADR-0018 教訓)
- [ ] 9. Sentry / Datadog (project / tag / alert query)
- [ ] 10. email / push template (SES / SendGrid / FCM handlebars 変数)

#### D. 分析・監視
- [ ] 11. analytics event name (Mixpanel Lexicon / PostHog / GA)
- [ ] 12. dashboard / alert (Datadog / Grafana / CloudWatch metric / log)

#### E. 顧客接点 (UX)
- [ ] 13. Help Center / FAQ / blog / KB (Zendesk macros)
- [ ] 14. bookmarks / SEO (Google index URL / 外部 blog)
- [ ] 15. 法務文書 (ToS / Privacy / 特商法 / SLA / 過去契約)

#### F. CI/CD インフラ
- [ ] 16. GitHub Actions / pipeline (branch protection "Required" 名)
- [ ] 17. deployment env / secrets (`*_PRICE_ID` 等)
- [ ] 18. i18n platform (Lokalise / Crowdin 登録済 key)

#### G. テスト・記録
- [ ] 19. fixture / seed / golden / snapshot (`__snapshots__/*.snap`)
- [ ] 20. 過去 PR / commit / Issue / ADR (検索性のため**更新しない**)
- [ ] 21. audit log / 過去レコード (「old → new mapping table」で保全)
```

## ツール推奨 stack (TS / SvelteKit、Pre-PMF コスト最良)

| 段階 | ツール | npm / 導入 |
|---|---|---|
| **fast feedback** | ast-grep + ESLint | `npm i -D @ast-grep/cli` |
| **rename safety** | ts-morph | `npm i -D ts-morph` |
| **dead code** | Knip | `npm i -D knip` (既存導入確認) |
| **依存グラフ** | dependency-cruiser / Madge | `npm i -D dependency-cruiser` |
| **deep semantic (year 1-2 回)** | CodeQL | GitHub Actions |
| **cross-repo** | Sourcegraph Batch Changes | mono-repo 外波及時のみ |

CodeQL は重く Pre-PMF オーバーキル、security review 用途で別軸。

## CI gate 化パターン

1. **禁止パターン検出** — ast-grep YAML で「旧名称が文脈で参照されたら fail」
2. **未更新 baseline pinning** — `*-baseline.json` (現存 N 件、新規 1 件で fail)
3. **call graph reachability** — 廃止予定関数の参照を PR 内新規追加で fail
4. **contract diff** — OpenAPI / Pact の breaking change 検出
5. **schema diff** — Drizzle migration `ALTER ... RENAME` 検知、関連 PR の Blocked by 強制

## 大規模事例から学んだ設計教訓

| 事例 | 教訓 |
|---|---|
| Stripe API field rename | dated version + 移行 guide + 内部 test app 先行 |
| GitHub master → main | CI/CD / branch protection は rename を follow しない |
| Shopify Packwerk | constant reference 静的解析 + boundary CI gate |
| Atlassian Jira Service Desk → Management | UI / docs / marketing / support macros / trademark 同時更新 |
| Slack channel rename | **name = 表示用 alias、内部参照は immutable ID** に投資 |

**共通教訓**: 大企業ほど immutable ID 設計 + rename は alias 経由。Pre-PMF では future-proofing として「内部識別子は legacy 維持 (Phase 7 で別 PR migration)」を採用。

## 適用フロー (再現可能手順書)

新規 rename / 大規模変更 PR 起こす前:

1. **Issue 起票時**: 影響範囲調査の規模見積を Issue body に記載 (50 ファイル超なら本 skill 適用宣言)
2. **着手前**: L1 → L2 → L3 → L4 の 4 layer を順次実行、結果を tmp/ に保存
3. **PR body**: 上記 §21 カテゴリ checklist を PR body にコピー、各項目に確認結果記載
4. **CI gate**: ast-grep + Knip + baseline pinning を CI に組込
5. **review**: QA レビューで「L4 21 カテゴリの確認漏れ」を必ずチェック

## 関連 SSOT

- memory: `reference_impact_analysis_methodology.md` (詳細方法論、業界事例、primary source URL)
- ADR: ADR-0014 (OSS 先調査ルール、本 skill のツール選定根拠)
- skill: `db-migration` (DB schema 変更時の追加 skill) / `pr-review` (QA レビュー時の本 skill 適用確認) / `regression-check` (rename 後の回帰テスト)
- 関連 memory: [[plan-name-implementation-gap]] / [[deep-research-product-specific]] / [[replan-on-unforeseen-blocker]] / [[ssot-verification-before-proposal]]

## 禁忌

- **「grep だけで影響範囲調査完了」と PR body に書く** → 必ず L1-L4 全実行確認結果を併記
- **21 カテゴリ checklist を skip** → 漏れたカテゴリは PR で明示 (例:「14 bookmarks/SEO は新規プロダクトのため対象外」)
- **CI gate なしで rename PR をマージ** → ast-grep CI gate 未整備なら整備 PR を先行
- **「現利用ユーザーゼロだから影響範囲調査不要」と判断** → Pre-PMF でも将来ユーザーの bookmarks / SEO / 法務文書整合は必要

## 改訂履歴

- 2026-05-28: 初版作成 (Epic #2525 family→premium / license→subscription rename での grep 偏重 PO 指摘を契機、deep-research 業界調査結果反映)
