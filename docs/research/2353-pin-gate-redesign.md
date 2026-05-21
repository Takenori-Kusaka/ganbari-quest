# #2353 PIN gate redesign — Deep Research summary

| 項目 | 値 |
|---|---|
| Issue | #2353 (PR #2325 / EPIC #2310 follow-up、PO 直接指摘 2026-05-21) |
| Wave | 28 (A: Phase A Critical hotfix / B: Phase B-E 構造改修、本 PR) |
| 著者 | Dev session (Claude Opus 4.7) |
| 日付 | 2026-05-21 |
| 関連 ADR | ADR-0050 (cookie-signature) §4 補論で本リサーチ結論を恒久化 |

## 1. 背景

PR #2325 で EPIC #2310 (Parent-Gate PIN gate) を merge した直後、PO から **設計欠陥 6 点** が直接指摘 (Issue #2353)。本 PR では Phase B + C + D + E (Phase A は別 PR で並行) を 1 PR で完遂する。

## 2. 設計欠陥 vs 解消方針

| # | 欠陥 | Phase | 解消方針 |
|---|------|-------|----------|
| 1 | エラー banner 残存 bug (cookie state) | A (別 PR) | Phase A 担当 |
| 2 | SSOT 違反 (gatePinRequiredBanner 等が atom 未経由) | B | OYAKAGI_TERMS / PIN_DEFAULT_TERMS atom 新設 + labels.ts 全 entry を template literal 経由化 |
| 3 | ひらがな表記 (おやのかんりがめん) | B | SWITCH_PAGE_LABELS.adminLink を `${ADMIN_VIEW_TERMS.parent}` 経由 (= 「保護者の見守り画面」) |
| 4 | PIN 忘れ救済導線なし | C | SES magic link + jose JWT 30 分 token + 1 回限り (本 doc §3 で機構選定) |
| 5 | 初期 PIN 5086 ヒント表示の脆弱性 | B+C | gateDefaultHint を空文字に + Svelte 側 `{#if hint}` 条件分岐 + setup / onboarding でのみ表示 |
| 6 | 初心者導線不足 (onboarding dialog) | D | (child) layout mount + settings.pin_gate_onboarding_seen persist + dialog 1 回表示 |

## 3. Fix 4 (PIN reset) 機構選定 — OSS 比較 (#1350 / ADR-0014)

業界 prior art:

| 製品 | reset 機構 |
|---|---|
| Auth0 | signed token (JWT-like) + email magic link + 1h TTL |
| Cognito ForgotPassword API | verification code (6 digit) + email + 1h TTL |
| NextAuth Email provider | signed JWT + email magic link + 24h TTL |
| WordPress | signed key + email link + 24h TTL |
| 1Password / Bitwarden | account recovery (master pwd reset 不可、別経路) |
| Apple Screen Time | iCloud Apple ID 経由 reset |

共通パターン: **signed token + email magic link + 1 回限り consume**。

### OSS 選定 (jose 採用、ADR-0050 §2 β 再評価)

ADR-0050 §2 で `jose` を session token として棄却 (revoke 不可で OWASP 非推奨) したが、**reset token は別カテゴリ**:

| 観点 | session token | reset token |
|---|---|---|
| 寿命 | 長期 (sliding 15min〜24h) | 短命 (30 分固定) |
| revoke 要件 | あり (logout / 認可剥奪) | なし (1 回限り消費で完結) |
| stateless 適合 | 不適 | 適 (JTI consume で 1 回限り) |

jose は本 EPIC で既存 dependency (Cognito JWT 検証で使用、`package.json` L24)、bundle 増 0。

### 採用比較表 (#1350 OSS 先調査整合)

| 選択肢 | 採用 | 理由 |
|---|---|---|
| **A: jose JWT (HS256) + JTI consume** (採用) | ✓ | 既存 dep / aud 分離で cookie session と混用防止 / Auth0 / NextAuth 同パターン |
| B: 独自 HMAC + base64 (cookie-signature 流用) | ✗ | jose の方が JWT 標準 claims (`exp` / `jti`) があり expiry 検証 / consume tracking が明確 |
| C: Cognito ForgotPassword API | ✗ | local mode (NUC) は Cognito 未使用、cognito mode 限定では本 EPIC 全体 (local + cognito 同設計) と不整合 |
| D: iron-session | ✗ | 暗号化機構を含むが本 reset token に PII なし (tid / email のみ)、overkill |

### secret 戦略

既存 `PARENT_GATE_COOKIE_SECRET` を流用:
- 両用途とも HMAC-SHA256、同信頼境界
- aud 分離 (`parent-gate-session` vs `parent-gate-pin-reset`) で混用構造防止
- 新規 env 追加なし = ADR-0029 (env 配布証跡) 運用負荷増えず

