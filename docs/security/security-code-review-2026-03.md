# セキュリティコードレビュー報告書

**プロジェクト**: がんばりクエスト (ganbari-quest)
**レビュー日**: 2026-03-31
**レビュー対象バージョン**: main ブランチ (commit 91d3112)
**レビュー者**: Security Agent (Claude Opus 4.6)
**分類**: Stripe PCI DSS SAQ A コンプライアンス + アプリケーションセキュリティ

---

## 1. レビュー範囲と手法

### 1.1 対象範囲

| カテゴリ | 対象ファイル/ディレクトリ |
|---------|------------------------|
| 認証・認可ミドルウェア | `src/hooks.server.ts` |
| 認証プロバイダ | `src/lib/server/auth/providers/cognito*.ts`, `factory.ts`, `authorization.ts`, `context-token.ts` |
| Stripe 決済連携 | `src/routes/api/stripe/**`, `src/lib/server/stripe/**`, `src/lib/server/services/stripe-service.ts` |
| ログインフロー | `src/routes/auth/login/+page.server.ts`, `signup/+page.server.ts`, `callback/+server.ts` |
| APIエンドポイント | `src/routes/api/v1/**/+server.ts` (全48エンドポイント) |
| ファイルアップロード | `src/routes/api/v1/children/[id]/avatar/+server.ts`, `voices/+server.ts` |
| セキュリティ機構 | `src/lib/server/security/rate-limiter.ts`, `account-lockout.ts` |
| インフラ (CDK) | `infra/lib/*.ts` (auth, compute, network, storage) |
| SvelteKit設定 | `svelte.config.js` |
| OPS管理画面 | `src/routes/ops/**` |

### 1.2 手法

- 静的コード解析（手動レビュー）
- OWASP Top 10 2021 に基づく脆弱性評価
- PCI DSS v4.0 SAQ A 要件との適合性評価
- 認証・認可フローのトレース分析
- インフラセキュリティ設定の確認

### 1.3 脅威モデル概要

本アプリケーションは家庭向けゲーミフィケーション Web アプリであり、以下の脅威アクターを想定する:

- **外部攻撃者**: インターネット経由での不正アクセス、決済データの窃取
- **悪意あるテナントユーザー**: テナント間データ漏洩、権限昇格
- **自動化ボット**: ブルートフォース、クレデンシャルスタッフィング

---

## 2. 検出事項

### 2.1 重大度分類基準

| 重大度 | 定義 |
|--------|------|
| **Critical** | 即座に悪用可能。データ漏洩・決済不正に直結する脆弱性 |
| **High** | 悪用条件は限定的だが、重大な影響を及ぼす可能性がある |
| **Medium** | 防御層の不足。他の脆弱性と組み合わされた場合にリスクが高まる |
| **Low** | セキュリティ上の改善推奨事項。即座のリスクは低い |
| **Info** | ベストプラクティスからの乖離。将来的な改善推奨 |

---

### FINDING-01: SvelteKit CSRF 保護の無効化 [Critical]

**対象ファイル**: `svelte.config.js` (行 12-14)

**説明**:

```javascript
csrf: {
    checkOrigin: false,
},
```

SvelteKit のビルトイン CSRF (Cross-Site Request Forgery) 保護が `checkOrigin: false` で完全に無効化されている。SvelteKit はデフォルトで `Origin` ヘッダーを検証し、クロスオリジンからの POST/PUT/DELETE リクエストを拒否する。この保護が無効化されているため、全てのフォームアクション (`+page.server.ts` の `actions`) および POST API エンドポイントが CSRF 攻撃に対して脆弱である。

**リスク評価**:

- 攻撃者が悪意のあるサイトからユーザーのブラウザを介して、ログイン中のセッションで任意のアクションを実行可能
- 影響範囲: ログインフォーム送信、データ削除、解約申請、Stripe チェックアウト作成、メンバー管理など全 POST アクション
- Stripe SAQ A 要件 6.2（安全なシステムとソフトウェアの開発）に抵触

**推奨対策**:

