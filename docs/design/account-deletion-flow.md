# account-deletion-flow.md — アカウント削除フロー仕様 (#746)

> アカウント削除は **5 つのパターン** に分岐する。本ドキュメントは各パターンの判定条件・UI フロー・サーバ側挙動・削除範囲・関連 Issue を 1 か所にまとめる SSOT である。実装は `src/lib/server/services/account-deletion-service.ts` および `src/routes/api/v1/admin/account/delete/+server.ts` を参照。

---

## 0. 解約（Stripe）との違い（#2100 PO 8 項目 #8 を反映）

「アカウント削除」と「解約」はユーザー視点では似ているが、本サービスでは **完全に別の概念** として扱う。両者を混同すると「解約したのにデータが残っている」「削除したのに課金が止まっていない」等のクレームが発生するため、本書とユーザー向け文言（[`site/terms.html`](../../site/terms.html) 第7条 / 第13条）で明示的に区別する。

| 観点 | 解約（cancel） | アカウント削除（account deletion） |
|---|---|---|
| **対象** | Stripe Subscription（自動更新） | アカウント本体 + 全データ |
| **入口** | Stripe Customer Portal（[`plan-change-flow.md`](plan-change-flow.md) §3 / §3.0）または `/admin/subscription/cancel` | `/admin/settings` の「アカウント削除」ボタン（**本人ログイン必須**） |
| **挙動** | サブスクリプションの自動更新停止のみ。データは無料プランに移行し保持期間（90 日）まで閲覧可能 | 本書 §1 の 5 パターンに分岐し、削除範囲は §2 マトリクスに従う。最終的に全データを完全削除 |
| **データ復旧** | 再課金で復元可能（90 日以内） | 不可（猶予期間経過後は物理削除） |
| **猶予期間** | Stripe smart retries（7 日）＋ 無料プラン保持（90 日） | 利用プランに応じた猶予期間（無料: 即時 / Standard: 7 日 / Family: 30 日、`terms.html` 第13条） |
| **誰が実行** | 親（owner / parent role）、または Stripe Dashboard 経由 | **本人がログインして** 実行（CS / 運営代行不可、なりすまし防止のため） |

### 0.1 利用規約での明示（`site/terms.html`）

- **第7条**: 「解約」は自動更新停止のみで、データは無料プランに移行（削除はされない）
- **第13条**: 「アカウント削除」はログイン後の `/admin/settings` から本人実施、猶予期間経過後に全データ完全削除

### 0.2 関連ドキュメント

