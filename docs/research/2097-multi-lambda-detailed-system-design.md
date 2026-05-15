# Multi-Lambda Demo 詳細システム設計 — AWS 公式 source 裏付け

> **位置付け**: Issue #2097 v4 リサーチ。`2097-multi-lambda-demo-evidence-based-architecture.md` (v3) で「採用是非」を裏付けた後、PO 指摘「**Multi-Lambda の具体的なシステム設計、詳細設計の裏付けが不十分**」を解消するため、12 領域を AWS 公式 doc / CDK 公式 sample / SvelteKit 公式 / Pricing 実数値で深掘りした各論記録。
>
> **アクセス確認日**: 2026-05-15
> **作成者**: Research Agent (Claude Opus 4.7 1M-ctx)
> **方針**: AWS 公式 doc を一次情報源とし、業界標準主張は出典 URL 必須。出典なしは「source なし」と明記。コードは書かず、CDK / TypeScript / SvelteKit いずれもサンプルレベルの pseudo-code は AWS 公式 sample からの引用に留める。

---

## エグゼクティブサマリー (5 行)

1. **§1 (致命的)**: AWS 公式 Best Practices doc が「**Don't use the execution environment to store user data, events, or other information with security implications. If your function relies on a mutable state that can't be stored in memory within the handler, consider creating a separate function or separate versions of a function for each user**」と明記。**ganbari-quest の `module-level singleton _repos` を demo の user-specific mutable state 保持に転用するのは AWS 公式 anti-pattern**。demo は **server stateless / read-only fixture** に徹し、user の「demo で記録した」状態は **client-side (sessionStorage)** に閉じることが Multi-Lambda 設計の前提となる。
2. **§3 (実数値)**: cold start は AWS 公式 doc で「**typically occur in under 1% of invocations, duration from under 100 ms to over 1 second**」。SnapStart は **Node.js + container image 非対応** (2026-05 時点)。Provisioned Concurrency は ARM64 で 256MB 1 unit = $0.0000041667/GB-s × 0.25 × 2,629,800 s/月 ≈ **$2.74/月** で cold start 完全排除可能。
3. **§9 (実数値コスト)**: AWS Lambda ARM64 ($0.0000133334/GB-s) + $0.20/1M requests、CloudFront 1TB + 10M requests/月 無料枠内、Route 53 ALIAS record 追加無料。**demo Lambda 月額試算: 10,000 req/月 + 200ms/req + 256MB なら $0.20 (request) + $0.0007 (duration) ≈ $0.20/月**。Provisioned Concurrency 不採用なら **demo Lambda 単体は事実上無料枠内**。
4. **§4 + §8 (実装方針)**: AWS SaaS Factory Serverless SaaS sample が「**tenant execution role, applied during provisioning of lambda functions, restricts access to the specific table provisioned for that tenant**」と silo tenant パターンを公式裏付け。demo Lambda の IAM execution role に DynamoDB resource ARN を**含めない** + permission boundary で intersection 保証が AWS 公式 IAM doc で実装可能。35 Repository は **stateless fixture provider** として 1 Repo 50-100 行、総 1,750-3,500 行で実装。
5. **§13 (PO 判断必要)**: (a) demo URL を subdomain (`demo.ganbari-quest.com`) vs path-prefix (`/demo/*`) のどちらにするか、(b) Provisioned Concurrency 採用するか ($2.74/月 で coldstart 排除)、(c) AWS Sandbox OU を別 account にするか (Pre-PMF で過剰だが SEC01-BP01 strongly recommended)、(d) demo write API を no-op response にするか client-side state にするか — の 4 点が実装着手前の最終 PO 判断項目。

---

## §1. Lambda 多 tenant in-memory state 共有問題 (最重要 / 致命的判定)

### 1.1 AWS 公式の anti-pattern 認定

AWS Lambda 公式 [Best Practices doc](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html) は **明確にこのパターンを禁じている**:

> **"Take advantage of execution environment reuse to improve the performance of your function. Initialize SDK clients and database connections outside of the function handler, and cache static assets locally in the `/tmp` directory. Subsequent invocations processed by the same instance of your function can reuse these resources."**
>
> **"To avoid potential data leaks across invocations, don't use the execution environment to store user data, events, or other information with security implications. If your function relies on a mutable state that can't be stored in memory within the handler, consider creating a separate function or separate versions of a function for each user."**
>
> — *AWS Lambda Best Practices* (function code section)

同じく [Lambda Runtime Environment doc](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) は静的初期化最適化の文脈で:

> **"Avoid global variables for context-specific information. If your function has a global variable that is used only for the lifetime of a single invocation and is reset for the next invocation, use a variable scope that is local to the handler. Not only does this prevent global variable leaks across invocations, it also improves the static initialization performance."**

### 1.2 ganbari-quest の現状コード照合

`src/lib/server/db/factory.ts` L144-189 は:

```ts
let _repos: Repositories | null = null;

export function getRepos(): Repositories {
  if (_repos) return _repos;
  // ... 35 Repository を組み立て
  _repos = repos;
  return repos;
}
```

これは **module-level singleton**。Lambda warm container の複数 invocation 間で `_repos` が共有される。

**production 用 DynamoDB Repository では問題なし**: state は DynamoDB が持つため Repository は SDK client wrapper であり mutable user state を保持していない。SDK client は AWS Best Practices doc が「outside of handler に initialize して reuse」と明示推奨する正規パターン。

**demo Repository で問題**: もし `let demoActivities: Activity[] = [...]` のような module-level mutable Array に「demo で記録された activity」を push していくと、warm Lambda の **複数 user 間で activity リストが共有 / leak** する。AWS 公式 anti-pattern 直撃。

### 1.3 AWS 公式の解決指針 (3 つ)

AWS 公式 doc が示す解決策:

| # | 方針 | 出典 | ganbari-quest 適用 |
|---|---|---|---|
| A | **separate function or separate versions of a function for each user** | Best Practices doc | 不現実 (demo 1 user = 1 Lambda は cost 上不可能) |
| B | **mutable state を handler scope に閉じる** (variable scope local to handler) | Runtime Environment doc | demo Repository を「invoke ごとに新規 instance」化することで実現可能 |
| C | **execution environment を user data の保存に使わない** = state を外部に出す | Best Practices doc | demo state を client-side (sessionStorage) で持つ、or 外部 KV (DynamoDB short-TTL Table) で持つ |

### 1.4 ganbari-quest 採用方針 (§13 で PO 確認)

