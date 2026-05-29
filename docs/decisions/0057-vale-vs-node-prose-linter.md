# ADR-0057: Vale vs. Node.js Prose Linter 選定理由 (#2555)

## 文脈と問題点

UI における用語（Terminology）の不統一は顧客の認知負荷を高め、離脱の原因となる。
CX research §F-1 において、`labels.ts` 内に内部語彙（「パック」等）がユーザー向けラベルに混入していることが判明したため、これを機械的に検知し、`terms.ts` の SSOT 用語へ誘導する仕組みが必要となった。

## 検討したオプション

### オプション A: Vale (確立された OSS Prose Linter)

- **長所**: 確立された OSS であり、reject/substitution ルールを宣言的に記述できる。Datadog 等での採用実績あり。
- **短所**: Go バイナリへの新規依存が発生する。ローカル環境での実行にバイナリのインストールが必要（ADR-0010 / ADR-0030 整合性リスク）。

### オプション B: Node.js ベースの独自 Linter 拡充

- **長所**: プロジェクト既設の Node.js 実行環境で動作し、新規依存がゼロ。`src/lib/domain/terms.ts` を直接インポートして SSOT 定数とルールを結合できる。
- **短所**: ルールの表現力（自然言語解析等）が Vale に劣る。

## 意思決定

**オプション B (Node.js ベースの独自 Linter 拡充)** を採用する。

### 選定理由

1. **SSOT との密結合**: `terms.ts` で定義された atom（用語の最小単位）を直接インポートしてルールに組み込めるため、用語変更時の二重メンテナンスが発生しない。
2. **Pre-PMF Bucket A (Now) 適合**: 開発環境への新規ツール導入コストを最小化し、既存の `pre-ready` ワークフローに即時統合できる。
3. **repo 確立パターン**: 既存の `check-internal-terms.mjs` 等と同様の Node.js スクリプト形式を継承し、学習コストを抑える。

## ステータス

決定済み（PR #2587 にて実装）。

## 影響範囲

- `scripts/check-terminology-coherence.ts` (新規/拡充)
- `src/lib/domain/labels.ts` の用語監視
- `.claude/skills/brand-check/SKILL.md` (ツール呼び出しの変更)
