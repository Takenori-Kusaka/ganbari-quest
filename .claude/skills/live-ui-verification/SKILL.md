---
name: Live UI Verification
description: 【実機・確認型】確認する項目が事前に決まっているとき、deploy 済み環境 (本番 / staging) をブラウザで開いて結果を確定させる — release 後の目視確認、EPIC close 前の実機確認、顧客報告の再現、手動復旧の生存確認。Playwright MCP を実資格情報で駆動し、screenshot ではなく accessibility snapshot の href を読んで死んだ CTA を検出、finding はコードで裏取りしてから GitHub に証跡を残す。本番 read-only 原則を強制。※未知の不具合を探索するなら ui-defect-hunt、実装前の UX 評価なら cognitive-walkthrough。
---

# Live UI Verification（実機 UI 検証）

deploy 済み環境をブラウザで実際に操作し、**機械が緑でも顧客の画面で壊れているもの**を捕捉する。

2026-07-31 の release 第18回で確立。本番 `/admin/subscription` の「⭐⭐ プレミアムへ」CTA が自ページを指しており、**アップグレード導線が完全に死んでいた**（#4139）。全 CI 緑・E2E 緑・監査完了の後に、ブラウザ 1 回で発見された。

## いつ使うか（trigger）

| 場面 | 何を見るか |
|---|---|
| **release 後の目視確認** | 統合 PR 承認時に PO が指定した確認条件。deploy success ≠ 顧客の画面が正しい |
| **共同テストの実施** | Issue を一巡させた後、人と AI で同じ画面を見ながら課題を洗い出す |
| **顧客報告の再現** | 「押しても何も起きない」型の報告。ログにも E2E にも出ない |
| **EPIC close 前の実機確認** | 完了の定義に「実画面に反映される」が含まれる EPIC（#4117 E1 の S-0 等） |
| **手動復旧の生存確認** | 本番で手作業で直したものが、次の release で巻き戻っていないか |

**使わない場面**:

- **何が壊れているか分からない状態から探す** → [`ui-defect-hunt`](../ui-defect-hunt/SKILL.md)（8 観点マトリクスで探索的に洗い出す）。本 skill は**確認条件が事前に決まっている**ときに使う
- **実装前の設計レビュー** → [`cognitive-walkthrough`](../cognitive-walkthrough/SKILL.md)（初見 persona × NN/G 4 質問）

3 つは補完関係で、片方が他方を代替しない。本 skill の「絶対原則」は 3 skill 共通の作法 SSOT であり、`ui-defect-hunt` からも参照される。

---

## 絶対原則（これを破ると本番事故になる）

### 1. read-only。本番で不可逆操作をしない

**押してよいのは、押しても状態が変わらないものだけ。**

| 操作 | 本番 | staging |
|---|---|---|
| ページ遷移 / snapshot / screenshot | ✅ | ✅ |
| フォーム入力（送信しない） | ✅ | ✅ |
| ログイン / PIN 入力 | ✅ | ✅ |
| **Stripe portal を開く** | ❌ | ✅ |
| **プラン変更 / 解約 / 削除 / 保存** | ❌ | ✅ |
| **アカウント削除の確認テキスト入力** | ❌ | ⚠️ 押さない前提でのみ |

本番で決済導線の「先」を確認したくなったら、**staging で同じ画面を開く**。それができないなら「未確認」と報告する。憶測で「たぶん動く」と書かない。

### 2. 検証できなかったものを無言で落とさない

権限不足・環境不備で見られなかった画面は、**「未達」として明示的に報告する**。報告に書かれていない項目は、読む人には「確認済み」に見える。

> 例（2026-07-31）: `/ops` が 403 で入れず、**本番 webhook の受信ログは確認できていない**。顧客画面が正常であることと、webhook が届いていることは別。

### 3. 認証情報をセッションの外に出さない

