# 0002. ダイアログキュー必須

| 項目 | 内容 |
|------|------|
| ステータス | implemented |
| 日付 | 2026-03-28 |
| 実装日 | 2026-04-10 |
| 起票者 | 日下武紀 |
| 関連 Issue | #543, #611, #671 |
| 実装 PR | #683 |

## コンテキスト

#543 でダイアログフリーズのバグを修正したが、同日にマージされた #539（ルートリネーム）で修正が旧ファイル名に適用されたまま新ファイル名には反映されず、#611 で再発した。

Issue #543 で提案された「ダイアログキュー」は未実装のまま closes された。E2E テストなし、セルフレビュー + Copilot のみでマージ。

## 決定

複数のダイアログ/オーバーレイが同時に表示される可能性がある画面では、ダイアログキューを実装して表示順序を制御する。1つのダイアログが閉じるまで次のダイアログを表示しない。

## 結果

- ダイアログのフリーズ・重なり問題が根本的に解決される
- Issue で提案された対策を全て実装してからクローズするプロセスが確立された

## 実装詳細（#683 で実装）

- **DialogFSM** (`src/lib/features/child-home/dialog-state-machine.ts`): 純TypeScript FSMクラス
  - `current`: 現在表示中のダイアログ（'idle' で非表示）
  - `queue`: 待機中ダイアログの優先度付きキュー
  - `processed`: `${type}:${id}` 形式のキーで再トリガー防止
  - `onDataLoad()`: ページデータから自動トリガー対象を優先度順にエンキュー
  - `transition()` / `close()`: 手動トリガー / ダイアログ閉じ→次のダイアログ表示
- **OverlaysSection** (`src/lib/features/child-home/components/OverlaysSection.svelte`): FSM.current から `$derived` で各ダイアログの open 状態を導出
- **birthdayダイアログ**: バナークリック（`handleBirthdayOpen`）でのみ開く（自動トリガー対象外）
- **ユニットテスト**: 32件（dialog-state-machine.test.ts）
