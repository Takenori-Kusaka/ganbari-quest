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

## 7. 関連 ADR

- ADR-0010 (Pre-PMF Bucket A: 実害防止、本 EPIC のセキュリティ機構選定根拠)
- ADR-0014 (i18n / OSS 先調査原則、本 ADR の 4 件比較で適用)
- #1350 (OSS 先調査ルール、本 ADR が機能別判定チェックリストの実例)