### enumeration 防止

`/api/v1/parent-gate/reset/request` は email 未登録 / SES 失敗時も 200 を返す (1Password / Bitwarden / Apple 同一パターン)。IP-based rate limit 5 req / 15 min per IP。

## 4. Fix 6 (onboarding dialog) 設計

### state SSOT 選択

| 選択肢 | 採用 | 理由 |
|---|---|---|
| **A: settings table tenant scope (pin_gate_onboarding_seen)** (採用) | ✓ | 既存 settings-repo 再利用 / 家族 owner/parent/child 横断 / デバイス間同期可能 |
| B: localStorage | ✗ | デバイス別、家族メンバー別 → tenant 単位の onboarding 完了状態を SSOT 化できない |
| C: child-scope の persist | ✗ | 親が tenant scope で 1 回見たら家族全員が以後非表示にすべき |

### dialog trigger

(child) layout mount で `data.pinGateOnboardingSeen === false` 時に開く。baby モード除外 (ADR-0011 ゲーミフィケーション非適用)。

### checkbox + persist

「今後表示しない」既定 ON。close 時に `POST /api/v1/settings/pin-gate-onboarding` で `'true'` persist。失敗時は次回再表示 (silent retry)。

## 5. 設計書同期 (Phase E)

| 設計書 | 追加 / 変更内容 |
|---|---|
| `docs/decisions/0050-parent-gate-session-cookie-signature.md` | §4 補論 (PIN reset 機構) / §4 補論 2 (onboarding) / §4 補論 3 (SSOT 違反 + 5086 ヒント削除) |
| `docs/design/14-セキュリティ設計書.md` | §4.4 (PIN reset 機構) / §4.5 (PIN 初期値取扱い) / §4.6 (onboarding dialog) |
| `docs/design/06-UI設計書.md` | §4.6 全面拡張 (4.6.1-4.6.4 = PIN gate modal / reset / onboarding + 旧称) |
| `docs/design/parallel-implementations.md` | §6.5 PIN gate ペア表に reset / onboarding 系 8 ファイル追加 |
| `docs/DESIGN.md` §6 | `terms.ts` 自動再生成 (OYAKAGI_TERMS / PIN_DEFAULT_TERMS 追加) |

## 6. E2E spec 拡張

`tests/e2e/parent-gate.spec.ts` (PARENT_GATE_FORCE_ACTIVE=true 時のみ実行):

| testcase | 検証 AC |
|---|---|
| AC3 (SSOT 整合): banner 文言が atom 経由で組み立てられる | AC3 |
| AC4 (漢字化): /switch link に「保護者の見守り画面」が含まれる | AC4 |
| AC5 (PIN reset): PIN modal の「PINを忘れた方」link が /auth/forgot-pin に遷移 | AC5 |
| AC5 (PIN reset): forgot-pin で未登録 email も success state | AC5 (enumeration 防止) |
| AC5 (PIN reset): forgot-pin email format 不正は INVALID_EMAIL | AC5 |
| AC5 (PIN reset): reset-pin/[token] invalid token は TOKEN_INVALID | AC5 |
| AC6 (5086 削除): PIN modal に「5086」「がんばり」が表示されない | AC6 |
| AC7 (onboarding): 子供画面初回遷移時に onboarding dialog 表示 + checkbox + close persist | AC7 |

## 7. AC 進捗

| AC | 内容 | Phase | 進捗 |
|----|------|-------|------|
| AC1 | Deep Research 実施 | E | ✓ (本 doc) |
| AC2 | banner 残存 bug 修正 + E2E 回帰 | A (別 PR) | 別 PR |
| AC3 | SSOT 違反監査 | B | ✓ |
| AC4 | ひらがな表記漢字化 | B | ✓ |
| AC5 | PIN 忘れ救済導線 | C | ✓ |
| AC6 | 初期 PIN 5086 ヒント削除 | B+C | ✓ |
| AC7 | 初心者導線ダイアログ | D | ✓ |
| AC8 | ADR-0050 + ADR-0010 §7 PIN gate checklist 追加 | E | ✓ (ADR-0050 §4 補論 1-3 で代替) |
| AC9 | E2E spec 拡充 | E | ✓ (8 testcase 追加) |
| AC10 | 設計書同期 | E | ✓ (14-セキュリティ / 06-UI / parallel-implementations) |

## 8. 関連リンク

- Issue: #2353
- PR (本 Phase B-E): TBD
- 並行 PR (Phase A): Wave 28-A
- EPIC: #2310
- 起因 PR: #2325
- 関連 ADR: ADR-0010 (Pre-PMF) / ADR-0014 (OSS 先調査) / ADR-0045 (terms SSOT) / ADR-0050 (cookie-signature)
