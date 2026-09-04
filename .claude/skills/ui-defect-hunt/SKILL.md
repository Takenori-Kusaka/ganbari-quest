---
name: UI Defect Hunt
description: 【実機・探索型】何が壊れているか分からない状態から未知の不具合を探すとき — 共同テスト、リリース前の総ざらい、新機能の受け入れ。本番 / staging / LP / デモを横断し、8 観点 (構造導線・状態網羅・入力検証・レスポンシブ×5年齢モード・Core Web Vitals・ネットワーク耐性・a11y・表示品質) で探索して全件発露させ、起票は選別する。既存 CI 資産 (axe / lp-metrics / visual regression 3 層) が見ている軸は手で歩かない。※確認項目が決まっているなら live-ui-verification、実装前の UX 評価なら cognitive-walkthrough。
---

# UI Defect Hunt（探索的 UI 欠陥ハント）

**まだ誰も知らない不具合**を、動いている画面から探し出す。

`live-ui-verification` が「決まった条件を確認する」のに対し、本 skill は「**何が壊れているか分からない状態から探す**」。Issue が一巡した後の共同テスト、リリース前の総ざらい、新機能の受け入れで使う。

> **実績**: この探索を最初に回した release 第18回（2026-07-31）で、全 CI 緑 + E2E 緑 + 統合監査完了の後に、**アップグレード導線が完全に死んでいる**（#4139）ことがブラウザ 1 回で見つかった。機械が緑でも顧客の画面は壊れうる。

## 前提: 作法は `live-ui-verification` と共有する

**先に [`live-ui-verification`](../live-ui-verification/SKILL.md) の「絶対原則」を読むこと。** 以下は本 skill でもそのまま強制される。

1. **本番 read-only**。押してよいのは状態が変わらないものだけ。決済 / 削除 / 保存は staging で
2. **検証できなかったものを無言で落とさない**
3. **認証情報をセッションの外に出さない**。screenshot にフォーム入力済みのパスワードを写さない
4. **snapshot を主、screenshot を従**。accessibility tree にしか `href` は出ない
5. **コードで裏取りしてから分類する**。仕様どおりの挙動を起票しない

---

## Step 1: 既存資産と重複しない範囲を決める（最初にやる）

**機械が既に見ている軸を手で歩かない。** 本リポジトリには以下の自動検査が既にある。手で探すのは「そこから漏れるもの」だけ。

| 軸 | 既存資産 | 手で歩く必要 |
|---|---|---|
| a11y (WCAG 2.2 AA) | `tests/e2e/a11y-critical-cuj.spec.ts` + `a11y-baseline.json`（@axe-core/playwright） | **baseline に載っている違反の中身** / キーボード操作・focus 順序（axe が見ない領域） |
| 視覚回帰 | visual regression 3 層（LP / child-home / app、`scripts/check-lp-visual-regression.mjs`） | **baseline が無い画面** / 動的状態（dialog open / error 表示中） |
| LP 寸法・禁止語 | `scripts/measure-lp-dimensions.mjs`（`lp-metrics.yml`） | LP の**動線**（寸法は機械が見る） |
| 機能 E2E | `tests/e2e/**`, `test:e2e:matrix`（mode × plan 4 project） | **E2E が goal 完遂を見るだけで通る「分かりにくさ」**（#2544 / #2558 で実証済） |
| 画面キャプチャ | `scripts/capture.mjs` / `capture-app-baseline.mjs` | — |

```bash
npx playwright test tests/e2e/a11y-critical-cuj.spec.ts   # 先に流して、既知違反を把握してから歩く
```

**この Step を飛ばすと、機械が既に検出済みのものを「新発見」として報告することになる。**

## Step 2: 探索対象と観点を宣言する

歩き始める前に、**対象面**と**観点**を宣言する。宣言しないと「なんとなく見た」になり、次回再現できない。

**対象面**（この製品で存在するもの）:

| 面 | URL / 起動方法 | 注意 |
|---|---|---|
| 本番アプリ（親） | `https://ganbari-quest.com/admin/**` | read-only 厳守 |
| 本番アプリ（子供） | `/(child)/[uiMode]/**` — baby / preschool / elementary / junior / senior | **5 モード全部**。1 つで代表させない |
| LP | `https://<pages>/index.html` ほか 10 ページ | `site/` 配下 |
| デモ | `AUTH_MODE=anonymous` + `DATA_SOURCE=demo` で起動した本番ルート | 専用ルートは存在しない（#2097 で撤去済） |
| staging | `deploy-aws-staging.yml` / NUC staging | 破壊的操作はここで |

