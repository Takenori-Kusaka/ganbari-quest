# PIN 認証 legacy 段階的削除 計画 (#2396 / #0134 follow-up)

| 項目 | 内容 |
|---|---|
| ステータス | accepted (計画策定段階、削除実施は本ドキュメントに記載なし) |
| 日付 | 2026-05-22 |
| 起票者 | PO + Claude (Dev 補佐) |
| 関連 Issue | #2396 (本 Issue、umbrella) / #0134 (legacy 段階削除予告コメント発生元) |
| 関連 ADR | ADR-0050 (Parent-Gate cookie 署名、PIN 流用根拠) / ADR-0010 (Pre-PMF scope) / ADR-0028 (archive、retention 物理削除パターン) |

---

## 1. 設計背景

### 1.1 出発点と実態の乖離

Issue #2396 は「`#0134 で段階的に削除予定` コメントが PIN 認証関連コードに散在しているため、Phase 1 (warning log) / Phase 2 (新規 fallback 停止) / Phase 3 (verify reject) で段階削除する」前提で起票された。

しかし `grep -rn "#0134" src/` を全件抽出した結果、コメント該当箇所は **1 ファイル 1 行のみ** であり、しかも PIN 認証機構そのものは **EPIC #2310 / ADR-0050 (Parent-Gate cookie 署名、2026-05-20 accepted)** で能動的に再利用される基盤となっている。

つまり「段階的に削除予定」という当時のコメントは、その後の Parent-Gate 機構の進化で **前提が崩れ、削除対象ではなく現役 SSOT に転じている**。

### 1.2 grep 全件抽出結果

```bash
$ grep -rn "#0134" src/
src/lib/domain/validation/auth.ts:8: // --- 後方互換: PIN認証関連（#0134で段階的に削除予定） ---

$ grep -rn "legacy.*[Pp]in|[Pp]in.*legacy" src/
(0 件)
```

| # | path:line | 種別 | コメント / コード | 判定 |
|---|---|---|---|---|
| 1 | `src/lib/domain/validation/auth.ts:8` | コメント | `// --- 後方互換: PIN認証関連（#0134で段階的に削除予定） ---` | **削除不可・コメント書換** (理由は §2 / §3) |

### 1.3 PIN 認証コードの現状利用箇所 (能動再利用)

`auth.ts:8-26` 配下の定数 / schema は、削除予定どころか以下 6 箇所で能動利用されている:

| 利用元 | 用途 | 根拠 |
|---|---|---|
| `src/routes/api/v1/auth/login/+server.ts` | `loginSchema` 経由のおやカギコード login | NUC ローカル認証 (`docs/design/14-セキュリティ設計書.md §4.2`) |
| `src/routes/(parent)/login/+page.server.ts` | 同上 form action | 同上 |
| `src/routes/api/v1/parent-gate/verify/+server.ts` | `verifyPin` 流用 → `gq_parent_session` 発行 | **EPIC #2310 / ADR-0050 §4.3 (新規)** |
| `src/routes/api/stripe/portal/+server.ts` | `verifyPin` 経由の二段階確認 (破壊的操作 gate、#771) | `auth-service.ts:99-106` PIN 再確認用途 |
| `src/routes/api/v1/parent-gate/reset-verified/+server.ts` | `setupPin` 流用 → 新 PIN hash 保存 (パスワード re-auth 後、#2993) | **14-セキュリティ設計書 §4.4** |
| `src/lib/server/services/auth-service.ts` `login` / `verifyPin` / `setupPin` / `isPinConfigured` | 上記すべての裏側 | bcrypt + DEFAULT_PIN フォールバック (#1360) |

---

## 2. 設計原則

### 2.1 「legacy」という呼称の再定義

ADR-0050 受理 (2026-05-20) 以降、PIN 認証は **legacy ではなく Parent-Gate の基盤** として再生した。本計画では:

- 「**Path 1 (auth.ts:8 コメント)**」を「段階削除予定」表現から「Parent-Gate (ADR-0050) で能動利用中、削除予定なし」に書き換える
- Phase 1/2/3 の段階削除実装は **着手しない** (前提崩壊のため)
- 代わりに「PIN 機構の現役 SSOT 化」を完了させる (本計画 §3 で sub-Issue 起票)

### 2.2 Pre-PMF 適合 (ADR-0010)

Pre-PMF Bucket B (技術負債整理) 評価で本計画を再評価した結果、以下の理由で「段階削除工数」より「現役 SSOT 化工数」の方が ROI が高い:

- **削除した場合**: NUC ローカル認証 / Parent-Gate / Stripe portal 二段階確認 / PIN reset が全て破綻 → ユーザー数 ≪ 20 名 / 月でも acquisition が事実上 0 になる
- **現役 SSOT 化した場合**: 工数 ≤ 1 PR (本計画 + Phase A コメント書換のみ)、保守コスト constant、acquisition 影響なし

### 2.3 「#0134 で段階的に削除予定」コメントの歴史的価値

git blame で当時の判断を保全。削除ではなく「reframe」する (`-` → `+` の 1 行 diff、ADR-0050 への link 追加)。

---

## 3. 削除可否判定表

| # | path:line | 判定 | 理由 | Phase 割当 |
|---|---|---|---|---|
| 1 | `src/lib/domain/validation/auth.ts:8` | **削除不可・コメント書換 (Phase A)** | ADR-0050 で能動再利用、削除すると Parent-Gate / NUC ローカル認証 / Stripe portal 二段階確認 / PIN reset が破綻 | Phase A (本 follow-up Issue で実施) |
| (該当なし) | (Phase 1/2/3 対象は **0 件**) | — | grep 全件抽出で「段階削除対象 path」は §1.2 の 1 件のみ。当該 1 件は §3 #1 判定で書換確定 | — |

**結論**: Issue #2396 で想定された「Phase 1 (warning log) / Phase 2 (新規 fallback 停止) / Phase 3 (verify reject)」の 3 段階削除は、対象コード散在が事実上存在しないため **実施しない**。

---

## 4. sub-Issue 起票計画

Issue #2396 で計画した Phase 1/2/3 sub-Issue は **起票しない**。代わりに以下 1 件のみ起票:

| sub-Issue | タイトル | 内容 | Blocked by | 工数 |
|---|---|---|---|---|
| **Phase A (新規)** | refactor: `auth.ts:8` コメント reframe (`#0134 段階削除予定` → ADR-0050 能動利用) | `src/lib/domain/validation/auth.ts:8` の 1 行コメントを書き換え。git blame 保全 + ADR-0050 への link 追加 | #2396 (本 umbrella) | ≤ 30 分 |

**起票しない (Phase 1/2/3)**: 段階削除前提が崩壊しているため、起票自体が「現実と乖離した負債」を増やす行為になる。Pre-PMF Bucket B 不適合 (ADR-0010 §3)。

> **本 PR では Phase A sub-Issue 起票も保留する**: 本 PR は「計画策定 + 設計書同期」のみで完結し、コメント書換実 PR は Phase A sub-Issue で別 PR (≤ 30 分工数) として後続実施する。

---

## 5. 既存設計書との整合

| 設計書 | 更新内容 |
|---|---|
| `docs/design/14-セキュリティ設計書.md` §4.2 / §4.3 / §4.4 | PIN 機構が legacy ではなく Parent-Gate / PIN reset / NUC ローカル認証の **現役 SSOT** であることを再確認する 1 行を追記 (§4.2 末尾) |

---

## 6. 完了条件 (本計画 doc 自体)

- [x] grep 全件抽出結果を §1.2 に記載 (1 件のみ)
- [x] 削除可否判定表を §3 に記載 (Phase 1/2/3 対象 0 件、Phase A 1 件)
- [x] sub-Issue 起票方針を §4 に記載 (Phase A のみ別 PR、本 PR では起票せず計画記載のみ)
- [x] 設計書同期方針を §5 に記載

## 7. 関連

- Issue #2396 (本 umbrella)
- Issue #0134 (legacy 削除予告コメント発生元、git history)
- ADR-0050 (Parent-Gate cookie 署名、PIN 流用根拠、2026-05-20 accepted)
- ADR-0010 (Pre-PMF scope 判断)
- `docs/design/14-セキュリティ設計書.md` §4.2-§4.5 (PIN 機構の現役利用 6 箇所)