- 資格情報は `tmp/` 等の **gitignore 済みディレクトリ**から読む。使用前に `git check-ignore -v <path>` で確認する
- 資格情報を Issue / PR / commit / スクリーンショットに含めない
- **screenshot にログイン画面の入力済みフォームを含めない**（パスワードが平文で写る）
- 検証に使うのは**テストアカウント**。実顧客のアカウントでログインしない

---

## 手順

### Step 0: 資格情報と対象の確認

```bash
git check-ignore -v tmp/<cred-file>     # gitignore 済みか
```

確認すること: **対象 URL（本番 / staging）** / **アカウントの権限**（一般の親 / ops / owner）/ **何を確認しに行くのか**（条件が事前に決まっているか）。

権限が足りない画面があると分かっている場合は、この時点で「未達になる予定の項目」を控えておく。

### Step 1: ログイン

```
browser_navigate  → https://<host>/auth/login
browser_snapshot  → textbox の ref を取得
browser_fill_form → メールアドレス / パスワード
browser_click     → ログイン
browser_wait_for  { time: 5 }        ← 遷移完了を待つ。即 snapshot すると前画面が返る
```

**PIN（おやカギコード）が要る画面**は `/switch?pinRequired=1&next=...` に飛ぶ。4 桁を 4 つの textbox に個別に fill する。

```
browser_fill_form → pin code 1..4 of 4 に 1 文字ずつ
browser_wait_for  { time: 4 }
```

- PIN の既定値は `PIN_DEFAULT_TERMS.hintFull`（`src/lib/domain/terms.ts`）だが、**運用中の環境では変更されている**。分からなければオーナーに聞く。3 回失敗するとロックされる実装があれば、試行を繰り返さない
- ページ再読込すると snapshot の ref prefix が変わる（`e45` → `f1e7`）。**fill する直前に snapshot を取り直す**

### Step 2: snapshot を主、screenshot を従とする（最重要）

**`browser_snapshot` の accessibility tree には `href` が出る。screenshot には出ない。**

```yaml
- link "⭐⭐ プレミアムへ" [ref=f3e67]:
    - /url: /admin/subscription      ← 今このページ。自己リンク = 押しても何も起きない
```

2026-07-31 の発見はこれ 1 つで説明できる。**screenshot だけを見ていたら、このボタンは「正常に描画されている」ようにしか見えなかった。**

snapshot で必ず見るもの:

- [ ] **CTA の `/url` が自ページを指していないか**（component 再利用でよく起きる）
- [ ] 同じ遷移先を持つボタン / リンクが**複数ないか**（導線の冗長 = Hick's Law 違反）
- [ ] 同じ情報が**複数箇所に重複表示**されていないか
- [ ] `[disabled]` が意図どおりか
- [ ] 顧客に見える文字列に**内部識別子・技術用語・メールアドレス断片**が出ていないか（DESIGN.md §6）
- [ ] `status` / `alert` role の要素に何が入っているか

```
browser_snapshot { depth: 6, target: "main" }    ← 全体が大きいときは main に絞る
```

screenshot は**証跡として**撮る。判断の材料は snapshot。

```
browser_take_screenshot { fullPage: true, filename: "prod-<page>-<date>.png" }
```

### Step 3: 発見をコードで裏取りしてから分類する

**画面で見えたものだけで結論を出さない。** 仕様どおりの挙動を「バグ」として起票すると、Dev の時間を奪い、起票者の信用も落ちる。

```bash
# 例: 家族名が "kokorokagami+test1の家族" と表示されていた件
grep -rn "の家族" src/
# → src/lib/server/auth/providers/cognito.ts:316
#    name: `${familyName}の家族`  ← メールのローカル部から生成。仕様どおりだった
```

裏取りの結果で 3 つに分ける。

| 分類 | 意味 | 次にすること |
|---|---|---|
| **① 検証条件の充足 / 未達** | 事前に決めた確認項目の結果 | 証跡を GitHub に記録（Step 4） |
| **② 顧客に見える欠陥** | 実装が意図どおりに動いていない | 起票基準に照らして判断（Step 5） |
| **③ 仕様の確認が要るもの** | 実装は仕様どおり。仕様自体の是非は PO / オーナー判断 | 選択肢を添えて判断を仰ぐ |

