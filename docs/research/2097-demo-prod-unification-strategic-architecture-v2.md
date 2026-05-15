# Issue #2097 v2 戦略アーキテクチャ深層調査 (2 ヶ月リファクタリング前提)

> **目的**: 前回 v1 調査 (戦術レベル: ChildHomeViewModel + Service Interface) を **goal 視野狭窄** として再評価し、PO が指定した「demo と本番の体験等価性 / production 進化への自動追従 / demo 専用開発ゼロ / 全 page スコープ / 2 ヶ月リファクタ枠」に応える **戦略レベル** の判断材料を提供する。
>
> **対象**: PO の意思決定資料。実装提案ではなく、案 A〜E の trade-off と「PO がどの公理を選ぶか」の確認材料。

---

## エグゼクティブサマリー (3 行以内)

1. **OSS 実例 12 件を再評価した結果、「同じコードベース・同じ DB スキーマで demo と本番を駆動する」成功パターンは 3 系統に収斂**する: (a) **Demo Tenant + Real DB + Auth Bypass** (Supabase Anonymous Sign-In / Firebase / RouteBot / try.discourse.org / WordPress Multisite Cloner)、(b) **Sandbox = Forked Tenant** (Atlassian Jira / Stripe Sandboxes / GitLab Data Seeder)、(c) **Same Code + Different Env Var** (Vercel Preview / Shopify Dawn / Stripe Test Mode)。前回 v1 推奨案 (B = ViewModel + Service) は (b) と (c) の混合だが **DB を分けないことで「production 追従の構造保証」が弱い**。
2. **ganbari-quest の根本問題は「Service Interface 抽象化の有無」ではなく「demo data が production と異なる物理 DB に住んでいる」こと** — 91 サービスはすでに layer 分離されているが、demo 側は `demo-data.ts` 静的 seed + `sessionStorage` で同じ Service を通らない。`as never` キャストや「進捗 UI divergence」「shop tab divergence」は **DB を分けた帰結であり、ViewModel を導入してもこの根本構造は不変**。
3. **2 ヶ月リファクタ枠で `案 D: Demo Tenant Pattern` (実 DB に demo tenant + auth bypass + 期限付き seed reset) の現実適合度が最も高い** — production 追従は DB migration が一発で demo にも効くため構造的に保証、demo 専用 page (`/demo/**` 28 ディレクトリ) はほぼ撤去可能、Service / Repository / labels.ts の SSOT も保全。ただし「demo cookie が production 認証を bypass する」セキュリティ設計 + `is_demo` tenant flag の RLS 実装が新規必要。前回 v1 の案 B (ViewModel) は **案 D を補完する presentation 層整理** として併用すべきで、単独では goal 不達。

**推奨案 (1 行)**: **案 D「Demo Tenant Pattern」を主軸 + 案 B「presentation ViewModel」を併用**。ただし PO の §6 Q1〜Q4 (demo の goal / 永続性 / 認証境界 / 子供画面と親画面の demo 対称性) の回答次第で再評価が必要。

**PO への第一質問 (1 行)**: 「**demo の sessionStorage を捨て、実 SQLite DB の demo tenant に置換することを許容するか** — この 1 点で工数 (週 4 vs 週 8) と divergence 構造保証 (確率 vs 強制) が逆転する。」

**PO への第二質問 (1 行、§8 追加)**: 「**Pre-PMF 段階で infra コスト 2 倍 (Lambda + API Gateway + Cognito UserPool + DynamoDB Table を demo 環境用に複製) を許容するか** — Yes なら案 F/G (Multi-Lambda) が成立、No なら案 D 主軸 (同一 stack 内 tenant 分離) で確定する。」

**§5 推奨案 + §8 CDK 工数の総工数 (1 行 / 案)**:
- **案 A** (application 1-2 週 + CDK 0 週) = **1-2 週** / infra コスト変動なし
- **案 B** (application 4-5 週 + CDK 0 週) = **4-5 週** / infra コスト変動なし
- **案 C** (application 5-6 週 + CDK 0 週) = **5-6 週** / infra コスト変動なし (`:memory:` SQLite は Lambda メモリ内)
- **案 D 推奨主軸** (application 7-9 週 + CDK 0-1 週) = **7-10 週** / infra コスト変動なし (同一 stack に tenant 列追加のみ)
- **案 E** (application 5-6 週 + CDK 0 週) = **5-6 週** / infra コスト変動なし
- **案 F Multi-Lambda 想定** (application 4-6 週 + CDK 4-6 週) = **8-12 週** / infra コスト ~2 倍 (Lambda + API Gateway + Cognito UserPool 二重化)
- **案 G Multi-Lambda + Hybrid 抽象化 想定** (application 6-8 週 + CDK 5-7 週) = **11-15 週** / infra コスト ~2 倍 + cross-stack 参照運用負荷

---

## §1. 実 OSS 事例 (12 件、production app demo unification)

> v1 の 8 事例を再評価しつつ、Pre-PMF / 個人開発 / SQLite / Cognito の制約に照らして「ganbari-quest で実際に採用可能か」を再判定する。新規 4 件 (RouteBot、Atlassian、PostHog、WordPress Multisite Cloner) を追加。

### 1.1 Supabase Anonymous Sign-In (再評価: 適合度 高、ただし RLS インフラ前提)

**事実 (一次情報源で確認)**:
- 匿名ユーザは `auth.users` に**永続実体**として作成され、JWT に `is_anonymous` claim を埋め込む
- RLS policy は restrictive で書く必要があり、典型例として「permanent user のみ post 可能」を `(select (auth.jwt() ->> 'is_anonymous')::boolean) is false` で表現
- 匿名 → 認証への移行は `updateUser({ email })` または `linkIdentity({ provider: 'google' })` で **user_id を保持**したまま昇格
- IP-based rate limit (30 requests/hour、設定で変更可) + Cloudflare Turnstile or CAPTCHA 推奨 (abuse 対策)
- **無料の自動クリーンアップなし** — `auth.users` から `is_anonymous=true AND inactive>30d` を手動 SQL で削除する案内

**ganbari-quest 適合度**: SQLite + Drizzle で同等機能を自前実装する場合、Supabase の `auth.users` + `auth.jwt()` 相当を Cognito + `request_context.ts` の locals 経由で再現する必要がある。Cognito にも anonymous identity (Identity Pool 経由) は存在するが、ganbari-quest は User Pool 中心構成。**RLS は SQLite に存在しない**ため、Service / Repository 層で `tenant.is_demo=true` の query filter を強制する規律が必要 (= 案 D の核心)。

**Pre-PMF 評価**: ○ (思想流用、実装は自前)

---

### 1.2 Firebase Anonymous Authentication (再評価: Supabase と同一思想)

**事実**: `linkWithCredential` で UID 保持したまま認証 method を追加。FirebaseUI が標準で「demo 体験 → signup で引き継ぎ」を提供。

**ganbari-quest 適合度**: Cognito でも同じ「匿名→ permanent」昇格は理論上可能だが、Cognito Identity Pool + User Pool の組合せが必要で個人開発 Pre-PMF コストが過大。**ganbari-quest 文脈での「demo 永続化」は前回 v1 で議論済み (Q3) であり、PO 判断による**。

**Pre-PMF 評価**: △ (Cognito 制約で機構コスト高)

---

### 1.3 Stripe Test Mode / Sandboxes (再評価: 「同じ UI、別 DB」の典型)

**事実**:
- API key prefix (`sk_test_` vs `sk_live_`) で test/live を切替。**Dashboard UI は完全に同じコード**で test mode 切替時に top に badge を表示するのみ
- `sk_test_` 経由の requests は **完全に別の sandbox 環境**にルーティング、test mode の objects は live mode から見えない (逆も同様)
- Stripe Sandboxes (新機能、2024〜) は test mode の上位互換で、**1 アカウント内に複数の sandbox 環境**を持てる (`https://dashboard.stripe.com/sandboxes` で list)
- test data は banking network に到達しない (= side-effect free)

**ganbari-quest 適合度**: 「**同じ UI / 同じ API endpoint / key prefix で DB を切替**」という構造は ganbari-quest の `kind: 'production' | 'demo'` と同型。ただし Stripe は **サーバ側で完全に別の DB instance** を持っていて、ganbari-quest が demo 用に SQLite `:memory:` instance を立てる案 (前回 v1 案 C) と思想的に一致する。

**Pre-PMF 評価**: ○ (思想流用、cold start 問題は §5 案 D で吸収)

---

### 1.4 Vercel Preview Deployment (新規深掘り: 「同コード + 環境変数だけ違う」の極北)

**事実 (Vercel Docs)**:
- Preview と Production は**同じ codebase**が走る。違いは環境変数のみ
- `VERCEL_ENV` が `production` / `preview` / `development` を区別
- Sensitive variables は production / preview の両方で利用可
- branch-specific variables で「特定の PR branch だけ違う DB を見る」も可能

**ganbari-quest 適合度**: `/demo/**` URL path で切替えるのではなく、**環境変数 + ホスト名** で demo / production を切り替える設計に再構成する余地。例: `demo.ganbari-quest.app` (DEMO=1 + auth bypass) vs `app.ganbari-quest.app` (production)。ただし LP からの導線 (`https://app/demo/...`) と整合させる工数あり、Pre-PMF で価値あるかは PO 判断。

**Pre-PMF 評価**: △ (ドメイン分離は将来検討、PoC 段階では path 切替で十分)

---

### 1.5 Atlassian Jira Sandbox (新規深掘り: Premium 機能としての sandbox)

**事実 (Atlassian Support)**:
- Sandbox = production の clone (subset or full data コピー可)
- subdomain は `dev` / `test` / `uat` 等から選択可、URL で識別
- **作成に最大 30 分**、Premium / Enterprise plan 限定
- 28 日 inactive で自動 suspend、復帰には restore 必要
- Production への影響ゼロを保証 (= 異なる data store)

**ganbari-quest 適合度**: ✗ (ganbari-quest の demo は「LP 訪問者が瞬間体験」用途で、30 分作成 + Premium 限定の Atlassian sandbox とは要件が逆。ただし「**demo data はすべての production schema を継承するクローン**」という哲学は流用可)

**Pre-PMF 評価**: ✗ (要件不一致)

---

### 1.6 GitLab Data Seeder (新規深掘り: deterministic seed の極北)

**事実 (GitLab Docs)**:
- FactoryBot ベースの Data Seeder クラス、Ruby DSL or YAML で記述
- **base ID 1,000,000 を固定割当**して deterministic な ID を保証 (テスト再現性 / fixtures との衝突回避)
- Model 変更時に FactoryBot が自動追従 (= **production schema 変更が demo data に即反映**)
- Cloud Seed (別機構) は本物の cloud resource を seed として provision

**ganbari-quest 適合度**: 「**deterministic seed + production schema 自動追従**」という性質は demo data 設計で参考になる。ganbari-quest の `demo-data.ts` を Drizzle schema 連動の factory 関数群に置換する案 (=案 D の Pre-PMF 簡易版) は工数 1-2 週で済む。

**Pre-PMF 評価**: ○ (idea-level 流用、機構そのものは Rails 専用)

---

### 1.7 RouteBot Instant Live Demo (新規深掘り: zero-signup live demo の OSS 事例)

**事実 (DEV blog による直筆)**:
- アーキテクチャ: landing → demo proxy → backend API → MongoDB、**production と同一インフラ**
- demo tenant は POST で auto-generate (`companyId` + 24h 期限 + `isDemo: true` flag + admin user 作成 + 30-50 件の sample passenger / route / vehicle seed)
- **isolation は query level**: 全 query が `companyId` filter を含む (= 案 D の RLS 自前実装と同型)
- **restricted permissions**: SMS / export 等は demo で disable
- **clean-up**: hourly cron job で expired demo を transaction で cascade delete (Routes → Passengers → Vehicles → Drivers → Company)
- **同一 codebase で production と demo を駆動** — 「every new feature is automatically available in demos, eliminating sync issues」と明言
- **警告**: abuse 対策必須 (IP rate limit)、sample data の realism が conversion に直結、demo restricted action の messaging が UX に影響

**ganbari-quest 適合度**: **★★★ 最も思想的整合性が高い事例**。RouteBot の構造を ganbari-quest に投影すると:
- `companyId` ≒ `tenantId` (SQLite shared schema multi-tenant)
- `isDemo: true` flag ≒ `tenant.is_demo` column
- 24h 期限 ≒ `tenant.demo_expires_at` + cron job
- 30-50 件の sample ≒ ganbari-quest の demo-data.ts factory
- restricted permission ≒ Service 層で `if (tenant.is_demo && action === 'export') throw` 規律

**Pre-PMF 評価**: ◎ (個人開発 + Cognito + SQLite + Pre-PMF で実現可能、案 D の direct precedent)

---

### 1.8 Discourse try.discourse.org + rails_multisite (新規深掘り)

**事実 (Discourse Meta + GitHub)**:
- `rails_multisite` は **multi-DB** 方式 (各 site が独立 DB、shared schema ではない)
- `try.discourse.org` は developer seed data を使った demo (同じ data を local dev でも load 可能)
- `multisite.yml` で connection specs を定義、Discourse 本体は API 完全共通
- `discourse-seed-fu` は environment-specific fixtures (`db/fixtures/#{Rails.env}`) をサポート

