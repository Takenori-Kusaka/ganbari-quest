# 0066 OAuth認証・家族共有機能

### ステータス

`In Progress`

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 2: 要件定義・開発 |
| 難易度 | 最高（アーキテクチャ設計の根幹） |
| 優先度 | 最高 |
| 要件番号 | 8 |
| 依存チケット | #0064（AWSインフラ）、#0065（マルチテナント設計） |
| 規定書対応 | 第3章 セキュリティ設計書（認証・認可） |

---

### 概要

SaaS版の顧客認証基盤として、OAuth（Google/Apple Sign-In）を実装する。家族内での共有アクセスの仕組みもぴよログ等を参考に設計する。

### 背景・動機

- ~~Email/パスワード認証はサポートしない~~ → **Cognito ネイティブ Email/Password を主軸に変更**（2026-03-23 方針変更）
- **Apple Sign-In は除外**（Apple Developer Program 未加入）
- **Google OAuth はオプション**（GCP 設定後に有効化可能）
- 家庭内で同じ環境（同じ子供のデータ）を親も子供も使う
- ぴよログのQRコード+認証コード方式が参考になる

### 想定ユースケース

本チケットの設計は以下3つのユースケースを**すべて同時に成立させる**必要がある。

| UC | シナリオ | デバイス | 認証方式 | 操作モード |
|----|---------|---------|---------|-----------|
| UC1 | 家族共用タブレットで子供が活動記録 | 共用タブレット | デバイストークン + 子供選択 | child mode |
| UC2 | 親が個人スマホで管理画面にアクセス | 親の個人端末 | OAuth (Google/Apple) | parent/owner mode |
| UC3 | ティーン(10代)の子供が自分のスマホでアクセス | 子の個人端末 | OAuth (自分のGoogle) | child mode（/admin は403） |

**追加シナリオ（UC1の派生）:**
| UC | シナリオ | デバイス | 認証方式 | 操作モード |
|----|---------|---------|---------|-----------|
| UC1-a | 共用タブレットで親が管理画面に一時切替 | 共用タブレット | PIN or OAuth再認証 | parent mode（タイムアウトでchild modeに復帰） |
| UC1-b | 共用タブレットにもう一人の親がアクセス | 共用タブレット | OAuth切替 | parent mode |

**ローカル展開シナリオ（AUTH_MODE による分岐）:**
| UC | シナリオ | AUTH_MODE | 認証方式 | 想定環境 |
|----|---------|-----------|---------|---------|
| UC-L1 | 自宅NUCサーバーで家族だけが利用 | `none` | 認証なし（現行動作） | LAN内、外部非公開 |
| UC-L2 | 自宅LANで最低限の認証を付けたい | `basic` | ベーシック認証（ID/PW環境変数） | LAN内、簡易保護 |
| UC-L3 | AWS SaaS版として不特定多数に提供 | `cognito` | OAuth (Google/Apple) + 二層セッション | インターネット公開 |

### ゴール

**Phase A: 設計完了**
- [x] 二層セッションモデルの詳細設計
- [x] 認可（Authorization）マトリクスの確定
- [x] ロールのスコープ設計（テナント別ロール）
- [x] 共用デバイスのモード切替フロー設計
- [x] デバイス登録・識別メカニズムの確定
- [x] マルチテナントコンテキスト切替の設計

**Phase A': ライセンス管理設計** → **#0130**
- [ ] ライセンスキー体系の設計（形式・発行・検証フロー）
- [ ] サインアップフロー設計（Email/Password → ライセンスキー入力 → テナント作成）
- [ ] ライセンスとテナント・ユーザーの紐付けモデル設計
- [ ] DynamoDB ライセンス管理スキーマ設計
- [ ] 買い切り / サブスク両対応の課金状態管理設計
- [ ] Stripe Webhook → ライセンス発行・更新の連携設計

**Phase B: 認証基盤実装**（コード実装済み、動作検証は未完了）
- [x] Cognito User Pool 設定（CDK AuthStack）
- [x] OAuth 認証フロー実装（/auth/login, /auth/callback, /auth/logout）
- [x] 二層セッションの hooks.server.ts 実装（Identity + Context）
- [x] 認可マトリクス実装（authorization.ts）
- [x] JWT 検証ガード実装（cognito-jwt.ts — jose ライブラリ）
- [x] Context Token 署名・検証実装（HMAC-SHA256）
- [ ] **Email/Password 認証の有効化** → **#0123**
- [ ] **サインアップフロー** → **#0124**
- [ ] **ログインフロー動作検証** → **#0125**
- [ ] デバイストークン発行・検証 API → **#0129**
- [ ] 運用 API（`/api/internal/*`）の API キー + IP 許可リスト認証実装（将来）
- [ ] JWT 検証失敗時の統一エラーレスポンス実装（401/403）→ **#0127**

**Phase C: 家族共有機能**
- [ ] 家族共有メカニズム設計・実装 → **#0128**
- [ ] 共有招待（QRコード + 認証コード）→ **#0128**
- [ ] 共有解除フロー → **#0128**
- [ ] テナントメンバー管理画面 → **#0128**
- [ ] デバイストークン（共用タブレット）→ **#0129**
- [ ] 子供プロフィールのテナント紐付け → **#0132**

**Phase D: 解約・データ破棄** → **#0133**
- [ ] 契約終了時のデータ破棄フロー
- [ ] 30日猶予期間の実装
- [ ] バックアップ削除の自動化

**Phase E: ローカル/AWS デュアルモード対応**（大部分実装済み）
- [x] 認証プロバイダー抽象化レイヤー設計（AuthProvider インターフェース）
- [x] AUTH_MODE 環境変数による認証モード切替（local / cognito）
- [x] ローカルモード実装（LocalAuthProvider — 現行 PIN 認証維持）
- [x] Cognito モード実装（CognitoAuthProvider）
- [x] hooks.server.ts のモード別分岐設計
- [ ] テスト戦略（各モードごとの E2E テスト）→ **#0127**

### サブチケット一覧（2026-03-23 再整理）

| # | 内容 | 優先度 | 依存 | Phase |
|---|------|--------|------|-------|
| **#0123** | 認証方式見直し（Email/Password 追加・Apple 除外） | 最高 | なし | B |
| **#0124** | サインアップフロー実装 | 最高 | #0123 | B |
| **#0125** | Cognito モード ログインフロー完成 | 最高 | #0123, #0124 | B |
| **#0126** | ダミーデータ投入とテナント紐付け | 最高 | #0124 | B |
| **#0127** | 認可マトリクス実動作とロール別 UI | 高 | #0125, #0126 | B/E |
| **#0128** | 家族共有・メンバー招待機能 | 中 | #0125, #0127 | C |
| **#0129** | デバイストークン・共用タブレット対応 | 中 | #0127 | C |
| **#0130** | ライセンス管理設計と実装 | 中 | #0124 | A'/D |
| **#0131** | 既存データのテナントプレフィックス移行 | 高 | #0126 | E-1 |
| **#0132** | 子供プロフィールのテナント紐付け | 高 | #0126, #0131 | C |
| **#0133** | 解約・データ破棄フロー | 低 | #0130, #0131 | D |

---

### 設計課題（2026-03-16 分析）

