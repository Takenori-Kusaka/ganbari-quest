# Architecture Decision Records (ADR)

プロジェクトの重要な意思決定・教訓・仕様を記録するディレクトリ。

## 目的

- 「なぜこの設計にしたか」「過去に何が起きたか」を**リポジトリ内で**記録する
- 新しい PO / 開発者が同じ失敗を繰り返さないための制度的記憶
- Claude Code の memory（ユーザーローカル）ではなく、**git 管理される共有知識**

## テンプレート

```markdown
# ADR-NNNN: タイトル

| 項目 | 内容 |
|------|------|
| ステータス | proposed / accepted / superseded / deprecated |
| 日付 | YYYY-MM-DD |
| 関連 Issue | #番号 |

## コンテキスト
なぜこの決定が必要になったか。

## 決定
何を決定したか。

## 結果
この決定によって何が起きるか。トレードオフは何か。

## 教訓（該当する場合）
過去のインシデントから得られた教訓。
```

## 命名規則

`NNNN-kebab-case-title.md`（例: `0001-dialog-queue-required.md`）
