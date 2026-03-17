# 0066 OAuth認証・家族共有機能

### ステータス

`Backlog`

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

- Email/パスワード認証はサポートしない（運用コスト・セキュリティリスク軽減）
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

### ゴール

**Phase A: 設計完了（本チケットのスコープ）**
- [ ] 二層セッションモデルの詳細設計
- [ ] 認可（Authorization）マトリクスの確定
- [ ] ロールのスコープ設計（テナント別ロール）
- [ ] 共用デバイスのモード切替フロー設計
- [ ] デバイス登録・識別メカニズムの確定
- [ ] マルチテナントコンテキスト切替の設計

**Phase B: 認証基盤実装**
- [ ] Cognito User Pool + Google/Apple Identity Provider設定
- [ ] OAuth認証フロー実装（SvelteKit側）
- [ ] 二層セッションの hooks.server.ts 実装
- [ ] 認可ミドルウェア（ロール×ルート制御）
- [ ] デバイストークン発行・検証API

**Phase C: 家族共有機能**
- [ ] 家族共有メカニズム設計・実装
- [ ] 共有招待（QRコード + 認証コード）
- [ ] 共有解除フロー
- [ ] テナントメンバー管理画面

**Phase D: 解約・データ破棄**
- [ ] 契約終了時のデータ破棄フロー
- [ ] 30日猶予期間の実装
- [ ] バックアップ削除の自動化

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
  ├─ cognito_jwt: 親のOAuthトークン（有効期限1時間）
  ├─ refresh_token: 親のリフレッシュトークン（有効期限30日）
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
5. 個人デバイスなので Context 寿命は長め（24時間 + リフレッシュ）
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
| セッション | UUID Cookie (1年) | Identity Cookie (JWT) + Context Cookie (短命) |
| 認可 | `authenticated` boolean のみ | ロール×ルート マトリクス |
| ロール | なし（親 or 子の2択） | owner / parent / child / viewer |
| ロール格納 | — | DynamoDB メンバーシップ（テナント別） |
| 子供アクセス | 認証なし（LAN 内信頼） | デバイストークン + 子供選択 |
| テナント | 単一家庭 | 複数家庭（ユーザーが複数テナントに所属可能） |
| モード切替 | なし | 親モード ⇔ 子供モード（タイムアウト付き） |

### セキュリティ考慮事項

- **CSRF対策**: Context Cookie は SameSite=Strict、state パラメータによるOAuthフロー保護
- **トークン漏洩**: Identity Cookie は HttpOnly + Secure。device_token も同様
- **セッションハイジャック**: Context の IP バインディング（オプション）、異常検知でセッション無効化
- **権限昇格**: Context 発行時に DynamoDB のメンバーシップを毎回検証。キャッシュは短寿命（5分）
- **デバイストークン失効**: owner がメンバー管理画面から即時無効化可能
- **ブルートフォース**: PIN試行は現行同様5回でロックアウト（15分）

### 残課題・次のアクション

- [ ] 二層セッションモデルのプロトタイプ実装（ローカル版で検証可能）
- [ ] マルチテナント設計（#0065）との統合 — DynamoDB メンバーシップスキーマの確定
- [ ] 利用規約（#0073）に解約・データ削除ポリシーを明記
- [ ] プライバシーポリシー（#0074）にデータ保持期間を明記
- [ ] Cognito Hosted UI のカスタマイズ（子供向けアプリに合ったデザイン）
- [ ] Apple Sign-In の実装要件調査（App Store 審査要件との整合性）
- [ ] デバイストークンの暗号化方式選定（JWT署名 vs DB紐付け）
- [ ] Context Cookie 寿命のユーザビリティテスト（親モード30分は短すぎないか）
- [ ] ティーン向け OAuth フローの未成年保護対応（Google Family Link 等との干渉確認）
