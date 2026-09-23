# 18. 個人開発SaaS展開ガイド

## 1. 設計背景

がんばりクエストは、1 人の開発者が家庭内アプリを有償の SaaS として展開する（有償での外部公開の可否は [10-SaaS展開ロードマップ.md](10-SaaS展開ロードマップ.md) §4 で判定する）。実装のほかに、法務・税務・コスト・セキュリティ・広報を自分で決めなければならない。どれも、知っていれば数分で済み、知らなければ事故になる種類の知識である。

この文書が無いと、次のことが起きる。

- **同じ判断を毎回調べ直す**。特商法表記の書き方、同意の記録に何を残すか、アップロードされたファイルをどう無害化するかを、そのたびに一から調べることになる
- **根拠がどこにあるか分からない**。知見の本体は設計書・runbook・ADR に散っていて、入口が無いと見つからない

本書は、個人開発の SaaS 運営で決めることの一覧と、それぞれの SSOT への索引である。

## 2. 設計原則

1. **索引に徹する**。料金・無料枠・税額・テスト件数などの値は書かない。値はそれぞれの SSOT を指す（料金・決済手数料・固定費は [19-プライシング戦略書.md](19-プライシング戦略書.md)、インフラ費用は [13-AWSサーバレスアーキテクチャ設計書.md](13-AWSサーバレスアーキテクチャ設計書.md) §6、コスト監視は [35-コスト管理計画書.md](35-コスト管理計画書.md)）。書くと本書だけが古くなる
2. **実物で裏付けられることだけを書く**。「〜している」と書くなら、その実装・設定・文書を指す。運用していない手順は書かない
3. **経緯を書かない**。教訓は「次に同じことをするときに守ること」として書く。何が起きたかは Issue と git に任せる（docs/CLAUDE.md §docs SSOT 原則）
4. **仕様の SSOT が別にあるものは指すだけにする**。例外は §7.6（エラーページの役割別の出し分け）と §7.7（ルート `/` の遷移）で、詳細はほかの設計書に書かれていないため、本書を SSOT とする（エラー画面の一覧 [28-エラーハンドリング設計書.md](28-エラーハンドリング設計書.md) §10 は §7.6 を指す）

## 3. 法務・税務

### 3.1 開業・税務

- 個人事業主として開業届を出す。Stripe を本番に切り替えるときの本人確認でも使う（[stripe-dashboard-runbook.md](../operations/stripe-dashboard-runbook.md) ステップ 1）
- 青色申告を選ぶ。帳簿に使う売上台帳と経費の CSV は `/ops` から出力できる（`src/lib/server/services/ops-service.ts`）
- 消費税と Stripe Tax の設定手順は [stripe-dashboard-runbook.md](../operations/stripe-dashboard-runbook.md) ステップ 6。本番の実設定との突き合わせは EPIC #4580 G14 で行う
- インボイス（適格請求書発行事業者）は、免税事業者でも任意で登録できる。ただし登録すると課税事業者になる。顧客が個人（BtoC）で、適格請求書を求められることが無い間は、登録して得るものは小さい。登録するかどうかはオーナーが決める

### 3.2 特商法・個人情報

- 特定商取引法に基づく表記を出す（`site/tokushoho.html`）。所在地と電話番号は掲載せず、請求があれば遅滞なく開示する省略表示にしている
- 子どものデータを扱うので、プライバシーポリシーに未成年者の扱いを独立した条として書く（`site/privacy.html` 第 9 条「未成年者の取扱い」）。子どもの本名は必須にせず、ニックネームで使える（同 第 1 条 2「お子さまの情報」）
- データ最小化と、GDPR 相当の本人の権利は、DPIA（[17a-データ保護影響評価書.md](17a-データ保護影響評価書.md)）で評価している
- 法務文書（`site/terms.html` / `site/privacy.html` / `site/tokushoho.html`）と申込の最終確認画面（改正特商法 12 条の 6）を社外の専門家に見てもらうことは、有償公開の条件に含めている（EPIC #4580 G15）

### 3.3 同意

- サインアップ時に、利用規約・プライバシーポリシー・海外への移転（個人情報保護法 28 条）の 3 つの同意をチェックボックスで取り、サーバ側でも必須にしている（海外への移転の同意は [14-セキュリティ設計書.md](14-セキュリティ設計書.md) §8.6）
- サインアップフォームを通らない登録（Google）と、規約の版が上がった場合は、`src/hooks.server.ts` が次のアクセスで `/consent` へ送り、同意を取る（版は `src/lib/server/services/consent-service.ts` の `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION`）
- 同意の記録には日時・IP アドレス・User-Agent・規約の版を残し、追記だけで書き換えない（`src/lib/server/services/consent-service.ts`）
- 消費者契約法 8 条により、事業者の損害賠償責任を全部免除する条項と、故意・重過失による責任を一部でも免除する条項は無効になる。責任の上限を決めるなど一部を免除する条項は、軽過失の場合にだけ適用すると明記しないと無効になる（同条 3 項）。利用規約の免責条項（`site/terms.html` 第 12 条）はこれを前提に書く

