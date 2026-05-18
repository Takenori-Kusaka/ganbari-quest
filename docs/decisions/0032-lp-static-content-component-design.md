# 0032. LP 静的コンテンツ コンポーネント設計原則 (SOLID 監査 + 共通化方針)

| 項目 | 内容 |
|------|------|
| ステータス | **accepted (2026-05-02)** |
| 日付 | 2026-05-02 |
| 起票者 | PO |
| 関連 Issue | #1849 |
| 関連 ADR | ADR-0001 (設計書 SSOT) / ADR-0009 (labels.ts SSOT) / ADR-0010 (Pre-PMF スコープ) / ADR-0013 (LP truth) / ADR-0025 (LP SSOT 注入機構) / ADR-0029 (LP CSP) |

## 1. コンテキスト

- LP (`site/**`) は静的 HTML だが、`#1820` (R-CRT-2 装飾枠 5→1 統一) / `#1846` (PO-N-4 machine-tour grid 4→2) / `#1847` (PO-N-5 soft-features featured h3 残骸) と「中途半端統一の symptom」が連続発生している。
- 原因は **LP の card / button / grid / section heading が個別 class で重複定義** されており、SOLID (特に SRP / DRY / OCP) に反した状態のまま継続改修されていること。

- PO 補足発言 (2026-05-02):
> shared-label.js で svelte も静的コンテンツも共用できているなら確かに Pre-PMF としてやりすぎだと思います。
- であれば静的コンテンツとしてセクションごとのコンポーネント共通化など、静的コンテンツとはいえクラス設計や共通コンポーネント化など実装全体が SOLID 原則に反した LP になっていないかが心配です。
- >
> 私の変えるな、はセクションの表現が伝え方、メッセージを変えるな、であってその内部実装が汚いのを直すな、とは言ってません。

### 1.1 現状監査 (Before の数値根拠)

| 指標 | 値 | 検出方法 |
|------|---|---------|
| `background:#fff;border:1px solid var(--gray-300);border-radius:var(--radius)` の card パターン直書き | **5 ファイル / 9 箇所**（index.html 4 / pricing.html 2 / pamphlet.html 1 / selfhost.html 1 / その他 1） | `Grep "background:#fff;border:1px solid var(--gray-300)"` |
| `repeat(N,1fr)` 等の grid template 直書き | **4 ファイル / 14 箇所** | `Grep "repeat\(.*1fr\)"` |
| `.section-title` / `.section-desc` 参照 | **2 ファイル / 41 箇所** （index.html 32 / selfhost.html 9） | `Grep "section-title|section-desc"` |
| LP 9 ファイル合計行数 | **約 3,627 行** | `wc -l site/*.html site/shared.css` |
| `#1820` Re-Review で検出された残骸 (`box-shadow` / `2px solid` 強調差分) | featured h3 の強調差分残骸（#1847 PO-N-5 で再検出） | `#1847` 本文 |

### 1.2 共通化候補 (`#1849` 本文より)

| 系統 | LP 内 class（現状） | 重複度 |
|------|-------------------|-------|
| **card 系** | `versus-card` / `soft-card` / `tour-card` / `gr-stage` / `clp-card` / `plan-card` / `step-card` / `faq-card` / `pattern-card` / `req-card` / `core-loop-card` | **5+** |
| **button 系** | `hero-cta` / `floating-cta` / `cta-bottom .cta-buttons` / `pp-cta .btn` | **3** |
| **grid 系** | `repeat(2,1fr)` / `repeat(3,1fr)` / `repeat(4,1fr)` / `repeat(5,1fr)` / `repeat(auto-fit,minmax(...))` の混在 | 14 箇所 |
| **section heading 系** | `.section-title` + `.section-desc` 各セクションで個別記述 | 41 参照 |

## 2. 検討した選択肢（OSS / 確立パターン最低 2 件 — #1350）

- 調査した一次資料:
- **OOCSS (Object Oriented CSS, Nicole Sullivan)** — 構造 (skin) と表現 (structure) を分離する確立パターン
- **BEM (Block Element Modifier)** — 命名規約による DRY と OCP の達成。
- GitHub / WordPress / Yandex 等で採用実績
- **Tailwind CSS @apply / utility-first** — utility class を組合せて variant を表現（採用実績豊富）
- **CUBE CSS (Andy Bell)** — Composition / Utility / Block / Exception の階層化。
- 静的サイト向け軽量手法
- **MDN — CSS custom properties (variables)** — `:root` 変数で base token 化、変数差替えで variant を実現
- **Bootstrap utility API** — variant modifier を CSS 変数 + class で表現。

