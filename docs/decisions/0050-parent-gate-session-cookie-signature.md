# 0050. Parent-Gate Session Cookie 署名方式: cookie-signature (OSS 4 件比較)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-20 |
| 起票者 | Dev session (Claude) |
| 関連 Issue | #2310 (EPIC Phase Parent-Gate) / #2313 (本 ADR 起票元) |

## 1. 設計背景

EPIC #2310 で `/admin/*` route に PIN gate + 15 分 sliding session を導入する際、PIN 認証後の short-lived session を表現する httpOnly cookie の改ざん防止機構が必要になった。NIST SP 800-63B-4 (AAL1) + OWASP Session Management Cheat Sheet 整合の最低要件は「サーバ署名 cookie」。

既存 `src/lib/server/services/auth-service.ts` の session は DB-side (settings.session_token) で管理されており、PIN 再確認のたびに DB round-trip が発生する設計。本 EPIC の sliding refresh は「各 admin リクエストで lastActiveAt 更新」を要求するため、DB round-trip 増加を避けて **stateless signed cookie** で表現するのが Pre-PMF 軽量解。

## 2. 検討した選択肢 (OSS 4 件、#1350 / ADR-0014 整合)

### α (採用): `cookie-signature` (Express 標準ライブラリ)

- 概要: `npm install cookie-signature`、HMAC-SHA256 で sign/unsign する 100 行未満の薄いラッパー。Express の `cookie-parser` が内部で使用、Node.js エコシステムで実績 16 年超
- 採用実績: weekly downloads 27M+、Express / connect / cookie-parser 公式依存
- メリット:
  - bundle size <1KB (zero dependencies)
  - API は `sign(val, secret)` / `unsign(val, secret)` の 2 関数のみ、misuse が起きにくい
  - SvelteKit の `cookies.set` / `cookies.get` 標準 API と直接互換
  - TypeScript types は `@types/cookie-signature` で提供 (DefinitelyTyped)
- デメリット:
  - 暗号化はしない (HMAC 署名のみ、cookie 値は base64 で読める)
  - → ただし本 EPIC の cookie payload は `{tenantId, verifiedAt, lastActiveAt}` で PII 含まず、攻撃者に値が見えても問題なし (改ざんは署名検証で拒否される)
- Pre-PMF コスト: 導入工数 < 1h、学習コスト ほぼゼロ、bundle 影響ほぼゼロ、長期保守性 ◎ (16 年安定)

### β (不採用): `jose` (JWT/JWS/JWE)

- 概要: `npm install jose`、JWT (HS256/RS256/EdDSA) / JWE 暗号化対応の業界標準
- 採用実績: weekly downloads 5M+、auth0 / supabase-js が内部使用
- メリット: 標準化された claims (`exp` / `iat` / `nbf` 等)、stateless で expiry 検証も組込
- デメリット:
  - bundle ~15KB (ES module、subtle crypto 経由)
  - JWT は **session token としては OWASP 非推奨** (revoke 不可、ローテーション運用が重い、stateless session の anti-pattern)
  - 4 桁 PIN gate の short-lived session に対して overkill
- Pre-PMF コスト: 導入工数 半日 (claims 設計 + key 管理)、学習コスト 中、bundle +15KB

### γ (不採用): `iron-session`

- 概要: `npm install iron-session`、AES-GCM 暗号化 + HMAC 署名で stateless session cookie を実現する Next.js コミュニティ標準
- 採用実績: weekly downloads 400K+、Vercel 公式 example
- メリット: 暗号化 cookie で PII 入れても安全、SvelteKit 公式 example も存在
- デメリット:
  - bundle ~10KB
  - 本 EPIC の cookie payload に PII なし → 暗号化 overhead が無駄
  - Next.js 中心の API、SvelteKit `cookies` 標準 API への橋渡し layer が必要
- Pre-PMF コスト: 導入工数 半日 (config + storage abstraction)、bundle +10KB

### δ (不採用): `lucia-auth`

- 概要: full-stack auth framework (session / OAuth / passkey / 2FA)
- 採用実績: weekly downloads 90K+、SvelteKit 公式 tutorial で言及
- メリット: 全機能込み、DB adapter 完備
- デメリット:
  - bundle ~50KB + DB schema 強制 (sessions / users / keys table)
  - 既存 Cognito + local auth と二重管理になる
  - Pre-PMF で full framework は明らかに overkill (ADR-0010 Bucket A 違反)
- Pre-PMF コスト: 導入工数 2-3 日 (schema migration + adapter)、長期保守性 △ (framework lock-in)

## 3. 決定

**α `cookie-signature` を採用**する。理由:

1. **本 EPIC の cookie payload は PII を含まない** (tenantId / verifiedAt / lastActiveAt の 3 fields のみ) ため、暗号化 (γ / δ) は overkill。改ざん防止だけ満たせば足りる
2. **bundle size 最小** (<1KB) で Pre-PMF (ADR-0010) と整合
3. **API 表面が極小** (2 関数のみ) で misuse リスクほぼゼロ
4. **Express ecosystem 16 年実績** で長期保守性 ◎
5. SvelteKit `cookies.set/get` との橋渡し layer 不要

## 4. cookie schema + timeout 仕様

```typescript
// payload (JSON.stringify 後 cookie-signature.sign する)
interface ParentSessionPayload {
  tenantId: string;      // テナント跨ぎ攻撃検出用
  verifiedAt: number;    // unix ms (発行時刻)
  lastActiveAt: number;  // unix ms (最終アクティブ、sliding refresh で更新)
}

// HTTP Cookie
// Name:     'gq_parent_session'
// Value:    signed(base64(JSON.stringify(payload)))
// Path:     '/'
// HttpOnly: true
// Secure:   COOKIE_SECURE (Lambda / NUC で切替、src/lib/server/cookie-config.ts)
// SameSite: 'lax'
// MaxAge:   60 * 60 * 24 (24 時間 hard max、ただし lastActiveAt で 15 分 sliding 失効)
```

### timeout 設計

| 項目 | 値 | 根拠 |
|------|-----|------|
| INACTIVITY_TIMEOUT_MS | 15 分 | NIST SP 800-63B-4 AAL1 推奨 + Apple Screen Time + BusyKid 業界整合 |
| MAX_SESSION_MS | 24 時間 | hard max、cookie maxAge と一致。家庭利用文脈で daily reset が自然 |

### sliding refresh

```typescript
// 各 /admin/* request で +layout.server.ts が呼ぶ
await verifyParentSession(cookie, tenantId);  // 検証
await refreshParentSession(cookie);           // lastActiveAt 更新 + 再 sign
```

## 5. 署名キー管理

`process.env.PARENT_GATE_COOKIE_SECRET` で署名キーを管理。

- **本番 (Lambda)**: AWS Systems Manager Parameter Store / Secrets Manager から注入
- **NUC**: `.env.local` で local 固定値
- **CI / test**: `.env.test` で固定値 (test 結果の再現性確保)
- **未設定時の fallback**: `dev` モードのみ警告ログを出して固定 dev secret を使う。**production で未設定なら起動時に throw**

## 6. 結果

- 子 #2313 で `cookie-signature` 採用、`src/lib/server/services/parent-gate-session.ts` 実装
- 既存 `verifyPin` (auth-service.ts) は流用、本 ADR は cookie 機構のみを規定
- bundle 増加 < 1KB
- 将来 PII を cookie payload に含める要件が出た場合は γ `iron-session` への乗換を ADR で議論する (本 ADR を supersede)

## 4.補. PIN reset 機構 (#2353 設計欠陥 4 — 2026-05-21 追記)

PR #2325 マージ後の運用観察で、PIN 忘れ救済導線が無く本番 user が permanent lockout 状態に陥る設計欠陥が PO から指摘 (#2353)。業界標準 (Auth0 / Cognito password reset / NextAuth Email provider / WP password reset) の SES magic link + signed token + DB consume 記録パターンで補強する。

### reset token 機構選定 (jose JWT 採用、§2 β を再評価)

§2 β `jose` は **session token としては** OWASP 非推奨で棄却したが、**reset token は別カテゴリ**:

| 観点 | session token (§2 棄却理由) | reset token (本節で採用) |
|---|---|---|
| 寿命 | 長期 (sliding 15 分〜24h) | 短命 (30 分固定) |
| revoke 要件 | あり (logout / 認可剥奪) → DB 不可避 | なし (1 回限り消費で完結) |
| 状態管理 | 各 request で更新 (DB round-trip 嫌う) | 発行 / 消費の 2 回のみ |
| stateless 適合 | 不適 (revoke 不可) | 適 (1 回限り JTI consume) |

本用途では JWT の `exp` / `jti` が標準パターンで適合するため、`jose v6` の `SignJWT` / `jwtVerify` を採用 (既存 dependency、bundle 増加なし)。

### token schema + lifecycle

```typescript
// JWT payload (HS256、PARENT_GATE_COOKIE_SECRET で署名 = §5 と同 secret)
{
  tid: string,        // tenantId
  email: string,      // 送信先 email
  jti: string,        // 32 hex (128 bit エントロピー)、JTI consume key
  iss: 'ganbari-quest',
  aud: 'parent-gate-pin-reset',  // cookie session token と aud 分離で混用防止
  iat: number,
  exp: number,        // iat + 30 分
}
```

### consume 機構

`settings` table の tenant scope key `pin_reset_jti_consumed:<jti>` に 'true' を書き込んで 1 回限り消費。verify 時に同 key 存在チェック → 'true' なら `TOKEN_ALREADY_USED` 返却。

### secret 流用判断

