# ADR-0042: マーケットプレイス性別バリアント (`*-boy.json` / `*-girl.json`) 廃止と中立統合

- Status: proposed
- Date: 2026-04-20
- Issue: #1212 (#1212-A 子 Issue)
- 起票者: Takenori Kusaka (PO 承認待ち)
- 関連 ADR: ADR-0001 (リネーム時の後方互換必須), ADR-0035 (設計ポリシー先行確認フロー)

## Context

`src/lib/data/activity-packs/` 配下に以下 10 件の性別バリアント JSON が存在する:

| 性別パック | 統合先候補 (中立) |
|----------|---------------|
| `baby-boy.json`, `baby-girl.json` | `baby-first.json` |
| `kinder-boy.json`, `kinder-girl.json` | `kinder-starter.json` |
| `elementary-boy.json`, `elementary-girl.json` | `elementary-challenge.json` |
| `junior-boy.json`, `junior-girl.json` | `junior-high-challenge.json` |
| `senior-boy.json`, `senior-girl.json` | `senior-high-challenge.json` |

### 現状の問題

1. **競合 0 件採用**: 12 競合プロダクト中、活動パックを性別で分けるものは **0 件** (詳細: `docs/design/marketplace-competitor-analysis.md` §4)。本アプリのマイノリティ実装。
2. **内容近重複 (90%+)**: `marketplace-content-audit.md` §3 の差分監査で、`baby-boy.json` と `baby-girl.json` の活動内容差分は実質 1-2 項目 (色のラベル / 例示玩具のみ)。10 件全体で同等パターン。
3. **ジェンダーステレオタイプ強化リスク**: 内閣府男女共同参画白書 2025 の「子どもの活動領域における性別固定観念解消」方針と齟齬。
4. **メンテナンスコスト**: 1 つの活動マスタ更新で 3 ファイル (中立 + boy + girl) 同期が必要。drift 発生中 (junior/senior の 3-way 矛盾は本 Issue で発覚)。
5. **ADR-0023 (Pre-PMF) との不整合**: 200+ プリセット拡充目標に対し、10 件の重複は枠の浪費。

### ユーザー影響

性別パックを既に選択済みの既存ユーザーが存在する可能性。ただし:
- 本アプリは Pre-PMF 段階で実ユーザー数が限定的
- パック ID は DB に永続保存されているため、redirect で吸収可能

## Decision

**性別バリアント 10 件を 5 件の中立パックに統合し、ID は LEGACY_URL_MAP で redirect 吸収する。**

### 統合手順

1. 性別パックの差分活動 (色ラベル / 例示玩具など) を中立パックに **追加吸収** (削除しない、ユーザー体験の幅を維持)
2. 性別固有の文言 (例: 「男の子向けの〜」) は **中立化** (「みんなの〜」「自由に選べる〜」)
3. 性別パック JSON 10 件を物理削除
4. `LEGACY_URL_MAP` に以下 10 件の ID redirect を追加:

   ```ts
   'baby-boy' → 'baby-first'
   'baby-girl' → 'baby-first'
   'kinder-boy' → 'kinder-starter'
   'kinder-girl' → 'kinder-starter'
   'elementary-boy' → 'elementary-challenge'
   'elementary-girl' → 'elementary-challenge'
   'junior-boy' → 'junior-high-challenge'
   'junior-girl' → 'junior-high-challenge'
   'senior-boy' → 'senior-high-challenge'
   'senior-girl' → 'senior-high-challenge'
   ```

5. `tests/e2e/legacy-url-redirect.spec.ts` に 10 件の redirect E2E 検証を追加 (ADR-0001 準拠)
6. drift 検出 unit test (`tests/unit/marketplace-pack-coverage.test.ts`) で「性別パック ID は LEGACY_URL_MAP 経由のみ」を不変条件化

### DB 移行

DB に保存済みの `pack_id` カラムは redirect で透過的に解決される (アプリ層の `getMarketplaceItem` API が LEGACY_URL_MAP を先に解決)。**物理 UPDATE は不要**。

## 検討した選択肢

### 選択肢 A: 性別パック維持

- メリット: 変更ゼロ
- デメリット: 上記 Context の 5 課題が解消されない

### 選択肢 B: 性別パックを「テーマ別」(動物/乗り物/プリンセス/恐竜) に再編成

- メリット: 子供の好みに沿った提供は維持
- デメリット: 過剰な細分化で 200+ プリセット枠を圧迫。ユーザー選択の認知負荷増

### 選択肢 C: 中立統合 + LEGACY_URL_MAP 吸収 ← 本決定

- メリット: 内容の幅は中立パックに吸収して維持。重複を解消。ジェンダー中立。既存ユーザーの選択履歴は redirect で透過保護
- デメリット: 統合作業 (差分マージ) が手動。LEGACY_URL_MAP 11 件の保守義務

## Consequences

### Positive

- マスタ管理ファイル数 18 → 8 (約 56% 減)
- 1 活動更新の同期対象 3 ファイル → 1 ファイル
- ジェンダーステレオタイプ問題の解消 (内閣府方針整合)
- 200+ プリセット拡充目標に対する枠の効率化

### Negative

- LEGACY_URL_MAP に 10 件の永続的 redirect を抱える (将来削除には別 ADR で supersede が必要)
- 統合作業中の差分判定で活動内容の取りこぼしリスク → drift 検出 unit test で抑制

### Neutral

- 「男の子向け」「女の子向け」といった選択 UI は元々無い (パック選択画面は単純な ID リスト) ため、UI 変更は最小

## 関連ドキュメント

- `docs/design/marketplace-overhaul-spec.md` §6.3 (#1212-A 構造リファクタの詳細手順)
- `docs/design/marketplace-content-audit.md` §3 (性別パック差分監査)
- `docs/design/marketplace-competitor-analysis.md` §4 (競合の性別配慮対比)
- `docs/decisions/0001-rename-backward-compat.md` (LEGACY_URL_MAP 方針の親 ADR)