**観点**は次章の 8 軸から選ぶ。全軸 × 全画面は現実的でないので、**どちらかを選ぶ**:

- **横に浅く**: 1 画面につき 8 軸を通す。新機能・新画面の受け入れ向き
- **縦に深く**: 1 軸で全画面を通す。「導線だけ全部見る」「状態網羅だけ全部見る」。総ざらい向き

---

## Step 3: 8 観点マトリクス

### ① 構造・導線（IA / navigation）

**最も収穫が多い軸。** snapshot の `/url` を読むだけで見つかる。

- [ ] **CTA が自ページを指していないか**（component 再利用で頻発。#4139 の実例）
- [ ] **同じ遷移先のボタン / リンクが複数ないか**（Stripe portal を開くボタンが 3 箇所あった実例）
- [ ] **dead-end**: そのページから戻る / 次へ進む導線があるか。ブラウザバックだけが出口になっていないか
- [ ] **未到達ページ**: routes に存在するがどこからもリンクされていない画面はないか
- [ ] **到達できるが権限で弾かれる**導線を出していないか（押したら 403 になる link）
- [ ] 同じ情報が 2 ページに重複表示されていないか（どちらが正か顧客が判断できない）
- [ ] DESIGN.md §10 整合: 同一リソースの add 経路 ≤ 4 / 画面あたり FAB ≤ 1 / admin 正準スロット順

```
browser_snapshot { depth: 8, target: "main" }
→ link / button を全部拾い、/url を現在 URL と突き合わせる
```

**未到達ページの機械的な洗い出し**（探索の当たりを付ける）:

```bash
# routes の一覧 と、UI からリンクされている href の差分を取る
ls src/routes/\(parent\)/admin/**/+page.svelte
grep -rn "href=\"/admin" src/lib src/routes --include=*.svelte -o | sort -u
```

### ② 状態網羅（empty / loading / error / 上限 / 権限）

`tests/CLAUDE.md` の「3 状態統一」条件と対。**正常系しか描かれていない画面**を探す。

- [ ] **empty**: データ 0 件。`UnifiedEmptyState`（SSOT）を使っているか。独自の空表示を直書きしていないか
- [ ] **filter empty**: 絞り込み結果 0 件が genuine-empty と区別されているか
- [ ] **loading**: 非同期処理中に何か出るか。`Button` の `loading` prop（DESIGN.md §5）が反映されているか。**押しても何も変化しないと再クリックされる**
- [ ] **error**: API 失敗時に何が出るか。内部例外がそのまま露出していないか（ADR-0062）
- [ ] **上限到達**: プラン上限に達した状態の表示
- [ ] **権限不足**: 権限のないアカウントで開いたときの表示（403 の見え方）

**本番では作れない状態は staging / demo で作る。** 作れなければ「未確認」と書く。

### ③ 入力とバリデーション

- [ ] 必須項目を空で送信 → エラーが**その場に**出るか（画面遷移して消えないか）
- [ ] 境界値（0 / 最大 / 最大+1）
- [ ] **全角数字・絵文字・改行・前後空白**の混入
- [ ] 極端に長い文字列 → レイアウトが崩れないか（桁あふれ・省略記号）
- [ ] **二重送信**: 送信ボタンを連打したときに 2 件登録されないか
- [ ] `use:enhance` を使っている form で `preventDefault` 前提の確認ダイアログが効いているか（**効かない**。`cancel()` か button `onclick` を使う実装になっているか）

> 本番では送信しない。**入力してレイアウトを見るところまで**。送信検証は staging。

### ④ レスポンシブ × 年齢モード

この製品では **breakpoint × 5 年齢モード** の二重マトリクスになる。

- [ ] mobile (390) / tablet (768) / desktop (1280 / 1440) で崩れないか
- [ ] **5 年齢モード全部**（baby 1.5 / preschool 1.2 / elementary 1.0 / junior 1.0 / senior 1.0 の fontScale、tapSize 120/80/56/48/44px）
- [ ] `fontScale` が大きいモードで**文字がはみ出す / ボタンからあふれる**箇所
- [ ] `tapSize` が守られているか（baby で小さいボタンが残っていないか）
- [ ] 日本語の折り返し（DESIGN.md §3。見出し・ボタンで不自然な位置で切れないか）
- [ ] ナビ構造が desktop / mobile で異なる（`AdminLayout` に両方が同居 / 子供は `BottomNav`）— 両方見る

