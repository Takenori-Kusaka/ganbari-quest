# account-deletion-flow.md — アカウント削除フロー仕様 (#746)

> アカウント削除は **5 つのパターン** に分岐する。本ドキュメントは各パターンの判定条件・UI フロー・サーバ側挙動・削除範囲・関連 Issue を 1 か所にまとめる SSOT である。実装は `src/lib/server/services/account-deletion-service.ts` および `src/routes/api/v1/admin/account/delete/+server.ts` を参照。

---

## 1. パターン一覧

| # | DeletionPattern | 実行条件 | 主な操作 | 関連 Issue |
|---|---|---|---|---|
| 1 | `owner-only` | role=owner かつ 他メンバーなし | テナント全削除 + Owner Cognito 削除 | #458, #739, #741 |
| 2a | `owner-with-transfer` | role=owner かつ 他メンバーあり | 権限を別メンバーに移譲 + Owner だけ離脱 | #458 |
| 2b | `owner-full-delete` | role=owner かつ 他メンバーあり（移譲しない） | 全データ削除 + 他メンバーは所属解除 + メール通知 | #458, #739, #741 |
| 3 | `child` | role=child 本人 | 子供アカウント切り離し + Cognito 削除 | #458 |
| 4 | `member` | role=parent（非 owner） | メンバーシップ削除 + Cognito 削除 | #458 |

> **注**: パターン 2 は内部的に 2a と 2b に分岐するが、API としては別々の DeletionPattern として渡す。UI では owner かつ他メンバーがいるとき、まず移譲ダイアログを表示し、ユーザーが「移譲」か「全削除」を選ぶ。

判定の擬似コード（`src/routes/(parent)/admin/settings/+page.svelte` の `handleDeleteAccount`）:

```ts
const role = $page.data.userRole;
if (role === 'owner') {
  if (deletionInfo.isOnlyMember) pattern = 'owner-only';
  else                            showTransferDialog = true; // → 2a または 2b を選択
} else if (role === 'child')      pattern = 'child';
else                              pattern = 'member';
```

---

## 2. データクリア範囲マトリクス（#739 連動）

各パターンで何が消えるかを下表で固定する。チェックなしは **削除されない**。