1. `checkOrigin: true` に変更する（デフォルト値に戻す）
2. Lambda Function URL が CloudFront 経由でアクセスされる構成のため、`Origin` ヘッダーが正しく転送されることを確認する
3. CloudFront の `ALL_VIEWER_EXCEPT_HOST_HEADER` OriginRequestPolicy により Origin は転送されているが、Lambda Function URL のドメインとアプリのドメインが異なる場合の対処として、SvelteKit の `csrf.checkOrigin` を有効にしつつ、必要に応じて明示的なオリジン許可リストを設定する

---

### FINDING-02: OCR レシートエンドポイントの認証欠落 [High]

**対象ファイル**: `src/routes/api/v1/points/ocr-receipt/+server.ts`

**説明**:

OCR レシート読み取りエンドポイント (`POST /api/v1/points/ocr-receipt`) に `requireTenantId()` や `requireRole()` などの認証チェックが存在しない。hooks.server.ts のルート保護ルール (`authorization.ts`) では `/api/v1` パスに対して全ロールの認証を要求しているが、エンドポイント内での明示的な認証検証がなく、`locals.context` が null の場合でもリクエストが処理される可能性がある。

hooks.server.ts の認可チェックが `provider.authorize()` で行われているため実際のリスクは Cognito モードでは hooks によってブロックされるが、ローカルモードでは認証なしで通過する。また、このエンドポイントは Gemini API を呼び出すため、未認証アクセスにより API コストが発生するリスクがある。

**リスク評価**:

- ローカルモード（NUC 環境）では LAN 内からの無制限アクセス可能
- Gemini API の不正利用（コスト攻撃）
- base64 画像を受け取るため、大容量ペイロードによる DoS リスク

**推奨対策**:

```typescript
const tenantId = requireTenantId(locals);
requireRole(locals, ['owner', 'parent']);
```

をエンドポイントの先頭に追加する。

---

### FINDING-03: 週次レポートエンドポイントの認証バイパスリスク [High]

**対象ファイル**: `src/routes/api/v1/admin/weekly-report/+server.ts`

**説明**:

週次レポート送信エンドポイントは `CRON_SECRET` ヘッダーによる認証を使用しているが、以下の問題がある:

1. `CRON_SECRET` が未設定かつ `AUTH_MODE=local` の場合、認証なしでアクセス可能（行 18）
2. `requireTenantId()` が呼ばれていないため、リクエストボディの `tenantId` と `ownerEmail` が完全に信頼されている
3. `CRON_SECRET` の比較が `authHeader !== cronSecret` という文字列直接比較であり、タイミング攻撃に対して脆弱

**リスク評価**:

- 攻撃者が任意のメールアドレスに対してレポートを送信可能（メール爆弾）
- ボディ内の tenantId が検証されていないため、テナント偽装が可能
- タイミング攻撃により CRON_SECRET の推測が理論上可能

**推奨対策**:

1. `crypto.timingSafeEqual()` を用いた定数時間比較を実装する
2. ボディ内の tenantId をサーバー側で検証する
3. local モードでも最低限の認証を要求する

---

### FINDING-04: Context Token の署名比較がタイミング攻撃に脆弱 [Medium]

**対象ファイル**: `src/lib/server/auth/context-token.ts` (行 56)

**説明**:

```typescript
if (signature !== expected) return null;
```

Context Token の HMAC-SHA256 署名検証が JavaScript の `!==` 演算子による文字列比較で行われている。この比較は短絡評価により、一致しない最初のバイトで即座に結果を返すため、応答時間の差分から署名を 1 バイトずつ推測するタイミング攻撃が理論上可能である。

**リスク評価**:

- Context Token はサーバーサイドのみで使用され、Cookie 経由で送受信される
- Lambda 環境ではネットワークジッターが大きいため、実用的な攻撃は困難
- ただし、セキュリティのベストプラクティスとして定数時間比較が推奨される

**推奨対策**:

```typescript
import { timingSafeEqual } from 'node:crypto';

const sigBuffer = Buffer.from(signature, 'base64url');
const expectedBuffer = Buffer.from(expected, 'base64url');
if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
}
```

---

### FINDING-05: OPS ダッシュボードの URL パラメータによるトークン漏洩 [Medium]

> **ステータス**: ✅ Resolved（#820 / ADR-0033）— `/ops` は Cognito ops group 認可に刷新され、
> URL パラメータ / `ops_token` Cookie / `OPS_SECRET_KEY` 平文 Bearer は全廃された。

**対象ファイル**: `src/routes/ops/+layout.server.ts` (行 24-36)