```
browser_resize { width: 390, height: 844 }    ← Playwright MCP
mcp__...chrome-devtools__emulate               ← device emulation が要るとき
```

### ⑤ パフォーマンス（Core Web Vitals）

**Chrome DevTools MCP を使う。** Playwright MCP では取れない。

```
performance_start_trace   → ページを自動リロードして LCP / INP / CLS を収集
performance_analyze_insight → ボトルネック（render-blocking / long task / layout shift）を特定
lighthouse_audit          → 総合スコアが要るとき
```

- [ ] **LCP ≤ 2.5s**。超えていたら何が LCP 要素か（巨大画像が典型。LP は `npm run optimize:lp-images:check` の閾値がある）
- [ ] **CLS**: 画像・広告枠・遅延読み込みで画面が飛ばないか
- [ ] **INP**: 操作してから反応するまで
- [ ] long task で操作が固まる箇所

LP は `scripts/measure-lp-dimensions.mjs` が寸法 ratchet を見ているが、**CWV は見ていない**。ここは手で取る価値がある。

### ⑥ ネットワーク耐性・通信不具合

- [ ] **console エラー / warning**（毎ページ収集する。ここに出ているものは大抵本物）
- [ ] **失敗しているリクエスト**（4xx / 5xx / CORS / CSP violation）
- [ ] 低速回線でのローディング表示（throttling）
- [ ] オフライン / 通信断からの復帰（Service Worker がある）
- [ ] タイムアウト時の表示

```
browser_console_messages { level: "warning" }        ← Playwright MCP
browser_network_requests                              ← 失敗リクエストの抽出
list_console_messages / list_network_requests         ← Chrome DevTools MCP（より詳細）
```

**CSP violation は console にしか出ない。** ADR-0067 / ADR-0029 で CSP を触っているため、変更後は必ず見る。

### ⑦ アクセシビリティ（axe が見ない領域）

axe が自動検出する分は `a11y-critical-cuj.spec.ts` に任せる。**手で見るのはここ**:

- [ ] **キーボードだけで**主要導線を完走できるか（Tab / Enter / Esc）
- [ ] **focus インジケータが見えるか**、tab 順序が視覚順と一致するか
- [ ] Dialog を開いたとき focus が中に移り、Esc で閉じ、閉じたら元の要素に戻るか
- [ ] `role="status"` / `role="alert"` の使い分け（ADR-0062）。操作結果がスクリーンリーダーに届くか
- [ ] 画像・アイコンのみのボタンに**アクセシブルネーム**があるか（snapshot の `button` に名前が出ているか）

### ⑧ 表示品質・文言

- [ ] **内部コード・技術用語・識別子の露出**（DESIGN.md §6 禁忌。`uiMode` の生値、メールアドレス断片、エラーコード）
- [ ] 用語のゆれ（`terms.ts` / `labels.ts` SSOT からの逸脱。「解約」/「退会」/「キャンセル」の混同）
- [ ] プラン名・価格の直書き（`check-no-plan-literals.mjs` が CI で見るが、**画面上の実表示**は別）
- [ ] 絵文字がプラットフォーム依存で崩れていないか（DESIGN.md §7: 収集物・ブランド要素は画像であるべき）
- [ ] 数値の桁あふれ、日付フォーマット、**JST 境界**（#4120 E4。深夜 0-9 時に日付がずれる経路）
- [ ] LP は ADR-0013（実装の事実を書く）— **未実装機能を「実装済み」と書いていないか**

---

## Step 4: 発見の記録 — 全件出す。その場で棄却しない

**1 件見つけて満足しない。1 件で止めない。** 固定時間 box（例: 60 分）を切って、その中で**全件発露**させる。棄却・優先順位付けは後段でやる（`docs/sessions/audit-team.md` §3.6 と同じ原則）。

記録は 1 件ずつこの形にする。**再現手順が無い finding は Dev が確認できない = 存在しないのと同じ。**

```markdown
### F-<n>: <一行で現象>

- **面 / URL**: 本番 /admin/subscription
- **観点**: ① 構造・導線
- **再現手順**: 1. ログイン 2. /admin/subscription を開く 3. 「⭐⭐ プレミアムへ」を押す
- **観測**: 同じページに留まる。snapshot 上 `/url: /admin/subscription`（自ページ）
- **期待**: アップグレード経路へ遷移する
- **裏取り**: <該当コード path:line / 仕様書の記述>
- **分類**: ② 顧客に見える欠陥
- **severity**: 3（顧客の金に接続）
```