| 対象 | 1. owner-only | 2a. transfer | 2b. full-delete | 3. child | 4. member |
|------|---|---|---|---|---|
| Stripe Subscription（#741 必須） | ✔ | ✘ | ✔ | ✘ | ✘ |
| S3 / ストレージ（`tenants/{tenantId}/`） | ✔ | ✘ | ✔ | ✘ | ✘ |
| `deleteTenantScopedData` (activities, viewerTokens, cloudExports, pushSubscriptions, voice) | ✔ | ✘ | ✔ | ✘ | ✘ |
| 子供データ全件 (`deleteAllChildrenData`) | ✔ | ✘ | ✔ | ✘ | ✘ |
| 全メンバーシップ (`deleteAllMemberships`) | ✔ | ✘ | ✔ | ✘ | ✘ |
| 招待リンク (`revokeAndDeleteAllInvites`) | ✔ | ✘ | ✔ | ✘ | ✘ |
| テナント本体 (`deleteTenant`) | ✔ | ✘ | ✔ | ✘ | ✘ |
| 自分の Cognito ユーザー | ✔ | ✔ | ✔ | ✔ | ✔ |
| 自分の DB ユーザー (`auth.deleteUser`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 自分のメンバーシップ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **新オーナー昇格** (テナント `ownerId` 付け替え) | — | ✔ | — | — | — |
| 子供レコードと user の link 解除（`child.userId = null`） | — | — | — | ✔ | — |
| 他メンバーへのメール通知（`sendMemberRemovedEmail`） | — | — | ✔ | — | — |
| Discord 通知（`notifyDeletionComplete`） | ✔ | — | ✔ | — | — |

> **重要**: パターン 3 (`deleteChildAccount`) は子供レコード自体を削除しない（活動履歴・実績は残す）。代わりに `child.userId` を `null` にしてアカウントだけ切り離す。これは「子供がスマホを返した」「再ログインのため UID を作り直したい」等のケースを想定したもの。

---

## 3. Stripe キャンセル連動（#741 / ADR-0022）

ADR-0022 の原則に従い、**全データ削除を伴うパターン（1 / 2b）では DB 削除よりも先に Stripe Subscription をキャンセルする**。

**Pattern 1 (`deleteOwnerOnlyAccount` → `fullTenantDeletion`):**

```
fullTenantDeletion(tenantId, ownerId)
  └─ 0. cancelSubscription(tenantId)   ← 失敗したら throw → 以降の処理は走らない
  └─ 1. S3 削除 (deleteByPrefix)
  └─ 2. tenant scoped data 削除 (deleteTenantScopedData)
  └─ 3. children データ削除 (deleteAllChildrenData)
  └─ 4. 全メンバーの Cognito + DB ユーザー削除 (findTenantMembers → deleteCognitoUser + deleteUser)
  └─ 5. 全メンバーシップ削除 (deleteAllMemberships)
  └─ 6. 招待リンク無効化 + 物理削除 (revokeAndDeleteAllInvites)
  └─ 7. テナント削除 (deleteTenant)
  └─ 8. notifyDeletionComplete (失敗は無視)
```

**Pattern 2b (`deleteOwnerFullDelete` — `fullTenantDeletion` は呼ばない):**

```
deleteOwnerFullDelete(tenantId, ownerId)
  └─ 0. 他メンバー一覧 + メール情報を事前収集（削除後は取得不能）
  └─ 1. cancelSubscription(tenantId)   ← 失敗したら throw
  └─ 2. S3 削除 (deleteByPrefix)
  └─ 3. tenant scoped data 削除 (deleteTenantScopedData)
  └─ 4. children データ削除 (deleteAllChildrenData)
  └─ 5. 招待リンク無効化 + 物理削除 (revokeAndDeleteAllInvites)
  └─ 6. 全メンバーシップ削除 (deleteAllMemberships)
  └─ 7. Owner のみ Cognito + DB ユーザー削除（他メンバーの Cognito は削除しない）
  └─ 8. テナント削除 (deleteTenant)
  └─ 9. notifyDeletionComplete (失敗は無視)
  └─ 10. 他メンバーへ sendMemberRemovedEmail (失敗は無視)
```

> **Pattern 1 vs 2b の重要な違い**: Pattern 1 の `fullTenantDeletion` は全メンバーの Cognito ユーザーを削除する（テナントに owner しかいないため）。Pattern 2b の `deleteOwnerFullDelete` は **Owner の Cognito のみ削除**し、他メンバーの Cognito は残す（所属解除＋メール通知で対応）。

**理由**: Stripe キャンセルが失敗したまま DB を削除すると、課金は継続しているのにテナントが消滅して問い合わせ窓口を失う。逆順なら、DB は残ったまま再試行できる。

---

## 4. グレースピリオド（#742 連動）

**現状**: グレースピリオドは未実装。`fullTenantDeletion` は即時に物理削除する。

**#742 で導入予定（仕様は #742 で最終確定、以下は提案値）**:

- free プラン: グレースピリオドなし（即時削除）
- standard プラン: 7 日間の復元期間
- family プラン: 30 日間の復元期間 + 削除前エクスポートメール送信
- グレースピリオドがあるプランは、削除直後にテナントを `status=pending-delete` に遷移させ、`deletedAt+planRetentionDays` の cron で実体削除
- 復元 API（`/api/v1/admin/account/restore`）を用意し、メールリンクから 1 クリック復元できるようにする

実装時に本ドキュメントの §2 のマトリクスに「pending-delete 中の状態」列を追加すること。

---

## 5. 確認 UX

### 5.1 共通の入力チェック

- 削除実行ボタンの直前に **入力フィールド**を置き、ユーザーに `アカウントを削除します` と正確に入力させる（コピー禁止のため `<input>` を使う）
- 入力値が一致しない限り削除実行ボタンは disabled
- 実装: `src/routes/(parent)/admin/settings/+page.svelte` の `deleteConfirmText !== 'アカウントを削除します'` ガード

### 5.2 パターンごとの追加 UX

| パターン | 追加表示 | 注記 |
|---------|---------|------|
| 1. owner-only | 「家族グループ全体が削除されます」の警告 | `getOwnerDeletionInfo().isOnlyMember=true` で判定 |
| 2. owner（他メンバーあり） | 移譲ダイアログ（`showTransferDialog`）→ 移譲先選択 or 「全削除」ボタン | `getOwnerDeletionInfo()` で他メンバー一覧を取得 |
| 2a. transfer | 移譲先メンバー（child 不可）を select | `child` ロールは select に出さない |
| 2b. full-delete | 「他のメンバーも所属を失います」「Stripe を停止します」 | 削除完了後に他メンバーへメール通知 |
| 3. child | 子供レコードは残る旨を明示 | parent からの操作ではなく **child 本人セッション** から実行 |
| 4. member | 「テナントは残ります」「自分のログイン情報のみ削除」 | parent ロールのみ |

### 5.3 削除完了後

- 全パターンで `window.location.href = '/auth/signout'` → サインアウト経由で `/` に戻す
- セッションが切れているため admin 画面の再読込は不要

---

## 6. 画面遷移図

詳細な画面遷移は [`diagrams/account-deletion-flow.drawio`](diagrams/account-deletion-flow.drawio) を参照。

---

## 7. テスト戦略

### 7.1 ユニットテスト（vitest）

- パターンごとに `getOwnerDeletionInfo` のモックを切り替え、`/api/v1/admin/account/delete` の dispatch が正しいか検証
- Stripe キャンセル失敗時に DB 削除が走らないことを `cancelSubscription` mock の throw で検証（#741 回帰テスト）
- ロール判定エラー: owner が `child` パターンを送ると 403、parent が `owner-only` を送ると 403

### 7.2 E2E（Playwright）

- #755 で 4 パターンの E2E を整備予定
- ローカル認証モードでは Cognito 削除がスキップされるため、E2E は **DB 削除 + サインアウト** までを確認する

---

## 8. 関連

- 設計
  - #743 — プラン/トライアル UI パターン（PlanStatusCard 等）
  - #739 — データクリア範囲の見直し
  - #741 — Stripe キャンセル先行（ADR-0022）
  - #742 — グレースピリオド
  - #738 / #754 — ダウングレード前確認 / 超過リソース処理
- ADR
  - [ADR-0022（archive）](../decisions/archive/0022-billing-data-lifecycle-consistency.md) — 課金サイクルとデータライフサイクルの整合性
  - [ADR-0001](../decisions/0001-design-doc-as-source-of-truth.md) — 設計書 SSOT
- 実装
  - `src/lib/server/services/account-deletion-service.ts`
  - `src/routes/api/v1/admin/account/delete/+server.ts`
  - `src/routes/api/v1/admin/account/deletion-info/+server.ts`
  - `src/routes/(parent)/admin/settings/+page.svelte`

---

## 更新履歴

| 日付 | 版数 | 内容 |
|------|------|------|
| 2026-04-11 | 1.0 | #746 初版作成（実装状態を反映） |