③ を勝手に②として起票しないこと。**「仕様どおりだが変更手段が無い」のような設計の穴は、③ として選択肢を出す**（実装を変える / 仕様として確定させる / 保留する）。

### Step 4: 証跡を GitHub に残す

**セッション上の報告は証跡にならない。** 該当 Issue / PR にコメントとして残す。

含めるもの:

- 対象環境・アカウント・実施日時
- **表形式の確認結果**（画面 / 結果）
- **未達項目と、その理由**
- 発見した欠陥（別 Issue にするならリンク）
- **残存リスク**（今回は無事だったが、次も無事とは限らないもの）

```bash
gh issue comment <N> --body @'...'@
```

### Step 5: 起票の判断

起票基準（`docs/sessions/po-session.md`）を適用する。**目視で見つけたからといって全部起票しない。**

- **起票する**: 顧客の金・データ・法務に接続し、EPIC のいずれかに属するもの
- **起票しない（記録のみ）**: 軽微な表示ゆらぎ、仕様どおりの挙動、装置起因
- **仕様として確定させる**: 実装とコメント / 設計書が食い違っているだけのもの。実装を変えずに記述を直す

起票する場合は、**発見経緯（どの画面で / 何をして / 何が起きたか）と、snapshot の該当箇所を Issue 本文に貼る**。「押しても何も起きない」は再現手順が無いと Dev が確認できない。

---

## 報告テンプレート

```markdown
## <環境> 目視確認の結果（YYYY-MM-DD、<契機>）

対象アカウント = <権限 / 素性>

| 画面 | 結果 |
|---|---|
| /path | **正常**。<観測した具体値> |
| /path | **403**（<理由>） |

**結論**: <確認条件が満たされたか>

### 未達 N 件
<見られなかったもの。「顧客画面が正常」と「裏側が正常」は別、という区別を明記する>

### 残存リスク
<今回は無事だったが、機械で守られていないもの>

### 顧客画面で見つけた欠陥 N 件（別途起票）
<snapshot の該当箇所を引用 + 起票先>
```

---

## アンチパターン

| やってはいけないこと | なぜ |
|---|---|
| screenshot だけ見て「正常」と報告する | `href` が見えない。死んだ CTA を見逃す |
| 本番で決済 / 削除 / 保存ボタンを押す | 不可逆。staging でやる |
| 見られなかった画面を報告から落とす | 読む人には「確認済み」に見える |
| コードを見ずに「バグだ」と起票する | 仕様どおりの挙動を起票すると信用を失う |
| 実顧客のアカウントでログインする | 権限外のデータ閲覧。監査対象 |
| 資格情報を screenshot / Issue に含める | 漏洩 |
| 遷移直後に snapshot を撮る | 前画面が返る。`browser_wait_for` を挟む |
| 再読込後に古い `ref` を使う | ref prefix が変わり "does not match any elements" になる |
| 発見を全部起票する | backlog が膨らみ、優先順位が消える。起票基準を適用する |

---

## 接続

| 参照先 | 関係 |
|---|---|
| [`cognitive-walkthrough`](../cognitive-walkthrough/SKILL.md) | 実装前 / 設計段階の UX 評価。本 skill は deploy 後の実機確認で、補完関係 |
| [`deploy-verify`](../deploy-verify/SKILL.md) | deploy 後の health / smoke。**機械が見る**。本 skill は**人が見る**層 |
| [`issue-triage`](../issue-triage/SKILL.md) | Step 5 の起票判断で使う |
| `docs/sessions/audit-team.md` §3.8 step 9 | 統合監査の health check。監査は本番認証情報を持たないため、ログイン後の画面確認は PO / オーナー側が担う |
| `docs/sessions/po-session.md` | 起票基準・PO 判断を GitHub に残す運用 |
| `docs/DESIGN.md` §6 / §10 | 内部コード露出の禁忌 / 導線の冗長（add 経路 ≤ 4）の判断基準 |