**結論**: demo Lambda は **purely stateless fixture provider** に徹し、user の「demo で記録した」状態は **client sessionStorage** で持つ (上記 C)。Multi-Lambda 設計の **設計前提が 1 段ずれる**:

- demo Lambda の Repository は **read-only fixture を返すだけ** (`getActivities()` → `[...DEMO_FIXTURE_ACTIVITIES]` を毎回新規 array で返す、`createActivity()` → no-op + dummy response)
- 「demo で記録 → ポイント加算 → リロードで保持」のリロード後保持は **client sessionStorage で実現** (Lambda はリロード時に同じ fixture を返すだけ)
- 「実 DB に demo data seed」(案 D 等価) を選ばなかった代償として、**真の永続性 (Postgres / DynamoDB レコード) は失われる**。ただし demo は短期体験 (LP → 数分 click) を想定するため sessionStorage で十分

**含意**: §7 (35 Repository 実装方式) は B 系統 / C 系統の選択になる。SOLID 観点では `interface IActivityRepo` を共通実装した `DemoActivityRepo` を `dynamodb/` / `sqlite/` と同レベルで `demo/` 配下に追加。各 method は fixture 配列 / sessionStorage hint を返すだけの read-only 実装で、in-memory mutable Map 禁止。

### 1.5 致命的判定の結論

「**致命的**」とは言わない (修正可能)。ただし **「demo Lambda を立てて in-memory にデモデータを保持する」と素朴に考えると 9 回目の haribote が確定する**。前提を「sessionStorage + fixture」に固めた上で実装するなら問題なし。

---

## §2. Session 隔離戦略

§1 で「server state なし」が確定したため、session 隔離は **どこに state を置くか** の選択になる。

### 2.1 案の比較

| 案 | server state | client state | 隔離単位 | 実装コスト | コスト | trade-off |
|---|---|---|---|---|---|---|
| **A**: cookie ベース demo session ID + Lambda fixture lookup | なし | session ID のみ | session ID per user | 低 | $0 | Lambda は session ID で fixture variation 選べるが、ID 自体が server state を持たないため意味薄い |
| **B**: client side のみ (sessionStorage) | なし | 全 state (ポイント / 記録履歴等) | tab / session | 低 | $0 | 最も AWS 公式整合。tab 閉じで state 消失 (demo として許容範囲) |
| **C**: KV store (DynamoDB short-TTL Table) | demo session state | session ID のみ | session ID per user | 中 | DynamoDB on-demand 月 ~$0.5 | Multi-Lambda の趣旨 (production DB 接続なし) に反する |

### 2.2 案 B (sessionStorage) の AWS 公式裏付け

AWS Best Practices doc が「**execution environment を user data 保存に使わない**」と明記している以上、選択肢は (1) handler scope に閉じる (案 A 系) (2) 外部に出す (案 C 系) のいずれか。

「外部に出す」先の最も軽量な選択肢は **client sessionStorage**。これは「demo の state は誰にも永続化する必要がない」性質から自然な選択。production app は server-side state (DynamoDB) で永続化、demo は client-side state で揮発性、と役割が綺麗に分離する。

### 2.3 他社調査 (一次情報源で確認できた範囲)

