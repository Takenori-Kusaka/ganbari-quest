# 0016. ダイアログ/オーバーレイの状態管理方針

| 項目 | 内容 |
|------|------|
| ステータス | superseded |
| 日付 | 2026-04-10 |
| supersede 日 | 2026-04-19 |
| supersede 先 | ADR-0019（ダイアログ管理は FSM でスクラップ＆ビルド） |
| supersede 理由 | 本 ADR の OverlaysSection 内部キュー実装は ADR-0019「廃止するもの」に明記され、FSM 方式に置き換え済み |
| 起票者 | PO |
| 関連 Issue | #671, #543, #611 |

## コンテキスト

子供ホーム画面では活動記録後に複数のダイアログ（結果→コンボ→スタンプ→レベルアップ等）が連鎖する。
各ダイアログを個別の `$state` フラグ + `$effect` で管理すると、以下の問題が発生した:

1. 複数ダイアログの同時表示（#543）
2. 状態フラグの循環依存による無限ループ（#671）
3. `invalidateAll()` 後のダイアログ再表示（#611）

## 決定

1. **ダイアログ表示は集中管理する**: 個別の `xxxOpen = true/false` フラグの散在を禁止
2. **同時に開くダイアログは1つ以下**: 優先度キュー方式で次のダイアログを順次表示
3. **一度表示したダイアログの再トリガー防止**: データID単位で表示済みを管理

**注**: ADR-0002（ダイアログキュー必須）の方針を引き継ぎ、具体的な実装指針を追加。

## 現在の実装

- **オーバーレイキュー**: `src/lib/features/child-home/components/OverlaysSection.svelte` 内の `queue` / `activeOverlay` / `enqueueOverlay()` / `dequeueOverlay()` でキュー方式の集中管理を実現
- `OverlayType` 型で管理対象を定義（`'stampPress' | 'levelUp' | 'reward' | 'birthday'`）
- 新しいオーバーレイを追加する場合は `OverlayType` に追加し、`enqueueOverlay` / `dequeueOverlay` で管理すること

## 結果

- 子供ホーム画面のオーバーレイ管理が一元化される
- 新しいダイアログ追加時は集中管理に統合する必要がある
