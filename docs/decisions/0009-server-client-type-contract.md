# ADR-0009: server→client 型契約の安全性確保

| 項目 | 内容 |
|------|------|
| ステータス | superseded |
| 日付 | 2026-04-09 |
| supersede 日 | 2026-04-19 |
| supersede 理由 | 短期ガード（#567 統合前の人力チェック）は #567 完了で不要化。中期施策（共通型定義ファイル）は `src/lib/domain/` 配下の既存型 + ADR-0037（labels SSOT）で運用済み。個別の型安全対策は ADR-0031（スキーマ変更時互換性テスト）が後継 |
| 関連 Issue | #567, #607, #623 |

## コンテキスト

SvelteKit のフォームアクション結果は `ActionData` 型として推論されるが、`enhance` のコールバック内では `result.data` が `Record<string, unknown>` として扱われるため、明示的な型キャストが必要になる。

#607 の修正で、サーバー側に `omikujiRank` を追加した際、クライアント側の型キャストも5ファイルで手動更新が必要だった:

```typescript
// server: 型推論で安全
return { omikujiRank: stamp?.stamp.omikujiRank ?? null, ... };

// client: 手動キャスト — コンパイラは不整合を検出しない
const cardData = d.cardData as {
  entries: { slot: number; emoji: string; rarity: string }[];  // ← omikujiRank 漏れ
} | null;
```

サーバーが返すフィールドとクライアントが期待するフィールドの不整合が **コンパイル時に検出されない**。

## 決定

### 短期（#567 統合前）
1. フォームアクション返却値を変更する PR では、`grep` で全クライアントのキャスト型も更新されていることを確認する
2. キャストに使用する型は可能な限り、既存のインターフェース（`StampEntryData` 等）を参照する

### 中期（#567 統合時）
3. フォームアクションの返却型を **共通の型定義ファイル** (`src/lib/domain/` 配下) で定義し、server/client 双方が参照する
4. `as Record<string, unknown>` + 個別キャストパターンを段階的に共通型に移行

### 長期
5. SvelteKit の型推論が `enhance` コールバック内でも機能するようになれば、手動キャストを撤廃

## 結果

- 短期的には人力チェックだがリスクを認識できる
- 中期的にはコンパイル時の型安全性を確保できる
- #567 統合と併せて実施することで効果が最大化

## 教訓

- **型キャストは型安全性の放棄** — `as` でキャストした瞬間、TypeScript strict の恩恵がなくなる
- **サーバーとクライアントの型は同期が必須** — SvelteKit が自動同期しない箇所は、開発者が明示的に管理する必要がある