現行設計には3つのユースケースすべてに対して重大なアーキテクチャ上のギャップがある。

#### 課題一覧

| # | ギャップ | 影響度 | 対象UC | 詳細 |
|---|---------|-------|--------|------|
| G1 | セッションモデルの曖昧さ | 致命的 | 全UC | 認証(Authentication)と操作コンテキスト(Mode)が未分離。OAuthセッションが生きていれば全権限が通ってしまう |
| G2 | 認可(Authorization)レイヤーの欠如 | 致命的 | UC3 | ロール×ルートのアクセス制御マトリクスが未設計。child ロールの JWT で /admin にアクセスできてしまう |
| G3 | ロールのスコープ問題 | 重大 | UC2 | `custom:role` が Cognito 固定属性だが、ロールはテナントごとに異なるべき（例: 家庭Aではowner、祖父母として招待された家庭Bではviewer） |
| G4 | 共用デバイスのモード切替 | 重大 | UC1 | 親モード⇔子供モードの遷移フローが未定義。同一ブラウザの Cookie 空間で OAuth セッションとデバイスセッションが衝突する |
| G5 | デバイス登録の具体仕様 | 中 | UC1 | 何をもって「デバイス」を識別するか（Cookie? fingerprint? Service Worker?）が未確定 |
| G6 | マルチテナントコンテキスト | 中 | UC2 | 複数家庭に所属するユーザーのテナント切替画面・セッション管理が未設計 |

#### G1: セッションモデルの曖昧さ — 詳細

**現行ローカル版の構造:**
```
hooks.server.ts:
  sessionToken (Cookie) → authenticated (boolean) → /admin 保護
  selectedChildId (Cookie) → 子供選択
```

現行は「認証されたか否か」の boolean しかなく、以下が区別できない:
- 誰として認証されたか（Identity）
- どのテナントで、何のロールで操作しているか（Context）

**例: 共用タブレットでの事故シナリオ**
1. 親が OAuth ログイン → JWT Cookie が設定される
2. 親が操作を終えブラウザを閉じる（ログアウト忘れ）
3. 子供がブラウザを開く → JWT Cookie がまだ有効
4. 子供が `/admin` にアクセス → **親の権限で管理画面にアクセスできてしまう**

#### G2: 認可レイヤーの欠如 — 詳細

**UC3 の事故シナリオ:**
1. ティーンの子供が自分の Google アカウントで OAuth 認証
2. JWTを取得（`custom:role` が `child` だとしても）
3. URL に `/admin` を直打ち
4. hooks.server.ts は `authenticated = true` しか見ない → **通過してしまう**

認可がないため、認証さえ通れば全ルートにアクセスできる。

#### G4: 共用デバイスのモード切替 — 詳細

**Cookie 衝突の問題:**
```
同一ブラウザのCookie空間:
  ├─ cognito_jwt: OAuth IDトークン（有効期限1日）
  ├─ refresh_token: リフレッシュトークン（有効期限30日）
  ├─ device_token: デバイス登録トークン（永続）
  └─ selectedChildId: 子供選択（現行踏襲）

問題: 「このリクエストはどのセッションで処理すべきか？」が曖昧
  - OAuthトークンが生きていたら親モード？
  - device_tokenだけなら子供モード？
  - 両方あったらどちら優先？
```

---

### 提案アーキテクチャ: 二層セッションモデル

上記の課題を解決するために、認証を **Identity（誰であるか）** と **Context（何として操作しているか）** の2層に分離する。

#### 概念モデル

```
┌──────────────────────────────────────────────────┐
│  Layer 1: Identity（誰であるか）                   │
│  ──────────────────────────────                   │
│  格納: HttpOnly Secure Cookie (identity_token)     │
│  発行元: Cognito (OAuth) or デバイス登録            │
│  寿命: OAuth=トークン有効期限、デバイス=永続         │
│  内容: user_id, email (or device_id)               │
│                                                    │
│  ※ Identityだけでは何も操作できない                 │
└───────────────────┬──────────────────────────────┘
                    │ Identity確認後
                    ▼
┌──────────────────────────────────────────────────┐
│  Layer 2: Context（何として操作しているか）          │
│  ──────────────────────────────────────          │
│  格納: HttpOnly Secure Cookie (context_token)      │
│  発行元: サーバーサイド（モード選択時に発行）         │
│  寿命: 短命（親モード=30分、子供モード=24時間）       │
│  内容: tenant_id, role, child_id(任意)             │
│                                                    │
│  ※ Contextが操作権限を決定する                      │
└──────────────────────────────────────────────────┘
```

#### 各ユースケースでのフロー

**UC1: 共用タブレット — 子供が使う**

```
1. 親が初期設定:
   OAuth認証 → Identity確立(JWT) → テナント選択
   → 「ファミリーデバイスとして登録」ボタン
   → device_token 発行（HTTPOnly Cookie, 永続）
   → 子供プロファイルにPINを紐付け（小学生以上のみ）

2. 子供の日常利用:
   ブラウザ起動 → device_token 検知 → 子供選択画面表示
   → 子供アイコンタップ (幼児: PINなし, 小学生以上: PIN)
   → Context = { tenant_id, role: "child", child_id } 発行
   → 子供画面へ (/child/*)
   ※ OAuthは一切不要
```

**UC1-a: 共用タブレット — 親が一時的に管理へ切替**

```
1. 子供画面フッターの「おやのページ」ボタン
2. PIN入力ダイアログ（現行踏襲の4-6桁PIN）
   or OAuth再認証（より高セキュリティ）
3. 認証成功:
   → Context = { tenant_id, role: "parent", child_id: null } に切替
   → /admin へリダイレクト
4. 操作完了 or 30分タイムアウト:
   → Context を自動的に child mode に復帰
   → /child/ へリダイレクト
   ※ 共用デバイスでは親モードが永続しない安全設計
```

**UC2: 親の個人スマホ**

```
1. OAuth認証 → Identity確立
2. テナント一覧（複数所属時のみ表示）
   → テナント選択
3. Context = { tenant_id, role: "owner"/"parent" } 発行
4. /admin にアクセス → hooks: role ∈ {owner, parent} → 許可
5. 個人デバイスなので Context 寿命は長め（24時間）
   ※ Identity 自体は Refresh Token(30日) で自動維持
```

**UC3: ティーンの子供 — 自分のスマホ**

```
1. OAuth認証（自分の Google アカウント） → Identity確立
2. 初回: 招待コードでテナント参加 → role: "child" として登録
3. Context = { tenant_id, role: "child", child_id: self } 発行
4. /child/* にアクセス → 許可
5. /admin にアクセス試行 → hooks: role="child" → 403
   → 「おうちの人にきいてね」画面表示 → /child/ にリダイレクト
```

#### 認可マトリクス（hooks.server.ts に実装）

