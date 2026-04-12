# ライセンスキー要件定義書（should-be / user stories）

| 項目 | 値 |
|------|-----|
| 版数 | 1.0 |
| 作成日 | 2026-04-11 |
| 関連 Issue | #812（本書）, #814 EPIC |
| 関連 ADR | ADR-0025（License ↔ Stripe 因果関係）, ADR-0026（ライセンスキーアーキテクチャ） |
| 参照設計書 | `07-API設計書.md`, `08-データベース設計書.md`, `19-プライシング戦略書.md`, `license-subscription-causality.md` |

---

## 0. この文書の位置付け

ライセンスキー周辺の実装課題が#795〜#813 に散在しており、全体像と優先度が見えにくい状態にある。
本書はそれら個別 Issue を束ねる **上位要件定義書** として:

1. 現状の致命的課題をサマリする
2. あるべき姿（should-be）を定義する
3. user story 形式で利用者視点の要求を記述する
4. 非機能要件を明示する
5. 個別 Issue への逆マッピングを提供する

実装は #814 EPIC で段階的に進める。本書は SSOT として、実装 PR はこの要件に照らしてレビューする。

---

## 1. 現状課題のサマリ（gap analysis）

実装調査（`src/lib/server/services/license-key-service.ts` / `/admin/license` / Stripe webhook handler）から得た既知の課題:

### 1.1 致命的（Critical）

| # | 課題 | 影響 | 対応 Issue |
|---|------|------|----------|
| 1 | `consumeLicenseKey` が tenant の plan を更新しない | 決済完了してもユーザーは無料プランのまま | #796 |
| 2 | `/admin/license` に既存ユーザー向けの適用 UI・action が存在しない | 購入後にキーを入力する画面がない | #796 |

### 1.2 高優先度（High）

| # | 課題 | 影響 | 対応 Issue |
|---|------|------|----------|
| 3 | owner 制約がない | 子供アカウントでも親のライセンスキーを消費できてしまう | #798 |
| 4 | 一回限り使用の警告ダイアログがない | 入力ミスでキーが消費され、ユーザーサポート負荷増 | #799 |
| 5 | `expiresAt` / `revokedAt` / `revokedReason` がない | 期限管理・失効記録ができない | #797 |
| 6 | 失効（revoke）管理画面・API が存在しない | チャージバック・不正キー対応ができない | #805 |
| 7 | 監査ログ・イベントログが存在しない | 誰がいつキーを消費したか追跡不可 | #804 |
| 8 | 購入者と異なる tenant で consume 可能（不正リスク） | family-migration 悪用（自分のキーを friend の tenant に消費） | #801 |
| 9 | Stripe クーポン/プロモコード連携で 100% OFF Checkout 未実装 | campaign 配布の実装基盤がない | #803 |
| 10 | campaign 用ライセンスキー払出 Ops endpoint が存在しない | 運営がキーを発行できない | #802 |
| 11 | 設計書にライセンスキーライフサイクル全仕様が記載されていない | 07/08/19/24 設計書に記述なし | #808 |
| 12 | E2E ライフサイクルテストが存在しない | 発行 → consume → expire → revoke の回帰が拾えない | #810 |
| 13 | ADR がない | 設計判断の根拠が失われる | #809（ADR-0026 で対応済み） |

### 1.3 中優先度（Medium）

| # | 課題 | 影響 | 対応 Issue |
|---|------|------|----------|
| 14 | HMAC 署名が optional、legacy format 受け入れ | セキュリティ後退、CI テスト環境のバグが本番に漏れる | #806 |
| 15 | HMAC シークレットのローテーションポリシー未定義 | 秘密鍵漏洩時の対応手順がない | #807 |
| 16 | validate / consume API レート制限がない | ブルートフォース攻撃・列挙攻撃の余地 | #813 |
| 17 | `listLicenseKeysByTenant` 等の検索メソッドがない | Ops 画面の一覧・検索機能が実装不可 | #816 |
| 18 | 配布メール（SES）テンプレート未整備 | 購入完了 → キー配布のメール UX が雑 | #815 |
| 19 | /demo 環境にキー適用フローのモック無し | デモでライセンスキー体験ができない | #817 |
| 20 | 競合分析ドキュメント未作成 | 他社実装と比較したベンチマークがない | #811 |