**ganbari-quest 適合度**: SQLite + Drizzle で multi-DB は cold start コスト高、ganbari-quest 文脈では **shared schema + tenantId filter** が現実解 (= 案 D)。`db/fixtures/demo` ディレクトリで demo 専用 seed を管理する考え方は流用可。

**Pre-PMF 評価**: △ (multi-DB は Pre-PMF 過剰、seed 設計の参考のみ)

---

### 1.9 PostHog HogFlix Demo 3000 (新規深掘り)

**事実 (GitHub repo)**:
- HogFlix Demo 3000 は **stand-alone Flask app** で PostHog の analytics 機能を showcase
- `seed_demo_data.py` で pseudo-random data (default 30 days × 100 iterations) を生成、`500_names_and_emails.csv` を user 種データとして使用
- PostHog 本体 (Django + Clickhouse) とは別の app、PostHog instance には API key で接続
- Makefile shortcut で local + Docker + Codespaces 起動

**ganbari-quest 適合度**: PostHog の demo は「**本体 product の demo というより、analytics 機能の seeded showcase**」で、ganbari-quest が求める「本番アプリと同じ体験」とは性質が違う。ただし `seed_demo_data.py` の **pseudo-random + 名前リスト CSV** という構造は、demo 子供の名前 / 活動履歴 generation で流用可能。

**Pre-PMF 評価**: △ (思想は別、seed generation idea のみ流用)

---

### 1.10 WordPress Multisite + Multisite Cloner (新規深掘り)

**事実 (WordPress Codex + plugin docs)**:
- Multisite は **同一 WordPress core + 同一 wp-content + 別 DB tables** (`wp_X_posts` for site X)
- Multisite Cloner で「**1 click で template site から新 demo site をコピー**」(設定 / pages / posts / widgets / menus)
- 「Create Demo」ボタンを ad-hoc で実装する事例多数 (`InstaWP` / `MotoPress` の plugin が商用提供)
- super admin が network-wide theme / plugin を制御 → **同一 codebase で全 site が動く**

**ganbari-quest 適合度**: WordPress と SvelteKit の文化差が大きいが、「**1 つの codebase + 別 tenant の data + auto-clone**」というメンタルモデルは ganbari-quest 案 D と一致。Plugin 名 (`Multisite Cloner` / `InstaWP`) は技術名というより UX 名で、demo onboarding の参考事例として価値あり。

**Pre-PMF 評価**: △ (文化差大、思想流用のみ)

---

### 1.11 Shopify Dawn Theme (新規深掘り: same code + demo store)

**事実 (Shopify Theme Store)**:
- Dawn は **source-available reference theme**、13 個の free theme が同一 Online Store 2.0 architecture を共有
- Theme Store 提出には demo store 要件: **「fully realistic example of a merchant's business」** + 「no Lorem Ipsum / placeholder content」必須
- Dawn から派生した theme は Theme Store NG (= Dawn は学習用、本番 theme は Skeleton から派生する分離設計)

**ganbari-quest 適合度**: Shopify の「demo store = production-quality realistic content with same codebase」哲学は ganbari-quest LP の demo に直接適用可能。**「demo data が `lorem ipsum` 的に見える」と conversion が落ちる**という RouteBot 警告とも整合。

**Pre-PMF 評価**: ○ (demo data realism の指針として有効)

---

### 1.12 Sentry Sandbox / try.sentry.io (新規深掘り)

**事実 (sentry.io/demo/sandbox)**:
- 「live demo of Sentry that is a fully functional version you can explore without signing up」と明言
- 実際の Sentry production app の機能 (errors / traces / replays / spans / profiles / metrics) をすべて demo 可能
- sentry-demos org に micro-frontend 等の demo app あり、Sentry SDK 統合の参考

**ganbari-quest 適合度**: Sentry は「**サーバ側 demo data がすでに sown された production environment**」を提供しており、ganbari-quest 案 D とほぼ同型。「fully functional version」を強調する文言は LP メッセージにも流用可。

**Pre-PMF 評価**: ○ (思想流用、機構詳細は非公開)

---

### §1 まとめ表 (12 事例の再分類)

| カテゴリ | 事例 | データ層 | UI 層 | demo 永続化 | 工数 (ganbari-quest 投影) | Pre-PMF 適合度 |
|---|---|---|---|---|---|---|
| **(a) Demo Tenant + Real DB + Auth Bypass** | Supabase / Firebase / **RouteBot** / Discourse / WordPress Multisite | 同一 DB、tenant_id + is_demo flag | 同一 codebase | あり (期限付き) | 6-8 週 (=案 D 主軸) | **◎** |
| **(b) Sandbox = Forked Tenant** | Atlassian Jira / Stripe Sandboxes / GitLab Data Seeder | 別 DB instance / 別 schema | 同一 codebase | あり (長期) | 8-12 週 (機構過剰) | ✗ |
| **(c) Same Code + Different Env Var** | Vercel Preview / Shopify Dawn / Stripe Test Mode (key prefix) | 環境変数で DB 接続切替 | 同一 codebase | 環境別 | 4-6 週 (=案 A/D の前哨) | ○ |
| **(d) Standalone Demo App** | PostHog HogFlix / Sentry sentry-demos | 完全別 app + seeded data | **別 codebase** | あり | 当該事例は別概念 | △ |
| **(e) Server-Driven UI** | (v1 で Duolingo / Airbnb 言及、今回 Airbnb Ghost Platform 深掘り済) | サーバ配信 config | 同一 renderer | N/A | 過大 | ✗ |

**観察 (v1 から更新)**: 成功事例の 9 割で **「demo data が production と同じ DB / 同じ schema に住んでいる」**。前回 v1 で取り上げた Notion / Figma の URL 分離型は「demo data ≠ production data」前提だったため適合度低と再評価。RouteBot は **個人〜中規模 SaaS の direct precedent** として最も価値が高い。