## 4. コスト管理

- インフラは Lambda + Aurora DSQL + S3 + CloudFront のサーバーレス構成にし、費用の大半を利用量に比例させる（利用が無い月も、ドメインなどの固定費はかかる）。構成と費用の試算は [13-AWSサーバレスアーキテクチャ設計書.md](13-AWSサーバレスアーキテクチャ設計書.md) §6、固定費の内訳と損益分岐点は [19-プライシング戦略書.md](19-プライシング戦略書.md) §6、コストを抑える方針は [35-コスト管理計画書.md](35-コスト管理計画書.md) §2
- Cost Explorer API は呼び出しごとに課金される。呼び出し方の規律は `infra/CLAUDE.md` §AWS Cost Explorer API 使用制限
- 予算アラート・異常検知・月次のコスト監査（不要リソースの棚卸しを含む）は [35-コスト管理計画書.md](35-コスト管理計画書.md) §3
- リポジトリは公開している（AGPL-3.0）。GitHub Actions の費用は [integration-pr-operations.md](../runbooks/integration-pr-operations.md) §月次コスト概算

## 5. セキュリティ

### 5.1 認証・認可

- 本番の認証は Cognito（OAuth 2.0 / OIDC）
- `AUTH_MODE=local`（NUC セルフホスト / `npm run dev`）は認証を持たない。LAN 内に閉じた配置を前提とする（[14-セキュリティ設計書.md](14-セキュリティ設計書.md) §1.1。ログイン手段ごとの扱いは §4.3b）
- 運営画面 `/ops` は Cognito の `ops` グループ所属で守る（[14-セキュリティ設計書.md](14-セキュリティ設計書.md) §5.2.9）。内部の cron API は `CRON_SECRET` で守る（`src/lib/server/auth/cron-auth.ts`）

### 5.2 アップロードされたファイル

関数はいずれも `src/lib/server/security/file-sanitizer.ts` にある。

- アバター画像のアップロードは、Sharp で再エンコードして EXIF と polyglot ペイロードを取り除く（`sanitizeImage`。呼び出し元は `src/routes/api/v1/children/[id]/avatar/+server.ts`）
- 録音（MP3）は ID3v2 タグを取り除く（`sanitizeAudio`。呼び出し元は `src/lib/server/services/voice-service.ts`）
- バックアップ ZIP から復元したファイルは再エンコードしない。次の配信時の検査で守る
- 配信時は、許可リストに無い Content-Type を `application/octet-stream` に落とし（`safeContentType`）、ラスタ画像以外は `Content-Disposition: attachment` で返す（`safeContentDisposition`）。不変条件は [14-セキュリティ設計書.md](14-セキュリティ設計書.md) §7.2.1
- CSP（`object-src 'none'` など）で、ブラウザ側でも防ぐ（`svelte.config.js` の `kit.csp`、[14-セキュリティ設計書.md](14-セキュリティ設計書.md) §7.1）

### 5.3 保存データと配信

- 保存データの暗号化は [17a-データ保護影響評価書.md](17a-データ保護影響評価書.md) の保存データ暗号化の行を参照する
- S3 はパブリックアクセスをすべてブロックし、直接公開しない（[14-セキュリティ設計書.md](14-セキュリティ設計書.md) §3.2）
- 利用者のファイル（写真・録音）は S3 から直接配信しない。SvelteKit のエンドポイント（`/tenants/[...path]` / `/uploads/avatars/[filename]`）が、認証とテナントの一致を確かめてから返す。CloudFront の S3 origin は静的アセットだけに使う（[14-セキュリティ設計書.md](14-セキュリティ設計書.md) §7.2.1 / [13-AWSサーバレスアーキテクチャ設計書.md](13-AWSサーバレスアーキテクチャ設計書.md) §3.5.1）

### 5.4 Stripe

- Webhook は署名を検証してから処理する（`src/lib/server/services/stripe-service.ts` の `verifyWebhookSignature`）
- 本番には live key（`sk_live_` / `rk_live_`）しか配れず、それ以外を渡すと CDK の synth で止まる（`infra/lib/compute-stack.ts`）

## 6. 広報・顧客との接点

- 作っている過程を公開する（ビルドインパブリック）。開発者向け・保護者向けの媒体と導線は [10-SaaS展開ロードマップ.md](10-SaaS展開ロードマップ.md) §6
- Discord の構成と通知の範囲は [23-Discordサーバー設計書.md](23-Discordサーバー設計書.md)。運用者への Webhook 通知は人が行動を変えるものに限り、サインアップ・課金成功・解約の通知は持たない（同 §4.5「持たないチャネル」）

## 7. 技術的知見

### 7.1 SvelteKit + AWS Lambda

