# Deep Research リクエスト方法論 SSOT

> **目的**: PO 補佐 (Claude Code) が Issue 起票時の事前調査を、価値判定 3 段階 (軽量 / 中規模 / 大規模) のいずれかで実行するための共通方法論。
>
> **本ファイルの位置付け**: methodology reference (連番外)。個別 research の成果物 (連番 `NN-research-<topic>.md`) はこの方法論に従って書かれる。
>
> **関連**: `docs/sessions/po-session.md` §タスク 4 / ADR-0003 (Issue 品質) / ADR-0010 (Pre-PMF) / ADR-0014 (OSS 先調査)

---

## 1. 設計背景

### 1.1 何が問題だったか

2026 年 4-5 月の LP レビュー round 1-4 で、PO セッションが 70 点品質から改善せず、約 6,000 万円規模の累積損失を計上した。根本原因は 3 つに分解される:

1. **PO 流し読み** (12 件検出): 設計書・関連 ADR を読まずに Issue を起票し、後段で「実装した結果が AC を満たさない」事象が頻発
2. **Agent 自主探索の偏り** (6 件検出): Dev / QA Agent が独自に文献調査を行ったが、PO の意図と乖離した提案を返す
3. **補佐の調査責務未定義**: PO 補佐が起票時に何を、どこまで、どの形式で調査すべきかの SSOT が無かった

### 1.2 本方法論がなかった場合の損失