| ルートパターン | owner | parent | child | viewer | デバイスのみ | 未認証 |
|---------------|-------|--------|-------|--------|-------------|--------|
| `/admin/*` | ✅ | ✅ | ❌→/child | ❌→/child | ❌→/child/switch | ❌→/login |
| `/admin/billing/*` | ✅ | ❌→/admin | ❌ | ❌ | ❌ | ❌ |
| `/admin/members/*` | ✅ | 閲覧のみ | ❌ | ❌ | ❌ | ❌ |
| `/child/*` | ✅ | ✅ | ✅ | ✅ | ✅(子供選択後) | ❌→/login |
| `/child/switch` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌→/login |
| `/api/v1/admin/*` | ✅ | ✅ | 403 | 403 | 403 | 401 |
| `/api/v1/child/*` | ✅ | ✅ | ✅ | ✅ | ✅ | 401 |
| `/api/v1/billing/*` | ✅ | 403 | 403 | 403 | 403 | 401 |
| `/settings/family` | ✅ | 一部 | ❌ | ❌ | ❌ | ❌ |
| `/login` | リダイレクト→適切な画面 | 同左 | 同左 | 同左 | 同左 | ✅(表示) |

#### hooks.server.ts の設計イメージ

```typescript
export const handle: Handle = async ({ event, resolve }) => {
  // Layer 1: Identity 解決
  const identity = await resolveIdentity(event.cookies);
  // → { type: "oauth", user_id, email } or { type: "device", device_id } or null

  // Layer 2: Context 解決
  const context = resolveContext(event.cookies, identity);
  // → { tenant_id, role, child_id } or null

  event.locals.identity = identity;
  event.locals.context = context;

  // 認可チェック
  const path = event.url.pathname;
  const authResult = authorize(path, identity, context);
  // → { allowed: true } or { allowed: false, redirect: "/login" }

  if (!authResult.allowed) {
    if (authResult.status === 403) {
      // ロール不足: 適切なエラー画面
      return new Response(null, { status: 403 });
    }
    redirect(302, authResult.redirect);
  }

  return resolve(event);
};
```

#### Cognito ロール設計の修正

```
❌ 旧設計: custom:role を Cognito カスタム属性に持つ
   問題: ユーザーごとに1つの固定ロール。テナントごとに変えられない
   例: 家庭Aでは owner だが、祖父母として招待された家庭Bでは viewer
       → custom:role には何を入れる？

✅ 新設計: ロールは DynamoDB のテナントメンバーシップで管理

   テーブル設計:
   PK: TENANT#t1#MEMBER#u123
   SK: MEMBERSHIP
   Attributes: {
     role: "parent",     // このテナントでのロール
     joined_at: "...",
     invited_by: "u456"
   }

   Cognito には user_id のみ含む（ロール属性を削除）
   Context 発行時に DynamoDB から role を引く
```

#### デバイス登録の仕様

```
デバイストークン:
  - 形式: サーバー発行の署名付きJWT or ランダムUUID + DB紐付け
  - 格納: HttpOnly Secure Cookie (device_token)
  - 寿命: 永続（明示的な解除まで有効）
  - 内容: { device_id, tenant_id, registered_by, registered_at }

デバイス識別:
  - Cookie ベース（fingerprint は使わない: プライバシー懸念 + 信頼性低）
  - Cookie が消えた場合 → 親が再登録（QRコード or 設定画面）

セキュリティ:
  - デバイストークンでアクセスできるのは子供画面のみ
  - 管理画面は必ず PIN or OAuth 再認証が必要
  - owner はデバイス一覧で登録済みデバイスを確認・解除可能
  - 不審なデバイスからのアクセスは通知（将来）
```

---

### 対応方針（旧設計 — 参考として残す）

<details>
<summary>旧: 認証アーキテクチャ（二層モデル導入前）</summary>

#### 認証アーキテクチャ

```
[ユーザー] → [SvelteKit クライアント]
                    │
                    ▼
              [Cognito Hosted UI]
                    │
              ┌─────┴─────┐
              ▼           ▼
        [Google OAuth] [Apple Sign-In]
              │           │
              └─────┬─────┘
                    ▼
              [Cognito User Pool]
                    │
                    ▼ (JWT Token)
              [SvelteKit Server]
                    │
                    ▼
              [Lambda Authorizer]
```

#### Cognito設定

- User Pool: `ganbari-quest-users`
- Identity Provider: Google, Apple
- カスタム属性:
  - `custom:tenant_id` - テナント（家庭）ID
  - `custom:role` - `owner` | `member` | `child`
- トークン: JWT（ID Token + Access Token）
- セッション: HTTP-only Secure Cookie

**⚠️ 問題点:** `custom:role` が固定属性のため、マルチテナント時にロールを分けられない。新設計では DynamoDB メンバーシップで管理に変更。

</details>

#### 家族共有設計

**ぴよログ参考モデル:**

```
1. オーナー（最初の登録者）がテナント作成
2. 共有設定画面で「共有コード」を生成
   - 6桁の英数字コード（有効期限: 24時間）
   - QRコード（コードをエンコード）
3. 共有相手がQRコードスキャン or コード入力
4. 相手のOAuth認証後、テナントにメンバーとして追加
```

**ロール設計:**

| ロール | 権限 | 想定ユーザー |
|--------|------|-------------|
| owner | 全機能（管理画面・プラン変更・メンバー管理・解約） | 最初の登録者（父 or 母） |
| parent | 管理画面（活動管理・評価）、共有招待 | もう一人の親 |
| child | 子供画面のみ（活動記録・ステータス確認） | ティーン（自分のOAuthあり）|
| viewer | 閲覧のみ（活動記録の閲覧、評価は不可） | 祖父母等 |

**注:** ロールはテナント単位で付与される。1人のユーザーが複数テナントで異なるロールを持てる。

**共有フロー:**

```
[招待] owner/parent → 共有コード生成 → QRコード表示
[参加] 招待されたユーザー → QRスキャン → OAuth認証 → ロール選択 → テナント参加
[解除] owner → メンバー管理 → メンバー削除 → 対象ユーザーのテナントアクセス無効化
```

#### 子供のアクセス

子供（特に小さい子）はOAuthアカウントを持たない場合が多い。

**方式の整理（ユースケースごとの組み合わせ）:**

| 年齢帯 | OAuthアカウント | アクセス方式 | 認証ステップ |
|--------|---------------|-------------|-------------|
| 幼児(0-5) | なし | 共用タブレット + デバイストークン | 子供アイコンタップのみ（PINなし） |
| 小学生低学年(6-8) | なし | 共用タブレット + デバイストークン | 子供アイコンタップ + PIN |
| 小学生高学年(9-12) | あり/なし | 共用 or 個人端末 | デバイストークン or OAuth + child ロール |
| ティーン(13+) | あり | 個人スマホ | OAuth（自分のGoogleアカウント）+ child ロール |

**デバイストークン方式（共用タブレット向け）:**
- 親が管理画面から「ファミリーデバイスとして登録」
- device_token Cookie が発行される（HttpOnly, Secure, 永続）
- 以降、そのデバイスではOAuth不要で子供画面にアクセス可能
- 親が管理画面に切り替える際は PIN or OAuth 再認証

#### 契約終了時のデータ破棄

```
1. owner が解約リクエスト
2. 確認画面で「全データが削除されます」の明示
3. 30日間の猶予期間開始
   - この間はデータ参照可能（編集不可）
   - 解約キャンセル可能
4. 猶予期間終了後:
   - DynamoDB: テナント配下の全データ削除
   - S3: アバター画像・アップロードファイル削除
   - Cognito: テナントグループ解除（ユーザーは残る）
   - CloudWatch: テナント関連ログのマスキング
5. 削除完了メール送信
6. バックアップからの削除（90日後）
```