---

## 2. Should-be State（あるべき姿）

### 2.1 ライフサイクル

```
[発行] → [配布] → [validate] → [consume] → [active 期間] → [期限切れ or 手動 revoke]
   ↑        ↑         ↑           ↑             ↑               ↑
 Stripe    SES      入力画面     適用 UI      有料機能          状態遷移
 webhook  or Ops   で事前検証   で紐付け     利用可能           による失効
```

詳細の状態遷移は `license-subscription-causality.md` §2 を参照。

### 2.2 キー種別

| 種別 | `kind` | 発行経路 | 期限 | 例 |
|------|------|---------|------|-----|
| 通常購入 | `purchase` | Stripe Checkout 成功 | `current_period_end` | 月額/年額購入 |
| 贈答 | `gift` | /ops から運営が発行 | 発行日 +90 日 | トラブル補償、テスター配布 |
| campaign | `campaign` | Stripe 100% OFF クーポン | クーポン期限まで | 友達招待、SNS キャンペーン |

### 2.3 紐付けポリシー

- **tenant 単位**で紐付け（家族グループ = 1 tenant）
- **owner のみ適用可**（子供アカウントからは入力不可）
- **購入者 tenant 以外の consume** は拒否しない（贈答・campaign 対応）が、レート制限で保護

### 2.4 期限管理

- **デフォルト**: 発行から 90 日で `expired`
- **上書き**: 種別ごとにカスタム期限（purchase は Stripe `current_period_end`、campaign はクーポン期限）
- **Grace period**: `expired` 後 30 日は `status='expired'` として保持（運営参照・監査用）、その後 DynamoDB TTL で自動削除

### 2.5 監査ログ

全イベントを `license_events` テーブルに記録:

| event type | 記録タイミング | ログ保持期間 |
|-----------|-------------|----------|
| `issued` | キー発行成功 | 2 年 |
| `validated` | validate API 呼び出し | 90 日（ブルートフォース検知用） |
| `consumed` | consume 成功 | 2 年 |
| `consume_failed` | consume 失敗（理由別） | 90 日 |
| `revoked` | 手動/自動 revoke | 2 年 |
| `expired` | 期限切れ自動遷移 | 2 年 |

### 2.6 Ops 機能

- **一括発行**: CSV / フォームから gift / campaign キー一括発行
- **検索・一覧**: tenant ID / status / kind / 発行日で絞り込み
- **手動 revoke**: 理由必須、監査ログに運営 ID 記録
- **CSV エクスポート**: 指定期間のキー一覧を CSV 出力
- **統計ダッシュボード**: 発行数 / consume 数 / expire 数 / revoke 数を日次集計

### 2.7 セキュリティ要件

- **HMAC 必須化** — `AWS_LICENSE_SECRET` 未設定時は起動失敗
- **Legacy format** — 既存キーのみ読み取り専用、新規発行は全て署名付き
- **レート制限** — validate/consume は IP: 10 req/min + email: 20 req/hour（二次元制限、Discord 通知付き）
- **警告ダイアログ** — 適用前に「一回限り使用」を明示、確認チェック必須
- **owner 制約** — 子供アカウントでは UI 自体を表示しない
- **ブルートフォース対策** — IP: 10 req/min, email: 20 req/hour 超過で一時ブロック + Discord incident 通知

### 2.8 決済連携

- Stripe Checkout 成功 → webhook → license 自動発行（現行実装の延長）
- 100% OFF クーポン経由の Checkout も同一経路（`kind` のみ区別）
- 決済失敗時は license 発行しない（現行通り）

---

## 3. User Stories

### 3.1 エンドユーザー（親）