**説明**:

OPS ダッシュボードは `?token=<secret>` による URL パラメータでの認証をサポートしている。このトークンはブラウザの履歴、アクセスログ、リファラーヘッダー、プロキシログなどに記録される可能性がある。

```typescript
const tokenParam = url.searchParams.get('token');
if (tokenParam === secret) {
    cookies.set('ops_token', secret, { ... });
    return {};
}
```

さらに、`ops_token` Cookie の値に `OPS_SECRET_KEY` の平文が直接保存されており、Cookie が漏洩した場合にシークレット自体が露出する。

**リスク評価**:

- URL パラメータ内のシークレットがブラウザ履歴、Referer ヘッダー、CloudFront アクセスログに残存
- Cookie の値がシークレットそのものであり、Cookie 漏洩時のリスクが高い
- OPS ダッシュボードは `isPublicRoute()` で公開ルート扱い（行 131: `path.startsWith('/ops')`）

**推奨対策**:

1. URL パラメータでのトークン受け渡しを廃止し、ログインフォーム方式に変更する
2. Cookie にはシークレット自体ではなく、署名付きセッショントークンを保存する
3. 初回アクセス後に `?token=` を除去するリダイレクトを実装する
4. `isPublicRoute()` から `/ops` を除外し、hooks レベルで認証をチェックする

---

### FINDING-06: OPS ダッシュボードの認証バイパス（公開ルート分類） [Medium]

> **ステータス**: ✅ Resolved（#820 / ADR-0033）— `/ops` は `isPublicRoute()` から除外され、
> `+layout.server.ts` が Cognito ops group メンバー判定を行う。`/ops/export/+server.ts` 等の
> 子ルートも同じ group 判定ロジックを通過する前提に再構成された。

**対象ファイル**: `src/lib/server/auth/authorization.ts` (行 131)

**説明**:

```typescript
function isPublicRoute(path: string): boolean {
    return (
        // ...
        path.startsWith('/ops')
    );
}
```

`/ops` パスが `isPublicRoute()` に含まれているため、hooks.server.ts の Cognito 認可チェックが完全にバイパスされる。OPS ダッシュボードの認証は `+layout.server.ts` のみに依存しており、`Bearer` トークンか Cookie でのみ保護されている。

`/ops/export` エンドポイント (`+server.ts`) は layout.server.ts の `load()` による認証チェックを通過しない可能性がある。SvelteKit では `+server.ts` は `+layout.server.ts` の `load()` を実行しないため、`/ops/export` への直接 API アクセスは OPS 認証をバイパスする。

**リスク評価**:

- `/ops/export` エンドポイントへの未認証アクセスにより、売上データ・AWS コストデータが漏洩する可能性
- Stripe の顧客情報（Invoice データ）が含まれる場合、PCI DSS 関連の問題となる

**推奨対策**:

1. `/ops/export/+server.ts` に OPS_SECRET_KEY の認証チェックを追加する
2. hooks.server.ts に `/ops` パス専用の認証ロジックを追加する
3. `isPublicRoute()` から `/ops` を除外する

---

### FINDING-07: ログアウトが GET リクエストで実行可能 [Medium]

**対象ファイル**: `src/routes/auth/logout/+server.ts` (行 37-39)

**説明**:

```typescript
export const GET: RequestHandler = async ({ cookies }) => {
    handleLogout(cookies);
};
```

ログアウトが GET リクエストで実行可能であるため、以下の攻撃ベクトルが存在する:

- `<img src="/auth/logout">` タグを含む外部サイトにアクセスするだけでログアウトが強制される
- メールやチャット内のリンクによるソーシャルエンジニアリング
- CSRF 保護が無効化されている (FINDING-01) と合わせて、攻撃が容易

**リスク評価**:

- ユーザーの意図しないセッション破棄
- CSRF 保護無効と組み合わせた場合、サービス妨害につながる

**推奨対策**:

1. GET ハンドラーを削除し、POST のみでログアウトを処理する
2. ログアウトリンクをフォーム送信に変更する

---

### FINDING-08: Email OTP ストアのインメモリ実装（Lambda 環境での制約） [Medium]

**対象ファイル**: `src/lib/server/services/email-otp-service.ts` (行 12)

**説明**:

Email OTP のセッションストアがプロセス内メモリ (`Map`) で管理されている。Lambda 環境では複数の同時実行インスタンスが存在するため、OTP の送信と検証が異なるインスタンスで処理された場合、検証が常に失敗する。

コード内のコメント（行 10-12）で「Lambda warm instance で十分」と記載されているが、`reservedConcurrentExecutions: 100` が設定されており（compute-stack.ts 行 71）、複数インスタンスの同時実行が発生し得る。

**リスク評価**:

- OTP 検証の信頼性が低下し、ユーザーがログインできない可能性
- セキュリティ上は「検証が緩くなる」方向のリスクではないが、ユーザー体験と認証フローの信頼性に影響

**推奨対策**:

DynamoDB に OTP セッションを保存する実装に移行する。account-lockout.ts と同様のパターンで TTL 付きのレコードを使用する。

---

### FINDING-09: インメモリレートリミッターの分散環境における無効性 [Medium]

**対象ファイル**: `src/lib/server/security/rate-limiter.ts`

**説明**:

レートリミッターがプロセス内メモリ (`Map`) で実装されている。Lambda 環境では:

1. 各 Lambda インスタンスが独立したレートリミットカウンターを持つ
2. `reservedConcurrentExecutions: 100` により、攻撃者は新しいインスタンスにルーティングされることでレートリミットを回避できる
3. Lambda のコールドスタート時にカウンターがリセットされる

**リスク評価**:

- ブルートフォース攻撃やクレデンシャルスタッフィングに対する防御が不十分
- 認証レートリミット (10 req/min) が実質的に機能しない可能性
- ただし、account-lockout.ts が DynamoDB ベースで実装されているため、ログイン試行に対する防御は account-lockout 側で担保されている

**推奨対策**:

1. CloudFront の AWS WAF を導入し、IP ベースのレートリミットを CDN レベルで実装する
2. または DynamoDB ベースのレートリミッターに移行する（account-lockout と同様のパターン）
3. 現状、account-lockout が DynamoDB で永続化されている点は良好。API レートリミットについても同様のアプローチを検討する

---

### FINDING-10: Content-Security-Policy ヘッダーの未設定 [Medium]

**対象ファイル**: `src/hooks.server.ts`

**説明**:

hooks.server.ts のセキュリティヘッダー設定で以下のヘッダーは設定されているが:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security` (cognito モード時)

**Content-Security-Policy (CSP) ヘッダーが設定されていない。** CSP は XSS 攻撃に対する最も強力な防御の一つであり、インライン JavaScript の実行やスクリプトソースの制限により、XSS の影響を大幅に軽減する。

**注記**: CloudFront の `ResponseHeadersPolicy.SECURITY_HEADERS` がデフォルトの CSP を提供する可能性があるが、アプリケーション固有の CSP ポリシーを明示的に設定すべきである。

**リスク評価**:

- XSS 脆弱性が発見された場合の影響を軽減する防御層が欠如
- PCI DSS 要件 6.2（安全なシステムとソフトウェアの開発）のベストプラクティス

**推奨対策**:

```typescript
response.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Tailwind/Svelte で必要
    "img-src 'self' data: https://*.amazonaws.com",
    "connect-src 'self' https://checkout.stripe.com",
    "frame-src https://checkout.stripe.com https://js.stripe.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; '));
