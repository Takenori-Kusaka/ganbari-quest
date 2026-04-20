# 0030. Cognito E2E テストユーザーのライフサイクル基盤

> **Archived (2026-04-20)**: Cognito E2E ユーザライフサイクル。E2E テスト組込済み

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-16 |
| 起票者 | Session PO |
| 関連 Issue | #944（設計）, #945（実装）, #755（account-deletion E2E）, #810（ライセンスキー全ライフサイクル E2E） |
| 関連 ADR | ADR-0013（Cognito + Google OAuth 採用）, ADR-0026（ライセンスキーアーキテクチャ）, ADR-0029（Safety Assertion Erosion Ban） |

## コンテキスト

### なぜいま必要か

#755（account-deletion.spec.ts）や #810（ライセンスキー全ライフサイクル E2E）では、
**サインアップ → 活動記録 → メンバー招待 → 解約 / 削除** まで一気通貫で検証したい。
しかし現行の `tests/e2e/cognito-auth.spec.ts` + `tests/e2e/global-teardown-aws.ts` は、
**事前作成済みの固定アカウント（`e2e-test@ganbari-quest.com` 等）を 1 つだけ使い回す**
設計であり、以下の問題を抱えている。

1. **メール認証回避手段がない**
   - Cognito SelfSignUp → 確認コードがメールに届く → 人手で取り出すか SES インボックスを読むしかない
   - CI で自動実行できない

2. **並列実行時の衝突**
   - 同じ email で複数テストが SelfSignUp すると Cognito が 409 (UsernameExistsException) を返す
   - ワーカー数を増やせない

3. **teardown の不安定性**
   - storageState が壊れると API 削除に失敗、AWS SDK フォールバックもエラー握りつぶしで orphan が残る
   - orphan テナントが積み上がり、次回テストの前提条件を壊す

4. **sign-up フロー自体がテストされていない**
   - 最重要ファネル（無料登録 → 有料転換）の回帰検知が E2E に存在しない

### 現状確認（2026-04-16 時点）

| 要素 | 実装 | 場所 |
|------|------|------|
| 固定ユーザー E2E | あり | `tests/e2e/cognito-auth.spec.ts` |
| cognito-dev モード（JWT 署名だけローカルで済ます） | あり | `src/lib/server/auth/providers/cognito-dev.ts` |
| AWS 本番向け teardown（API or SDK 経由で削除） | あり | `tests/e2e/global-teardown-aws.ts` |
| **動的ユーザー作成ヘルパ** | **なし** | — |
| **Pre Sign-up Lambda（autoConfirm）** | **なし** | — |
| **E2E 用 IAM ロール** | **なし**（CDK 未定義） | — |

## 検討した選択肢

### 選択肢 A: Cognito Admin API バイパス

CI が AWS SDK で `AdminCreateUser(MessageAction: 'SUPPRESS')` +
`AdminSetUserPassword(Permanent: true)` を直接実行し、CONFIRMED 状態のユーザーを即作る。

- **メリット**
  - メール送信ゼロ（SES クォータ消費なし）
  - 数百ms で完了、CI 時間最小
  - UUID ベースの email（`e2e-<run_id>-<worker>-<test>@ganbari-quest.test`）で並列衝突ゼロ
  - 業界標準（Stripe / Auth0 / Clerk 全て同じ方式）
- **デメリット**
  - **sign-up 画面 → 確認コード入力 → ログイン完了** の UI フロー自体はテストされない
  - Admin API 用 IAM 権限（`cognito-idp:AdminCreateUser`）を GitHub Actions に与える必要あり
  - 本番 User Pool を誤って叩いたら実害（IAM ポリシー設計で厳密に防ぐ必要）

### 選択肢 B: テスト用ライセンスキーで verify スキップ

AWS Secrets Manager にテスト用キーを置き、そのキーでサインアップした場合は
Pre Sign-up Lambda が `response.autoConfirmUser = true` を返してメール確認をスキップ。

