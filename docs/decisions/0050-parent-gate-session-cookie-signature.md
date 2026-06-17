# 0050. Parent-Gate Session Cookie 署名方式: cookie-signature (OSS 4 件比較)

| 項目 | 内容 |
|------|------|
| ステータス | accepted (2026-06-17 §7 改訂: federated PIN reset を recent-login → email-OTP に置換、#3070) |
| 日付 | 2026-05-20 |
| 起票者 | Dev session (Claude) |
| 関連 Issue | #2310 (EPIC Phase Parent-Gate) / #2313 (本 ADR 起票元) / #2353 / EPIC #2990 |

## 1. 設計背景

EPIC #2310 で `/admin/*` route に PIN gate + 15 分 sliding session を導入する際、PIN 認証後の short-lived session を表現する httpOnly cookie の改ざん防止機構が必要になった。NIST SP 800-63B-4 (AAL1) + OWASP Session Management Cheat Sheet 整合の最低要件は「サーバ署名 cookie」。

既存 `src/lib/server/services/auth-service.ts` の session は DB-side (settings.session_token) で管理されており、PIN 再確認のたびに DB round-trip が発生する設計。本 EPIC の sliding refresh は「各 admin リクエストで lastActiveAt 更新」を要求するため、DB round-trip 増加を避けて **stateless signed cookie** で表現するのが Pre-PMF 軽量解。

## 2. 検討した選択肢 (OSS 4 件、#1350 / ADR-0014 整合)

### α (採用): `cookie-signature` (Express 標準ライブラリ)

- 概要: `npm install cookie-signature`、HMAC-SHA256 で sign/unsign する 100 行未満の薄いラッパー。Express の `cookie-parser` が内部で使用、Node.js エコシステムで実績 16 年超
- 採用実績: weekly downloads 27M+、Express / connect / cookie-parser 公式依存
- メリット: bundle size <1KB (zero dependencies) / API は `sign` / `unsign` の 2 関数のみで misuse が起きにくい / SvelteKit の `cookies.set` / `cookies.get` 標準 API と直接互換 / types は `@types/cookie-signature`
- デメリット: 暗号化はしない (HMAC 署名のみ、cookie 値は base64 で読める) — ただし cookie payload は `{tenantId, verifiedAt, lastActiveAt}` で PII 含まず、改ざんは署名検証で拒否される
- Pre-PMF コスト: 導入工数 < 1h、学習コスト ほぼゼロ、bundle 影響ほぼゼロ、長期保守性 ◎ (16 年安定)

### β (不採用): `jose` (JWT/JWS/JWE)

- 概要: JWT (HS256/RS256/EdDSA) / JWE 暗号化対応の業界標準。weekly downloads 5M+、auth0 / supabase-js が内部使用
- メリット: 標準化された claims (`exp` / `iat` / `nbf` 等)、stateless で expiry 検証も組込
- デメリット: bundle ~15KB / JWT は **session token としては OWASP 非推奨** (revoke 不可、ローテーション運用が重い) / 4 桁 PIN gate の short-lived session に対して overkill
- Pre-PMF コスト: 導入工数 半日 (claims 設計 + key 管理)、学習コスト 中、bundle +15KB

### γ (不採用): `iron-session`

- 概要: AES-GCM 暗号化 + HMAC 署名の stateless session cookie。weekly downloads 400K+、Vercel 公式 example
- メリット: 暗号化 cookie で PII 入れても安全、SvelteKit 公式 example も存在
- デメリット: bundle ~10KB / 本 EPIC の cookie payload に PII なし → 暗号化 overhead が無駄 / Next.js 中心の API で橋渡し layer が必要
- Pre-PMF コスト: 導入工数 半日 (config + storage abstraction)、bundle +10KB

### δ (不採用): `lucia-auth`

- 概要: full-stack auth framework (session / OAuth / passkey / 2FA)。weekly downloads 90K+
- メリット: 全機能込み、DB adapter 完備
- デメリット: bundle ~50KB + DB schema 強制 / 既存 Cognito + local auth と二重管理 / Pre-PMF で full framework は明らかに overkill (ADR-0010 Bucket A 違反)
- Pre-PMF コスト: 導入工数 2-3 日 (schema migration + adapter)、長期保守性 △ (framework lock-in)

## 3. 決定

**α `cookie-signature` を採用**する。理由:

1. **cookie payload は PII を含まない** (tenantId / verifiedAt / lastActiveAt の 3 fields のみ) ため、暗号化 (γ / δ) は overkill。改ざん防止だけ満たせば足りる
2. **bundle size 最小** (<1KB) で Pre-PMF (ADR-0010) と整合
3. **API 表面が極小** (2 関数のみ) で misuse リスクほぼゼロ
4. **Express ecosystem 16 年実績** で長期保守性 ◎
5. SvelteKit `cookies.set/get` との橋渡し layer 不要

## 4. cookie schema

```typescript
// payload (JSON.stringify 後 cookie-signature.sign する)
interface ParentSessionPayload {
  tenantId: string;      // テナント跨ぎ攻撃検出用
  verifiedAt: number;    // unix ms (発行時刻)
  lastActiveAt: number;  // unix ms (最終アクティブ、sliding refresh で更新)
}
```

Cookie 名 `gq_parent_session` / `httpOnly + sameSite=lax + secure(本番)` / maxAge 24h (hard max) + 15 分 inactivity sliding 失効 (NIST SP 800-63B-4 AAL1 + Apple Screen Time 整合)。各 `/admin/*` request で `+layout.server.ts` が検証 + `lastActiveAt` 更新 + 再 sign する。属性・timeout・有効化条件の運用仕様表は `docs/design/14-セキュリティ設計書.md` §4.3 が SSOT。

## 5. 署名キー管理 + 配布証跡 (ADR-0006 / ADR-0029 / #2337)

`process.env.PARENT_GATE_COOKIE_SECRET` で署名キーを管理。production 未設定なら起動時 throw、dev のみ警告ログ + 固定 dev secret に fallback。生成: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`。平文コミット厳禁。

PR #2325 マージ後、本 env が本番 Lambda 未配備で `/admin/*` cold start throw → 500 連発 (2026-05-20)。#2337 で CDK SSOT 化 + 配布証跡 4 経路完備を恒久化:

| # | 配布先 | SSOT パス |
|---|---|---|
| 1 | GitHub Actions Secrets | `gh secret set PARENT_GATE_COOKIE_SECRET --body <hex>` |
| 2 | AWS Lambda env (production) | `infra/lib/compute-stack.ts` (CDK context 経由) |
| 3 | NUC `.env` 自動生成 | `.github/workflows/deploy-nuc.yml` Set-Content |
| 4 | CI / test | `.env.test` 固定値 (再現性確保) |

`scripts/check-new-required-env.mjs` の env 検出 regex は PR #2325 で `env var is required` 表現を漏らした → #2337 で 4 パターンに拡張 (regress test: `tests/unit/scripts/check-new-required-env.test.ts`)。

## 6. 結果

- 子 #2313 で `cookie-signature` 採用、`src/lib/server/services/parent-gate-session.ts` 実装
- 既存 `verifyPin` (auth-service.ts) は流用、本 ADR は cookie 機構のみを規定
- bundle 増加 < 1KB
- 将来 PII を cookie payload に含める要件が出た場合は γ `iron-session` への乗換を ADR で議論する (本 ADR を supersede)

## 7. PIN reset 機構の supersede 記録 (#2353 → EPIC #2990)

#2353 で本 ADR に追補した **SES email magic link + jose JWT reset token 機構** (30 分 exp + JTI consume + enumeration 防止) は、EPIC #2990 で全面置換され実装削除済 (#2993)。email 手入力の冗長さと local モードでメールが届かない (sendEmail no-op) 構造欠陥の根治のため、回復チャネルは以下のモード分岐に確定した:

| モード | 回復チャネル | 実装 |
|---|---|---|
| cognito (SaaS) — password ユーザ | アカウントパスワード再入力 → PIN 再作成 (#2993、Apple Screen Time 同型)。email はセッション既知のため手入力なし | `/auth/reset-pin` + `reset-verified` API |
| cognito (SaaS) — federated (Google) ユーザ | **登録メールへ 6 桁の確認コード (email-OTP) → 入力で PIN 再作成** (#3070)。Cognito は `prompt=login` を IdP に転送しないため recent-login (#3025) は共有端末で silent SSO 無入力通過し得る穴があり、子がアクセスできない email を確認材料にして塞ぐ。OTP は DB 非保存で、code ハッシュ + 失効 (10 分) + tenantId + attempts を `cookie-signature` 署名 httpOnly cookie に格納する stateless 方式 (本 ADR の署名機構を流用、schema 変更なし)。6 桁 / consume-once / 試行 5 回上限 / enumeration 防止 | `/auth/reset-pin` + `reset-request-code` (OTP 発行・送信) + `reset-verified` (OTP 検証) + `pin-reset-otp.ts` |
| local (self-host) | **operator reset が主機構** (#2994) — `PARENT_PIN_RESET` env (env-gated・冪等・env 無しは完全 no-op) で PIN を未設定状態に戻し、初回作成フロー (#2992) に合流させる。メール非依存 | `pin-operator-reset.ts` + `runbooks/operator-pin-reset.md` |

federated の本人確認は #3025 の requires-recent-login から #3070 で email-OTP に置換した (recent-login が共有端末 silent SSO で無入力通過し得る穴の根治)。現行仕様の SSOT は `docs/design/14-セキュリティ設計書.md` §4.3b〜4.4。旧 SES magic link / 旧 recent-login の設計は git 履歴で追跡。

**#2353 Fix5 (初期 PIN 5086 ヒント隠蔽) の前提変更 (#2992)**: 既定 5086 での gate login 自体を廃止し「初回は新規作成 (入力→確認)・既存は入力」に倒したため、「5086 を子供から隠す」制約は構造的に自然解消した (未設定 tenant に既定 PIN が存在しない)。ヒント表示は legacy local `changePin` 文脈の PIN 変更画面のみに残る (14-セキュリティ設計書 §4.3「初期 PIN ヒント表示ポリシー」)。

#2353 で同時に追補した onboarding dialog (設計欠陥 6) / labels SSOT 監査 (設計欠陥 2) の仕様は 14-セキュリティ設計書 §4.5 / 06-UI設計書 §4.6.3 / DESIGN.md §6 に移管済み。
