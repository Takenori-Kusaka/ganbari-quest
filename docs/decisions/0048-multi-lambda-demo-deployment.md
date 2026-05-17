# 0048. Multi-Lambda Demo Deployment (env 駆動 + IAM role 分離 + client-side state)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-15 |
| 起票者 | Takenori Kusaka |
| 関連 Issue | #2097 |
| 関連 ADR | ADR-0010 (Pre-PMF scope 判断、本決定の許容根拠) / ADR-0014 (#1350 OSS 先調査ルール) / ADR-0039 (re-activated、demo 実行モード化、本決定で §3 data layer を supersede) / ADR-0040 (re-activated、Typed env + EvaluationContext + Policy Gate、本決定で env 駆動を一層活用) / ADR-0046 (Service Interface + Context DI、本決定でも UI ↔ Service 経路は同じ) / ADR-0047 (UI Contract SSOT、ViewModel shape は production / demo で同一) |
| supersedes (部分) | ADR-0039 §決定 §3 データレイヤ (single Lambda + in-memory context 合成 → Multi-Lambda + env 駆動 stateless fixture) |

## コンテキスト

#2097 で demo / production UI 統合を **8 回繰返し試行 → 失敗** した。最終的な原因は:

1. `src/routes/demo/**` 別ツリーの並行実装 (#296 / #1129 / #1147 / #1180 / #531 / #561-563 / #566 / #2069 系統で 8 回乖離)
2. ADR-0039 (2026-04-18) で single Lambda + cookie/locals 駆動を採用したが Phase 2 (`/demo/**` 削除) 未完遂
3. 個人開発で **security incident に対応しきれない** 制約: 案 D (single Lambda + tenant filter) では filter bug 1 つで production data 漏洩リスク、Supabase 公式自身が「RLS permissive default で漏洩リスク」と警告

詳細は:
- `docs/research/2097-product-audit.md` — 12 前提誤認の体系列挙
- `docs/research/2097-multi-lambda-demo-evidence-based-architecture.md` — Multi-Lambda 採用是非の一次情報源裏付け (PostHog HogFlix / Mattermost Cloud / Heroku Review Apps 3 件確認)
- `docs/research/2097-multi-lambda-merged-system-design.md` — Multi-Lambda 詳細システム設計 (Part I infra + Part II OOP/SOLID/UML、約 120 一次情報源 URL)

## 検討した選択肢

### 選択肢 A: ADR-0039 維持 (single Lambda + cookie 駆動)
- 既存実装あり、Pre-PMF コスト minimal
- ✗ 個人開発で security incident 対応不能、過去 8 回失敗の構造原因 (cookie / `if (isDemo)` の漏れ) を解消できない

### 選択肢 B: 案 D Demo Tenant Pattern (Supabase 流、single Lambda + tenant_id filter)
- 既存 Repository pattern 流用、infra コスト 0 増
- v2 主 Agent / CDK Agent が 2/3 推奨
- ✗ Supabase 公式自身が「permissive default で漏洩リスク」を警告。個人開発で filter bug 発見時の incident response (緊急 patch + 影響範囲調査 + 顧客通知) を捌けない

### 選択肢 C: **Multi-Lambda Demo Deployment (本決定、採用)**
- demo Lambda を別 deploy (`demo.ganbari-quest.com`)、env 駆動 (`DATA_SOURCE=demo` + `AUTH_MODE=anonymous`)
- IAM role 分離で production DB / Secrets / Cognito UserPool への **物理的アクセス不可** を保証
- 月額追加 ~$0-3 (PC 1 unit $2.74、無料枠内で実質無料)
- ✓ AWS Well-Architected SaaS Lens silo model + SEC01-BP01 (account separation strongly recommended) で公式裏付け
- ✓ PostHog HogFlix / Mattermost Cloud / Heroku Review Apps 3 OSS で実装事例確認
- ✓ Lambda 1:1 IAM role 原則 (Operating Lambda blog) で公式裏付け

### 選択肢 D: 別 AWS Account (SEC01-BP01 strongly recommended の extreme)
- security blast radius 完全分離
- ✗ Pre-PMF 個人開発で 2 account 運用は過剰、AWS Control Tower 等の追加運用コスト

## 決定

**選択肢 C (Multi-Lambda Demo Deployment) を採用する**。

### 1. デプロイ構成

| 項目 | Production Lambda | Demo Lambda |
|---|---|---|
| URL | `app.ganbari-quest.com` (既存) | **`demo.ganbari-quest.com`** (新規、subdomain) |
| AWS Account | 同 account | **同 account** (別 account は Pre-PMF で過剰、§P-1.5) |
| Lambda runtime | DockerImageFunction ARM64 256MB | 同 (ECR の同一 image を共有) |
| `DATA_SOURCE` env | `dynamodb` | **`demo`** (新規 env value) |
| `AUTH_MODE` env | `cognito` | **`anonymous`** (新規 env value) |
| IAM execution role | `production-lambda-role` (既存) | **`demo-lambda-role`** (新規、production resource ARN を一切含めない) |
| Provisioned Concurrency | なし | **1 unit ($2.74/月)** で cold start 排除 (§P-1.2) |
| CloudWatch Log group | `/aws/lambda/ganbari-quest` retention 30 日 | `/aws/lambda/ganbari-quest-demo` **retention 7 日** (§P-2.1) |
| DynamoDB Table access | grant: full R/W | **アクセス権なし** (IAM role に Table ARN 含めない) |
| Secrets Manager access | grant: production secrets | **アクセス権なし** |
| Cognito UserPool | grant: production pool | **アクセス権なし** |
| S3 assets bucket | grant: R/W | **grant: read-only** (画像のみ取得可) |

### 2. アプリケーション設計 (Part II §A-§J)

- **Repository Pattern + Abstract Factory** (Fowler + GoF): `factory.ts` で `DATA_SOURCE=demo` の場合 `DemoXxxRepo` を返す。35 Repository (`src/lib/server/db/demo/*.ts`) を新規実装、in-memory fixture (demo-data.ts) を返す **stateless fixture provider**
- **Strategy Pattern**: `AuthProvider` interface に `AnonymousAuthProvider` 追加。`AUTH_MODE=anonymous` の場合に選択。dummy user (`anon-{requestId}`) + role='owner' + tenantId='demo' + licenseStatus=ACTIVE を返す (§P-1.6)
- **Test Double (Martin Fowler)**: demo Lambda は **「Fake (read) + Stub (write) hybrid」** で位置付け
  - read API (find / get / list): Fake = demo-data.ts fixture から返却
  - write API (insert / update / delete): Stub = `{ ok: true, demo: true }` 200 no-op response (§P-1.7)
- **Anti-Corruption Layer (Evans DDD)**: production / demo Service が `toViewModel()` で同 ChildHomeViewModel に正規化 (ADR-0047 既存)
- **Lambda stateless** (AWS Lambda Best Practices doc 公式): module-level singleton で **user-specific mutable state を保持しない**。「demo で記録 → リロードで保持」は **client sessionStorage 限定** (tab 閉じで消失、§P-1.1)

### 3. CDK 構成 (Part I §4 + §10)

- 新規 stack ではなく **既存 `ComputeStack` 内に並列定義** (§P-2.3):
  - `SvelteKitFn` (production、既存)
  - `SvelteKitDemoFn` (demo、新規) — ECR 同 tag を share
- IAM permission boundary は **採用しない** (AWS SaaS Factory sample が boundary 不採用、Pre-PMF 現実解、§P-1.4)。Lambda 1:1 IAM role 原則 (Operating Lambda blog) で role 分離のみ実施
- CloudFront: 既存 distribution に **alternate domain name `demo.ganbari-quest.com`** 追加、origin host header 駆動で demo Function URL に振り分け。SSL cert は `*.ganbari-quest.com` wildcard 既存利用 (us-east-1 ACM)
- Route 53: hosted zone 既存、A (Alias) record `demo.ganbari-quest.com` → CloudFront distribution 追加

### 4. PO 14 判断結果 (本決定の根拠、Part III)

| # | 決定 |
|---|---|
| P-1.1 session state | **client sessionStorage 限定** (Lambda 完全 stateless) |
| P-1.2 cold start mitigation | **Provisioned Concurrency 1 unit** ($2.74/月) |
| P-1.3 CloudFront routing | **subdomain `demo.ganbari-quest.com`** |
| P-1.4 IAM permission boundary | **不採用** (role 分離のみ) |
| P-1.5 AWS Sandbox account | **同 account + role 分離** |
| P-1.6 `AnonymousAuthProvider` | dummy user `anon-{requestId}` + role='owner' + tenantId='demo' |
| P-1.7 demo write API | **200 `{ ok: true, demo: true }` no-op response** (既存 hooks の `shouldReturnDemoNoop` 流用) |
| P-1.8 demo Lambda plan tier (#2198) | **`resolvePlanTier` で `getAuthMode() === 'anonymous'` を `family` 固定**。`AnonymousAuthProvider` の licenseStatus=ACTIVE / 全画面 allow 設計と整合。`checkChildLimit` / `checkActivityLimit` / `checkChecklistTemplateLimit` 全てで `max=null` 早期 return。`AdminLayout` の upgrade-btn / plan-badge は `authMode === 'anonymous'` で抑止 (LP SS carousel-4 で「demo なのに上限警告 + アップグレード CTA」が出ない、ADR-0013 LP truth 整合) |
| P-2.1 observability | X-Ray 無効、CloudWatch Logs 7 日 retention |
| P-2.2 DR 戦略 | 不要 (demo は state 持たない) |
| P-2.3 CI/CD pipeline 分離度 | 同 CDK stack 内並列定義 |
| P-2.4 feature parity 自動検証 | 手動確認のみ (Pre-PMF、`check-no-demo-route-duplication.mjs` で構造保証) |
| P-2.5 SOLID L 改善 | demo write no-op return type を `{ ok, demo }` discriminated union で揃え、Liskov 部分違反を許容 |
| P-2.6 SOLID I 改善 | 35 Repository monolithic 維持 (YAGNI) |
| P-3.1 ADR-0048 起票 + 1-in-1-out | **本 ADR が起票、archive 送り = ADR-0017 (rejected)** |

## 結果

- demo Lambda が production DB / Cognito / Secrets Manager に **物理的にアクセス不可** = security blast radius 構造保証
- 個人開発で security incident 対応不能制約に対する「IAM レベルの insurance」が ~$2.74/月で得られる
- `src/routes/demo/**` 並行実装が構造的に発生しない (demo Lambda は同 codebase + env 駆動)
- production schema 変更時、demo Lambda は ECR 同 image を共有するため **再 build で自動追従**
- 過去 8 回失敗の構造原因 (並行実装 / cookie 漏れ / auth bypass 混入) が **物理的に発生不可能**
- **legacy `/demo` 完全撤去 (#2097 PR-B2 + PR-B3、2026-05-17)**: `src/routes/demo/**` 配下 47 file (PR-B2: child 14 + PR-B3: parent admin 29 + root 5 - DashboardView 1 = 47) を物理削除完了。`legacy-url-map.ts` に 30+ entries (child 11 + admin 17 + root 3) を永久保持で追加し、bookmark / 外部リンクからの旧 URL アクセスは全件 308 で本番 path に救済
- **demo 検出 env-only 単一化完了 (#2097 PR-B4、2026-05-17、本 ADR の最終 milestone)**: `src/hooks.server.ts` の `resolveDemoActive()` から legacy 3 signal (query `?mode=demo` / cookie `gq_demo=1` / path `/demo/*`) を全撤去し、`resolveDemoActive(env)` = `AUTH_MODE=anonymous && DATA_SOURCE=demo` の env-only 純関数 1 行に統一。`isDemoLambda()` / `DEMO_MODE_COOKIE` / `DEMO_MODE_COOKIE_MAX_AGE` / `/demo/exit` 専用ハンドラ全削除。これで「demo Lambda は本番 routes のみ稼働 + env 駆動で振る舞いを切替」の理想形が達成され、cookie / query / path のいずれも `event.locals.isDemo` 判定経路として残らない構造保証となる。`?plan=` クエリ + `demo_plan` cookie (#760 demo 内プラン切替) は demo Lambda 上で意味があるため維持

### リスク

- cold start 排除のため Provisioned Concurrency 1 unit ($2.74/月) を維持。LP からの遷移 UX を許容するなら不要、`scripts/check-multi-lambda-cost.mjs` でコスト alarm 必要
- demo session state が **client sessionStorage 限定** (tab 閉じで消失) のため、demo 中の長時間体験には不向き。Anti-engagement 整合 (ADR-0012) の観点では正
- Multi-Lambda 移行に伴う既存 PR #2118 (`/demo/**` 削除) は **keep** (production Lambda から demo route を除去するため、Multi-Lambda 移行と整合)

### 段階別 milestone (4-6 週見積)

1. **週 1**: ADR-0048 起票 (本 PR、`ADR-0017 → archive` 1-in-1-out 同梱)、Issue #2097 を Multi-Lambda 方向に書き換え
2. **週 2-3**: `factory.ts` `DATA_SOURCE=demo` 拡張 + 35 demo Repository 実装 (`src/lib/server/db/demo/*.ts`) + `AnonymousAuthProvider` 実装
3. **週 4**: CDK `ComputeStack` に `SvelteKitDemoFn` + `demo-lambda-role` 追加、CloudFront alt domain + Route 53 record
4. **週 5**: hooks.server.ts から demo cookie / `locals.isDemo` 検出を削除 (env 駆動になるため不要、PR-B4 #2189 で完了)、LP demo リンクを `demo.ganbari-quest.com` に再変更
5. **週 6**: E2E test 更新、5 年齢モード SS 視覚等価性検証、PR Ready 化

## 関連 Issue

- #2097 (本 ADR の起点 Issue)
- PR #2118 (ADR-0039 Phase 2 完遂、`/demo/**` 削除 — 本決定でも keep)