---

### 現行 → SaaS版 のセッション設計比較

| 要素 | 現行（ローカル版） | SaaS版（二層モデル） |
|------|-------------------|---------------------|
| 認証方式 | PIN（bcrypt, 4-6桁） | OAuth (Google/Apple) + デバイストークン + PIN |
| セッション | UUID Cookie (1年) | ID Token (24h) + Refresh Token (30日) + Context Cookie (短命) |
| 再ログイン間隔 | 1年 | 30日（Refresh Token 期限） |
| 認可 | `authenticated` boolean のみ | ロール×ルート マトリクス + ライセンス状態 |
| ロール | なし（親 or 子の2択） | owner / parent / child / viewer |
| ロール格納 | — | DynamoDB メンバーシップ（テナント別） |
| 子供アクセス | 認証なし（LAN 内信頼） | デバイストークン + 子供選択 |
| テナント | 単一家庭 | 複数家庭（ユーザーが複数テナントに所属可能） |
| モード切替 | なし | 親モード ⇔ 子供モード（タイムアウト付き） |

---

### ローカル/AWS デュアルモード認証設計（Phase E）

#### 背景

本アプリは以下の 2 つのデプロイ形態を**同一コードベース**でサポートする必要がある:

1. **ローカル版**: 自宅 NUC サーバー等に Docker でデプロイ。LAN 内の家族だけが利用。認証不要 or 簡易認証で十分。
2. **SaaS版 (AWS)**: インターネットに公開。不特定多数のユーザーが OAuth で認証し、テナント単位で分離。

これらを環境変数 `AUTH_MODE` で切り替え、認証プロバイダーを抽象化することで実現する。

#### AUTH_MODE 環境変数

```bash
# .env で設定
AUTH_MODE=none     # 認証なし（現行ローカル版の動作を維持）
AUTH_MODE=basic    # ベーシック認証（LAN 内簡易保護）
AUTH_MODE=cognito  # OAuth + Cognito（SaaS版フル機能）
```

| AUTH_MODE | 認証方式 | セッション管理 | テナント | ライセンス | 想定環境 |
|-----------|---------|---------------|---------|-----------|---------|
| `none` | なし | 不要 | 単一（暗黙） | 不要 | 自宅 NUC, Docker, LAN 内限定 |
| `basic` | HTTP Basic 認証 | Cookie (現行方式) | 単一（暗黙） | 不要 | LAN 内、簡易保護が必要な場合 |
| `cognito` | OAuth (Google/Apple) | 二層モデル (Identity + Context) | マルチテナント | 必要 | AWS SaaS, インターネット公開 |

#### 認証プロバイダー抽象化（AuthProvider インターフェース）

`DATA_SOURCE` パターン（#0111）と同様に、Strategy パターンで認証ロジックを切り替える。

```typescript
// $lib/server/auth/types.ts

/** 認証プロバイダーの共通インターフェース */
interface AuthProvider {
  /** リクエストから Identity を解決する */
  resolveIdentity(event: RequestEvent): Promise<Identity | null>;

  /** リクエストから Context を解決する */
  resolveContext(event: RequestEvent, identity: Identity | null): Promise<AuthContext | null>;

  /** 認可チェック */
  authorize(path: string, identity: Identity | null, context: AuthContext | null): AuthResult;
}

/** 各モードの Identity 型 */
type Identity =
  | { type: 'anonymous' }                              // none モード
  | { type: 'basic'; username: string }                 // basic モード
  | { type: 'oauth'; user_id: string; email: string }   // cognito モード
  | { type: 'device'; device_id: string }               // cognito モード（共用デバイス）
  | { type: 'pin'; session_id: string };                 // none/basic モード（現行PIN認証）
```

#### 各モードの実装概要

**1. NoneAuthProvider（AUTH_MODE=none）**

現行のローカル版動作をそのまま維持。認証チェックをスキップし、全ルートにアクセス可能。

```typescript
// $lib/server/auth/providers/none.ts
class NoneAuthProvider implements AuthProvider {
  async resolveIdentity(): Promise<Identity> {
    return { type: 'anonymous' };
  }

  async resolveContext(): Promise<AuthContext> {
    // 単一テナント・全権限
    return { tenant_id: 'local', role: 'owner', license_status: 'valid' };
  }

  authorize(): AuthResult {
    return { allowed: true }; // 全ルート許可
  }
}
```

**2. BasicAuthProvider（AUTH_MODE=basic）**

環境変数で設定した ID/PW による簡易認証。管理画面（/admin）へのアクセスにのみ認証を要求し、子供画面は現行通り認証なし。

```typescript
// $lib/server/auth/providers/basic.ts

// 環境変数:
// BASIC_AUTH_USERNAME=admin
// BASIC_AUTH_PASSWORD=<ハッシュ済みパスワード>

class BasicAuthProvider implements AuthProvider {
  async resolveIdentity(event: RequestEvent): Promise<Identity | null> {
    // 現行の PIN セッション Cookie があればそれを使用
    const session = event.cookies.get('session_id');
    if (session && await validateSession(session)) {
      return { type: 'pin', session_id: session };
    }
    return null;
  }

  authorize(path: string, identity: Identity | null): AuthResult {
    // 子供画面は認証不要（現行動作維持）
    if (path.startsWith('/child') || path.startsWith('/api/v1')) {
      return { allowed: true };
    }
    // 管理画面は PIN セッション必須
    if (!identity || identity.type !== 'pin') {
      return { allowed: false, redirect: '/parent/pin' };
    }
    return { allowed: true };
  }
}
```

**3. CognitoAuthProvider（AUTH_MODE=cognito）**

本チケットで設計済みの二層セッションモデルをフル実装。OAuth + デバイストークン + Context Cookie。

```typescript
// $lib/server/auth/providers/cognito.ts
class CognitoAuthProvider implements AuthProvider {
  // 既存の二層セッションモデル設計をそのまま適用
  // resolveIdentity → OAuth トークン or デバイストークン
  // resolveContext  → DynamoDB メンバーシップ + ライセンス検証
  // authorize       → ロール×ルート マトリクス + ライセンス状態
}
```

#### hooks.server.ts のモード分岐

```typescript
// src/hooks.server.ts
import { env } from '$env/dynamic/private';
import type { AuthProvider } from '$lib/server/auth/types';

function createAuthProvider(): AuthProvider {
  switch (env.AUTH_MODE) {
    case 'none':
      return new NoneAuthProvider();
    case 'basic':
      return new BasicAuthProvider();
    case 'cognito':
      return new CognitoAuthProvider();
    default:
      // デフォルトは none（後方互換性）
      return new NoneAuthProvider();
  }
}

const authProvider = createAuthProvider();

export const handle: Handle = async ({ event, resolve }) => {
  const identity = await authProvider.resolveIdentity(event);
  const context = await authProvider.resolveContext(event, identity);

  event.locals.identity = identity;
  event.locals.context = context;

  const authResult = authProvider.authorize(event.url.pathname, identity, context);
  if (!authResult.allowed) {
    if (authResult.status === 403) {
      return new Response(null, { status: 403 });
    }
    redirect(302, authResult.redirect);
  }

  return resolve(event);
};
```

#### モード別機能マトリクス