**参考リンク** (本節):
- [Supabase Anonymous Sign-In Docs](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase Anonymous Sign-In Blog](https://supabase.com/blog/anonymous-sign-ins)
- [Firebase Anonymous Auth Best Practices](https://firebase.blog/posts/2023/07/best-practices-for-anonymous-authentication/)
- [Stripe API Keys Doc](https://docs.stripe.com/keys)
- [Stripe Sandboxes Blog (stripe.dev)](https://stripe.dev/blog/avoiding-test-mode-tangles-with-stripe-sandboxes)
- [Vercel Environments Doc](https://vercel.com/docs/deployments/environments)
- [Vercel Environment Variables Doc](https://vercel.com/docs/environment-variables)
- [Atlassian Sandboxes Manage Doc](https://support.atlassian.com/organization-administration/docs/manage-atlassian-sandboxes/)
- [Atlassian Jira Family Sandbox Doc](https://support.atlassian.com/organization-administration/docs/jira-family-and-sandboxes/)
- [GitLab Data Seeder Doc](https://docs.gitlab.com/development/data_seeder/)
- [GitLab Cloud Seed Doc](https://docs.gitlab.com/cloud_seed/)
- [RouteBot Live Demo dev.to](https://dev.to/emrahg/how-we-built-an-instant-live-demo-system-for-our-saas-product-5d8k)
- [discourse/rails_multisite GitHub](https://github.com/discourse/rails_multisite)
- [discourse/discourse-seed-fu GitHub](https://github.com/discourse/discourse-seed-fu)
- [Discourse Multisite Config Meta](https://meta.discourse.org/t/multisite-config/146420)
- [PostHog/posthog-demo-3000 GitHub](https://github.com/PostHog/posthog-demo-3000)
- [Shopify/dawn GitHub](https://github.com/Shopify/dawn)
- [Shopify Theme Store Requirements](https://shopify.dev/docs/storefronts/themes/store/requirements)
- [Sentry Demo Sandbox](https://sentry.io/demo/sandbox/)
- [InstaWP: Create WordPress Demo with Multisite](https://instawp.com/how-to-create-a-wordpress-demo-site-with-multisite/)
- [MotoPress: Multisite Network Demos](https://motopress.com/blog/create-separate-demos-for-wordpress-products-from-one-multisite-network/)
- [Airbnb Ghost Platform Deep Dive (Medium)](https://medium.com/airbnb-engineering/a-deep-dive-into-airbnbs-server-driven-ui-system-842244c5f5)

---

## §2. クラス設計・抽象化パターン (9 件、深掘り)

### 2.1 Hexagonal Architecture (Ports & Adapters)

**事実 (Cockburn + onicagroup/hexagonal-example + jkonowitch/hex-effect)**:
- Port = interface (技術非依存)、Adapter = implementation (技術依存)
- TypeScript 実装事例多数 (`onicagroup/hexagonal-example`, `JoseClaudioADS/hexagonal-architecture-typescript-example`)
- **`jkonowitch/hex-effect` は SvelteKit + Effect-TS で hexagonal を実現する reference 実装**: `apps/web` で SvelteKit UI、`@projects` bounded context、`@hex-effect/infra-kysely-libsql-nats` で infrastructure adapter swap

**ganbari-quest 適合度**:
- ADR-0046 (Service Interface + Context DI) は hexagonal の partial 実装
- **完全 hexagonal 化**は 91 サービス全てに Port / Adapter を生やすことになり、Pre-PMF で過剰
- **部分 hexagonal**(主要 Service 10-15 個に絞って Repository pattern を厳密化) は案 D と相性が良い

**Pre-PMF 評価**: ○ (部分採用、フル装備は ✗)

---

### 2.2 Clean Architecture (Onion) + ViewModel

**事実 (Niko Heikkilä blog + Three Dots Labs critique)**:
- Niko Heikkilä の SvelteKit clean architecture シリーズ ([記事](https://nikoheikkila.fi/blog/clean-frontend-architecture-with-sveltekit/)) は 5 部構成 (Preface / Domain Modelling / Use Cases / Server-Side Routes / Data Loading)
- 各 page load は **service layer のみを呼ぶ**、service layer が domain model に変換、UI は domain model 受領
- composite DTOs を `views/` に置き、UI 用集約 type として使用
- **Three Dots Labs** の批判: 「Clean Architecture は MVP / 個人開発で over-engineering、interface 1 つに concrete 1 つなら interface を消すべき」

**ganbari-quest 適合度**:
- v1 案 B (ChildHomeViewModel) は clean architecture の VM 層に相当
- **clean architecture フル装備 (Domain / Application / Infra 完全分離)** は Pre-PMF で過剰だが、`views/` ディレクトリで composite DTO を 1 ファイル / page 保つルールは現実的
- 91 サービスをすべて clean に直すのは ✗、主要 page (child home / status / admin home) で先行採用 → 必要に応じ拡大

**Pre-PMF 評価**: ○ (部分採用)、フル装備は ✗

---

### 2.3 DDD Bounded Context + Anti-Corruption Layer

**事実 (Azure / DDD-Practitioners)**:
- 異なる context 間で domain model が汚染されないよう ACL (translator) を挟む
- `jkonowitch/hex-effect` で **`@projects` / `@team` のような bounded context 分離** + domain events によるコミュニケーションを示す

**ganbari-quest 適合度**:
- bounded context 分離は 91 サービスを「**child gamification context / parent admin context / billing context / marketplace context**」等に分けると見通しは良くなる
- ただし **2 ヶ月リファクタ枠で 91 サービスの context 再分類は不可能**、子供画面 + 親管理画面の 2 context 程度に粗く分けるのが現実解

**Pre-PMF 評価**: △ (粗い分離のみ、フル DDD は ✗)

---

### 2.4 Repository Pattern (Production-grade)

**事実 (Fyapy DEV / LogRocket / 4markdown)**:
- Repository = data access の interface、business logic は interface に依存
- Generic Repository (`IRepository<T>`) は debatable: 一部論者は SOLID OCP に適合と主張、別論者は「YAGNI 違反、CRUD だけで終わるなら ORM 直接使え」と批判
- **production 推奨**: 「ORM の built-in repository を base に、必要部分だけ抽象化」「Repository is a tool, not a religion」
- in-memory Repository (`MemoryProductRepository`) + production Repository (`MongoDBProductRepository`) を同じ interface で並走させる Fake パターン (Shai Yallin)

**ganbari-quest 適合度**:
- ganbari-quest 現状: Service layer は存在するが Repository が不在 (= Service が Drizzle 直接呼出)
- **案 D に必須**: `ActivityRepository` / `ChildRepository` 等を新設し、本番では Drizzle 経由、demo では同じ Drizzle 経由 (tenant filter 切替) で動かす設計
- **Generic Repository は不要**: 91 サービスを generic 化すると abstraction 病、必要に応じ個別 Repository

**Pre-PMF 評価**: ◎ (案 D の核心、追加工数 2-3 週)

---

### 2.5 Test Double 体系 (Mock / Stub / Fake / Dummy / Spy) — Fowler

**事実 (Martin Fowler bliki:TestDouble + Shai Yallin "Fake, Don't Mock")**:
- **Fake**: 「working implementations, but usually take some shortcut which makes them not suitable for production」(Fowler 原文)
- in-memory database が代表例
- Fake は Mock より結合度が低く、business outcome を assert できる
- **Contract Test** で Fake と real impl を同じテストで verify する → 両者の振舞い一致を保証
- 「Fake が production grade に進化する」のではなく、Contract Test で両者を contract に縛る

**ganbari-quest 適合度**:
- ganbari-quest の demo data + sessionStorage 実装は **「production-grade ではない Fake」** の典型
- これを **「production-grade ではない Fake」ではなく「production-grade Real (実 DB の demo tenant)」** にするのが案 D
- Contract Test (本番 / demo 両 Service を同じ test suite で走らせる) は ganbari-quest の retrofit が容易

**Pre-PMF 評価**: ◎ (案 D + Contract Test で divergence 自動検知)

---

### 2.6 Multi-tenancy パターン (Shared Schema + Row Filter)

**事実 (CockroachLabs / Azure / Drizzle + Nile / dev.to Laravel)**:
- 3 つの主要パターン:
  - **Shared schema + tenant_id column** (pooled model): 全 tenant データが同じ table、最も低コスト
  - **Schema-per-tenant**: tenant ごとに別 schema、middle ground
  - **DB-per-tenant**: 完全分離、最高コスト
- Postgres RLS で `(tenant_id = current_setting('app.tenant_id')::uuid)` 強制が定番
- **Drizzle + Nile** は AsyncLocalStorage で tenant context 伝播、`set local nile.tenant_id` でクエリ自動 filter
- **mateusflorez/drizzle-multitenant** plugin で schema isolation も可能

**ganbari-quest 適合度**:
- SQLite は **RLS をネイティブサポートしない** → application 層で `tenant_id` filter を強制する規律が必要
- **Shared schema + tenantId column + Service 層強制** が現実解
- demo tenant は `tenant.id = 'demo-xxx'` + `tenant.is_demo = 1` で識別

**Pre-PMF 評価**: ◎ (案 D の DB 基盤、SQLite で実現可、工数 2-3 週)

---

### 2.7 Feature Flag at Architecture Level (LaunchDarkly arch)

**事実 (LaunchDarkly / dev.to freemium SaaS)**:
- flag は「**UI から billing/auth logic を分離**」する。`<FeatureGate feature="X" mode="hide|replace">` パターン
- Slack 2020 / Facebook 2021 の outage 事例で flag combinatorial explosion が問題化

**ganbari-quest 適合度**: ✗ (demo / production の差分が 5+ 項目あり、flag 化すると組合せ爆発。案 D で構造的に divergence を消すほうが健全)

**Pre-PMF 評価**: ✗

---

### 2.8 Server-Driven UI (Duolingo Lona / Airbnb Ghost Platform) — 再評価

**事実 (Airbnb Engineering Medium 深掘り完了)**:
- Ghost Platform は GraphQL schema + Section components + Layout system の 3 層
- Section = 「translated, localized, formatted な data container」、Screen = layout 定義
- iOS / Android / Web の native renderer
- 「**still in its infancy**」と著者が明言 (1 年経過時点)

**ganbari-quest 適合度**: ✗ (Pre-PMF 個人開発で SDUI runtime + schema 管理コスト過大、Spotify HubFramework 2019 deprecated の前例)

**Pre-PMF 評価**: ✗

---

### 2.9 MV-VI / Container-Presentational + ViewModel (v1 推奨案 B の再評価)

**事実 (Patterns.dev / dev.to MV-VI)**:
- View が ViewModel に依存、ViewModel が domain に依存、UI は presentation のみ
- React Container/Presentational 分離パターンの一般化

**ganbari-quest 適合度**:
- v1 案 B (ChildHomeViewModel) はこれに相当
- **単体では goal 不達**: ViewModel は presentation 層の divergence を表現するだけで、DB が別なら data divergence は残る
- **案 D と併用すべき**: 案 D で data 層を統合した上で、UI 層の年齢モード差や進捗 UI 変動を ViewModel に閉じ込める

**Pre-PMF 評価**: ○ (案 D の補完として併用)

---

### §2 まとめ表 (9 パターン、Pre-PMF + 2 ヶ月枠 + ganbari-quest 適合度で再評価)

| パターン | 既採用 | Pre-PMF 適合 | 2 ヶ月枠で実現可 | 工数 | 主リスク |
|---|---|---|---|---|---|
| Hexagonal (部分) | ◯ | ○ | ○ | 1-2 週 | Adapter 増殖 |
| Clean Architecture フル | ✗ | ✗ | ✗ | 4+ 週 | over-engineering |
| Clean Architecture (composite DTO のみ) | △ | ○ | ○ | 1 週 | 規律維持 |
| DDD Bounded Context | △ | △ | △ (粗のみ) | 1-2 週 | 191 サービス分類困難 |
| Repository Pattern (主要 10-15 個) | △ | ○ | ○ | 2-3 週 | YAGNI |
| Fake + Contract Test | ✗ | ○ | ○ | 1 週 | 既存 Service の retrofit |
| Multi-tenancy (Shared schema) | ✗ | ◎ | ○ | 2-3 週 | RLS なし → 規律必須 |
| Feature Flag | △ | ✗ | △ | 1+ 週 | 組合せ爆発 |
| Server-Driven UI | ✗ | ✗ | ✗ | 6+ 週 | 機構過剰 |
| MV-VI (ViewModel) | △ | ○ | ○ | 2-3 週 | divergence 構造保証なし |

**参考リンク** (本節):
- [Alistair Cockburn: Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture)
- [onicagroup/hexagonal-example (TypeScript)](https://github.com/onicagroup/hexagonal-example)
- [jkonowitch/hex-effect (SvelteKit + Effect-TS)](https://github.com/jkonowitch/hex-effect)
- [Niko Heikkilä: Clean Frontend Architecture with SvelteKit](https://nikoheikkila.fi/blog/clean-frontend-architecture-with-sveltekit/)
- [Three Dots Labs: Is Clean Architecture Overengineering?](https://threedots.tech/episode/is-clean-architecture-overengineering/)
- [Azure ACL Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)
- [DDD-Practitioners: ACL](https://ddd-practitioners.com/home/glossary/bounded-context/bounded-context-relationship/anticorruption-layer/)
- [Martin Fowler: TestDouble](https://martinfowler.com/bliki/TestDouble.html)
- [Shai Yallin: Fake, Don't Mock](https://www.shaiyallin.com/post/fake-don-t-mock)
- [Drizzle Multi-tenancy with Nile (公式 tutorial)](https://orm.drizzle.team/docs/tutorials/drizzle-with-nile)
- [mateusflorez/drizzle-multitenant GitHub](https://github.com/mateusflorez/drizzle-multitenant)
- [Drizzle schema-based multi-tenancy discussion #3199](https://github.com/drizzle-team/drizzle-orm/discussions/3199)
- [LogRocket: Repository pattern TypeScript Node](https://blog.logrocket.com/exploring-repository-pattern-typescript-node/)
- [Patterns.dev: Container/Presentational](https://www.patterns.dev/react/presentational-container-pattern/)
- [Feature Sliced Design: Svelte Architecture](https://feature-sliced.design/blog/simple-svelte-architecture)
- [Ben Morris: The Shared Code Fallacy](https://www.ben-morris.com/the-shared-code-fallacy-why-internal-libraries-are-an-anti-pattern/)

---

## §3. SvelteKit / Svelte 5 固有の制約と機会

### 3.1 `+layout.server.ts` chain + locals + per-request DI

**事実 (Khromov + SvelteKit Hooks Doc)**:
- `event.locals` は **trusted server-side per-request state**、`hooks.server.ts` の `handle` で populate
- `+layout.server.ts` chain で data inheritance、parent layout の data は child route から `event.parent()` で参照可
- Repository / Service 注入は `hooks.server.ts` で `event.locals.repository = new ProductionRepository(...)` を行うのが定番
- demo / production の切替は `event.url.pathname.startsWith('/demo')` または `event.cookies.get('gq_demo')` で分岐
- **Caveat**: `+layout.server.ts` の戻り値は HTML に serialize される → secret 入りデータ NG

**ganbari-quest 適合度**:
- 既存の `gq_demo` cookie + `hooks.server.ts` 分岐は **案 D の auth bypass 経路として基盤が整っている**
- Repository 注入を `event.locals.repository` に集約することで全 route が同じ data path を通る

**Pre-PMF 評価**: ◎ (既存基盤に乗る、追加工数 0.5 週)

---

### 3.2 Svelte 5 `createContext` + class fields with `$state`

**事実 (Svelte Docs + joyofcode)**:
- Svelte 5.40+ で `createContext` 型安全 helper 公式追加
- `class` field で `#status = $state<...>(...)` を持つことで Service instance に reactive state を埋め込める
- `+layout.svelte` で `setContext(serviceInstance)` → child component で `getContext()`
- root layout で context を作ると per-request safe (SSR ごとに再生成)

**ganbari-quest 適合度**:
- v1 ADR-0046 で既採用
- 案 D で Repository を `event.locals` 経由 server 側で注入、Service を `createContext` で client / SSR 共通注入する 2 段構成が clean

**Pre-PMF 評価**: ◎ (既採用)

---

### 3.3 Form Actions vs API endpoints vs RPC

**事実 (SvelteKit Form Actions Doc + tRPC SvelteKit 事例)**:
- Form Actions は progressive enhancement、CSRF token 内蔵
- API endpoints (`+server.ts`) は SPA-like UX 向け
- tRPC は type-safe RPC、SvelteKit 統合事例あり

**ganbari-quest 適合度**:
- 91 サービスを Form Action と `+server.ts` の両方で呼ぶ現状 → demo は client-only sessionStorage 更新
- 案 D で demo も Form Action / `+server.ts` を経由するように統合可能 (demo cookie で auth bypass、Service が tenant filter)
- tRPC 移行は 2 ヶ月枠で過剰、現状の API 構造維持で OK

**Pre-PMF 評価**: ○ (現状維持、demo 側を本番経路に統合)

---

### 3.4 Drizzle ORM + SQLite in-memory / multi-tenant

**事実 (Drizzle Discussion #784 / #3199 / Drizzle + Nile)**:
- `new Database(':memory:')` で in-memory SQLite 起動可、Drizzle 互換
- multi-tenant は **shared schema + tenant_id column** が Drizzle 推奨 (Nile 統合で公式 tutorial 化)
- in-memory SQLite を用いた testing は debatable、production と振舞いが乖離する可能性
- driver compatibility 警告: SQLite と MySQL は同じ Drizzle interface でも振舞い異

**ganbari-quest 適合度**:
- 現行 SQLite production 環境で **demo tenant を同じ DB に格納** (案 D) すれば driver 不一致問題なし
- **in-memory SQLite を demo 用に分離する案 (v1 案 C)** は cold start で session 消失するため Pre-PMF で ✗

**Pre-PMF 評価**: ◎ (案 D の物理基盤)

---

### 3.5 SvelteKit large app patterns

**事実 (Loopwerk / OES Technology / supastarter)**:
- 大規模 SvelteKit codebase の推奨 pattern: domain-driven directory + lib/server/services + lib/server/db
- ganbari-quest の `src/lib/server/services/*.ts` 91 ファイルは既に同パターンに準拠
- 「only the server fetches data」原則徹底必須

**ganbari-quest 適合度**: ○ (既準拠)

---

### §3 SvelteKit 固有まとめ

- **Per-request DI** (`hooks.server.ts` → `event.locals.repository`) と **Per-render DI** (`+layout.svelte` → `setContext(service)`) の 2 段構成が clean architecture と整合
- **demo / production 切替は cookie or path で `hooks.server.ts` で 1 箇所判定**、その先は Repository が tenant filter で吸収
- Form Action + `+server.ts` を demo / production 共通経路にすることで Service / Repository 層の SSOT が成立
- Drizzle で shared schema multi-tenant は公式パターン、SQLite で application 層 filter 強制が現実解

**参考リンク** (本節):
- [SvelteKit Hooks Doc](https://svelte.dev/docs/kit/hooks)
- [Khromov: Comprehensive Guide to Locals](https://khromov.se/the-comprehensive-guide-to-locals-in-sveltekit/)
- [SvelteKit Loading Data Doc](https://svelte.dev/docs/kit/load)
- [SvelteKit Form Actions Doc](https://svelte.dev/docs/kit/form-actions)
- [Svelte Context Doc](https://svelte.dev/docs/svelte/context)
- [Drizzle ORM SQLite Doc](https://orm.drizzle.team/docs/get-started/sqlite-new)
- [Drizzle ORM Discussion #784: testing](https://github.com/drizzle-team/drizzle-orm/discussions/784)
- [Drizzle ORM Discussion #3199: multi-tenancy](https://github.com/drizzle-team/drizzle-orm/discussions/3199)
- [Loopwerk: SvelteKit Architecture](https://www.loopwerk.io/articles/2022/sveltekit-architecture/)
- [OES Technology: Architectural Patterns for Scaling SvelteKit](https://oestechnology.co.uk/posts/architectural-patterns-scaling-sveltekit)

---

## §4. ganbari-quest 構造分析 (根本問題の言語化、仮説 A-D 再検証)

### 4.1 現状アセスメント (実装読まず、メタデータから)

| 軸 | 現状 |
|---|---|
| Service layer | `src/lib/server/services/*.ts` 91 ファイル (Repository ではなく Service、Drizzle 直接呼出多数) |
| Repository pattern | 不在 (`src/lib/server/db/` に schema、Service が直接 query) |
| Demo data | `src/lib/server/demo/demo-data.ts` 静的 seed + `sessionStorage` |
| Demo route | `/demo/**` 27 ディレクトリ (child 5 + parent admin 13 + signup 1 + layout 等) |
| Production route | `/(child)/` 8 ディレクトリ + `/(parent)/admin/` 22 ディレクトリ |
| 並行実装ペア | 12 カテゴリ (parallel-implementations.md より) |
| Service Interface (ADR-0046) | 1 ページ POC (child home) + 1 ページ Tier 2.5 (本番 child home 部分共通化) |

### 4.2 「mock 差し込み困難 = 抽象化不足」仮説の再検証

PO の指摘:「mock 差し込み困難は抽象化設計不足の証左、抽象化を直す」

**仮説 A (Service 層の Drizzle 直接結合)**: ◎ 仮説妥当性高
- 91 Service が Drizzle (`db.select().from(...)`) を直接呼出 → Repository 不在
- demo で同じ Service を通すには Drizzle instance を切替える必要があるが、Service が import で固定参照しているため不可
- **結論**: Repository pattern 導入 + Service を Repository 経由に書換え (= 案 D の前提工程)

**仮説 B (Form Action が production / demo で別実装)**: ○ 部分妥当
- production: `+page.server.ts` `actions` で auth check → Service 呼出
- demo: `/demo/.../+page.server.ts` で seed 返却、actions なし、client が sessionStorage 更新
- **結論**: 案 D で demo も `actions` を持ち、Service が tenant filter で吸収

**仮説 C (Repository 不在、Service が直接 Drizzle)**: ◎ 仮説妥当性高 (仮説 A と同根)

**仮説 D (5 年齢モード × 性別 × プラン状態の組合せ爆発で抽象化困難)**: △ 部分妥当
- 年齢モード差は labels.ts + age-tier.ts で集約済
- 性別バリアントは marketplace と child profile で限定スコープ
- プラン状態 (`plan-features.ts` SSOT) は SSOT 化済
- **結論**: 組合せ爆発は **labels.ts 階層化と plan-features.ts 統合で 80% 解決済**、残り 20% は ViewModel 層で吸収 (= v1 案 B 適用)

### 4.3 「demo data ≠ production data」の構造的帰結

**現状の構造的問題**:
- demo data は `demo-data.ts` 静的 seed (約 38KB、子供 1 + 活動 10 件 + history 数件)
- production schema が変わるたびに demo-data.ts を手動で同期 (= 並行実装ペア #3)
- demo の sessionStorage 更新ロジックは demo-service.ts に独立、production Service の進化に追従しない
- → **「production を直したら demo も直す」が手動規律になっている**

**v1 推奨案 B (ViewModel) で解決しない理由**:
- ViewModel は presentation 層の divergence を吸収するだけ
- **DB が別なら data divergence は不変** (schema 追加で demo が壊れ続ける)
- 「進捗 UI / activity 数 / counter badge / shop tab / currency」5 項目の divergence は **すべて data 層由来**、ViewModel では構造保証できない

**案 D で解決する理由**:
- demo data = production data structure (同じ DB schema)
- demo tenant に sown された seed が production と同じ Service / Repository を通る
- production schema migration が demo にも適用 (Drizzle migrate 1 回で済む)
- → **「production を直したら demo も自動的に直る」が構造保証**

### 4.4 過去 7 回失敗の構造的分類 (v1 から更新)

| # | 失敗パターン | v1 分類 | v2 で見直した根本要因 |
|---|---|---|---|
| 1 | Tier N 統合計画 (#531) | 計画段階で挫折 | UI 統合だけ計画、data 層は手付かず |
| 2 | POC scope 切り (#561) | scope 矮小化 | 「demo の goal」未確定で scope 切れず |
| 3 | 等価性維持 (#562) | 哲学衝突 | demo data ≠ production data 構造未解決 |
| 4-5 | 足場 (shim) (#563, #566) | shim 漏れ | 同上、shim は構造問題の symptom |
| 6 | Service Interface POC (#2069) | 部分達成 | UI 層は揃ったが data 層分離継続 |
| 7 | demo 寄せ統合 degrade (PR #2099) | 機構整備失敗 | 同上 |
| 8 | snapshot+patch 警告 | 哲学衝突 | demo / production 同じ DB に住んでない |

**共通構造**: 過去 7 回は **「UI 統合」のみアプローチして、data 層 (DB / Repository) は分離継続**。8 回目の goal (PO 提示) で初めて「demo data を実 DB に置く」が議題に上がった。

---

## §5. 推奨アーキテクチャ案 (5 案、2 ヶ月工数前提、抽象化レベル別)

### 案 A: 最小抽象化 (現状 Service Interface 維持、ViewModel 追加のみ) — v1 案 B 単独

**抽象化レイヤー構成**:
- Service Interface (現状) + ViewModel (新規 presentation 層)
- Repository は導入しない

**demo / production の境界**:
- `kind: 'production' | 'demo'` フラグでサービス実装切替
- demo data は sessionStorage 維持

**DB 戦略**: 現状維持 (production: SQLite + Drizzle、demo: sessionStorage + 静的 seed)

**production 追従仕掛け**:
- 手動 (現状と同じ)、demo-data.ts を schema 変更時に追従

**工数**: 1-2 週

**失敗リスク**:
- **data 層 divergence は残る** → 再び haribote 化リスク高
- ViewModel だけでは「demo に shop tab がない」のような機能セット divergence を解決できない

**過去 7 回 haribote 回避策**: 弱 (presentation 層のみ規律化)

**Pre-PMF 適合度**: ◎ (機構変更小)

**PO goal 達成度**: 1/7 (presentation 等価のみ)

---

### 案 B: 中抽象化 (Repository Pattern 導入、Drizzle Repository を Production / Demo で別実装)

**抽象化レイヤー構成**:
- Repository interface (新規) + Production Repository (Drizzle) + Demo Repository (in-memory + sessionStorage)
- Service は Repository に依存

**demo / production の境界**:
- Repository 実装で完全 swap
- demo Repository は in-memory Map + sessionStorage hybrid

**DB 戦略**: production: SQLite、demo: in-memory Map (sessionStorage 永続化)

**production 追従仕掛け**:
- Repository interface に method 追加すると demo Repository も実装必須 (型強制)
- ただし demo data shape は Repository interface の type に従う → schema 変更時は demo data 再生成手動

**工数**: 4-5 週

**失敗リスク**:
- Repository interface が肥大化 (CQRS 風分離が必要に)
- 91 サービス全部を Repository 化するか部分かの判断が必要
- demo Repository の in-memory 実装が production Drizzle の振舞いと乖離する可能性 (transaction / index 等)

**過去 7 回 haribote 回避策**: 中 (型強制で構造保証だが、demo data shape の手動同期残)

**Pre-PMF 適合度**: ○

**PO goal 達成度**: 4/7 (本番アプリと同じ体験 / 個別開発不要 / 抽象化設計 ○、production 追従は半自動)

---

### 案 C: Server-side demo Drizzle (Stripe test mode 流、v1 案 C)

**抽象化レイヤー構成**:
- 別 Drizzle instance (production: file SQLite、demo: `:memory:` SQLite)
- Service は instance を切替えて呼出

**demo / production の境界**:
- request 単位で Drizzle instance branch (`if (isDemo) demoDb else prodDb`)

**DB 戦略**: production: file SQLite、demo: `:memory:` SQLite

**production 追従仕掛け**:
- Drizzle migrate を demo instance にも適用 → 構造的に追従

**工数**: 5-6 週

**失敗リスク**:
- **Lambda / serverless cold start で demo session 消失** → 子供が「さっき記録したのに消えた」体験
- 認証 bypass の設計ミスで本番認証 bypass 漏れリスク
- in-memory instance を request 間で共有する場合の同時アクセス問題

**過去 7 回 haribote 回避策**: 強 (同じコード / 同じ schema / 同じ migration)

**Pre-PMF 適合度**: △ (serverless cold start + session 隔離コスト高)

**PO goal 達成度**: 5/7 (本番アプリと同じ体験 / production 追従自動 / 個別開発不要 / 抽象化設計、ただし cold start で UX 毀損)

---

### 案 D: **Demo Tenant Pattern (RouteBot / Supabase 流) — 推奨主軸**

**抽象化レイヤー構成**:
- Repository pattern (案 B と同じ)
- 全 Repository は `tenant_id` filter を強制 (application 層 RLS)
- `tenant.is_demo = 1` flag で demo / production を識別

**demo / production の境界**:
- 同じ Drizzle、同じ DB、同じ Service、同じ Repository
- demo cookie (`gq_demo`) で `event.locals.tenantId = 'demo-xxx'` 注入
- Service / Repository は **tenant_id 以外を意識しない**

**DB 戦略**:
- 単一 SQLite file
- shared schema + `tenant_id` column 全 table
- demo tenant は `tenant.id = 'demo-xxx-{sessionId}'` で session 単位 isolate (sessionId は HMAC + IP 等から生成)
- demo data は seed factory (`createDemoTenant(opts)`) で session ごとに生成、期限切れで自動削除 (cron)

**production 追従仕掛け**:
- Drizzle migrate 一発で demo にも適用 (構造的保証)
- 新しい Service / 新しい page を作ったら **demo cookie 経由で自動的に動く** (auth bypass のみ +1 行)
- demo 専用ファイル (`demo-data.ts` / `demo-service.ts` / `/demo/**` route) は **撤去可能**

**工数**: 7-9 週 (= 2 ヶ月、PO 提示工数枠と一致)

**段階別 milestone (8 週)**:
1. **週 1-2**: Repository pattern 導入 (主要 15 サービスから)
2. **週 3**: tenant_id column 全 table 追加 + Drizzle migration + application 層 filter 強制
3. **週 4**: `tenant.is_demo` flag + demo seed factory + cron cleanup
4. **週 5**: `hooks.server.ts` + `event.locals` で demo cookie → tenantId 注入
5. **週 6**: `/demo/**` ルート撤去、`/(child)/` `/(parent)/` を `gq_demo` cookie で auth bypass
6. **週 7**: ViewModel 層追加 (年齢モード / プラン状態の presentation divergence 吸収、v1 案 B 併用)
7. **週 8**: Contract Test (本番 / demo の同 test suite 実行) + 並行実装ペア cleanup + 設計書同期

**失敗リスク**:
- 認証 bypass 設計ミスで本番認証 bypass 漏れ (= **最重要セキュリティリスク**)
- tenant_id filter 強制を 91 Service にレトロフィットする工数見積もり過小可能性
- 5 年齢モード × 性別 × プラン状態の demo seed 設計の網羅性 (Q3 / Q7 PO 判断必要)

**過去 7 回 haribote 回避策**: **最強** (data 層で divergence 構造的に発生しない)

**Pre-PMF 適合度**: ○ (RouteBot precedent、SQLite + Cognito で実現可)

**PO goal 達成度**: **7/7 (全 PO goal 達成、ただしセキュリティ設計が厳密)**:
- ✓ 本番アプリと同じ体験 (同 Service / 同 UI / 同 schema)
- ✓ production 追従 (DB migrate 自動、構造保証)
- ✓ 個別開発不要 (demo 専用ファイル撤去可能)
- ✓ 実 DB に demo data seed (shared schema + tenant_id)
- ✓ クラス設計レベル抽象化 (Repository pattern + tenant_id filter)
- ✓ 2 ヶ月リファクタ枠 (週 8、PO 工数と一致)
- ✓ 全 page スコープ (28 demo route 撤去で自動的に本番 page が demo として動く)

**残課題 (PO 判断必要)**:
- demo signup 時に既存 demo tenant data を本番 user に移行するか (Q3)
- demo session 期限 (24h? 1h? unlimited?)
- demo abuse 対策 (CAPTCHA / IP rate limit / Cloudflare Turnstile)

---

### 案 E: Hybrid (UI / Form Action は完全共有、データ層のみ tenant 切替)

**抽象化レイヤー構成**:
- 案 D の subset: tenant_id filter は導入、Repository pattern は導入しない
- Service が tenant_id を locals から取得して Drizzle query に直接埋め込み

**工数**: 5-6 週

**失敗リスク**: tenant_id filter を 91 Service に埋め込む規律維持コスト

**Pre-PMF 適合度**: ○

**PO goal 達成度**: 5/7 (Repository 抽象化なしで案 D の本質を簡易実装、ただし testability 低)

---

### §5 案比較表

| 観点 | 案 A | 案 B | 案 C | **案 D (推奨)** | 案 E |
|---|---|---|---|---|---|
| 工数 | 1-2 週 | 4-5 週 | 5-6 週 | **7-9 週** | 5-6 週 |
| 抽象化レベル | 低 | 中 | 中 | **中-高** | 中 |
| 機構変更規模 | 小 | 中 | 大 | **大** | 中-大 |
| DB 戦略 | 現状 | demo: in-memory | 別 instance | **同一 DB + tenant_id** | **同一 DB + tenant_id** |
| haribote 回避 | 弱 | 中 | 強 | **最強** | 強 |
| production 追従 | 手動 | 半自動 | 自動 | **完全自動** | 自動 |
| 個別開発不要 | ✗ | △ | ○ | **◎** | ○ |
| Pre-PMF 適合 | ◎ | ○ | △ | ○ | ○ |
| Anti-engagement 整合 | ○ | ○ | △ (cold start UX) | ○ | ○ |
| セキュリティリスク | 低 | 低 | 中 | **中-高 (要設計)** | 中-高 |
| PO goal 達成度 | 1/7 | 4/7 | 5/7 | **7/7** | 5/7 |
| OSS precedent | (v1 のみ) | Drizzle test | Stripe Sandbox | **RouteBot / Supabase** | (なし) |

---

## §6. PO への質問項目 (scope 拡張で再質問、15 件)

### Q1 (最重要、v1 から継承). demo の goal は何か?

選択肢:
- A. LP 訴求のためのマーケティング素材
- B. 未認証で本番 UX を体験させるオンボーディング
- C. production と完全 parity のデモンストレーション
- D. 上記すべて (全部実現したい)

含意: 案 D は B/C/D に最適、A 単独なら案 A/B で十分。

---

### Q2. demo data の永続化レベルは?

選択肢:
- A. 揮発 (現状の sessionStorage、タブ閉じれば消える)
- B. 短期永続 (24h、案 D RouteBot 流)
- C. 長期永続 (signup まで保持)
- D. signup 時に本番 user に data 移行

含意: B/C は案 D 必須、A なら案 A/B で済む。

---

### Q3 (新規、最重要). demo を実 DB に置くことのセキュリティ境界をどう設計するか?

- demo cookie 経由で auth bypass する場合、本番認証 bypass 漏れリスクをどう防ぐか
- demo cookie は IP / User-Agent / Origin で binding するか
- demo tenant への書込みは production user から完全に visible でないことを RLS / Repository filter で保証するか

含意: 案 D 採用時に **CRITICAL** な設計判断。Cognito 認証チェック路と demo bypass 路が同一 `+layout.server.ts` に同居することの危険度を評価必須。

---

### Q4 (新規). production schema migration を demo にも自動適用するか?

選択肢:
- A. CI で自動適用 (案 D 既定)
- B. migration ごとに demo seed factory 再生成必須
- C. demo は migration を選択的に受け入れ (差分許容)

含意: A は完全自動追従、B/C は手動規律残。

---

### Q5 (新規、scope 拡張). 親管理画面 (`/(parent)/admin/**` 22 ページ) の demo 提供範囲は?

選択肢:
- A. 全 22 ページ提供 (= 案 D)
- B. 主要 5-7 ページのみ (現状: 13 ページ提供、admin home / activities / checklists / children / license / rewards / settings / status / messages / events / challenges / members / points / reports)
- C. 子供画面のみ demo、親管理画面は read-only screenshot
- D. 親管理画面は demo non-target

含意: A なら案 D で完全自動 (`/demo/**` 撤去 + cookie 切替で動く)、B/C/D なら現状の demo route 維持必要。

---

### Q6 (新規). 5 年齢モード × demo seed の網羅性は?

選択肢:
- A. 全 5 モード (baby / preschool / elementary / junior / senior) で demo tenant 提供
- B. elementary のみ demo、他は switch で切替後 production parity 確認
- C. baby は ADR-0011 (親準備モード) で別 UX、他 4 モードのみ demo

含意: A なら demo seed factory が 5 モード × N 子供 × M 活動の組合せ網羅必要 (工数 +1-2 週)、C なら現実的範囲。

---

### Q7 (新規). demo を本番 user に「昇格」する flow を実装するか?

選択肢:
- A. demo signup 時に demo tenant data を新規 user tenant に migrate (Supabase / Firebase 流)
- B. demo は signup 時に破棄、user は fresh start
- C. demo signup 時に user に「demo data を引き継ぎますか?」prompt

含意: A は signup conversion 向上、B は実装シンプル、C は折衷案。

---

### Q8 (新規). demo abuse 対策の方針は?

選択肢:
- A. CAPTCHA / Cloudflare Turnstile + IP rate limit (Supabase 推奨)
- B. demo session 期限を短く (24h → 1h) してリソース消費抑制
- C. demo tenant 数を月次総量で cap

含意: 案 D 採用時に **CRITICAL**、放置すると DB が demo data で肥大化リスク。

---

### Q9 (新規). incremental release vs big bang release のどちらを選ぶか?

選択肢:
- A. Incremental: 週単位で 1 ページずつ demo route → production route 統合 (8 週)
- B. Big Bang: 全 page 同時切替、main merge は 1 PR (リスク集中)
- C. Phased: child 5 pages → admin 13 pages → 残り の 3 phase

含意: A は failure isolation 容易、B は scope 切れず再失敗リスク、C は折衷案で推奨。

---

### Q10 (新規、過去 7 回失敗起因). 「禁止語」を PR レビューで強制する?

候補:
- 「Tier N で統合」「POC scope」「等価性維持」「足場として」「逆輸入回避」「demo 寄せ統合」「snapshot patch」
- 「とりあえず」「一旦」「次フェーズで」「scope 外」
- 「demo と本番の UI 差分は許容範囲」(= contract 不在を隠蔽する逃げ語)

含意: 禁止語強制は強い規律だが、本当に scope 切らないと進まない場合の救済策必要 (例: 禁止語使うときは ADR 起票必須)。

---

### Q11 (新規). LP に demo の screenshot を貼り続けるか?

選択肢:
- A. はい (ADR-0013 LP truth: demo は production の事実を反映必須 → 案 D で構造保証)
- B. いいえ、production のスクショに変更
- C. demo / production 区別不要 (同じ画面)

含意: 案 D 採用時に「demo の見え方 = production の見え方」が保証されるため A/C が選択可。

---

### Q12 (新規). 既存 production user の DB に tenant_id column を後付けする影響をどう扱うか?

選択肢:
- A. Drizzle migration で nullable column 追加 → 既存 row は `tenant_id = 'default-tenant'` に backfill
- B. 既存 user 全員に対し migration tool 実行、tenant_id 振り直し
- C. tenant_id 不要、`is_demo` boolean column のみ追加

含意: 案 D は A 推奨、SQLite migrate と既存 user データ整合性確認必要。

---

### Q13 (新規). `/demo/**` URL 体系を撤去するか、維持するか?

選択肢:
- A. 撤去 (=案 D、`/(child)/` `/(parent)/` を cookie で auth bypass)
- B. 維持 (`/demo/**` は別 path で動かしつつ data 層は統合)
- C. リダイレクト (`/demo/**` → `/(child)/?demo=1`)

含意: A は完全 SSOT 化、B は URL 体系維持、C は折衷案で SEO / LP 既存リンク継続。

---

### Q14 (新規). 子供向け anti-engagement 設計 (ADR-0012) を demo にも適用するか?

選択肢:
- A. demo も production と完全同じ anti-engagement 規律 (= 案 D の自然な帰結)
- B. demo は LP 訴求のため演出強め (ADR-0012 違反許容)
- C. demo の演出は ADR-0012 内で「LP 訴求 OK」例外節を追加

含意: 案 D は A を強制 (同じ Service / 同じ UI なので)、B/C なら案 D ではなく案 A/B 採用必要。

---

### Q15 (新規). demo signup の Cognito 統合方針は?

選択肢:
- A. demo は完全 anonymous (Cognito 通らない、tenant_id のみで識別)
- B. demo は Cognito Identity Pool 経由の anonymous user
- C. demo は擬似 Cognito user (`DEV_USERS` の demo-xxx) を使用

含意: A は最もシンプル (案 D 推奨)、B は Cognito 機能活用だが Cognito Identity Pool 統合工数増、C は既存 dev:cognito 路線の延長。

---

## §7. 全 page インベントリと統合難易度

### 子供画面 `/(child)/` (8 directory)

| route | 難易度 | demo 提供範囲 (推奨) | 統合方式 |
|---|---|---|---|
| `/checklist` | 易 | 提供 | 案 D で cookie 切替のみ |
| `/[uiMode]/home` | 易 | 提供 | 案 D、ADR-0046 で部分共通化済 |
| `/[uiMode]/home/initial-points` | 中 | 提供 | 案 D、初期設定 wizard を demo seed で前置 |
| `/[uiMode]/shop` | 中 | **PO 判断 (Q5)** | demo tenant の currency / item を seed factory で生成 |
| `/[uiMode]/(character)/achievements` | 易 | 提供 | 案 D |
| `/[uiMode]/(character)/battle` | 中 | 提供 | 案 D、battle service が tenant filter |
| `/[uiMode]/(character)/history` | 易 | 提供 | 案 D |
| `/[uiMode]/(character)/status` | 易 | 提供 | 案 D |

### 親管理画面 `/(parent)/admin/` (22 directory)

| route | 難易度 | demo 提供範囲 (推奨) | 統合方式 |
|---|---|---|---|
| `/admin` (home) | 易 | 提供 | 案 D |
| `/admin/activities` | 中 | 提供 (現 demo 13 ページに含む) | 案 D |
| `/admin/activities/introduce` | 中 | 提供 | 案 D |
| `/admin/activities/[id]/edit` | 中 | **read-only 推奨** | demo は edit disable (RouteBot 流 restricted permission) |
| `/admin/analytics` | 易 | 提供 (seeded analytics) | 案 D + seed |
| `/admin/billing` | 困難 | demo 専用 mock | Stripe 認証 / webhook が production 専用、demo は mock 維持 |
| `/admin/billing/cancel/*` | 困難 | demo 専用 mock | 同上 |
| `/admin/certificates` | 易 | 提供 | 案 D |
| `/admin/certificates/[id]` | 易 | 提供 | 案 D |
| `/admin/challenges` | 易 | 提供 (現 demo に含む) | 案 D |
| `/admin/checklists` | 易 | 提供 (現 demo に含む) | 案 D |
| `/admin/children` | 中 | 提供 (現 demo に含む) | 案 D |
| `/admin/events` | 易 | 提供 (現 demo に含む) | 案 D |
| `/admin/growth-book` | 易 | 提供 | 案 D |
| `/admin/license` | 困難 | demo 専用 mock | Stripe 関連、demo は現状維持 |
| `/admin/members` | 中 | 提供 (現 demo に含む) | 案 D、invite flow は demo で disable |
| `/admin/messages` | 易 | 提供 (現 demo に含む) | 案 D |
| `/admin/packs` | 中 | 提供 | 案 D、import flow は demo で disable |
| `/admin/points` | 易 | 提供 (現 demo に含む) | 案 D |
| `/admin/reports` | 易 | 提供 (現 demo に含む) | 案 D + seeded weekly report |
| `/admin/rewards` | 易 | 提供 (現 demo に含む) | 案 D |
| `/admin/settings` | 易 | 提供 (現 demo に含む) | 案 D、Stripe / email 等は disable |
| `/admin/status` | 易 | 提供 (現 demo に含む) | 案 D |

### Ops / Auth / その他 (scope 外候補)

| route | demo 提供 | 理由 |
|---|---|---|
| `/ops/**` | ✗ | 内部運用画面、demo 対象外 |
| `/auth/**` | △ | demo 訪問者の signup 経路として一部必要 (`/auth/signup` のみ) |
| `/legal/**` | ✗ | 法的文書、demo 区別不要 |
| `/pricing` `/inquiry` `/marketplace` | ✗ | LP 系、demo 区別不要 |
| `/setup/**` | △ | demo seed 後に skip、または demo 用 walkthrough 別実装 |

### §7 まとめ

- **demo 提供推奨**: 子供画面 8/8 + 親管理画面 17/22 (billing 系 5 ページは mock 維持) = **計 25 ページ**
- **現状 demo route**: 子供画面 5/8 + 親管理画面 13/22 = 計 18 ページ
- **案 D 採用で増分**: +7 ページ (子供画面 3 + 親管理画面 4)
- **撤去対象**: `/demo/**` 28 ディレクトリ (= demo route SSOT を本番 route に統合)

---

## §8. CDK / Infrastructure as Code 視点

> **PO 追加指示 (2026-05-15)**: 「CDK で対応することなど、インフラアーキテクチャ目線でも実現できないか、という検討ができていないように見えた」
>
> **目的**: §5 案 A-G の application code 工数とは独立に、**CDK としてどう構築するか / infra IaC で何が可能か** を整理し、PO の deployment レベル意思決定 (Single Lambda + tenant 分離 vs Multi-Lambda 等) を支える。
>
> **方針**: 既存 `infra/` の stack 構造を読まずに最小確認 (ファイル一覧 + `infra/bin/app.ts`) のみ参照し、AWS 公式 doc + CDK examples + AWS Solutions Library の URL を必須化。

### §8-1. 既存 CDK スタック構造の分析

`infra/bin/app.ts` (L11-86) と `infra/lib/*-stack.ts` のファイル一覧から確認できる事実:

#### スタック数: 6 (`Storage` / `Auth` / `Compute` / `Network` / `Ops` / `Ses`)

| Stack | 主な resource (確認できた範囲) | demo 分離時の関与度 |
|---|---|---|
| **StorageStack** (`storage-stack.ts`) | DynamoDB `TableV2` (MainTable) / S3 `Bucket` (AssetsBucket) / ECR `Repository` (AppRepo) / Backup vault (daily 18:00 UTC cron) | **高** (demo data の物理境界を引くなら Table 複製要否) |
| **AuthStack** (`auth-stack.ts`) | Cognito User Pool v2 (`auth.ganbari-quest.com`) + Google OAuth IdP / ACM (us-east-1 必須) | **最重要** (demo を別 User Pool にするか、同 User Pool で `is_demo` group 分離するか) |
| **ComputeStack** (`compute-stack.ts`) | `DockerImageFunction` (SvelteKit app Lambda、ARM64) + Function URL (NONE auth) / `NodejsFunction` (cron-dispatcher) + 7 EventBridge cron rules / SSM 経由で Cognito ID/ClientID 受取 | **最重要** (Multi-Lambda 案 F/G の核心) |
| **NetworkStack** (`network-stack.ts`) | CloudFront `Distribution` (geoRestriction JP) / Route 53 / ACM (region us-east-1) | **中** (demo 用 subdomain `demo.ganbari-quest.com` 追加可否) |
| **OpsStack** (`ops-stack.ts`) | CloudWatch Alarms (Lambda Errors 含む `ganbari-quest-cron-dispatcher-errors`) / AWS Budgets / SNS topic `ganbari-quest-ops-alerts` / Discord webhook 連携 / health-check Lambda | **低** (demo 障害は production と分離 alarm にすべきか) |
| **SesStack** (`ses-stack.ts`) | SES domain identity (`noreply@ganbari-quest.com`) / 受信パイプライン (`support@`) / Discord webhook 連携 | **低** (demo はメール送信不要、無効化方向) |

#### dependency graph (確認できた範囲)

`infra/bin/app.ts` を読むと:
- **Storage** → (`table` / `assetsBucket` / `repository` を export) → **Compute** が直接 props 経由で受取
- **Auth** → SSM Parameter Store (`/ganbari-quest/cognito/user-pool-id` 等) 経由で **Compute** が `valueForStringParameter` 取得 (cross-stack export 回避、`infra/CLAUDE.md` の明記事項)
- **Compute** → (`functionUrl` / `fn` / `cronDispatcherFn` を export) → **Network** + **Ops** が直接 props 経由で受取
- **Storage**.`table` + **Network**.`distribution` → **Ops** が直接 props 経由で受取
- **Ses** は独立 (依存なし)

#### 注目点

1. **us-east-1 region 固定 (`infra/CLAUDE.md` SSOT)** — Cognito custom domain ACM が us-east-1 必須。demo を別 stack にしても region 制約は同じ
2. **Cognito 設定は SSM 経由** — cross-stack circular dependency 回避済。demo 用 Cognito を別 stack にする場合も同パターン流用可
3. **DynamoDB は単一 `MainTable` のシングルテーブル設計** (ADR archive/0012)。tenant 分離は **partition key prefix** (`PK = "DEMO#<sessionId>"`) で application 層 RLS が現実解
4. **SQLite + Drizzle は Lambda container 内 (`infra/lambda/`)** で稼働、Lambda 起動毎に揮発。`infra/CLAUDE.md` には `data/ganbari-quest.db` 言及があるため **NUC ローカル (Docker compose) のみ SQLite file 永続**、Lambda 側は **DynamoDB が本来の永続層** の二重構成の可能性 (実装未確認)
5. **ECR Repository 1 つ (`AppRepo`)** — Multi-Lambda 案 F は新規 ECR 不要 (同 image tag 流用) だが image 内の boot config を差し替える必要 (Lambda env var で吸収可)

### §8-2. demo 分離の CDK 実装パターン (OSS 事例 5+ 件)

CDK 公式 doc + AWS Solutions Library + AWS SaaS Factory + cdk-pipelines examples で確認した demo / production 分離の **典型 5 パターン + 補助 2 パターン**。各 URL は AWS 公式 / aws-samples / cdk-pipelines を優先。

#### Pattern P1: Multi-stack pattern (同一 region / 同一 account / 別 stack)

- **概要**: `ProductionStack` / `DemoStack` を別 stack instance で deploy。共通の **L3 Construct** (例: `GanbariQuestApp construct`) を `infra/lib/constructs/` に切出し、production / demo の `App` instance が同じ construct を `new GanbariQuestApp(this, 'App', { mode: 'production' })` / `new GanbariQuestApp(this, 'App', { mode: 'demo' })` で 2 回 instantiate する
- **OSS / 公式事例**:
  - AWS CDK Best Practices — "Use multiple stacks to model your application" ([AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html))
  - AWS Solutions Library "Multi-tenant SaaS" — Stack-per-tenant pattern ([AWS SaaS Lens — Stack-per-tenant](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-isolation.html))
  - aws-samples/aws-cdk-examples L3 construct example ([aws-samples/aws-cdk-examples](https://github.com/aws-samples/aws-cdk-examples))
- **ganbari-quest 適合度**: ◯ (既存 6 stack の上に DemoCompute / DemoAuth 等を追加する形が clean)
- **トレードオフ**: Lambda / API Gateway / Cognito User Pool の **物理 instance が 2 倍**、月額コスト ~2 倍 (Pre-PMF 段階で許容するか PO 判断)

#### Pattern P2: Multi-environment pattern (env-driven context 分岐、同一 stack instance)

- **概要**: `cdk deploy --all --context env=demo` で `app.node.tryGetContext('env')` 経由で stack 内部の resource naming / config を分岐。stack instance は 1 つだが env ごとに別 CloudFormation stack name で deploy
- **OSS / 公式事例**:
  - AWS CDK Best Practices — "Parameterize your stacks" ([AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html))
  - cdk-pipelines example "feature branch + env context" ([CDK Pipelines Workshop](https://cdkworkshop.com/20-typescript/70-advanced-topics/100-pipelines.html))
- **ganbari-quest 適合度**: ◯ (現状 `domainName` / `googleClientId` context 経由の設定パターンと整合)
- **トレードオフ**: stack 単位 deploy 必須、stack 数 = env 数で増加。GitHub Actions workflow を env 別に分岐

#### Pattern P3: Stage-based pattern (cdk-pipelines `Stage`)

- **概要**: `cdk-pipelines` の `Stage` 概念で `ProductionStage` / `DemoStage` を pipeline 内 stage として deploy。CodePipeline / GitHub Actions 双方で適用可
- **OSS / 公式事例**:
  - AWS CDK Pipelines Doc ([CDK Pipelines](https://docs.aws.amazon.com/cdk/v2/guide/cdk_pipeline.html))
  - aws-samples/cdk-pipelines-demo ([aws-samples/cdk-pipelines-demo](https://github.com/aws-samples/aws-cdk-examples/tree/main/typescript/pipelines))
- **ganbari-quest 適合度**: △ (現状 `deploy.yml` が CDK 直接 deploy で pipeline 化していない。導入コスト高、Pre-PMF で過大)
- **トレードオフ**: pipeline 学習コスト + CodePipeline 自体の課金 ($1/active pipeline/month)

#### Pattern P4: Cross-stack reference (production resource を demo stack が import)

- **概要**: production `Auth` stack の Cognito UserPool ARN を SSM Parameter Store 経由で demo `Compute` stack が import (`StringParameter.valueForStringParameter`)。**完全分離 (UserPool 別)** vs **部分共有 (UserPool 同一 + group で分離)** の 2 サブパターン
- **OSS / 公式事例**:
  - AWS CDK Cross Stack References ([CDK Resources — Cross-stack references](https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resource_stack))
  - 既存 ganbari-quest `compute-stack.ts` L55 で実装済 (`ssm.StringParameter.valueForStringParameter(this, '/ganbari-quest/cognito/user-pool-id')`)
- **ganbari-quest 適合度**: ◎ (既存パターンの拡張、`/ganbari-quest/cognito/user-pool-id-demo` を追加するだけ)
- **トレードオフ**: SSM Parameter 数増 (無料枠内、コスト影響なし)

#### Pattern P5: Construct library extraction (再利用可能な L3 Construct を `lib/constructs/`)

- **概要**: production / demo の重複を削減するため `GanbariQuestApp` / `GanbariQuestAuth` 等の L3 construct を `infra/lib/constructs/` に切出し、各 stack が `new GanbariQuestApp(this, 'App', { mode })` で instantiate
- **OSS / 公式事例**:
  - AWS Constructs (AWS Solutions Constructs Library) ([AWS Solutions Constructs](https://docs.aws.amazon.com/solutions/latest/constructs/welcome.html))
  - cdklabs/cdk-monitoring-constructs ([cdklabs/cdk-monitoring-constructs](https://github.com/cdklabs/cdk-monitoring-constructs)) — L3 construct の代表例
- **ganbari-quest 適合度**: ◯ (Multi-Lambda 案 F/G の前提条件、refactor 工数 1-2 週)
- **トレードオフ**: 既存 6 stack の中身を L3 construct に再パッケージする refactor 工数

#### 補助 P6: Hosted Zone + Route53 (subdomain 戦略)

- **概要**: `demo.ganbari-quest.com` を **同一 hosted zone の A レコード** として追加 (case A) か、**別 hosted zone** にするか (case B)。case A は ACM cert を `*.ganbari-quest.com` wildcard で共有可、case B は zone 委譲が必要
- **OSS / 公式事例**:
  - AWS Route 53 Hosted Zone Doc ([Hosted Zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html))
  - AWS CDK `aws-route53` package ([CDK aws-route53](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53-readme.html))
- **ganbari-quest 適合度**: ◎ case A (同 hosted zone + wildcard ACM、現状の `ganbari-quest.com` Route 53 SSOT に subdomain 追加するだけ)
- **トレードオフ**: case A は workflow 1 つ、case B は zone 委譲 + DNS 更新の運用工数

#### 補助 P7: API Gateway custom domain (api subdomain 戦略)

- **概要**: `demo.api.ganbari-quest.com` を **別 API Gateway custom domain mapping** とするか、**path-based routing** (`api.ganbari-quest.com/demo/*`) で同 API Gateway を使うか
- **OSS / 公式事例**:
  - AWS API Gateway Custom Domain ([API Gateway Custom Domain](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html))
  - ganbari-quest は **Function URL (NONE auth)** を CloudFront 経由 (geoRestriction JP) で公開しており、現時点で API Gateway 不使用 (= `compute-stack.ts` L205 `addFunctionUrl({ authType: FunctionUrlAuthType.NONE })`)
- **ganbari-quest 適合度**: ◎ (現行 Function URL ベースなら CloudFront behavior に `demo/*` path pattern を追加して別 Function URL に origin 切替するだけで実現可)
- **トレードオフ**: CloudFront behavior 追加運用負荷小

### §8-3. 各推奨案 (案 A-G) の CDK 実装難易度

§5 で提示した推奨案 A-E に、PO 指示の F/G (Multi-Lambda 想定) を加えて CDK 工数を **application code 工数とは独立に** 見積もる。

| 案 | application code 工数 | **CDK 工数 (新規)** | infra 構成変更 |
|---|---|---|---|
| **A** ViewModel only | 1-2 週 | **0 週** | 変更なし (現状 6 stack 維持) |
| **B** Repository pattern (in-memory demo) | 4-5 週 | **0 週** | 変更なし |
| **C** Server-side `:memory:` SQLite | 5-6 週 | **0 週** | 変更なし (Lambda container 内処理) |
| **D 推奨主軸** Demo Tenant Pattern | 7-9 週 | **0-1 週** | 同一 stack で完結。任意の SSM Parameter `/ganbari-quest/demo/seed-ttl-hours` 追加程度 |
| **E** Hybrid (tenant filter only) | 5-6 週 | **0 週** | 変更なし |
| **F** Multi-Lambda deployment | 4-6 週 | **4-6 週** | 新規 6 stack 複製 (P1 Multi-stack) or 既存 6 stack 内 L3 construct 化 + 2 回 instantiate (P5) |
| **G** Multi-Lambda + Hybrid 抽象化 | 6-8 週 | **5-7 週** | F に加えて application 層 abstraction 共有のため Lambda Layer / monorepo 整理工数 |

#### 案 D の CDK 工数内訳 (0-1 週)

- **新規追加**: なし (DynamoDB partition key に `DEMO#<sessionId>` prefix を加える application 層変更のみ)
- **任意追加**: SSM Parameter `/ganbari-quest/demo/seed-ttl-hours` (default 24) を追加してデモ tenant の cleanup cron に渡す → 0.5-1 週
- **既存 cron-dispatcher の拡張**: `demo-cleanup` job を `CRON_JOBS` array に追加 (`compute-stack.ts` L20-30 の SSOT)、`infra/lambda/cron-dispatcher/index.ts` に dispatch、SvelteKit 側に `/api/cron/demo-cleanup` 実装 → 0.5 週 (CDK 側はほぼゼロ、SSOT registry に 1 行追加)

#### 案 F の CDK 工数内訳 (4-6 週)

- **Cognito UserPool 分離**: production / demo で別 UserPool。`AuthStack` を `mode: 'production' | 'demo'` で 2 回 instantiate (P1 + P5)。Google OAuth client / IdP / Custom Domain の重複設定 → **1-2 週**
- **Compute Stack 複製**: production Lambda / demo Lambda を別 `ComputeStack` instance、別 ECR image tag (`app:prod-*` / `app:demo-*`) か同 image + env var で boot 切替 → **1-2 週**
- **Storage Stack 判断**: DynamoDB Table を 2 つ持つか、1 つを share するか。share する場合 `READ/WRITE` IAM grant を demo Lambda にも付与 → **0.5-1 週**
- **Hosted Zone / Route53**: `demo.ganbari-quest.com` の A レコード + ACM wildcard cert 共有 (P6 case A) → **0.5 週**
- **CloudFront Distribution**: 別 distribution or 同 distribution に behavior 追加 → **0.5-1 週**
- **OpsStack の二重 alarm**: demo Lambda にも alarm 配置するか、demo は alarm 無効化するか PO 判断 → **0.5 週**
- **CI/CD (GitHub Actions) deploy target 追加**: `.github/workflows/deploy.yml` に demo deploy job を追加 (`-c env=demo` 付き) → **0.5-1 週**

#### 案 G の CDK 工数内訳 (5-7 週)

- 案 F の全工数 + 以下:
- **L3 Construct 抽出** (P5): 既存 6 stack を `lib/constructs/` の L3 に再パッケージ → **1-2 週**
- **Lambda Layer 共有**: application 共通 code (Drizzle schema / domain models) を Lambda Layer 化し production / demo で共有 → **0.5-1 週**

#### 重要な制約

- **us-east-1 region 固定** (`infra/CLAUDE.md` SSOT、Cognito custom domain ACM 制約) — 案 F/G でも region は同じ
- **既存 `infra/CLAUDE.md` の production env 必須配布 4 経路** (#911 / #806) — 案 F/G では同 env 値を **両 Lambda に重複配布** する必要 (`AWS_LICENSE_SECRET` 等)
- **`deploy.yml` post-deploy smoke test** (#1586) — 案 F/G では demo Lambda にも smoke test を追加すべき

### §8-4. infra コスト / 運用負荷

各 deployment option の AWS 月額コスト + CI/CD + 運用負荷を、AWS 公式 pricing page 基準で概算 (Pre-PMF 段階、月 1,000-10,000 request 想定):

#### Single Lambda (案 A-E、現状維持)

- **AWS コスト**:
  - Lambda: Function URL 経由、ARM64、月 1k-10k request × ~500ms = 数 $ (無料枠 1M request/month 内に収まる可能性)
  - API Gateway: 不使用 (Function URL 直結)
  - Cognito: MAU 1-100 user で無料枠内 (50,000 MAU 無料)
  - DynamoDB: On-demand、月数 $ (シングルテーブル設計)
  - CloudFront: 数 $ (geoRestriction JP)
  - ECR: 1 repository 月 ~$1 (storage 0.10/GB)
  - **合計**: 月 ~$5-15
- **CI/CD コスト**: GitHub Actions free tier 内 (2000 min/month、private repo)
- **運用負荷**:
  - 障害切分け: production と demo が同 Lambda のため、production 障害が demo に伝播 (= 案 D の認識すべきリスク、tenant filter の bug で本番 data 漏洩)
  - log 集約: 1 つの CloudWatch log group で混在 (tenant_id で grep 必要)
  - rollback: `gh workflow run deploy.yml` で stack 単位 (Storage / Compute 別途) rollback
- **Pre-PMF 適合性**: ◎ (現状の Pre-PMF cost と整合、ADR-0010 に準拠)

#### Multi-Lambda (案 F/G)

- **AWS コスト** (Single Lambda 比):
  - Lambda: 2 instance、ただし demo 側 invocation 数次第。LP 訪問者 100/day なら demo Lambda 月 3k invocation 程度 = +数 $
  - Cognito: User Pool 2 つでも MAU が分散なら無料枠内維持可。Custom Domain は **2 つで ACM cert + Route 53 record 増 ($0.50/month/domain)**
  - DynamoDB: Table 2 つにする場合 base capacity 2 倍 (On-demand なら request 数比例、変動小)、share する場合変動なし
  - CloudFront: 別 distribution なら +$0.5-1/month (data transfer 無料枠 1TB/month)
  - ECR: 1 repository 共有可 (image tag で区別)
  - **合計**: 月 ~$10-30 (Single Lambda の **約 2 倍**、ただし Pre-PMF 絶対額は小)
- **CI/CD コスト**: GitHub Actions deploy 時間 2 倍 (~10 min/deploy → 20 min)、free tier 内維持可
- **運用負荷**:
  - 障害切分け: ◎ (production と demo が完全 isolation、demo の bug が production に届かない)
  - log 集約: 別 log group、demo 専用 alarm を OpsStack で別途配置
  - rollback: demo / production 独立 rollback 可能 (= 安全性 ◎)
  - cdk deploy: 2 つの stack set を deploy。並列実行で時間短縮可だが、CDK context / SSM 経由の依存解決が複雑化
- **Pre-PMF 適合性**: △ (ADR-0010 の「Pre-PMF で過剰防衛設計を避ける」原則と緊張関係、ただし「security の最小限」観点では production 完全 isolation は **守りすぎ vs 守るべきライン** の境界)

#### ロールバック容易性比較

| 観点 | Single Lambda (案 D) | Multi-Lambda (案 F/G) |
|---|---|---|
| demo bug で production data 漏洩リスク | あり (tenant filter bug) | なし (物理分離) |
| Lambda deploy 失敗時の影響 | demo / production 同時影響 | 独立 |
| stack rollback | 6 stack 単位 | 12 stack 単位 (運用複雑度 2 倍) |
| DB migration 影響範囲 | 一発で両方 (案 D の魅力) | 別途 demo にも適用 (案 F/G で構造的追従が弱まる) |

#### Pre-PMF 適合性総合判断

ADR-0010 (Pre-PMF スコープ判断) に照らすと:

- **過剰防衛バケット**: Multi-Lambda は **「security の極大化」** に寄っており、Pre-PMF 段階の個人開発で 2 倍 infra コスト + 12 stack 運用は **過剰防衛** と判定する余地が高い
- **守るべきバケット**: 「demo bug で本番 data 漏洩」リスクは案 D の core risk、これは **application 層 RLS (tenant_id filter) と Contract Test** で構造的に防ぐのが標準解
- **後回し可バケット**: Multi-Lambda は **PMF 後の scale 段階で再評価** すべき (LP 訪問者が月 10 万人を超えたら demo abuse 対策として F を再検討)

→ **§8 結論 1**: Pre-PMF 段階では **案 D 主軸が CDK 視点でも妥当**。infra コスト 0 増、CDK 工数 0-1 週、既存 6 stack そのまま使える。

→ **§8 結論 2**: PMF 後に demo abuse 多発 / production data 漏洩 incident 発生時に **案 F へ昇格** する 2 段階戦略が現実解。L3 construct 抽出 (P5) は **将来 F 移行の前準備として案 D 採用時から徐々に進める** ことが可能。

### §8-5. ganbari-quest 固有制約

`infra/` を簡単に walk して以下を仮説 (実装読まずに `infra/bin/app.ts` + `infra/CLAUDE.md` SSOT + `infra/lib/*.ts` ファイル名のみから):

| 制約 | 現状の仮説 | demo Lambda 分離時の変化 |
|---|---|---|
| **Cognito UserPool** | 1 つ (`auth.ganbari-quest.com`、SSM 経由) | 案 D: 1 つ維持 (`is_demo` group or custom attribute) / 案 F: 2 つに分離 |
| **API Gateway** | 不使用 (Lambda Function URL 直結、`compute-stack.ts` L205) | 案 D: 不使用維持 / 案 F: Function URL を 2 つに or CloudFront behavior で path 分岐 |
| **DynamoDB Table 数** | 1 つ (`MainTable` シングルテーブル設計、ADR archive/0012) | 案 D: 同 Table 内に `PK = "DEMO#<sessionId>"` prefix で tenant 分離 / 案 F: 2 つに分離 (運用複雑度 ↑) |
| **SQLite (Lambda layer)** | 仮説: Lambda container 内に Drizzle + better-sqlite3 で `:memory:` or `/tmp/*.db`、永続層は DynamoDB (`infra/CLAUDE.md` の NUC 言及から推定。Lambda 側の SQLite 用途は要追加調査) | 案 D / 案 F どちらでも Lambda runtime 内で完結、CDK 変更なし |
| **Lambda runtime / arch** | Node.js 22 (`#1828`)、ARM64 (`compute-stack.ts`)、DockerImageFunction | 全案で同一 |
| **Static asset CDN** | CloudFront `Distribution`、geoRestriction JP | 案 F: 別 distribution or behavior 追加 (上述 P7) |
| **Cron jobs** | 7 EventBridge rules (`compute-stack.ts` L19-31 `CRON_JOBS`、`schedule-registry.ts` SSOT) | 案 D: `demo-cleanup` job 追加 (1 rule 増) / 案 F: cron も demo / production で別 dispatcher Lambda |
| **us-east-1 region 固定** | `infra/bin/app.ts` L13-16 でハードコード (Cognito custom domain ACM 制約) | 全案で同一、変更不可 |
| **`AWS_LICENSE_SECRET`** | Lambda + NUC 同値必須 (#806) | 案 F: demo Lambda にも同値配布、署名互換性確保 |
| **production env 4 経路配布** (#911) | CI / deploy.yml test / deploy.yml deploy / deploy-nuc.yml の 4 箇所 SSOT 配布 | 案 F: demo deploy 用に 5 つめの経路が必要 (`.github/workflows/deploy-demo.yml` 等) |

#### demo Lambda 分離時の追加運用負荷

1. **Cognito UserPool 2 つの Google OAuth IdP 重複設定** — Google Cloud Console で OAuth client を 2 つ管理 (case F)、または同 client で redirect_uri を複数登録
2. **SES domain identity の demo 扱い** — `noreply@ganbari-quest.com` を demo Lambda が共有するか、demo は SES 送信無効か (Anti-engagement 原則的に demo からメール送信は不要 = 無効化推奨)
3. **CloudWatch Logs retention** — demo Lambda の log retention をどう設定するか (production と同 7 days か、demo は 1 day で節約か)
4. **NUC ローカルサーバ** — demo は NUC 経由提供 (LAN 内のみ) するか不要か。`infra/CLAUDE.md` の NUC 言及から、demo は **Lambda 専用** で NUC 非対応とするのが clean

→ **§8 結論 3**: ganbari-quest 固有制約上、案 D は既存 6 stack そのまま、案 F は **AuthStack + ComputeStack の複製 + CloudFront behavior 追加 + GitHub Secrets 二重配布** の 4 系統変更が必要。CDK 工数 4-6 週は妥当な見積もり。

#### §8 まとめ表 (CDK 視点でのケース判定)

| 観点 | 案 D 主軸 (推奨) | 案 F Multi-Lambda | 案 G Multi-Lambda + Hybrid |
|---|---|---|---|
| CDK 工数 | 0-1 週 | 4-6 週 | 5-7 週 |
| infra コスト変動 | なし | +$5-15/month (~2 倍) | 同左 |
| 既存 6 stack 再利用 | ◎ (そのまま) | △ (L3 construct 化 or 2 instantiate) | △ (同左 + Lambda Layer) |
| production data 漏洩リスク | あり (RLS bug) | なし (物理分離) | なし |
| Pre-PMF 適合度 (ADR-0010) | ◎ | △ (過剰防衛寄り) | ✗ (Pre-PMF で工数過大) |
| 将来 F 昇格容易性 | ◎ (P5 L3 construct を案 D から徐々に整備可) | (前提) | (前提) |
| OSS / 公式 precedent | AWS SaaS Lens Silo Isolation / Stack-per-tenant pattern | AWS Well-Architected SaaS Lens Pool Isolation | AWS Solutions Constructs + L3 |
| **§5 application 工数 + §8 CDK 工数** | **7-10 週** | **8-12 週** | **11-15 週** |

→ **§8 最終結論**: **CDK 視点でも案 D が最適**。infra コスト 0 増 + CDK 工数 0-1 週で、§5 の application 側 7-9 週工数とほぼ合算なし。案 F/G は Pre-PMF で過剰防衛、PMF 後の incident 駆動で再評価する 2 段階戦略を推奨。

---

## §8 参考リンク追補 (AWS 公式 / CDK examples / AWS Solutions Library)

> 注: 既存 §1-§7 と独立した URL 集。AWS 公式 doc + aws-samples + cdklabs に限定 (third-party blog 排除)。

### AWS CDK 公式
- [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [AWS CDK Resources — Cross-stack references](https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resource_stack)
- [AWS CDK Pipelines Doc](https://docs.aws.amazon.com/cdk/v2/guide/cdk_pipeline.html)
- [AWS CDK Workshop — Pipelines](https://cdkworkshop.com/20-typescript/70-advanced-topics/100-pipelines.html)

### AWS SaaS Factory / Well-Architected
- [AWS SaaS Lens — Silo / Pool Isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-isolation.html)
- [AWS SaaS Factory partner page](https://aws.amazon.com/partners/saas-factory/)

### AWS Solutions Constructs
- [AWS Solutions Constructs Library](https://docs.aws.amazon.com/solutions/latest/constructs/welcome.html)
- [cdklabs/cdk-monitoring-constructs (L3 construct 代表例)](https://github.com/cdklabs/cdk-monitoring-constructs)

### aws-samples examples
- [aws-samples/aws-cdk-examples](https://github.com/aws-samples/aws-cdk-examples)
- [aws-samples/aws-cdk-examples/typescript/pipelines (cdk-pipelines)](https://github.com/aws-samples/aws-cdk-examples/tree/main/typescript/pipelines)

### Service-specific
- [AWS Route 53 — Hosted Zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html)
- [AWS CDK aws-route53 package](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53-readme.html)
- [AWS API Gateway Custom Domain](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html)
- [AWS Lambda Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html)
- [AWS Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
- [AWS DynamoDB — Single-table design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-modeling-nosql-B.html)

### ganbari-quest 内 SSOT (本研究で参照)
- `infra/CLAUDE.md` (region SSOT / production env 必須配布 4 経路 / Lambda Runtime ポリシー)
- `infra/bin/app.ts` (stack instantiate 構造)
- `infra/lib/*-stack.ts` (6 stack の resource 構成)
- `src/lib/server/cron/schedule-registry.ts` (cron job SSOT、`compute-stack.ts` から参照)
- ADR archive/0012 (DynamoDB シングルテーブル設計)
- ADR-0010 (Pre-PMF スコープ判断)

---

## 参考リンク一覧 (60+ URL)

### §1 OSS 事例
1. [Supabase Anonymous Sign-In Docs](https://supabase.com/docs/guides/auth/auth-anonymous)
2. [Supabase Anonymous Sign-In Blog](https://supabase.com/blog/anonymous-sign-ins)
3. [Supabase Multi-Tenancy Discussion #22359](https://github.com/orgs/supabase/discussions/22359)
4. [Supabase Anonymous Sign-In Security #22855](https://github.com/orgs/supabase/discussions/22855)
5. [Firebase Anonymous Auth Best Practices](https://firebase.blog/posts/2023/07/best-practices-for-anonymous-authentication/)
6. [Firebase Web Anonymous Auth](https://firebase.google.com/docs/auth/web/anonymous-auth)
7. [Stripe API Keys Doc](https://docs.stripe.com/keys)
8. [Stripe Sandboxes Blog](https://stripe.dev/blog/avoiding-test-mode-tangles-with-stripe-sandboxes)
9. [Stripe Authentication Doc](https://docs.stripe.com/api/authentication)
10. [Stripe Testing Use Cases](https://docs.stripe.com/testing-use-cases)
11. [Vercel Environments](https://vercel.com/docs/deployments/environments)
12. [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
13. [Vercel System Env Vars](https://vercel.com/docs/environment-variables/system-environment-variables)
14. [Atlassian Sandboxes Manage Doc](https://support.atlassian.com/organization-administration/docs/manage-atlassian-sandboxes/)
15. [Atlassian Jira Family Sandbox Doc](https://support.atlassian.com/organization-administration/docs/jira-family-and-sandboxes/)
16. [Atlassian: What is a Sandbox](https://support.atlassian.com/organization-administration/docs/what-are-sandboxes/)
17. [GitLab Data Seeder Doc](https://docs.gitlab.com/development/data_seeder/)
18. [GitLab Development Seed Files](https://docs.gitlab.com/development/development_seed_files/)
19. [GitLab Cloud Seed Doc](https://docs.gitlab.com/cloud_seed/)
20. [RouteBot Live Demo dev.to](https://dev.to/emrahg/how-we-built-an-instant-live-demo-system-for-our-saas-product-5d8k)
21. [discourse/rails_multisite GitHub](https://github.com/discourse/rails_multisite)
22. [discourse/discourse-seed-fu GitHub](https://github.com/discourse/discourse-seed-fu)
23. [Discourse Multisite Config Meta](https://meta.discourse.org/t/multisite-config/146420)
24. [Discourse Multisite Dev Environment](https://meta.discourse.org/t/set-up-a-multisite-development-environment/229310)
25. [PostHog/posthog-demo-3000 GitHub](https://github.com/PostHog/posthog-demo-3000)
26. [PostHog Demo](https://posthog.com/demo)
27. [Shopify/dawn GitHub](https://github.com/Shopify/dawn)
28. [Shopify Theme Store Requirements](https://shopify.dev/docs/storefronts/themes/store/requirements)
29. [Sentry Demo Sandbox](https://sentry.io/demo/sandbox/)
30. [Sentry Demos GitHub Org](https://github.com/sentry-demos)
31. [InstaWP: WordPress Demo with Multisite](https://instawp.com/how-to-create-a-wordpress-demo-site-with-multisite/)
32. [MotoPress: Multisite Network Demos](https://motopress.com/blog/create-separate-demos-for-wordpress-products-from-one-multisite-network/)
33. [WordPress Multisite Architecture Pantheon](https://pantheon.io/learning-center/wordpress/multisite)
34. [Airbnb Ghost Platform Deep Dive Medium](https://medium.com/airbnb-engineering/a-deep-dive-into-airbnbs-server-driven-ui-system-842244c5f5)

### §2 アーキテクチャパターン
35. [Wikipedia: Hexagonal Architecture](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software))
36. [Alistair Cockburn: Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture)
37. [onicagroup/hexagonal-example](https://github.com/onicagroup/hexagonal-example)
38. [jkonowitch/hex-effect (SvelteKit + Effect-TS)](https://github.com/jkonowitch/hex-effect)
39. [JoseClaudioADS/hexagonal-architecture-typescript-example](https://github.com/JoseClaudioADS/hexagonal-architecture-typescript-example)
40. [Niko Heikkilä: Clean Frontend Architecture with SvelteKit (Preface)](https://nikoheikkila.fi/blog/clean-frontend-architecture-with-sveltekit/)
41. [Niko Heikkilä: Server-Side Routes and Components](https://nikoheikkila.fi/blog/clean-frontend-architecture-with-sveltekit/server-side-routes-and-components/)
42. [Niko Heikkilä: Discovering Use Cases](https://nikoheikkila.fi/blog/clean-frontend-architecture-with-sveltekit/discovering-the-use-cases/)
43. [Niko Heikkilä: Domain Modelling](https://nikoheikkila.fi/blog/clean-frontend-architecture-with-sveltekit/domain-modelling/)
44. [nikoheikkila/photo-browser GitHub](https://github.com/nikoheikkila/photo-browser)
45. [Three Dots Labs: Is Clean Architecture Overengineering?](https://threedots.tech/episode/is-clean-architecture-overengineering/)
46. [Azure ACL Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)
47. [DDD-Practitioners: ACL](https://ddd-practitioners.com/home/glossary/bounded-context/bounded-context-relationship/anticorruption-layer/)
48. [Martin Fowler: TestDouble](https://martinfowler.com/bliki/TestDouble.html)
49. [Shai Yallin: Fake, Don't Mock](https://www.shaiyallin.com/post/fake-don-t-mock)
50. [Drizzle Multi-tenancy with Nile](https://orm.drizzle.team/docs/tutorials/drizzle-with-nile)
51. [mateusflorez/drizzle-multitenant](https://github.com/mateusflorez/drizzle-multitenant)
52. [Drizzle Discussion #3199 schema-based multi-tenancy](https://github.com/drizzle-team/drizzle-orm/discussions/3199)
53. [Drizzle Discussion #784 testing](https://github.com/drizzle-team/drizzle-orm/discussions/784)
54. [Drizzle Discussion #1539 enforce tenantId where](https://github.com/drizzle-team/drizzle-orm/discussions/1539)
55. [Drizzle + Turso + Remix multi-tenant blog](https://turso.tech/blog/creating-a-multitenant-saas-service-with-turso-remix-and-drizzle-6205cf47)
56. [AWS Multi-tenant RLS Postgres](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
57. [CockroachDB: Fine-Grained RLS](https://www.cockroachlabs.com/blog/fine-grained-access-control-row-level-security/)
58. [Feature-Sliced Design: SvelteKit Guide](https://feature-sliced.design/docs/guides/tech/with-sveltekit)
59. [Feature-Sliced Design: Svelte Blog](https://feature-sliced.design/blog/simple-svelte-architecture)
60. [LogRocket: Repository Pattern TypeScript](https://blog.logrocket.com/exploring-repository-pattern-typescript-node/)
61. [Carrion.dev: DataSources + Repository](https://carrion.dev/en/posts/datasources-repository-patterns/)
62. [Ben Morris: The Shared Code Fallacy](https://www.ben-morris.com/the-shared-code-fallacy-why-internal-libraries-are-an-anti-pattern/)
63. [Patterns.dev: Container/Presentational](https://www.patterns.dev/react/presentational-container-pattern/)
64. [LaunchDarkly Feature Flag Hierarchy](https://launchdarkly.com/docs/guides/flags/flag-hierarchy/)
65. [MSW: Mock Service Worker](https://mswjs.io/)

### §3 SvelteKit 固有
66. [SvelteKit Hooks Doc](https://svelte.dev/docs/kit/hooks)
67. [SvelteKit Loading Data Doc](https://svelte.dev/docs/kit/load)
68. [SvelteKit Form Actions Doc](https://svelte.dev/docs/kit/form-actions)
69. [SvelteKit Auth Doc](https://svelte.dev/docs/kit/auth)
70. [SvelteKit State Management Doc](https://svelte.dev/docs/kit/state-management)
71. [Svelte Context Doc](https://svelte.dev/docs/svelte/context)
72. [Khromov: Comprehensive Guide to Locals](https://khromov.se/the-comprehensive-guide-to-locals-in-sveltekit/)
73. [SvelteKit DI Discussion #10105](https://github.com/sveltejs/kit/discussions/10105)
74. [Kyle Nazario: DI in Svelte](https://kylenazario.com/blog/dependency-injection-in-svelte)
75. [Loopwerk: SvelteKit Architecture](https://www.loopwerk.io/articles/2022/sveltekit-architecture/)
76. [OES Technology: SvelteKit Scaling](https://oestechnology.co.uk/posts/architectural-patterns-scaling-sveltekit)
77. [SvelteKit Large Apps Discussion #13455](https://github.com/sveltejs/kit/discussions/13455)
78. [Drizzle ORM SQLite Doc](https://orm.drizzle.team/docs/get-started/sqlite-new)
79. [Drizzle Mock Issue #4547](https://github.com/drizzle-team/drizzle-orm/issues/4547)

### §5 / §6 / その他
80. [SaaS Multi-tenancy Design Patterns](https://logto.medium.com/build-a-multi-tenant-saas-application-a-complete-guide-from-design-to-implementation-d109d041f253)
81. [Logto Guest Mode Blog](https://blog.logto.io/implement-guest-mode-with-logto)
82. [Auth0 Progressive Profiling](https://auth0.com/docs/manage-users/user-accounts/user-profiles/progressive-profiling)
83. [Microsoft .NET Reliable Web App Pattern](https://learn.microsoft.com/en-us/azure/architecture/web-apps/guides/enterprise-app-patterns/reliable-web-app/dotnet/guidance)
84. [12-Factor App: Dev/Prod Parity](https://dev.to/cadienvan/devprod-parity-the-twelve-factor-app-methodology-55n2)
85. [Demostack Product Simulation](https://www.demostack.com/)

---

## 付録: 本調査でカバーしなかった論点

- **法的整合性 (COPPA / GDPR-K)**: 子供向け demo で個人情報擬似入力時の整合性は別途 Legal review 必要
- **A11y**: demo / production 統合時の a11y 影響、ARIA contract の divergence は未調査
- **i18n**: 日本語のみで運用中、多言語化時の demo seed 翻訳負荷は未調査
- **CDN / 静的配信**: demo screenshot を GitHub Pages 配信中、案 D 採用時の screenshot 自動撮影 pipeline 再構築は別 scope
- **Stripe demo の billing flow mock**: Stripe webhook / signature 認証は demo で実体験不可、現状の mock 維持判断必要

これらは Issue #2097 とは別の follow-up Issue で扱うべき。

---

## v1 → v2 の主な変更点

| 項目 | v1 (戦術) | v2 (戦略) |
|---|---|---|
| 推奨案 | 案 B (ViewModel + Service) | **案 D (Demo Tenant Pattern) + 案 B 併用** |
| scope | 1 ページ (child home) | **全 page (子供 8 + 親管理 22)** |
| 工数前提 | 1-2 週 | **7-9 週 (2 ヶ月)** |
| DB 戦略 | sessionStorage 維持 | **実 DB 共有 + tenant_id filter** |
| 抽象化レベル | Presentation のみ (VM) | **Repository + Multi-tenancy + ACL** |
| OSS 事例数 | 8 件 | **12 件 (RouteBot / Atlassian / WordPress Multisite Cloner / PostHog 追加)** |
| 過去 7 回失敗分析 | UI 統合のみ視点 | **data 層分離継続が根本要因** と再診断 |
| PO への質問数 | 10 件 | **15 件 (scope 拡張 + security + migration 追加)** |

---

**本ドキュメントは PO 判断のための材料**。§5 で「これが正解」と断定はしない。Q1-Q15 への PO 回答後に再評価が必要。
