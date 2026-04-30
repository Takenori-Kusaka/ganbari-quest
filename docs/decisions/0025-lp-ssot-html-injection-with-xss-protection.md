# 0025. LP SSOT 注入機構の innerHTML 化 + XSS 設計（DOMPurify）

| 項目 | 内容 |
|------|------|
| ステータス | **accepted (2026-04-30)** |
| 日付 | 2026-04-29（accepted 昇格 2026-04-30） |
| 起票者 | PO |
| 関連 Issue | #1683 / #1465 / #1346 / #1704 (umbrella close) |
| 関連 ADR | ADR-0009（labels SSOT 原則） / ADR-0014（i18n 機構選定） / ADR-0008（設計ポリシー先行確認） |

> **Status 昇格履歴 (2026-04-30, #1704)**: `proposed (amended)` → **`accepted`**。1683 sub-A (#1701/#1705 機構刷新) + sub-B (#1702/#1718 LP 339件) + sub-C (#1703/#1717 Legal 354件) が全て main 反映され、`scripts/lp-ssot-baseline.json` が `count: 0` を達成。本 ADR の§決定（innerHTML + DOMPurify CDN + LP_LEGAL_*_LABELS namespace + check-lp-ssot.mjs depth-stack 免除 + LEGAL coverage check rework）は実装で全件成立済。pamphlet.html の印刷タイミング再注入は `tests/e2e/pamphlet-print-ssot.spec.ts` (#1704) で E2E 担保。
>
> **Amendment 履歴 (2026-04-29)**: 初版で曖昧だった 3 点を確定:
>
> 1. SSOT は `site/shared-labels.js` ではなく **`scripts/generate-lp-labels.mjs` (applyLpKeys template, L377-392)**。`shared-labels.js` は同 script からの **生成物** であり、ADR §決定の文言を「自動生成テンプレート改修 + 再生成」に修正
> 2. DOMPurify の配信方法を **CDN 必須** に確定（`site/` は GitHub Pages 上の static アセットで、npm bundle 経路を持たない）。`<script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js">` を `site/*.html` 全 8 ファイルの `<head>` に追加し、`window.DOMPurify` 経由で参照する
> 3. `scripts/check-lp-ssot.mjs` L186-260 の **`LEGAL_LABELS` coverage check** との整合性を §結果 Migration Plan に明記（法的文書を `LP_LEGAL_*_LABELS` namespace で labels.ts 化した後、双方向同期ロジックを再設計する）

## コンテキスト

ADR-0009 で確立した「LP/Legal を含む全ユーザー露出文言の SSOT 化」を **100% 完遂**するために、現行の `site/shared-labels.js#applyLpKeys()` が抱える 3 つの構造的限界を解消する必要がある（Issue #1683 直前 Agent fail report でも identified）。

1. **textContent 注入は nested HTML を破壊する** — 現在の実装は `el.textContent = value` で値を流し込む。LP の `data-lp-key` 付き要素のうち **156+ 件**（`<strong>` / `<em>` / `<a>` / `<span class>` / `<br>` 等を内包する 178 行サンプル経由で確認）が nested HTML を持っており、SSOT 化したくても机上不可能。例:
   ```html
   <p data-lp-key="heroPriceBand.container"><span><strong>基本無料</strong></span>・月<strong>¥500〜</strong>…</p>
   ```
2. **法的文書（privacy/terms/sla/tokushoho 354 件）が SSOT 外** — `scripts/check-lp-ssot.mjs` で `EXCLUDED_LEGAL_FILES` として除外運用。PO 方針「SSOT 漏れのコンテンツは存在してはいけない」と直接矛盾。
3. **pamphlet.html は印刷専用の独自構造** — `window.print()` 起動前に SSOT 注入が完了していない場合、未注入のフォールバックテキストが印刷される懸念。

PO 判断 (#1683): **案 A** = architecture ADR 先行起票 → ADR 確定 → 1 PR で 693 件全件 SSOT 化。本 ADR はその architecture を確定する唯一の文書。

## 検討した選択肢（OSS 先調査 — #1350 / ADR-0014 整合）

### 選択肢 A: DOMPurify による innerHTML 注入 + 許可タグ制限（推奨）

- **概要**: [`DOMPurify`](https://github.com/cure53/DOMPurify) (v3.x、~22 KB gzip)。OWASP / Google / GitHub などが採用する業界標準 HTML sanitizer。weekly downloads 6M+、最終 commit 数日内、MIT。
- **適用**: `applyLpKeys()` で `el.innerHTML = DOMPurify.sanitize(value, { ALLOWED_TAGS, ALLOWED_ATTR })` に置換。`ALLOWED_TAGS = ['strong','em','a','br','span','sup','sub']`、`ALLOWED_ATTR = ['href','target','rel','class','aria-hidden']`、`ALLOW_DATA_ATTR = false`、リンクは `target=_blank` 時 `rel=noopener noreferrer` 強制（DOMPurify hook）。
- **メリット**: nested HTML を保持しつつ XSS を業界標準で防御、bundle 22 KB gzip は LP 規模で許容、SSR 不要のためビルドフロー追加なし。
- **デメリット**: 22 KB の bundle 増。pamphlet.html は印刷タイミングと注入完了の同期が必要（後述 §Migration）。
- **Pre-PMF コスト** (ADR-0010): 導入工数 低（1 ファイル + 1 dep）、学習コスト 低、bundle 影響 軽（LP は CDN/static、tree-shake 不要のメイン script は LP 訪問者のみ）、長期保守性 **高**。

### 選択肢 B: nested tag を独立した `<span data-lp-key>` に分解

- **概要**: `<p>...<strong>X</strong>...</p>` を全て葉まで `data-lp-key` で覆う。textContent 維持。
- **メリット**: 追加 OSS 不要、XSS リスクゼロ。
- **デメリット**: HTML が読めなくなる（1 行に 5+ key）。labels.ts キー数が現行 +200 程度に肥大、レビュー困難。Issue #1683 直前 Agent も失敗した方式。
- **却下理由**: 機構として OK でもコンテンツ保守性が破綻。SSOT は「変更容易性」が目的であり、本末転倒。

### 選択肢 C: LP 全体を SvelteKit `adapter-static` 化して `+page.svelte` に吸収

- **概要**: `site/**` を `src/routes/(marketing)/` に移し SSR/SSG。labels を直接 import。
- **メリット**: 型安全、runtime 注入不要、SEO 完全。
- **デメリット**: アーキテクチャ大改修（#566 で見送り、ADR-0010 バケット C 該当）、Pre-PMF 工数過大。
- **却下理由**: ADR-0010 で「Pre-PMF 過剰」判定済み。ADR-0014 でも回避方針確認済。

### 選択肢 D: 自前 sanitizer 実装

- **概要**: 許可タグの正規表現でゼロ依存。
- **却下理由**: XSS 関連は確立 OSS 必須（#1350 OSS 先調査ルール、10 行超）。長期保守でセキュリティリスク蓄積。

## 決定

**選択肢 A: DOMPurify を採用**。`scripts/generate-lp-labels.mjs` の `applyLpKeys()` テンプレート (L377-392) を innerHTML + DOMPurify sanitize に書換 → 再生成された `site/shared-labels.js` を deploy → **LP 339 件 + Legal 354 件 = 693 件すべて**を `data-lp-key` SSOT 配下に統合する。

> **重要 (Amendment)**: `site/shared-labels.js` は **自動生成ファイル**である（`scripts/generate-lp-labels.mjs` 実行で再生成）。直接編集 → 上書き再生成で消失するため、SSOT は **generate-lp-labels.mjs の applyLpKeys template (L377-392)**。本 ADR の決定対象もそちらの template。

### 適用範囲（PO 方針: 例外なし）

1. **LP**: `site/index.html` / `pricing.html` / `faq.html` / `selfhost.html` / `pamphlet.html` / `help/license-key.html`
2. **Legal**: `site/privacy.html` / `terms.html` / `sla.html` / `tokushoho.html`（**ADR-0009 §例外「法的文書」を本 ADR が supersede**）
3. **labels.ts namespace**: 既存 `LP_*_LABELS` に加え新規 `LP_LEGAL_PRIVACY_LABELS` / `LP_LEGAL_TERMS_LABELS` / `LP_LEGAL_SLA_LABELS` / `LP_LEGAL_TOKUSHOHO_LABELS` / `LP_PAMPHLET_LABELS` / `LP_FAQ_BODY_LABELS` を追加（Phase 4 多言語化時に PO/JSON へ抽出可能な flat 構造を維持）。
4. **DOMPurify 配信**: site/ は GitHub Pages の static asset であり npm bundle 経路を持たないため **CDN 必須**:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
   <script src="shared-labels.js" defer></script>
   ```
   全 8 ファイル (`index.html` / `pricing.html` / `faq.html` / `selfhost.html` / `pamphlet.html` / `help/license-key.html` / `privacy.html` / `terms.html` / `sla.html` / `tokushoho.html`) の `<head>` に同様に追加。`applyLpKeys` は `window.DOMPurify` 参照で利用、DOMPurify が未ロードの場合は安全側で `textContent` フォールバック + console.warn (network 一時失敗時の劣化動作)。

### DOMPurify 設定値（実装 Agent 直参照）

`scripts/generate-lp-labels.mjs` の applyLpKeys template に以下を埋め込む（生成後 `site/shared-labels.js` の同等位置に展開される）:

```js
// generate-lp-labels.mjs L377-392 の applyLpKeys template 改修後イメージ
function applyLpKeys() {
  var elements = document.querySelectorAll('[data-lp-key]');
  var Purify = (typeof window !== 'undefined') && window.DOMPurify;
  var SANITIZE_CONFIG = {
    ALLOWED_TAGS: ['strong','em','a','br','span','sup','sub','small','b','i'],
    ALLOWED_ATTR: ['href','target','rel','class','aria-hidden','aria-label'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ADD_ATTR: ['target']
  };
  if (Purify && !Purify.__gqHookInstalled) {
    Purify.addHook('afterSanitizeAttributes', function(node) {
      if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    Purify.__gqHookInstalled = true;
  }
  elements.forEach(function(el) {
    var key = el.getAttribute('data-lp-key');
    var parts = key.split('.');
    if (parts.length !== 2) return;
    var sectionData = LP_LABELS[parts[0]];
    if (!sectionData) return;
    var value = sectionData[parts[1]];
    if (value === undefined) return;
    if (Purify) {
      el.innerHTML = Purify.sanitize(value, SANITIZE_CONFIG);
    } else {
      el.textContent = value;
      console.warn('[applyLpKeys] DOMPurify unavailable, fell back to textContent for', key);
    }
  });
}
```

### pamphlet.html の印刷タイミング

`<script src="shared-labels.js" defer>` で `DOMContentLoaded` までに注入完了を保証 + `window.print()` 直前に `applyAll()` 同期再実行（既に注入済みなら no-op）。テストは Playwright `emulateMedia({ media: 'print' })` で SS 検証。

### LEGAL_LABELS coverage check との整合（Amendment 追記）

`scripts/check-lp-ssot.mjs` L186-260 は現在「`LEGAL_LABELS` の値が `site/privacy.html` / `terms.html` に部分一致存在すること」を双方向同期で検証している。Legal docs を `LP_LEGAL_*_LABELS` namespace で labels.ts 化した後は:

1. 既存 `LEGAL_LABELS` → `LP_LEGAL_PRIVACY_LABELS` / `LP_LEGAL_TERMS_LABELS` 等に **再分類** (用途別)。
2. coverage check ロジックを「`LP_LEGAL_*_LABELS` の各キーが `data-lp-key="legal.*"` で 1 箇所以上参照されていること」を検証する**逆方向のチェック**に変更する。
3. `EXCLUDED_LEGAL_FILES` 定数 (L32-37) を削除し、法的文書も baseline 0 件対象に追加する。

詳細手順は §結果 Migration Plan の M4 に記載。

## 結果

### 利点
- ADR-0009 が掲げる「100% SSOT」が **真に達成**（PO 強い方針の充足）
- nested HTML を保持できるため LP コンテンツの表現力を犠牲にしない
- XSS 防御を業界標準（OWASP 推奨）で実装、自前リスクなし
- 法的文書も SSOT 配下に入り、文言ドリフト（規約 vs プラポリ vs LP）を構造的に防止

### トレードオフ
- bundle に DOMPurify 22 KB gzip 追加（LP は 1 ロードのみ、許容範囲）
- ADR-0009 §例外「法的文書」項目を本 ADR が supersede（履歴は ADR-0009 内に追補）
- 実装 PR は LP 339 + Legal 354 = 693 件の手作業移行で大規模（後述 §Migration Plan）

### 移行計画（実装 Agent 引継ぎ — Amendment 後版）

PO 方針確認 (2026-04-29):
- 「**partial PR 禁止 = 申し送り禁止 = AC 妥協禁止**」であって「**子 issue 分解禁止**」ではない
- → **網羅的子 issue 分解 + 各子は単独完遂可能 + 全子 AC 合計が 100%** で進める

#### 子 issue 分解（#1683 配下に 4 件起票）

各 sub-issue は単独で 1 PR 完遂できる scope。「ここまでで OK / 残りは続 PR」表現は AC に含めない（申し送りなし）。

| Sub | Scope | 完遂 AC（抜粋） | 依存 |
|-----|-------|---------------|------|
| **1683-A** | applyLpKeys template 刷新 + DOMPurify CDN 注入 | (1) generate-lp-labels.mjs L377-392 改修, (2) site/*.html 全 8 ファイルに DOMPurify CDN script 追加, (3) `node scripts/generate-lp-labels.mjs` で shared-labels.js 再生成, (4) DOMPurify 設定値が ADR §決定どおり, (5) unit test: `<strong>` `<a>` 保持 + `<script>onerror>` 等 XSS payload escape, (6) 既存 339 件のうち単純文字列の SS 視覚回帰なし | (なし) |
| **1683-B** | LP HTML 339 件 SSOT 化 | (1) `site/index.html` 84 件 → 0、(2) `site/pricing.html` 50 件 → 0、(3) `site/faq.html` 123 件 → 0、(4) `site/pamphlet.html` 82 件 → 0（defer + print 直前 applyAll 再実行）、(5) namespace `LP_INDEX_*_LABELS` / `LP_PRICING_LABELS` 拡張 / `LP_FAQ_*_LABELS` 拡張 / `LP_PAMPHLET_LABELS` 拡張、(6) check-lp-ssot.mjs で LP 部分 0 件、(7) 4 ファイル × mobile/desktop = 8 SS 視覚回帰なし | 1683-A |
| **1683-C** | Legal HTML 354 件 SSOT 化 + LEGAL coverage check rework | (1) `site/privacy.html` 133 件 → 0、(2) `site/terms.html` 118 件 → 0、(3) `site/sla.html` 58 件 → 0、(4) `site/tokushoho.html` 45 件 → 0、(5) namespace `LP_LEGAL_PRIVACY_LABELS` / `LP_LEGAL_TERMS_LABELS` / `LP_LEGAL_SLA_LABELS` / `LP_LEGAL_TOKUSHOHO_LABELS` 新設、(6) check-lp-ssot.mjs L186-260 を「`LP_LEGAL_*_LABELS` の各キーが `data-lp-key` で参照されていること」検証に変更、(7) `EXCLUDED_LEGAL_FILES` (L32-37) 削除、(8) ADR-0009 §例外「法的文書」項目に supersede 表記、(9) 4 ファイル × mobile/desktop = 8 SS 視覚回帰なし | 1683-A（1683-B と並列可） |
| **1683-D** | 検証 / baseline 0 化 / 設計書同期 / pamphlet 印刷 SS テスト | (1) `scripts/lp-ssot-baseline.json` を `count: 0` に更新、(2) Playwright `emulateMedia({ media: 'print' })` SS テスト追加 (`tests/e2e/pamphlet-print-ssot.spec.ts`)、(3) `docs/design/22a-アイコン・ラベル統一規約.md` SSOT 100% 達成記載、(4) `docs/design/06-UI設計書.md` 関連節更新、(5) `docs/decisions/0009-labels-ssot-principle.md` §例外 supersede 追補、(6) 全 10 ページ × mobile/desktop = 20 SS 視覚回帰なし、(7) #1683 umbrella close | 1683-A + 1683-B + 1683-C 全完了 |

#### 完遂判定

- 1683-A/B/C/D の全 PR が main にマージされ、AC が `[x]` 化され、**`scripts/lp-ssot-baseline.json` の `count = 0` + `EXCLUDED_LEGAL_FILES = []`** が成立した時点で #1683 を close
- 各 sub-issue は AC 100% 完遂時点で個別 close（partial close 禁止）
- 全子完了後、本 ADR を `proposed` → `accepted` に昇格

**想定実装時間**: 8-16 時間 / sub × 4 = 32-64 時間（Agent 単独 4 セッション）。**partial PR 禁止 / 申し送り禁止 / AC 妥協禁止** (PO 方針)。

## 関連
- ADR-0009（labels.ts SSOT 原則）— 本 ADR 承認時に §例外「法的文書」を supersede 表記
- ADR-0014（i18n 機構選定）— Paraglide 移行前提として現 `shared-labels.js` 経路の延命策
- Issue #1683（SSOT 100% 完全化）/ #1465（LP SSOT Phase A baseline）/ #1346（labels 機構 Umbrella）
- DOMPurify: https://github.com/cure53/DOMPurify
