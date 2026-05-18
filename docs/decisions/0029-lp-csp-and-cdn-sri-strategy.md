# 0029. LP CSP 多層防御 + CDN SRI / pin 戦略

| 項目 | 内容 |
|------|------|
| ステータス | **accepted (2026-05-01)** |
| 日付 | 2026-05-01 |
| 起票者 | PO |
| 関連 Issue | #1719 / #1683 / #1701 / #1705 |
| 関連 ADR | ADR-0010 (Pre-PMF スコープ) / ADR-0024 (インフラ PR baseline) / ADR-0025 (LP SSOT 注入機構 + DOMPurify) |

## コンテキスト

ADR-0025 により `site/*.html`（GitHub Pages 静的配信）は `cdn.jsdelivr.net/npm/dompurify@3` を CDN で読み込み、LP に流れる SSOT 文言を `el.innerHTML = DOMPurify.sanitize(...)` で注入している。
PR #1705 の QM レビューで以下 3 点が観察された:

1. **DOMPurify CDN script に SRI (`integrity=...`) が無い** — 同 LP 内の `splidejs` (`@splidejs/splide@4.1.4`) は SRI 付き `<script integrity="sha384-Rb..." crossorigin="anonymous">`、`@splidejs/splide-core` CSS も SRI 付きで、DOMPurify だけ SRI 無しという**一貫性の欠如**。
2. **DOMPurify は `dompurify@3` major pin で運用** — `3.4.x → 3.4.y` の patch を CDN 経由で自動取り込みする方針 (#1705)。SRI を `sha384-...` で固定すると CDN 配信物のバイト列が変わった瞬間にロード失敗 → LP 全停止のリスクがある（major pin と SRI の両立は構造的に不可能）。
3. **LP 全 10 ページ (`site/*.html` + `site/help/*.html`) に CSP (Content-Security-Policy) ヘッダーも meta tag も無い** — `<script>` インライン実行や任意 origin からのリソース読み込みが許可されたまま。SvelteKit 側 (`hooks.server.ts`) は `default-src 'self'; script-src 'self' 'unsafe-inline'; ...` を全レスポンスに付与済み（ADR-0024 / `docs/design/14-セキュリティ設計書.md §7.1`）だが、`site/**` は SvelteKit 経由でない静的配信のため対象外。

- GitHub Pages では HTTP レスポンスヘッダー（`Content-Security-Policy:`）を制御できない。
- そのため `<meta http-equiv="Content-Security-Policy">` で対応する必要がある。
- `frame-ancestors` / `report-uri` / `sandbox` は meta では効かない。
- しかし、本 LP の脅威モデル (静的配信 + analytics 無し + 認証無し) では他指令で十分である。

## 検討した選択肢（OSS / 確立パターン調査 — #1350）

- 調査した一次資料:
- **OWASP Cheat Sheet — Content Security Policy**: 静的サイトでも meta tag CSP を最低限の防御として推奨。
- `script-src` は origin allowlist + `'self' 'unsafe-inline'` の組合せで段階導入が現実的とされている
- **MDN Web Docs — `<meta http-equiv="Content-Security-Policy">`**: HTTP ヘッダーが使えない GitHub Pages 等の静的ホスト向けに meta tag CSP の例を提示
- **GitHub Pages 公式 docs**: HTTP ヘッダー制御は不可、CSP は HTML 内で完結させる必要がある明記
- **MDN — Subresource Integrity**: SRI は **「特定バージョンに pin した時のみ意味がある」**。
- バージョンレンジ (`@3` / `@latest`) と SRI は両立しない（CDN 配信物の bytes が変われば即破綻）
- **jsDelivr Best Practices**: 「production では SRI を必ず使え。
- ただし pin range には使うな」と公式 doc が明記
- **OWASP Web Security Testing Guide — WSTG-CONFIG-12**: 「CSP の `default-src 'self'` + 限定的な script-src ホワイトリストが最低ライン」。

### 選択肢 A: SRI 完全固定 + 手動更新（A 案）

- `dompurify@3.4.5` 等の完全バージョン pin + `integrity="sha384-..."` 指定。patch 更新は手動 PR で取り込む
- pros: CDN 改ざん耐性が最強。bytes が 1 ビットでも変われば即ロード拒否
- cons: 脆弱性 patch の取り込み遅延リスク。sanitizer は CVE 対応の patch を自動受け取りたい性質のライブラリ。手動更新を忘れると結果として防御弱化
- **rejected**: 「sanitizer は patch 自動取り込みしたい」という ADR-0025 amendment の決定 (#1705) と矛盾

### 選択肢 B: minor pin (`dompurify@3.4`) + SRI なし

- `@3.4` で minor 単位 pin、SRI なし
- pros: minor 更新を構造的に防げる
- cons: SRI なしの状態は変わらず多層防御にならない。`@3` と `@3.4` の差は jsDelivr 側がどうリダイレクトするか次第で、防御として機能する保証が無い
- **rejected**: SRI 無しの状態が解消されない

### 選択肢 C: 自前ホスティング (`/site/vendor/dompurify.min.js`)

- jsDelivr 依存を排除し `site/vendor/` に bundle 配置
- pros: 完全コントロール。SRI 無しでも LP 自身の整合性で守られる（GitHub repo + GitHub Pages の SSL）
- cons: 配布パイプライン追加（npm install + build step + コミット）。`dompurify` のバージョン更新タスクが追加で発生
- **partially adopted (補完)**: メイン採用ではなく、選択肢 D の補強として「DOMPurify が CDN から落ちて来なかった時の textContent フォールバック」が ADR-0025 で既に実装済みであることを確認した上で「将来 D 案で問題が出たら C 案へ移行」と位置づけ

### 選択肢 D: CSP `script-src` ホワイトリスト + DOMPurify は major pin 維持（採用）

- LP 全 10 ファイルに `<meta http-equiv="Content-Security-Policy">` を追加
- DOMPurify は `@3` major pin + SRI 無しを維持（patch 自動取り込みのため）
- splidejs は既存の SRI 付き読み込みを維持（特定バージョン pin で運用しているため SRI が機能している）
- CSP の `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net` で「攻撃者が任意 origin の script を注入する経路」を構造的に塞ぐ
- pros: pin 戦略を変えずに多層防御を最小コストで追加。OWASP / Mozilla / GitHub の CSP 推奨と整合。実装は HTML 1 行追加のみで bundle 影響ゼロ
- cons: meta tag CSP は `frame-ancestors` / `report-uri` が効かない。本 LP は埋め込み禁止 (`X-Frame-Options: DENY` 相当) を CDN 経由でかけられないが、`X-Frame-Options` も静的ホストでは制御不可なので元々課題ではない（Pre-PMF スコープ ADR-0010 で許容）

## 決定

**選択肢 D を採用** + **C 案を将来のフォールバックとして文書化**。一貫した SRI / pin 方針を以下に確立する。

### 1. LP 全 10 ページに CSP meta tag を追加

対象: `site/index.html` / `pricing.html` / `faq.html` / `pamphlet.html` / `selfhost.html` / `privacy.html` / `terms.html` / `sla.html` / `tokushoho.html` / `help/license-key.html`

CSP 内容（全 10 ファイル共通）:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">
```

各指令の根拠:

| 指令 | 値 | 根拠 |
|------|-----|------|
| `default-src` | `'self'` | LP は同一 origin で完結。fallback も `'self'` |
| `script-src` | `'self' 'unsafe-inline' https://cdn.jsdelivr.net` | `'unsafe-inline'`: index.html の inline `<script>` (initialization / Splide setup / mobile menu / contact form / theme toggle) と各ページ `<script type="application/ld+json">` 用。`https://cdn.jsdelivr.net`: DOMPurify (全 10 ページ) + splidejs JS + budoux JS (index.html のみ) |
| `style-src` | `'self' 'unsafe-inline' https://cdn.jsdelivr.net` | `'unsafe-inline'`: 一部 inline `style="..."` 属性 (13 件 / 3 ファイル) と JSDOM 互換用。`https://cdn.jsdelivr.net`: splide-core CSS (index.html) |
| `img-src` | `'self' data: blob:` | LP 内画像 + favicon (PNG) + OGP + 開発時の data: URI |
| `font-src` | `'self'` | 外部フォント未使用（system-ui のみ） |
| `connect-src` | `'self'` | 動的 fetch / XHR は無し（LP は完全静的） |
| `object-src` | `'none'` | プラグイン (`<object>` / `<embed>`) 一切禁止 |
| `base-uri` | `'self'` | `<base>` 経由の URL 書き換え攻撃を防止 |
| `form-action` | `'self'` | フォーム submit 先を同 origin に限定（contact form は `mailto:` なので `'self'` で問題なし、ブラウザ側で `mailto:` は除外扱い） |

CSP meta tag が効かない指令 (`frame-ancestors` / `report-uri` / `sandbox`) は本 LP のスコープでは不要。

### 2. DOMPurify は `@3` major pin + SRI なしを維持

- `<script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js" defer></script>` を維持
- 整合性検証は CSP の `script-src https://cdn.jsdelivr.net` ホワイトリストに委譲
- ADR-0025 amendment の方針を変更しない（patch 自動取り込み優先）
- DOMPurify が一時的にロード失敗した場合の `textContent` フォールバックは `scripts/generate-lp-labels.mjs` の applyLpKeys template に実装済 (ADR-0025 §決定 4)

### 3. splidejs は SRI + 特定バージョン pin を維持

- `@splidejs/splide@4.1.4` のような特定バージョン pin + `integrity="sha384-..."` の運用は変えない
- 「特定バージョン pin の CDN ライブラリ」では SRI が機能する。両立可能なので維持

### 4. budoux は major pin + SRI なし（DOMPurify と同じ扱い）

- `<script src="https://cdn.jsdelivr.net/npm/budoux@latest/bundle/budoux-ja.min.js" defer></script>` (index.html のみ) も同様に CSP allowlist で守る
- BudouX の役割は日本語折返し補助のみで XSS 経路にならないため低リスク

### 5. 一貫した SRI / pin 方針（本 ADR で確立）

LP / 静的ページから読み込む CDN ライブラリの SRI / pin 方針を以下のマトリクスで統一する:

| ライブラリ種別 | pin 戦略 | SRI | CSP allowlist | 理由 |
|---------------|---------|-----|---------------|------|
| **特定バージョン pin** (例: `@splidejs/splide@4.1.4`) | 完全 pin | **必須** (`sha384-...`) | 不要（CSP は補助） | bytes が固定のため SRI が機能。改ざん耐性最強 |
| **major / range pin** (例: `dompurify@3`, `budoux@latest`) | major / range | **付与禁止** | **必須** (`https://cdn.jsdelivr.net`) | bytes が変わるため SRI と両立不可。CSP allowlist で経路防御 |
| **将来追加するライブラリ** | 原則「特定バージョン pin + SRI」が第一選択。patch 自動取り込みが必要な sanitizer / linter 系のみ「major pin + CSP allowlist」を許容 | — | — | セキュリティ critical なら patch 自動取り込み優先（major pin）、そうでなければ可読性 / 整合性優先（特定 pin + SRI） |

### 6. 移行計画 / 適用順序

PR (#1719) で以下を 1 PR で全件適用:

1. `site/*.html` 全 10 ファイルの `<head>` 先頭付近（`<meta name="viewport">` の直後）に CSP meta tag を追加
2. `tests/e2e/lp-csp.spec.ts` 新規追加 — 全 10 ページで CSP meta tag が存在し、Console / Page error が発生しないことを検証
3. `docs/design/14-セキュリティ設計書.md §7.1` の下に「§7.1.2 LP (静的サイト) の CSP」サブセクションを追加
4. `scripts/measure-lp-dimensions.mjs` の THRESHOLDS を破らないことをローカル検証（mobileHeight ≤ 15000, desktopHeight ≤ 8000, forbiddenTerms = 0, ctaVariants ≤ 3）

### 7. 将来の方針（C 案 fallback 条件）

以下の事象が発生したら C 案（自前ホスティング）への移行を検討する:

- DOMPurify CDN が長時間落ちる事例（jsDelivr 障害が複数回）
- DOMPurify 配布物への改ざん事例（業界レベルで観測されたケース）
- jsDelivr の TOS 変更で広告 / トラッカー注入が始まった場合

これらが発生するまでは D 案を維持する（Pre-PMF ADR-0010 のスコープ最小化原則）。

## 結果

### 利点

- LP 全 10 ページで CSP meta tag による多層防御を達成（DOMPurify サニタイズ + CSP `script-src` ホワイトリスト）
- pin 戦略を変えずに実装できるため bundle 影響ゼロ・runtime 影響ゼロ
- splidejs / DOMPurify / budoux で SRI / pin 戦略の根拠が明文化され、将来追加するライブラリも同じマトリクスで判断可能
- アプリ側 (`hooks.server.ts`) と LP 側で CSP 方針が一貫（`default-src 'self'` ベース、`script-src` allowlist が違うのは LP のみ CDN 利用のため）

### トレードオフ

- meta tag CSP は HTTP ヘッダーより一部指令 (`frame-ancestors` / `report-uri` / `sandbox`) が効かない。本 LP は static + auth 無しのため許容
- `'unsafe-inline'` を `script-src` / `style-src` に許可している。これは現行 LP の inline `<script>` / `style="..."` 属性数が多いため。将来の P5 リファクタで全 inline を排除した時点で `'unsafe-inline'` を削除し nonce 化を検討（追加 ADR で議論）
- DOMPurify は SRI なしのまま CDN 改ざん攻撃に対しては jsDelivr の信頼に依存。OWASP / Mozilla 推奨の中間ライン

### 関連

- ADR-0010（Pre-PMF スコープ判断）— 本 ADR は「過剰防衛にならない範囲」を意識し、`report-uri` / nonce / hash CSP / WAF / 監査ログ DynamoDB 等は採用していない
- ADR-0024（インフラ PR baseline）— アプリ側 CSP は同 ADR 範疇。本 ADR は LP（静的サイト）側を補完
- ADR-0025（LP SSOT 注入機構 + DOMPurify CDN）— 本 ADR と直接連動。DOMPurify CDN 採用の根拠と本 ADR の CSP allowlist の根拠が表裏一体
- Issue #1719（本 ADR の起点）
- 参考資料:
  - OWASP CSP Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html>
  - MDN Subresource Integrity: <https://developer.mozilla.org/docs/Web/Security/Subresource_Integrity>
  - GitHub Pages Headers: <https://docs.github.com/pages>（HTTP ヘッダー制御不可の明記）
  - jsDelivr Best Practices: <https://www.jsdelivr.com/features> (SRI 推奨 + バージョン pin との関係)