- **メリット**
  - 実際の SelfSignUp フローを通る（sign-up 画面 / フォームバリデーション / エラーハンドリングまで検証される）
  - 本番 IAM にも `AdminCreateUser` 権限を与えなくてよい
- **デメリット**
  - **Pre Sign-up Lambda に「テストキーなら autoConfirm」という分岐を本体に入れる**のは
    ADR-0029 §④ Goodhart's Law / §① Assertion Erosion に抵触しかねない
    （本番で誤発火したら認可バイパス）
  - テストキーの流出 = 本番で即任意メールアドレス認証スキップ（致命的）
  - Secrets Manager の回転 / rotation 運用負債が増える
  - メール確認コードをメール経由で取得できないので結局 Admin 系 API が必要になる
    → 純度が下がる

### 選択肢 C: ハイブリッド（A 基本 + B を限定運用）

- 通常の CI/PR テスト: **A（Admin API）** で高速・安定に回す
- ナイトリーの「フルファネル」E2E: **別スイート**で SelfSignUp 画面から確認コードを
  SES Inbox (Lambda + S3) で受け取る or 選択肢 B のキー方式で通す
- **デメリット**: 2 系統メンテになりがち。ナイトリー側が育たないと「片肺運用」状態に。

## 決定

### 採用: 選択肢 A（Admin API バイパス）を基本路線とする

ただし、以下の条件を ADR として確定させる。

#### D-1. sign-up 画面自体は通常の cognito-dev モードで検証する

`tests/e2e/cognito-auth.spec.ts` 系列で `/auth/signup` の UI / バリデーション /
エラー分岐は cognito-dev（ローカル JWT 発行）で既にカバーされている。
**Admin API で作ったユーザーは Cognito 本物プールに対する sign-in / tenant 作成 /
Stripe 連携 / アカウント削除** のインテグレーションを検証することに特化する。

#### D-2. 本番 User Pool への Admin API アクセスは IAM で物理禁止

CDK に以下を定義し、ステージング User Pool ARN のみを許可する専用 IAM Role を作る。

```typescript
// infra/lib/auth-stack.ts （E2EStack として切り出し推奨）
const e2eAdminRole = new iam.Role(this, 'E2EAdminRole', {
  roleName: 'ganbari-quest-e2e-admin',
  assumedBy: new iam.WebIdentityPrincipal(
    'arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com',
    {
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      },
      StringLike: {
        'token.actions.githubusercontent.com:sub':
          'repo:Takenori-Kusaka/ganbari-quest:environment:e2e-staging',
      },
    },
  ),
});

e2eAdminRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'cognito-idp:AdminCreateUser',
    'cognito-idp:AdminSetUserPassword',
    'cognito-idp:AdminDeleteUser',
    'cognito-idp:AdminAddUserToGroup',
    'cognito-idp:AdminRemoveUserFromGroup',
    'cognito-idp:AdminGetUser',
  ],
  resources: [stagingUserPool.userPoolArn], // ← production ARN は絶対に含めない
}));
```

- **production User Pool ARN** を含む Resource はここでは書かない。どうしても本番を
  操作したいケースが出たら、別 ADR で supersede 判断する。
- GitHub Actions からは OIDC Web Identity Federation で一時認証（静的 Access Key を置かない）。
- staging User Pool は **新規スタック** `AuthStack-e2e` として独立させる（prod と論理的・物理的に隔離）。

#### D-3. テストユーザー識別規則

email: `e2e-{ISO date}-{git sha 先頭7}-{run_attempt}-{worker}-{uuid短縮}@ganbari-quest.test`

- `.test` TLD なので名前衝突 / 誤送信リスクなし
- sha 入りで「どのコミットが作ったユーザーか」が DB 残骸からも追跡可能
- UUID で同一 run 内の並列衝突を完全排除

#### D-4. クリーンアップは 3 段構え