| 機能 | none | basic | cognito |
|------|------|-------|---------|
| 子供画面アクセス | 認証なし | 認証なし | デバイストークン or OAuth |
| 管理画面アクセス | 認証なし | PIN認証（現行） | OAuth + ロール認可 |
| マルチテナント | ❌（単一家庭） | ❌（単一家庭） | ✅ |
| 家族共有・招待 | ❌ | ❌ | ✅（QRコード） |
| ライセンス管理 | ❌ | ❌ | ✅ |
| ロール制御 | ❌（全権） | 親/子の2択（現行） | owner/parent/child/viewer |
| DB | SQLite | SQLite | DynamoDB |
| デプロイ先 | Docker / bare metal | Docker / bare metal | AWS (Lambda + CloudFront) |

#### ローカル版とSaaS版の共存原則

1. **AUTH_MODE 未設定時は `none` がデフォルト** — 既存ユーザー（NUC 運用）の動作を壊さない
2. **認証ロジック以外のコード（UI・ドメイン・API）は共通** — 認証プロバイダーの差し替えのみ
3. **DB 抽象化（#0111 DATA_SOURCE）と組み合わせ** — `AUTH_MODE=none` + `DATA_SOURCE=sqlite` がローカル版、`AUTH_MODE=cognito` + `DATA_SOURCE=dynamodb` がSaaS版
4. **ビルド時ではなく実行時に切替** — 同一 Docker イメージで環境変数のみ変更して動作モードを切替可能
5. **basic モードは中間ステップ** — ローカル版に最低限の認証を付けたい場合の選択肢。SaaS移行への段階的ステップとしても機能

### セキュリティ考慮事項

- **CSRF対策**: Context Cookie は SameSite=Strict、state パラメータによるOAuthフロー保護
- **トークン漏洩**: Identity Cookie は HttpOnly + Secure。device_token も同様
- **セッションハイジャック**: Context の IP バインディング（オプション）、異常検知でセッション無効化
- **権限昇格**: Context 発行時に DynamoDB のメンバーシップを毎回検証。キャッシュは短寿命（5分）
- **デバイストークン失効**: owner がメンバー管理画面から即時無効化可能
- **ブルートフォース**: PIN試行は現行同様5回でロックアウト（15分）

#### API エンドポイントの JWT 検証・認可ガード

ログイン関連を除く**すべての公開 API エンドポイント**（`/api/v1/*`）では、リクエスト処理前に JWT 検証と認可チェックを**必須**とする。これにより、トークンなし・無効トークン・権限不足のリクエストを確実にブロックする。

**JWT 検証フロー（hooks.server.ts の `resolveIdentity` 内で実行）:**

```typescript
async function verifyJWT(token: string): VerifiedToken {
  // 1. 署名検証 — Cognito JWKS エンドポイントの公開鍵で RS256 署名を検証
  //    JWKS はキャッシュ（TTL: 24時間）し、キーローテーション時に再取得
  const decoded = await jwtVerify(token, jwksClient.getSigningKey, {
    algorithms: ['RS256'],
  });

  // 2. 発行者 (iss) 検証 — 自テナントの Cognito User Pool であることを確認
  if (decoded.iss !== `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`) {
    throw new InvalidTokenError('Invalid issuer');
  }

  // 3. 対象者 (aud) 検証 — 自アプリの Client ID と一致することを確認
  if (decoded.aud !== cognitoClientId) {
    throw new InvalidTokenError('Invalid audience');
  }

  // 4. 有効期限 (exp) 検証 — 期限切れトークンを拒否
  if (decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new TokenExpiredError('Token expired');
  }

  // 5. トークン使用目的 (token_use) 検証 — id トークンであることを確認
  if (decoded.token_use !== 'id') {
    throw new InvalidTokenError('Invalid token_use');
  }

  return decoded;
}
```

**代替案: Cognito API によるトークン検証**

上記のローカル JWKS 検証の代わりに、Cognito の `GetUser` API や `UserInfo` エンドポイントにトークンを送って検証する方式も選択肢となる。Cognito が JWT の発行元であるため、Cognito 自身に検証を委譲するのは自然なアプローチ。

| 方式 | メリット | デメリット |
|------|---------|-----------|
| ローカル JWKS 検証 | レイテンシ低（ネットワーク不要）、Cognito 障害に強い | JWKS キャッシュ管理が必要、キーローテーション対応 |
| Cognito API 検証 | 実装がシンプル、常に最新のトークン状態を反映 | リクエストごとに API コール、Cognito 障害時に全API停止 |

→ **実装時に有識者と協議して決定する。** パフォーマンス要件やインフラ構成に応じてどちらが適切か判断。ハイブリッド（初回は Cognito API、以降はキャッシュ付きローカル検証）も検討の余地あり。

**エンドポイント分類と認証方式:**

| 分類 | パス例 | 認証方式 | JWT検証 | 備考 |
|------|--------|---------|---------|------|
| 公開 API（顧客向け） | `/api/v1/activities/*`, `/api/v1/children/*` | JWT (Identity Cookie) + Context | ✅ 必須 | 認可マトリクスに従いロール制御 |
| ログイン・サインアップ | `/api/v1/auth/login`, `/api/v1/auth/callback` | なし（トークン発行側） | ❌ 除外 | OAuth コールバック、トークン発行 |
| デバイストークン検証 | `/api/v1/auth/device` | device_token Cookie | ❌ 別方式 | JWT ではなくサーバー署名検証 |
| ヘルスチェック | `/api/health` | なし | ❌ 除外 | ロードバランサー・監視用 |
| Stripe Webhook | `/api/webhooks/stripe` | Stripe 署名検証 | ❌ 別方式 | `stripe.webhooks.constructEvent()` で検証 |
| 運用 API（内部） | `/api/internal/*` | API キー + IP 許可リスト | ❌ 別方式 | 管理者ツール・バッチ処理用 |
| バックドア（開発） | `/api/debug/*` | 本番では無効化 | ❌ 不要 | `NODE_ENV !== 'production'` でのみ有効 |

**JWT 検証失敗時のレスポンス:**

| 状況 | HTTP ステータス | レスポンスボディ | クライアント動作 |
|------|----------------|-----------------|----------------|
| トークンなし | 401 Unauthorized | `{ error: 'authentication_required' }` | ログイン画面へリダイレクト |
| 署名不正 | 401 Unauthorized | `{ error: 'invalid_token' }` | トークン破棄 → 再ログイン |
| 有効期限切れ | 401 Unauthorized | `{ error: 'token_expired' }` | Refresh Token で自動更新 → リトライ |
| ロール不足 | 403 Forbidden | `{ error: 'insufficient_permissions' }` | 権限不足メッセージ表示 |
| ライセンス無効 | 403 Forbidden | `{ error: 'license_expired' }` | /billing/renew へ誘導 |

**運用 API・内部エンドポイントの認証（JWT 以外）:**

