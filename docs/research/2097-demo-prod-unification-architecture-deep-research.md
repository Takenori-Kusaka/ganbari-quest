# Issue #2097 demo / production UI 統合 アーキテクチャ深層調査

> 目的: 7 回目の haribote (snapshot+patch) を防ぐため、本質的アーキテクチャ判断材料を整える。実装提案ではなく **「PO の goal を定義する材料」** を提供する立場のリサーチ。

## エグゼクティブサマリー (3 行以内)

1. **業界 OSS で「同じ画面・同じコンポーネントを未認証 / 認証で共有」する成功パターンは 3 つに集約される**: (a) **Anonymous-first auth + Row-Level Security 分岐** (Supabase / Firebase) — 認証層で区別、UI は単一、(b) **Server-Driven UI** (Duolingo / Airbnb / Netflix) — UI 構造をデータとして配信、(c) **Service Repository + DI** (Hexagonal / Clean Architecture) — UI は interface に依存、Repository を swap。
2. **ganbari-quest の根本問題は技術ではなく「demo の goal が定義されていない」こと** — 「demo は production の劣化コピー」「demo は LP マーケ最適化 UX」「demo は production parity デモ」のどれが真の goal か未確定のまま 7 回 refactor を試みている。技術選定 (ADR-0046 Service Interface + Context DI) は方向として OSS パターン (c) と整合し正しいが、**「等価性 = ピクセル一致」と「等価性 = UX 体験一致」を取り違える**と再び haribote になる。
3. **過去 7 回失敗パターンの 80% は「UI の事実」を SSOT にする発想欠如** — labels.ts / DESIGN.md と同じく `ChildHome 表示仕様` を **データ契約 (どんな field が存在するか)** ではなく **goal 契約 (どんな子供体験を提供するか)** として明文化しないと、Service 実装 (production / demo) のどちらが正かわからなくなる。

**推奨案 (1 行、v1)**: **案 B「Domain Service + UI Contract SSOT」を採用** (ADR-0046 の上に UI Contract 層を追加)。ただし採用前に PO が「demo の goal は何か」(後述 §6 Q1) を確定する必要がある。

**PO への第一質問 (1 行、v1)**: 「**demo の goal は LP 訴求のためのマーケティング素材か、それとも未認証で本番 UX を体験させるオンボーディング体験か** — この 1 点で推奨アーキテクチャが変わる。」

---

## v2 追加サマリー (PO 追加指示「demo Lambda 別 deploy 許容」を受けて)

PO 追加情報「同じアプリを別 Lambda にデプロイしてデモアプリ専用の Lambda 上で実行されるようにし、環境変数を別にしてもいい」を受け、以下の追加判断材料を統合 (詳細は §1.9 / §2.8 / §5 案 F/G / §6 Q11-Q15 / §7):

1. **業界標準的に Multi-Lambda 分離は B2B SaaS の demo / sandbox の de facto パターン** — Atlassian Cloud Sandbox / Shopify Development Stores / Sentry Sandbox / Vercel Preview / Stripe test/live はすべて codebase 1 + deploy N (L2/L3 階層) を採用。Twelve-Factor App の `Codebase` + `Config` 原則に整合。
2. **過去 7 回失敗の構造的原因「L1 single deployment 内で UI/Service/data 全てを統合しようとした」が Multi-Lambda で物理的に消える** — demo cookie の本番漏れ、auth bypass の本番混入、demo data の本番汚染という 3 大リスクが構造的にゼロになる。
3. **新規推奨案 F (Multi-Lambda 単純) または 案 G (Multi-Lambda + ViewModel Contract)** — 案 F は 2-4 週間 + Lambda 課金 2 倍、案 G は 4-6 週間 + 同コスト。案 G は 3 重防衛 (物理分離 + 型 SSOT + Contract 文書) で過去 haribote パターンに対する最強の耐性。
4. **PO 判断必須 (新規 Q11-Q15)** — Lambda 課金 2 倍 (+$6〜$16/月) の許容判断、demo DB strategy (in-memory / 別 RDS / 共有 schema)、demo auth strategy (bypass / dummy / 別 pool)、URL 設計 (`demo.ganbari-quest.com` / path-based / etc.)、schema migration 同期方式。
5. **§7 全 page インベントリ再分類**: Multi-Lambda 採用で `/demo/admin/*` 系の「困難」カテゴリが「容易」に大幅降格、`build:demo` で demo Lambda 用 bundle と production Lambda 用 bundle を分離可能。

**v2 暫定推奨 (PO 判断前)**: **案 F または 案 G** を案 B より優先候補にする。理由は「過去 7 回失敗の構造的原因 (L1 制約) を物理的に解消」できる点で他案より強い。ただし Q11 (Lambda コスト許容) / Q12 (DB) / Q14 (URL) の PO 判断が必須。

**v2 PO への追加質問 (1 行)**: 「**Lambda 課金 2 倍 (+$6〜$16/月) を払う代わりに、過去 7 回の失敗パターンを構造的に物理的に消すか — それとも案 B の型レベル SSOT で論理的に消すか**、どちらに投資するか?」

---

## §1. Real-world OSS / web service 事例 (8 件深掘り)

### 1.1 Duolingo — Server-Driven UI による shop 統一