- 解約フロー詳細: [`plan-change-flow.md`](plan-change-flow.md) §3 / §3.0 / §3.0.6
- 解約・失効と無料プラン移行: `docs/design/billing-redesign/` (license key は Epic #2525 で全廃。`license-key-requirements.md` §2.9 は deprecated、歴史記録)
- 利用規約での明示: [`site/terms.html`](../../site/terms.html) 第7条 / 第13条

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

判定の擬似コード（`src/routes/(parent)/admin/settings/account/+page.svelte` の `handleDeleteAccount`）:

```ts
const role = $page.data.userRole;
if (role === 'owner') {
  if (deletionInfo.isOnlyMember) pattern = 'owner-only';
  else                            showTransferDialog = true; // → 2a または 2b を選択
} else if (role === 'child')      pattern = 'child';
else                              pattern = 'member';
```

**移譲先の有無で提示する選択肢を変える（#4640）**: 他メンバーが居ても、**オーナーを渡せるのは大人（`role !== 'child'`）だけ**。他が子供しか居ないときに移譲を求めると選択肢が空のまま宙吊りになり、**退会そのものができなくなる**。判定は `getOwnerDeletionInfo` が返す `hasTransferableAdult`（削除情報 API の一部）を唯一の出所とし、画面側で `otherMembers` から組み立てない。

| 状態 | 出す選択肢 |
|---|---|
| 自分ひとり（`isOnlyMember`） | 確認入力 → `owner-only`（ダイアログを出さない） |
| 他に大人が居る（`hasTransferableAdult`） | 移譲先の選択 + 「移譲して退会」 / 「全て削除する」 |
| 他は子供だけ | **移譲欄を出さず**、渡せない理由と「別の保護者を招待してから引き継ぐ」案内 + 「全て削除する」 |

固定は `tests/unit/services/owner-deletion-transferable-adult.test.ts`（判定）と `tests/e2e/account-deletion.spec.ts` §9（画面の出し分け）。

---

## 1.5 引っ越し合流で無人になった家族グループの掃除（#4642）

退会（アカウント削除）とは**別事象**の削除経路。招待リンクをうまく踏めず誤って自分だけの家族グループを作ってしまった人が、後から正しい招待に合流するときに、抜けたあとの無人グループを掃除する。

| 項目 | 内容 |
|---|---|
| 入口 | `/auth/invite/[code]` の確認画面 → `?/relocate` action（顧客の明示同意が必須） |
| 実行条件 | 招待を受ける人が、いまの家族グループの **owner かつ唯一のメンバー**であること（`checkRelocationEligibility`） |
| 順序 | ① 可否をサーバーで再検証 → ② 招待を受諾 → ③ 元の membership を削除 → ④ 無人になった元テナントを削除 |
| 削除範囲 | `deleteVacatedTenant`（`fullTenantDeletion` を再利用。§2 マトリクスの owner-only と同一） |
| **人は消さない** | 引っ越した本人は合流先で使い続けるため、Cognito ユーザーと `users` 行は残る（メンバー 0 人なので削除ループが 1 度も回らない） |
| 削除記録 | `DeletionRoute = 'relocation'`。退会ではないので**削除完了メールは送らない** |
| 失敗時 | ②で失敗 → 元の家族グループは無傷のまま理由を表示。④で失敗 → 引っ越しは成立させ、残骸はログに残す（合流できたのにエラー画面にしない） |

**他メンバーが居る家族グループの owner は引っ越せない**（勝手に畳むと他の人のデータが消えるため）。メンバーを削除するか、先に owner を移譲してもらう。owner でないメンバーは、メンバー管理から自分だけ抜けてから招待リンクを開き直す。

確認画面の要件は `06-UI設計書.md` §引っ越し合流の確認画面。実装は `src/lib/server/services/tenant-relocation-service.ts`、固定は `tests/unit/services/tenant-relocation.test.ts` / `tests/unit/routes/auth-invite-relocation.test.ts`。

---

## 1.5 引っ越し合流で無人になった家族グループの掃除（#4642）

退会（アカウント削除）とは**別事象**の削除経路。招待リンクをうまく踏めず誤って自分だけの家族グループを作ってしまった人が、後から正しい招待に合流するときに、抜けたあとの無人グループを掃除する。

| 項目 | 内容 |
|---|---|
| 入口 | `/auth/invite/[code]` の確認画面 → `?/relocate` action（顧客の明示同意が必須） |
| 実行条件 | 招待を受ける人が、いまの家族グループの **owner かつ唯一のメンバー**であること（`checkRelocationEligibility`） |
| 順序 | ① 可否をサーバーで再検証 → ② 招待を受諾 → ③ 元の membership を削除 → ④ 無人になった元テナントを削除 |
| 削除範囲 | `deleteVacatedTenant`（`fullTenantDeletion` を再利用。§2 マトリクスの owner-only と同一） |
| **人は消さない** | 引っ越した本人は合流先で使い続けるため、Cognito ユーザーと `users` 行は残る（メンバー 0 人なので削除ループが 1 度も回らない） |
| 削除記録 | `DeletionRoute = 'relocation'`。退会ではないので**削除完了メールは送らない** |
| 失敗時 | ②で失敗 → 元の家族グループは無傷のまま理由を表示。④で失敗 → 引っ越しは成立させ、残骸はログに残す（合流できたのにエラー画面にしない） |

**他メンバーが居る家族グループの owner は引っ越せない**（勝手に畳むと他の人のデータが消えるため）。メンバーを削除するか、先に owner を移譲してもらう。owner でないメンバーは、メンバー管理から自分だけ抜けてから招待リンクを開き直す。

確認画面の要件は `06-UI設計書.md` §引っ越し合流の確認画面。実装は `src/lib/server/services/tenant-relocation-service.ts`、固定は `tests/unit/services/tenant-relocation.test.ts` / `tests/unit/routes/auth-invite-relocation.test.ts`。

---

## 2. データクリア範囲マトリクス（#739 連動）

各パターンで何が消えるかを下表で固定する。チェックなしは **削除されない**。

| 対象 | 1. owner-only | 2a. transfer | 2b. full-delete | 3. child | 4. member |
|------|---|---|---|---|---|
| Stripe Subscription（#741 必須） | ✔ | ✘ | ✔ | ✘ | ✘ |
| S3 / ストレージ（`tenants/{tenantId}/` prefix） | ✔ | ✘ | ✔ | ✘ | ✘ |
| S3 / クラウドバックアップ実体（`exports/{tenantId}/` prefix、#3868） | ✔ | ✘ | ✔ | ✘ | ✘ |
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
| オーナーへの削除完了通知（`sendDeletionCompleteEmail`、#4507） | ✔ | — | ✔ | — | — |

> **オーナーへの通知は退会の両端で 1 通ずつ（#4507）**: 予約時に `sendDeletionReservedEmail`（`softDeleteTenant` 内）、物理削除の完了時に `sendDeletionCompleteEmail`（`deleteOwnerOnlyAccount` / `deleteOwnerFullDelete` 内）。完了通知を**物理削除を行う関数の側**に置いているため、無料プランの即時削除と猶予満了後の cron 削除の両経路が同じ 1 箇所を通る（呼び出し側ごとに配線し忘れる余地を作らない）。宛先は削除前に控える（削除後は users 行ごと消えて引けない）。無料プランは猶予 0 日で §4.7 の予告メールを送れないため、この完了通知が唯一の通知になる。

> **重要**: パターン 3 (`deleteChildAccount`) は子供レコード自体を削除しない（活動履歴・実績は残す）。代わりに `child.userId` を `null` にしてアカウントだけ切り離す。これは「子供がスマホを返した」「再ログインのため UID を作り直したい」等のケースを想定したもの。

> **S3 実体削除は 2 prefix に及ぶ（#3868）**: 「テナントスコープのデータ削除」は DB 行だけでなく S3 上の payload まで含む。① `fullTenantDeletion` / `deleteOwnerFullDelete` が `purgeByPrefix('tenants/{tenantId}/')` でアバター・音声・画像を削除する（§3 シーケンスの「S3 削除」）のに加え、② クラウドバックアップ ZIP は `exports/{tenantId}/{pinCode}/...` という**別 prefix**に置かれるため `tenants/{tenantId}/` の一括削除では消えない。これを `deleteTenantScopedData` の cloudExports 削除ループ内で、DB 行削除の**前**に `storage.purgeByPrefix(exp.s3Key)` を呼んで削除する（個別削除 `cloud-export-service.deleteCloudExport` と同一手段を再利用）。

> **退会は `purgeByPrefix`（全バージョン削除）を使う（#4724）**。assets バケットはバージョニング有効のため、`deleteByPrefix` は「現行バージョンに delete marker を立てる」だけで実体は lifecycle（非現行 30 日）まで残る。退会は「猶予期間後に完全削除」を約束しているので、退会経路とクラウドエクスポート削除だけはバージョンを名指しして消す。逆に**お子さまの削除（`child-service.deleteChildFiles`）は `deleteByPrefix` のまま**にして 30 日は戻せるようにする（誤削除からの復旧が #4724 の目的）。経路の固定は `tests/unit/infra/assets-backup.test.ts` [D1][D2]。S3 削除失敗は best-effort（`logger.warn` で記録し DB 行削除・account 削除は継続）。これを怠ると退会後も子供の完全 PII を含むバックアップが S3 lifecycle（30 日）失効まで孤児として滞留する。

---

## 3. Stripe キャンセル連動（#741 / ADR-0022）

ADR-0022 の原則に従い、**全データ削除を伴うパターン（1 / 2b）では DB 削除よりも先に Stripe Subscription をキャンセルする**。

**Pattern 1 (`deleteOwnerOnlyAccount` → `fullTenantDeletion`):**

```
fullTenantDeletion(tenantId, ownerId)
  └─ 0. cancelSubscription(tenantId)   ← 失敗したら throw → 以降の処理は走らない
  └─ 1. S3 削除 (purgeByPrefix = 全バージョン)
  └─ 2. tenant scoped data 削除 (deleteTenantScopedData)
  └─ 3. children データ削除 (deleteAllChildrenData)
  └─ 4. 全メンバーの Cognito + DB ユーザー削除 (findTenantMembers → deleteCognitoUser + deleteUser)
  └─ 5. 全メンバーシップ削除 (deleteAllMemberships)
  └─ 6. 招待リンク無効化 + 物理削除 (revokeAndDeleteAllInvites)
  └─ 7. テナント削除 (deleteTenant)
```

**Pattern 2b (`deleteOwnerFullDelete` — `fullTenantDeletion` は呼ばない):**

```
deleteOwnerFullDelete(tenantId, ownerId)
  └─ 0. 他メンバー一覧 + メール情報を事前収集（削除後は取得不能）
  └─ 1. cancelSubscription(tenantId)   ← 失敗したら throw
  └─ 2. S3 削除 (purgeByPrefix = 全バージョン)
  └─ 3. tenant scoped data 削除 (deleteTenantScopedData)
  └─ 4. children データ削除 (deleteAllChildrenData)
  └─ 5. 招待リンク無効化 + 物理削除 (revokeAndDeleteAllInvites)
  └─ 6. 全メンバーシップ削除 (deleteAllMemberships)
  └─ 7. Owner のみ Cognito + DB ユーザー削除（他メンバーの Cognito は削除しない）
  └─ 8. テナント削除 (deleteTenant)
  └─ 10. 他メンバーへ sendMemberRemovedEmail (失敗は無視)
```

> **Pattern 1 vs 2b の重要な違い**: Pattern 1 の `fullTenantDeletion` は全メンバーの Cognito ユーザーを削除する（テナントに owner しかいないため）。Pattern 2b の `deleteOwnerFullDelete` は **Owner の Cognito のみ削除**し、他メンバーの Cognito は残す（所属解除＋メール通知で対応）。

**理由**: Stripe キャンセルが失敗したまま DB を削除すると、課金は継続しているのにテナントが消滅して問い合わせ窓口を失う。逆順なら、DB は残ったまま再試行できる。

---

## 4. グレースピリオド（#742 / #1781 配線完了）

### 4.1 仕様

| プラン | グレースピリオド | データ保持 | 復元可否 |
|--------|---------------|----------|---------|
| free | 0 日（即時物理削除） | なし | × |
| standard | 7 日 | あり | ○（grace 期間内のみ） |
| family | 30 日 | あり | ○（grace 期間内のみ） |

値 SSOT: `DELETION_GRACE_PERIOD_DAYS` in `src/lib/domain/constants/deletion-grace.ts`
（`src/lib/server/services/grace-period-service.ts` は同定数を re-export する。顧客に見える文言は
`terms.ts` の `DELETION_GRACE_TERMS` を経由して同じ値を引く — 表示側に日数を複製しない）

**この猶予は退会（アカウント削除）にだけ存在する**。解約（サブスクリプションの自動更新停止、#3991
期末解約モデル）ではデータは削除されず、猶予期間も発生しない。

### 4.2 実装フロー（#1781 で `softDeleteTenant` を `+server.ts` に配線完了）

```
POST /api/v1/admin/account/delete  (pattern=owner-only / owner-full-delete)
  └─ softDeleteTenant(tenantId, licenseStatus, planId)
      ├─ resolveFullPlanTier → 'free' | 'standard' | 'family'
      └─ DELETION_GRACE_PERIOD_DAYS[planTier]
  ├─ requiresImmediateDeletion=true (free)  → deleteOwnerOnlyAccount / deleteOwnerFullDelete (即時物理削除)
  └─ requiresImmediateDeletion=false (有料) → cancelSubscription (Stripe 即停止) + soft delete state を settings に記録
                                            → 物理削除は cron が grace 期限到達後に実行
```

### 4.3 Soft delete 中の状態

soft delete されたテナントは以下の状態になる:

- `settings` テーブルに `physical_deletion_date` → `deletion_grace_plan_tier` → `soft_deleted_at` の順で記録される（**sentinel-last**）
- Stripe Subscription は **即時にキャンセル**（grace 期間中に再課金されない / #741、§3 参照）
- DB のテナント本体・children・activities 等は **保持**（復元のため）
- ユーザはサインアウトされる（`/auth/signout?reason=deletion_pending`）。ログイン画面が受付完了と「猶予中は取り消せる」を表示し、再ログインすれば全 admin ページで復元 UI を見られる（§4.3a）

#### 3 キーの書き込み順序と不完全メタデータの扱い

`settings` の 3 キーは 1 キー 1 文の upsert で書かれ、まとめる txn は無い。よって**書き込み順序が不変条件を担保する**:

| 操作 | 順序 | 途中失敗時に残る状態 |
|---|---|---|
| soft delete（記録） | `physical_deletion_date` → `deletion_grace_plan_tier` → **`soft_deleted_at`**（sentinel-last） | sentinel が立たない = soft-delete が始まっていない |
| restore（クリア） | **`soft_deleted_at`** → `deletion_grace_plan_tier` → `physical_deletion_date`（sentinel-first） | sentinel が消えている = 復元済み |

`soft_deleted_at` は soft-delete 状態を起動する sentinel（`getGracePeriodStatus` の早期 return と `hooks.server.ts` の読み取り専用ロック判定がこれだけを見る）。**sentinel を最後に立て、最初に降ろす**ことで、途中失敗はつねに「データを消さない側」に倒れる。

**メタデータが不完全な行**（`physical_deletion_date` または `deletion_grace_plan_tier` が欠落・不正）は、`getGracePeriodStatus` が `metadataIncomplete: true` / `isExpired: false` を返す:

- 「いつ消してよいか不明」を「もう消してよい」に写像しない（安全側 = データを消さない側）
- **復元できる**（宙吊りからの脱出経路。復元 → 退会し直しで正常な状態に戻せる）
- **物理削除の母集団に入らない**（`findExpiredSoftDeletedTenants`）
- 発生は `logger.warn` で検出する（専用の通知機構は持たない）

### 4.3a 猶予中に顧客へ見せるもの（#4699）

申請したことを忘れた / 家族の別端末で気づかない保護者が、猶予経過で全データを失う経路を塞ぐ。**猶予中の状態と復元導線は 1 画面に閉じない**。

| 場所 | 出すもの | 実装 |
|---|---|---|
| ログイン画面 | 申請の受付完了 + 猶予中は取り消せる旨 | 削除 API 成功後に `/auth/signout?reason=deletion_pending` へ。`signout` は**既知の reason コードのみ** login へ引き継ぐ。表示は `LOGIN_LABELS.noticeDeletionPending`（`role="status"`） |
| **全 admin ページ** | 「アカウント削除のお手続き中です / あと N 日（日付）/ アカウントを復元する」 | `DeletionGraceBanner.svelte`（共通コンポーネント）を admin `+layout.svelte` が `gracePeriodStatus.isSoftDeleted` で描画。設定 > アカウントも同一コンポーネントを使う（バナーの二重実装を作らない） |
| 設定トップ | 書き込みが止められた理由 | 読み取り専用ロックの redirect 先 `?reason=account_deletion_pending` を `SETTINGS_LABELS.deletionPendingReadOnlyNotice` で説明する |
| 設定 > アカウント | 退会セクションの出し分け | **退会申請中は出さない**（復元バナーに集約）。判定は `gracePeriodStatus.isSoftDeleted` であり `families.status` ではない — `grace_period` は支払い失敗（dunning）の猶予であり（#3993）、**支払い失敗中でも退会できる** |

**猶予中でも子供画面は使える**: `/switch` の子供選択は `selectedChildId` cookie の set と親ゲート cookie の delete だけで DB を書かないため、読み取り専用ロックの許可 path に含める（塞ぐと猶予中に子供が使えなくなり、しかも設定画面へ無言で飛ばされる）。

### 4.4 復元フロー

`POST /api/v1/admin/account/restore` (owner のみ):

1. `getGracePeriodStatus` で grace 期限内であることを確認（メタデータ不完全な行は期限切れ扱いにせず復元を許す、§4.3）
2. settings の 3 キーを `soft_deleted_at` → `deletion_grace_plan_tier` → `physical_deletion_date` の順（**sentinel-first**）で空文字にクリア
3. テナント通常状態に戻る（次の admin/+layout.server.ts load で `gracePeriodStatus.isSoftDeleted=false`）

> **Stripe 再購読について**: Stripe Subscription は grace 期間中にキャンセル済みのため、復元しても自動再購読されない。ユーザは `/pricing` から再度購読する必要がある（admin 画面で誘導する）。

### 4.5 物理削除（cron）

`/api/cron/grace-period-deletion` が定期実行で `purgeExpiredSoftDeletedTenants` を呼ぶ:

0. `GRACE_PERIOD_DELETION_DISABLED` が `true` / `1` なら**対象の走査を行わず即 return**（kill-switch）
1. `findExpiredSoftDeletedTenants` で grace 期限切れのテナントを検出（メタデータ不完全な行は母集団に入らない、§4.3）
2. 各テナントの owner を特定
3. `deleteOwnerOnlyAccount` (他メンバーなし) または `deleteOwnerFullDelete` (他メンバーあり) で物理削除
4. Pattern 2b の場合、他メンバーへ `sendMemberRemovedEmail` 通知

> Stripe キャンセルは soft delete 時に既に完了しているため、cron 経由の `cancelSubscription` 再実行は idempotent な no-op になる。

#### 削除の実行順（判定材料は最後に消す）

soft-delete 判定の SSOT は `settings` の `soft_deleted_at` / `physical_deletion_date` であり、
対象列挙は `families` を歩いて 1 件ずつ `settings` を読む。したがって **`settings` は `families` 行より後に削除する**。

```
1 Stripe cancel → 2 S3 → 3 tenant-scoped データ (settings を除く) → 4 children
→ 5 memberships / users → 6 invites → 7 families → 8 settings（判定材料）
```

step 7 より前で失敗しても判定材料が残るため、翌日の実行が同じテナントを再び対象にして完遂する（自己回復）。
逆順にすると「`families` は残るが判定材料が無い」= 再削除も復元もできない行が生まれる。
step 8 の失敗は例外を投げ、`errors[]` → alarm に載る。このとき `settings` 行のみが孤児として残り、
そこには `pin_hash` / `session_token` / `questionnaire_*` が含まれるため**手動掃除が必要**
（判断根拠と手順は [`grace-period-deletion-operations.md`](../runbooks/grace-period-deletion-operations.md) §3）。

#### 部分失敗の扱い

`tenantsFailed > 0` のとき endpoint は **HTTP 500** を返し、Discord incident webhook にも件数を出す
（テナント識別子は log にのみ残す）。停止 / 観測 / 復旧の限界は
[`docs/runbooks/grace-period-deletion-operations.md`](../runbooks/grace-period-deletion-operations.md) が SSOT。
**単一テナントだけを削除前の状態に戻す手段は存在しない。**

### 4.6 §2 マトリクスへの影響

soft-delete 中（grace 期間内）の各削除対象は **すべて保持**（チェックなし）。grace 期限切れで cron が物理削除を実行したタイミングで §2 の Pattern 1 / 2b と同じ範囲が削除される。

### 4.7 削除予告メール自動化（#2399）

soft delete 状態のテナントに対し、物理削除の **残り 14 日 (family) / 1 日 (standard)** で所有者へ予告メールを 1 通送る。**free は猶予 0 日 (即時物理削除) のため送信しない** — 予告を送る時間が原理的に存在せず、削除確認は §5.1 の入力確認 UX が担う。

- **設計 SSOT**: [`docs/runbooks/account-deletion-email-automation.md`](../runbooks/account-deletion-email-automation.md)
- **実体**: `/api/cron/deletion-warning-emails` (毎日 10:00 JST) → `deletion-warning-service.ts` → `email-service.sendDeletionWarningEmail`
- **使用基盤**: 既存 EventBridge + cron-dispatcher Lambda + SES (新規 Lambda function / Stack なし)
- **しきい値の判定**: 残日数は JST 暦日差で数え、`しきい値以下 かつ 1 日以上 かつ 未送信` で送る。cron が 1 日欠測しても予告なしで削除される事態を避けるための「以下」判定であり、二重送信は下記 idempotency が防ぐ
- **idempotency**: `settings.deletion_warning_sent_at` で 1 予約 1 送信。**予約時 (`softDeleteTenant`) と復元時 (`restoreSoftDeletedTenant`) にクリア**され、復元後に再度予約すれば再び予告が届く
- **法務通知扱い**: `marketing-email-counter` (年 6 回上限、ADR-0023 §5 I11) に乗せず、List-Unsubscribe も付けない。配信停止済のテナントにも届く
- **本文**: 物理削除予定日 + 残日数 + 復元導線 (`/admin/settings/account`) を含み、子供の名前・活動内容は含めない (ADR-0012 中立トーン)

---

## 5. 確認 UX

### 5.1 共通の入力チェック

- 削除実行ボタンの直前に **入力フィールド**を置き、ユーザーに `アカウントを削除します` と正確に入力させる（コピー禁止のため `<input>` を使う）
- 入力値が一致しない限り削除実行ボタンは disabled
- 実装: `src/routes/(parent)/admin/settings/+page.svelte` の `deleteConfirmText !== 'アカウントを削除します'` ガード

### 5.2 退会前のデータ持ち出し（プラン非依存）

削除実行の手順より**前**に、owner はデータをファイルとして持ち出せる。

- **導線**: `/admin/settings/account` の Danger Zone 内、削除の 3 手順の上に配置（`AccountDeletionExportPanel`）。owner のみ表示（API が owner 限定のため）
- **プランで出し分けない**: 通常のエクスポート（`/api/v1/export`）は `canExport: false` の無料プランでは使えないため、本導線が無料プランにとって唯一のデータ持ち出し手段になる
- **API**: `GET /api/v1/admin/account/export` → `generateDeletionExportForTenant`。`Content-Disposition: attachment` で JSON ファイルとして保存させる
- **入る範囲はプランで変わる**（`resolveExportScope`、SSOT: `src/lib/domain/deletion-export-scope.ts`）。何が入るかは押す前に 1 行で表示する

| プラン | scope | 内容 |
|---|---|---|
| free | `minimal` | 子供の名前 + 記録の件数・期間のまとめ |
| standard | `full` | フルエクスポート |
| family | `family` | フル + きょうだい比較 |

- **失敗時**: エラー文言を画面に出す（ADR-0062。無言で失敗させない）。処理中は `Button` の `loading` で可視化する

### 5.3 パターンごとの追加 UX

| パターン | 追加表示 | 注記 |
|---------|---------|------|
| 1. owner-only | 「家族グループ全体が削除されます」の警告 | `getOwnerDeletionInfo().isOnlyMember=true` で判定 |
| 2. owner（他メンバーあり） | 移譲ダイアログ（`showTransferDialog`）→ 移譲先選択 or 「全削除」ボタン | `getOwnerDeletionInfo()` で他メンバー一覧を取得 |
| 2a. transfer | 移譲先メンバー（child 不可）を select | `child` ロールは select に出さない |
| 2b. full-delete | 「他のメンバーも所属を失います」「Stripe を停止します」 | 削除完了後に他メンバーへメール通知 |
| 3. child | 子供レコードは残る旨を明示 | parent からの操作ではなく **child 本人セッション** から実行 |
| 4. member | 「テナントは残ります」「自分のログイン情報のみ削除」 | parent ロールのみ |

### 5.4 削除完了後

- 全パターンで `/auth/signout?reason=deletion_pending` → サインアウト経由でログイン画面に戻し、そこで受付完了と取り消し可を伝える（#4699。旧実装は無言でログイン画面に着地していた）
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
  - [ADR-0049](../decisions/0049-retention-physical-delete-extended.md) — プラン別履歴保持 + 物理削除ポリシー（旧 archive ADR-0022 の課金×データライフサイクル整合原則は本文と git 履歴に統合）
  - [ADR-0001](../decisions/0001-design-doc-as-source-of-truth.md) — 設計書 SSOT
- 実装
  - `src/lib/server/services/account-deletion-service.ts`
  - `src/routes/api/v1/admin/account/delete/+server.ts`
  - `src/routes/api/v1/admin/account/deletion-info/+server.ts`
  - `src/routes/(parent)/admin/settings/+page.svelte`