### 選択肢 A: BEM (Block Element Modifier) base + variant modifier
- 概要: `lp-card`（block） / `lp-card__title`（element） / `lp-card--featured`（modifier）の命名で base + variant を分離
- メリット: 学習コストが低く採用実績豊富。LP 既存 class (`tour-card` / `versus-card`) も「BEM 風」に近いため移行コスト最小
- デメリット: `lp-card--featured` 等の variant modifier を増やしすぎると別問題（クラス名爆発）。命名規律が必要
- Pre-PMF コスト: 既存 class を `lp-{block}` 系に rename + 共通装飾を base class に集約。bundle 影響ゼロ（static CSS のみ）

### 選択肢 B: CUBE CSS (Composition + Utility + Block + Exception)
- 概要: 装飾と layout を分離し、utility class (`u-grid-3 u-gap-md` 等) で variant を表現
- メリット: 4 軸明示で SRP 遵守が強い。Andy Bell の Every Layout / Set for Stun 等で採用実績
- デメリット: utility class を多用すると HTML 側が冗長化し、SSOT 注入機構 (ADR-0025) との相性が悪い（class 列が増えると `data-lp-key` 注入経路が複雑化）
- Pre-PMF コスト: utility class table の整備工数が高い。BEM より初期コスト大

### 選択肢 C: Tailwind CSS @apply (utility-first)
- 概要: Tailwind の `@apply` で `.lp-card` 等の semantic class を utility 合成で定義
- メリット: utility-first で DRY が強い。アプリ側 (`src/`) で既に Tailwind 採用済みのため整合性高い
- デメリット: LP は **GitHub Pages 静的配信** で SvelteKit の build pipeline を使わない。Tailwind の build step を `site/` 専用に追加するのは Pre-PMF 段階で過剰投資。CSS 変数 + base class の方が軽量
- Pre-PMF コスト: build pipeline 追加 (PostCSS / tailwindcss) + CI 拡張 + bundle size 増（Tailwind base CSS）。**ADR-0010 Pre-PMF スコープ判断でバケット C 寄り**

### 選択肢 D: 独自実装（base class 集約 + CSS custom properties variant）
- 概要: 共通化対象に `lp-card` / `lp-section-header` / `lp-cta` / `lp-grid-{N}` の base class を新設し、各 variant は CSS 変数（`--card-accent` 等）で差替え
- メリット: BEM と Tailwind の良さを取り込みつつ、build pipeline ゼロで実現。LP 既存の `--brand-*` / `--gray-*` トークンの延長線で運用可能
- デメリット: 命名規約が緩いと variant 爆発のリスク。本 ADR §3 で命名規則を縛る必要

### 採用: 選択肢 A (BEM base + modifier) + 選択肢 D の CSS 変数 variant 併用
- BEM 命名 (`lp-card` / `lp-card--featured`) で block / modifier 軸を確立し、内部の色 / spacing 差分は CSS custom properties で吸収
- Tailwind build pipeline は採用しない（ADR-0010 Pre-PMF バケット C: 過剰投資の回避）
- CUBE CSS の utility 軸は導入しない（SSOT 注入機構との相性問題）

## 3. 決定（SOLID の LP 適用 + 共通化方針）

### 3.1 SOLID 原則の LP 適用

| 原則 | LP での解釈 | 違反例 (現状) | 是正方針 |
|------|------------|--------------|---------|
| **S (SRP)** | 1 class は 1 役割（装飾 / spacing / typography を分離しない混在を避ける） | `.versus-card` が背景 + 枠 + padding + display + 文字色 + flex を一括で持つ | base class は装飾のみ、spacing / display は modifier または utility で分離 |
| **D (DRY)** | 同種パターンは base class で集約し、差分のみ variant | `background:#fff;border:1px solid var(--gray-300);border-radius:var(--radius)` が 5 ファイル / 9 箇所で重複 | `.lp-card` base class に集約し、各セクションは `.lp-card.lp-card--<variant>` で参照 |
| **O (OCP)** | 新セクション追加時、既存 class を変更せず variant 追加で拡張可能 | `#1820` 装飾枠統一時、各 card class を個別変更（5 箇所修正） | base class 変更で全 variant に伝播。新セクションは modifier 1 個追加で完了 |
| **L (LSP)** | variant は base の置換可能性を保つ（base が想定する HTML 構造を破らない） | `gr-stage[data-stage="graduate"]` が border 太さを変える程度は許容内 | variant が base の前提（`display:flex` / `padding`）を破壊しないこと |
| **I (ISP)** | base class は最小限の責務、不要な装飾を強制しない | `.section-title` と `.section-desc` が 41 箇所で個別記述 = 各セクションが「heading set」を強制使用していない | `.lp-section-header` template で h2 + desc を 1 単位に集約。使わないセクションは適用しない |

### 3.2 共通化対象リスト（Phase 2 派生 Issue で実装）

