# 0067. アプリ側 CSP の `'unsafe-inline'` hardening (script-src = hash 撤廃 / style-src = 維持 + 構造的根拠)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-07-17 |
| 起票者 | Dev (audit team) |
| 関連 Issue | #3829 (EPIC #3408 slice C, script-src) / #3828 (slice B, style-src) / #3112 |
| 関連 ADR | ADR-0029 (LP 側 CSP、**併存**) / ADR-0025 (LP SSOT 注入 XSS) / ADR-0010 (Pre-PMF スコープ) / ADR-0062 (統一エラー通知) |

## コンテキスト

アプリ側 (SvelteKit、Lambda / NUC 配信) の CSP は `hooks.server.ts` の `buildCspHeader()` が全レスポンスに `script-src 'self' 'unsafe-inline'` を付与していた。`'unsafe-inline'` を許す限り、新たな stored-XSS 経路 (例: ZIP import SVG、#3105/#3111 で attachment + nosniff により実閉鎖済) が将来混入した際に **CSP が script ベクタの最終防壁にならない** (#3112 QM adversarial が指摘した構造リスク 1)。script は XSS 最重要ベクタで style より優先度が高い。

impact-analysis の実測で、アプリの inline `<script>` は **SvelteKit hydration bootstrap 1 種のみ** (app.html の custom inline script 0 / `{@html}` 0 / inline handler 0) と確定した。`<script>` 要素は hash 化可能なため、`'unsafe-inline'` をクリーンに撤廃できる。

本 ADR はアプリ側 script-src の hash 化方針を記録する。LP (`site/**`、GitHub Pages 静的配信) の CSP は別 origin・別配信経路・別脅威モデル (CDN DOMPurify/splidejs 依存) であり、ADR-0029 が引き続き SSOT。両者は **supersede でなく併存**する (下記 §結果)。

## 検討した選択肢 (OSS / 確立パターン — #1350)

### 選択肢 A: SvelteKit 標準 CSP `kit.csp` hash mode (採用)
- 概要: `svelte.config.js` `kit.csp = { mode: 'hash', directives: {...} }`。SvelteKit が自身の inline bootstrap script の sha256 を計算し `script-src` に自動注入 (`@sveltejs/kit` `csp.js` 実装、v2.69.2)。SSR ページは HTTP header、prerender ページは `<meta>` で配信。
- メリット: フレームワーク標準・追加依存ゼロ・bundle 影響ゼロ。custom inline script 0 のため親和性が高い。OWASP CSP Level 2+ 準拠。
- デメリット: `<meta>` では `frame-ancestors` が効かない (SvelteKit が meta 生成時に自動除外) → prerender ページは `X-Frame-Options` backup が要る。
- Pre-PMF コスト: 低 (config 数行 + hooks の CSP set 撤去のみ、ADR-0010 Bucket A)。

### 選択肢 B: nonce + `strict-dynamic`
- 概要: リクエストごとに nonce を発行し inline script に付与、`strict-dynamic` で伝播。
- メリット: hash より厳格 (動的 script も統制)。
- デメリット: SSR で nonce をリクエスト単位に配線する必要があり実装複雑。本アプリは custom inline script 0 で動的 script 統制の要求が無く、過剰 (ADR-0010)。
- Pre-PMF コスト: 中〜高。

### 選択肢 C: 独自 CSP builder 継続 + inline を許可し続ける (現状維持)
- 概要: `buildCspHeader()` に `'unsafe-inline'` を残す。
- デメリット: #3112 構造リスク 1 が残存。本 slice の撤廃目的そのものを満たさない。**却下**。

## 決定

**選択肢 A を採用**。`svelte.config.js` `kit.csp` (hash mode) に directive を一本化し、`script-src` から `'unsafe-inline'` を撤廃する (`['self']` のみ → SvelteKit が sha256 を自動付与)。旧 `hooks.server.ts` の `buildCspHeader()` / `CSP_HEADER` / `response.headers.set('Content-Security-Policy', ...)` は二重付与 (clobber) を避けるため撤去する。directive 値は旧 builder を SSOT として 1:1 写経し (img/media/font/connect 等を漏らさない)、`connect-src 'self'` 固定による「外部送信ゼロ」も引き継ぐ。

`frame-ancestors 'none'` は SSR では header で有効、prerender では `X-Frame-Options: DENY` (hooks 継続付与) が backup。

### style-src は `'unsafe-inline'` を維持する (slice B = #3828、案C)

`style-src` は `'unsafe-inline'` を **維持** する。撤廃 (script-src と同じ hash 化) は以下の構造的制約で不可能:

- Svelte は SSR 時、`style:` binding (実測 102 箇所) と `style=` 属性を **inline style 属性 (`style="..."`) としてシリアライズ**する (hydration 後の更新のみ `element.style` = CSSOM 経由で非該当)。
- **CSP の hash / nonce は `<style>` / `<script>` 要素にのみ適用でき、inline `style=` 属性には適用不可** (属性値ごとの hash + `'unsafe-hashes'` が必要で、`style="width:37%"` 等の動的値は非現実的)。SvelteKit `kit.csp` も自身が生成する inline のみ hash 化し、component の `style=` 属性は対象外。SvelteKit 自身の a11y ルーティング announcer も inline style 属性を持つ。
- 完全撤廃には 102 箇所の `style:` を `$effect` + CSSOM 直接変更へ書き換える持続的負債が必要で、Pre-PMF (ADR-0010) には過剰。#3828 AC2 の「撤廃が過剰な場合は ADR で根拠 + scope 限定」に合致。

**scope / 残余リスク**: style ベクタの残余リスクは stored-XSS 由来の style 属性ベース defacement / exfiltration に限定され、DOMPurify (ADR-0025) + nosniff + attachment 配信 (#3105/#3111) + user-content 配信不変条件 (#3827 fitness) が実防御を担う。XSS 最重要の script ベクタは script-src hash 撤廃で塞ぐ。

**将来撤廃トリガ**: (a) フレームワークが `style:` の nonce/hash 化を提供、または (b) style 属性ベース攻撃の実害観測。いずれか成立時に slice B' として再評価する。

## 結果

- `script-src` から `'unsafe-inline'` が消え、hydration bootstrap のみ sha256 で許可 → stored-XSS の script ベクタが構造的に塞がれる (#3112 構造リスク 1 の根治)。
- CSP header の付与主体が hooks → SvelteKit に移り、CSP は **ページレスポンス** にのみ付く。API / エンドポイント / 静的ファイルレスポンスは CSP を持たなくなるが、これらは script 実行文脈を持たず、user 由来 SVG は `Content-Disposition: attachment` (#3105、CSP 非依存の防御) で保護されるため security 中立。
- **ADR-0029 との関係 (併存)**: 本 ADR = アプリ側 (SvelteKit `kit.csp`、`self` 完結、CDN 無し)。ADR-0029 = LP 側 (`site/**` 静的、`<meta>` CSP、`cdn.jsdelivr.net` allowlist + SRI/pin)。origin・配信経路・脅威モデルが異なるため一方が他方を supersede せず、役割分担して併存する。
- 高回帰リスク (全画面 hydration) は `tests/e2e/app-csp.spec.ts` (SSR header hardened / CSP violation 0 / child home・admin Ark UI Menu・marketplace SPA nav の hydration 生存) + visual regression 3 層で担保する。設計仕様の SSOT は `docs/design/14-セキュリティ設計書.md §7.1`。