## Step 5: 裏取り → 分類 → 起票判断

**画面で見えたものだけで結論を出さない。**

```bash
grep -rn "<画面で見た文字列>" src/          # どこが描いているか
gh issue list --search "<keyword>" --state all   # 既知でないか
```

3 分類（`live-ui-verification` Step 3 と同一）:

| 分類 | 次にすること |
|---|---|
| ① 検証条件の充足 / 未達 | 証跡を GitHub に記録 |
| ② 顧客に見える欠陥 | 起票基準に照らす（下記） |
| ③ 仕様の確認が要るもの | **選択肢を添えて PO / オーナー判断を仰ぐ**。勝手に②にしない |

**起票基準**（`docs/sessions/po-session.md` §「Issue を起票する基準」）:

- **起票する**: 顧客価値の作業単位（EPIC と傘下の実装単位）、またはオーナーの手番が要るもの（不可逆 4 操作）
- **起票しない（accepted-residual として記録）**: severity 1-2 の marginal。**Issue 化せず記録に残す**
- **class-lock**: 同じ root class が 2 件目なら instance を N 件起票せず、**class 全体を 1 件の機械 guard で lock**（ADR-0061 原則 2）

> **全部起票しない。** 探索は必ず大量の finding を生む。全部 Issue にすると backlog が膨らみ、優先順位が消える。**発露は全件、起票は選別。**

## Step 6: 見つけた class を機械に移す

**同じものを次回も手で探すなら、探索は失敗している。**

| 見つけたもの | 移す先 |
|---|---|
| 自己リンク / dead-end | fitness function（routes の href を静的検査）or E2E |
| 状態網羅の漏れ | Storybook の play 関数 / E2E |
| 年齢モード差 | `test:e2e:matrix`（mode × plan 4 project） |
| 視覚崩れ | visual regression baseline に画面を追加 |
| a11y | `a11y-critical-cuj.spec.ts` に CUJ を追加 |
| CWV 劣化 | LP は `lp-metrics.yml` に、アプリは app perf budget に |

これをやらないと、探索が**毎回ゼロから**になる。

---

## アンチパターン

| やってはいけないこと | なぜ |
|---|---|
| 既存 CI が見ている軸を手で歩く | 時間の浪費。Step 1 を飛ばした結果 |
| 1 件見つけて報告を終える | 探索の価値は網羅にある。固定時間 box で全件出す |
| 発見を全部 Issue にする | backlog が膨らみ優先順位が消える。発露は全件、起票は選別 |
| 再現手順を書かない | Dev が確認できない。finding として成立しない |
| 5 年齢モードのうち 1 つで代表させる | fontScale 1.5 の baby だけ崩れる、が最も多い |
| screenshot だけ見る | `href` が見えない。①の軸が丸ごと落ちる |
| 本番で送信 / 削除 / 決済ボタンを押す | 不可逆。staging でやる |
| コードを見ずに起票する | 仕様どおりの挙動を起票すると信用を失う |
| 見つけた class を機械に移さない | 次回も同じものを手で探すことになる |

---

## 接続

| 参照先 | 関係 |
|---|---|
| [`live-ui-verification`](../live-ui-verification/SKILL.md) | **作法の SSOT**（read-only / snapshot 主 / 裏取り / 証跡）。確認条件が決まっている検証はそちら |
| [`cognitive-walkthrough`](../cognitive-walkthrough/SKILL.md) | 初見 persona × NN/G 4 質問。**観点②③の「分かりにくさ」**を深掘りするとき併用 |
| [`age-mode-check`](../age-mode-check/SKILL.md) | 観点④の年齢モード側 |
| [`brand-check`](../brand-check/SKILL.md) | 観点⑧のトークン・用語側 |
| [`customer-voice`](../customer-voice/SKILL.md) | 3 persona の観点で歩きたいとき |
| [`issue-triage`](../issue-triage/SKILL.md) | Step 5 の起票 |
| `docs/sessions/webui-review-process.md` | WebUI レビュー 4 層自動化モデル + A〜D 課題一般化フロー（#2936）。**本 skill の finding もこの仕分けに還元する** |
| `docs/sessions/audit-team.md` §3.6 | 全件発露 → filter → 起票/棄却。Step 4-5 はこれの縮小版 |
| `tests/CLAUDE.md` | CX-DoR 8 条件 / 3 状態統一 / Storybook play |