- Issue 起票時の「世間が既に解決しているパターン」の見落としが継続 (ADR-0014 違反)
- 独自実装 → 半完成放置 (#1346 / #566 / #1126 / #1150 等) の再発
- 実装者 (Dev Agent) が前提知識ゼロから OSS 調査を始め、PO 意図と乖離した判断を返す悪循環

---

## 2. 設計原則

### 2.1 価値判定 3 段階で常に決め打つ

「軽量 / 中規模 / 大規模」のいずれかを **起票前に明示宣言** する。Issue 本文の冒頭 or 「設計背景」末尾で:

```markdown
## Research weight
weight: 中規模 (Issue Tree + Rust RFC Alternatives + Prior art 抜粋)
```

未宣言の Issue は PO レビューで `[must]` 差し戻し。

### 2.2 OSS / 確立パターン最低 2 件先調査 (ADR-0014 / #1350)

中規模・大規模 Issue では「OSS / 確立パターン調査結果」セクション必須。npm / GitHub / GoF / DDD / Rust RFC prior art などから最低 2 件を比較し、独自実装を退けた理由を残す。

### 2.3 出力先の 2 段階分離

- **Issue 本文**: 300-500 字の inline 要約 (PR レビュアーが Issue を見るだけで意図を理解できる量)
- **`docs/reference/NN-research-<topic>.md`**: 詳細調査 (1 次ソース URL / 比較表 / 棄却理由を含むフル resource)

両方を必ず作成し、Issue 本文末尾に reference への relative link を貼る。

---

## 3. Phase 1 調査結果 — 5 系統の方法論比較

本 SSOT を構成する 5 つの方法論系統を整理する。1 件採用するのではなく、**価値判定 3 段階に応じて組み合わせる** 方針。

### 3.1 学術系 systematic review

| 項目 | 内容 |
|---|---|
| 代表手法 | **PICO** (Cochrane Collaboration, 1990s) / **SPIDER** (Cooke et al., 2012) |
| 1 次ソース | Cochrane Handbook ( https://training.cochrane.org/handbook ) / Cooke et al. 2012 (Qual Health Res 22(10):1435-1443) |
| 強み | 「対象 / 介入 / 比較 / アウトカム」を構造化分解できる |
| 弱み | エビデンスベース医療由来で、Pre-PMF ソフトウェア開発には冗長 |
| 採用判定 | **中-大規模に部分採用** (Issue Tree の根節点を PICO で組む) |

### 3.2 戦略コンサル系

| 項目 | 内容 |
|---|---|
| 代表手法 | **Pyramid Principle** (Minto, 1973) / **Issue Tree** (McKinsey) / **MECE** |
| 1 次ソース | Barbara Minto "The Pyramid Principle" (1973 初版) / McKinsey "The McKinsey Way" (Rasiel 1999) |
| 強み | 結論先出し + サブ論点を漏れなく分解。1 line でも書ける軽量版あり |
| 弱み | エンジニアリング判断の trade-off 表現に弱い (定性比較中心) |
| 採用判定 | **全規模採用可** (軽量 = 1-line Pyramid / 中規模 = Issue Tree + MECE) |

### 3.3 AI deep research prompt

| 項目 | 内容 |
|---|---|
| 代表手法 | Anthropic / OpenAI / Gemini / Perplexity の 4 ベンダ deep research mode |
| 1 次ソース | Anthropic Claude prompt library / OpenAI Deep Research (2025-02 GA) / Google Gemini Deep Research (2024-12) / Perplexity Pro |
| 強み | 4 ベンダ共通の「query decomposition → multi-source synthesis → cite primary」骨子を踏襲すれば、どのモデルでも再現性が出る |
| 弱み | コスト (Perplexity Pro $20/月 / Gemini Advanced $20/月)。Pre-PMF Issue 1 件あたりに毎回課金は過剰 |
| 採用判定 | **採用必須** (中規模以上は Claude Code 内の WebSearch + Plan Agent で代替実装) |

### 3.4 OSS / Big Tech 設計文化

| 項目 | 内容 |
|---|---|
| 代表手法 | **Google Design Doc** (8 章固定) / **Rust RFC** (rust-lang/rfcs) / **SRE Postmortem** (Google SRE Book) / **Amazon PR-FAQ** (Working Backwards) |
| 1 次ソース | "Design Docs at Google" (Henning 2019) / rust-lang/rfcs README.md / Google SRE Book Ch.15 / Bryar & Carr "Working Backwards" 2021 |
| 強み | 「Alternatives considered」「Prior art」「Unresolved questions」が定型化され、棄却理由を残す文化が強制される |
| 弱み | 1 件あたり 1-3 日の起票コスト。軽量 UI 変更には過剰 |
| 採用判定 | **大規模に骨子のみ** (Rust RFC 8 章をテンプレ化し、Phase 2 や ADR の骨組に転用) |

### 3.5 Software engineering

| 項目 | 内容 |
|---|---|
| 代表手法 | **Spike** (XP, Beck 1999) / **Tracer Bullet** (Pragmatic Programmer, Hunt & Thomas 1999) |
| 1 次ソース | Kent Beck "Extreme Programming Explained" (1999) / Hunt & Thomas "The Pragmatic Programmer" (1999, 20th anniv. 2019) |
| 強み | 「机上で決まらない場合は最小実装で検証する」escalation path を提供 |
| 弱み | 起票時の deep research を「Spike で済ます」と称して書類化を回避するアンチパターン |
| 採用判定 | **Escalation 用** (Issue 本文に「Spike で検証する選択肢があった」と書く / 実 Spike は別 Issue) |

---

## 4. 規模別の推奨レシピ

### 4.1 軽量 (1-line Pyramid)

**対象**: UI 微修正 / カルーセル切替 / 文言 1 行修正 / アイコン差し替え 等、影響範囲が単一 component 内

**フォーマット**:

```markdown
## Research weight
weight: 軽量 (1-line Pyramid)

## 設計背景
[結論を 1 文で述べる]

選択肢: A / B / C — 採用は B (理由: [1 文])
```

**所要時間**: 5-15 分
**OSS 調査**: 不要 (3.2 戦略コンサル系のみ適用)

### 4.2 中規模 (Issue Tree + Rust RFC Alternatives + Prior art 抜粋)

**対象**: 新機能 / 新 OSS 導入 / 既存機構の動作変更 / 設計書 1 章追加 等

**フォーマット**:

```markdown
## Research weight
weight: 中規模 (Issue Tree + Rust RFC Alternatives + Prior art 抜粋)

## 設計背景
[Pyramid 結論 + Issue Tree で 3 階層分解]

## 検討した選択肢 (OSS / 確立パターン最低 2 件、ADR-0014)
- 選択肢 A: <OSS 名> — 採用実績 / メリット / 棄却理由
- 選択肢 B: <OSS 名> — 同上
- 選択肢 C: 独自実装 — A/B を退けた具体的理由

## Prior art
- <類似 OSS / 業界事例 1>: <URL> / 学び
- <類似 OSS / 業界事例 2>: <URL> / 学び
```

**所要時間**: 30-60 分
**OSS 調査**: 最低 2 件比較必須 (3.4 OSS / Big Tech 系適用)

### 4.3 大規模 (Rust RFC full 8 章 + Spike escalation)

**対象**: アーキ変更 / 障害対応 / compliance (COPPA / 特商法) / DB スキーマ / セキュリティ機能

**フォーマット (Rust RFC 8 章準拠)**:

```markdown
## Research weight
weight: 大規模 (Rust RFC full + Spike escalation 経路)

1. Summary (3.2 Pyramid)
2. Motivation (3.1 PICO 1 段目 = Population / Problem)
3. Guide-level explanation (どう使うか、ユーザ視点)
4. Reference-level explanation (内部構造)
5. Drawbacks (採用しない場合との比較)
6. Rationale and alternatives (3.4 Alternatives considered、最低 2 件)
7. Prior art (類似 OSS / 業界事例)
8. Unresolved questions (Spike で検証する項目)
```

**所要時間**: 2-8 時間
**OSS 調査**: 最低 3 件 + Prior art セクション必須
**Escalation 経路**: 机上で決まらない論点は Unresolved questions に積み、Spike Issue を別途起票

---

## 5. 採用しなかった方法論

### 5.1 Lean Canvas / Business Model Canvas

- **理由**: 事業設計フェーズ用で、機能単位 Issue の調査には粒度が粗い
- **代替**: `docs/design/33-ビジネスモデルキャンバス.md` が事業計画 SSOT。本方法論は機能 Issue 用

### 5.2 5W1H / 4W1H

- **理由**: Issue Template の項目分解で既にカバー (背景 / 解決策 / AC / 影響範囲)
- **代替**: テンプレ準拠で十分

### 5.3 ChatGPT Plugins / Custom GPT

- **理由**: Pre-PMF コスト (Plus $20/月) と Claude Code 内 WebSearch の重複
- **代替**: Claude Code WebSearch + Plan Agent で同等価値を実現

---

## 6. 運用ルール

### 6.1 PO 確認 4 段階

| 段階 | 補佐の作業 | PO の確認 |
|------|----------|---------|
| **(1) フェーズ開始** | weight 仮判定 + 調査範囲提案 | 「軽量 / 中規模 / 大規模」を承認 |
| **(2) prompt 確定前** | Issue Tree / RFC 8 章の枠を提示 | 論点の漏れ / 過剰 を指摘 |
| **(3) 結果提出時** | reference file を draft 公開 | 内容承認 / 棄却理由の妥当性確認 |
| **(4) 起票前** | Issue body + reference link 同期 | 起票 GO/NO-GO 最終判断 |

### 6.2 reference file 命名規則

- **methodology reference (連番外)**: 本 file (`deep-research-request-methodology.md`)
- **research 連番**: `docs/reference/NN-research-<topic>.md` (NN は通し番号 01 から)

### 6.3 削除・改訂

- 本 SSOT が陳腐化した場合 (新ベンダ deep research 登場、Rust RFC 改訂など)、ADR で改訂宣言してから本 file を更新
- per-Issue の reference (`NN-research-*.md`) は削除しない (歴史的記録として保全)

---

## 7. 関連ドキュメント

| ドキュメント | 用途 |
|---|---|
| `docs/sessions/po-session.md` §タスク 4 | 本 SSOT の運用手順 |
| `docs/decisions/0003-issue-quality-standard.md` | Issue 品質 SSOT |
| `docs/decisions/0010-pre-pmf-scope-judgment.md` | Pre-PMF scope 判断 (OSS 調査コスト判断) |
| `docs/decisions/README.md` §OSS 先調査ルール | OSS 先調査ルール SSOT（旧 ADR-0014 は #2440 PR-A5 で削除） |
| `.claude/skills/issue-triage/SKILL.md` | 7 ステップフェーズゲート (本 SSOT は ステップ 1.7 として組み込む将来計画) |