| 優先度 | 系統 | 新 base class | variant 例 | 削減見込（行数） |
|------|------|--------------|-----------|----------------|
| **高** | card | `.lp-card` | `--featured` / `--analog` / `--digital` / `--graduate` | 9 箇所 → 1 base + 4 variant 約 30 行削減 |
| **中** | section heading | `.lp-section-header`（h2 + desc を含む block） | なし（CSS 変数で desc max-width 等を変える） | 41 参照 → template 化で 約 50 行削減 |
| **中** | button | `.lp-cta` | `--floating` / `--bottom` / `--ghost` | 3 箇所 → 1 base + 3 variant 約 20 行削減 |
| **低** | grid | `.lp-grid-2` / `.lp-grid-3` / `.lp-grid-4` utility | レスポンシブブレークポイント別 | 14 箇所のうち 8 箇所程度を utility 化（残 6 は固有レイアウト）|

### 3.3 「変えるな」境界 (visual diff ゼロ必須)

PO 境界補足:
> 私の変えるな、はセクションの表現が伝え方、メッセージを変えるな、であってその内部実装が汚いのを直すな、とは言ってません。

派生 refactor Issue の AC 必須条件:

- [ ] **visual diff ゼロ** — リファクタ前後で `scripts/capture-hp-screenshots.mjs` 出力が同一であること（許容差: 1px 未満 / 表示位置・色の偏差ゼロ）
- [ ] **no-touch-zones 表現不変** — `#hero` / `#age-panel` / `#pricing` / `#trust` / `#cta-bottom` / `#faq` / header / footer の **テキスト / 配置 / 色 / 装飾が改変前後で同一**
- [ ] **HTML class 名の semantic 維持** — `data-lp-key` / `data-label` 注入経路 (ADR-0025 / ADR-0009) を破壊しないこと
- [ ] **内部実装変更で表現が変わってしまう箇所が出た時点で PO 確認** — 黙って merge せず Issue コメントで報告

### 3.4 Pre-PMF 段階的優先度 (ADR-0010 整合)

派生 refactor Issue は本 ADR accept 後、優先度高 → 低の順で **1 系統 1 PR** で起票:

1. **card 共通化（Phase 2-A）** — 中途半端統一の再発防止が最大効用、`#1820` / `#1847` symptom の根本解決
2. **section heading template（Phase 2-B）** — 41 参照の統一で SRP / I (ISP) 違反を解消
3. **button 共通化（Phase 2-C）** — 影響範囲が小さく、card で確立した pattern を再適用するだけ
4. **grid utility（Phase 2-D）** — 明らかな重複時のみ、固有レイアウトには手を入れない

### 3.5 本 ADR で扱わない範囲（Phase 2 ロードマップ ADR-0033 で扱う）

- 各派生 Issue の詳細実装 plan / Phase 計画
- jscpd を `site/` に拡張する CI 計画（Phase 2-A 完了後に re-baseline）
- BEM 命名規約の例外集（個別ケースは派生 Issue 内で議論）

## 4. 結果

### 利点

- SOLID の LP 適用方針が文書化され、`#1820` / `#1846` / `#1847` 系の中途半端統一 symptom が再発する構造的原因（base class 不在）に手を入れる根拠が確立
- 数値ベースの audit が ADR に残り、Phase 2 派生 Issue で「Before / After 削減行数」を客観評価できる
- 「変えるな境界」が明文化され、refactor Issue で visual diff ゼロを AC に組み込める
- Tailwind / CUBE 等の build pipeline 追加を退け、既存 CSS 変数 + BEM 命名のみで実現（Pre-PMF コスト最小）

### トレードオフ

- BEM modifier 爆発リスク → §3.2 表で Phase 2-A 時点では variant 4 個までと制限
- CSS 変数 variant は IDE color hint が弱い → ADR-0025 の SSOT 注入機構と同様、開発時 trade-off として許容
- visual diff ゼロ保証は `scripts/capture-hp-screenshots.mjs` の安定実行に依存

### 関連

- ADR-0001 / 0009 / 0010 / 0013 / 0025 / 0029（§1 表 + §3 内で個別言及済）
- 関連 Issue: #1849（起点）/ 派生 Issue は本 ADR accept 後に Phase 2-A 〜 Phase 2-D で起票
- 関連 PR: #1820（中途半端統一の動機）/ #1847（symptom）
- 参考資料: [OOCSS](https://github.com/stubbornella/oocss/wiki) / [BEM](https://getbem.com/) / [CUBE CSS](https://cube.fyi/) / [MDN CSS custom properties](https://developer.mozilla.org/docs/Web/CSS/--*) / [Bootstrap Utility API](https://getbootstrap.com/docs/5.3/utilities/api/)