```typescript
// 運用 API は API キー + IP 許可リストで保護
// JWT とは独立した認証経路（顧客用トークンでアクセスさせない）
async function verifyInternalAccess(event: RequestEvent): void {
  // 1. API キー検証（Authorization: Bearer <api_key>）
  const apiKey = event.request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey || !await validateApiKey(apiKey)) {
    throw error(401, 'Invalid API key');
  }

  // 2. IP 許可リスト検証
  const clientIP = event.getClientAddress();
  if (!isAllowedIP(clientIP)) {
    throw error(403, 'Access denied from this IP');
  }

  // 3. 監査ログ記録（誰が・いつ・どこから）
  await logInternalAccess(apiKey, clientIP, event.url.pathname);
}
```

**AUTH_MODE 別の JWT 検証適用:**

| AUTH_MODE | `/api/v1/*` の認証 | `/api/internal/*` の認証 |
|-----------|-------------------|-------------------------|
| `none` | スキップ（全許可） | スキップ |
| `basic` | PIN セッション Cookie 検証 | 環境変数の API キー |
| `cognito` | JWT 検証（全項目） | API キー + IP 許可リスト |

#### ライセンス無効時の強制サインアウト

ライセンスが無効になったユーザーはサービスを利用できない。これを 2 つのタイミングで制御する。

**タイミング A: トークンリフレッシュ時（最大 24 時間以内に検知）**

ID Token の有効期限は 24 時間なので、どんなに遅くとも 24 時間以内に Refresh Token による更新が発生する。このタイミングでライセンスを検証する。

```typescript
// hooks.server.ts 内のトークンリフレッシュ処理
async function refreshIdentityToken(
  refreshToken: string,
  tenantId: string
): { idToken: string } | { redirect: string } {
  // 1. Cognito に Refresh Token を送って新しい ID Token を取得
  const newTokens = await cognito.initiateAuth({
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });

  // 2. ライセンス検証（リフレッシュのたびに実行）
  const licenseStatus = await validateLicense(tenantId);

  if (licenseStatus === 'expired' || licenseStatus === 'invalid') {
    // ライセンス無効 → 全 Cookie を削除してログイン画面へ
    return {
      redirect: '/login?reason=license_expired',
    };
  }

  // 3. ライセンス有効 → 新しい ID Token を返却
  return { idToken: newTokens.IdToken };
}
```

**タイミング B: Context 発行時（即座に検知）**

Context Cookie が期限切れして再発行する際も、ライセンスを検証する（既存の `issueContext()` に組み込み済み）。

**強制サインアウトの動作:**

```
ライセンス無効検知時:
  1. identity_token (ID Token) Cookie を削除
  2. refresh_token Cookie を削除
  3. context_token Cookie を削除
  4. /login?reason=license_expired へリダイレクト
  5. ログイン画面にメッセージ表示:
     「ご利用期間が終了しました。続けてご利用いただくには、
       プランの更新またはライセンスの再発行をお願いします。」
     + [プランを更新する] [ライセンスを再発行する] ボタン

  ※ device_token は削除しない（デバイス登録はライセンスとは無関。
     ライセンス復活後に再登録の手間を省く）
```

**ライセンス状態別のログイン可否:**

| ライセンス状態 | ログイン | トークンリフレッシュ | ユーザーへの表示 |
|--------------|---------|--------------------|------------------|
| `active` | ✅ | ✅ | 通常利用 |
| `cancelled` (残り期間内) | ✅ | ✅ | 「○月○日にプランが終了します」バナー |
| `suspended` | ✅ | ✅ | 「お支払いに問題があります」バナー + 読み取り専用 |
| `expired` | ❌ | ❌ → 強制サインアウト | /login?reason=license_expired |
| `grace_period` | ❌ | ❌ → 強制サインアウト | /login?reason=license_expired |
| `terminated` | ❌ | ❌ → 強制サインアウト | /login?reason=account_deleted |
| `revoked` | ❌ | ❌ → 強制サインアウト | /login?reason=license_revoked |
| テナント未所属 | ✅ (認証のみ) | ✅ | /onboarding/license へ誘導 |

---

### ライセンスキー管理設計

サインアップは **誰でも自由に** 行えるが、サービスの利用開始には **ライセンスキー** が必要。これにより決済と認証を分離し、キャンペーン・フリートライアル・買い切り・サブスクなど多様な販売形態に柔軟に対応する。

#### サインアップ → 利用開始フロー

```
[ユーザー]
    │
    ├── 1. OAuth サインアップ（Google / Apple）
    │      → Cognito にユーザー作成
    │      → Identity 確立（user_id, email）
    │      → この時点ではテナント未所属・サービス利用不可
    │
    ├── 2. ライセンスキー入力画面
    │      → /onboarding/license
    │      → キーの入手経路:
    │         a) Stripe 決済完了後に自動発行（メール + 画面表示）
    │         b) キャンペーンコード（運営が事前生成）
    │         c) 既存ユーザーからの招待（家族共有用とは別）
    │
    ├── 3. ライセンスキー検証
    │      → サーバーサイドで検証:
    │         ・キーの存在確認
    │         ・有効期限チェック
    │         ・利用回数上限チェック（買い切り: 1回, キャンペーン: N回）
    │         ・既にアクティベート済みでないか
    │
    └── 4. テナント作成 + ライセンス紐付け
           → テナント自動生成（owner ロール付与）
           → ライセンスをテナントに紐付け
           → Context 発行 → /admin へリダイレクト
```

**家族メンバー参加の場合:**
```
OAuth サインアップ → 招待コード入力（#0066 既存の共有フロー）
→ 既存テナントに参加（ライセンスキー不要 = テナントのライセンスを共用）
```

#### ライセンスキーの体系

| 項目 | 仕様 |
|------|------|
| 形式 | `GQ-XXXX-XXXX-XXXX-XXXX`（20文字、英数大文字、ハイフン区切り） |
| 生成 | サーバーサイドで暗号論的乱数（`crypto.randomUUID()` ベース） |
| 一意性 | DynamoDB PK で保証 |
| 大文字小文字 | 入力時は大文字に正規化（ユーザビリティ） |
| 有効期限 | タイプにより異なる（下表参照） |

| ライセンスタイプ | 有効期限 | 利用可能回数 | 発行元 | 用途 |
|----------------|---------|-------------|--------|------|
| `subscription_monthly` | 月次自動更新 | 1 | Stripe Webhook | 月額サブスク |
| `subscription_yearly` | 年次自動更新 | 1 | Stripe Webhook | 年額サブスク |
| `perpetual` | 無期限 | 1 | Stripe Webhook | 買い切り |
| `trial` | 30日 | 1 | サインアップ時自動 | 無料トライアル |
| `campaign` | 発行者指定 | N（発行者指定） | 管理者手動 or API | キャンペーン |
| `gift` | 発行者指定 | 1 | 管理者手動 | プレゼント・謝礼 |

#### ライセンスキーの不正利用防止

**原則: 1キー = 1アクティベーション**

ライセンスキーの流出・転売を防止するため、以下の制御を行う。

| 制御 | 詳細 |
|------|------|
| アクティベート上限 | 買い切り・サブスク・トライアル・ギフト = 1回。キャンペーンのみ N 回（発行者指定） |
| アクティベート時の紐付け | アクティベートしたユーザーの user_id, email, OAuth provider をライセンスに記録 |
| アクティベート済みキーの拒否 | `current_activations >= max_activations` なら「このキーは既に使用済みです」と表示 |
| ブルートフォース防止 | ライセンスキー入力は IP 単位で5回/時間に制限。アカウント単位で10回/日 |
| キー形式の難読性 | 20桁英数大文字 → 総当たりパターン数 $36^{16} \approx 7.96 \times 10^{24}$。ブルートフォースは事実上不可能 |