```

---

### FINDING-11: Stripe Checkout の success_url に CHECKOUT_SESSION_ID が含まれる [Low]

**対象ファイル**: `src/routes/api/stripe/checkout/+server.ts` (行 29)

**説明**:

```typescript
successUrl: `${origin}/admin/license?session_id={CHECKOUT_SESSION_ID}`,
```

Checkout Session ID が URL パラメータとしてブラウザに渡される。この値はブラウザ履歴やアクセスログに記録される。ただし、Stripe のセッション ID は短命であり、決済後は読み取り専用のため、直接的なリスクは低い。

**リスク評価**:

- Stripe 推奨のパターンに沿っており、直接的なセキュリティリスクは限定的
- session_id の検証がサーバー側で行われていることを確認済み

**推奨対策**:

現状の実装で問題なし。Stripe 公式の推奨パターンに準拠している。

---

### FINDING-12: 開発モードのハードコードされた認証情報 [Low]

**対象ファイル**: `src/lib/server/auth/providers/cognito-dev.ts` (行 26-48)

**説明**:

開発用のダミーユーザー認証情報がソースコードにハードコードされている:

```typescript
export const DEV_USERS: DevUser[] = [
    { email: 'owner@example.com', password: 'Gq!Dev#Owner2026x', ... },
    { email: 'parent@example.com', password: 'Gq!Dev#Parent2026', ... },
    { email: 'child@example.com', password: 'Gq!Dev#Child2026x', ... },
];
```

**リスク評価**:

- `COGNITO_DEV_MODE=true` が本番環境で設定された場合、これらの認証情報でログイン可能
- 本番環境では `COGNITO_DEV_MODE` は未設定のため、直接的なリスクは低い
- ただし、環境変数の設定ミスが発生した場合の影響は大きい

**推奨対策**:

1. `isProduction` フラグによる二重チェックを追加する
2. Lambda 環境（`AWS_LAMBDA_FUNCTION_NAME` が設定されている場合）では dev モードを強制的に無効化する

---

### FINDING-13: Lambda Function URL の公開アクセス設定 [Low]

**対象ファイル**: `infra/lib/compute-stack.ts` (行 125-128)

**説明**:

```typescript
this.functionUrl = this.fn.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.NONE,
    invokeMode: lambda.InvokeMode.BUFFERED,
});
```

Lambda Function URL が `AuthType.NONE` で公開されている。CloudFront を経由させる設計であるが、Function URL 自体は直接アクセス可能である。

**リスク評価**:

- Function URL のドメイン (`xxx.lambda-url.us-east-1.on.aws`) を知っていれば、CloudFront の IP 制限やキャッシュポリシーをバイパスしてアクセス可能
- CloudFront Functions で実装されている Admin IP 制限がバイパスされる

**推奨対策**:

1. Lambda Function URL に IAM 認証を追加し、CloudFront の Origin Access Control (OAC) 経由でのみアクセスを許可する
2. または、Lambda の Resource-based policy で CloudFront の Distribution ID からのアクセスのみを許可する

---

### FINDING-14: DynamoDB の Point-in-Time Recovery (PITR) が無効 [Low]

**対象ファイル**: `infra/lib/storage-stack.ts` (行 25)

**説明**:

```typescript
pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
```

DynamoDB の PITR が無効化されている。代わりに AWS Backup による日次バックアップ（3日間保持）が設定されている。PITR は秒単位での復旧が可能であり、悪意のある削除や誤操作からの回復に有効である。

**リスク評価**:

- 日次バックアップの間隔（最大24時間）のデータ損失リスク
- コスト面での判断と理解するが、PCI DSS 要件 10 (アクセスのトラッキングとモニタリング) の観点から、より細かい粒度の復旧オプションが望ましい

**推奨対策**:

PITR の有効化を検討する。DynamoDB の PITR コストは比較的低い（テーブルサイズの 20% 程度の追加コスト）。

---

### FINDING-15: CloudFront のジオリストリクション（日本のみ） [Info - 良好]

**対象ファイル**: `infra/lib/network-stack.ts` (行 195)

**説明**:

```typescript
geoRestriction: cloudfront.GeoRestriction.allowlist('JP'),
```

日本国外からのアクセスを CloudFront レベルでブロックしている。家庭向けアプリとして適切な設定であり、海外からの攻撃を大幅に削減する。

**評価**: 良好。

---

### FINDING-16: Stripe Webhook 署名検証の実装 [Info - 良好]

**対象ファイル**: `src/routes/api/stripe/webhook/+server.ts`, `src/lib/server/services/stripe-service.ts`

**説明**:

Stripe Webhook の署名検証が `stripe.webhooks.constructEvent()` を使用して正しく実装されている。これにより:

- HMAC-SHA256 による署名検証
- タイムスタンプ検証（リプレイ攻撃防止、300秒以内）
- `stripe-signature` ヘッダーがない場合の即時拒否

**評価**: 良好。PCI DSS SAQ A 要件に準拠。

---

### FINDING-17: Cognito JWT 検証の実装 [Info - 良好]

**対象ファイル**: `src/lib/server/auth/providers/cognito-jwt.ts`

**説明**:

`jose` ライブラリを使用した Cognito ID Token の検証が適切に実装されている:

- JWKS (JSON Web Key Set) によるリモートキー検証
- `issuer` (Cognito User Pool URL) の検証
- `audience` (Client ID) の検証
- `token_use: 'id'` の明示的チェック

**評価**: 良好。

---

### FINDING-18: アカウントロックアウトの DynamoDB 永続化実装 [Info - 良好]

**対象ファイル**: `src/lib/server/security/account-lockout.ts`

**説明**:

ログイン失敗回数のカウントと lockout 状態が DynamoDB に永続化されており、Lambda の分散環境でも正しく機能する。10回の失敗で30分のロックアウトが実装されている。

**評価**: 良好。PCI DSS 要件 8.1.6 に準拠。

---

### FINDING-19: 二層セッションモデルの設計 [Info - 良好]

**対象ファイル**: `src/lib/server/auth/types.ts`, `src/lib/server/auth/providers/cognito.ts`

**説明**:

Identity (誰であるか) と Context (何として操作しているか) を分離した二層セッションモデルが採用されている。Context Token は HMAC-SHA256 で署名され、サーバーサイドで検証される。この設計により:

- テナント ID がサーバー側で制御され、クライアントからの改ざんが不可能
- ロール (owner/parent/child) がサーバー側で検証される
- Context Token の有効期限がロール別に設定されている (parent: 30分, owner/child: 24時間)

**評価**: 良好。マルチテナントアーキテクチャとして適切。

---

### FINDING-20: Cookie セキュリティ設定 [Info - 良好]

**対象ファイル**: `src/lib/server/auth/providers/cognito-oauth.ts`, `src/lib/server/cookie-config.ts`

**説明**:

認証関連の Cookie は以下の設定で保護されている:

- `httpOnly: true` (JavaScript からのアクセス防止)
- `sameSite: 'lax'` (クロスサイトリクエスト制限)
- `secure: true` (Lambda 環境で HTTPS 強制)
- 適切な `maxAge` 設定

**評価**: 良好。ただし FINDING-01 の CSRF 保護無効化と合わせると、`sameSite: 'lax'` だけでは POST リクエストに対する CSRF 保護が不十分。

---

## 3. Stripe PCI DSS SAQ A コンプライアンス評価

### 3.1 SAQ A 適用条件の確認

SAQ A は以下の条件を満たす加盟店に適用される:

| 条件 | 本アプリの状況 | 適合 |
|------|--------------|------|
| カード情報を直接処理・保存・送信しない | Stripe Checkout (ホスト型決済ページ) を使用。カード情報はアプリケーションに一切触れない | OK |
| 決済処理は PCI DSS 準拠の第三者に完全に委託 | Stripe が PCI DSS Level 1 Service Provider として認定済み | OK |
| アプリケーション内にカード入力フォームがない | Stripe Checkout のリダイレクト方式を使用 | OK |
| Webhook でカード情報を受信しない | Webhook で受信するデータは Event メタデータのみ（顧客ID、サブスクリプションID等） | OK |

**判定: SAQ A の適用条件を満たしている。**

### 3.2 SAQ A 要件別チェック

| SAQ A 要件 | 説明 | 状況 | 対応 |
|-----------|------|------|------|
| 2.1 | ベンダーデフォルトパスワードの変更 | Cognito パスワードポリシー設定済み。開発用パスワードは本番では無効 | OK |
| 6.2 | 安全なシステムとソフトウェアの開発 | **CSRF 保護の無効化 (FINDING-01)、認証欠落エンドポイント (FINDING-02, 03) を修正する必要あり** | 要修正 |
| 6.5 | 一般的なコーディング脆弱性への対処 | XSS: Svelte の自動エスケープ + `@html` の使用は限定的。CSRF: 要修正。SQLi: ORM 使用で対処 | 条件付OK |
| 8.1 | ユーザーの識別と認証 | Cognito Email/Password + MFA (TOTP) + Email OTP。アカウントロックアウト実装済み | OK |
| 8.1.6 | 6回以下のアクセス試行でアカウントロック | 10回でロック（推奨は6回以下） | 要検討 |
| 9 | カード会員データへの物理的アクセス制限 | AWS Lambda (サーバーレス) のため物理アクセス制御は AWS 側で担保 | OK |
| 11.2 | ネットワーク脆弱性スキャン | 未確認。外部脆弱性スキャンの定期実行を推奨 | 推奨 |
| 12.1 | 情報セキュリティポリシーの策定 | セキュリティ設計書が docs/design/ に未作成 (チケット #0141 で要作成と記載) | 要作成 |

### 3.3 Stripe 統合のセキュリティ評価

| チェック項目 | 結果 |
|------------|------|
| Stripe Secret Key はサーバーサイドのみで使用 | OK: `$lib/server/stripe/client.ts` で環境変数から取得 |
| Secret Key がクライアントに露出しない | OK: `+server.ts` 内のみで使用 |
| Webhook 署名検証の実装 | OK: `stripe.webhooks.constructEvent()` 使用 |
| Checkout Session の tenantId はサーバー側で設定 | OK: `requireTenantId(locals)` から取得 |
| Customer Portal の tenantId はサーバー側で設定 | OK: `requireTenantId(locals)` から取得 |
| Stripe API バージョンの固定 | OK: `apiVersion: '2026-03-25.dahlia'` |
| Checkout Session の有効期限設定 | OK: 30分 (`expires_at`) |
| Trial abuse prevention | OK: `trialUsedAt` によるトライアル1回制限 |
| ロールベースアクセス制御 | OK: `owner`/`parent` のみ決済操作可能 |

---

## 4. セキュリティ体制の総合評価

### 4.1 良好な点

1. **認証アーキテクチャ**: Cognito + 二層セッションモデル + Email OTP の多層防御が実装されている
2. **Stripe 統合**: SAQ A レベルに適した Checkout Session 方式で、サーバーサイドでの署名検証が正しく実装されている
3. **アカウントロックアウト**: DynamoDB ベースで Lambda 分散環境に対応した永続化実装
4. **テナント分離**: tenantId がサーバー側の署名付きトークンから取得され、改ざん不可能
5. **Zod によるスキーマ検証**: API 入力のバリデーションが体系的に実装されている
6. **セキュリティヘッダー**: X-Frame-Options, X-Content-Type-Options, HSTS 等が設定されている
7. **CloudFront ジオリストリクション**: 日本国内のみへのアクセス制限
8. **管理画面 IP 制限**: CloudFront Functions による Admin IP 許可リスト

### 4.2 改善が必要な点（優先度順）

| 優先度 | Finding | 概要 | 修正工数 |
|--------|---------|------|---------|
| 1 (最優先) | FINDING-01 | CSRF 保護の再有効化 | 小 |
| 2 | FINDING-02 | OCR エンドポイントへの認証追加 | 小 |
| 3 | FINDING-03 | 週次レポートの認証強化 | 小 |
| 4 | FINDING-06 | OPS export エンドポイントの認証追加 | 小 |
| 5 | FINDING-10 | CSP ヘッダーの追加 | 中 |
| 6 | FINDING-04 | タイミングセーフ比較の実装 | 小 |
| 7 | FINDING-05 | OPS トークン管理の改善 | 中 |
| 8 | FINDING-07 | GET ログアウトの廃止 | 小 |
| 9 | FINDING-08 | Email OTP の DynamoDB 移行 | 中 |
| 10 | FINDING-09 | レートリミッターの分散対応 | 中 |

### 4.3 検出事項のサマリー

| 重大度 | 件数 |
|--------|------|
| Critical | 1 |
| High | 2 |
| Medium | 6 |
| Low | 4 |
| Info (良好) | 7 |

---

## 5. Stripe SAQ A 準備状況の結論

**判定: 条件付き準拠 (Conditionally Compliant)**

本アプリケーションの Stripe 統合は SAQ A の技術的要件を概ね満たしているが、以下の修正が SAQ A 適合の前提条件となる:

### 必須修正事項（SAQ A 準拠のため）

1. **CSRF 保護の再有効化** (FINDING-01) — SAQ A 要件 6.2/6.5 に直接関連
2. **認証欠落エンドポイントの修正** (FINDING-02, 03) — 要件 6.5 のアクセス制御
3. **OPS エンドポイントの認証修正** (FINDING-06) — 売上データ保護

### 推奨修正事項（セキュリティ強化のため）

4. CSP ヘッダーの追加 (FINDING-10)
5. タイミングセーフ比較 (FINDING-04)
6. ロックアウト閾値の引き下げ (10回 -> 6回、PCI DSS 要件 8.1.6 推奨値)
7. セキュリティ設計書の作成 (チケット #0141)
8. 外部脆弱性スキャンの定期実施

上記の必須修正事項 3 件はいずれも小規模な修正で対応可能であり、修正完了後は SAQ A レベルの準拠が達成できると評価する。

---

## 付録 A: レビュー対象ファイル一覧

<details>
<summary>全対象ファイル (クリックして展開)</summary>

**認証・認可:**
- `src/hooks.server.ts`
- `src/lib/server/auth/factory.ts`
- `src/lib/server/auth/types.ts`
- `src/lib/server/auth/authorization.ts`
- `src/lib/server/auth/context-token.ts`
- `src/lib/server/auth/providers/cognito.ts`
- `src/lib/server/auth/providers/cognito-jwt.ts`
- `src/lib/server/auth/providers/cognito-oauth.ts`
- `src/lib/server/auth/providers/cognito-direct-auth.ts`
- `src/lib/server/auth/providers/cognito-dev.ts`
- `src/lib/server/security/rate-limiter.ts`
- `src/lib/server/security/account-lockout.ts`
- `src/lib/server/services/email-otp-service.ts`

**Stripe 決済:**
- `src/routes/api/stripe/checkout/+server.ts`
- `src/routes/api/stripe/webhook/+server.ts`
- `src/routes/api/stripe/portal/+server.ts`
- `src/lib/server/stripe/client.ts`
- `src/lib/server/stripe/config.ts`
- `src/lib/server/services/stripe-service.ts`

**認証フロー:**
- `src/routes/auth/login/+page.server.ts`
- `src/routes/auth/signup/+page.server.ts`
- `src/routes/auth/callback/+server.ts`
- `src/routes/auth/logout/+server.ts`
- `src/routes/auth/invite/[code]/+page.server.ts`

**API エンドポイント:**
- `src/routes/api/v1/activities/+server.ts`
- `src/routes/api/v1/images/+server.ts`
- `src/routes/api/v1/import/+server.ts`
- `src/routes/api/v1/export/+server.ts`
- `src/routes/api/v1/children/[id]/avatar/+server.ts`
- `src/routes/api/v1/children/[id]/voices/+server.ts`
- `src/routes/api/v1/points/ocr-receipt/+server.ts`
- `src/routes/api/v1/data/clear/+server.ts`
- `src/routes/api/v1/admin/weekly-report/+server.ts`
- `src/routes/api/v1/admin/invites/+server.ts`
- `src/routes/api/v1/admin/members/leave/+server.ts`
- `src/routes/api/v1/admin/tenant/cancel/+server.ts`
- `src/routes/api/v1/admin/tenant/reactivate/+server.ts`
- `src/routes/api/v1/activities/import/+server.ts`

**OPS ダッシュボード:**
- `src/routes/ops/+layout.server.ts`
- `src/routes/ops/export/+server.ts`

**インフラ:**
- `infra/lib/auth-stack.ts`
- `infra/lib/compute-stack.ts`
- `infra/lib/network-stack.ts`
- `infra/lib/storage-stack.ts`

**設定:**
- `svelte.config.js`
- `src/lib/domain/validation/auth.ts`
- `src/lib/server/cookie-config.ts`
- `src/lib/server/errors.ts`

</details>

---

## 付録 B: 用語集

| 用語 | 説明 |
|------|------|
| SAQ A | Self-Assessment Questionnaire A. カード情報を直接処理しない加盟店向けの PCI DSS 簡易評価 |
| CSRF | Cross-Site Request Forgery. 偽装されたリクエストによる不正操作 |
| CSP | Content-Security-Policy. ブラウザにリソースの読み込み元を制限するヘッダー |
| HMAC | Hash-based Message Authentication Code. 鍵付きハッシュによるメッセージ認証 |
| JWKS | JSON Web Key Set. JWT 署名検証用の公開鍵セット |
| PITR | Point-in-Time Recovery. DynamoDB の秒単位の復旧機能 |
| WAF | Web Application Firewall. Web アプリケーション向けのファイアウォール |

---

*本報告書は 2026-03-31 時点のコードベースに基づく静的レビューの結果です。ペネトレーションテストや動的テストは含まれていません。*
