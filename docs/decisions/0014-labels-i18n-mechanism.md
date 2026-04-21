# 0014. labels / i18n 機構選定（OSS 先調査）

- **Status**: Proposed
- **Date**: 2026-04-21
- **Related Issue**: #1346 Phase 1 / #1350 / ADR-0009 / ADR-0010

## コンテキスト

ADR-0009（labels.ts SSOT 原則）は原則として存在するが、**機構は半完成**:

- App 側: `labels.ts` export を直接 import する経路のみ用意。`FEATURE_LABELS` 対象の機能名（スタンプカード / おみくじ / ログインボーナス / ポイント 等）が `StampCard.svelte:49` / `tutorial-chapters-child.ts:73,81` / `Header.svelte` 等で直書き
- LP 側: `scripts/generate-lp-labels.mjs` → `site/shared-labels.js` の自前 DOM parse パイプラインが AGE_TIER_LABELS / PLAN_LABELS のみを runtime binding。FEATURE_LABELS 未対応
- CI 検出: 既存辞書値のハードコードは `check-no-plan-literals.mjs` 風に検出可能だが、**辞書外の新規用語が直書きで増える**ケースを検出する機構が存在しない

PO 方針（2026-04-21）: 「独自実装・力業解決が多すぎる。もっと OSS / 確立デザインパターンを踏襲すべき」。現在の `data-label="*"` attribute DOM parse 方式の自前拡張は runtime オーバーヘッド / SEO / 型安全性いずれも OSS が勝るため**不採用**。

本 ADR は Phase 2-4（App 側整備 / LP 側移行 / 英語化）の前提となる機構選定のみを扱う。

## 検討した選択肢

### 選択肢 A: Paraglide（inlang、OSS）

- 概要: inlang.com 提供、SvelteKit 公式推奨の 1 つ。`npm i @inlang/paraglide-js`。ビルド時に TS 関数を生成し、未使用 key は tree-shake。
- メリット: (1) **型安全**: 辞書外キーを TypeScript が検出（#1346 AC「型安全」直結）、(2) **runtime オーバーヘッド ゼロ**（ビルド時 precompile）、(3) bundle に含まれるのは参照した key のみ → LP 側でも軽量、(4) vanilla JS 出力可 → LP の `site/**` でも `<script type="module">` で呼べる（adapter-static 化より軽い経路）
- デメリット: 学習コストが svelte-i18n より高い。inlang ecosystem 依存（ただし CLI 主体でロックインは軽い）
- Pre-PMF コスト（ADR-0010）: 導入工数 中（App 側移行 + LP 側経路確立）、学習コスト 中、bundle size 影響 軽微、長期保守性 **高**（型 + tree-shake）

### 選択肢 B: svelte-i18n（OSS）

- 概要: SvelteKit ecosystem i18n のデファクト。`$_('key')` runtime 参照。
- メリット: 採用実績最多、学習コスト低、ドキュメント豊富、runtime switch で i18n ライブ切替可能
- デメリット: (1) **runtime 参照**のため bundle に全 key 含む（LP 側で使うと肥大化）、(2) 型安全性は追加設定必要、(3) LP 側で使うには SvelteKit 化前提（#566 選択肢 B 再浮上 → 決断コスト大）
- Pre-PMF コスト: 導入工数 低（App 側のみなら）、学習コスト 低、bundle size 影響 中（runtime dict）、長期保守性 中

### 選択肢 C: 現状の `shared-labels.js` data-* attribute DOM parse 拡張（独自実装）

- 概要: 現在 AGE_TIER_LABELS / PLAN_LABELS のみ対応している自前機構を FEATURE_LABELS まで拡張
- メリット: 追加学習ゼロ、既存パイプライン継続
- デメリット: (1) **PO 方針で不採用**（独自実装過多の典型）、(2) 型安全性ゼロ（labels.ts キー typo を検出不能）、(3) runtime DOM parse オーバーヘッド、(4) SEO 未解決（クローラは JS 未実行）、(5) 将来の多言語化・複数形・日付国際化に対応不能
- Pre-PMF コスト: 導入工数 低、学習コスト ゼロ、bundle size 影響 低、**長期保守性 低**（技術的負債蓄積）

### 参考: その他 5 候補（本 ADR では推奨せず）

| 候補 | 推奨しない理由 |
|------|----------------|
| svelte-intl-precompile | Paraglide と機能重複。採用実績 Paraglide が優勢 |
| @formatjs/icu-messageformat | React/Vue 向けメイン。Svelte 統合は薄い。ICU 構文の複数形は将来性あるが Pre-PMF では過剰 |
| Fluent (Mozilla) | 非エンジニア翻訳編集向け仕様で PO 1 人体制では ROI が合わない。採用コスト高 |
| @sveltejs/adapter-static（LP の SvelteKit 化） | #566 で一度見送り。Paraglide / svelte-i18n の vanilla 出力で回避可能なら LP 側アーキテクチャ大改修は Pre-PMF では過剰（ADR-0010 バケット C） |
| Style Dictionary / Design Token 方式 | Amazon/Atlassian 規模向け。Content Token 思想は思想として有用だが、Pre-PMF で独自パイプラインを組むのは本 ADR の主旨（独自実装回避）と矛盾 |
| CMS (Contentful/Sanity/Strapi) | **Pre-PMF では過剰（ADR-0010 明示的バケット C）**。月次コスト発生、運用工数増、PO 1 人で回らない |

## 決定（PO 最終判断前提の推奨）

**選択肢 A: Paraglide を推奨**。理由:

1. #1346 AC「型安全」「runtime 束縛」「手動同期ゼロ」「多言語化への将来拡張」を単一 OSS で満たす
2. LP 側で vanilla JS 出力可 → adapter-static 化（#566 選択肢 B 再浮上）の重い決断を回避できる
3. Pre-PMF で懸念される bundle 肥大を tree-shake で回避
4. 独自実装（選択肢 C）を排除する PO 方針と整合

フォールバック: PO が「学習コスト優先」を選ぶ場合は選択肢 B (svelte-i18n)。ただし LP 側経路に別途設計が必要。

**選択肢 C（自前 data-* 拡張）は採用しない**（PO 方針、#1346 Why）。

## 結果

- Phase 2（App 側 FEATURE_LABELS runtime 束縛）着手の機構が確定
- Phase 3（LP 側移行）で `shared-labels.js` の段階的廃止が技術的に可能になる
- Phase 4（英語化）時に機構レベルで多言語対応可能
- ADR-0009 の「機構完成ステータス」欄に Phase 進捗を追記する運用が始まる

### トレードオフ

- Paraglide は inlang ecosystem 依存（CLI + config）→ 将来 ecosystem が廃れたら CLI 差替えコスト発生
- 学習コスト（PO + AI エージェント双方）は svelte-i18n より高い
- Phase 2 着手時に既存ハードコード一掃の工数が確定する（見積は Phase 2 Issue で）

## 関連

- ADR-0009（labels.ts SSOT 原則）— 本 ADR 承認後、機構完成ステータス欄を追補
- ADR-0010（Pre-PMF スコープ判断）— CMS / adapter-static 大改修をバケット C で退ける根拠
- ADR-0013（LP 文言は実装の事実を SSOT）— 本 ADR 承認後、LP 側が runtime 参照経路に移行する前提が揃う
- #1346（本 Issue）/ #1350（OSS 先調査プロセス化）
- #566 / #1126（LP SSOT パイプラインの半完成の原点）