```
US-01: 親として、購入完了後に受け取ったライセンスキーを /admin/license から有効化したい
       理由: 有料機能をすぐに使えるようにするため
       受け入れ条件:
         - /admin/license にキー入力フォームがある
         - キー入力後、tenant.plan が即座に更新される
         - 成功時に確認トーストが表示される
         - 失敗時に理由（期限切れ/失効済/既消費等）が表示される
```

```
US-02: 親として、キャンペーンで受け取ったキーを signup 時に入力したい
       理由: 新規登録と同時に有料プラン体験を開始するため
       受け入れ条件:
         - signup フォームにオプショナルのキー入力欄がある
         - キーが有効なら tenant 作成と同時に consume される
         - 無効なキーは signup 自体は成功、warning 表示
```

```
US-03: 親として、キー適用前に「一度使うと返品できない」警告を見たい
       理由: 入力ミスでキーを無駄にしないため
       受け入れ条件:
         - 適用ボタン押下時に警告ダイアログが表示される
         - 「理解しました」チェックボックスなしでは進めない
```

```
US-04: 親として、適用に失敗した場合、理由を具体的に知りたい
       理由: サポートに問い合わせる際に状況を説明できるため
       受け入れ条件:
         - エラー理由は `{ code, currentTier, requiredTier, reason }` 形式
         - code は `LICENSE_EXPIRED` / `LICENSE_CONSUMED` / `LICENSE_NOT_FOUND` / `LICENSE_REVOKED` / `LICENSE_SIGNATURE_INVALID` のいずれか
```

### 3.2 運営（Ops）

```
US-05: 運営として、キャンペーン用キーを /ops から一括発行したい
       理由: SNS 施策で 100 件のキーを配布するため
       受け入れ条件:
         - /ops/license にバルク発行フォームがある
         - 種別・件数・期限を指定可能
         - 発行後に CSV ダウンロード可能
         - 発行ログが監査テーブルに記録される
```

```
US-06: 運営として、チャージバック発生時にキーを失効させたい
       理由: 不正利用を阻止するため
       受け入れ条件:
         - /ops/license から個別 revoke 可能
         - revoke 理由を必須入力
         - 監査ログに運営 ID と理由が記録される
         - 該当 tenant の plan_state が自動的に再評価される
```

```
US-07: 運営として、特定 tenant の全キー履歴を確認したい
       理由: サポート問い合わせ対応のため
       受け入れ条件:
         - tenant ID で検索可能
         - 発行・validate・consume・revoke・expire 全イベント表示
         - CSV エクスポート可能
```

### 3.3 カスタマーサポート

```
US-08: CS として、「キーが使えない」問い合わせの原因を特定したい
       理由: 適切な対応（再発行 / 拒否 / 返金）を判断するため
       受け入れ条件:
         - /ops/license でキーを検索
         - status / consume 履歴 / revoke 理由が表示される
         - 必要に応じて代替キーを再発行できる
```

### 3.4 セキュリティ担当

```
US-09: セキュリティ担当として、漏洩した HMAC シークレットをローテーションしたい
       理由: 秘密鍵漏洩時の影響を最小化するため
       受け入れ条件:
         - 新鍵発行手順が手順書化されている (#807)
         - 旧鍵で署名されたキーは grace period 30 日間検証可能
         - ローテーション完了後、旧鍵は AWS Secrets Manager から削除
```

### 3.5 開発者

```
US-10: 開発者として、license key の E2E テストを実行したい
       理由: リグレッションを拾うため
       受け入れ条件:
         - 発行 → validate → consume → expire → revoke の全シナリオ E2E (#810)
         - テスト専用の HMAC secret で署名付きキーを生成可能
         - Playwright で /admin/license UI を操作可能
```

---

## 4. 非機能要件（NFR）

