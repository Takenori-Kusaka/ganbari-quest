# ADR-0041: マーケットプレイス命名「みんなのテンプレート」採用

> **archived (2026-04-20)**: no longer active-primary, kept for historical reference (#1262 sub-B)


- Status: proposed
- Date: 2026-04-20
- Issue: #1212
- 起票者: Takenori Kusaka (PO 承認待ち)
- 関連 ADR: ADR-0035 (設計ポリシー先行確認フロー), ADR-0037 (labels.ts SSOT 原則)

## Context

「マーケットプレイス」という呼称は、Pre-PMF 段階の本アプリにおいて以下 4 点で機能不全を起こしている。

1. **競合 0 件採用**: 国内 5 件 (進研ゼミ / スマイルゼミ / ファミポイ / ママペイ / やることカード) + 海外 7 件 (Habitica / Joon / Cozi / S'moresUp / OurHome / Greenlight / FamZoo) の計 12 競合中、「マーケットプレイス」を採用するプロダクトは **0 件**。Joon は「Quest Library」、Cozi は「Cozi List Library」、S'moresUp は「Built-in Chores」と、すべて用途記述型の名称を採用している。
2. **Pre-PMF で販売プラットフォーム前面化の必然性が薄い**: 本アプリのマーケットプレイスは現状すべて無料配布であり、UGC・クリエイター経済も未実装。「販売・取引の場」を意味する「マーケットプレイス」を看板にする経済的根拠がない。
3. **ペルソナ別語感マトリクスで祖父母世代に通じない**: 5 ペルソナ評価 (詳細は `docs/design/marketplace-naming-recommendation.md`):

   | 候補語 | P1: 3-5 歳児ママ | P2: 小学生児ママ | P3: 中学生児パパ | P4: 高校生児ママ | P5: 祖父母 |
   |------|---------------|---------------|----------------|----------------|----------|
   | マーケットプレイス (現状) | △ | △ | ○ | △ | **× (語自体わからない)** |
   | テンプレート | ○ | ◎ | ○ | ◎ | ○ |
   | みんなのテンプレート | ◎ | ◎ | ○ | ○ | ○ |

4. **ADR-0036 の閲覧パブリック設計と矛盾**: 未ログインユーザーの第一印象が「販売プラットフォーム」になることは、ADR-0036 で意図した「テンプレート閲覧でサービス価値を伝える」導線と齟齬がある。

## Decision

以下の用語マッピングを採用する:

| 文脈 | 旧 | 新 |
|------|-----|----|
| ナビ・breadcrumb・短縮ラベル | マーケットプレイス | **テンプレート** |
| ページタイトル (`/marketplace` 上部) | マーケットプレイス | **みんなのテンプレート** |
| サブ見出し (推薦セクション) | (なし) | **おすすめパック** |
| タブ (4 種) | (混在) | **アクティビティ集 / ごほうび集 / 持ち物リスト / ルール集** |
| インポート CTA | (バラバラ) | **使ってみる** |
| junior/senior 高難度バッジ | (なし) | **クエスト集** |

### 実装

- `src/lib/domain/labels.ts` の `MARKETPLACE_LABELS` を拡張 (`pageTitle`, `navShort`, `recommendedSection`, `tabs.{activities,rewards,checklists,rules}`, `importCta`, `questsBadge`)
- ADR-0037 (labels.ts SSOT 原則) に従い、`site/index.html` / `site/pamphlet.html` / `site/shared-labels.js` / `tutorial-chapters.ts` の並行実装すべてに同期
- LP メトリクス (`scripts/measure-lp-dimensions.mjs` の `forbiddenTerms`) に「マーケットプレイス」を追加し、移行完了後の再混入を CI 検出

### URL は維持

`/marketplace` URL は変更しない。理由:
- ADR-0001 (リネーム時の後方互換必須) に基づくコスト
- 内部技術用語としての「marketplace」は適切 (DB スキーマ・API endpoint・型名)
- 表示名と URL の一貫性は必須要件ではない (例: GitHub の「Issues」URL は `/issues` だが UI は文脈で「タスク」「課題」表示も可)

## 検討した選択肢

### 選択肢 A: 「マーケットプレイス」を維持

- メリット: 変更コストゼロ
- デメリット: 上記 Context の 4 課題が解消されない

### 選択肢 B: 「ライブラリ」採用 (Joon/Cozi 海外踏襲)

- メリット: 海外 SaaS パターン踏襲
- デメリット: P5 (祖父母) に「業務的」評価で △ / Cozi/Joon の認知ベースが日本では薄い

### 選択肢 C: 「みんなのテンプレート」/「テンプレート」採用 ← 本決定

- メリット: 5 ペルソナ全員 ◎/○ で × なし。Canva/Microsoft Office で保護者層の日常語彙化済。「みんなの〜」が NHK みんなのうた等で安心感
- デメリット: 並行実装 6 箇所の同期作業が必要 (ただし ADR-0037 の SSOT 原則で標準化済の手順)

## Consequences

### Positive

- 5 ペルソナ全員に違和感なく届く名称
- 海外 SaaS の「販売プラットフォーム」誤解を排除
- ADR-0036 の閲覧パブリック設計と整合 (テンプレートを「眺める」体験)
- 将来 UGC 化した際に「みんなの」が自然に意味拡張可能 (現状はキュレーション、将来はユーザー投稿も含む)

### Negative

- ラベル変更による既存ユーザーの一時的混乱 (ただし URL 不変のためブックマーク・URL 共有は影響なし)
- LP / pamphlet / shared-labels.js の並行実装 6 箇所同期コスト (Issue #1212-H スコープ)

### Neutral

- 「テンプレート」は他の単独名詞 (例: 「メールテンプレート」) と区別したい場合は文脈依存。本アプリはコンテキストが家庭内なので衝突リスクは低い

## 関連ドキュメント

- `docs/design/marketplace-overhaul-spec.md` §4 (命名戦略全体)
- `docs/design/marketplace-naming-recommendation.md` (5 ペルソナマトリクス詳細 + 25 候補語評価)
- `docs/design/marketplace-competitor-analysis.md` §3 (競合 12 件呼称比較)