cookie session token (§5) と同じ `PARENT_GATE_COOKIE_SECRET` を使う:

- 両方とも HMAC-SHA256 で構造的に同信頼境界
- aud 分離 (`parent-gate-session` vs `parent-gate-pin-reset`) で token 種別を区別
- 新規 env 追加せず、§6.1 の配布証跡 4 経路を流用 = 運用負荷増えず

### enumeration 防止

`POST /api/v1/parent-gate/reset/request` は email 未登録 / SES 失敗時も 200 を返す:

- email 登録有無を外部から判別不可
- 1Password / Bitwarden / Apple 同一パターン
- IP-based rate limit: 5 req / 15 min per IP

### Pre-PMF 軽量化適合

JTI consume 行は settings table に永続蓄積されるが、Pre-PMF 段階で user 数 × reset 試行回数 のオーダーが小さいため、定期 cleanup cron は実装しない (ADR-0010 Bucket B 過剰防衛回避)。将来 user 数増加時に別 Issue で cleanup batch を起票する。

## 4.補.2 PIN gate 初心者導線 onboarding dialog (#2353 設計欠陥 6 — 2026-05-21 追記)

setup 完了後の子供画面初回遷移時に PIN gate 機構を未学習の保護者が「子供画面に入ったら戻れない」と誤認する課題への構造的解消。

- (child)/+layout.server.ts で settings.pin_gate_onboarding_seen を読み、未保存なら dialog 表示要を data に返す
- (child)/+layout.svelte で初回 mount 時 dialog 表示 (PIN_GATE_ONBOARDING_LABELS 経由)
- 「今後表示しない」checkbox で POST /api/v1/settings/pin-gate-onboarding → 'true' persist
- baby モードはゲーミフィケーション非適用 (ADR-0011) のため対象外

dialog 表示要否を localStorage ではなく settings table で SSOT 化することで、家族 owner / parent / child 横断、デバイス間も同期可能とする。

## 4.補.3 SSOT 違反監査と labels.ts 整備 (#2353 設計欠陥 2 — 2026-05-21 追記)

PR #2325 で導入された OYAKAGI_LABELS が `labels.ts` compound に直接ハードコード (gateModalDescription 等) されており、ADR-0045 §3.3 違反が検出された。本 ADR では `OYAKAGI_TERMS` / `PIN_DEFAULT_TERMS` atom を独立化し、`OYAKAGI_LABELS` 全 entry を `${ADMIN_VIEW_TERMS.canonical}` / `${OYAKAGI_TERMS.name}` template literal 経由化することで、「カギ → ロック」「コード → 暗証番号」等の用語変更が 1 行で全箇所に伝播する状態を再確立した。

### gate modal 初期 PIN 5086 ヒント削除 (#2353 設計欠陥 5)

`OYAKAGI_LABELS.gateDefaultHint` を空文字に変更し、Svelte 側で空文字なら表示しない条件分岐とすることで、**子供が gate modal を見て即入力できる脆弱性**を解消した。初期 PIN ヒントは setup 完了画面 / onboarding dialog (`PIN_GATE_ONBOARDING_LABELS.dialogPinHint`) でのみ伝達する (子供が見える文脈に出さない)。

## 6.1 Secret 配布証跡 (ADR-0006 / ADR-0029 / #2337)

PR #2325 マージ後、`PARENT_GATE_COOKIE_SECRET` env が本番 Lambda 未配備で `/admin/*` cold start throw → 500 連発 (2026-05-20)。User が `aws lambda update-function-configuration` + `gh secret set` で緊急復旧。#2337 で CDK SSOT 化 + 配布証跡 4 経路完備を恒久化。

| # | 配布先 | SSOT パス |
|---|---|---|
| 1 | GitHub Actions Secrets | `gh secret set PARENT_GATE_COOKIE_SECRET --body <hex>` |
| 2 | AWS Lambda env (production) | `infra/lib/compute-stack.ts` L204-208 (CDK context 経由) |
| 3 | NUC `.env` 自動生成 | `.github/workflows/deploy-nuc.yml` Set-Content |
| 4 | 本番 Lambda 直接配備 | 2026-05-20 user 緊急 hotfix (CDK で永続化済) |

`scripts/check-new-required-env.mjs` の env 検出 regex は PR #2325 で `env var is required` 表現を漏らした → #2337 で `<ENV> (env var|environment variable|secret)? is required` 4 パターンに拡張、regress test は `tests/unit/scripts/check-new-required-env.test.ts`。

生成: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`。平文コミット厳禁。

## 7. 関連 ADR

- ADR-0010 (Pre-PMF Bucket A: 実害防止、本 EPIC のセキュリティ機構選定根拠)
- ADR-0014 (i18n / OSS 先調査原則、本 ADR の 4 件比較で適用)
- #1350 (OSS 先調査ルール、本 ADR が機能別判定チェックリストの実例)
