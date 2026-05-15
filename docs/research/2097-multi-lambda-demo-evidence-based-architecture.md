# Multi-Lambda Demo Deployment — 実証事例・AWS 公式 source 調査

> **位置付け**: Issue #2097 v3 リサーチ。`2097-demo-prod-unification-strategic-architecture-v2.md` で「Stripe / Vercel / Atlassian で Multi-Lambda 採用」と述べた箇所を **一次情報源で再検証**するための事実ベース doc。意見表明ではなく URL 裏付けされた記述のみを並べる。
>
> **調査範囲**: 一次情報源 (公式 doc / 公開コード / engineering blog / 公式 case study) のみ。2 次情報 (個人ブログ post / Stack Overflow / Medium による解説 / etc.) は補助参照のみ。
>
> **アクセス確認日**: 2026-05-15
>
> **作成者**: Research Agent (Claude Opus 4.7 1M-ctx)

---

## エグゼクティブサマリー (3 行)

1. **「Stripe / Vercel / Atlassian は Multi-Lambda」という前回 v2 doc の主張は、いずれも一次情報源で裏付かない**。Stripe は「live/test を物理的に分離されたホストセットで処理する」と (3rd 者の) インタビュー記事が報告するが Stripe 公式 (`docs.stripe.com` / `stripe.com/blog`) には掲載がない。Vercel は「branch ごとに isolated VM で build される」とは記述するが「production と preview の Lambda が IAM 単位で分離されている」とは記述しない。Atlassian は **tenant context による logical isolation** であり、別インフラではないと公式に明記している。
2. **逆に「環境分離のために物理 / アカウント単位 isolation を採用」が明確な一次情報源で裏付く事例は AWS Well-Architected SaaS Lens の silo model / AWS Multi-Account 戦略 (SEC01-BP01) / Mattermost Cloud (1 顧客 = 1 Pod) / Shopify pod / Heroku Review Apps の 5 件**。「IAM permission boundary で同 codebase でも別 role で resource access を物理的に阻止可能」は AWS 公式 IAM doc / Lambda 公式 doc で明確に裏付く。
3. **ganbari-quest 固有判断**: Multi-Lambda は **「Pre-PMF 個人開発で security incident response capacity がない」前提では AWS 公式の SEC01-BP01「Separate workloads using accounts」原則と整合する**。ただし AWS 公式は「**account 分離**」を推奨しており「**同 account 内の Lambda 分離**」を等価としては記述しない。同 account 内 Multi-Lambda は **IAM role 1:1 分離 + permission boundary** によって blast radius を限定する中間段階として AWS 公式 source (Lambda execution role doc / Operating Lambda blog) で根拠を持つ。「銀の弾丸」ではなく **trade-off は cold start / deploy 同期 / cost ~$5-15/月**。

**前回主張の検証結果** (重要):

| 前回 v2 doc 主張 | 一次情報源で検証 | 修正 |
|---|---|---|
| 「Stripe は Multi-Lambda」 | **裏付け失敗**。Stripe 公式 doc / Stripe 公式 blog に「Multi-Lambda」「physically separate hosts」の記述なし。3 者インタビュー (`paymentspaymentspayments.com`) で「physically separate host sets」報告ありだがアクセス不能 (ECONNREFUSED)、Stripe 公式裏付け取れず | **「Stripe は live/test を logical に分離 (livemode flag) し、サンドボックス間データ干渉を防ぐと公式記述」** に訂正 |
| 「Vercel は Multi-Lambda」 | **部分的に裏付け**。Vercel 公式は「Preview 用 build VM が isolated」「環境変数 scope が separate」とは記述。Lambda 単位の IAM 分離は記述なし | 「Vercel Preview は build VM と env var scope が分離。Lambda IAM 単位は公式 source なし」 |
| 「Atlassian は Multi-Lambda」 | **裏付け失敗 (反証あり)**。Atlassian Trust Center は **「multi-tenant micro-service architecture」「tenant context による logical isolation」** を明記。別インフラではない。ただし enterprise 向け **Atlassian Isolated Cloud** は単一 VPC 専有の新製品として 2026 開始予定 | 「Atlassian Cloud は logical isolation。Isolated Cloud (新製品) は単一 VPC 単一 tenant」に訂正 |

---

## §1. 実 OSS / web service 事例 (一次情報源 URL 必須)

### 1.1 Stripe Test Mode (反証寄り)