| カテゴリ | 要件 | 測定方法 |
|---------|------|---------|
| **パフォーマンス** | validate API レスポンス < 200ms (p95) | CloudWatch Lambda duration |
| **パフォーマンス** | 同時発行 1,000 件/回 を 10 秒以内 | Ops バルク発行時の計測 |
| **可用性** | license API の月間稼働率 99.9% | CloudWatch SLO アラーム |
| **セキュリティ** | HMAC 必須、未設定時は起動失敗 | `license-key-service.ts` の初期化で検証 |
| **セキュリティ** | validate/consume のレート制限 IP: 10 req/min, email: 20 req/hour | インメモリ Map ベース (`rate-limit-service.ts`) |
| **監査性** | 全イベントログ保持 2 年、validate ログ 90 日 | DynamoDB TTL |
| **鍵ローテーション** | grace period 30 日（旧鍵有効期間） | AWS Secrets Manager + keyVersion |
| **運用** | /ops で CSV エクスポート可能 | API Gateway + S3 pre-signed URL |
| **テスト** | E2E カバレッジ 100%（主要シナリオ） | Playwright CI |

---

## 5. 個別 Issue への逆マッピング

本要件定義から各実装 Issue への対応を示す。`#814` EPIC で実装順序を管理する。

| 要件項目 | 対応 Issue | 優先度 |
|---------|----------|------|
| `consumeLicenseKey` が plan を更新する | #796 | Critical |
| /admin/license 適用 UI 実装 | #796 | Critical |
| owner 制約 | #798 | High |
| 警告ダイアログ | #799 | High |
| `expiresAt` / `revokedAt` 追加 | #797 | High |
| revoke 管理画面・API | #805 | High |
| 監査ログ (`license_events`) | #804 | High |
| 購入者と異なる tenant での consume（対策＋モニタリング） | #801 | High |
| Stripe 100% OFF Checkout 連携 | #803 | High |
| campaign 用 Ops endpoint | #802 | High |
| 設計書（07/08/19）更新 | #808 | High |
| E2E ライフサイクルテスト | #810 | High |
| ADR 作成 | #809 | High（ADR-0026 で対応済み） |
| HMAC 必須化 | #806 | Medium |
| シークレットローテーションポリシー | #807 | Medium |
| レート制限 | #813 | Medium |
| 検索メソッド追加 | #816 | Medium |
| SES テンプレート | #815 | Medium |
| /demo モック配置 | #817 | Medium |
| 競合分析 | #811 | Medium |
| 因果関係マップ（License ↔ Stripe） | #824 | High（#824 で対応済み） |

---

## 6. 実装ロードマップ（#814 EPIC 進行順）

### Phase 1: 致命的バグ修正（Sprint 1）
- #796（UI + action）
- #797（`expiresAt` フィールド追加）
- #798（owner 制約）

### Phase 2: セキュリティ・監査基盤（Sprint 2）
- #806（HMAC 必須化）
- #804（監査ログ基盤）
- #799（警告ダイアログ）
- #813（レート制限）

### Phase 3: Ops 機能（Sprint 3）
- #805（revoke 管理画面・API）
- #802（campaign 発行 endpoint）
- #816（検索メソッド）
- #801（不正 consume モニタリング）

### Phase 4: 決済連携拡張（Sprint 4）
- #803（100% OFF クーポン Checkout）
- #815（SES テンプレート）

### Phase 5: E2E・運用整備（Sprint 5）
- #810（E2E テスト）
- #807（鍵ローテーションプロセス）
- #808（設計書更新）
- #817（/demo モック）
- #811（競合分析）

---

## 7. レビュー・承認

本要件定義書は以下の承認で accepted とする:

- [x] author 自己確認（起票者）
- [ ] PO レビュー
- [ ] 設計書 SSOT レビュー（ADR-0003 準拠）

実装 Issue は本書の要件に照らしてレビューする。新規要件・変更が発生した場合は本書を更新し、履歴に追記する。

---

## 改訂履歴

| 版 | 日付 | 変更内容 |
|----|------|---------|
| 1.0 | 2026-04-11 | 初版。#812 起票に対応。現状課題 20 項目の gap analysis、should-be、user stories 10 件、NFR、実装ロードマップを整理 |