1. **テストローカル afterEach**: 各 spec が作った user をその場で削除（最優先）
2. **Playwright global-teardown**: run 内で作られたが消し忘れた user を email prefix (`e2e-`) で scan + 削除
3. **nightly janitor Lambda**（新規）: 24h 超過の `e2e-*` user を一掃する保険

nightly janitor は CloudWatch Events + Lambda で週 3 回動かす。実装コストは小さいが、
これを入れておかないと IAM / ネットワーク障害時に orphan が永久に残る。

#### D-5. 実装レイヤの分離

```
tests/e2e/
├── helpers/
│   ├── cognito-admin-client.ts  ← AWS SDK をラップ、staging ARN 固定
│   ├── test-user-factory.ts     ← createTestUser / deleteTestUser / withTestUser
│   └── test-tenant-helpers.ts   ← Stripe Customer / Subscription 付きのテナント生成
├── fixtures/
│   └── cognito-lifecycle.ts     ← Playwright fixtures（test.extend）
└── aws/
    ├── account-deletion.spec.ts ← #755
    ├── license-lifecycle.spec.ts ← #810
    └── signup-happy-path.spec.ts ← 新規（sign-up 回帰）
```

- `test-user-factory.ts` は ADR-0029 §④ の趣旨に従い、**本番 User Pool Id を誤って
  渡したら即 throw** するガードを入れる（`if (poolId.endsWith('-prod')) throw ...`）。
- Playwright fixtures でライフサイクル管理 → test 側では `test('...', async ({ opsUser }) => {...})`
  だけで作成 / 削除が自動化される。

#### D-6. Secrets 配布

Admin API 方式では **シークレット配布は不要**（OIDC で一時認証）。
もし将来的に選択肢 B（ライセンスキー方式）を追加する場合は、ADR-0029 §「新規 env/secret
配布証跡の自動チェック」に従い、PR 本文に配布先表を明記すること。

## 結果

### 得られるもの

- `#945` で `test-user-factory.ts` が実装されれば、`#755` / `#810` が一気に書ける
- 並列 E2E ワーカー数を上げられる（衝突しない）
- sign-up → 活動記録 → 解約 の **業務上最重要ファネル** を CI で毎回検証できる
- Stripe との整合性（subscription cancel → tenant terminate）もテスト可能

### トレードオフ

- staging AuthStack を本番と別に立てる → 月 $1 未満の Cognito 基本料金が追加
- nightly janitor Lambda → Lambda + CloudWatch Events で月 $0.01 未満
- CDK の E2E IAM Role → コスト 0、ただし新規 env/secret 相当なので `infra/CLAUDE.md` 必須 env 表に追加が必要
- 本番 User Pool を誤って操作するリスクが新たに発生 → D-2 の ARN allowlist と
  `test-user-factory.ts` のランタイムガードで二重に防ぐ

### フォローアップ

- [ ] #945（implementation）に本 ADR をリンク
- [ ] `infra/lib/auth-stack.ts` を `AuthStack-prod` / `AuthStack-e2e` の 2 系統化（別 PR）
- [ ] `test-user-factory.ts` 実装時に production guard の単体テストを書く
- [ ] `tests/e2e/global-teardown-aws.ts` を本 ADR D-4 の 3 段構えに合わせて書き直す
- [ ] nightly janitor Lambda を `infra/lambda/` に追加（D-4 保険層）

### 禁止事項

- 本番 User Pool ARN を `E2EAdminRole` の Resource に追加してはならない
- `@ganbari-quest.com` (プロダクションドメイン) の email を E2E テストユーザーに使ってはならない
- Pre Sign-up Lambda に「特定キーならメール認証スキップ」分岐を入れてはならない（ADR-0029 §④）
- Admin API 用の静的 Access Key を GitHub Secrets に保存してはならない（OIDC 一択）

## 参考

- AWS Cognito Admin API: <https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html>
- GitHub OIDC → AWS: <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services>
- ADR-0029 Assertion Erosion Ban — 「テストのためにガードを緩めるな」の原則は本 ADR の D-5 production guard でも適用