#### ライセンスキーの再発行フロー

有効期限切れやキー紛失時に、本人確認を経て新しいライセンスキーを発行する。旧キーは自動的に失効する。

**再発行フロー:**
```
[ユーザー] → /billing/reissue
    │
    ├── 1. 本人確認（以下のいずれか）
    │      a) OAuth ログイン済み（Identity Cookie あり）
    │         → email がライセンスの activated_by_email と一致
    │      b) OAuth セッションなし（Cookie 切れ等）
    │         → メールアドレス入力 + Email 一時コード認証
    │
    ├── 2. 過去のライセンス情報確認
    │      → 以下のうち1つ以上を照合:
    │         ・過去のライセンスキー（先頭 or 末尾4桁でも可）
    │         ・ Stripe の決済メールの受信確認（メールアドレス一致）
    │         ・テナント名（家族名）の一致
    │
    ├── 3. Email 一時コード認証（必須）
    │      → 登録済みメールアドレスに6桁数字コードを送信
    │      → 有効期限: 10分
    │      → 試行制限: 3回（超過で30分ロックアウト）
    │
    └── 4. 新ライセンスキー発行
           → 旧キーの status を 'revoked' に変更
           → 新キーを生成（同じ type, plan を継承）
           → テナントの LICENSE レコードを新キーに更新
           → ユーザーにメール + 画面で新キーを通知
           → 再発行履歴を記録（監査ログ）
```

**再発行時のセキュリティ考慮:**

| リスク | 対策 |
|--------|------|
| 第三者による再発行試行 | Email 一時コード必須 → メールアクセス権がない限り不可能 |
| メールアカウント乗っ取り | OAuth provider 側のセキュリティに依存（MFA推奨） |
| 再発行の悪用（繰り返し発行） | 再発行は30日に1回まで。それ以上はサポート経由 |
| 旧キーでのアクセス試行 | 即座に revoked 状態をチェックして拒否 |
| 監査証跡 | 全ての再発行リクエストを IP・タイムスタンプ付きで記録 |

**Email 一時コードの実装:**

```typescript
// SES (Simple Email Service) 経由で送信（AWS 無料枠: 62,000通/月）
async function sendVerificationCode(email: string): void {
  const code = crypto.randomInt(100000, 999999).toString(); // 6桁数字
  const hashedCode = await hash(code); // bcrypt or SHA-256 + salt
  
  await dynamodb.put({
    PK: `VERIFY#${email}`,
    SK: `CODE#${Date.now()}`,
    hashed_code: hashedCode,
    expires_at: Date.now() + 10 * 60 * 1000, // 10分
    attempts: 0,
    max_attempts: 3,
    ttl: Math.floor(Date.now() / 1000) + 3600, // DynamoDB TTL: 1時間後に自動削除
  });

  await ses.sendEmail({
    to: email,
    subject: '【がんばりクエスト】ライセンスキー再発行 確認コード',
    body: `確認コード: ${code}\n\nこのコードは10分間有効です。`,
  });
}
```

#### DynamoDB スキーマ（ライセンス管理）

**License テーブル（メインテーブル内）:**

| PK | SK | Attributes | 用途 |
|----|-----|-----------|------|
| `LICENSE#GQ-XXXX-...` | `META` | type, plan, status, expires_at, max_activations, current_activations, created_at, stripe_subscription_id | ライセンス本体 |
| `LICENSE#GQ-XXXX-...` | `ACTIVATION#t1` | tenant_id, activated_by, activated_at, activated_by_email, activated_by_provider | アクティベーション履歴 |
| `LICENSE#GQ-XXXX-...` | `REISSUE#2026-03-17T...` | old_license_key, new_license_key, reason, verified_by, ip_address, requested_at | 再発行履歴（監査ログ） |
| `TENANT#t1` | `LICENSE` | license_key, plan, status, expires_at, stripe_customer_id, stripe_subscription_id | テナントのライセンス状態（読み取り最適化用） |
| `USER#u1` | `LICENSES` | owned_licenses: [key1, key2, ...] | ユーザーが購入したライセンス一覧 |

**GSI:**
| GSI | PK | SK | 用途 |
|-----|----|----|------|
| GSI-StripeSubscription | stripe_subscription_id | — | Stripe Webhook からのライセンス逆引き |
| GSI-LicenseExpiry | status | expires_at | 期限切れライセンスのバッチ処理 |

#### ライセンス状態遷移

```
[created] ─── アクティベート ──→ [active]
                                    │
                     ┌───────────────┼───────────────┐
                     ▼               ▼               ▼
              [expired]        [suspended]      [cancelled]
              (期限切れ)       (支払い失敗)     (解約申請)
                     │               │               │
                     │          支払い回復            │
                     │          ──→ [active]         │
                     │                               │
                     └───────────────┬───────────────┘
                                     ▼
                               [grace_period]
                               (30日猶予)
                                     │
                                     ▼
                                [terminated]
                               (データ削除)

               》 再発行時の分岐:
               [active] ─── 再発行申請 ──→ [revoked](旧キー) + [active](新キー)
               [expired] ── 再発行申請 ──→ [revoked](旧キー) + [active](新キー)
```

| 状態 | サービス利用 | データ保持 | 遷移条件 |
|------|-------------|-----------|----------|
| `created` | ❌ | — | ライセンス発行直後（未アクティベート） |
| `active` | ✅ | ✅ | アクティベート済み、有効期限内 |
| `expired` | ❌ | ✅（30日） | サブスク有効期限切れ（自動更新失敗含む） |
| `suspended` | ❌（読み取り専用） | ✅ | Stripe 支払い失敗（リトライ中） |
| `cancelled` | ✅（期間終了まで） | ✅ | ユーザーが解約申請。残り期間は利用可能 |
| `revoked` | ❌ | ✅（新キーに継承） | 再発行により旧キーが失効。データは新キーのテナントに継承 |
| `grace_period` | ❌（読み取り専用） | ✅ | expired/cancelled から30日間の猶予 |
| `terminated` | ❌ | ❌（削除） | 猶予期間終了。Phase D のデータ破棄実行 |

#### 買い切り vs サブスク の統一的な処理

```typescript
// ライセンス検証ミドルウェア（hooks.server.ts に統合）
async function validateLicense(tenantId: string): LicenseStatus {
  const tenantLicense = await getTenantLicense(tenantId);
  
  switch (tenantLicense.type) {
    case 'perpetual':
      // 買い切り: status が active なら永久有効
      return tenantLicense.status === 'active' ? 'valid' : 'invalid';
    
    case 'subscription_monthly':
    case 'subscription_yearly':
      // サブスク: status + 有効期限チェック
      if (tenantLicense.status === 'active' && tenantLicense.expires_at > Date.now()) {
        return 'valid';
      }
      if (tenantLicense.status === 'cancelled' && tenantLicense.expires_at > Date.now()) {
        return 'valid'; // 解約済みだが残り期間内
      }
      if (tenantLicense.status === 'suspended') {
        return 'read_only'; // 支払い失敗中は読み取り専用
      }
      return 'expired';
    
    case 'trial':
      // トライアル: 期限チェックのみ
      return tenantLicense.expires_at > Date.now() ? 'valid' : 'expired';
    
    case 'campaign':
    case 'gift':
      // キャンペーン/ギフト: active かつ期限内
      return (tenantLicense.status === 'active' && tenantLicense.expires_at > Date.now())
        ? 'valid' : 'expired';
  }
}
```

