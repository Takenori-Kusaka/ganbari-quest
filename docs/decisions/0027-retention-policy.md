# ADR-0027: プラン別履歴保持期間ポリシー（retention = 表示フィルタ）

| 項目 | 内容 |
|------|------|
| ステータス | **superseded by [ADR-0028](0028-retention-physical-delete.md)** |
| 日付 | 2026-04-12（supersede: 2026-04-11） |
| 起票者 | Takenori-Kusaka |
| 関連 Issue | #745, #729, #737, #717 |
| 関連 ADR | ADR-0003（設計書 SSOT）, ADR-0015（Repository パターン）, ADR-0024（プラン解決パターン）, ADR-0025（License ↔ Subscription 因果関係） |

> **⚠️ この ADR は [ADR-0028](0028-retention-physical-delete.md) により上書きされました。**
> 本 ADR は「retention = 表示フィルタのみ、物理削除なし」を正仕様としていましたが、
> pricing page の約束（90 日/1 年/無制限）と実態の乖離（#717）が消費者保護・GDPR Art. 5(1)(e) の
> 保存制限原則に抵触するため、2026-04-11 に物理削除 cron を導入する方針に変更されました。
> 現行の正仕様は ADR-0028 を参照してください。

## コンテキスト

プラン別の履歴保持期間（retention）は `PLAN_LIMITS.historyRetentionDays` で定義されているが、仕様書上の定義と実装の対応関係が未記載だった。

| プラン | `historyRetentionDays` | 意味 |
|--------|----------------------|------|
| free | `90` | 90 日より前のレコードは非表示 |
| standard | `365` | 1 年より前のレコードは非表示 |
| family | `null` | 制限なし（全期間表示） |

実装は `src/lib/server/services/plan-limit-service.ts` の以下 3 関数に集約されている:

| 関数 | 責務 |
|------|------|
| `getHistoryCutoffDate(tier)` | カットオフ日（YYYY-MM-DD）を計算する。`null` なら制限なし |
| `applyRetentionFilter(tier, { from, to })` | `from` が cutoff より前なら cutoff で上書きした日付範囲を返す（読み取り時のフィルタ） |
| `hasArchivedData(tenantId, childId, tier)` | cutoff より前にデータがあるか判定する（アップグレード誘導バナー用） |

### 呼び出し側

- `src/routes/(child)/[uiMode=uiMode]/(character)/history/+page.server.ts`: 子供側の履歴画面で `applyRetentionFilter` 後に `getActivityLogs` を呼ぶ
- `src/routes/(parent)/admin/children/+page.server.ts`: 管理画面の子供ページで `applyRetentionFilter` + `hasArchivedData` を使用
- `src/lib/features/admin/components/ArchiveBanner.svelte`: `hasArchivedData === true` のときにアップグレード誘導を表示

## 決定事項

**retention は「表示フィルタ（論理削除相当）」として実装する。物理削除は行わない。**

### 1. retention = 表示フィルタ（物理削除なし）

- DB 上のレコードは**常に全期間保持**する
- プラン別カットオフは**読み取り時のフィルタ**として適用する（`applyRetentionFilter`）
- アーカイブ削除用の cron / バッチは**実装しない**

**根拠:**

1. ストレージコストより UX リスクの方が大きい — 物理削除すると downgrade / 誤課金キャンセルで過去データが復旧不能になる
2. downgrade したユーザーが family に復帰したとき「過去のがんばり記録」がそのまま蘇る設計が子供向けプロダクトとして重要
3. 活動ログは 1 家族あたり年間 1MB 程度であり、3〜5 年の全保持でも DynamoDB コストは無視できる
4. SQLite（セルフホスト）では物理削除する実装上の動機がさらに弱い（`auth === 'local'` は常に family 相当）

### 2. 集計値は保持期間の影響を受けない

`report_daily_summaries` テーブル（§3. の日次バッチ集計）はプラン関係なく全期間の集計値を保持する。retention フィルタは**当該テーブルには適用しない**。

**理由:**
- 集計値（合計ポイント・達成数・レベル推移）は過去の "がんばりの証" であり、プランを下げても失われるべきではない
- 集計値の物理サイズは日次 1 行 × 家族数しかなく、圧倒的に小さい
- 月次レポート画面（有料機能）は保持期間の影響を受けない前提で設計されている

### 3. アップグレード誘導バナー

`hasArchivedData()` が true を返す（= cutoff より前にレコードがある）家族に対して、`ArchiveBanner.svelte` が「過去のデータが隠れています、ファミリープランで全期間閲覧できます」というアップグレード誘導を表示する。

これにより「データを消された」ではなく「プランを上げれば蘇る」という体験になる。

### 4. プラン downgrade 時の扱い

- 既存レコードは DB 上残る
- 次回リクエストから `applyRetentionFilter` が cutoff より前のデータを隠す
- downgrade 時点で警告モーダル（`hasArchivedData` と同等の文言）を出すのは UI 側の責務

### 5. 物理削除は「アカウント削除」のみ

物理削除が発生するのは以下のみ:

| トリガ | 対象 | grace period |
|-------|------|--------------|
| ユーザーによるアカウント削除 | 当該テナントの全レコード | 30 日（ADR-0022） |
| 違反アカウント強制削除 | 当該テナントの全レコード | なし |

これらは retention とは**別軸**で、`data-service.clearAllFamilyData()` が担う。

## 影響範囲

### 設計書

- `docs/design/08-データベース設計書.md` §6.X に本ポリシーを追記（#745 PR でコミット）
- `docs/design/07-API設計書.md` の履歴系 API 説明に「cutoff フィルタ」注記を将来追加

### 実装

既存実装（`applyRetentionFilter` / `hasArchivedData`）は本 ADR の結論と整合しており、**コード変更不要**。

### テスト

- `tests/unit/services/plan-limit-service.test.ts` に `getHistoryCutoffDate` のユニットテスト（free=90日/standard=365日/family=null）が存在することを確認済み。`applyRetentionFilter` / `hasArchivedData` のテストは未整備（将来追加推奨）
- 新しい集計テーブルや物理削除 cron を導入する場合は本 ADR を差し戻して再検討すること

## 代替案と却下理由

### A. 物理削除 cron を実装する（#729 の原案）

**却下理由:** 上記「根拠」参照。データ復元不能になる UX リスクとストレージ節約がつり合わない。

### B. SQLite と DynamoDB で異なる retention 実装にする

**却下理由:** duplicated implementation risk。本プロジェクトはどちらのバックエンドでも同じ UX を保証する方針（`src/lib/server/db/factory.ts`）。

### C. retention を「論理削除フラグ」カラムで表現する

**却下理由:** downgrade → upgrade 時にフラグを付け替えるバッチが必要になり、unnecessary complexity。日付比較だけで済む現行実装の方がシンプル。

## フォローアップ

- [x] #745 PR で 08-DB 設計書に §6.5 保持期間ポリシーを追記（本 ADR へのリンクを含む）
- [ ] 将来的に retention を UI 上で変更する機能が出てきたら、「カットオフ日時点のスナップショット」を保存する要件が発生する可能性あり。その時点で本 ADR を再検討
- [ ] 集計テーブル（`report_daily_summaries` 以外の kind of summary）を追加する場合、本 ADR の「集計値は保持期間の影響を受けない」原則を守ること

## 関連

- #729: 実削除 cron が無い問題（→ 本 ADR により「cron 不要」が正仕様）
- #737: 保持期間ポリシーの明文化要求
- ADR-0022: 課金サイクルとデータライフサイクルの整合性
- ADR-0024: プラン解決パターン