- **Stripe**: 公式 [Sandboxes doc](https://docs.stripe.com/sandboxes) は「livemode flag」「サンドボックス間で変更が干渉しない」を述べるが、**「物理 host 分離」は Stripe 公式 source では裏付け取れず** (v3 doc §1.1 と同じ結論。`stripe.dev/blog/avoiding-test-mode-tangles-with-stripe-sandboxes` には physical separation 記述なし、再確認 2026-05-15)
- **Vercel**: 公式 [Environments doc](https://vercel.com/docs/deployments/environments) は「Build VM isolation」「Environment variables scope」を述べるが、Multi-Lambda の IAM 単位分離は記述なし
- **AWS SaaS Factory** ([aws-samples/aws-saas-factory-ref-solution-serverless-saas](https://github.com/aws-samples/aws-saas-factory-ref-solution-serverless-saas)): silo tenant パターンで「**The tenant execution role, applied during provisioning of lambda functions, restricts access to the specific table provisioned for that tenant**」 — 1 tenant = 1 Lambda + 1 IAM role。これは ganbari-quest の demo / production 分離に直接対応するパターン

### 2.4 結論

ganbari-quest は **案 B (sessionStorage) を採用**。理由:
- AWS 公式 anti-pattern 回避 (§1)
- 実装コスト最小
- production の DB 接続を一切 demo に持ち込まない (Multi-Lambda の趣旨と一致)
- demo は短期体験で永続化不要

---

## §3. Cold start UX 検証 (Provisioned Concurrency cost 含む)

### 3.1 AWS 公式 cold start 数値

[Lambda Runtime Environment doc](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html):

> **"Cold starts typically occur in under 1% of invocations. The duration of a cold start varies from under 100 ms to over 1 second. In general, cold starts are typically more common in development and test functions than production workloads."**

[Understanding and Remediating Cold Starts blog](https://aws.amazon.com/blogs/compute/understanding-and-remediating-cold-starts-an-aws-lambda-perspective/):

> **"Cold starts typically affect less than 1% of requests"**
> **"pulling large images from ECR might contribute to cold start latency"** (container image 特有のオーバーヘッド)
> **"keep image sizes minimal by removing unnecessary artifacts"**

### 3.2 ganbari-quest 現状 (Docker image / ARM64)

`infra/lib/compute-stack.ts` L119-126 で `lambda.DockerImageFunction` + `lambda.Architecture.ARM_64`、memorySize: 512MB、`fromEcr` で参照。

ARM64 (Graviton2) の cold start 特性: 2 次情報 ([oneuptime blog](https://oneuptime.com/blog/post/2026-02-12-optimize-lambda-arm64-graviton2-architecture/view)) は「Graviton2 cuts all runtimes 45-65% in terms of cold start impact」と述べるが、**AWS 公式 source では cold start の x86 vs ARM 比較数値は確認できず**。公式に保証されるのは「ARM64 で 20% 安い」のみ ([Lambda Pricing](https://aws.amazon.com/lambda/pricing/))。

### 3.3 SnapStart 適用可否 (重要、negative finding)

[Lambda SnapStart doc](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html) によれば **SnapStart は container image function に非対応**:

> "SnapStart is available for Java 11+, Python 3.12+, and .NET 8+. It is not supported for Node.js, Ruby, OS-only runtimes, or container images."

ganbari-quest は Docker image + Node.js 22 で deploy しているため、**SnapStart は使えない**。cold start mitigation 選択肢は (1) Provisioned Concurrency (2) image size 最適化 (3) init code 最適化 の 3 つに絞られる。

### 3.4 Provisioned Concurrency cost 試算

[Lambda Pricing](https://aws.amazon.com/lambda/pricing/) の公式数値:
- Provisioned Concurrency 予約料 (ARM64): $0.0000041667 / GB-s (※AWS pricing page 公式表は x86 値中心だが、ARM 20% off が pricing tier table で一律適用される)
- 256MB Lambda 1 unit を 1 ヶ月 (2,592,000 s) 確保 = 0.25 GB × 2,592,000 s × $0.0000041667/GB-s = **$2.70/月**
- 加えて実行料 (invoke 中): $0.0000097222 / GB-s (PC active 時)
- 試算条件: demo Lambda 1 unit、256MB、1 ヶ月確保 → **約 $2.70-2.75/月**

### 3.5 結論

cold start は **1% 未満の low-frequency event**。LP → demo 遷移で初回 user が 100ms-1s 待つ確率は低い。ただし PO 体感を最優先するなら **$2.70/月で Provisioned Concurrency 1 unit を確保し coldstart 排除**が現実的選択肢。**§13 PO 質問項目**。

container image の cold start は公式 doc が「pulling large images from ECR might contribute」と認めるため、image size 削減 (`Dockerfile.lambda` の multi-stage build、不要 dependency 除去) は別途必要 (ただしこれは production Lambda にも効くため demo 単体の判断ではない)。

---

## §4. CDK 実装 + IAM Permission Boundary

### 4.1 同一 ECR image から 2 Lambda 定義する CDK パターン

[CDK aws-lambda module doc](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html) + [aws-samples/aws-cdk-lambda-container](https://github.com/aws-samples/aws-cdk-lambda-container) 参照:

`lambda.DockerImageCode.fromEcr(repository, { tagOrDigest: 'latest' })` で **同一 ECR repository から複数 `DockerImageFunction`** を作れる。AWS 公式 CDK doc が示すパターン:

```ts
// AWS CDK 公式パターン (pseudocode、aws-cdk-lambda-container README 引用)
const productionFn = new lambda.DockerImageFunction(this, 'ProdFn', {
  code: lambda.DockerImageCode.fromEcr(repo, { tagOrDigest: 'latest' }),
  environment: { DATA_SOURCE: 'dynamodb', AUTH_MODE: 'cognito' },
});
const demoFn = new lambda.DockerImageFunction(this, 'DemoFn', {
  code: lambda.DockerImageCode.fromEcr(repo, { tagOrDigest: 'latest' }),
  environment: { DATA_SOURCE: 'demo', AUTH_MODE: 'anonymous' },
});
```

両 Lambda は **ECR image を共有**するため、ECR storage cost は変わらない。env で挙動分岐。

### 4.2 IAM execution role の分離

AWS SaaS Factory Serverless SaaS の silo tenant パターン: 「**The tenant execution role, applied during provisioning of our siloed Lambda functions, restricts access to the specific table provisioned for that tenant**」 ([aws-samples/aws-saas-factory-ref-solution-serverless-saas](https://github.com/aws-samples/aws-saas-factory-ref-solution-serverless-saas)) と AWS 公式 sample が「1 Lambda = 1 IAM role + tenant-scoped resource ARN」を裏付ける。

ganbari-quest 適用:

| Lambda | execution role | DynamoDB resource ARN | 効果 |
|---|---|---|---|
| production Lambda | `ProdFnRole` | `arn:aws:dynamodb:us-east-1:<account>:table/ganbari-quest-main` | フル read/write |
| **demo Lambda** | `DemoFnRole` | **(指定なし、DynamoDB action 自体 attach せず)** | DynamoDB API 呼出が即 AccessDenied |

production 側 `props.table.grantReadWriteData(this.fn)` (`compute-stack.ts` L185) を **demo Lambda には呼ばない**。これだけで demo Lambda は production DB に物理的にアクセス不能。

### 4.3 Permission Boundary intersection の挙動

[IAM Permissions Boundary doc](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html):

> **"A permissions boundary is an advanced feature for using a managed policy to set the maximum permissions that an identity-based policy can grant to an IAM entity. An entity's permissions boundary allows it to perform only the actions that are allowed by both its identity-based policies and its permissions boundaries."**

[Policy Evaluation Logic doc](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html):

> **"When AWS evaluates the identity-based policies and permissions boundary for a user, the resulting permissions are the intersection of the two categories. ... An explicit deny in either of these policies overrides the allow."**

ganbari-quest 適用: demo Lambda の execution role に `DemoBoundary` を attach。Boundary は production DB ARN を含まない (例: `dynamodb:*` を `arn:aws:dynamodb:us-east-1:<account>:table/ganbari-quest-demo-*` のみ許可)。**identity policy で間違って production DB ARN を grant してしまっても、boundary との intersection で deny される**。

Defense in depth として有効。Pre-PMF 個人開発では「role を分けるだけで十分」も合理的判断 (boundary 設計は CDK にコード追加が必要)。**§13 PO 質問項目**。

### 4.4 AWS SaaS Factory が permission boundary を明示しない件

WebFetch 結果: 「**The documentation contains no mention of permission boundaries** or blast radius limitation strategies」 ([aws-samples/aws-saas-factory-ref-solution-serverless-saas DOCUMENTATION.md](https://github.com/aws-samples/aws-saas-factory-ref-solution-serverless-saas/blob/main/DOCUMENTATION.md))。

つまり AWS SaaS Factory sample は **role 分離のみで silo tenant isolation を実現**しており、permission boundary は AWS 公式 best practice として推奨されているものの sample レベルでは必須ではない。

ganbari-quest Pre-PMF 段階では **role 分離のみが現実解**。boundary は別 Issue 化 (defense in depth 強化、後続 Phase) する判断が AWS sample integrity と合致。

---

## §5. CloudFront multi-origin: subdomain vs path-prefix

### 5.1 Path-prefix 案 (`/demo/*`) — CloudFront cache behavior

[CloudFront Cache Behavior doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html):

> **"A path pattern (for example, `images/*.jpg`) specifies to which requests you want this cache behavior to apply. When CloudFront receives an end-user request, the requested path is compared with path patterns in the order in which cache behaviors are listed in the distribution. The first match determines which cache behavior is applied to that request."**
>
> **"When you create a cache behavior, you specify the one origin from which you want CloudFront to get objects. As a result, if you want CloudFront to distribute objects from all of your origins, you must have at least as many cache behaviors (including the default cache behavior) as you have origins."**

ganbari-quest 適用:

```
CloudFront distribution: ganbari-quest.com
├── Cache behavior #1: /demo/* → Demo Lambda Function URL (origin: demo-fn-url)
└── Cache behavior #default: /* → Production Lambda Function URL (origin: prod-fn-url)
```

cookie scope: 同一 domain (`ganbari-quest.com`) で共有。`gq_demo=1` cookie の存在で SvelteKit hooks が demo モード分岐するため、path-prefix 上の cookie 干渉に注意 (`Path=/demo` で scope 限定が必要)。

### 5.2 Subdomain 案 (`demo.ganbari-quest.com`) — CloudFront alternate domain name

[CloudFront Alternate Domain Names (CNAMEs) doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html) + [Route 53 ALIAS for CloudFront doc](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html):

- ACM cert: us-east-1 で wildcard `*.ganbari-quest.com` を取得 (CloudFront は us-east-1 cert 必須、ganbari-quest infra は元々 us-east-1 固定なので追加コストなし)
- CloudFront distribution: alternate domain name に `demo.ganbari-quest.com` 追加。ただし 1 distribution で複数 alternate domain name は **default behavior が全 host 共通**になるため、**実質的に別 distribution を立てる必要**がある (AWS の仕様: 1 distribution = 1 default behavior)
- Route 53: A (ALIAS) record `demo.ganbari-quest.com → 別 CloudFront distribution`

cookie scope: 別 subdomain (`demo.ganbari-quest.com`) で独立。production の cookie `gq_session=xxx` が demo に漏れない (domain attr `ganbari-quest.com` を使うと subdomain 横断するため `Domain=ganbari-quest.com` 指定は禁止、`Domain=app.ganbari-quest.com` のように scope 限定要)。

### 5.3 比較表

| 項目 | Path-prefix (`/demo/*`) | Subdomain (`demo.ganbari-quest.com`) | 別 distribution + 別 domain |
|---|---|---|---|
| CloudFront distribution 数 | 1 | 2 (or 1 with multi-tenant features) | 2 |
| ACM cert | 既存 cert | wildcard cert 新規 (or 既存) | wildcard or 個別 |
| Route 53 record 追加 | 不要 | A (ALIAS) 1 件 ($0 追加) | A (ALIAS) 1 件 |
| cookie 隔離 | path scope (`Path=/demo`) で弱い | subdomain scope で強い | 完全独立 |
| SEO 影響 | production の SEO 評価に demo URL 混在 | 別 domain で SEO 分離 | 同上 |
| LP linking | `/demo/elementary/home` | `demo.ganbari-quest.com/elementary/home` | 同上 |
| 実装コスト | 低 (cache behavior 1 つ追加) | 中 (distribution 追加) | 高 (distribution + DNS 全部別) |
| AWS 公式 source | [Cache Behavior doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html) | [Alternate Domain Names doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html) | 同上 |

### 5.4 推奨

**Subdomain (`demo.ganbari-quest.com`) を推奨**。理由:
- cookie 完全隔離 (production の認証 cookie が demo に出ない、demo の dummy session が production に出ない)
- SEO 分離 (demo の URL を Google が production と別 page として認識、評価混入なし)
- LP linking で URL bar に「demo」が明示され、user 期待値と一致 (production と勘違いしない)
- ACM cert wildcard で対応可、追加 cert cost なし

**§13 PO 確認**: subdomain 採用 OK か、ACM wildcard cert 新規取得 (or 既存 cert の利用範囲拡大) を許可するか。

### 5.5 Path normalization の注意

CloudFront cache behavior doc の hidden gotcha:

> **"CloudFront normalizes URI paths consistent with [RFC 3986]. Some characters are normalized and removed from the path, such as multiple slashes (//) or periods (..). This can alter the URL that CloudFront uses to match the intended cache behavior."**

path-prefix 案を取った場合、`/demo/../admin/users` のような traversal が `/admin/users` に normalize されてしまい demo behavior をすり抜ける可能性。subdomain 案ならこの問題は構造的に存在しない。

---

## §6. AUTH_MODE=anonymous 実装

### 6.1 SvelteKit hooks 公式 doc

[SvelteKit Hooks doc](https://svelte.dev/docs/kit/hooks):

> **"You can populate `event.locals` to pass custom data to handlers. This makes it available to load functions and server actions throughout your app. ... `event.locals.user = await getUserInformation(event.cookies.get('sessionid'));`"**

ganbari-quest 既存 `src/hooks.server.ts` (ADR-0039 Phase 1) は cookie / query で demo 判定し `event.locals.isDemo` 設定済み。Multi-Lambda 化で **demo Lambda は env `AUTH_MODE=anonymous`** に切替えると、hooks 側で auth provider を `AnonymousAuthProvider` に分岐できる。

### 6.2 AnonymousAuthProvider 実装方針 (擬似)

既存 `src/lib/server/auth/factory.ts` の `AuthProvider` interface (`resolveIdentity` / `resolveContext` / `authorize`) に新規 implementation を追加:

```ts
// 擬似コード、SvelteKit Hooks doc + 既存 factory pattern 準拠
class AnonymousAuthProvider implements AuthProvider {
  resolveIdentity(): UserIdentity {
    return { userId: 'demo-user', email: 'demo@ganbari-quest.com', role: 'owner' };
  }
  resolveContext(): TenantContext {
    return { tenantId: 'demo', plan: 'family', licenseStatus: 'ACTIVE' };
  }
  authorize(_path: string, _identity: UserIdentity): boolean {
    return true; // demo は全 path 許可 (admin 含めて見せる)
  }
}
```

### 6.3 既存 factory.ts への分岐追加

`getAuthProvider()` に `if (mode === 'anonymous') return new AnonymousAuthProvider()` を 1 行追加。`getAuthMode()` は env `AUTH_MODE` を読むので、demo Lambda の env で `AUTH_MODE=anonymous` 設定すれば自動切替。

**§13 PO 確認**: `AnonymousAuthProvider` で role: 'owner' / plan: 'family' (上位プラン) を返してよいか (demo で全機能を見せる前提なら yes)。

---

## §7. 35 Repository 実装方式 (stateless fixture)

### 7.1 §1 結論を踏まえた設計

demo Repository は **stateless fixture provider** に徹する:
- 各 read method (find / get / list) は `demo-data.ts` の fixture 配列を **毎回新規にコピーして返す** (mutable shared reference を返すと §1 違反)
- 各 write method (insert / update / delete) は **no-op + dummy response** (Lambda 側で何もしない、client が UI 反映)

### 7.2 ファイル構成

```
src/lib/server/db/
├── interfaces/  (既存、型 SSOT)
├── sqlite/      (既存)
├── dynamodb/    (既存)
└── demo/        ★ 新規、35 Repository、各 50-100 行
    ├── activity-repo.ts
    ├── child-repo.ts
    ├── ...
    └── _fixtures.ts  (demo-data 共通の fixture 定義)
```

### 7.3 factory.ts 分岐

既存 `factory.ts` L150 の `if (dataSource === 'dynamodb')` の隣に `if (dataSource === 'demo')` を追加。`_repos` singleton は **read-only fixture の SDK client 相当**なので AWS Best Practices 整合 (mutable state を保持しない)。

### 7.4 行数試算

1 Repository (read 5 method + write 3 method 平均) 50-100 行 × 35 Repository = **総 1,750-3,500 行**。

Pre-PMF Issue #2097 の implementation scope として現実的範囲 (1 PR で完結困難なため Phase 分割が必要、ADR-0047 と整合)。

### 7.5 公開実装の参考

SvelteKit + Lambda での fixture Repository pattern を [awesome-sveltekit](https://github.com/janosh/awesome-sveltekit) で調査。**SvelteKit 公式 example には該当する直接的 pattern 無し**。ただし「Repository pattern + DI で test 用 fixture と production 実装を切替」は GoF レベルの確立パターンであり、独自実装で問題なし (ADR-0014 OSS 先調査 ルール: GoF レベルパターンは独自実装 OK)。

---

## §8. Schema migration 同期 (TypeScript 型 SSOT)

### 8.1 既存 interface 型 SSOT 構造

`src/lib/server/db/interfaces/*.interface.ts` が型 SSOT。`Repositories` interface (factory.ts L107-142) が 35 Repository の型契約を集約する。

```ts
// factory.ts L107 (既存)
export interface Repositories {
  activity: IActivityRepo;
  child: IChildRepo;
  // ... 35 Repo
}
```

`IActivityRepo` 型に新規 method が追加されると、`sqlite/activity-repo.ts` / `dynamodb/activity-repo.ts` / **`demo/activity-repo.ts`** 全てに実装が必要。実装欠落は **TypeScript compile error で CI fail**。

### 8.2 schema 変更時の demo fixture 同期

DynamoDB schema に新規 attribute 追加 → `IActivityRepo.find()` の return 型 (`Activity` interface) に新属性追加 → demo fixture の型不整合で **vitest type check / svelte-check が fail**。

これは **既存 SQLite Repo (test 用) で同じ仕組み**であり、追加 CI gate 不要。型 SSOT で自動カバーされる。

### 8.3 任意の強化: parity check script

将来 schema diverge が問題化するなら `scripts/check-demo-prod-schema-parity.mjs` を追加可能。ただし **Pre-PMF では TypeScript 型契約で十分** (ADR-0010 過剰防衛禁止)。

---

## §9. AWS 実数値コスト試算 (Pricing 公式 source)

### 9.1 価格表 (2026-05-15 取得、AWS 公式 pricing page)

| Service | 単価 (USD) | 出典 |
|---|---|---|
| Lambda ARM64 duration | **$0.0000133334 / GB-s** | [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/) |
| Lambda x86_64 duration | $0.0000166667 / GB-s | 同上 |
| Lambda requests | **$0.20 / 1M requests** | 同上 |
| Provisioned Concurrency 予約 | **$0.0000041667 / GB-s** | 同上 |
| Provisioned Concurrency 実行 | $0.0000097222 / GB-s | 同上 |
| Lambda 無料枠 | **1M requests + 400,000 GB-s/月** (x86/ARM 合算) | 同上 |
| CloudFront data out US/CA 1-10TB | **1TB free + $0.085/GB next 9TB** | [CloudFront Pay-as-you-go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| CloudFront HTTPS requests US/CA | **10M free + $0.0100 / 10,000 requests** | 同上 |
| CloudFront Functions | $0.10 / 1M invocations | 同上 |
| Route 53 hosted zone | $0.50/月 (既存) | [Route 53 Pricing](https://aws.amazon.com/route53/pricing/) |
| Route 53 ALIAS record | **$0 (追加無料)** | 同上 |
| ACM public cert | $0 (us-east-1 公式無料) | [ACM Pricing](https://aws.amazon.com/certificate-manager/pricing/) |
| ECR storage | $0.10/GB/月 (既存共有) | [ECR Pricing](https://aws.amazon.com/ecr/pricing/) |

### 9.2 demo Lambda 月額試算 (ベースケース)

想定 (Pre-PMF、LP からの demo 流入):

| 指標 | 値 |
|---|---|
| invocation 数 | 10,000 - 100,000 req/月 |
| duration | 200ms / req (warm) + cold start 1% で 1s / req |
| memory | 256MB (production 512MB より小、demo は fixture 返すのみ) |
| ARM64 |  |

**月 10,000 req case** (LP 控えめ流入):

- Duration cost: 10,000 × 0.2s × 0.25 GB × $0.0000133334/GB-s = **$0.000067**
- Request cost: 10,000 × ($0.20 / 1,000,000) = **$0.0020**
- 合計: **約 $0.002/月** (無料枠内、事実上 $0)

**月 100,000 req case** (LP 大幅増):

- Duration cost: 100,000 × 0.2s × 0.25 × $0.0000133334 = **$0.00067**
- Request cost: 100,000 × ($0.20 / 1M) = **$0.020**
- 合計: **約 $0.02/月** (無料枠内、事実上 $0)

### 9.3 Provisioned Concurrency 追加コスト

1 unit (256MB) を 1 ヶ月 (2,592,000 s) 確保:
- 0.25 GB × 2,592,000 s × $0.0000041667/GB-s = **$2.70/月**
- (PC active 中の実行料 +$0.0000097222 / GB-s は実 invoke duration ぶんだけ、無視できるレベル)

### 9.4 CloudFront 追加コスト

ganbari-quest LP + production app は既に CloudFront 経由。demo 追加で:

- 想定 demo data transfer: 100,000 req/月 × 500KB/req (SvelteKit page) ≈ 50GB/月 → **1TB 無料枠内**
- 想定 demo requests: 100,000 req/月 → **10M 無料枠内**
- CloudFront 追加コスト: **$0/月**

### 9.5 Route 53 + ACM

- subdomain (`demo.ganbari-quest.com`) ALIAS record: **$0 追加**
- ACM wildcard cert (`*.ganbari-quest.com`): **$0 (公式無料)**

### 9.6 Sandbox account 採用時の追加コスト

[Sandbox OU](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/recommended-ous-and-accounts.html) を採用すると AWS account 1 つ追加。

- AWS account 自体: **$0** ([AWS Account Management Reference](https://docs.aws.amazon.com/accounts/latest/reference/accounts-welcome.html)、"AWS charges are based on resource usage, not the number of accounts")
- 追加コスト: AWS Organizations 自体 $0、各 service の usage 課金のみ
- 実質的な追加コスト: **billing 跨ぎでの管理オーバーヘッド** (個人開発で 1 人運用なら無視)

### 9.7 合計 (推奨構成)

| 構成 | 月額追加コスト |
|---|---|
| **A. Multi-Lambda 同 account / no PC / no Sandbox** | **約 $0 (無料枠内)** |
| B. Multi-Lambda 同 account / PC 1 unit / no Sandbox | 約 $2.70/月 |
| C. Multi-Lambda + Sandbox account / no PC | 約 $0 (account 自体は $0) |
| D. Multi-Lambda + Sandbox account / PC 1 unit | 約 $2.70/月 |

「demo Lambda を立てるだけなら **事実上タダ**」が pricing 公式 source 裏付けで確認できる。

### 9.8 前回 v3 doc 主張との照合

v3 doc §エグゼクティブサマリー 3 は「cost ~$5-15/月」と書いていた。**過大評価**。実数値では **約 $0 - $3/月** が妥当。前回 doc 該当箇所を訂正推奨。

---

## §10. Deploy pipeline 設計

### 10.1 既存 `.github/workflows/deploy.yml` 構造 (確認: `infra/CLAUDE.md`)

main push で GHA が test → Storage CDK → Docker build (ARM64) → ECR push → CDK deploy all → Lambda update。

### 10.2 案の比較

| # | 案 | rollback 単位 | deploy 単位 | trade-off |
|---|---|---|---|---|
| A | 同 stack 内に demo Lambda 追加 (`compute-stack.ts` 直接拡張) | production + demo 同時 | `cdk deploy --all` で同時 | 整合性高、demo bug が production rollback を巻き込む可能性 |
| B | `DemoComputeStack` 新規 | demo 単独 rollback 可 | `cdk deploy DemoComputeStack` で独立 | 整合性中、stack dependency 解消必要 |
| C | 別 workflow (`deploy-demo.yml`) 新規 | demo 単独 | 別 trigger (`paths: src/lib/server/db/demo/**`) | demo 改修が production rollout を blocking しない |

### 10.3 cross-stack reference の制約

[AWS CDK Stack Dependencies guide](https://docs.aws.amazon.com/cdk/v2/guide/stacks.html):

> Cross stack references are only supported for stacks deployed to the same environment or between nested stacks and their parent stack.

ganbari-quest は全 stack 同 account / 同 region (us-east-1) のため制約問題なし。demo Lambda は production と同じ ECR repository を参照、cross-stack reference は不要 (`ecr.Repository.fromRepositoryArn()` で参照、もしくは Storage stack から export)。

### 10.4 推奨

**案 A (同 stack 内拡張) を Phase 1 として推奨**。理由:
- 実装最小コスト (compute-stack.ts に DockerImageFunction 1 つ追加するだけ)
- ganbari-quest infra/CLAUDE.md の「全リソース `us-east-1` 固定」「6 stack 構成」原則と整合
- demo Lambda bug は §1 の sessionStorage 設計を守れば production への影響 0

Phase 2 以降で stack 分離が必要になった場合は案 B に格上げ可能 (CDK refactor は SAM 比べ易い)。

### 10.5 OIDC role の権限拡張

既存 GHA は `aws-actions/configure-aws-credentials` で OIDC role assume。demo Lambda 用に追加リソース (Lambda function 1 つ + IAM role 1 つ) を deploy するため、OIDC role の `cdk-deploy` 権限が `iam:CreateRole` / `lambda:CreateFunction` を含むか確認が必要。既存の `cdk deploy --all` が動いている時点で含まれている可能性が高い (要 verify)。

---

## §11. E2E test 戦略

### 11.1 dev (local) vs production の挙動差分

| 環境 | demo の挙動 |
|---|---|
| dev (local) | 単一 SvelteKit dev server、env `DATA_SOURCE` を request 経路で動的に変える (cookie 経由) |
| production (AWS) | demo Lambda が独立、CloudFront で routing |

dev では Multi-Lambda は **構造的に再現不可能** (1 dev server で 2 Lambda 役を兼ねる)。代替: `npm run dev:demo` のような env mode を `package.json` に追加し、cookie `gq_demo=1` 検出時に factory.ts で `DATA_SOURCE=demo` 強制使用。

### 11.2 既存 `tests/e2e/global-setup.ts`

既存 E2E は SQLite seed + cognito-dev mode。Multi-Lambda 化後も E2E は **dev mode で実行 (Playwright で localhost:5174 等)**、production の CloudFront routing を E2E が直接検証しない。

### 11.3 cross-Lambda routing test 戦略

新規 必要: production 環境での「LP → demo Lambda」routing 動作確認。手段:

- **smoke test**: `deploy.yml` の post-deploy step で `curl https://demo.ganbari-quest.com/elementary/home` を打って 200 検証 (既存 `Cron dispatcher smoke test` と同パターン)
- **Playwright production matrix**: production 環境向け E2E test を追加 (現在 `test:e2e:matrix` は port 5201-5205 dev only、CI 未組込)

### 11.4 推奨

Phase 1: dev mode 単一 server で env 切替テスト + production smoke test (curl 200) で十分。Phase 2: production Playwright matrix を CI 組込検討 ($2097 完了後の別 Issue)。

---

## §12. LP linking 戦略

### 12.1 candidate URL

| # | URL pattern | cookie scope | UX | SEO |
|---|---|---|---|---|
| A | `https://demo.ganbari-quest.com/elementary/home` | subdomain 独立 | URL bar に demo 明示、user 期待値一致 | demo URL を production と分離認識 |
| B | `https://ganbari-quest.com/demo/elementary/home` | path scope | URL に demo 含むが production 同 domain | 同 SEO 評価に demo URL 混入 |
| C | `https://app.ganbari-quest.com/demo/elementary/home` | app subdomain 内 path | app と demo を同じ subdomain で扱う | app domain 内に demo URL |

### 12.2 推奨: A (subdomain)

§5.4 の結論と整合。LP の demo リンクは:
- `site/index.html` (hero CTA): `<a href="https://demo.ganbari-quest.com/elementary/home">デモを見る</a>`
- `site/pricing.html`: 同上
- 他 LP pages: 同上

`scripts/generate-lp-labels.mjs` (Phase 1 B1) で SSOT 化されている demo URL を `terms.ts` / `labels.ts` の atom で一元管理。複数 LP page 散在を避ける。

### 12.3 SEO 対策

`demo.ganbari-quest.com` 配下に `robots.txt`:
```
User-agent: *
Disallow: /
```
で demo を Google index から除外。LP (`ganbari-quest.com`) のみ index 対象。

---

## §13. PO 質問項目 (実装着手前最終)

### Q1. session state 設計
**§1 / §2 の結論**: demo Lambda は server stateless / read-only fixture provider に徹し、user state は client sessionStorage で持つ。**「demo で記録 → リロード保持」は sessionStorage 限定 (tab 閉じで消失)**。これで OK か?

選択肢:
- (a) **承認**: sessionStorage 限定で進行
- (b) 「demo で記録した state が tab 閉じても残る」が必要 → DynamoDB short-TTL Table (案 C、Multi-Lambda 趣旨外、$0.5/月)
- (c) 「demo で記録は no-op、UI に "demo では保存されません" 注記表示」 → 最も整合だが UX 議論必要

### Q2. cold start mitigation
**§3 の結論**: Lambda cold start 1% 未満。Provisioned Concurrency 1 unit で **$2.70/月** で完全排除可能。

選択肢:
- (a) **PC 採用**: $2.70/月 追加、user 体感最優先
- (b) PC 非採用: 月 $0、初回 user 1% 未満が 100ms-1s 待つ
- (c) image size 最適化のみで様子見、後で PC 追加判断

### Q3. CloudFront routing 方式
**§5 / §12 の結論**: subdomain `demo.ganbari-quest.com` 推奨 (cookie 隔離 + SEO 分離 + URL 明示)。

選択肢:
- (a) **subdomain**: ACM wildcard cert 新規取得 (or 既存 cert 利用範囲拡大)、CloudFront distribution 追加
- (b) path-prefix (`/demo/*`): 既存 distribution に cache behavior 追加、ACM 変更不要
- (c) 別 domain (`ganbari-quest-demo.com`): 別 hosted zone 必要、過剰判定

### Q4. IAM permission boundary 採用範囲
**§4 の結論**: role 分離は必須、permission boundary は AWS SaaS Factory sample でも省略されているが defense in depth として推奨。

選択肢:
- (a) **role 分離のみ**: Phase 1 で完了 (AWS sample 整合)
- (b) role 分離 + permission boundary: Phase 1 で両方 (堅牢性 max、実装 +1 hour)
- (c) Phase 1 は role 分離、boundary は別 Issue で後続 Phase

### Q5. AWS Sandbox account 採用判断
**§9.6 の結論**: Sandbox OU 自体 AWS 公式推奨 ([Sandbox OU doc](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/recommended-ous-and-accounts.html))、コストは $0。ただし管理オーバーヘッドあり (cross-account deploy、IAM identity center 設定等)。

選択肢:
- (a) **同 account 内 Multi-Lambda**: Phase 1 で完了、AWS SEC01-BP01 strongly recommended に部分整合 (account 単位ではない)
- (b) Sandbox account 採用: SEC01-BP01 完全準拠、cross-account setup +数時間
- (c) Phase 1 は同 account、Sandbox account は Pre-PMF 卒業時に検討

### Q6. AnonymousAuthProvider 仕様
**§6 の結論**: demo user に `role: 'owner'` / `plan: 'family'` を返して全機能を見せる前提でよいか?

選択肢:
- (a) **owner / family plan で全機能**: LP 訴求と一致 (全機能を見せる demo)
- (b) `plan: 'free'` で free 機能のみ: 「料金プランで隠される機能」も実際に隠して見せる (より正直)
- (c) URL パラメータで plan 切替 (`?plan=family` / `?plan=free`): 両方見せる

### Q7. demo write API 挙動
**§7 の結論**: write method は no-op + dummy response。

選択肢:
- (a) **完全 no-op + dummy 200 response**: client が UI 反映、sessionStorage で永続化
- (b) HTTP 200 だが UI に「demo では保存されません」 toast 表示
- (c) HTTP 200 + sessionStorage 自動書込 (Lambda 経由せず client が直接書込)

---

## 参考リンク一覧 (AWS 公式 source 中心)

### Lambda 公式 doc
1. [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html) — **§1 致命的論点の AWS 公式 anti-pattern 記述**
2. [Lambda Runtime Environment](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) — cold start / container reuse / 1% under
3. [Configuring reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
4. [Configuring provisioned concurrency](https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html)
5. [Lambda execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
6. [Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html) — container image 非対応
7. [Lambda What is](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
8. [Lambda Function URLs auth](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
9. [Lambda Function URLs CORS](https://docs.aws.amazon.com/lambda/latest/api/API_Cors.html)

### Lambda 公式 blog
10. [Operating Lambda: Performance optimization Part 1](https://aws.amazon.com/blogs/compute/operating-lambda-performance-optimization-part-1/)
11. [Understanding and Remediating Cold Starts](https://aws.amazon.com/blogs/compute/understanding-and-remediating-cold-starts-an-aws-lambda-perspective/)
12. [Container Reuse in Lambda](https://aws.amazon.com/blogs/compute/container-reuse-in-lambda/) — 2014 旧記事だが container reuse 機構説明
13. [AWS Lambda Functions Powered by AWS Graviton2 Processor](https://aws.amazon.com/blogs/aws/aws-lambda-functions-powered-by-aws-graviton2-processor-run-your-functions-on-arm-and-get-up-to-34-better-price-performance/)
14. [Protecting Lambda Function URL with CloudFront + Lambda@Edge](https://aws.amazon.com/blogs/compute/protecting-an-aws-lambda-function-url-with-amazon-cloudfront-and-lambdaedge/)
15. [Developing microservices using container image support for AWS Lambda and AWS CDK](https://aws.amazon.com/blogs/opensource/developing-microservices-using-container-image-support-for-aws-lambda-and-aws-cdk/)
16. [Introducing tiered pricing for AWS Lambda](https://aws.amazon.com/blogs/compute/introducing-tiered-pricing-for-aws-lambda/)

### CDK 公式 doc + sample
17. [AWS CDK aws-lambda module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html)
18. [DockerImageFunction CDK class](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.DockerImageFunction.html)
19. [DockerImageCode CDK class](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_lambda/DockerImageCode.html)
20. [Introduction to AWS CDK stacks](https://docs.aws.amazon.com/cdk/v2/guide/stacks.html)
21. [aws-samples/aws-cdk-lambda-container](https://github.com/aws-samples/aws-cdk-lambda-container) — Docker image multi-Lambda CDK sample
22. [aws-samples/aws-saas-factory-ref-solution-serverless-saas](https://github.com/aws-samples/aws-saas-factory-ref-solution-serverless-saas) — silo tenant pattern + DOCUMENTATION.md
23. [aws-samples/aws-saas-factory-ref-solution-serverless-saas DOCUMENTATION.md](https://github.com/aws-samples/aws-saas-factory-ref-solution-serverless-saas/blob/main/DOCUMENTATION.md)
24. [AWS Lambda Web Adapter (awslabs)](https://github.com/awslabs/aws-lambda-web-adapter)

### IAM 公式 doc
25. [IAM Permissions Boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)
26. [IAM Policy Evaluation Logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
27. [IAM Access Analyzer](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_generate-policy.html)
28. [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

### CloudFront 公式 doc
29. [CloudFront Cache Behavior settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html)
30. [CloudFront All distribution settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html)
31. [CloudFront Alternate Domain Names (CNAMEs)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html)
32. [CloudFront SSL/TLS Certificate Requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)
33. [CloudFront Distribution Overview](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.html)
34. [CloudFront Use various origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)
35. [CloudFront route requests to specific origins](https://repost.aws/knowledge-center/cloudfront-requests-origins)

### Route 53 + ACM 公式 doc
36. [Route 53 routing to CloudFront](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html)
37. [Route 53 Alias records common values](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-alias-common.html)

### Well-Architected SaaS Lens
38. [SaaS Lens Silo Pool and Bridge Models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html) — silo / pool / bridge 公式定義
39. [Serverless SaaS](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/serverless-saas.html)

### Well-Architected Security Pillar
40. [SEC01-BP01 Separate workloads using accounts](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_securely_operate_multi_accounts.html)
41. [Organizing Your AWS Environment Using Multiple Accounts (whitepaper)](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html)
42. [Recommended OUs and accounts](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/recommended-ous-and-accounts.html) — **Sandbox OU 公式記述**
43. [AWS Account Management Reference](https://docs.aws.amazon.com/accounts/latest/reference/accounts-welcome.html)

### Pricing 公式 page
44. [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
45. [Amazon CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
46. [Amazon CloudFront Pay-as-you-go Pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)
47. [Amazon Route 53 Pricing](https://aws.amazon.com/route53/pricing/)
48. [AWS Certificate Manager Pricing](https://aws.amazon.com/certificate-manager/pricing/)
49. [Amazon ECR Pricing](https://aws.amazon.com/ecr/pricing/)

### SvelteKit + 関連 OSS
50. [SvelteKit Hooks documentation](https://svelte.dev/docs/kit/hooks)
51. [Auth.js for SvelteKit](https://authjs.dev/reference/sveltekit)
52. [tessellator/sveltekit-adapter-lambda](https://github.com/tessellator/sveltekit-adapter-lambda)
53. [@djverrall/sveltekit-lambda-adapter](https://socket.dev/npm/package/@djverrall/sveltekit-lambda-adapter)

### 他社 reference (一次情報源で確認できた範囲のみ)
54. [Stripe Sandboxes doc (logical isolation only)](https://docs.stripe.com/sandboxes)
55. [Stripe Dev Blog: Avoiding test mode tangles with Stripe Sandboxes](https://stripe.dev/blog/avoiding-test-mode-tangles-with-stripe-sandboxes)
56. [Vercel Environments doc](https://vercel.com/docs/deployments/environments)
57. [Atlassian Cloud Architecture and Operational Practices](https://www.atlassian.com/trust/reliability/cloud-architecture-and-operational-practices)
58. [Shopify Engineering: A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale)

### AWS Prescriptive Guidance
59. [Tenant onboarding in SaaS architecture for the silo model using C# and AWS CDK](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/tenant-onboarding-in-saas-architecture-for-the-silo-model-using-c-and-aws-cdk.html)
60. [Building a Multi-Tenant SaaS Solution Using AWS Serverless Services](https://aws.amazon.com/blogs/apn/building-a-multi-tenant-saas-solution-using-aws-serverless-services/)
61. [Building Serverless SaaS Applications on AWS](https://aws.amazon.com/blogs/apn/building-serverless-saas-applications-on-aws/)

---

## 残課題 / 追加調査が必要な領域

本 research でカバーできなかった点 (実装着手後 or 別 Issue):

1. **Lambda Web Adapter の cold start 実測**: 公式 README に数値なし。ganbari-quest production Lambda の CloudWatch metrics で `Init Duration` を観測し ARM64 + Docker image + LWA の baseline 取得が必要 (Phase 1 完了後)
2. **OIDC role permission の動作確認**: 既存 OIDC role が新規 Lambda function + IAM role を deploy できる権限を持つか、CDK synth → diff で事前検証必要
3. **`gq_demo=1` cookie + subdomain の Edge case**: subdomain 採用時に cookie が production にもれない設計を hooks.server.ts level で再確認
4. **demo CloudFront cache policy**: demo Lambda response の cache TTL 設計 (fixture なので長く cache できる、`Cache-Control: max-age=300` 程度推奨だが実装で別途決定)
5. **production E2E matrix の CI 組込**: §11.4 の Phase 2 課題、別 Issue で扱う
6. **ECR image tag 戦略**: production と demo が同じ `latest` tag を共有すると deploy のロールバック挙動が共有される。version tag (`v1.2.3`) を導入して demo / production で別 tag 指定可能にする選択肢あり

---

## 前回 v3 doc との関係

| v3 doc 内容 | 本 v4 doc での扱い |
|---|---|
| §1.1-1.6 他社事例調査 | 本 doc §2.3 で要点のみ再引用、詳細は v3 参照 |
| Stripe / Vercel / Atlassian 主張の検証 | v3 §1 結論を本 doc §2.3 で再確認、新たな矛盾なし |
| 「cost ~$5-15/月」主張 | 本 doc §9.7 で **約 $0-3/月 に訂正** (実数値で過大評価判明) |
| Multi-Lambda 採用是非 | v3 で結論 (採用) 済。本 doc は採用前提で詳細設計 |
| ADR-0010 Pre-PMF scope 整合 | v3 §エグゼクティブサマリー 3 と同じ前提 |

v3 doc は **「採用是非の根拠」**、本 v4 doc は **「採用後の各論実装裏付け」**。両者は補完関係で、Issue #2097 着手前に PO は両方を参照すべき。
