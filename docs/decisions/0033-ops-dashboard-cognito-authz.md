# 0033. /ops ダッシュボード認可を Cognito ops group ベースに刷新（OPS_SECRET_KEY 廃止）

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-16 |
| 起票者 | Takenori Kusaka |
| 関連 Issue | #820 |
| 関連 PR | PR-A (Identity.groups 拡張) / PR-B (ops_audit_log 監査基盤) / PR-C (/ops auth Cognito 切替 + CDK group) / PR-D (OPS_SECRET_KEY 廃止 + cron 再命名) |

## コンテキスト

`/ops` 管理者ダッシュボードは従来、環境変数 `OPS_SECRET_KEY` を
Bearer token / cookie / URL token で検証するシンプルな shared-secret 認証で守られていた
（`src/routes/ops/+layout.server.ts`, PR #0176）。

この方式には以下の問題がある。

1. **監査証跡なし**: 誰が `/ops` にアクセスし、どの操作を実行したかのログがない。
   侵害発生時にスコープ特定ができず、SOC2/ISO27001 等の将来監査要件を満たせない。
2. **ローテーション困難**: 単一 secret なので、担当者退職・漏洩時に全員同時ローテーションが必要。
   実務では「鍵の使い回し」「ローテーション遅延」が発生しがち。
3. **粒度が無い**: ops メンバー間で「読み取りのみ」「書き込み可」の区別ができない。
4. **Cognito と二重管理**: アプリ本体は Cognito User Pool で認証しているのに、
   /ops だけ別系統 secret を使っており、運用上の複雑さが蓄積する。
5. **cron エンドポイントとの共有**: `OPS_SECRET_KEY` は `/api/cron/retention-cleanup` の
   Bearer 認証にも流用されており、「/ops 管理者権限 = cron エンドポイント呼び出し権限」という
   概念的に無関係な 2 つの責務が同じ鍵に紐付いていた。

一方で、本プロジェクトはすでに Cognito User Pool + Google OAuth (ADR-0013) を採用しており、
Cognito Groups は User Pool 配下で「`ops` group メンバーのみを許可」という明示的な
アクセス制御ができる。claims に `cognito:groups` が入るため、アプリ層での権限判定も容易。

## 検討した選択肢

### 選択肢 A: `OPS_SECRET_KEY` を維持（現状維持）

- メリット: 実装変更ゼロ、オペレーション変化なし
- デメリット: 上記の課題がすべて残り、将来監査・コンプライアンス要件を満たさない。
  技術債務が蓄積し続ける

### 選択肢 B: Cognito ops group + `isOpsMember(identity)` 判定に刷新（採用）

- メリット:
  - Cognito User Pool console で ops メンバーを個別に追加/削除でき、監査証跡が残る
  - Google OAuth で SSO 化している実ユーザーが `/ops` にアクセスする流れが自然
  - 将来 `ops-reader` / `ops-writer` 等の粒度分割が容易
  - CloudTrail に「XXX user was added to ops group」等の管理イベントが残る
- デメリット:
  - Cognito User Pool に `ops` group を CDK で作る必要がある（`infra/lib/auth-stack.ts`）
  - 開発環境（`COGNITO_DEV_MODE=true`）では Cognito 実体がないため、
    `DEV_USERS` に `groups: ['ops']` 持ちのダミーユーザーを追加する必要がある
  - 既存の cron エンドポイント認証 (`/api/cron/retention-cleanup`) は Cognito claims を持たない
    EventBridge 呼び出しなので、shared secret 方式を維持する必要がある
    → `OPS_SECRET_KEY` を `CRON_SECRET` に概念分離・リネーム

### 選択肢 C: AWS IAM Identity Center (旧 SSO) に移行

- メリット: エンタープライズ級のアクセス制御、組織的な RBAC
- デメリット: 個人開発段階では過剰。Cognito User Pool との二重 IdP 運用になる

## 決定

**選択肢 B を採用**。以下の PR 群で段階的に実装する。

### PR-A: Identity.groups 拡張 + ops group 定数
- `src/lib/server/auth/types.ts` の `Identity` 型に `groups?: string[]` を追加
- `src/lib/server/auth/ops-authz.ts` に `OPS_GROUP = 'ops'` 定数と
  `isOpsMember(identity)` ヘルパーを新設
- Cognito JWT の `cognito:groups` claim を `groups` にマップ

### PR-B: ops_audit_log 監査基盤
- DynamoDB `ops_audit_log` テーブル + `ops-audit-service` 新設
- `/ops` 配下の全 write API に監査ログ記録を差し込む準備