#### Stripe 連携フロー

**サブスク購入:**
```
1. ユーザーが料金プラン選択 → Stripe Checkout Session 作成
2. Stripe 決済画面でカード入力・決済
3. Stripe Webhook: checkout.session.completed
   → Lambda: ライセンスキー生成 + DynamoDB 登録
   → ユーザーにメール送信（ライセンスキー記載）
4. ユーザーがサインアップ画面でライセンスキー入力
   → テナント作成 → 利用開始
```

**サブスク更新（自動）:**
```
Stripe Webhook: invoice.paid
  → LICENSE の expires_at を次の更新日に延長
  → TENANT#t1 LICENSE の expires_at も同期更新
```

**支払い失敗:**
```
Stripe Webhook: invoice.payment_failed
  → LICENSE の status を 'suspended' に変更
  → ユーザーにメール通知（支払い方法の更新を依頼）
  → Stripe のスマートリトライに任せる（通常3回、2週間以内）
```

**支払い回復:**
```
Stripe Webhook: invoice.paid（リトライ成功時）
  → LICENSE の status を 'active' に復帰
  → ユーザーにメール通知（復旧のお知らせ）
```

**解約:**
```
Stripe Webhook: customer.subscription.deleted
  → LICENSE の status を 'expired' に変更
  → grace_period（30日）タイマー開始
  → Phase D のデータ破棄フローへ
```

**買い切り購入:**
```
1. Stripe Checkout Session（mode: 'payment'、subscription ではない）
2. Stripe Webhook: checkout.session.completed
   → ライセンスキー生成（type: 'perpetual', expires_at: null）
   → メール送信
3. 以降、Stripe との定期連携なし（更新不要）
```

#### 二層セッションモデルへの統合

ライセンス検証は **Context 発行時** に行う:

```typescript
// Context 発行フロー（改訂版）
async function issueContext(identity: Identity, tenantId: string) {
  // 1. メンバーシップ確認（既存: G3 対応）
  const membership = await getMembership(tenantId, identity.user_id);
  if (!membership) throw new UnauthorizedError('Not a member of this tenant');

  // 2. ライセンス検証（新規追加）
  const licenseStatus = await validateLicense(tenantId);
  if (licenseStatus === 'expired' || licenseStatus === 'invalid') {
    // 期限切れ → /billing/renew へリダイレクト
    throw new LicenseExpiredError(tenantId);
  }

  // 3. Context Cookie 発行
  return {
    tenant_id: tenantId,
    role: membership.role,
    license_status: licenseStatus, // 'valid' | 'read_only'
    child_id: membership.role === 'child' ? membership.child_id : null,
  };
}
```

`license_status: 'read_only'` の場合、書き込み系 API（POST/PUT/DELETE）を一律拒否し、読み取りのみ許可する。これにより支払い失敗中もデータは閲覧可能で、ユーザー体験を保つ。

#### 認可マトリクス拡張（ライセンス状態別）

| ルート | active | read_only (suspended) | expired | terminated |
|--------|--------|----------------------|---------|------------|
| `/child/*`（表示） | ✅ | ✅ | ❌ → /billing/renew | ❌ → /signup |
| `/child/*`（POST） | ✅ | ❌ → エラー表示 | ❌ | ❌ |
| `/admin/*` | ✅ | ✅（閲覧のみ） | ❌ → /billing/renew | ❌ → /signup |
| `/admin/billing/*` | ✅ | ✅ | ✅（更新促進） | ❌ |
| `/api/v1/*`（GET） | ✅ | ✅ | ❌ 403 | ❌ 403 |
| `/api/v1/*`（POST/PUT/DELETE） | ✅ | ❌ 403 | ❌ 403 | ❌ 403 |

#### キャンペーン・フリーライセンスの運用例

| シナリオ | ライセンスタイプ | 設定 | 発行方法 |
|---------|----------------|------|----------|
| 新規ユーザー全員に30日無料 | `trial` | expires_at: +30日, max_activations: 1 | サインアップ時自動発行 |
| Twitter キャンペーン | `campaign` | expires_at: +90日, max_activations: 100 | 管理者が1キー発行（共有型） |
| インフルエンサー提供 | `gift` | expires_at: +1年, max_activations: 1 | 管理者が個別発行 |
| β版テスター | `campaign` | expires_at: +6ヶ月, plan: ファミリー | 管理者が個別発行 |
| 紹介プログラム | `gift` | expires_at: +3ヶ月, plan: ベーシック | 紹介完了時に自動発行 |

#### コスト管理への寄与

ライセンスとテナントの紐付けにより、以下のコスト分析が可能:

```typescript
// 管理者ダッシュボード用クエリ例
// GSI-LicenseExpiry で取得可能なメトリクス:

// アクティブライセンス数（= 課金中テナント数）
// プラン別分布（Free / Basic / Family）
// MRR (Monthly Recurring Revenue) 計算
// チャーン率（cancelled / 全体）
// トライアル→有料転換率
```

---

### 残課題・次のアクション

- [ ] 二層セッションモデルのプロトタイプ実装（ローカル版で検証可能）
- [ ] マルチテナント設計（#0065）との統合 — DynamoDB メンバーシップスキーマの確定
- [ ] 利用規約（#0073）に解約・データ削除ポリシーを明記
- [ ] プライバシーポリシー（#0074）にデータ保持期間を明記
- [ ] Cognito Hosted UI のカスタマイズ（子供向けアプリに合ったデザイン）
- [ ] Apple Sign-In の実装要件調査（App Store 審査要件との整合性）
- [ ] デバイストークンの暗号化方式選定（JWT署名 vs DB紐付け）
- [ ] Context Cookie 寿命のユーザビリティテスト（親モード30分は短すぎないか）
- [ ] ライセンスキー再発行フローの UI/UX 設計（/billing/reissue）
- [ ] SES による Email 一時コード送信の実装・テンプレート設計
- [ ] AuthProvider インターフェース設計と NoneAuthProvider の実装（現行動作の抽象化）
- [ ] BasicAuthProvider の設計 — 環境変数によるID/PW設定、PIN認証との統合
- [ ] AUTH_MODE 環境変数の Docker / docker-compose.yml への組み込み
- [ ] DATA_SOURCE（#0111）と AUTH_MODE の組み合わせマトリクス検証
- [ ] 各 AUTH_MODE ごとの E2E テストシナリオ設計
- [ ] JWT 検証ミドルウェアの実装 — JWKS キャッシュ戦略、キーローテーション対応
- [ ] API エンドポイントの認証バイパス一覧の明示的管理（ホワイトリスト方式）
- [ ] 運用 API（`/api/internal/*`）の API キー発行・ローテーション運用設計
- [ ] Stripe Webhook 署名検証の実装（`constructEvent` + シークレットローテーション）
- [ ] ティーン向け OAuth フローの未成年保護対応（Google Family Link 等との干渉確認）