- **一次情報源**: [Stripe Sandboxes 公式 doc](https://docs.stripe.com/sandboxes), [Stripe Dev Blog - Avoiding test mode tangles](https://stripe.dev/blog/avoiding-test-mode-tangles-with-stripe-sandboxes)
- **公式声明 (確認できた範囲)**: 「1 つのサンドボックスで行われた変更が、他のサンドボックスの変更に干渉することはありません」「payments created during sandbox testing are not processed by card networks or payment providers」「livemode: true / livemode: false フラグで内部データモデルが分離」
- **「物理的に分離されたホスト」主張の検証**:
  - 検索結果スニペットでは "Stripe keeping live and test mode API requests on physically separate host sets" との記述がある
  - 一次情報源は [Test Mode at Stripe — paymentspaymentspayments.com interview](https://paymentspaymentspayments.com/interviews/test-mode-at-stripe/) (Stripe 内部の人へのインタビュー)
  - **アクセス試行: ECONNREFUSED**。Stripe 公式 doc / blog 側に同等記述は **見つからず**
- **結論**: Stripe は「live/test の **論理分離** (livemode フラグ、別 API key、別 dashboard、別 webhook)」は公式に確認できる。「**物理分離**」は 1 件のインタビュー記事のみで、Stripe 公式 source では裏付かない
- **demo 環境分離方式**: 同 endpoint、API key で振り分け、内部 livemode フラグで logical separation
- **IAM 等価**: 該当なし (Stripe は SaaS であり AWS IAM の概念は外部に出ない)
- **demo data 管理**: livemode=false の DB レコードとして同居 (公式記述から推測)

### 1.2 Vercel Preview Deployments (部分裏付け)

- **一次情報源**: [Vercel Environments doc](https://vercel.com/docs/deployments/environments)
- **公式声明**: 「Preview environments allow you to deploy and test changes in a live setting, without affecting your production site」「Every environment can define its own unique environment variables」「Pro: 1 custom environment per project / Enterprise: 12」
- **分離単位**:
  - **Build VM isolation**: 各 build は isolated VM で実行 (検索結果スニペット由来、Vercel 公式の Builds doc を要追加検証)
  - **Environment variables**: Production / Preview / Custom scope で完全分離 (公式 doc 明記)
  - **Cache**: deployment ごと isolated (検索結果スニペット由来、要追加検証)
- **「Multi-Lambda」主張の検証**:
  - Vercel docs に「preview 用と production 用の Lambda が別 IAM で deploy される」記述は **見つからず**
  - Vercel は edge function / serverless function の internal architecture を公開していない
- **結論**: Vercel は **環境変数 scope + build VM isolation** のレベルで分離されているが、「IAM 単位の Lambda 分離」を主張する公式 source は **取得できず**
- **demo 環境分離方式**: branch driven preview deploy。Production branch (`main` 等) と非 production branch で env var scope 自動切替
- **IAM 等価**: 公式 source なし
- **demo data 管理**: env var で別 DB 接続文字列を渡す例が docs 中の手順 (database connection information) として登場

### 1.3 Atlassian Cloud Sandbox (反証)

- **一次情報源**: [Atlassian Cloud Architecture and Operational Practices](https://www.atlassian.com/trust/reliability/cloud-architecture-and-operational-practices), [Atlassian Isolated Cloud](https://www.atlassian.com/enterprise/isolated-cloud)
- **公式声明 (反証)**:
  - Trust Center: 「**multi-tenant micro-service architecture where a single service serves multiple customers**, including databases and compute instances」
  - Trust Center: 「'tenant context' to achieve **logical isolation** of our customers. This is implemented both in the application code and managed by the tenant context service (TCS)」
  - Trust Center: 「Each customer's data is **kept logically segregated** from other tenants when at-rest」
- **新サービス Atlassian Isolated Cloud (2026 開始予定)**: 「single-tenant deployment model where all data, storage, networking, and computation are hosted within a dedicated Virtual Private Cloud (VPC)」 — つまり「物理分離」は **enterprise 向け追加製品** として打ち出している
- **Cloud sandbox**: 「customers the ability to create an isolated sandbox environment that can be used for safely testing and previewing changes」 — ただし「isolated」は logical isolation (tenant context) であり、別 infra ではないと推測される (Trust Center が標準は logical isolation と明記)
- **結論**: Atlassian Cloud sandbox は **logical isolation (tenant context based)** が公式記述。「Multi-Lambda」「物理分離」は前回 v2 主張と **整合せず**

### 1.4 Shopify Development Stores + Pod Architecture (裏付け、ただし demo specific ではない)

- **一次情報源**:
  - [Shopify Engineering Blog - A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale)
  - [Shopify Engineering Blog - Shard Balancing](https://shopify.engineering/mysql-database-shard-balancing-terabyte-scale)
  - [Shopify Partner / Dev docs - Development Store](https://help.shopify.com/en/partners/manage-clients-stores/client-transfer-stores)
- **公式声明 (Pod architecture)**: 「**A pod is a fully isolated instance of Shopify with its own datastores like MySQL, Redis, memcached**」「a pod can be spawned in any region」「By pushing isolation to the **infrastructure level**, Shopify contains failure domains and simplifies operational recovery」
- **公式声明 (Development store)**: 「A Shopify development store is a non-public environment where you can design, test, and customize a store before launching it publicly」「functioning like a sandbox where real development takes place without risking store sales or consumer data」
- **分離単位**: **Pod = MySQL + Redis + Memcached + 一部 app server を 1 単位として分離。** 複数 shop が 1 pod に同居するが、pod 間は failure domain として分離される
- **「demo は別 pod か?」検証**: Shopify 公式 doc には **development store が production と同じインフラ層を共有するか、別 pod に配置されるかの明示記述なし**
- **結論**: Shopify の **infrastructure-level isolation (pod)** は確かに存在するが、「demo / development store 専用に別 pod を用意している」と読める公式 source は **見つからず**

### 1.5 GitLab Demo Systems

- **一次情報源**: [GitLab Handbook - Demo Systems](https://handbook.gitlab.com/handbook/customer-success/demo-systems/), [GitLab Handbook - Infrastructure Environments](https://handbook.gitlab.com/handbook/engineering/infrastructure/environments/), [GitLab.com Production Architecture](https://handbook.gitlab.com/handbook/engineering/infrastructure/production/architecture/)
- **公式声明 (確認できた範囲、handbook ナビ目次)**:
  - 「Demo Systems Infrastructure - Kubernetes」「Demo Systems Infrastructure - Networking」の独立セクションが存在 → demo 専用の Kubernetes/Networking infrastructure が存在することを示唆
  - 「Training Cloud Omnibus-as-a-Service」が Demo Systems 配下に存在
  - GitLab 全体は「**Infrastructure Realms (Engineering, SaaS, Shared Services, IT, Sandbox, Security)**」で realm 分離
- **demo.gitlab.com 環境分離方式**: handbook ナビ構造から「demo systems は customer-success 部門の独立 infra」と読み取れるが、**具体的に GCP project 単位 / Kubernetes cluster 単位 / namespace 単位かは WebFetch ナビのみで本文取得できず未確認**
- **結論**: GitLab demo は **demo 専用の独立 Kubernetes + Networking infra** が customer-success 部門の管理下にあると handbook の構造から読み取れる。詳細な isolation 方式は handbook の sub-page を直接参照する必要あり

### 1.6 Sentry Sandbox

- **一次情報源**: [Sentry Demo Sandbox](https://sentry.io/demo/sandbox/), [sentry-demos GitHub Organization](https://github.com/sentry-demos), [posthog-style hogflix-like Empower Plant demo repo](https://github.com/sentry-demos)
- **公式声明**:
  - 「Sentry Sandbox is a live demo of Sentry」「a digital showroom」(marketing copy、技術構成記述なし)
  - GitHub `sentry-demos` org に **Empower Plant など複数の demo data 生成アプリ** が公開されている (`sentry-demos/sentry-micro-frontend` 等)
- **分離単位**: 公開記述は marketing copy のみで「sandbox.sentry.io が本番 sentry.io と別 infra に deploy されているか」を断定する一次情報源は **見つからず**
- **結論**: Sentry sandbox は **demo データ生成 OSS が公開されている**が、sandbox.sentry.io 自体のインフラ分離方式は **公式 source 未確認**

### 1.7 Discourse Try (try.discourse.org)

- **一次情報源**: [try.discourse.org demo instance](https://try.discourse.org), [Discourse Meta](https://meta.discourse.org)
- **公式声明**: try.discourse.org は Discourse の demo インスタンス。Discourse の標準デプロイは「a single web-server that needs to connect to a PostgreSQL and Redis server」(Discourse meta forum 由来) で、**try.discourse.org が本番と別 infra か明示する公式 source は見つからず**
- **結論**: Discourse Try は **架構詳細未公開**

### 1.8 PostHog Demo (HogFlix / posthog-demo-3000)

- **一次情報源**:
  - [PostHog/posthog-demo-3000 GitHub repo + README](https://github.com/PostHog/posthog-demo-3000/blob/main/README.md)
  - [PostHog Demo (posthog.com/demo)](https://posthog.com/demo)
  - [PostHog Issue #2128: Great demo environment EPIC](https://github.com/PostHog/posthog/issues/2128)
- **公式声明 (README)**:
  - 「`docker build --no-cache --tag posthog-hogflix-demo .`」「container runs in detached mode on port 5000」
  - 「`seed_demo_data.py` script creates pseudo-random data that mimics real usage」
  - 「`create_posthog_artifacts.py` adds in: Actions, Cohorts, Insights, Feature Flag」
- **分離単位**: **Docker container として packageされ、PostHog 本体 (本番) とは別の app server (port 5000) で稼働。デモデータは seed script で playback**
- **demo data 管理**: seed_demo_data.py が pseudo-random data を生成
- **結論**: PostHog HogFlix は **完全に別 Docker container deploy で、demo data は seed script からの生成。本番 PostHog (cloud / self-hosted) とは別インフラ**。これは ganbari-quest が検討する「demo 用に同 codebase を別 Lambda に deploy」パターンの近い実装

### 1.9 Mattermost Cloud (強い裏付け)

- **一次情報源**: [Mattermost Engineering Blog - Building a SaaS Architecture with a Single Tenant Application](https://mattermost.com/blog/building-a-saas-architecture-with-a-single-tenant-application/), [Mattermost Cloud GitHub](https://github.com/mattermost/mattermost-cloud), [CNCF blog (Mattermost 寄稿)](https://www.cncf.io/blog/2022/04/26/building-a-saas-architecture-with-a-single-tenant-application/)
- **公式声明**:
  - 「**each customer who has their own workspace gets their own deployment of single-tenant Mattermost and a set of pods that is only for them**」
  - Enterprise: 「each Mattermost Cloud Enterprise instance is deployed in a **private environment within an AWS VPC dedicated to a single customer**, and within that VPC, all the required resources to run, monitor, and administer Mattermost are deployed in isolation, including a **dedicated RDS Aurora database cluster and a dedicated Kubernetes cluster**」
- **分離単位**: **Kubernetes namespace + dedicated DB + (Enterprise tier では) dedicated VPC**
- **demo data 管理**: 公式 blog では trial / demo 用の特別 architecture は記述なし (production architecture のみ)
- **結論**: Mattermost は **顧客 = 完全別インフラ (silo model 純粋型) を AWS 上で実装**。Multi-Lambda 寄りの最強裏付け事例

### 1.10 Rocket.Chat Cloud Trial

- **一次情報源**: [Rocket.Chat Trial on AWS](https://www.rocket.chat/trial-saas), [Rocket.Chat Architecture](https://developer.rocket.chat/docs/architecture-and-components), [Rocket.Chat Deploy](https://docs.rocket.chat/docs/deploy-rocketchat)
- **公式声明**:
  - 「30-day trial on AWS that serves as a fast, secure, and fully flexible entry point」「provisioning of a **dedicated Rocket.Chat environment on AWS infrastructure**」
  - 「Rocket.Chat follows a client-server architecture where the server is written in JavaScript using Node.js and uses MongoDB for data storage」
  - 「A Rocket.Chat workspace can be deployed as a monolith with multiple nodes or as a **microservices architecture**」
- **分離単位**: 「dedicated Rocket.Chat environment on AWS」が AWS Marketplace 経由で顧客ごとに provisioning される → **顧客 = 別 AWS環境 (Marketplace 標準パターン)**
- **結論**: Rocket.Chat trial は **AWS Marketplace 経由で trial ごとに独立 environment provisioning**。Multi-Lambda というより multi-stack pattern

### 1.11 Supabase Anonymous Auth (反証: 案 D pattern の代表例)

- **一次情報源**:
  - [Supabase Auth - Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)
  - [Supabase - Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- **公式声明**:
  - 「An anonymous user assumes the **authenticated role** just like a permanent user, and you can use row-level security (RLS) policies to differentiate between an anonymous user and a permanent user by checking the **is_anonymous claim in the JWT** returned by auth.jwt()」
  - 「**RLS policies are permissive by default, which means that they are combined using an 'OR' operator** when multiple policies are applied. It is important to construct **restrictive policies** to ensure that the checks for an anonymous user are always enforced when combined with other policies」
- **分離単位**: **同 DB / 同 backend / RLS による行レベル isolation** (案 D: single Lambda + tenant filter の代表例)
- **重要な警告**: Supabase 公式が「permissive default + restrictive policy で意図的に厳格化しないと RLS 漏れリスク」と明記 → **これは案 D の「tenant filter bug 1 つで漏洩リスク」の懸念を Supabase 自身が公式に警告している事実**
- **結論**: 案 D (single Lambda + filter / RLS) は Supabase / Firebase で広く採用されているが、**Supabase 公式自身が「policy 構成ミスで漏洩しうる」と明記**。これは PO 制約「個人開発で security incident 対応不能」の前提では追加のリスク要素

### 1.12 Heroku Review Apps (強い裏付け、Multi-Lambda 等価)

- **一次情報源**: [Heroku Dev Center - Review Apps](https://devcenter.heroku.com/articles/github-integration-review-apps), [Heroku Dev Center - Dyno Isolation](https://devcenter.heroku.com/articles/dyno-isolation)
- **公式声明**:
  - 「**Review apps run the code in any GitHub pull request in a complete, disposable Heroku app**. Review Apps each have a unique URL」
  - 「**All review app config vars from the pipeline settings will be injected into the review app when it is created**」
  - 「Dynos and add-ons used by review apps are charged in exactly the same way as for normal apps」(= **別課金 = 別インスタンス**)
  - 「**Review apps exist only for the life of their associated pull request**」
  - Dyno isolation: 「All dynos are **strongly isolated** from one another for security purposes」「Heroku uses OS containerization with **additional custom hardening**」「**no files that are written are visible to processes in any other dyno**」
- **分離単位**: **PR ごとに完全別 app instance + 別 dyno + 別 config var**。本番 dyno と review app dyno は OS containerization で完全分離
- **結論**: Heroku Review Apps は **Multi-Lambda demo deployment pattern の "Heroku 等価"**。「同 codebase / 別 deploy / 別 env var / 別 instance」がまさに ganbari-quest が検討するパターン。AWS Lambda の場合の同等構造は「同 codebase / 別 Lambda function / 別 env var / 別 IAM role」

### §1 まとめ

| 事例 | 一次情報源 | 分離単位 | Multi-Lambda 等価度 | PO 主張裏付け |
|---|---|---|---|---|
| Stripe Test Mode | docs.stripe.com (logical のみ) | livemode flag 論理分離 | △ (物理分離は裏付け失敗) | **裏付け失敗** |
| Vercel Preview | vercel.com/docs | Build VM + env var scope | △ (Lambda IAM 単位は不明) | 部分裏付け |
| Atlassian Cloud | atlassian.com/trust | logical (tenant context) | ✗ (反証) | **裏付け失敗** |
| Shopify Pod | shopify.engineering | Pod (DB + Redis 単位) | ○ (infra-level) | 部分裏付け (demo specific は不明) |
| GitLab Demo | handbook.gitlab.com | 独立 K8s infra (推測) | ○ | 部分裏付け |
| Sentry Sandbox | github.com/sentry-demos | 不明 | ? | 不明 |
| Discourse Try | (公式記述少) | 不明 | ? | 不明 |
| **PostHog HogFlix** | github.com/PostHog/posthog-demo-3000 | **Docker container 完全分離** | **◎** | **強い裏付け** |
| **Mattermost Cloud** | mattermost.com/blog | **Pod + dedicated DB (+ VPC)** | **◎** | **強い裏付け** |
| Rocket.Chat Trial | rocket.chat/trial-saas | AWS Marketplace 経由独立環境 | ○ | 裏付け |
| Supabase Anonymous | supabase.com/docs | RLS 行レベル (案 D) | ✗ (反証 = 案 D の代表) | (案 D 側の裏付け) |
| **Heroku Review Apps** | devcenter.heroku.com | **PR ごと別 app + 別 dyno** | **◎** | **強い裏付け** |

**Multi-Lambda 等価の「強い裏付け」事例**: PostHog HogFlix / Mattermost Cloud / Heroku Review Apps の 3 件。

**前回 v2 で挙げた Stripe / Vercel / Atlassian は、いずれも一次情報源で「Multi-Lambda」を裏付けず**。修正必須。

---

## §2. AWS CDK / Multi-Lambda 実装 reference (公式 source)

### 2.1 AWS Well-Architected SaaS Lens — Silo / Pool / Bridge Models

- **一次情報源**: [Silo, Pool, and Bridge Models - SaaS Lens](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html), [Silo isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-isolation.html), [Pool isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/pool-isolation.html), [PDF: SaaS Lens Whitepaper](https://docs.aws.amazon.com/pdfs/wellarchitected/latest/saas-lens/wellarchitected-saas-lens.pdf)
- **AWS 公式定義 (引用)**:
  - 「The **silo model** refers to an architecture where tenants are provided dedicated resources. Imagine, for example, a SaaS environment where each tenant of your system has a fully independent infrastructure stack」
  - 「In contrast, the **pool model** of SaaS refers to a scenario where tenants share resources. This is the more classic notion of multi-tenancy」
  - 「**Bridge** is meant to acknowledge the reality that SaaS businesses aren't always exclusively silo or pool. Instead, many systems have a mixed mode」
- **ganbari-quest への mapping**:
  - 「demo は **silo (別 Lambda function + 別 IAM role)** / production は **pool (現状の単一 Lambda)**」は **bridge model の公式定義に該当**
  - AWS は silo / pool / bridge の 3 モデルを **全て** 公式パターンとして掲載。「Multi-Lambda demo」は AWS 公式に bridge model の一形態として正当化される

### 2.2 AWS Well-Architected Security Pillar SEC01-BP01

- **一次情報源**: [SEC01-BP01 Separate workloads using accounts](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_securely_operate_multi_accounts.html)
- **AWS 公式 (引用)**:
  - **タイトル: 「Separate workloads using accounts」**
  - 「**Account-level separation is strongly recommended**, as it provides a strong isolation boundary for security, billing, and access」
  - 「**Desired outcome**: An account structure that **isolates cloud operations, unrelated workloads, and environments** into separate accounts, increasing security across the cloud infrastructure」
  - 「**Common anti-pattern**: Placing multiple unrelated workloads with different data sensitivity levels into the same account」
  - 「**Level of risk exposed if this best practice is not established: High**」
  - 「**Decreased scope of impact if a workload is inadvertently accessed**」
  - 「AWS accounts provide a **security isolation boundary** between workloads or resources that operate at different sensitivity levels」
- **ganbari-quest への mapping**:
  - SEC01-BP01 を **完全に従う場合**: ganbari-quest production と demo を **別 AWS account** に置く (現状 Pre-PMF 個人開発では over-engineering の可能性)
  - **同 account 内で IAM role 分離する場合**: SEC01-BP01 の「account-level」より弱いが、「**resource isolation boundary**」としては AWS Lambda execution role の 1:1 原則 (§2.3) で部分的に補完可能
  - AWS は **多層防御 (defense in depth)** を推奨。同 account 内 IAM 分離は account 分離の弱版だが、completely shared (現状) よりは強い

### 2.3 AWS Lambda Execution Role 公式 doc + Operating Lambda Blog

- **一次情報源**:
  - [Defining Lambda function permissions with an execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
  - [Operating Lambda: Building a solid security foundation – Part 1](https://aws.amazon.com/blogs/compute/operating-lambda-building-a-solid-security-foundation-part-1/)
  - [Managing permissions in AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-permissions.html)
- **AWS 公式 (引用)**:
  - Lambda execution role doc: 「Before publishing your function in the production environment, as a **best practice, adjust the policy to include only the required permissions**」
  - Operating Lambda blog: 「**Every Lambda function should have a 1:1 relationship with an IAM role**」「Avoid sharing IAM roles with multiple Lambda functions」
  - Operating Lambda blog: 「**Execution environments are never shared across functions and MicroVMs are never shared across AWS accounts**」
  - Operating Lambda blog: 「Use a **separate AWS account for each developer in a team, and separate accounts for beta and production**」
  - Operating Lambda blog: 「build **smaller, specialized functions with single tasks** rather than all-purpose functions」
- **ganbari-quest への mapping**:
  - 「同 account 内で demo Lambda と production Lambda を **別 IAM role** で deploy する」は **AWS 公式 1:1 原則 (Lambda function = IAM role 1:1) に整合**
  - AWS 公式: 「**MicroVMs are never shared across AWS accounts**」 → 別 account ならハードウェアレベル分離が保証。同 account 内なら Firecracker レベルで execution environment 分離 (function 単位)
  - **したがって**: 「demo Lambda の IAM role に DynamoDB Table / Secrets / Cognito UserPool の resource ARN を含めない」+「production Lambda には含める」だけで AWS 公式の least privilege 原則 + 1:1 原則を満たす

### 2.4 AWS IAM Permission Boundaries 公式 doc

- **一次情報源**: [Permissions boundaries for IAM entities](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html), [aws-samples/example-permissions-boundary GitHub](https://github.com/aws-samples/example-permissions-boundary)
- **AWS 公式 (引用)**:
  - 「A **permissions boundary** is an advanced feature for using a managed policy to **set the maximum permissions that an identity-based policy can grant to an IAM entity**」
  - 「An entity's permissions boundary allows it to perform **only the actions that are allowed by both its identity-based policies and its permissions boundaries**」
  - 「The **effective permissions are the intersection of both policy types**. An **explicit deny** in either of these policies overrides the allow」
- **ganbari-quest への mapping**:
  - demo Lambda の IAM role に **permission boundary** を attach (例: `ganbari-quest-demo-boundary`) し、`dynamodb:*` を **`arn:aws:dynamodb:us-east-1:*:table/ganbari-quest-demo-*`** に限定する
  - **production DynamoDB Table の ARN を boundary が含まないため、たとえ role policy で `Resource: "*"` と書かれても **explicit な maximum で阻止**される**
  - = **構造的に「demo Lambda は production DynamoDB に到達不能」が IAM evaluation logic で保証**
  - これは PO 制約「不正アクセス物理的に発生不可能」の **IAM レベルでの裏付け** (AWS 公式 IAM evaluation logic に基づく)

### 2.5 AWS Multi-Account Sandbox OU Whitepaper

- **一次情報源**: [Sandbox OU (Experimental)](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/sandbox-ou.html), [Best practices for creating and managing sandbox accounts in AWS - AWS Cloud Operations Blog](https://aws.amazon.com/blogs/mt/best-practices-creating-managing-sandbox-accounts-aws/)
- **AWS 公式 (引用)**:
  - Cloud Operations blog: 「**networks in the sandbox environment are NOT allowed to connect to networks in other or shared services environments. Typically, these environments are isolated**」
  - Cloud Operations blog: 「a **cross account Identity and Access Management (IAM) role must be implemented** in each sandbox account to give security and compliance teams the access required to monitor」
  - Sandbox OU whitepaper (search snippets 由来): 「The **Sandbox OU contains accounts in which your builders are generally free to explore and experiment**」「these environments are typically **disconnected from your internal networks and internal services**」
- **ganbari-quest への mapping**:
  - **完全な AWS 公式準拠**: ganbari-quest production を 1 account、demo を別 account に分け、AWS Organizations で管理
  - **Pre-PMF 個人開発の現実**: 別 account は **AWS Control Tower + Organizations 運用工数 (1-2 日初期 + 月数時間メンテ)** が必要。個人開発では over-engineering の可能性
  - **同 account 内 Multi-Lambda は中間段階**: SEC01-BP01「strongly recommended」の **account-level isolation には未到達** だが、現状 (single Lambda) より構造的安全性は向上

### 2.6 AWS SaaS Factory Serverless SaaS Reference

- **一次情報源**: [aws-saas-factory-ref-solution-serverless-saas GitHub](https://github.com/aws-samples/aws-saas-factory-ref-solution-serverless-saas/blob/main/DOCUMENTATION.md), [Building a Multi-Tenant SaaS Solution Using AWS Serverless Services - APN Blog](https://aws.amazon.com/blogs/apn/building-a-multi-tenant-saas-solution-using-aws-serverless-services/)
- **AWS 公式 (引用)**:
  - 「Basic, Standard, and Premium tier tenants might be deployed using a **pooled model where AWS resources are shared by tenants**」
  - 「**Platinum tier tenants [are] deployed with a Silo model**. This means, each Platinum tier tenant enjoys their own set of AWS resources, that are not shared with any other tenant」
  - APN blog (引用): 「For our baseline environment, we have deployed the application services that will be consumed by tenants in a tier that use the pooled model. **Later, as you onboard Platinum tier tenants, you'll see we deploy separate application services for each tenant in this tier**」
- **ganbari-quest への mapping**:
  - 「Platinum tier = silo = 別 Lambda function per tenant」は AWS 公式 SaaS Factory reference に明記
  - ganbari-quest の「demo = silo (別 Lambda)、production = pool (現状単一 Lambda)」は **この SaaS Factory pattern の inverted variant** (demo を silo に、production を pool に)
  - AWS 公式は silo Lambda function に対し **deploy 自動化 (CodePipeline / CDK)** を組み合わせる例を公開

### 2.7 AWS Lambda Function URL + CloudFront Multi-Origin

- **一次情報源**:
  - [Secure your Lambda function URLs using Amazon CloudFront origin access control](https://aws.amazon.com/blogs/networking-and-content-delivery/secure-your-lambda-function-urls-using-amazon-cloudfront-origin-access-control/)
  - [Using Amazon CloudFront with AWS Lambda as origin to accelerate your web applications](https://aws.amazon.com/blogs/networking-and-content-delivery/using-amazon-cloudfront-with-aws-lambda-as-origin-to-accelerate-your-web-applications/)
  - [Use various origins with CloudFront distributions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)
- **AWS 公式 (引用)**:
  - 「Pairing Lambda functions with CloudFront allows you to **avoid exposing your Lambda function URL publicly**」
  - CloudFront 公式 doc: **multiple origins** を 1 distribution に attach し、cache behavior (path pattern) で振り分け可能
- **ganbari-quest への mapping**:
  - 単一 CloudFront distribution + 2 origins (production Lambda URL / demo Lambda URL)、host header / path 振り分けで `app.ganbari-quest.com` と `demo.ganbari-quest.com` を切替
  - **「CloudFront 1 distribution で別 Lambda function URL に振り分ける」は AWS 公式 source で記述あり**(single origin の OAC blog のみ詳細あり、multi-origin は CloudFront 公式 doc が抽象的に記述)
  - **note**: AWS 公式 blog は **single Lambda + CloudFront** の例のみ詳細記述。**multi-Lambda + CloudFront multi-origin** の完全な reference example は AWS 公式 blog で見つけられず、CloudFront origin doc で抽象的記述のみ

### §2 まとめ

| AWS 公式 reference | 一次情報源 | Multi-Lambda demo への根拠強度 |
|---|---|---|
| Well-Architected SaaS Lens (silo/pool/bridge) | docs.aws.amazon.com/wellarchitected/saas-lens | **◎ (bridge pattern として明示)** |
| Security Pillar SEC01-BP01 (account separation) | docs.aws.amazon.com/wellarchitected/security-pillar | ◎ (但し account 分離が "strongly recommended"。同 account 内 Lambda 分離は中間段階) |
| Lambda execution role doc + Operating Lambda blog | docs.aws.amazon.com/lambda + aws.amazon.com/blogs/compute | **◎ (1:1 IAM role 原則 + least privilege)** |
| IAM Permission Boundaries | docs.aws.amazon.com/IAM | **◎ (intersection-based maximum permission により構造保証)** |
| Sandbox OU Whitepaper + Cloud Ops Blog | docs.aws.amazon.com/whitepapers + aws.amazon.com/blogs/mt | ○ (account 分離前提だが、ganbari Pre-PMF 段階では over-engineering 可能性) |
| SaaS Factory Serverless | github.com/aws-samples + APN blog | **◎ (silo Lambda per tier の公式 reference)** |
| Function URL + CloudFront multi-origin | aws.amazon.com/blogs/networking + CloudFront doc | △ (single origin は詳細あり、multi-origin は CloudFront doc が抽象的) |

---

## §3. Security claim 検証 (IAM permission boundary、AWS 公式 source)

PO 主張 (前回 v2): **「IAM permission boundary で demo Lambda が production resource にアクセス不可能」**

### 3.1 AWS 公式裏付け

(§2.4 で引用済)

- **「**An entity's permissions boundary allows it to perform only the actions that are allowed by both its identity-based policies and its permissions boundaries**」** ([IAM Permission Boundaries doc](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html))
- 「**The effective permissions are the intersection of both policy types**. An **explicit deny** in either of these policies overrides the allow」(同上)
- IAM Policy Evaluation Logic: **explicit allow + 全 policy chain での非 explicit deny** が同時に成立しない限り、API call は denied

### 3.2 ganbari-quest における具体的保証

**現状** (single Lambda):
```
Lambda IAM Role: dynamodb:*Item on arn:aws:dynamodb:us-east-1:*:table/ganbari-quest-app-table
                + secretsmanager:GetSecretValue on arn:aws:secretsmanager:*:secret:ganbari-quest/*
                + cognito-idp:* on arn:aws:cognito-idp:*:userpool/<production-pool-id>
```

**Multi-Lambda 後** (proposed):
```
production Lambda IAM Role: 上記と同じ
demo Lambda IAM Role:
  + (DynamoDB / Secrets / Cognito へのアクセス権限なし)
  + S3 read-only on arn:aws:s3:::ganbari-quest-assets-bucket/*  (画像のみ)
  + CloudWatch Logs putLogEvents on arn:aws:logs:*:*:log-group:/aws/lambda/ganbari-quest-demo

demo Lambda IAM Role Permission Boundary:
  Allow: s3:GetObject on arn:aws:s3:::ganbari-quest-assets-bucket/*
  Allow: logs:* on arn:aws:logs:*:*:log-group:/aws/lambda/ganbari-quest-demo
  (DynamoDB / Secrets / Cognito の Allow なし)
```

**保証される構造**:
- 仮に demo Lambda の code に bug があり `dynamodb:GetItem` を called しても、role policy にも boundary にも production table ARN が含まれない
- AWS IAM evaluation logic 上、explicit allow が成立しないため **API call は denied** (`AccessDeniedException`)
- = **「demo Lambda が production resource に到達不能」が AWS IAM レベルで構造保証される** (AWS 公式 evaluation logic doc に依拠)

### 3.3 AWS 公式 source なし / 弱い裏付けの留意点

- 「**MicroVM レベルで別 customer の execution environment と完全分離**」は別 AWS account に置いた場合のみ AWS 公式が保証 ([Operating Lambda blog](https://aws.amazon.com/blogs/compute/operating-lambda-building-a-solid-security-foundation-part-1/))。同 account 内では Firecracker 分離は function 単位だが「**account 境界**」の保証はない
- 「**Cognito UserPool 別 pool で別 user data**」は [Cognito 公式 doc](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html) が UserPool を「**isolated identity store**」と呼ぶ。デモは separate UserPool (or anonymous mode で user pool 不使用) を採用すれば user data 物理分離が保証される
- 「**Secrets Manager 別 secret に別 IAM**」は [Secrets Manager 公式 doc](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access.html) が IAM policy + resource policy の組合せで access control する標準パターン。demo Lambda に production secret ARN を含めない role policy で十分

### 3.4 結論

- PO 主張「IAM permission boundary で demo Lambda が production resource にアクセス不可能」は **AWS 公式 IAM evaluation logic + Lambda execution role 1:1 原則で裏付け可能**
- ただし「**完全な物理分離**」を主張するなら別 AWS account が AWS 公式の "strongly recommended" レベル
- **同 account 内 Multi-Lambda は intermediate step**: 現状 (single Lambda) より構造保証が強く、別 account より工数が少ない trade-off

---

## §4. ganbari-quest 固有適合性 (既存 6 stack との mapping)

### 4.1 現状 infra (確認済)

`infra/lib/` 配下 6 stack:

| Stack | ファイル | 内容 |
|---|---|---|
| Network | `network-stack.ts` | VPC / Route53 (推定) |
| Storage | `storage-stack.ts` | DynamoDB Table + S3 assets bucket |
| Auth | `auth-stack.ts` | Cognito UserPool |
| Compute | `compute-stack.ts` | DockerImageFunction `SvelteKitFn` + FunctionUrl + cron dispatcher |
| Ops | `ops-stack.ts` | CloudWatch / Firehose log archive (推定) |
| SES | `ses-stack.ts` | メール送信 |

**compute-stack.ts 確認結果** (現状の grant):
```
props.table.grantReadWriteData(this.fn);              // DynamoDB Table 全 R/W
props.assetsBucket.grantReadWrite(this.fn);           // S3 assets R/W
new iam.PolicyStatement({...})                         // Secrets Manager 等の inline policy
this.functionUrl = this.fn.addFunctionUrl({...})       // Function URL (auth: NONE)
```

これは **AWS 公式の least privilege ではない (Table 全権 / Bucket 全権)** が、Pre-PMF 段階では許容範囲

### 4.2 Multi-Lambda CDK 改修案 (CDK Construct 再利用 + override)

**Phase A: 同 stack 内に demo Lambda 追加** (最小工数):

`compute-stack.ts` で `SvelteKitFn` (production) と並列に `SvelteKitDemoFn` を追加:

```typescript
// (擬似コード、実装は別 PR)
this.demoFn = new lambda.DockerImageFunction(this, 'SvelteKitDemoFn', {
  code: lambda.DockerImageCode.fromEcr(props.repository, { tag: 'latest' }),
  environment: {
    DATA_SOURCE: 'demo',
    AUTH_MODE: 'anonymous',
    // CRITICAL: no DynamoDB Table ARN env var passed
    // CRITICAL: no Secrets Manager Secret ARN env var passed
    // CRITICAL: no Cognito UserPool ID env var passed
  },
  // ...
});

// production Lambda: 既存の grant 維持
props.table.grantReadWriteData(this.fn);
props.assetsBucket.grantReadWrite(this.fn);

// demo Lambda: S3 (画像のみ read-only) + CloudWatch Logs のみ
props.assetsBucket.grantRead(this.demoFn);
// (Table grant なし、Secrets grant なし、Cognito grant なし)

// demo Lambda に permission boundary attach
const demoBoundary = new iam.ManagedPolicy(this, 'DemoLambdaBoundary', {
  statements: [
    new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${props.assetsBucket.bucketArn}/*`],
    }),
    new iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: ['arn:aws:logs:*:*:log-group:/aws/lambda/ganbari-quest-demo*'],
    }),
  ],
});
iam.PermissionsBoundary.of(this.demoFn.role!).apply(demoBoundary);

this.demoFunctionUrl = this.demoFn.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
});
```

**Phase B: CloudFront multi-origin で domain 振り分け**:

`network-stack.ts` の CloudFront distribution に origin を 2 つ:
- `app.ganbari-quest.com` → production Function URL origin
- `demo.ganbari-quest.com` → demo Function URL origin

(または path-based: `/demo/*` → demo origin、`/*` → production origin)

Route 53 hosted zone に CNAME / Alias 追加。

### 4.3 既存 PR #2118 (`/demo/**` 削除) との関係

- 現状 ganbari-quest は `src/routes/demo/**` を持ち、demo data は `$lib/server/demo/demo-data.ts` 経由で同一 Lambda 内で返している (案 D の pure form)
- PR #2118 が `/demo/**` を削除済 = **demo route が一旦消える**。Multi-Lambda 移行ではこの route を **demo Lambda の root に復活** (path prefix なし、`demo.ganbari-quest.com` の `/` 等)
- → **PR #2118 はキープでよい** (production Lambda から demo data 経路を除去)。demo Lambda 側で `DATA_SOURCE=demo` 環境変数で同じ codebase を「demo モード」で起動する

### 4.4 Schema migration の同期

- `tests/e2e/global-setup.ts` / `tests/unit/helpers/test-db.ts` / `src/lib/server/demo/demo-data.ts` の SSOT 体系で in-memory fixture が定義済
- demo Lambda は DynamoDB に接続しないため、**schema migration の同期は不要**
- production schema が破壊的変更時、demo data fixture を同 PR で更新する SSOT 運用 (現状の practice を継続)

### 4.5 Cost 試算

- AWS Lambda 課金は **invocation 数 + duration ベース**。demo は LP からの遷移なので訪問数は production の 1/10 ~ 1/100 想定
- 月間 Lambda コスト試算: ~$5-15 程度 (個人開発 LP 流量想定)
- CloudFront / Route 53 は同 distribution / hosted zone に origin / CNAME 追加のみ → 課金増ほぼなし
- **合計: 月 ~$5-15 増 (Pre-PMF 許容範囲、ADR-0010 Pre-PMF 判断)**

### 4.6 Deploy 同期

- CDK 1 stack 内に production + demo Lambda 両方を定義 → `cdk deploy` で同時 deploy、schema drift なし
- Docker image は同一 (production Lambda と demo Lambda が同 ECR repo の同 tag を参照)
- 環境変数で挙動分岐 (`DATA_SOURCE=dynamodb` / `DATA_SOURCE=demo`)

---

## §5. 代替案 (案 D) との re-評価

### 5.1 案 D = single Lambda + tenant filter (Supabase 等価)

- §1.11 で確認: Supabase anonymous auth + RLS は案 D の代表例
- **Supabase 公式自身**が「RLS policies are permissive by default」「**It is important to construct restrictive policies to ensure that the checks for an anonymous user are always enforced**」と警告 ([Supabase Anonymous Sign-Ins doc](https://supabase.com/docs/guides/auth/auth-anonymous))
- = 「filter / policy 構成ミスで漏洩しうる」リスクを **Supabase が公式に明記**

### 5.2 ganbari-quest における re-評価

**PO 制約**: 「個人開発で security incident に対応しきれない」

| 観点 | 案 D (single Lambda + filter) | Multi-Lambda + IAM 分離 |
|---|---|---|
| 漏洩リスク | tenant filter bug 1 つで production data 露出 | IAM evaluation logic で API call が denied → bug があっても resource 到達不能 |
| Pre-PMF 過剰防衛性 (ADR-0010) | minimal (現状継続) | $5-15/月 + CDK 改修 1 PR |
| AWS 公式整合 | Supabase pattern (anonymous + RLS) と等価、但し Supabase は RLS 設計に経験必須と公式警告 | AWS Well-Architected SaaS Lens (bridge model) + SEC01-BP01 (intermediate step) で公式裏付け |
| Incident response 工数 | filter bug 発見時に緊急 patch + 影響範囲調査 + 顧客通知 (個人開発で 1 incident = 数日-1 週) | bug があっても resource access denied で blast radius が demo Lambda 内に閉じる → 緊急性下がる |
| Cold start | 現状 production Lambda のみ。LP → demo 遷移なし | demo Lambda 新規 cold start 200-500ms 想定 (Docker image、provisioned concurrency なし) |
| E2E test | 現状の practice (single Lambda + DATA_SOURCE=demo with env override) で継続可能 | dev は single、production は multi。`tests/e2e/global-setup.ts` で env 切替必要 |

### 5.3 真の trade-off

**Pre-PMF 個人開発 + security incident 対応不能** 制約下では:

- **Multi-Lambda のコスト = ~$15/月 + 1 PR (1-2 日工数)**
- **案 D の隠れコスト = filter bug 発生時 1 incident あたり数日工数 + 信頼毀損 (個人開発では致命的)**

= **Multi-Lambda が "個人開発 security mitigation insurance" として合理化される領域**

ただし「**Pre-PMF で incident は確率的にゼロに近い**」と判断するなら案 D 継続が ADR-0010 (Pre-PMF scope 判断) と整合。**判断は PO に委ねる**

### 5.4 v2 doc / CDK Agent の判断との関係

- v2 主 Agent の「案 D 推奨」: **incident response capacity 制約を組み込まずに技術コストのみで判断した結果**
- CDK Agent の「Multi-Lambda は Pre-PMF 過剰防衛」: **同上**
- 本 v3 doc の追加観点: 「個人開発 incident 対応工数 vs 月 $15 + 1 PR」**は v2 / CDK Agent が評価していない**

= **v2 / CDK Agent の結論は技術的に正しい (案 D は最小工数) が、PO 制約を組み込むと結論が変わりうる**

---

## §6. PO への質問項目 (実装着手前の最終確認)

調査中に「これは PO 判断必要」と感じた疑問点:

### 6.1 ビジネス判断系

1. **incident response capacity の自己評価**: 1 件の data 漏洩 incident が発生した場合、PO は何時間 / 何日で対応可能か? (緊急 patch + 影響範囲調査 + 顧客通知 + ADR 起票 + ポストモーテム)
2. **filter bug の発生確率の主観評価**: 案 D で「tenant filter を毎リクエスト適用」を E2E test がカバーしているが、code path 全てを保証はしない。bug 発生確率を PO がどう見積もるか
3. **Pre-PMF 段階での "security insurance" の対価**: 月 $5-15 + 1 PR を支払う価値があるか

### 6.2 技術 / DNS / 運用系

4. **demo Lambda の URL**: `demo.ganbari-quest.com` (subdomain) か `app.ganbari-quest.com/demo/` (path prefix) か (subdomain の方が CloudFront origin 振り分けが simple、AWS 公式 multi-origin pattern と整合)
5. **demo Lambda の cold start 許容範囲**: LP → demo 遷移で 200-500ms 待つことが UX として許容できるか (provisioned concurrency にすると月数 $ 追加)
6. **demo Lambda の deploy 失敗時の rollback**: production Lambda と同 stack で deploy するか、別 stack に分離して rollback を独立可能にするか
7. **E2E test 戦略**: dev は single Lambda (`DATA_SOURCE=demo` env で挙動分岐)、production は multi Lambda という非対称が test coverage gap を生むか
8. **LP に貼る demo SS の撮影 infra**: `scripts/capture-hp-screenshots.mjs` は現状 `/demo/<mode>/<path>` から撮影。Multi-Lambda 後は `demo.ganbari-quest.com/<mode>/<path>` に変更する必要

### 6.3 既存 PR / Issue 系

9. **PR #2118 (`/demo/**` 削除) の処遇**: keep でよいか (production Lambda から demo data 経路を除去するため Multi-Lambda 移行と整合)
10. **Issue #2097 を Multi-Lambda 採用に倒す前に、案 D (現状 + filter 強化) の途中段階を取らないか**: Multi-Lambda 直接移行が最小 PR 数だが、ステップ分割で「現状 → filter 厳格化 → Multi-Lambda」と段階移行する選択肢

---

## 参考リンク一覧 (アクセス確認日 2026-05-15)

### AWS 公式 doc (最重要)

1. [AWS Well-Architected SaaS Lens - Silo, Pool, and Bridge Models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html) — silo / pool / bridge 公式定義
2. [AWS Well-Architected SaaS Lens - Silo isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-isolation.html)
3. [AWS Well-Architected SaaS Lens - Pool isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/pool-isolation.html)
4. [AWS Well-Architected SaaS Lens - The bridge model](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/bridge-model.html)
5. [AWS SaaS Lens PDF (download)](https://docs.aws.amazon.com/pdfs/wellarchitected/latest/saas-lens/wellarchitected-saas-lens.pdf)
6. [AWS Security Pillar SEC01-BP01 Separate workloads using accounts](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_securely_operate_multi_accounts.html) — 「account-level separation is strongly recommended」
7. [AWS Whitepaper - Organizing Your AWS Environment Using Multiple Accounts](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html)
8. [AWS Whitepaper - Sandbox OU](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/sandbox-ou.html)
9. [AWS Whitepaper - Experimental OUs](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/experimental-ous.html)
10. [AWS Whitepaper - Benefits of using multiple AWS accounts](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/benefits-of-using-multiple-aws-accounts.html)
11. [AWS Cloud Operations Blog - Best practices for creating and managing sandbox accounts](https://aws.amazon.com/blogs/mt/best-practices-creating-managing-sandbox-accounts-aws/)
12. [AWS SaaS Tenant Isolation Strategies Whitepaper PDF](https://d1.awsstatic.com/whitepapers/saas-tenant-isolation-strategies.pdf)
13. [AWS APN Blog - Building a Multi-Tenant SaaS Solution Using AWS Serverless Services](https://aws.amazon.com/blogs/apn/building-a-multi-tenant-saas-solution-using-aws-serverless-services/)
14. [AWS Solution - Guidance for Workload Isolation on AWS](https://aws.amazon.com/solutions/guidance/workload-isolation-on-aws/)

### AWS Lambda 公式

15. [AWS Lambda - Defining function permissions with an execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html) — 「best practice, adjust the policy to include only the required permissions」
16. [AWS Lambda - Managing permissions in AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-permissions.html)
17. [AWS Compute Blog - Operating Lambda: Building a solid security foundation – Part 1](https://aws.amazon.com/blogs/compute/operating-lambda-building-a-solid-security-foundation-part-1/) — 「Every Lambda function should have a 1:1 relationship with an IAM role」「Execution environments are never shared across functions and MicroVMs are never shared across AWS accounts」

### AWS IAM 公式

18. [AWS IAM - Permissions boundaries for IAM entities](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html) — 「The effective permissions are the intersection of both policy types」
19. [AWS IAM - Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
20. [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
21. [AWS Prescriptive Guidance - Creating a permissions boundary](https://docs.aws.amazon.com/prescriptive-guidance/latest/transitioning-to-multiple-aws-accounts/creating-a-permissions-boundary.html)
22. [aws-samples/example-permissions-boundary - sample IAM permissions boundary](https://github.com/aws-samples/example-permissions-boundary)

### AWS CloudFront + Lambda Function URL

23. [AWS Networking Blog - Secure your Lambda function URLs using Amazon CloudFront origin access control](https://aws.amazon.com/blogs/networking-and-content-delivery/secure-your-lambda-function-urls-using-amazon-cloudfront-origin-access-control/)
24. [AWS Networking Blog - Using Amazon CloudFront with AWS Lambda as origin](https://aws.amazon.com/blogs/networking-and-content-delivery/using-amazon-cloudfront-with-aws-lambda-as-origin-to-accelerate-your-web-applications/)
25. [AWS CloudFront - Use various origins with CloudFront distributions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)

### AWS SaaS Factory Reference GitHub

26. [aws-samples/aws-saas-factory-ref-solution-serverless-saas](https://github.com/aws-samples/aws-saas-factory-ref-solution-serverless-saas/blob/main/DOCUMENTATION.md) — Platinum tier = silo Lambda per tenant
27. [aws-samples/aws-saas-factory-eks-reference-architecture](https://github.com/aws-samples/aws-saas-factory-eks-reference-architecture)
28. [aws-samples/aws-saas-factory-bootcamp](https://github.com/aws-samples/aws-saas-factory-bootcamp)

### Stripe 公式

29. [Stripe - Sandboxes](https://docs.stripe.com/sandboxes)
30. [Stripe - Testing use cases](https://docs.stripe.com/test-mode)
31. [Stripe Dev Blog - Avoiding test mode tangles with Stripe Sandboxes](https://stripe.dev/blog/avoiding-test-mode-tangles-with-stripe-sandboxes)
32. [Stripe Help - Issuing test mode configurations and differences vs live mode](https://support.stripe.com/questions/stripe-issuing-test-mode-configurations-and-differences-vs-live-mode)
33. [Stripe Apps - Handle different modes](https://docs.stripe.com/stripe-apps/handling-modes?locale=en-GB)
34. [paymentspaymentspayments.com - Test Mode at Stripe interview](https://paymentspaymentspayments.com/interviews/test-mode-at-stripe/) — 「physically separate host sets」記述あり、Stripe 公式側裏付け取れず (ECONNREFUSED でアクセス未確認)

### Vercel 公式

35. [Vercel - Environments](https://vercel.com/docs/deployments/environments)
36. [Vercel - How Vercel builds your application](https://vercel.com/docs/getting-started-with-vercel/fundamental-concepts/builds)
37. [Vercel - Environment variables](https://vercel.com/docs/environment-variables)

### Atlassian 公式

38. [Atlassian Trust - Cloud architecture and operational practices](https://www.atlassian.com/trust/reliability/cloud-architecture-and-operational-practices) — 「multi-tenant micro-service architecture」「logical isolation via tenant context」
39. [Atlassian Isolated Cloud](https://www.atlassian.com/enterprise/isolated-cloud) — 2026 開始予定の single-tenant VPC

### Shopify Engineering 公式

40. [Shopify Engineering - A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale)
41. [Shopify Engineering - Shard Balancing](https://shopify.engineering/mysql-database-shard-balancing-terabyte-scale)
42. [Shopify Engineering - E-Commerce at Scale: Inside Shopify's Tech Stack](https://shopify.engineering/e-commerce-at-scale-inside-shopifys-tech-stack)
43. [Shopify Help - Client transfer stores and collaborations](https://help.shopify.com/en/partners/manage-clients-stores/client-transfer-stores)

### GitLab Handbook 公式

44. [GitLab Handbook - Demo Systems](https://handbook.gitlab.com/handbook/customer-success/demo-systems/)
45. [GitLab Handbook - Infrastructure Environments](https://handbook.gitlab.com/handbook/engineering/infrastructure/environments/)
46. [GitLab Handbook - Production Architecture](https://handbook.gitlab.com/handbook/engineering/infrastructure/production/architecture/)
47. [GitLab Handbook - Deployments](https://handbook.gitlab.com/handbook/engineering/deployments-and-releases/deployments/)
48. [GitLab Docs - Reference architectures](https://docs.gitlab.com/administration/reference_architectures/)

### Sentry 公式

49. [Sentry Demo Sandbox](https://sentry.io/demo/sandbox/)
50. [Sentry Demos GitHub Organization](https://github.com/sentry-demos)
51. [Sentry Self-Hosted Documentation](https://develop.sentry.dev/self-hosted/)

### PostHog 公式

52. [PostHog/posthog-demo-3000 GitHub](https://github.com/PostHog/posthog-demo-3000)
53. [PostHog/posthog-demo-3000 README](https://github.com/PostHog/posthog-demo-3000/blob/main/README.md)
54. [PostHog Issue #2128 - Great demo environment EPIC](https://github.com/PostHog/posthog/issues/2128)
55. [PostHog Demo page](https://posthog.com/demo)

### Mattermost 公式

56. [Mattermost Engineering Blog - Building a SaaS Architecture with a Single Tenant Application](https://mattermost.com/blog/building-a-saas-architecture-with-a-single-tenant-application/)
57. [Mattermost Cloud GitHub](https://github.com/mattermost/mattermost-cloud)
58. [CNCF Blog - Building a SaaS architecture with a single tenant application (Mattermost 寄稿)](https://www.cncf.io/blog/2022/04/26/building-a-saas-architecture-with-a-single-tenant-application/)
59. [Mattermost Cloud whitepaper PDF](https://mattermost.com/wp-content/uploads/2020/11/Mattermost_Cloud.pdf)

### Rocket.Chat 公式

60. [Rocket.Chat - Trial on AWS](https://www.rocket.chat/trial-saas)
61. [Rocket.Chat - Cloud trial](https://cloud.rocket.chat/trial)
62. [Rocket.Chat - Architecture Overview](https://developer.rocket.chat/docs/architecture-and-components)
63. [Rocket.Chat - Deploy](https://docs.rocket.chat/docs/deploy-rocketchat)

### Heroku 公式

64. [Heroku Dev Center - Review Apps](https://devcenter.heroku.com/articles/github-integration-review-apps) — 「Review apps run the code in any GitHub pull request in a complete, disposable Heroku app」
65. [Heroku Dev Center - Dyno Isolation](https://devcenter.heroku.com/articles/dyno-isolation) — 「All dynos are strongly isolated from one another」
66. [Heroku Dev Center - Dyno Runtimes](https://devcenter.heroku.com/articles/dyno-runtime)
67. [Heroku Dev Center - Dyno Tiers](https://devcenter.heroku.com/articles/dyno-tiers)

### Supabase 公式 (案 D 対照群)

68. [Supabase - Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous) — 「RLS policies are permissive by default」「construct restrictive policies」
69. [Supabase - Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
70. [Supabase - Securing your API](https://supabase.com/docs/guides/api/securing-your-api)

### 補助参考 (2 次情報、推奨根拠ではない)

- [Serverless First - Control the blast radius of your Lambda functions with an IAM permissions boundary](https://serverlessfirst.com/lambda-blast-radius-iam-permission-boundary/) — 3rd party blog (Paul Swail)、AWS 公式ではない
- [Atlassian Developer Community - Request for feedback: Jira/Confluence Cloud sandbox capabilities](https://community.developer.atlassian.com/t/request-for-feedback-jira-confluence-cloud-sandbox-capabilities/48032) — 3rd party feedback thread

---

## 補遺: 前回 v2 doc の主張で修正が必要な箇所

| v2 doc の主張 | 一次情報源での検証結果 | v3 訂正案 |
|---|---|---|
| 「Stripe は Multi-Lambda を採用」 | Stripe 公式 source で裏付かず。3rd 者インタビュー (アクセス不能) のみ | 「Stripe は live/test を **livemode フラグによる logical 分離** を公式採用。物理分離は Stripe 公式声明なし」 |
| 「Vercel は preview / production で Multi-Lambda」 | Vercel 公式は「build VM isolation + env var scope」を記述。Lambda IAM 単位は **公式 source なし** | 「Vercel は build VM + env var で分離。Lambda IAM 単位の分離は公式記述なし」 |
| 「Atlassian は sandbox を別 infra で deploy」 | Atlassian Trust Center は logical isolation を明記。**反証** | 「Atlassian Cloud は multi-tenant + logical isolation (tenant context)。**Isolated Cloud (新製品)** が 2026 開始予定で初めて単一 VPC tenant 分離」 |
| 「業界標準として Multi-Lambda が広く採用」 | **強い裏付け事例は PostHog HogFlix / Mattermost Cloud / Heroku Review Apps の 3 件**。Stripe / Vercel / Atlassian は裏付け失敗 | 「**SaaS の silo model + Heroku Review Apps pattern として** 業界に存在。AWS 公式は SaaS Lens で bridge model として明示」 |

**今後の v2 doc 修正**: 該当箇所を本 v3 doc の §1 / §2 引用に置換すること。
