# ライセンスキー競合分析ドキュメント

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 作成日 | 2026-04-11 |
| 関連 Issue | #811 |
| 関連 ADR | ADR-0026 ライセンスキーアーキテクチャ (#809) |
| 関連設計書 | [license-key-requirements.md](./license-key-requirements.md), [license-subscription-causality.md](./license-subscription-causality.md) |

## 0. 本書の位置づけ

ライセンスキー周辺の実装判断を、同等・類似プロダクトとの比較で根拠付ける。ADR-0026 の「なぜこの設計を選んだか」の補足資料として参照される。

> **本書はあくまで「設計判断の根拠」である。各社の最新仕様は公式ドキュメントを参照すること。記載時点は 2026-04 現在。**

---

## 1. 比較対象

本書で比較する 6 サービス（いずれもライセンスキーまたはサブスクリプション権利の付与を行うサービス）:

| # | サービス | 種別 | 対象セグメント | 公式 docs |
|---|---------|------|--------------|----------|
| 1 | **Keygen.sh** | ライセンスサーバー SaaS | エンタープライズ / ISV | https://keygen.sh/docs/api/licenses/ |
| 2 | **Lemon Squeezy** | 決済 + ライセンスキー MoR | インディー開発者 / SaaS | https://docs.lemonsqueezy.com/help/licensing |
| 3 | **Paddle** | 決済 + サブスク MoR | SaaS | https://developer.paddle.com/ |
| 4 | **Gumroad** | デジタル販売 + ライセンスキー | インディー / クリエイター | https://help.gumroad.com/article/76-license-keys |
| 5 | **JetBrains** | 社内ライセンスサーバー + サブスク | IDE / エンタープライズ | https://www.jetbrains.com/help/idea/license.html |
| 6 | **Stripe (Checkout + Webhook)** | 決済のみ（ライセンスは自前実装） | あらゆる SaaS | https://docs.stripe.com/billing/subscriptions |

がんばりクエストと同一セグメント（家族向け B2C SaaS + OSS dual license）は存在しないため、以下では近接ユースケースで比較する。

---

## 2. 比較軸

### 2.1 キー形式

| サービス | 形式 | チェックサム / 署名 | 文字セット | 備考 |
|---------|------|-------------------|----------|------|
| Keygen.sh | UUID v4 (デフォルト) / カスタム scheme (ED25519 / RSA) | **ED25519 / RSA 署名**で offline 検証可 | 16進 + ハイフン | ポリシーで形式を上書き可 |
| Lemon Squeezy | `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX-XX` (UUID + suffix) | サーバー側 DB で照合 (署名なし) | 16進 + ハイフン | API で `activate` |
| Paddle | Paddle Vendor ID 紐付きトークン | サーバー側 DB 照合 | 英数 | Paddle API 経由 |
| Gumroad | 16 文字ブロック × 4 (例: `A1B2-C3D4-E5F6-G7H8`) | なし | 英数大文字 | シンプル |
| JetBrains | JWT (署名付き) or プレーンキー | **署名付き JWT** | Base64URL | License Server or AWS 経由 |
| Stripe 自前実装 | 自由 | 自由 | 自由 | 例: checkout session ID を直接渡す |
| **がんばりクエスト** | `GQ-XXXX-XXXX-XXXX-YYYYY` | **HMAC-SHA256 5文字** (対称鍵) | 32文字 (0/O/1/I除外) | 目視読み取り性優先 |

**設計判断**:
- **ED25519 / RSA は over-kill** — がんばりクエストはキーを手入力する家族向け UI のため、32 バイト超の署名を含める意味がない。HMAC-SHA256 の先頭 5 文字で偽造防止として十分
- **UUID は目視読み取り不可** — 保護者が紙のレシートや画面からキーを入力することを想定すると、Gumroad 型の短い英数ブロックが最適
- **0/O/1/I 除外**は JetBrains License Server 式を参考にした。Keygen/Lemon Squeezy は含めない（UUID なので不要）

### 2.2 発行タイミング

| サービス | 発行契機 | 自動 / 手動 | 複数発行 |
|---------|---------|-----------|---------|
| Keygen.sh | API 経由 (webhook or 手動) | どちらも | 可 |
| Lemon Squeezy | 決済完了 webhook | 自動 | 可 (追加購入) |
| Paddle | 決済完了 webhook | 自動 | 可 |
| Gumroad | 決済完了 | 自動 | 買い切り 1 つ |
| JetBrains | サブスク契約時 | 自動 | 1 契約 1 キー |
| Stripe (自前) | `checkout.session.completed` webhook | 自前実装 | 自由 |
| **がんばりクエスト** | `checkout.session.completed` webhook | 自動 | 1 テナント 1 キー原則 |

**設計判断**:
- Stripe / Lemon Squeezy と同様の **webhook 駆動 + 自動発行**を採用
- **1 テナント 1 アクティブキー原則** は gumroad/Jetbrains 個人ライセンス型に近い。家族向けのため「同時複数デバイス」を想定せず、1 家庭 = 1 キーで十分

### 2.3 バインド対象 (誰に紐付くか)

| サービス | バインド単位 | 交換可否 |
|---------|------------|---------|
| Keygen.sh | machine (ユーザー/組織) | ポリシー次第 |
| Lemon Squeezy | instance (起動ごと) | activate/deactivate API |
| Paddle | user email | 手動対応 |
| Gumroad | 購入者 email | 不可 |
| JetBrains | machine or user | 年次プランなら交換可 |
| **がんばりクエスト** | **tenant** (家族単位) | 発行後は改変不可。テナント削除で revoked |

**設計判断**:
- **tenant = 家族** という独自概念を採用。machine/email ではなく **家族全員で 1 ライセンスを共有**する子供向け UX に合致
- Keygen の machine binding は厳しすぎ（親機・子機の切替で手間）、gumroad の email binding は緩すぎ（家族の誰の email でもキーだけ知っていれば有効化できてしまう）

### 2.4 アクティベーション制限

| サービス | 制限 | 再アクティベート |
|---------|------|---------------|
| Keygen.sh | ポリシー (activation limit) | 可能 (API) |
| Lemon Squeezy | デフォルト 1, 購入時指定 | 可能 (API) |
| Paddle | 契約時定義 | 可能 |
| Gumroad | 1 回 (デフォルト) | 不可 |
| JetBrains | 同時利用マシン数 | オンライン check-in/check-out |
| **がんばりクエスト** | **1 回のみ消費** | **不可** (再発行は Ops 権限) |

**設計判断**:
- Gumroad / 一部 JetBrains プラン同様の **one-shot consume** を採用
- 理由: 家族向けで「同時アクティベーション数管理」の UX 負債を負いたくない
- 紛失・誤操作時は Ops が手動で revoke + 再発行（#816 の Ops 機能で対応）

### 2.5 有効期限

| サービス | 形式 | 購読連動 |
|---------|------|---------|
| Keygen.sh | 絶対期限 or 購読連動 (ポリシー) | 両対応 |
| Lemon Squeezy | サブスク期限と同期 | 購読連動 |
| Paddle | サブスク期限と同期 | 購読連動 |
| Gumroad | 無期限 (買い切り) | — |
| JetBrains | 年次 / 月次 (購読連動) | 購読連動 |
| **がんばりクエスト** | **相対 90 日** (発行時点から) | **非連動** (consume が連動の役割) |

**設計判断**:
- 他サービスと異なり、**ライセンスキー自体の有効期限 90 日**は「発行から consume されるまで」の猶予期間を意味する
- 購読との連動は「キー消費 → tenant を paid に移行 → tenant の `current_period_end` が Stripe と同期」という形で実現 (→ license-subscription-causality.md §2)
- **なぜ 90 日か**: Stripe Checkout session の有効期限 (24 時間) より長く、ユーザーが受信箱から見落とさずに見つけられる期間として経験則的に選定

### 2.6 失効機構

| サービス | 失効トリガ | grace period | reason tracking |
|---------|----------|-------------|-----------------|
| Keygen.sh | API (手動 / webhook) | ポリシー | あり |
| Lemon Squeezy | サブスク解約 / 返金 | なし (即時) | 一部 |
| Paddle | サブスク解約 / 返金 | あり (dunning) | あり |
| Gumroad | 返金時のみ | なし | なし |
| JetBrains | サブスク切れ / ライセンス違反 | 30 日 | あり |
| **がんばりクエスト** | **Ops 手動 / 漏洩検知 / 期限切れ** | **テナント側で 30 日 retention** | **`status` + `revokedReason`** |

**設計判断**:
- ライセンスキー自体の grace period はなし（シンプル）
- テナント側の grace period (30 日 retention) で実質的に猶予を与える
- Keygen / JetBrains 同様の `revokedReason` フィールドで監査できるようにする

### 2.7 監査ログ

| サービス | eventType | 保持期間 | 取得方法 |
|---------|-----------|---------|---------|
| Keygen.sh | 詳細 (API call 粒度) | プラン次第 (90 日〜無制限) | API |
| Lemon Squeezy | 限定 (activate/deactivate/refund) | 90 日 | Webhook + Dashboard |
| Paddle | 詳細 | 2 年 | API + Dashboard |
| Gumroad | 最小限 | 無制限 | Dashboard |
| JetBrains | 詳細 (License Server) | 無制限 | Server logs |
| **がんばりクエスト** | `issued/consumed/revoked/rotated/verify_failed` | **7 年** (会計法対応) | DynamoDB query (`LicenseEvent`) |

**設計判断**:
- 会計・税務上の根拠として **7 年保持**（日本の会計書類保存期間）
- イベント粒度は Lemon Squeezy 程度で十分（全 API call まで記録する Keygen は過剰）
- DynamoDB の単一テーブル設計（ADR-0012）に `LicenseEvent#<tenantId>#<timestamp>` として埋め込む

### 2.8 Ops 運用機能

| サービス | Web 管理画面 | API | 一括操作 |
|---------|-----------|-----|---------|
| Keygen.sh | あり | フル | 可 (API) |
| Lemon Squeezy | あり | フル | ダッシュボード + API |
| Paddle | あり | フル | Dashboard |
| Gumroad | あり (シンプル) | 限定 | CSV |
| JetBrains | License Server UI | 限定 | CSV |
| **がんばりクエスト** | `/ops/license-keys` (#816) | 内部のみ | CSV (ops 権限) |

**設計判断**:
- 外部 API は提供しない (自社内での管理が前提)
- `/ops/license-keys` で手動発行・revoke・CSV export を実装 (#816)

### 2.9 キャンペーン・贈答

| サービス | 無料発行 | クーポン | ギフト |
|---------|---------|---------|-------|
| Keygen.sh | API で可 | — | — |
| Lemon Squeezy | クーポン (100% OFF) | あり | 明示機能なし |
| Paddle | クーポン | あり | 限定 |
| Gumroad | `Free` オプション | あり | 自由 |
| JetBrains | 教育ライセンス申請 | — | — |
| **がんばりクエスト** | **Stripe 100% OFF クーポン経由** | **Stripe Coupon 利用** | `campaign:<name>` メタデータ |

**設計判断**:
- **自前で「ギフトキー発行ボタン」を作らない**（複雑化回避）
- 贈答・モニター・キャンペーンはすべて **Stripe のクーポン/プロモコード**を使い、通常の checkout フローを経由させる
- これにより売上管理・税務処理が Stripe 側で一元化される
- ADR-0025 §7 (license-subscription-causality.md §2 の manual 部) と整合

### 2.10 セキュリティ

| サービス | 偽造防止 | レート制限 | ブルートフォース対策 |
|---------|---------|-----------|-------------------|
| Keygen.sh | ED25519/RSA 署名 | プラン次第 | あり |
| Lemon Squeezy | DB 照合 | API key 単位 | あり |
| Paddle | DB 照合 | 契約単位 | あり |
| Gumroad | DB 照合 | なし (ゆるい) | なし |
| JetBrains | JWT 署名 | License Server 側 | あり |
| **がんばりクエスト** | **HMAC-SHA256** | **Cognito + API Gateway** | **consume エンドポイントで試行回数制限** |

**設計判断**:
- 偽造防止としては HMAC-SHA256 (対称鍵) で十分 (家族向け B2C なので ED25519 レベルの非対称署名は不要)
- シークレット漏洩対応は [license-key-secrets.md](../operations/license-key-secrets.md) (#807) 参照
- consume エンドポイントに対するブルートフォース攻撃は、**同一 IP から 1 分間に 5 回失敗でブロック** を #813 で実装予定

---

## 3. 総合比較表

| 観点 | Keygen | Lemon Squeezy | Paddle | Gumroad | JetBrains | **がんばりクエスト** |
|------|--------|--------------|--------|---------|-----------|-------------------|
| キー形式 | UUID + 署名 | UUID | トークン | 4x16 ブロック | JWT | **GQ-XXXX-XXXX-XXXX-YYYYY** |
| 発行 | API | Webhook | Webhook | 決済時 | 契約時 | **Webhook** |
| バインド | machine | instance | email | email | machine | **tenant (家族)** |
| アクティベーション | ポリシー | 1 (可変) | 契約単位 | 1 回 | 台数制限 | **1 回消費** |
| 有効期限 | 両対応 | 購読連動 | 購読連動 | 無期限 | 購読連動 | **相対 90 日** |
| 失効 | API | 返金/解約 | 解約 | 返金 | 切れ | **Ops/漏洩/期限切れ** |
| 監査 | 詳細 | 限定 | 詳細 | 最小 | 詳細 | **7 年保持** |
| Ops UI | あり | あり | あり | あり | Server UI | **/ops/license-keys** |
| キャンペーン | API | クーポン | クーポン | Free | 教育 | **Stripe クーポン** |
| 偽造防止 | 署名 (非対称) | DB 照合 | DB 照合 | DB 照合 | JWT | **HMAC-SHA256 (対称)** |
| 対象セグメント | エンプラ ISV | インディー | SaaS | クリエイター | IDE | **家族 B2C** |

---

## 4. がんばりクエストへの取り入れ判断

### 4.1 取り入れるべき (採用)

| # | 参考元 | 項目 | 理由 |
|---|-------|------|------|
| 1 | Stripe / Lemon Squeezy | **Webhook 駆動の自動発行** | SaaS の決済 → ライセンス発行フローとしてデファクト |
| 2 | Gumroad | **短い英数ブロック形式** (4文字×3 + 署名) | 家族ユーザーが手入力することを考慮 |
| 3 | JetBrains | **0/O/1/I 除外した文字セット** | 電話でのサポート対応時に聞き間違い防止 |
| 4 | Keygen / JetBrains | **`revokedReason` フィールド** | 監査・CS 対応で「なぜ失効したか」を追跡可能にする |
| 5 | Lemon Squeezy / Paddle | **Stripe の 100% OFF クーポンで贈答・モニター対応** | 専用の「ギフト発行」機能を作らずに済む |
| 6 | Paddle / JetBrains | **Ops 管理画面** (`/ops/license-keys`) | 顧客対応の必須要件 |
| 7 | すべて | **発行/消費/失効の監査ログ** | 7 年保持で会計対応 |

### 4.2 取り入れないべき (棄却)

| # | 参考元 | 項目 | 理由 |
|---|-------|------|------|
| 1 | Keygen.sh | ED25519/RSA 非対称署名 | 対称鍵 HMAC-SHA256 で十分。非対称は鍵管理コストが高い |
| 2 | Keygen.sh | machine binding (マシン ID バインド) | 家族 UX では親機・子機切替で破綻する |
| 3 | Keygen.sh | オフライン検証 | 常時 Cognito 認証前提のため不要 |
| 4 | Lemon Squeezy / Paddle | activate/deactivate API | one-shot consume で十分。状態機構の複雑化回避 |
| 5 | Lemon Squeezy / Paddle | license key public API 提供 | B2C で第三者統合は想定していない |
| 6 | JetBrains | License Server (自社ホスト) | Lambda + DynamoDB で十分 |
| 7 | Gumroad | 無期限キー | 紛失・漏洩時の影響が大きすぎる |
| 8 | すべて | 期限自動延長 | 購読連動を tenant 側で管理する方がシンプル |

### 4.3 差別化ポイント (独自設計)

| # | 独自項目 | 理由 |
|---|---------|------|
| 1 | **tenant = 家族** バインド | 子供向け家族 SaaS として、machine/email の既存概念では UX が合わない |
| 2 | **1 テナント 1 アクティブキー** | 同時複数デバイスを想定せず、家族全員で共有する設計 |
| 3 | **相対 90 日有効期限** | 発行から消費までの猶予のみ。購読期限は別管理 |
| 4 | **HMAC-SHA256 + 5 文字チェックサム** | 対称鍵で十分な偽造防止 + 手入力可能な長さ |
| 5 | **DynamoDB 単一テーブル + Event Sourcing** | ADR-0012 の単一テーブル設計に乗る |

---

## 5. ADR-0026 との対応

本書の「取り入れるべき」表の内容は、ADR-0026「ライセンスキーアーキテクチャ決定記録」の各決定の**根拠**として参照可能。

| ADR-0026 セクション | 本書の根拠セクション |
|-------------------|-------------------|
| A. 署名アルゴリズム (HMAC-SHA256) | §2.1, §2.10, §4.1-1, §4.2-1 |
| B. キー形式 (`GQ-XXXX-XXXX-XXXX-YYYYY`) | §2.1, §4.1-2, §4.1-3 |
| C. 文字セット (32文字除外) | §2.1, §4.1-3 |
| D. 有効期限 (90日) | §2.5, §4.3-3 |
| E. 消費モデル (one-shot) | §2.4, §4.2-4 |
| F. ストレージ (DynamoDB single-table) | §2.7, §4.3-5 |
| G. 鍵ローテーション (年1回) | §2.10 |

---

## 6. 参考リンク（必ず最新版を確認すること）

- **Keygen.sh**: https://keygen.sh/docs/api/licenses/
- **Lemon Squeezy**: https://docs.lemonsqueezy.com/help/licensing
- **Paddle**: https://developer.paddle.com/classic/guides/ZG9jOjI1MzU0MDI3-license-keys
- **Gumroad**: https://help.gumroad.com/article/76-license-keys
- **JetBrains**: https://www.jetbrains.com/help/idea/license.html
- **Stripe Billing (Coupons)**: https://docs.stripe.com/billing/subscriptions/coupons
- **Stripe Checkout Session**: https://docs.stripe.com/api/checkout/sessions

---

## 更新履歴

| 日付 | 更新内容 | 更新者 |
|------|---------|--------|
| 2026-04-11 | 初版作成 (#811) | Claude Code |