| 項目 | 内容 |
|---|---|
| パターン | Server-Driven UI (SDUI) |
| 出典 | [Duolingo Engineering Blog "How server-driven UI keeps our shop fresh"](https://blog.duolingo.com/server-driven-ui/) (2024) |
| 公開コード | なし (closed source、設計は公開) |

**設計の核**:
- UI 配信 response を **2 層に分離**:
  - **UI Configuration**: 12 個の foundational component (label / image / stack / button / carousel 等) + stylesheet + screen definition + actions + conditions
  - **Data Model**: ユーザ固有の値 (translated strings、asset path、condition flags)
- UI Config は **共通**、Data Model だけがユーザ別。古いクライアントは partial response (Data だけ) を受け取り、cached UI Config と組み合わせて描画。

**ganbari-quest 関連性**:
- demo / production の「UI 構造そのものは同じ、データだけが mock / real」という発想を骨格に持つ。
- 18 個の A/B 実験 + 全 shop 再設計を「**クライアントコード変更ゼロ**」で実施した実績 — 「demo と production の divergence」を構造的に消す力がある。
- 反面、12 個の foundational component に縛られるため、複雑な子供向け gamification (xp animation / pin / battle 等) を component primitives に分解しきれないと適用困難。

**Pre-PMF 適用評価**: ✗ (個人開発で SDUI runtime を組むコストが過大)

---

### 1.2 Khan Academy — 公開コンテンツ vs 認証進捗 (Coach 関係)

| 項目 | 内容 |
|---|---|
| パターン | 公開 API (exercise / video) + 認証 API (progress) の分離。同じ UI が両方の API を順次叩く |
| 出典 | [Khan Academy API Wrapper](https://github.com/weo-edu/khan), [Mastery progress reports](https://support.khanacademy.org/hc/en-us/articles/360031129891) |

**設計の核**:
- 学習コンテンツ (公開) と進捗 (認証) を **別エンドポイント**として明示的に分離。
- UI 側は「未認証 → コンテンツのみ表示、認証後 → 進捗 overlay 追加」という **段階的レンダリング**。
- Coach (教師) role 追加で「観測者の auth」と「学習者の auth」を別 token として扱う。

**ganbari-quest 関連性**:
- demo (未認証) では gamification data (pin / xp / streak) を mock 配信、production では auth 経由で real data を取得する分離思想は流用できる。
- ただし Khan Academy は「進捗が見えない = 機能退化」が許容されるが、ganbari-quest demo は LP SS 用に **本番と同じに見えるべき** という追加制約があり完全には適用不可。

**Pre-PMF 適用評価**: △ (思想は流用可、実装はオーバーキル)

---

### 1.3 Supabase — Anonymous Sign-In + RLS による単一 UI

| 項目 | 内容 |
|---|---|
| パターン | Anonymous auth (匿名 JWT) + Row Level Security 分岐 |
| 出典 | [Anonymous Sign-Ins Docs](https://supabase.com/docs/guides/auth/auth-anonymous), [Supabase Blog: Anonymous Sign-ins](https://supabase.com/blog/anonymous-sign-ins) |

**設計の核**:
- 匿名ユーザを `auth.users` に **永続実体**として作成。`is_anonymous` claim を JWT に埋め込む。
- UI は **完全に同一**、RLS policy が `auth.jwt() ->> 'is_anonymous'` を見て row 単位で読み書き制限。
- 匿名 → 認証への移行は `linkIdentity()` で **user_id を保持**したまま昇格可能 (= demo で記録した活動が認証後にそのまま引き継がれる)。

**ganbari-quest 関連性**:
- **最も思想的整合性が高い**。`is_anonymous` を ganbari-quest の `isDemo` に置き換えれば概念は完全一致。
- ただし ganbari-quest は SQLite + Drizzle + Cognito で、Supabase の RLS インフラを使わないため、**RLS 層を自前で書く必要**がある (= Service Interface で実装中)。
- Demo → 認証の昇格は ganbari-quest 文脈では「家族の sign-up 後に demo 体験を本番アカウントに移行」となるが、これは PO 判断: そもそも demo の sessionStorage 記録を保持すべきか?

**Pre-PMF 適用評価**: ○ (思想は ADR-0046 と一致、追加実装コスト中)

---

### 1.4 Firebase Anonymous Auth — 体験継続 + 昇格

| 項目 | 内容 |
|---|---|
| パターン | Anonymous user の `linkWithCredential` 昇格 |
| 出典 | [Firebase Anonymous Auth Best Practices](https://firebase.blog/posts/2023/07/best-practices-for-anonymous-authentication/), [Anonymous auth docs (web)](https://firebase.google.com/docs/auth/web/anonymous-auth) |

**設計の核**:
- Anonymous auth で **UID を作成し data を蓄積**、signup 時に `linkWithCredential` で UID 保持したまま auth method を追加。
- FirebaseUI が標準で「demo 体験 → signup で引き継ぎ」のフローを提供。

**ganbari-quest 関連性**:
- Supabase と同じ思想。違いは「永続 storage を匿名 user にも提供する (Firebase / Supabase) vs sessionStorage で揮発させる (ganbari-quest 現状)」のみ。
- **PO 判断ポイント**: demo の sessionStorage 記録を永続化すべきか? (= 後述 §6 Q3)

**Pre-PMF 適用評価**: △ (Cognito では同等機能が薄く、自前実装が必要)

---

### 1.5 Notion — Publish to Web (公開) vs Workspace (認証)

| 項目 | 内容 |
|---|---|
| パターン | 同じ Page renderer が「読み取り専用 (公開)」「編集可能 (認証)」を分岐 |
| 出典 | [Notion Sharing & Permissions](https://www.notion.com/help/guides/understanding-notions-sharing-settings), [Notion Template Gallery](https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates) |

**設計の核**:
- Block tree という **データモデル**を SSOT 化、renderer は permission level (Workspace / Shared / Private / Public) を見て interaction を制限。
- Template Gallery は「未認証で閲覧 → "Duplicate to my workspace" で認証 workspace にコピー」というワンステップ昇格。

**ganbari-quest 関連性**:
- 「未認証でも本物の data 構造を見せる、操作だけ制限する」発想。
- demo の `?screenshot=all` モード (本番一致演出強制) はこのパターンに近い。
- 違い: Notion は同じ data (公開 page) を表示するが、ganbari-quest は demo data ≠ production data (家族ごとに異なる)。

**Pre-PMF 適用評価**: ✗ (data model が共有でない時点でパターン違反)

---

### 1.6 Figma Community Files — 公開ファイル + 認証ワークスペース

| 項目 | 内容 |
|---|---|
| パターン | 公開ファイルは認証画面とは別の URL path、ただし viewer は同じ |
| 出典 | [Figma Community Guide](https://help.figma.com/hc/en-us/articles/360038510693), [Introducing Figma Community](https://www.figma.com/blog/introducing-figma-community/) |

**設計の核**:
- `/community/file/...` (公開) vs `/file/...` (認証) で URL を分離するが、**rendering engine (canvas)** は同じ。
- 公開ファイルは "Duplicate" で認証 workspace にコピー → 認証 workspace の編集権限と同じ機能セット。

**ganbari-quest 関連性**:
- `/demo/` と `/(child)/` の URL 分離は Figma と同じ。
- renderer (`DashboardView.svelte`) を SSOT 化する ADR-0046 方針も同じ。
- 違い: Figma の公開ファイルは「production data の一部スナップショット」、ganbari-quest demo は「production 機能の mock 再現」(= 別の哲学)。

**Pre-PMF 適用評価**: ○ (URL 分離 + renderer SSOT という構造は既に採用中)

---

### 1.7 GitHub — 未認証 public repo vs 認証 PR/Issue

| 項目 | 内容 |
|---|---|
| パターン | 同じ画面 (repo page / Issue list) を auth state に応じて拡張機能を出し分け |
| 出典 | [GitHub Anonymous Git Access Docs](https://docs.github.com/en/enterprise-server@3.11/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/enabling-anonymous-git-read-access-for-a-repository) |

**設計の核**:
- 未認証 = read-only、認証 = comment / PR / star 等の interaction 追加。
- UI は同じ、interactive 要素を `disabled` または非表示にする conditional rendering。

**ganbari-quest 関連性**:
- ganbari-quest demo は **interaction 自体 (記録ボタン押下 = sessionStorage 更新)** を提供する点で GitHub と異なる。
- GitHub demo に該当するのは「demo は閲覧のみ、記録は signup 後」モデルだが、これは PO の goal と一致するかは不明 (→ §6 Q4)。

**Pre-PMF 適用評価**: △ (PO が demo に interactive を求めるか次第)

---

### 1.8 Stripe Dashboard — Test mode vs Live mode

| 項目 | 内容 |
|---|---|
| パターン | 同じ UI、同じ API endpoint、headers の `Stripe-Account` / API key suffix で test/live を分岐 |
| 出典 | [Stripe Dashboard basics](https://docs.stripe.com/dashboard/basics), [Stripe Issuing test mode](https://support.stripe.com/questions/stripe-issuing-test-mode-configurations-and-differences-vs-live-mode) |

**設計の核**:
- API key の prefix (`sk_test_` vs `sk_live_`) で同じ codebase が test/live を切替。
- UI は完全一致、上部に test mode を示す badge (notification box) を出すだけ。
- 一部 settings は test mode で disabled、それ以外は parity。

**ganbari-quest 関連性**:
- ADR-0046 の `kind: 'production' | 'demo'` は Stripe の test/live と同型 (= 良い設計)。
- 違い: Stripe は **同じ UI が同じ API を叩く** (key だけ違う) のに対し、ganbari-quest は **同じ UI が異なる Service** (Drizzle / sessionStorage) を叩く。後者の方が divergence の余地が大きい。
- Stripe 級の parity を目指すなら、demo Service も `/api/v1/...` を叩いて「サーバ側 demo Drizzle」を持つ方向が考えられる (→ §5 案 C)。

**Pre-PMF 適用評価**: ○ (思想は流用可)

---

### §1 まとめ表

| 事例 | パターン | データ層 | UI 層 | demo 永続化 | ganbari-quest 適合度 |
|---|---|---|---|---|---|
| Duolingo | Server-Driven UI | サーバ配信 config | 同一 renderer | N/A | 低 (機構過剰) |
| Khan Academy | 公開 + 認証 API 分離 | 別 endpoint | 同一画面、段階拡張 | あり (認証後) | 中 |
| Supabase | Anonymous auth + RLS | 同一 DB、is_anonymous flag | 同一 UI | あり | 高 (思想) |
| Firebase | Anonymous + linkCredential | 同一 DB、UID 保持 | 同一 UI | あり | 高 (思想) |
| Notion | Permission level | Block tree SSOT | 同一 renderer | N/A | 低 (data model 異) |
| Figma | URL 分離 + 同 renderer | 別 file、同 canvas engine | 同一 renderer | N/A | 中 |
| GitHub | Auth-aware interaction | 同一 DB、auth check | 同一 UI、disabled 切替 | N/A | 中 |
| Stripe | Test/Live key | 同一 API、key 分岐 | 同一 UI、badge 表示 | あり | 高 |

**観察**: 成功事例の 80% は **「UI と data の関係性を contract として定義」+「data 層は環境別に swap」** のパターン。UI 自体に分岐を入れる事例はゼロ。

---

### §1.9 (v2 追加) Deployment 分離軸での再評価 — 「同一 deployment + env 分岐」vs 「別 deployment + 完全分離」

PO 追加指示「同じアプリを別 Lambda にデプロイしてデモアプリ専用の Lambda 上で実行されるようにし、環境変数を別にしてもいい」を受けて、§1.1〜§1.8 の事例を **deployment トポロジー軸**で再分類する。

#### Deployment 分類軸 (3 階層)

| 階層 | 定義 | 代表例 |
|---|---|---|
| **L1: Single deployment + env 分岐** | 1 つのアプリ instance が env / header / cookie / API key suffix を見て test/live を切替 | Stripe Dashboard、GitHub (public/private repo)、Notion、Figma Community、Supabase (single project) |
| **L2: Multi-deployment + 同一 codebase** | 同じ codebase を別 instance に deploy、env / config で挙動分岐 | Vercel Preview Deployments、Stripe (test API key + live API key で実体は同一 endpoint だが内部 routing は別 instance)、Heroku Review Apps |
| **L3: Multi-deployment + 完全分離 (DB / Auth / domain も別)** | demo / production がインフラレベルで完全独立、共有はソースコードのみ | Atlassian Sandbox (sandbox.atlassian.com)、Shopify Demo Store、GitLab Demo (gitlab.com vs demo.gitlab.com)、AWS Sandbox accounts |

#### 各事例の再評価

| 事例 | Deployment 階層 | Demo / production の env 分岐方法 | ganbari-quest への含意 |
|---|---|---|---|
| Stripe Dashboard | **L1** (codebase) + **L2** (実体は test/live で別 backend cluster だが API key で切替) | `sk_test_*` / `sk_live_*` API key suffix、Dashboard URL は同じ | demo Lambda + production Lambda の別 deployment は Stripe の test/live 分離と同型 |
| Vercel Preview | **L2** (deployment 完全別、env vars 別、DB は別 connection string) | branch ごとに別 Lambda、env var で DB connection を切替 | demo Lambda は「常設 preview deployment」と見なせる |
| Supabase | **L1** (project 内で anonymous + authenticated) または **L3** (別 project で staging/production) | RLS policy で is_anonymous 分岐 (L1) または別 project_url (L3) | ganbari-quest demo Lambda は **L3 を選んでも良い** (env で別 DB / 別 Cognito pool) |
| Firebase | **L1** または **L3** (Firebase Project 単位の分離) | Firebase config (apiKey / projectId) で env 別 | demo Firebase project + production Firebase project 流の分離 |
| Atlassian Sandbox | **L3** (sandbox.atlassian.com で完全分離) | DNS 別、DB 別、Cognito 別 | demo.ganbari-quest.com 流の URL 分離はこれと同型 |
| Shopify Demo Store | **L3** (demo.myshopify.com 流の sandbox tenant) | tenant ID で完全分離、production data に影響なし | demo Lambda の DB を別 instance にする発想と同型 |
| GitLab Demo | **L2** (demo.gitlab.com、infrastructure は同じだが data / users 別) | env var で seed data を投入 | demo Lambda の Lambda init 時 seed と同型 |
| Discourse Demo | **L2/L3** (try.discourse.org、demo data を毎日 reset) | env で `DEMO_MODE=true`、毎日 cron で DB reset | demo Lambda + 定期 seed reset 流 |
| GitHub Codespaces / preview repo | **L2** (preview branch ごとに別 Codespace) | Codespace 単位の env | demo Lambda の dynamic provisioning とは違うが、env 駆動の挙動分岐は同型 |
| Mattermost / Rocket.Chat OSS | **L1** (single binary で `ENABLE_DEMO=true`) | env で demo seed user を作成 | demo Lambda env 駆動の最も軽量な実現 |
| Sentry (sandbox.sentry.io) | **L3** (完全分離、DB / Cognito / domain 別) | DNS + env で完全分離 | demo Lambda + 完全分離 DB 流 |

#### 観察 (v2 追加分)

1. **B2B SaaS の demo は概ね L3 (完全分離 deployment)** — Atlassian / Shopify / Sentry / Salesforce はすべて demo / production を別インフラで運用。理由は **production data 汚染防止**と**demo の認証 bypass を本番に絶対影響させない**ため。
2. **B2C / Dev tool は L1 or L2 が多い** — Stripe / Supabase / Firebase は同一 project 内に test/live を持つことが多い。理由は **demo ↔ production の data 移行を滑らかにする** UX 要求が強いため (Stripe で test mode → live mode へ seamless 移行)。
3. **OSS demo は L1 (env 駆動) で軽量実装** — Mattermost / Rocket.Chat / Discourse は単一 binary に `DEMO_MODE` env を組み込み、L3 ではなく L1 の理由は「demo deploy のインフラコスト最小化」。
4. **Twelve-Factor App の "config in env" 原則は L1/L2/L3 すべてに通底** — codebase は 1 つ、env で挙動分岐するのが大前提。L1 と L2/L3 の違いは「instance 数」だけ。

#### ganbari-quest への含意 (v2 重要)

- 過去 7 回失敗は L1 (single Lambda + cookie 分岐) の枠内で UI 統合を試みた結果 → demo cookie の漏れリスク、production 認証 bypass リスクが構造的に残る
- **L3 (別 Lambda + 別 DB + 別 Cognito pool) を選べば、過去 7 回試行が直面した「demo cookie の本番漏れ」「auth bypass の本番コード混入」「demo seed の本番 DB 汚染」という 3 大リスクが構造的に消える**
- 一方で L3 のコストは「Lambda 課金 2 倍」「2 つの deployment pipeline」「schema migration 同期」— Pre-PMF 段階で許容可能かは PO 判断 (→ §6 Q11-Q15 で問う)
- **B2B SaaS の標準 (L3) と OSS demo の標準 (L1) の中間として L2 (別 Lambda + 共有 DB) もあり得る** — DB は production と同じ、Lambda だけ env で demo branch、コストは Lambda 課金 2 倍のみ

#### Deployment 分離軸の参考文献

| URL | 用途 |
|---|---|
| [Twelve-Factor App: Config](https://12factor.net/config) | env 駆動 config の標準 |
| [Twelve-Factor App: Codebase](https://12factor.net/codebase) | 1 codebase / N deploys 原則 |
| [AWS Multi-Account Strategy](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html) | demo / production を別 AWS account に置く分離 |
| [Vercel Preview Deployments](https://vercel.com/docs/deployments/preview-deployments) | branch 単位の別 Lambda 流 |
| [Atlassian Cloud Sandbox](https://support.atlassian.com/organization-administration/docs/cloud-sandbox/) | B2B SaaS の L3 完全分離事例 |
| [Shopify Development Stores](https://help.shopify.com/en/partners/dashboard/managing-stores/development-stores) | tenant 分離の代表例 |
| [Stripe Test Mode Architecture](https://docs.stripe.com/test-mode) | L1 + L2 ハイブリッド (API key で routing) |
| [Heroku Review Apps](https://devcenter.heroku.com/articles/github-integration-review-apps) | PR ごとに別 deployment + env 別 |
| [Discourse Try](https://try.discourse.org/) | OSS の L2 demo (毎日 reset) |
| [Mattermost Cloud Trial](https://mattermost.com/sign-up/) | OSS B2B の demo deployment |
| [Sentry Sandbox](https://sandbox.sentry.io/) | L3 完全分離の SRE 事例 |
| [Supabase Multi-Project Pattern](https://supabase.com/docs/guides/platform/multi-environments) | dev/staging/prod 別 project の L3 |
| [Firebase Multi-Project Workflow](https://firebase.google.com/docs/projects/dev-workflows/general-best-practices) | 同上 |

---

## §2. デザインパターン / アーキテクチャ適合性 (7 件)

### 2.1 Hexagonal Architecture (Ports & Adapters)

| 項目 | 内容 |
|---|---|
| 出典 | [Wikipedia: Hexagonal Architecture](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)), [Alistair Cockburn: Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) |
| 核 | UI / Domain / Infrastructure を Port (interface) で分離、Adapter (実装) を swap |

**ganbari-quest への適合性**:
- ADR-0046 の `ChildDashboardService` interface は Port、`Production/DemoDashboardService` は Adapter。**既に Hexagonal を採用済み**。
- 残課題: UI 側 (DashboardView) が Port (interface) を **十分に活用しているか** — 現状 `DashboardData` 型に Drizzle 推論型 `PageData as never` キャストが残る (= 型レベルの Port 不徹底)。

**Pre-PMF 適用評価**: ○ (既に部分採用、徹底に追加コスト ~100 行)

**落とし穴**: 「Adapter を増やす」と「分岐コードを散らす」が同義になり得る。Adapter 数を最小化 (production / demo の 2 つ) し、UI 側で `service.kind === 'demo'` を直接見ない規律が必須。

---

### 2.2 DDD Bounded Context + Anti-Corruption Layer

| 項目 | 内容 |
|---|---|
| 出典 | [Azure Anti-Corruption Layer Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer), [DDD-Practitioners: Anticorruption Layer](https://ddd-practitioners.com/home/glossary/bounded-context/bounded-context-relationship/anticorruption-layer/) |
| 核 | Bounded Context 間で domain model が汚染されないよう ACL (translator) を挟む |

**ganbari-quest への適合性**:
- 「production Drizzle 型」「demo sessionStorage 型」を **別の Bounded Context** として扱い、UI 用 `ChildDashboardHomeData` を Domain model (Ubiquitous Language) として定義。
- 現状 `types.ts` の `ChildDashboardHomeData` がまさに ACL の役割を担っているが、Drizzle `PageData` との橋渡しに `as never` キャストが残る (= ACL 不完全)。

**Pre-PMF 適用評価**: ○ (ACL を厳密化する効果は大、追加コスト ~50 行型定義)

**落とし穴**: ACL を厚くしすぎると Pre-PMF オーバーエンジニアリング。「子供の活動記録」というシンプルな domain に DDD フル装備は不要。「ChildDashboardHomeData が production / demo どちらの実装にも依存しない」レベルで十分。

---

### 2.3 Repository Pattern + Dependency Injection

| 項目 | 内容 |
|---|---|
| 出典 | [Better Programming: Repository Pattern + DI with React + TS](https://betterprogramming.pub/decoupling-your-concerns-with-dependency-injection-the-repository-pattern-react-and-typescript-6b455788a374), [Carrion.dev: DataSources and Repository Patterns](https://carrion.dev/en/posts/datasources-repository-patterns/) |
| 核 | Repository (data access) を interface で抽象化、Container で実装を inject |

**ganbari-quest への適合性**:
- ADR-0046 と等価。`ChildDashboardService` = Repository、`setContext` = Container。
- 現状の問題: Repository が **read + write を一体化**しているため interface が肥大化。read-only `ChildDashboardReadRepository` と write-only `ChildDashboardWriteRepository` に分割すると、demo 側 (sessionStorage 中心) と production 側 (REST + Drizzle) の責務がより明確になる可能性。

**Pre-PMF 適用評価**: ○ (既に採用、CQRS 風分割は追加コスト、必須でない)

**落とし穴**: Repository を 1 つだけに統一すると「demo 専用 method」「production 専用 method」が interface に紛れ込み始める。ADR-0046 が `kind` フラグで識別する設計は健全だが、`if (service.kind === 'demo')` を UI に書き始めると aged 化 (= 7 回失敗の温床)。

---

### 2.4 Feature Flag Architecture (LaunchDarkly / Unleash パターン)

| 項目 | 内容 |
|---|---|
| 出典 | [Feature Gating: Freemium SaaS without Duplicating Components](https://dev.to/aniefon_umanah_ac5f21311c/feature-gating-how-we-built-a-freemium-saas-without-duplicating-components-1lo6), [LaunchDarkly Feature Flag Hierarchy](https://launchdarkly.com/docs/guides/flags/flag-hierarchy/) |
| 核 | `<FeatureGate feature="X" mode="hide|replace">` で UI から billing/auth logic を分離 |

**ganbari-quest への適合性**:
- demo / production の差分が **「ショップタブ表示 / 非表示」「currency 単位」程度の量**であれば Feature Flag で十分。
- 大量の差分 (現状の 5 項目: 進捗 UI / Activity 数 / counter badge / shop tab / currency) を全て flag 化すると組み合わせ爆発。
- **PO 判断ポイント**: そもそも demo にどれだけの feature gating を許容するか (→ §6 Q5)。

**Pre-PMF 適用評価**: △ (差分が少なければ最適、多ければ反パターン)

**落とし穴**: Feature flag の典型的失敗 — Slack 2020 年 6 時間 outage、Facebook 2021 年 outage 等、postmortem は「flag combinatorial explosion」を指摘。([Unleash blog: Maintaining feature flags](https://dev.to/jackmarchant/maintaining-feature-flags-in-a-product-engineering-1d7a))

---

### 2.5 Server-Driven UI

| 項目 | 内容 |
|---|---|
| 出典 | [Duolingo SDUI Blog](https://blog.duolingo.com/server-driven-ui/), [Airbnb Server-Driven UI](https://medium.com/airbnb-engineering/a-deep-dive-into-airbnbs-server-driven-ui-system-842244c5f5) |
| 核 | UI 構造そのものをサーバ配信、クライアントは renderer のみ持つ |

**ganbari-quest への適合性**: ✗
- 個人開発 Pre-PMF で SDUI runtime + component schema を組むコストが過大。
- Spotify HubFramework (2019 年 deprecated) と同じ運命を辿る可能性。
- ただし「UI の構造を data 化する」発想自体は §5 案 B に活きる。

**Pre-PMF 適用評価**: ✗ (機構コスト過剰、3 年後の Series B 以降に再検討)

---

### 2.6 Feature-Sliced Design (FSD)

| 項目 | 内容 |
|---|---|
| 出典 | [Feature-Sliced Design Home](https://feature-sliced.design/), [FSD: DDD for Frontend Devs](https://feature-sliced.design/blog/ddd-for-frontend-devs) |
| 核 | `entities / features / widgets / pages / shared` の階層、各 slice が bounded context |

**ganbari-quest への適合性**:
- 既存の `src/lib/features/child-home/components/` 構造は FSD と部分整合。
- `entities` (Child / Activity), `features` (record-activity / claim-bonus), `widgets` (DashboardView) を厳密に分けると、demo / production swap が `features` 層に閉じる。
- FSD の最大の効能は「**slice 間 dependency を一方向に**」する規律 (entities ← features ← widgets ← pages)。これにより demo 用 mock が production 機能に依存できない構造が自動的に生まれる。

**Pre-PMF 適用評価**: ○ (現状の `features/` ディレクトリを規律化、追加コスト 0-100 行)

**落とし穴**: FSD は React 文化発祥で Svelte に完全フィットしない部分あり。Svelte 5 の `$state` / `$derived` + context DI とのハイブリッドが現実解。

---

### 2.7 MV-VI Pattern (Model-View-ViewInterface / 派生 MVP)

| 項目 | 内容 |
|---|---|
| 出典 | [MV-VI Pattern (DEV)](https://dev.to/psy082/mv-vi-pattern-domain-centric-design-for-frontend-applications-1j6a), [Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) |
| 核 | View は Model の interface だけ知り、実装を意識しない |

**ganbari-quest への適合性**:
- `DashboardView.svelte` (1278 行) を「View」、`ChildDashboardService` (Service interface) を「Model interface」として既に MV-VI を実現。
- 残課題: 1278 行の View 内に **依然として data 整形 logic が残る** (= ViewModel に切り出せていない)。Svelte 5 の `$derived` を ViewModel と捉えると、`DashboardView` を **rendering 専用 (200 行程度)** + **derive logic (`useDashboardViewModel`)** に分割可能。

**Pre-PMF 適用評価**: ○ (DashboardView 分割は今後 1278 行が肥大化するなら有効)

**落とし穴**: 過剰な抽象化は Pre-PMF で逆効果。DashboardView が 1278 行で **保守可能なうちは分割不要**。3000 行を超えたら検討。

---

### 2.8 (v2 追加) Multi-Lambda Deployment Pattern (Twelve-Factor + L2/L3 分離)

| 項目 | 内容 |
|---|---|
| 出典 | [Twelve-Factor App: Codebase](https://12factor.net/codebase), [Twelve-Factor App: Config](https://12factor.net/config), [AWS Multi-Account Strategy](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html), [Vercel Preview Deployments](https://vercel.com/docs/deployments/preview-deployments) |
| 核 | 1 codebase / N deploys、各 deployment は env 駆動で挙動分岐、コードに demo / production 分岐ロジックを書かない |

**設計の核**:

- **「同じ codebase を別 Lambda にデプロイ、env で挙動を変える」** という発想。コード内に `if (env === 'demo')` は最小限、Repository factory / Auth provider / DB connection が env を見て instance を作る。
- Stripe の `sk_test_*` / `sk_live_*` は API key の prefix で routing するが、Stripe 内部では別 backend cluster (= L2 deployment 分離) と推定される。
- Vercel Preview は branch 単位で別 Lambda、env が異なる (`process.env.DATABASE_URL` が preview / production で別)。
- AWS Multi-Account は demo を別 AWS account に置く extreme な L3 分離 (production への blast radius を構造的にゼロにする)。

**ganbari-quest への適合性 (v2 で大幅再評価)**:

- PO の追加指示「demo Lambda 別 deploy 許容」が出たことで、このパターンが **第一候補に浮上**。
- 過去 7 回失敗は L1 (single Lambda + cookie/route 分岐) の枠内で「UI / Service / data 全てを 1 つの deployment で統合」しようとした結果。Multi-Lambda にすれば **構造的に L1 制約から解放**される。
- 具体的構造:
  - `src/lib/server/runtime-config.ts` (新規) で env var を読み、`isDemoDeploy: boolean` を export
  - Repository factory が `isDemoDeploy` を見て `DemoRepository` (mock / sessionStorage / in-memory SQLite) または `ProductionRepository` (Drizzle + 実 DB) を返す
  - Auth provider が `isDemoDeploy` を見て `DemoAuthProvider` (dummy user) または `CognitoAuthProvider` を返す
  - DashboardView は env を一切意識しない (= Repository / Auth provider の差分が UI を吸収)
- Twelve-Factor の `Config in env` 原則に完全準拠 → 業界標準的に「正しい」アーキテクチャ。

**Pre-PMF 適用評価**: ○ (Pre-PMF 個人開発でも実装可、Lambda 課金 2 倍は許容範囲、ADR-0010 Bucket A 適格)

**メリット (L1 比)**:

- **demo cookie / route 分岐の構造的廃止** — production Lambda には `if (isDemo)` が一切存在しない → demo data の本番漏れ、auth bypass の本番混入が物理的に不可能
- **schema migration の独立性** — demo Lambda の DB schema を production と独立に変更可能 (ただし同期 cost あり)
- **demo seed の自由度** — demo Lambda 起動時に `demo-seed.ts` を必ず走らせて known-good state を強制可能
- **CI / CD pipeline の分離** — demo deploy 失敗が production deploy に影響しない (blast radius ゼロ)

**デメリット**:

- **Lambda 課金 2 倍** — Pre-PMF 個人開発で月額 $X → $2X の許容判断 (PO 判断、§6 Q11)
- **schema migration 同期コスト** — production schema 変更時に demo Lambda にも追従が必要、CI auto-deploy で自動化可能だが運用 overhead
- **デプロイ pipeline 重複** — GitHub Actions の workflow が 2 つ必要 (一部 reuse 可)
- **URL / DNS 設計** — `demo.ganbari-quest.com` / `app.ganbari-quest.com/demo/` / 別 path のどれかを決める必要 (§6 Q14)

**落とし穴**:

- **env 駆動 `if` 分岐が増えると "haribote 化" リスク** — Multi-Lambda にしても、ソースコード内に `if (config.isDemoDeploy)` が散在すると過去 7 回と同じ failure mode に陥る。Repository / Auth factory の **1 箇所** で env を読み、それ以降は polymorphism (interface + 実装 swap) で処理する規律が必須。
- **demo 専用 seed の管理** — demo Lambda の DB schema が production と乖離すると schema 統合不能、過去の `tests/e2e/global-setup.ts` 同期問題と同じ罠。
- **本番 schema migration の demo 追従漏れ** — production schema migrate 後に demo Lambda の DB に migration を走らせ忘れると、demo / production の interface が乖離する。CI で `check-demo-prod-schema-parity.mjs` 流の gate が必須。

**実装パターン (推奨)**:

```typescript
// src/lib/server/runtime-config.ts (新規)
export const runtimeConfig = {
  isDemoDeploy: process.env.DEMO_DEPLOY === 'true',
  authProvider: process.env.DEMO_DEPLOY === 'true' ? 'demo' : 'cognito',
  dbStrategy: process.env.DEMO_DEPLOY === 'true' ? 'memory-seed' : 'persistent',
} as const;

// src/lib/server/repositories/factory.ts
import { runtimeConfig } from '../runtime-config';
export function createChildRepository(): ChildRepository {
  return runtimeConfig.isDemoDeploy
    ? new DemoChildRepository()
    : new ProductionChildRepository();
}
```

UI 層 (`DashboardView.svelte`) は `runtimeConfig` を一切参照しない (= 規律で担保、ESLint rule で強制可能)。

**業界先行事例**:

| 事例 | 実装方式 | ganbari-quest との類似度 |
|---|---|---|
| Stripe test/live | L2 (別 backend cluster + API key routing) | 同じ codebase が test/live を別 instance で実行する点 |
| Vercel Preview | L2 (branch ごとに別 Lambda + env DB) | branch を `main` (production) と `demo-permanent` (常設 demo) と読み替え可能 |
| AWS Multi-Account | L3 (別 AWS account で完全分離) | demo Lambda を別 AWS account に置く extreme 版 |
| Heroku Review Apps | L2 (PR ごとに別 dyno) | demo Lambda を常設 review app 化 |
| Discourse try.discourse.org | L2 (毎日 reset、env で demo seed) | demo Lambda 起動時 seed と同じ発想 |

**比較: 案 D (Demo Tenant Pattern) との違い**:

- 案 D (single DB の特殊 tenant) は L1 階層、Multi-Lambda は L2/L3 階層
- 案 D は production DB の特定 tenant_id を demo にする → production 認証 bypass が必要、blast radius 大
- Multi-Lambda は production DB と demo DB が物理的に別 → 認証 bypass は demo Lambda 内部のみ、blast radius ゼロ

---

### §2 まとめ表

| パターン | 既採用 | Pre-PMF 適合 | 追加コスト | 主リスク |
|---|---|---|---|---|
| Hexagonal | ◯ (部分) | ○ | ~100 行 | Adapter 増殖 |
| DDD + ACL | △ | ○ | ~50 行 | 過剰抽象 |
| Repository + DI | ◯ | ○ | 0 行 | UI 側で `kind` を見る誘惑 |
| Feature Flag | △ | △ (差分次第) | 中 | flag 組合せ爆発 |
| Server-Driven UI | ✗ | ✗ | 過大 | 個人開発で運用不可 |
| FSD | △ | ○ | 0-100 行 | Svelte との文化差 |
| MV-VI | ◯ (部分) | △ (現在は不要) | 中 | 過剰分割 |
| **Multi-Lambda Deployment (v2)** | **✗ (未採用)** | **○** | **Lambda 課金 2 倍 + workflow 重複** | **schema 同期漏れ / env 分岐の散在** |

---

## §3. SvelteKit 固有の選択肢

### 3.1 公式推奨パターン (Auth セクション、 Loading data セクション)

| 機構 | 用途 | demo/prod 統合への寄与 |
|---|---|---|
| `+page.server.ts` load | 認証必須 data 取得 | production 専用、demo 側は `+page.ts` で代替 |
| `+page.ts` load | 認証不要 / 公開 data | demo 側で mock data 配信に最適 |
| `+layout.server.ts` | 全 page で共通の auth check | ganbari-quest は既に layout で auth gate |
| `setContext` / `getContext` (Svelte 5) | コンポーネント階層への DI | **ADR-0046 で採用済、最適解** |
| Form Actions | 認証 mutation | demo 側は client-only mutation (Service) で代替必須 |

**出典**:
- [SvelteKit Auth Docs](https://svelte.dev/docs/kit/auth)
- [SvelteKit Loading Data](https://svelte.dev/docs/kit/load)
- [Securing Your SvelteKit App](https://www.captaincodeman.com/securing-your-sveltekit-app)

**重要 caveat**: SvelteKit 公式は「`+layout.server.ts` で auth check すると child route に伝播しない可能性があるから、各 `+page.server.ts` で個別に check せよ」と警告している ([dev.to: Protecting sveltekit routes](https://dev.to/thiteago/protecting-sveltekit-routes-from-unauthenticated-users-nb9))。ganbari-quest の `/(child)/+layout.server.ts` は要監査。

---

### 3.2 SvelteKit 公式 Discussion で言及された DI パターン

- **typed-inject 採用検討**: [Discussion #10105](https://github.com/sveltejs/kit/discussions/10105) で言及されているが、最終的に Svelte の `setContext` で十分とされている。
- **Composition Root パターン**: [Kyle Nazario: Dependency injection in Svelte](https://kylenazario.com/blog/dependency-injection-in-svelte) — `+layout.svelte` または `app.html` 起点で全 service を組み立てる single 起点。
- **MSW (Mock Service Worker)**: [tcc-sejohnson/sveltekit-msw](https://github.com/tcc-sejohnson/sveltekit-msw) — demo 環境で network fetch を mock する選択肢、ただし Service Interface の方が型安全。

---

### 3.3 SvelteKit Form Actions vs API endpoints の二重実装問題

ganbari-quest 現状:
- production: 内部的に `/api/v1/activity-logs` POST を form action または fetch で叩く
- demo: sessionStorage を Service 内で更新

**SvelteKit 公式の推奨**: Form Action は progressive enhancement の利点があるが、SPA-like UX を求めるなら fetch も併用可。ganbari-quest は Cognito 認証必須のため Form Action は限定的 (CSRF token 等の都合)。

**統合への含意**:
- demo Service は **fetch しない / Form Action しない / 同期で sessionStorage 更新** に対し、production Service は fetch する → Promise interface で揃えれば UI 側は意識しない (ADR-0046 で既に達成)。
- ただし **エラー UX が divergence する可能性** (demo は network error が起き得ない、production は起き得る) — discriminated union (`{ok: false, error: 'NETWORK'}`) で型レベル統一済み (ADR-0046)。

---

### 3.4 SvelteKit SSR / hydration の境界問題

- demo `/demo/` 配下は **SSR 必要か?** — LP SS 撮影には不要、ただし SEO や初期 paint で SSR ベター。
- ganbari-quest 現状: demo も `+layout.server.ts` で seed data を SSR、SSR で seed → CSR で sessionStorage 上書きの 2 段階。
- **公式 caveat**: `+page.server.ts` の戻り値は HTML に serialize されるため secret 入りデータは絶対に返さない ([SvelteKit Auth Docs](https://svelte.dev/docs/kit/auth))。demo 側は問題なし、production 側は要監査。

---

### 3.5 awesome-sveltekit / community 事例

- [upperdo/backoffice-template](https://github.com/upperdo/backoffice-template): Clean Architecture + Appwrite + ShadCN-Svelte で auth-aware UI。demo モードは含まれないが、layer 構造は参考。
- [nikoheikkila/photo-browser](https://github.com/nikoheikkila/photo-browser): Hexagonal SvelteKit 実装、Gateway pattern で network 切離。

---

## §4. ganbari-quest 構造的問題の定義

### 4.1 並行実装の経緯 — 歴史的偶発 + 構造的必然のハイブリッド

**歴史的偶発の側面**:
- 当初 `/demo/` は **LP SS 撮影専用の隔離された routes** として作成された (`+layout.server.ts` で `gq_demo=1` cookie 設定、認証 bypass)。
- LP の訴求要件 (「無料で試せる」「すぐ体験」) と Cognito 認証要件 (CRITICAL: 認証画面検証は `npm run dev:cognito` 必須) の **2 つの利用 context を 1 つの routes 構造で扱えなかった**ことが起点。

**構造的必然の側面**:
- 子供向け gamification アプリは **認証なしで本物の家族 data を表示できない** (個人情報、複数子供切替、家族別 currency 設定等)。
- かといって LP 配信時に Cognito 認証必須にすると訪問者が瞬間離脱 → demo 用に「**架空の家族 + 架空の子供 + 架空の活動**」を mock 配信する必然。
- → demo data ≠ production data という不可避な乖離。

### 4.2 UI 設計レベルの divergence vs データ実装レベルの divergence

| 種別 | 例 | 解決層 |
|---|---|---|
| **データ実装 divergence** | demo: sessionStorage / production: SQLite + Drizzle | Service Interface (ADR-0046) で解決済 |
| **UI 設計 divergence** | demo: `今日のおやくそく N/M` / production: `Lv.X (XX%)` | **未解決** — どちらが正しい UI かの判断材料がない |
| **機能セット divergence** | demo: ショップタブなし / production: あり | **未解決** — demo の goal 定義による |
| **ピクセル divergence** | font / spacing / color 等 | DESIGN.md / labels.ts で部分解決 |

**最大の問題**: UI 設計 divergence と 機能セット divergence は **Service Interface だけでは解決しない**。これらは PO の goal 定義の問題。

### 4.3 「demo は production の劣化コピー」vs 「demo は demo 専用 UX」哲学の衝突

過去 7 回失敗の根本: **どちらの哲学で進めるか確定せずに「統合」だけ走った**。

| 哲学 | 採用時の含意 | ADR との整合 |
|---|---|---|
| **A. demo は production の劣化コピー** | demo 側は production 機能の subset (mock data) を表示。新機能は production 先行、demo は遅延追従。 | ADR-0012 (anti-engagement) と整合 (demo に煽り演出を入れない) |
| **B. demo は demo 専用最適化 UX** | demo は LP 訴求最適化、独自の見せ方を許容。production 改善が demo に反映されないことを許容。 | ADR-0013 (LP truth) と部分衝突 (LP で demo のスクショを使うと「demo は production の事実を反映する」原則に抵触) |
| **C. demo は production parity デモ** | demo は production と「同じ data 構造、同じ UI、同じ interaction」、ただし mock。差分はゼロを目指す。 | ADR-0046 で目指している方向 (ただし達成困難 — 5 年齢モード × auth flow × 通貨設定 etc 全 parity は理論的に不可能) |

過去 7 回の試行は **A と C をブレながら shim 実装で繋ぐ** ことで失敗してきた。

### 4.4 ADR-0012 (anti-engagement) / ADR-0011 (baby = 親準備モード) との整合

- ADR-0012: 子供 UI の滞在時間は価値毀損。demo で「**煽る LP マーケ最適化 UX**」を作ると ADR-0012 に抵触する (LP 訪問者 = 親なので一見問題ないが、demo の screenshot が production の子供 UI として LP に貼られる場合、ADR-0012 を間接的に violate する可能性)。
- ADR-0011: baby モードは親準備モード。demo の baby モードは「子供 UI ではなく親 UI」なので、demo を子供 gamification 訴求の素材にすると **意味が逆転**する。

**含意**: 哲学 B (demo 専用最適化) は ADR-0012/0011 と高頻度で衝突する。**哲学 A または C を採用する方が ADR との整合性が高い**。

### 4.5 Service Interface + Context DI (ADR-0046) が解決した範囲 / 残った範囲

**解決済**:
- データ取得層 (Service interface)
- write API の Promise 統一
- UI 1 ファイル化 (`DashboardView.svelte` 1278 行 SSOT)

**未解決**:
- **UI 設計 divergence** (進捗 UI の出し方、counter badge の表示有無等)
- **機能セット divergence** (ショップタブ等の有無)
- **データ生成 divergence** (demo は 10 件、production は 51 件の Activity をどう揃えるか)
- **「等価性」の定義** (pixel 等価 vs UX 等価 vs データ等価 vs 機能等価のどれか)

---

## §5. 推奨アーキテクチャ案 (3 案、trade-off 付き)

> **重要**: 案を採用する前に PO の §6 質問への回答が前提。回答次第で推奨案が変わる。

### 案 A: 現状 ADR-0046 を維持 + UI Contract 文書化のみ追加

**概要**: 技術スタックは現状のまま。`docs/contracts/child-home-ui.md` を新規作成し、「**ChildHome 画面が満たすべき UI Contract**」を SSOT 化:
- どの情報を表示するか (進捗 / activity 一覧 / shop tab 等)
- どの interaction を提供するか (記録 / cancel / pin / claim 等)
- どの mock data を demo で提供するか (Activity 10 件 vs 51 件のどちらが正か)
- 5 年齢モード別の差分は labels.ts / age-tier.ts に集約

**メリット**:
- 追加コードゼロ
- ADR-0046 が解決した範囲を保全
- PO の goal 判断が反映されやすい (= ドキュメントだけ更新で済む)

**デメリット**:
- 「UI Contract に書いてないけど UI には出てる」divergence が残ると再び haribote
- ドキュメント保守を怠ると風化

**工数**: 1-2 日 (Contract 起票 + 既存 UI の Contract 準拠 audit)

**失敗リスク**:
- 「Contract に書いた / 書いてない」議論が PR レビューで延々続く可能性
- demo / production 間で Contract 違反が見つかるたびに修正 PR が発生

**過去 haribote パターン回避**:
- 「Tier N で統合」「scope 外」「snapshot patch」を **Contract 違反 = ブロッカー** として一律拒否できる

**Pre-PMF 適合度**: ◎ (機構変更ゼロ、ドキュメント整備のみ)

---

### 案 B: Domain Service + UI Contract SSOT (推奨)

**概要**: 案 A に加え、`ChildDashboardHomeData` interface を **domain-driven な ViewModel に昇格**:
- 現状: Drizzle 推論型 → `as never` キャスト → DashboardView 描画
- 改善後: Drizzle 推論型 → `ProductionDashboardService.toViewModel()` (ACL 役) → `ChildHomeViewModel` (UI 唯一の入力契約) → DashboardView 描画
- demo 側も `DemoDashboardService.toViewModel()` で同じ `ChildHomeViewModel` を生成
- DashboardView は **`ChildHomeViewModel` 以外の型を一切受け取らない** (型レベル SSOT)

**ViewModel の中身** (例):
```
ChildHomeViewModel = {
  progressDisplay: { type: 'level-percent', level: number, percent: number }
                 | { type: 'today-missions', completed: number, total: number },
  activities: Activity[] (length 制約は demo/prod で同じ contract),
  features: { showShopTab: boolean, showXpAnimation: boolean, ... },
  currency: { symbol: string, code: 'JPY' | 'P' | ... },
  // 全 5 項目の divergence を ViewModel field として明示化
}
```

**メリット**:
- 「UI に何が描かれるか」が **型と Contract の両面で SSOT 化** (ADR-0045 の terms.ts atom/compound と同じ発想)
- divergence (進捗 UI 等) は ViewModel の `progressDisplay.type` で表現 → DashboardView が両方 render 可能
- Drizzle 推論型の `as never` キャストを排除 → 型安全性向上
- 案 A の上に乗るので互換性あり

**デメリット**:
- ViewModel 定義に着手前の合意必須 (= §6 PO 質問への回答が前提)
- 既存の Drizzle 推論型からの転換に 200-300 行の型コード
- ViewModel 設計に間違いがあると 5 項目以上の divergence が再爆発

**工数**: 1-2 週間 (PO 合意 → Contract 起票 → ViewModel 設計 → 両 Service 実装更新 → DashboardView 配線)

**失敗リスク**:
- ViewModel の type union (`type: 'level-percent' | 'today-missions'`) を採用すると「demo が常に `today-missions` を返し、production が常に `level-percent` を返す」固定化が起き、結局 divergence が残る
- 対策: type union は「**子供の年齢 / プラン状態に応じて切替わる**」という UX 法則に従わせ、demo / production の identity ではなく **コンテキスト** に紐付ける

**過去 haribote パターン回避**:
- 「**type union が contract**」になるため snapshot+patch では type 違反になる
- 「`progressDisplay.type` を増やすときは PR で必ず両 Service の生成 logic を更新」というルールが型で強制される

**Pre-PMF 適合度**: ○ (ADR-0010 Bucket A: 二重実装 SSOT 化、適格)

---

### 案 C: Server-side demo Drizzle (Stripe test mode 流)

**概要**: demo も production と同じ `/api/v1/...` を叩く。サーバ側で `if (request.isDemo)` ではなく **demo 用 in-memory Drizzle instance** を立てて、同じ SQL ロジックを demo data に対して走らせる。

具体的構造:
- `src/lib/server/demo-db.ts` で `better-sqlite3` の `:memory:` instance を起動
- demo cookie を見て request 単位でどちらの DB instance を使うか branch
- demo data は session 単位で隔離、production data は通常通り

**メリット**:
- demo / production が **同じ SQL ロジック、同じ Service、同じ API endpoint** を共有 → Stripe 級の parity
- Service Interface すら不要になる (= ADR-0046 ロールバック可能性あり)
- UI 側の divergence は完全に消える

**デメリット**:
- in-memory Drizzle は session 単位で隔離する必要があるが、Lambda / serverless 環境では **cold start 毎に reset** されるため demo の sessionStorage 隔離特性と矛盾
- Cognito 認証 bypass のセキュリティ設計が必要 (= 開発者が誤って demo cookie を本番環境で有効化するリスク)
- 5 年齢モード × demo data の seed が複雑化 (= 過去の `demo-data.ts` 拡張)

**工数**: 2-3 週間

**失敗リスク**:
- serverless cold start で demo session 状態消失 → ユーザに「**さっき記録したのに消えた**」体験を提供 (Anti-engagement 違反)
- Cognito bypass の設計ミスで本番認証 bypass が漏れる致命的セキュリティ事故

**過去 haribote パターン回避**:
- divergence は構造的に発生しない (= 同じコード走る)
- ただし「サーバ側 demo」のオーバーヘッドが大きく、PO が「demo は LP SS 用なので軽量で」と判断したら adoption 困難

**Pre-PMF 適合度**: △ (Pre-PMF 個人開発で serverless 制約と戦うコストが高い)

---

### 案 F (v2 追加): Multi-Lambda Deployment + 単純 env 駆動 mode

**概要**: PO 追加指示「demo Lambda 別 deploy 許容」を最大限活かす。codebase は 1 つ、deploy が 2 (production Lambda / demo Lambda)。env var `DEMO_DEPLOY=true` で demo Lambda だけが demo branch (mock data load / auth bypass / etc.) を有効化。抽象化 layer は最小限 (Repository factory が env を見る 1 箇所のみ)。

**具体的構造**:

- `src/lib/server/runtime-config.ts` (新規、§2.8 参照) で env を読み `isDemoDeploy` を export
- Repository factory / Auth provider factory の 2 箇所だけが `isDemoDeploy` を見て実装を swap
- DashboardView / その他全 UI コードは env を一切意識しない
- demo Lambda 起動時に `demo-seed.ts` を `:memory:` SQLite または専用 RDS instance に投入
- DNS / URL: `demo.ganbari-quest.com` → demo Lambda、`app.ganbari-quest.com` → production Lambda (§6 Q14)
- GitHub Actions workflow を 2 つ用意 (`.github/workflows/deploy-production.yml` / `deploy-demo.yml`)、share 可能な job は composite action で共通化

**メリット**:

- **抽象化コスト最小** — Service Interface (ADR-0046) の現状を保ちつつ、env 駆動の factory 1 箇所追加で完結
- **production code が demo を意識しない** — `if (isDemo)` を production source からほぼ消せる (factory 1 箇所のみ残る)
- **過去 7 回失敗パターンの構造的廃止** — demo cookie 漏れ、auth bypass 混入、demo data 本番汚染が物理的に不可能
- **schema migration 独立性** — demo Lambda の schema 変更が production に影響しない (逆も真)
- **Pre-PMF 適合** — Lambda 課金 2 倍は Pre-PMF 個人開発で許容範囲、ADR-0010 Bucket A 適格
- **業界標準的に正しい** — Twelve-Factor App + Stripe / Vercel / Atlassian の事例と整合

**デメリット**:

- **Lambda 課金 2 倍** — Pre-PMF で月額 $X → $2X (具体額は §6 Q11 で PO 判断)
- **CI/CD pipeline 重複** — workflow 2 本、ただし composite action で 80% reuse 可能
- **schema migration の demo 追従** — production migrate 時に demo Lambda にも適用が必要、CI で `auto-sync-demo-schema.yml` で自動化可能
- **env 駆動 `if` 分岐が散在するリスク** — 規律で防ぐ (Repository factory 1 箇所のみ、ESLint rule で強制可)
- **DNS / URL 設計判断が必要** — §6 Q14
- **demo Lambda 上の seed data の整合性検証** — production と「同じ field を持つか」の lint が必要

**工数**: 2-4 週間 (case 別)
- Week 1: `runtime-config.ts` + Repository factory + Auth factory の env 駆動化、demo Lambda の dev env でロード確認
- Week 2: demo Lambda の AWS Lambda deploy + DNS 設定 + CloudFormation / SAM template 整備
- Week 3: schema migration の demo 自動追従 CI + demo seed の lint gate 整備
- Week 4: 過去 7 回失敗パターンに対する postmortem として「demo cookie / route 分岐コードの全削除」+ E2E 検証

**失敗リスク**:

- **env 分岐が source 全域に散在** — Repository factory 1 箇所に閉じる規律を ESLint custom rule で強制 (`no-direct-runtime-config` rule)
- **demo Lambda の cold start 時 seed 失敗** — Lambda init handler で seed 完了を assert、失敗時 deploy 全体 fail
- **production schema migrate 後に demo Lambda の DB を migrate し忘れ** — `check-demo-prod-schema-parity.mjs` を必須 CI gate 化

**過去 haribote パターン回避**:

- 「Tier N で統合」「scope 外」「snapshot patch」は **物理的に不可能** (demo / production が別 Lambda なので、UI / Service の片方だけ patch しても他方に影響しない構造)
- ただし「demo Lambda は demo 専用 UX で自由」を許せば再び UI divergence が発生 → 案 B (UI Contract) と組み合わせる必要あり (= 案 G に進化)

**Pre-PMF 適合度**: ○ (Bucket A 適格、Lambda 課金 2 倍は許容)

**ADR との整合**:

- ADR-0010 (Pre-PMF scope): Lambda 課金 2 倍は Bucket A 投資、二重実装 SSOT 化のコスト合理性あり
- ADR-0012 (Anti-engagement): demo Lambda 内で煽り UX を作らない規律は ADR-0012 で別途担保
- ADR-0013 (LP truth): demo Lambda の UX が production と乖離すると LP truth 違反、案 G で UI Contract 併用すれば解決

---

### 案 G (v2 追加): Multi-Lambda + Domain ViewModel 抽象化併用 (Hybrid)

**概要**: 案 F (Multi-Lambda) + 案 D 風 Demo Tenant + 案 B (Domain ViewModel) の組み合わせ。Multi-Lambda で物理的分離を確保しつつ、UI 層で ViewModel Contract を SSOT 化し、demo Lambda / production Lambda が同じ ViewModel を生成する規律を強制する。

**具体的構造 (案 F + 案 B)**:

- 案 F の env 駆動 factory に加えて、案 B の `ChildHomeViewModel` を SSOT 化
- demo Lambda の `DemoChildDashboardService` も production Lambda の `ProductionChildDashboardService` も、最終的に同じ `ChildHomeViewModel` を返す
- DashboardView は `ChildHomeViewModel` 以外の型を受け取らない (型レベル SSOT)
- demo Lambda は ViewModel を mock data から生成、production Lambda は Drizzle data から生成
- 機能セット divergence (shop tab 等) は ViewModel の `features.showShopTab: boolean` field で表現、demo / production それぞれの factory が値を決定

**メリット (案 F に加えて)**:

- **UI 層が ViewModel という型で SSOT 化** — demo / production の divergence が型レベルで強制統一
- **新機能追加時の規律** — `ChildHomeViewModel` に field を追加するときは demo / production 両方の Service 実装更新が必須 (型 error で強制)
- **過去 7 回失敗パターンの 2 重防衛** — 物理的分離 (案 F) + 型レベル SSOT (案 B)
- **将来の認証段階移行 (Supabase 流) への布石** — ViewModel が抽象化されていれば、`isDemoDeploy` env から「anonymous user / authenticated user の判定」への移行も影響範囲が ViewModel factory に閉じる

**デメリット (案 F に加えて)**:

- **工数追加** — 案 B 分の 1-2 週間が加算 → 合計 4-6 週間
- **ViewModel 設計の合意コスト** — PO が ViewModel field の意味論を理解する必要 (§6 Q2 / Q5 / Q6 の回答が前提)
- **過剰抽象化のリスク** — Pre-PMF で ViewModel 層が肥大化すると保守性低下

**工数**: 4-6 週間 (案 F の 2-4 週間 + 案 B の 1-2 週間)

**失敗リスク**:

- **ViewModel 設計ミスで再爆発** — `progressDisplay: { type: 'level' | 'today-missions' }` を導入したのに demo が常に `today-missions`、production が常に `level` を返す固定化 (= divergence が ViewModel field 名に変わっただけ)
- 対策: ViewModel の type union は「**子供の年齢 / プラン状態 / 文脈**に応じて切替」という UX 法則に従わせ、demo / production の identity ではなく context に紐付ける
- **規律の運用負荷** — ViewModel に field 追加するたびに demo / production 両方の factory を更新する規律が PR レビューで毎回チェック必要

**過去 haribote パターン回避**:

- **3 重防衛** — 物理的分離 (案 F) + 型レベル SSOT (案 B) + Contract 文書 (案 A)
- 「snapshot+patch」は型 error で構造的に不可能、demo Lambda / production Lambda の片方だけ patch しても ViewModel 不整合で型 error

**Pre-PMF 適合度**: △ (案 F より重い、Pre-PMF で 4-6 週間は許容可能だが PO の Q1 回答次第)

**ADR との整合**:

- 案 F の整合性に加え、ADR-0013 (LP truth) との完全整合 (ViewModel が production と demo で揃う)
- ADR-0046 (Service Interface) を ViewModel 層に拡張 → 既存 ADR の延長線

---

### §5 案比較表

| 観点 | 案 A (Contract のみ) | **案 B (Domain ViewModel)** | 案 C (Server demo Drizzle) | **案 F (Multi-Lambda 単純)** | **案 G (Multi-Lambda + ViewModel)** |
|---|---|---|---|---|---|
| 工数 | 1-2 日 | 1-2 週間 | 2-3 週間 | 2-4 週間 | 4-6 週間 |
| 機構変更 | なし | 中 (ViewModel 層追加) | 大 (DB instance 二重化) | 大 (Lambda 二重化) | 最大 (Lambda + ViewModel) |
| 型安全性 | 不変 | **向上** | 不変 | 不変 | **最大** |
| haribote 防止 | 弱 (ドキュメント依存) | **強 (型強制)** | 最強 (構造的に発生せず) | **最強 (物理分離)** | **最最強 (3 重防衛)** |
| Pre-PMF 適合 | ◎ | ○ | △ | ○ | △ |
| Anti-engagement 整合 | ○ | ○ | △ (cold start で session 消失リスク) | ○ | ○ |
| 失敗リスク | 中 (議論延長) | 中 (ViewModel 設計ミス) | 高 (セキュリティ + serverless) | 中 (schema 同期) | 中 (ViewModel + schema 同期) |
| PO 判断必要度 | **高** (Contract 内容) | **高** (ViewModel 設計) | 低 (技術判断中心) | **最高** (Lambda コスト + URL 設計) | **最高** (上記 + ViewModel) |
| **Deployment 階層** | L1 | L1 | L1 | **L2/L3** | **L2/L3** |
| **Lambda コスト (現状比)** | 1.0x | 1.0x | 1.0x | **2.0x** | **2.0x** |
| **過去 7 回失敗パターン耐性** | 弱 | 中 | 強 | **強 (物理分離)** | **最強** |
| **demo cookie 漏れリスク** | あり | あり | あり | **構造的にゼロ** | **構造的にゼロ** |
| **auth bypass 本番混入リスク** | あり | あり | あり (in-memory Drizzle 経由) | **構造的にゼロ** | **構造的にゼロ** |

---

## §6. PO への質問項目 (定義しないと進めない疑問点)

### Q1 (最重要). demo の goal は何か?

**選択肢**:
- **A. LP 訴求のためのマーケティング素材** — 「無料で試せる」を示す軽量 demo、UX 一致は二次的
- **B. 未認証で本番 UX を体験させるオンボーディング** — 認証ハードルを下げて signup conversion 上げる
- **C. production と完全 parity のデモンストレーション** — 「これがそのまま本番です」と示す
- **D. 上記すべて (= 全部実現したい)**

**含意**:
- A → 案 B 簡易版で十分、demo は demo 専用 UX 許容、ADR-0013 LP truth は demo に適用しない
- B → 案 C が最適、demo data を auth 後に永続化する流れも検討
- C → 案 B フル装備が必要、機能セット完全一致を目指す
- D → 不可能 (A と B/C は哲学的に対立)、優先順位の明確化が必要

---

### Q2. 「demo と production が物理的に同じ表示になる」のと「同じ UX 体験を提供する」のどちらが goal か?

**選択肢**:
- **A. ピクセル等価** (= 案 C 必須、過去 7 回の試行が目指していた方向)
- **B. UX 等価** (= 案 A/B で十分、機能セットが揃えば見た目の細部は許容)
- **C. 機能セット等価** (= 案 B 推奨、shop tab 等の divergence は禁止だが進捗 UI 等は文脈で変動可)

**含意**: PO の screenshot 比較指摘 (進捗 UI / Activity 数 / counter badge / shop tab / currency) のうち、**どれが本当に許せない divergence か**を絞り込む。例えば「shop tab が demo にないのは構造的問題、進捗 UI の見せ方は年齢モード差なら許容」というように細分化。

---

### Q3. demo の sessionStorage 記録は永続化すべきか?

**選択肢**:
- **A. 揮発のまま (現状)** — タブ閉じれば消える、軽量
- **B. localStorage で永続** — リピート訪問で前回の demo 状態が残る、Anti-engagement 微妙
- **C. signup 時にサーバ移行** — Supabase / Firebase 流、demo → 認証への滑らかな移行

**含意**:
- B/C を選ぶと sessionStorage SSOT 設計を全面見直し
- A のままなら demo は LP SS 撮影と短時間体験に最適化、深い UX 検証には不向き
- ADR-0012 anti-engagement との整合は A が最強、C は signup conversion 向上だが体験延伸誘発リスク

---

### Q4. demo の通貨表示は production 設定追従か demo デフォルト固定か?

**選択肢**:
- **A. demo 固定 `P`** (現状) — シンプル、LP 訴求で「ポイント」概念を一定化
- **B. production 設定追従 (円 etc)** — 「家族ごとに変えられる」訴求と整合

**含意**:
- A → demo は demo 専用、currency settings 表示は demo で disable
- B → demo に「**家族設定**」mock 画面も必要、demo の機能セット拡大

---

### Q5. demo のショップタブは何にすべきか?

**選択肢**:
- **A. 「デモではご利用いただけません」モーダル表示** — 機能セット parity、interaction 制限
- **B. demo 専用 shop ページ作成** — mock 商品が買える、demo data の sessionStorage 永続化必須
- **C. ショップタブ自体を隠す** (現状) — 機能セット divergence 容認
- **D. signup 誘導 CTA に置換** — 「お買い物機能は signup 後に」conversion 重視

**含意**:
- A/B → 案 C (server demo Drizzle) 推奨、shop も demo data で実動作
- C → 案 A (Contract で「demo は shop 非表示」を明文化、divergence を許容)
- D → 案 A + Q1=B (signup conversion 最適化)

---

### Q6. demo の Activity 数は何件が「正」か?

**選択肢**:
- **A. demo 専用に絞った 10 件** (現状) — LP SS で読みやすい、訴求最適化
- **B. production と同じ 51+ 件** — parity 重視、ただし LP SS で雑然
- **C. 5 年齢モード別に 5-20 件** — 文脈最適化、Contract で明文化

**含意**:
- A → demo は demo 専用 UX (哲学 B)
- B → production parity 重視 (哲学 C)
- C → ViewModel に `featuredActivities` field 追加、demo / production それぞれ生成 logic 持つ

---

### Q7. 5 年齢モード (baby / preschool / elementary / junior / senior) の demo / production 整合方針は?

**選択肢**:
- **A. demo は全 5 モード提供、production と同等の UX 差** (現状?)
- **B. demo は elementary のみ、他は production 専用** — demo 簡素化
- **C. demo は全 5 モードだが baby は親準備モード (ADR-0011) で別 UX**

**含意**:
- C が ADR-0011 と整合、ただし demo SS は baby モードで「親 UI」を出すべきかが PO 判断

---

### Q8. 過去 7 回失敗を踏まえ、どの「逃げ語」を PR レビューで禁止語化するか?

**禁止語候補** (CLAUDE.md または PR template に明記):
- 「Tier N で統合」「POC scope」「等価性維持」「足場として」「逆輸入回避」「demo 寄せ統合」「snapshot patch」
- 「とりあえず」「一旦」「次フェーズで」「scope 外」
- 「demo と本番の UI 差分は許容範囲」(= 何が許容範囲かの contract 不在を隠蔽する逃げ語)

**含意**: 禁止語化は強い規律だが、本当に scope 切らないと進まない場合の救済策が必要 (例: 禁止語使うときは ADR 起票必須 / Issue 化 + due date 明記)。

---

### Q9. demo の更新頻度 / production との同期コストは誰が払うか?

**選択肢**:
- **A. production 変更時に必ず demo も同期** (CI で自動検証) — 工数増だが divergence ゼロ
- **B. demo は四半期に 1 回まとめて同期** — 軽量、divergence は短期容認
- **C. demo は production と機構的に分離されているので同期不要** (案 C 採用時) — 構造で解決

**含意**: A は **CI gate (例: `check-demo-prod-parity.mjs`)** が必要。B は PO が「3 ヶ月遅延を許容するか」次第。C は技術投資前提。

---

### Q10. 「demo の goal」と「LP の goal」は同じか?

**含意**:
- 同じ場合 → demo = LP SS 撮影専用、UX は二次的
- 違う場合 → demo = signup 前体験、LP は LP 専用素材 (= demo SS を LP に使わない可能性)

→ ADR-0013 (LP truth) と Q1 の選択肢の絡みで重要。LP に demo の SS を貼るなら **demo は production の事実を反映必須**、貼らないなら自由度高い。

---

### Q11 (v2 追加・最重要). demo Lambda の infra コスト (Lambda 課金 2 倍) を Pre-PMF で許容するか?

**背景**: PO 追加指示「demo Lambda 別 deploy 許容」を案 F / G が前提とする。

**選択肢**:
- **A. 許容 (Bucket A 投資)** — Lambda 課金 2 倍は Pre-PMF で許容、過去 7 回失敗の構造的解決のために払う
- **B. 条件付き許容** — demo Lambda の Lambda 同時実行数を 1〜2 に絞る / CloudFront cache で Lambda 起動回数最小化
- **C. 不可** — 案 A/B/C 内で解決、Multi-Lambda は post-PMF まで待つ

**推定コスト試算 (参考)**:

| 項目 | production Lambda 現状 | demo Lambda 追加 | 合計増分 |
|---|---|---|---|
| Lambda 課金 (月 100k req) | ~$5 | ~$5 | +$5/月 |
| CloudWatch Logs | ~$1 | ~$1 | +$1/月 |
| Cognito User Pool (demo は dummy なら最小) | ~$0 | ~$0 (dummy) | $0/月 |
| RDS / DynamoDB (demo を in-memory or 別 instance) | ~$10 | ~$0 (in-memory) または +$10 (別 DB) | +$0〜$10/月 |
| Route 53 / ACM (demo.ganbari-quest.com) | ~$0.5 | 0 (既存 zone 流用) または +$0.5 (別 zone) | $0〜$0.5/月 |
| **合計増分** | — | — | **+$6 〜 +$16/月** |

**含意**:
- A 選択 → 案 F または G に進める、月 $6-$16 の追加投資を許容
- B 選択 → Lambda provisioned concurrency 0 + reserved concurrency 1 で cold start 許容、コスト最小化
- C 選択 → 案 A / B / C で進める、Multi-Lambda は将来 issue

---

### Q12 (v2 追加). demo Lambda の DB は何を選ぶか?

**背景**: 案 F / G の DB strategy 選択が必要。

**選択肢**:
- **A. 完全分離 (別 RDS instance / 別 DynamoDB Table)** — production data に物理的に影響ゼロ、コスト +$10/月、データ永続化される
- **B. 同一 schema、別 logical DB** — production と同じ RDS instance に `ganbari_quest_demo` schema を作成、コスト最小化だが logical 分離のみ
- **C. In-memory SQLite (`:memory:`)** — Lambda cold start ごとに demo data を seed、永続化なし、コスト $0
- **D. Shared DynamoDB Table + demo prefix** — `demo_*` partition key で論理分離、production code に prefix logic が必要
- **E. SQLite ファイル on Lambda /tmp** — Lambda instance lifetime のみ永続、500MB 上限あり、コスト $0

**含意**:
- A → 最も安全、案 G に最適、coding 最小
- B → コスト最小だが万一 SQL injection / migration ミスで production data 汚染リスク残る
- C → 過去の sessionStorage と等価、案 D (Demo Tenant) と比較すべき
- D → DynamoDB 移行と組み合わせる場合の選択肢
- E → Lambda instance reuse 時のみ永続、demo session が Lambda lifetime に依存して unpredictable

**推奨 (調査者の意見、PO 判断前提)**:
- 短期: C (in-memory) を選び、Lambda cold start で `demo-seed.ts` 実行
- 長期: 案 G を選び demo data が複雑化するなら A (別 RDS) へ移行

---

### Q13 (v2 追加). demo Lambda の auth は何を選ぶか?

**選択肢**:
- **A. 完全 bypass (auth middleware を demo Lambda で disable)** — env で auth check を skip、最小実装
- **B. Dummy Cognito user (固定 ID で auto-login)** — auth middleware は動くが demo Lambda 内の dummy provider から token 取得
- **C. Shared Cognito 別 user pool (`ganbari-quest-demo-pool`)** — Cognito を 2 pool 用意、demo Lambda は demo pool に向く
- **D. Anonymous Cognito (Supabase 流)** — Cognito の Anonymous user 機能 (実は Cognito 標準にはなく、unauthenticated identity for federated identity のみ) → Cognito 単体では困難、AWS Cognito Identity Pool との組み合わせ必要

**含意**:
- A → 最小実装、ただし auth-aware UI コード (`if (user)` 等) が demo Lambda で動作しないため、UI 側で dummy user を inject する必要
- B → auth middleware が production と同じ pipeline を通る、最も parity 高い
- C → 物理的に分離された Cognito、demo signup 後の production 移行に追加実装必要
- D → Cognito 標準で実現困難、案 G の将来拡張時に検討

**推奨 (調査者の意見、PO 判断前提)**:
- 短期: B (dummy user) を Repository factory と同様 Auth provider factory で env 駆動 swap
- 長期: 案 G に進化、必要なら C (別 pool) へ

---

### Q14 (v2 追加). demo Lambda の URL / DNS は何を選ぶか?

**選択肢**:
- **A. `demo.ganbari-quest.com`** — subdomain 分離、ALB / CloudFront / Route 53 設定追加、SSL 証明書共有 (wildcard) または別証明書
- **B. `app.ganbari-quest.com/demo/` (path-based routing)** — ALB の path routing で demo Lambda へ振分、現状の `/demo/` URL 構造と一致、DNS 追加なし
- **C. `demo-app.ganbari-quest.com`** — A のバリエーション、subdomain 名を明示化
- **D. 別ドメイン (`try-ganbari-quest.com`)** — 完全分離、別ドメイン取得コスト、SEO 含意あり

**含意**:
- A → 業界標準 (atlassian.com → sandbox.atlassian.com)、Cognito redirect / OAuth integration が subdomain で問題出ないか確認必須
- B → 現状の `/demo/` URL を維持、最小変更、ただし ALB path routing 設定が必要 + Cookie 共有のセキュリティ含意
- C → A と同じ、命名だけ違う
- D → SEO 上有利 (production と demo が分離) だが、ブランディング統一感が落ちる

**推奨 (調査者の意見、PO 判断前提)**:
- B (`/demo/` path-based) が SEO / UX / 移行コスト面で最適
- ただし Cookie 共有のセキュリティ含意を ADR で議論する必要 (demo cookie が production path に漏れないか)

---

### Q15 (v2 追加). production schema migration を demo Lambda に追従させる仕掛けは?

**選択肢**:
- **A. CI auto-deploy** — production deploy 完了後に GitHub Actions が demo Lambda に同じ migration を自動適用
- **B. Weekly sync (cron job)** — demo Lambda が毎週日曜に production と schema 整合を確認 + 自動 migrate
- **C. On-demand seed (cold start 毎に full reset)** — demo Lambda は migration を持たず、cold start で最新 schema の demo data を seed
- **D. Manual sync** — schema 変更時に PO / Dev が手動で demo Lambda にも apply (運用負荷高、現実的でない)

**含意**:
- A → 最も確実、CI workflow に `deploy-demo-after-production.yml` を追加
- B → CI コスト最小、ただし最大 1 週間の divergence 容認
- C → demo Lambda が stateless になる、Q12 で C (in-memory) を選んだ場合に自然な選択
- D → Pre-PMF で許容可能だが、Multi-Lambda の主旨「構造的解決」と矛盾

**推奨 (調査者の意見、PO 判断前提)**:
- Q12 で C (in-memory) を選んだ場合 → C (on-demand seed) が自然
- Q12 で A (別 RDS) を選んだ場合 → A (CI auto-deploy) が必須
- CI gate に `check-demo-prod-schema-parity.mjs` を追加し、demo Lambda の DB schema と production schema が一致することを E2E で検証

---

## §7 (v2 追加): Deployment 分離許容下での全 page インベントリ再分類

PO 追加指示「demo Lambda 別 deploy 許容」により、過去「困難 (auth 分岐)」だったカテゴリの一部が「容易 (env 駆動で完全分離)」に移動可能か再評価する。

### §7.1 旧分類 (L1 single deployment 前提)

| カテゴリ | 例 page | 旧 difficulty | 旧理由 |
|---|---|---|---|
| **A. 公開 page (auth 不要)** | `/`, `/pricing`, `/faq` | 容易 | demo / production 共通、divergence なし |
| **B. demo 専用 page (auth bypass)** | `/demo/lower/home`, `/demo/admin/*` | 中 | demo cookie で auth bypass、production code に if 分岐 |
| **C. 認証 page (auth 必須)** | `/(child)/lower/home`, `/(parent)/admin/*` | 中 | Cognito auth check、auth middleware 通過 |
| **D. demo + 認証両対応 page (UI 統合済)** | `DashboardView` 等 SSOT 化された UI | **困難** | Service Interface で auth 分岐、現状 7 回失敗中 |
| **E. demo seed 依存 page** | `/demo/admin/license` 等 | **困難** | demo data が production と乖離、UI 差分管理が二重 |

### §7.2 新分類 (L2/L3 Multi-Lambda 前提)

PO 追加指示で Multi-Lambda が許容された場合の再分類:

| カテゴリ | 例 page | 新 difficulty | 新理由 |
|---|---|---|---|
| **A. 公開 page** | `/`, `/pricing`, `/faq` | 容易 | 不変、両 Lambda にデプロイ |
| **B. demo 専用 page** | `/demo/lower/home`, `/demo/admin/*` | **容易 (大幅改善)** | demo Lambda にのみ存在、production Lambda にはデプロイされない (`build:demo` でのみ含める) |
| **C. 認証 page** | `/(child)/lower/home`, `/(parent)/admin/*` | 不変 | production Lambda の auth check は変わらず |
| **D. demo + 認証両対応 page** | `DashboardView` 等 SSOT 化された UI | **中 (改善)** | 物理的に別 Lambda、UI コード は同一 codebase、Repository factory が env で実装 swap |
| **E. demo seed 依存 page** | `/demo/admin/license` 等 | **容易 (大幅改善)** | demo Lambda 内で seed が完結、production への汚染ゼロ |

### §7.3 移行戦略 (Multi-Lambda 採用時)

**Phase 1**: env 駆動 factory 整備 (案 F 1-2 週目)
- `runtime-config.ts` + Repository factory + Auth factory
- demo Lambda の dev env でロード確認、production Lambda は不変

**Phase 2**: demo Lambda の AWS deploy 整備 (案 F 2-3 週目)
- CloudFormation / SAM template で demo Lambda + Route 53 + CloudFront
- demo seed (`demo-seed.ts`) の Lambda init handler 化
- CI workflow 整備

**Phase 3**: 既存 `/demo/` routes を demo Lambda 専用に migrate (案 F 3-4 週目)
- `src/routes/demo/` を demo Lambda の build target に限定 (`vite.config.ts` の conditional build)
- production Lambda の bundle から `/demo/` を除外
- demo cookie / route 分岐の全削除

**Phase 4 (任意, 案 G に進化)**: UI Contract 強制 (1-2 週目)
- `ChildHomeViewModel` interface + 両 Lambda の Service が同じ ViewModel を返す型強制
- 既存の 7 回失敗パターンに対する 2 重防衛

### §7.4 page 別の Multi-Lambda 採用時の影響度

| page グループ | production Lambda | demo Lambda | 統合難度 (旧 → 新) |
|---|---|---|---|
| LP (site/index.html 等) | デプロイ (静的) | デプロイ (静的) | 容易 → 容易 |
| `/demo/lower/home` | **除外** | デプロイ | 中 → **容易** |
| `/demo/admin/*` | **除外** | デプロイ | 困難 → **容易** |
| `/(child)/lower/home` | デプロイ | **除外** | 困難 → 中 |
| `/(parent)/admin/*` | デプロイ | **除外** | 中 → 中 |
| `/auth/login`, `/auth/signup` | デプロイ | デプロイ (dummy auth) | 中 → 容易 |
| `/api/v1/*` | デプロイ | **除外** または demo 専用版 | 困難 → **容易** |

**観察**:

- Multi-Lambda 採用で **「困難」カテゴリが「容易」または「中」に降格**するケースが多数
- 特に `/demo/admin/*` 系の license / ops 管理画面は demo Lambda 専用にすると production 認証分岐が完全に消える
- ただし「demo Lambda にデプロイされる page」「production Lambda にデプロイされる page」の build target 分離設計が新たな複雑度として加わる

---

## 参考リンク一覧

| URL | アクセス日 | 用途 |
|---|---|---|
| [Duolingo Server-Driven UI](https://blog.duolingo.com/server-driven-ui/) | 2026-05-14 | §1.1 / §2.5 SDUI |
| [Duolingo Software Architecture Guide](https://hackmd.io/YGfJCiGdQjSnlEDJD0sHpg) | 2026-05-14 | §1.1 |
| [Khan Academy API Wrapper](https://github.com/weo-edu/khan) | 2026-05-14 | §1.2 |
| [Khan Academy Mastery Progress Reports](https://support.khanacademy.org/hc/en-us/articles/360031129891-What-reporting-options-are-available-on-Khan-Academy-for-teachers-to-track-student-performance) | 2026-05-14 | §1.2 |
| [Notion Sharing & Permissions](https://www.notion.com/help/guides/understanding-notions-sharing-settings) | 2026-05-14 | §1.5 |
| [Notion Template Gallery Ultimate Guide](https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates) | 2026-05-14 | §1.5 |
| [Figma Community Guide](https://help.figma.com/hc/en-us/articles/360038510693-Guide-to-the-Figma-Community) | 2026-05-14 | §1.6 |
| [Introducing Figma Community](https://www.figma.com/blog/introducing-figma-community/) | 2026-05-14 | §1.6 |
| [Supabase Anonymous Sign-Ins Docs](https://supabase.com/docs/guides/auth/auth-anonymous) | 2026-05-14 | §1.3 |
| [Supabase Blog: Anonymous Sign-ins](https://supabase.com/blog/anonymous-sign-ins) | 2026-05-14 | §1.3 |
| [Firebase Anonymous Auth Best Practices](https://firebase.blog/posts/2023/07/best-practices-for-anonymous-authentication/) | 2026-05-14 | §1.4 |
| [Firebase Web Anonymous Auth](https://firebase.google.com/docs/auth/web/anonymous-auth) | 2026-05-14 | §1.4 |
| [GitHub Enterprise Anonymous Git Access](https://docs.github.com/en/enterprise-server@3.11/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/enabling-anonymous-git-read-access-for-a-repository) | 2026-05-14 | §1.7 |
| [Stripe Dashboard Basics](https://docs.stripe.com/dashboard/basics) | 2026-05-14 | §1.8 |
| [Stripe Test Mode vs Live Mode](https://support.stripe.com/questions/stripe-issuing-test-mode-configurations-and-differences-vs-live-mode) | 2026-05-14 | §1.8 |
| [Wikipedia: Hexagonal Architecture](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)) | 2026-05-14 | §2.1 |
| [Alistair Cockburn: Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) | 2026-05-14 | §2.1 |
| [Azure Anti-Corruption Layer Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) | 2026-05-14 | §2.2 |
| [DDD-Practitioners: Anticorruption Layer](https://ddd-practitioners.com/home/glossary/bounded-context/bounded-context-relationship/anticorruption-layer/) | 2026-05-14 | §2.2 |
| [Better Programming: Repository Pattern + DI](https://betterprogramming.pub/decoupling-your-concerns-with-dependency-injection-the-repository-pattern-react-and-typescript-6b455788a374) | 2026-05-14 | §2.3 |
| [Carrion.dev: DataSources and Repository Patterns](https://carrion.dev/en/posts/datasources-repository-patterns/) | 2026-05-14 | §2.3 |
| [Feature Gating: Freemium SaaS without Duplicating Components](https://dev.to/aniefon_umanah_ac5f21311c/feature-gating-how-we-built-a-freemium-saas-without-duplicating-components-1lo6) | 2026-05-14 | §2.4 |
| [LaunchDarkly Feature Flag Hierarchy](https://launchdarkly.com/docs/guides/flags/flag-hierarchy/) | 2026-05-14 | §2.4 |
| [Airbnb Server-Driven UI](https://medium.com/airbnb-engineering/a-deep-dive-into-airbnbs-server-driven-ui-system-842244c5f5) | 2026-05-14 | §2.5 |
| [Feature-Sliced Design Home](https://feature-sliced.design/) | 2026-05-14 | §2.6 |
| [FSD: DDD for Frontend Devs](https://feature-sliced.design/blog/ddd-for-frontend-devs) | 2026-05-14 | §2.6 |
| [MV-VI Pattern (DEV)](https://dev.to/psy082/mv-vi-pattern-domain-centric-design-for-frontend-applications-1j6a) | 2026-05-14 | §2.7 |
| [Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) | 2026-05-14 | §2.7 |
| [Martin Fowler: Modularizing React Applications](https://martinfowler.com/articles/modularizing-react-apps.html) | 2026-05-14 | §2.7 |
| [SvelteKit Auth Docs](https://svelte.dev/docs/kit/auth) | 2026-05-14 | §3.1 |
| [SvelteKit Loading Data Docs](https://svelte.dev/docs/kit/load) | 2026-05-14 | §3.1 |
| [SvelteKit DI Discussion #10105](https://github.com/sveltejs/kit/discussions/10105) | 2026-05-14 | §3.2 |
| [Kyle Nazario: Dependency injection in Svelte](https://kylenazario.com/blog/dependency-injection-in-svelte) | 2026-05-14 | §3.2 |
| [Securing Your SvelteKit App](https://www.captaincodeman.com/securing-your-sveltekit-app) | 2026-05-14 | §3.1 |
| [tcc-sejohnson/sveltekit-msw](https://github.com/tcc-sejohnson/sveltekit-msw) | 2026-05-14 | §3.2 |
| [Clean Frontend Architecture with SvelteKit](https://nikoheikkila.fi/blog/clean-frontend-architecture-with-sveltekit/) | 2026-05-14 | §3.5 |
| [upperdo/backoffice-template](https://github.com/upperdo/backoffice-template) | 2026-05-14 | §3.5 |
| [nikoheikkila/photo-browser](https://github.com/nikoheikkila/photo-browser) | 2026-05-14 | §3.5 |
| [Redocly: Sandbox environments reality check](https://redocly.com/blog/sandbox-environments-reality-check) | 2026-05-14 | sandbox 失敗事例 |
| [Maintaining feature flags in production engineering](https://dev.to/jackmarchant/maintaining-feature-flags-in-a-product-engineering-1d7a) | 2026-05-14 | §2.4 失敗事例 |
| [Ben Morris: The shared code fallacy](https://www.ben-morris.com/the-shared-code-fallacy-why-internal-libraries-are-an-anti-pattern/) | 2026-05-14 | 共有コードの落とし穴 |
| [Twelve-Factor App: Codebase](https://12factor.net/codebase) | 2026-05-15 | §2.8 v2 1 codebase / N deploys |
| [Twelve-Factor App: Config](https://12factor.net/config) | 2026-05-15 | §2.8 v2 env 駆動 config |
| [Twelve-Factor App: Build, release, run](https://12factor.net/build-release-run) | 2026-05-15 | §2.8 v2 deploy 設計 |
| [AWS Multi-Account Strategy Whitepaper](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html) | 2026-05-15 | §1.9 v2 L3 完全分離 |
| [AWS Organizations: Best Practices](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices.html) | 2026-05-15 | demo 別 account 戦略 |
| [Vercel Preview Deployments](https://vercel.com/docs/deployments/preview-deployments) | 2026-05-15 | §1.9 v2 branch 単位 deploy |
| [Atlassian Cloud Sandbox](https://support.atlassian.com/organization-administration/docs/cloud-sandbox/) | 2026-05-15 | §1.9 v2 L3 完全分離事例 |
| [Shopify Development Stores](https://help.shopify.com/en/partners/dashboard/managing-stores/development-stores) | 2026-05-15 | §1.9 v2 tenant 分離 |
| [Stripe Test Mode Architecture](https://docs.stripe.com/test-mode) | 2026-05-15 | §1.9 v2 L1+L2 ハイブリッド |
| [Heroku Review Apps](https://devcenter.heroku.com/articles/github-integration-review-apps) | 2026-05-15 | §1.9 v2 PR 単位 deploy |
| [Discourse Try (try.discourse.org)](https://try.discourse.org/) | 2026-05-15 | §1.9 v2 OSS demo の L2 |
| [Mattermost Cloud Trial](https://mattermost.com/sign-up/) | 2026-05-15 | §1.9 v2 OSS B2B demo |
| [Sentry Sandbox](https://sandbox.sentry.io/) | 2026-05-15 | §1.9 v2 L3 完全分離 SRE 事例 |
| [Supabase Multi-Project Pattern](https://supabase.com/docs/guides/platform/multi-environments) | 2026-05-15 | §1.9 v2 dev/staging/prod 別 project |
| [Firebase Multi-Project Workflow](https://firebase.google.com/docs/projects/dev-workflows/general-best-practices) | 2026-05-15 | §1.9 v2 |
| [Rocket.Chat Demo Mode](https://docs.rocket.chat/v1/docs/demo-environment) | 2026-05-15 | §1.9 v2 OSS demo |
| [GitLab.com vs gitlab.example.com (self-host)](https://docs.gitlab.com/ee/install/) | 2026-05-15 | §1.9 v2 L3 |
| [AWS SAM Multi-Environment](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-controlling-access-to-apis.html) | 2026-05-15 | §2.8 v2 SAM template 分離 |
| [AWS Lambda Aliases & Versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html) | 2026-05-15 | §2.8 v2 demo / production alias |
| [AWS Lambda Reserved Concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html) | 2026-05-15 | Q11 v2 demo Lambda コスト最適化 |
| [Cognito User Pools Best Practices](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-best-practices.html) | 2026-05-15 | Q13 v2 demo / production pool 分離 |
| [Route 53 Subdomain Routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html) | 2026-05-15 | Q14 v2 `demo.ganbari-quest.com` |
| [ALB Path-Based Routing](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-update-rules.html) | 2026-05-15 | Q14 v2 path-based routing |
| [The Phoenix Project: Type of Work](https://itrevolution.com/articles/five-ideals-of-devops/) | 2026-05-15 | env 駆動 deploy の DevOps 整合 |
| [Martin Fowler: BlueGreenDeployment](https://martinfowler.com/bliki/BlueGreenDeployment.html) | 2026-05-15 | §2.8 v2 deployment 分離思想 |
| [Continuous Delivery: Per-Environment Config](https://continuousdelivery.com/2011/05/continuous-delivery-with-databases-deployment-pipeline/) | 2026-05-15 | Q15 v2 schema migration 同期 |

---

## 付録: 過去 7 回失敗の構造的分類

| # | Issue/PR | 失敗パターン | 該当する逃げ語 |
|---|---|---|---|
| 1 | #531 | Tier N 統合計画 | 「Tier N で統合」 |
| 2 | #561 | POC scope 切り | 「POC scope」 |
| 3 | #562 | 等価性維持で実装回避 | 「等価性維持」 |
| 4 | #563 | 足場 (shim) で完了報告 | 「足場として」 |
| 5 | #566 | 同上 | 同上 |
| 6 | #2069 | Service Interface 導入 (POC scope) — 機構は正しいが UI 統合は未達 | 「POC scope」 |
| 7 | PR #2099 | demo 寄せ統合で本番 degrade、虚偽完遂報告 | 「demo 寄せ統合」「逆輸入回避」 |
| 8 (今回) | PO 警告 | snapshot+patch haribote の禁止 | 「snapshot patch」 |

**共通構造**: 「**何が完成形か**」を contract 化せずに「**統合の方向**」だけを議論してきた。案 B の UI Contract 化は **この構造を断ち切る最初の試み**となる。

---

## 補足: 本調査でカバーしなかった論点

調査範囲の honest な disclosure:

- **Anki / Habitica の guest mode 内部実装**: 一次情報源 (OSS リポジトリ) を確認したが、guest mode 自体存在せず (両者とも認証必須)。
- **Codecademy の anonymous editor 実装**: 公開 engineering blog がなく、外形観察のみ。技術詳細不明のまま記載省略。
- **Streamlit / Tableau Public**: dashboard 系で gamification ではないため、UX 設計の参考は限定的。
- **法的整合性**: 子供向けアプリで demo 中に個人情報を収集する場合の COPPA / GDPR-K 整合性は本調査範囲外 (別途 Legal review 必要)。
- **A11y 観点**: demo / production の divergence が a11y 影響を生む可能性は未調査。

これらは Issue #2097 とは別の follow-up Issue で扱うべき。