- SvelteKit 2 + Svelte 5 (Runes) でフルスタック開発する
- `adapter-node` でビルド → Docker (ARM64) → ECR → Lambda Web Adapter
- main への push で GitHub Actions が自動デプロイする（`.github/workflows/deploy.yml`）
- ローカル開発は SQLite、本番は Aurora DSQL（構成は [13-AWSサーバレスアーキテクチャ設計書.md](13-AWSサーバレスアーキテクチャ設計書.md)）

### 7.2 課金

- Stripe を契約状態の SSOT とし、Checkout → Webhook → プラン反映で契約を反映する
- 契約状態の組み合わせと書き手は [billing-redesign/contract-state-matrix.md](billing-redesign/contract-state-matrix.md)、方針は [billing-redesign/billing-redesign-policy.md](billing-redesign/billing-redesign-policy.md)

### 7.3 メール配信

- トランザクションメールは SES で送る（解約の受付、問い合わせ受付の確認、削除の予告と完了、支払いの失敗、PIN リセットのコード、無料体験の終了の予告など。一覧は `src/lib/server/services/email-service.ts` と `src/lib/server/services/trial-notification-service.ts`）
- HTML とテキストの両方の本文を送る（メールクライアントの互換性のため）
- `AUTH_MODE=local` では SES を呼ばず、ログと `tmp/emails/` への HTML プレビューだけを出す

### 7.4 テスト

- Vitest で unit / integration テスト（`tests/unit` / `tests/integration`）、Playwright で E2E（`playwright.config.ts` の project は `tablet`（Desktop Chrome）と `mobile` の 2 つ。構成ごとの設定は `playwright.*.config.ts`）。方針は `tests/CLAUDE.md`
- 要素は role・テキスト・label で取る。`data-testid` は、ほかで取れないときだけ使う
- CI の検査項目はルートの `CLAUDE.md` §「CI `ci.yml` で hard-fail する検査」、レーンの分け方は [branch-strategy.md](../sessions/branch-strategy.md) §4

### 7.5 URL のリネーム・廃止（#578）

**守ること**: 年齢モードなどのコードをリネームするときは、URL・DB の保存値・旧 URL の救済の 3 つを同時に移す。1 つでも漏れると、保存値から組み立てた URL が 404 になる（#571）。

1. 旧 URL の救済先は `src/lib/server/routing/legacy-url-map.ts` の `LEGACY_URL_MAP` に登録する。個別ルートに `redirect()` を直接書かない。エントリは削除しない。運用ルールは src/routes/CLAUDE.md §旧 URL 廃止ルールが SSOT
2. 照合と転送は `findLegacyRedirect`（長いプレフィックスを優先し、パスの先頭に固定して照合する）と `src/hooks.server.ts` が行う。ステータスの既定は 308（メソッドを保つ恒久転送）で、エントリの `status` で 301 / 302 に変えられる
3. 転送の契約は `tests/unit/routing/legacy-url-map.test.ts` と `tests/e2e/legacy-url-redirect.spec.ts`（request fixture と `maxRedirects: 0` で最初のレスポンスだけを見る）で検証する

**ポイント**:

- リネームが重なったら、既存エントリの `to` を最終的な行き先に付け替え、転送を 1 段に保つ（ブックマーク・PWA ショートカット・外部リンクは消えないので、古いエントリも残す）
- 認可チェックやセッションによる転送は、例外として個別ルートで行ってよい

### 7.6 エラーページの役割別の出し分け（#577）

- 子供の画面（role が child、または role が決まらず URL の先頭が年齢モード）の 404 / 403 / 500 は、年齢帯別の短い文言と大きなボタン 1 つを出し、カウントダウンのあと `/switch` へ移る。ボタンを押せば、すぐに移ることもできる（秒数は `src/routes/+error.svelte` の `AUTO_REDIRECT_SECONDS`、文言は `getChildErrorPageLabels()` が年齢帯で選ぶ）
- 親には手動の操作を残し、問い合わせ用に requestId を表示する
- `src/routes/+layout.server.ts` が `role` と `requestId` を全ページに渡し、`src/routes/+error.svelte` は `data-role` 属性で見た目を切り替える
- 404（GET・HTML）は referer / userAgent / role 付きの構造化ログに残す（`src/hooks.server.ts`）。旧 URL の登録漏れを探すときは、このログを集計する

### 7.7 ルート `/` の遷移（#576）

ルート `/` の行き先は、次の順で決める（`src/routes/+page.server.ts`）。

```
1. Cookie selectedChildId が有効 → その子供のホーム（端末ごとの直近選択）
2. tenant の default_child_id が有効 → そのホーム（家族全体の既定）
3. 子供が 1 人 → 自動選択（/switch を経由しない）
4. 子供が複数 & 既定未設定 → /switch
5. 子供 0 人 → /admin/children
```

子供の `ui_mode` に改名前の値（`kinder` など。対応表は `src/lib/domain/validation/age-tier-types.ts` の `LEGACY_UI_MODE_MAP`）が残っていても、ホーム URL を組み立てる前に `normalizeUiMode()` で正規化する。
