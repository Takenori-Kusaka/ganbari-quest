# 運営者の多要素認証（MFA）設定 — `/ops` に入れるようにする

`/ops`（運営ダッシュボード）は **Cognito `ops` group 所属 かつ MFA を経て開始したセッション**でのみ開ける（`docs/design/14-セキュリティ設計書.md` §5.2.9）。TOTP が未設定の運営者は 403 になり、画面には設定導線（`OpsMfaSetupNotice`）が出る。本書はその導線が指す実作業の手順。

**顧客には影響しない。** Cognito user pool は `mfa: OPTIONAL` のままで、MFA を要求するのはアプリ層の `/ops` だけ（`infra/lib/auth-stack.ts`）。ここで `REQUIRED` に切り替えてはならない — 全顧客に MFA を強制することになる。

## 1. 誰が実施するか

**AWS アカウントのオーナー**。Cognito の TOTP 登録は user pool への管理操作を伴い、アプリ側に self-serve の登録 UI は無い（意図的に持たせていない — 認証面を増やさないため）。

## 2. 手順

### 2-1. 認証アプリを用意する

TOTP（RFC 6238）に対応した認証アプリを対象アカウントの端末に入れる。

### 2-2. user pool で TOTP を有効にする

user pool 自体の MFA 設定は `OPTIONAL` + `otp: true`（`infra/lib/auth-stack.ts`）なので、**ユーザー単位で TOTP を有効化**する。

コンソール: Cognito → 対象 user pool → Users → 対象ユーザー → MFA の設定でソフトウェアトークンを有効にする。

CLI で行う場合（`<pool-id>` / `<username>` は実値に置き換える）:

```bash
# 対象ユーザーの MFA 設定を確認する
aws cognito-idp admin-get-user --user-pool-id <pool-id> --username <username>

# ソフトウェアトークン MFA を有効にする
aws cognito-idp admin-set-user-mfa-preference \
  --user-pool-id <pool-id> --username <username> \
  --software-token-mfa-settings Enabled=true,PreferredMfa=true
```

### 2-3. 認証アプリを登録する

TOTP のシークレット登録（`AssociateSoftwareToken` → `VerifySoftwareToken`）は**ユーザー本人のアクセストークンが要る**ため、対象ユーザー自身のセッションで行う。コンソールの MFA 設定画面から QR を読み取って 6 桁コードを入力する。

### 2-4. ログインし直す

**設定しただけでは `/ops` に入れない。** MFA の有無は ID token の `amr` claim で判定し、その値はログイン時に確定してセッション（署名付き context token）に焼き込まれる。既存セッションのままでは古い値が残るので、ログアウト → 認証アプリのコードを入れてログインし直す。

## 3. 設定したのに 403 のままのとき

| 症状 | 見るところ |
|---|---|
| ログインし直しても 403（MFA 理由） | ID token の `amr` に載る綴りが受理集合（`mfa` / `software_token_mfa` / `sms_mfa`）に無い可能性。判定は `hasMfaAmr()`（`src/lib/server/auth/providers/cognito-jwt.ts`）の 1 箇所 |
| 理由の出ない 403（`Forbidden` だけ） | MFA ではなく `ops` group に居ない。group 所属を確認する |
| しばらく使えていたのに急に 403 | context token の TTL 切れ（owner = 24 時間）。ログインし直せば復帰する |

`otp` / `email_otp` は**受理しない**。本アプリではアプリ層の email OTP を指し、二要素の証拠にならないため。

## 4. ローカルで導線を確認する

`npm run dev:cognito` の `DEV_USERS`（`src/lib/server/auth/providers/cognito-dev.ts`）に、MFA 未設定の ops アカウント `ops-no-mfa@example.com` がある。これでログインして `/ops` を開くと、本番と同じ判定経路を通って設定導線に着地する。