### PR-C: /ops 認可を Cognito group に切替
- `src/routes/ops/+layout.server.ts` を `isOpsMember(locals.identity)` ベースに書き換え
- 非メンバーは 403 Forbidden
- `infra/lib/auth-stack.ts` に `cognito.CfnUserPoolGroup('ops')` 追加
- 開発用 `DEV_USERS` に `groups: ['ops']` 持ちのダミーユーザー (`ops@example.com`) 追加
- ユニットテスト（identity=null / local / 各 group パターン）

### PR-D: OPS_SECRET_KEY の cron 専用鍵への概念分離
- `/api/cron/retention-cleanup/+server.ts` の Bearer 認証を `CRON_SECRET` に改名
- 移行期間中は `OPS_SECRET_KEY` を後方互換フォールバックとして受け入れる
  - `const secret = process.env.CRON_SECRET ?? process.env.OPS_SECRET_KEY`
- `infra/lib/compute-stack.ts` が両方の env を Lambda に注入
- `.github/workflows/deploy.yml` が両方の CDK context を渡す
- `.env.example` / `docs/design/` 各所のラベルを更新
- 本 ADR (0033) を新設

### 将来の PR-D-2（本 ADR に含む運用計画）
- 本番 GitHub Secrets `CRON_SECRET` を `OPS_SECRET_KEY` と同値でセット済みであることを確認
- 3 ヶ月以上本番で `CRON_SECRET` 主系・`OPS_SECRET_KEY` フォールバックの両方で 200 が返ることを
  ログで確認した後、`OPS_SECRET_KEY` 参照を全削除
- GitHub Secret `OPS_SECRET_KEY` を削除

## 配布済み env / secret (ADR-0029)

- 配布済み: `CRON_SECRET` → GitHub Actions Secrets（`deploy.yml` が CDK context `cronSecret` として参照、
  compute-stack が Lambda env `CRON_SECRET` として注入）
- 後方互換配布: `OPS_SECRET_KEY` → GitHub Actions Secrets（既存のまま。移行期間中は引き続き両方を注入）

> PR-D 自体は `assertCronSecretConfigured()` 相当の throw 型 guard を追加しない
> （`error(404)` で endpoint を秘匿するだけ）。したがって ADR-0029 の検出パターンには
> 該当しないが、将来 guard を追加する場合は本 ADR の「配布済み」節を参照することで
> 配布状況をトレースできる。

## 結果

### 変わること

- `/ops` にアクセスするには Cognito User Pool の `ops` group に所属する必要がある
  （email/password + Google OAuth いずれも可）
- `/ops` 内の操作は `ops_audit_log` に userId 付きで記録される（PR-B 以降）
- `/api/cron/retention-cleanup` の認証 env は `CRON_SECRET` が正（ただし移行期は `OPS_SECRET_KEY` も可）
- 開発環境では `ops@example.com` / `Gq!Dev#Ops2026xyz` でログインすると `/ops` にアクセス可能

### 運用上のアクション（PO 必須）

1. **Cognito User Pool で ops group を作成** （PR-C デプロイで CDK が自動作成）
2. **ops メンバーを group に追加**:
   ```bash
   aws cognito-idp admin-add-user-to-group \
     --user-pool-id <pool-id> \
     --username <email> \
     --group-name ops
   ```
3. **GitHub Secret `CRON_SECRET` を登録**:
   ```bash
   # 同じ値を OPS_SECRET_KEY と共有してよい（移行期間中）
   gh secret set CRON_SECRET --body "$(gh secret list --json name,value | jq -r '.[] | select(.name=="OPS_SECRET_KEY") | .value')" --repo Takenori-Kusaka/ganbari-quest
   ```
   または新規に `openssl rand -hex 32` で生成して登録
4. **PR-D-2 実施判断**（3 ヶ月後）: ログで `CRON_SECRET` のみで動作確認できたら
   `OPS_SECRET_KEY` を全削除する PR を作成

### トレードオフ

- Cognito User Pool 管理の習熟が必要（特に group 運用）
- 開発環境での ops ユーザーの認証は `DEV_USERS` ハードコードなので、実 Cognito と挙動差分がある
- 後方互換フォールバックを消すまでは、鍵の実質ローテーションは両方を同時に更新する必要がある
  （PR-D-2 で解消）

## 参考

- ADR-0013: Cognito + Google OAuth 認証
- ADR-0029: Safety Assertion Erosion Ban（env 配布証跡）
- Issue #820: [HIGH] Phase 1: /ops 認可を Cognito ops group ベースに刷新（OPS_SECRET_KEY 廃止）
