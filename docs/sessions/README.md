# チーム憲章 — 誰が何を決め、誰に渡すか

> **このファイルの位置づけ**: `docs/sessions/` 配下の**入口**であり、ロール体制・決定権・コミュニケーション経路の SSOT。
> 各ロールの作業手順は個別ファイルにあり、本ファイルは**その間の境界だけ**を定める。
>
> **読む順序**: **§0 だけ読めば動けます。** §1 以降は背景であって、迷ったときに引くものです。

---

## §0 現在の運用モード（2026-08-05〜、オーナー決定）

**§1 以降と食い違ったら、こちらが勝ちます。**

| # | ルール |
|---|---|
| 1 | **装置は増やさない・良くしない。減らすのと、リリースプロセスへ移すのは進める**（判定基準は下記） |
| 2 | **QM は指摘を Dev に返さず、自分で直して merge する。** PR body・AC 記述・軽微な test / lint はすべて QM が埋める |
| 3 | **QM は PO に決裁を求めない。** `po-decision:required` を理由に merge を止めない |
| 4 | **PO の決裁は 2 つだけ** — ①顧客に見える文言・UX・価格の方針 ②backlog の順序 |
| 5 | **AC は目安。** close の判定は「**顧客に届いたか**」。チェックボックスが埋まっているかではない |
| 6 | **Dev に返すのは 2 つだけ** — ①実装方針の変更を伴うもの ②BLOCK 3 類型（顧客に実害 / 証跡の真正性 / 不可逆） |
| 7 | **気づいたら Issue を書かず、その場で PR を出す**（PO / Dev / Platform 共通）。Issue にするのは**顧客価値の作業単位だけ** |
| 8 | **監査だけは第三者を保つ。** finding は統合 PR のコメントに書く。直せるものは監査が自分で PR を出す。**Issue に積まない** |

### ルール 1 の判定基準 — 目標は 100 点ではなく 80 点

**すべてのブロッカーを機械で入れることは不可能だと判断しました。** 機械的な打ち手は「その打ち手を守る打ち手」を呼び、無限ループになります。**80 点を目標値とし、残り 20 点を詰めるための装置は持ちません。**

| 判定 | 対象 | 処置 |
|---|---|---|
| **A. 削減** | **80 点に達したあとの 20 点しか詰めない検査**（書式・表記ゆれ・網羅性の穴埋め・「念のため」の二重確認） | **削除する** |
| **B. 移管** | **リリースの最終レビューで実行すれば、顧客への流出を防げる検査** | **PR レーンから外し、`release/* → main` の統合レーンへ移す** |
| **C. 維持** | 上記に当たらないもの（顧客の金・データ・法務に直結し、かつ PR 単位でしか判定できない） | そのまま |

**B が効く理由**: 顧客に届くのは `main` に入った時点であって、PR が develop に入った時点ではありません。**流出を止められる最後の地点で 1 回やれば十分な検査を、PR ごとに 1 日何回も回していました。**

**新しく足すのは引き続き禁止です。** A / B は「今あるものを減らす・移す」であって、増やす作業ではありません。

**凍結の例外**（= 増やしてよい唯一のケース）: 顧客の金かデータに**現に**届いている装置不具合のみ。判定は QM が行う（PO 決裁は要らない）。

### ルール 7 / 8 — Issue を介さない

**Issue を経由した受け渡しが、価値を生まないまま滞留を作っていました。** 気づき → 起票 → 決裁 → 着手 → PR、の 5 段を、**気づき → PR** の 2 段にします。

| Issue にする | Issue にしない（= その場で PR） |
|---|---|
| **顧客価値の作業単位**（EPIC と、その傘下の実装単位） | 装置・プロセス・docs の改善 |
| **オーナーの手番が要るもの**（不可逆 4 操作） | レビューで気づいた不備 |
| — | 監査の finding |
| — | 「あとで直したい」と思ったこと全部 |

- **PR を出す側が、自分で直せる範囲を自分で直す。** 他ロールの受信箱に積まない
- **直せないと分かったときだけ**、その時点で Issue にする（先に起票しない）
- **監査は第三者を保つ**（PO / Dev の判断に相乗りしない）。ただし**受け渡しは統合 PR のコメントで行い、Issue に積まない**。直せるものは監査自身が PR を出し、**その PR の approve は QM**（作成者 ≠ 承認者、ADR-0022）

**`state:*` label は PR に対してだけ使います。** Issue の受信箱運用（mailbox）は、上表の 2 種類にしか発生しません。

### ルール 2 の実行方法 — QM は **自分のクローン内の subagent ループ**で 1 PR を閉じる

**「QM が自分で直す」は、QM 本体が手作業で直すという意味ではありません。** QM は自分のクローン内で subagent を回して 1 PR を閉じ切ります。

```
① レビュー subagent      指摘を出す
② 修正 subagent          指摘を直す（Dev に投げない）
③ 再レビュー subagent    直ったか確認する
④ QM 本体               CI 緑を実測して merge
```

- **①〜③ を回すのは QM 本体（lead）。** Dev の受信箱に戻さない
- **収束条件**: 再レビューで BLOCK 3 類型が 0、かつ `gh pr checks` で非 pass 行が 0
- **打ち切り条件**: **同じ指摘で 2 周したら、それは実装方針の問題**。ルール 6 ①として Dev に返す。3 周目を回さない
- **subagent の報告を成果の根拠にしない。** lead が `git diff` と `gh pr checks` で実測してから merge する（[agent-teams.md](agent-teams.md) §4.3）
- **ロールを跨いだ team は組まない。** teammate は lead の作業ディレクトリ・gh 認証で動くため、Dev クローンから QM を spawn すると分離が空洞化する

**アカウント**: QM は `gh auth switch` で **`ganbariquestsupport-lab`** に切り替えてから Dev の PR ブランチに push し、同じアカウントで approve / merge する。**Dev アカウント名義で push しない**（誰が書いたかが証跡から消える）。PR の作成者は Dev のまま。ADR-0022 Amendment 6。

**ルール 1 の見直しトリガー**: **E1（#4117）が staging で checkout → webhook → plan 反映 → 実画面 を 1 周した時点**（そのとき「増やさない」を続けるか再判断する。A / B の削減・移管はそれを待たずに進める）。

### なぜこうしたか（実測、2026-08-05）

| 指標 | 値 |
|---|---|
| 直近 200 Issue の構成比（14 日） | **装置・プロセス 56% / 顧客に届く変更 24%** |
| `scripts/check-*`（`origin/main`） | **61 本**（E5「8 本に絞る」は CLOSED だが 1 本も減っていない） |
| 装置起因の顧客影響 | **本番 NUC が 3.5 時間停止**（#4275。バックアップの沈黙を防ぐ検査が原因） |
| E1 の停滞 | 初回課金失敗（2026-07-26）から **10 日、staging で 1 周できていない** |
| 1 日の虚偽報告・認識誤り | **6 回**（守るべきものが多すぎて、重要なコンテキストを取りこぼしている） |

**ルールを増やして守らせる方向は、ここで打ち切ります。** 守るべきものの量そのものが、判断能力を壊しています。

---

## §1 設計背景

### なぜこのファイルが必要か

本リポジトリは複数ロールが**別クローン・別セッション**で動く。各ロールの手順書は揃っていたが、**ロール間の境界を定義したファイルが 1 つも無かった**。

その結果、実際に次のことが起きた。

| 日付 | 出来事 | 原因 |
|---|---|---|
| 2026-08-01 | PO が backlog 12 件を自分の受信箱に入れ、1 件ずつ決裁しようとした。**着手できない状態を PO 自身が作った** | 「何から着手するかを誰が決めるか」が未定義。`dev-session.md` の「Issue 着手順」担当欄が `-` だった |
| 2026-08-01 | PO が release cut と staging deploy を Dev に指示した（どちらも監査の職掌） | 不可逆操作の担当が個別ファイルに散っていた |
| 2026-07-31 | Dev の判断待ち 2 件が PO に届かず、1 件は PR merge で流れた | 「判断を仰ぐときにどうするか」が未定義（[label-mailbox.md](label-mailbox.md) §3.1 で解決） |
| 2026-07-31 | Dev が差し戻し対応を終えたが label が `qm-blocked` のまま残り、QM に戻らず停止した | 復路が未定義（同 §3.1.1 で解決） |

**共通しているのは「手順は書いてあるが、境界が書いていない」こと。** 手順書を読んでも「これは自分の仕事か」が判定できない。

### もう 1 つの発端 — Dev が実装以外で消耗している

2026-08-01 に Dev から挙がった困りごと。

> pre-hook や CI、GitHub template に記載のことを守りながら実装もする、というのが本当に大変で、**ドキュメント漏れ・修正の取りこぼし・手落ち**が頻発している

QM がその取りこぼしを検出し、差し戻し、Dev が直す — という往復が常態化している。**Dev の努力不足ではありません。量が個人の注意力を超えています。**

実測（2026-08-01 時点）:

| 装置 | 数 |
|---|---|
| `scripts/check-*` 検査スクリプト | **58** |
| `scripts/` 全体 | 100 |
| GitHub Actions workflow | **39** |
| PR テンプレート | **102 行** |
| Issue テンプレート | 5 |
| `CLAUDE.md`（6 ファイル合計） | **1,281 行** |
| Skill 定義 | 20 |
| git hook（pre-commit / pre-push） | 2 |

**実装するたびに、この全体と整合を取ることが求められています。**

### 診断 — これは「余計な認知負荷」であって、規律の問題ではない

Team Topologies は認知負荷を 3 種に分ける。

| 種類 | 内容 | 本リポジトリでの例 |
|---|---|---|
| **内在的** (intrinsic) | 仕事そのものに必要な負荷 | Svelte 5 Runes / ドメインロジック / DSQL の制約 |
| **外在的** (extraneous) | **価値を生まない負荷**。複雑な手順・分かりにくい環境・不明瞭な内部ルール | **58 の検査 / 39 の workflow / 1,281 行の指示 / 102 行の PR テンプレート** |
| **関連的** (germane) | より良い解を探す負荷 | 設計判断・OSS 選定 |

**外在的負荷は減らすべきもので、頑張って耐えるものではありません。** そして減らす責任を負っている人が、本リポジトリには**居ませんでした**。

- PO は gate の**方針**を決める（判断原則 v2）が、Dev の作業感には触れない
- QM は取りこぼしを**検出**するが、装置そのものは直さない
- 監査は装置の**穴**を見つけるが、使い勝手は見ない
- Dev は装置を**実装**するが、自分の負荷を減らす時間を backlog に確保できない

**誰の仕事でもなかったため、装置は増える一方でした。** これを引き受けるロールを §3.4 で新設する。

### PO 自身が塞いでいた経路

`po-session.md` の起票基準は、**装置起因（CI gate / hook / PR body 検査 / テンプレート整合 / script 自身の不具合）を PR コメント止まりにし Issue 化しない**と定めている。装置を守る装置が増える連鎖を止めるためで、意図は正しい。

**しかし副作用として、Dev の「装置がつらい」が backlog に載る経路が塞がれていました。** 同じ規律は「装置に対する処方は**削減**」とも書いており、**削減は本来この規律が推奨するもの**である。区別を §4.5 で明文化する。

### なぜ「スプリントゼロ」と呼ばないか

本ファイルは体制を立ち上げる資料だが、**「Sprint Zero」という名前は使わない**。

Scrum Guide は Sprint Zero に言及しておらず、Scrum.org は「価値を出さない準備専用スプリントは**偽のスプリント**であり、経験的プロセス制御を弱める」「**特定のスプリントだけ特別ルールを持つ前例**を作る」と批判している。一方で、**チーム憲章 / ワーキングアグリーメント（規範とルールの明文化）は正当な事前作業**として認められている。

本ファイルはその**チーム憲章**にあたる。特別なスプリントを設けるのではなく、**恒常的に参照されるルール**として置く。

---

## §2 設計原則

1. **境界は「手順」ではなく「決定権」で引く**。誰が何をやるかではなく、**誰が何を決めるか**を定める（同じ作業でも決める人が違えば別の仕事）
2. **役割は Scrum の 3 責任に対応づけ、逸脱は逸脱として明示する**。本リポジトリ固有の事情（AI エージェント運用 / 作成者 ≠ 承認者）による追加ロールは、Scrum に無いことを認めたうえで理由を書く
3. **統制は gate ではなく道の性質にする**。プラットフォームエンジニアリングの原則「**governance stops being a gate and becomes a property of the path**」を採る。**思い出して満たすもの**を減らし、**既定で満たされているもの**を増やす（§3.4）
4. **渡し方は 1 つに固定する**（[label-mailbox.md](label-mailbox.md) の `state:*` label）。mention もコメントも通知経路ではない
5. **迷ったら止めて渡す**。自分の職掌か判断できないものを進めない。判断を仰ぐこと自体は誰でもできる（§5.2）

---

## §3 体制

### §3.1 全体図

```
                          ┌───────────────┐
                          │    オーナー     │  不可逆 4 操作の最終決裁
                          │  （人間 1 名）  │  ＋ ロール間の中継（暫定）
                          └───────┬───────┘
                                  │ state:needs-owner
      ┌───────────────────────────┼───────────────────────┐
      │                           │                       │
┌─────▼─────┐             ┌───────▼───────┐       ┌───────▼───────┐
│    PO     │             │      QM       │       │     監査       │
│           │             │               │       │               │
│ 何を作るか  │             │ 出してよいか   │       │ 出荷してよいか  │
│ 順序は     │             │（個別 PR gate）│       │（統合 gate/cut）│
└─────┬─────┘             └───────▲───────┘       └───────▲───────┘
      │ needs-dev                 │ dev-done              │ needs-audit
      │                           │                       │
      │                  ┌────────┴────────┐              │
      └─────────────────▶│      Dev        │──────────────┘
                         │                 │
                         │ どう作るか       │
                         │ いつ誰がやるか   │
                         └────────▲────────┘
                                  │ 道を舗装して渡す
                         ┌────────┴────────┐
                         │  プラットフォーム  │  Dev を顧客とする
                         │    （§3.4）      │  装置の削減と自動生成
                         └─────────────────┘

  クローン: ganbari-quest-{po, dev, qa, audit, platform}
```

**各クローンは互いを知らない。** 受け渡しはすべて GitHub の `state:*` label を経由する（[label-mailbox.md](label-mailbox.md)）。

### §3.2 Scrum の 3 責任との対応

Scrum Guide の定義（原文）と、本リポジトリのロールの対応。

| Scrum の定義 | 本リポジトリ |
|---|---|
| "The Product Owner is accountable for **maximizing the value of the product**" | **PO** |
| "The Product Owner is also accountable for effective Product Backlog management, which includes... **Ordering Product Backlog items**" | **PO**（§4.1） |
| "Through discussion with the Product Owner, **the Developers select items from the Product Backlog** to include in the current Sprint" | **Dev**（開発リーダーとして選択する） |
| "**No one else tells them how** to turn Product Backlog items into Increments of value" | **Dev**（PO は「どう作るか」に指示を出さない） |
| "They are **self-managing**, meaning they internally decide **who does what, when, and how**" | **Dev**（teammate 構成 / 直列並列 / 着手順は Dev の内部判断） |

### §3.2.1 Scrum は階層を持たない — lead / teammate は組織階層ではない

> "**Within a Scrum Team, there are no sub-teams or hierarchies.**"（Scrum Guide）

**組織図に「リーダーとメンバー」の二層を描いていないのは、意図的です。** Scrum は 3 つの責任を定めるだけで、チーム内部に階層を作りません。

一方で、本リポジトリには実際に lead / teammate の二層があります（[agent-teams.md](agent-teams.md)）。**これは組織階層ではなく技術構造です。**

- teammate は **lead の作業ディレクトリと gh 認証で動く**ため、独立した責任主体になれない（§3.1 でロールを跨いだ team を禁じているのと同じ理由）
- **lead が出力を検収しない限り、成果物として成立しない**。teammate は数値・Issue 番号を推測で埋めることがあり、実際に事故が起きている（[agent-teams.md](agent-teams.md) §4.3 ⑨）

したがって **teammate は「部下」ではなく「lead が使う道具」**に近い。**責任は常に lead 側にあり、teammate に委譲されません。**

**Definition of Done も lead が負う。** 「teammate がそう報告した」は、AC 充足の根拠になりません。

### §3.3 Scrum からの逸脱（意図的なもの）

**逸脱していること自体は問題ではない。逸脱を自覚していないことが問題になる。**

| 逸脱 | 内容 | 理由 |
|---|---|---|
| **QM / 監査という gate ロールがある** | Scrum に品質ゲート役は無い（Developers が Definition of Done に責任を持つ） | **ADR-0022 作成者 ≠ 承認者**。AI エージェントは自分の成果物を自分で承認しがちで、実際に繰り返し起きた。gh アカウント分離（`ganbariquestsupport-lab`）で機械的に分けている |
| **Scrum Master が居ない** | 阻害要因の除去・プロセス改善・情報の橋渡しを担う役が不在 | **その仕事をオーナーが手作業で担っていた**。§3.4 のプラットフォームロールが**装置面の阻害要因除去**を引き取る。**人的な中継は引き続きオーナー**（§6） |
| **Sprint が無い** | 時間箱で区切らず、release は監査の cut で切る | 個人開発 Pre-PMF（ADR-0010）で、時間箱より **1 日 1 回の統合 gate** の方が実態に合う。[branch-strategy.md](branch-strategy.md) |
| **Product Backlog が 1 本でない** | GitHub Issue の open 全体が backlog にあたるが、EPIC / 単発が混在 | 整理が追いついていない。§6 の課題 |

### §3.4 プラットフォーム（開発基盤）— 新設ロール

**Team Topologies の platform team にあたる。** stream-aligned team（= Dev）の**外在的認知負荷を下げること**だけを目的とし、**Dev を顧客として扱う**。

**置き場所は 5 つ目のクローン `ganbari-quest-platform`**（2026-08-01 オーナー決定）。label は `state:needs-platform`、作業手順は [platform-session.md](platform-session.md)。

#### 目的

**Dev が「思い出して満たす」ものを減らし、「既定で満たされている」ものを増やす。**

プラットフォームエンジニアリングの golden path（Spotify） / paved road（Netflix）の考え方を採る。準拠はテンプレートと自動生成に埋め込まれ、**道を通れば既定で満たされている**状態を目指す。

#### 職掌

| 持つ | 持たない |
|---|---|
| `scripts/`（58 の検査を含む）の**削減・統合・自動生成化** | **gate の方針**（残す / 消すの判断原則 → PO、§4.5） |
| `.github/workflows/` / Issue・PR テンプレートの**簡素化** | 製品コードの実装（→ Dev） |
| `.husky/` hook の実行時間と失敗メッセージの**質** | 自分の PR の approve / merge（→ QM。ADR-0022） |
| `.claude/skills/` の整備（`dev-open-pr` のような**代行**を増やす） | 不可逆 4 操作（→ オーナー） |
| `CLAUDE.md` 群 1,281 行の**削減**（読まれない指示は無いのと同じ） | release cut / deploy（→ 監査） |

#### 憲章 — 3 つの制約

1. **装置の総数は ratchet。増やせない。** 新しい検査を入れるなら、**同じ PR で既存を 1 本以上減らす**（ADR の 1-in-1-out と同型）。数は本ファイル §1 の実測表を更新して示す。**ratchet が縛るのは「新しい検査の追加」だけで、置換・統合は増加に当たらない**（2026-08-02、#4199 で明確化）— 散在した同じ記述を SSOT 1 本に寄せる作業は行数がほぼ変わらず、減らす原資を必要としない。この区別が無いと**制約が正しい作業を止める**
2. **「直す」より「消す」「生成する」を先に検討する。** `po-session.md` の「装置に対する処方は削減」と同じ。検査を足して人に守らせるのではなく、**守らなくてよい形にする**
3. **成功指標は Dev の手戻り。** 装置の本数でも CI の緑でもない。**QM の差し戻し件数 / `pre-ready` の落ち回数 / PR の往復回数**を計測し、下がったかで評価する

#### なぜ Dev や QM に持たせないか

| 候補 | 却下理由 |
|---|---|
| Dev が持つ | **自分の負荷を減らす時間を、自分の backlog に確保できない**のが現状の問題。同じ人が両方持つと、常に実装が優先され装置は後回しになる（実際にそうなっている） |
| QM が持つ | **検査する側が検査装置を作ると、作成者 ≠ 承認者が崩れる**（ADR-0022）。監査が test を書いて 3 往復した #4171 と同じ構図 |
| PO が持つ | PO は**方針**の決定者であり、実装しない。gate 方針（判断原則 v2）は引き続き PO（§4.5） |

---

## §4 決定権（DACI）

「誰がやるか」ではなく「**誰が決めるか**」の表。実行の分担は各ロールファイルにある。

- **D (Driver)** = 案を作り、決定を前に進める人
- **A (Approver)** = 決める人。**1 つの決定に 1 人**
- **C (Contributor)** = 意見を求められる人
- **I (Informed)** = 決まった後に知らされる人

### §4.1 プロダクトに関する決定

| 決定 | D | **A** | C | I |
|---|---|---|---|---|
| やるか / やらないか（事業価値・Pre-PMF バケット） | PO | **PO** | Dev | QM |
| `priority` ラベル（critical / high / medium / low） | PO | **PO** | Dev | QM |
| **backlog の順序**（何が次に価値が高いか） | PO | **PO** | Dev | — |
| Issue の AC（何をもって完了とするか） | PO | **PO** | Dev / QM | — |
| 顧客に見える文言・UX の方針 | PO | **PO** | Dev | — |
| 価格・課金の方針 | PO | **オーナー** | — | Dev / QM |

> **PO は順序を決めるが、着手そのものは管理しない。** Scrum の "Ordering Product Backlog items" は「**どれが次に価値が高いか**」であって、「**いつ誰が何本並行でやるか**」ではない。後者は Dev（§4.2）。

### §4.2 実装に関する決定

| 決定 | D | **A** | C | I |
|---|---|---|---|---|
| **何を今のレーンに取り込むか**（backlog 上位からの選択） | Dev | **Dev** | PO | — |
| **着手順・WIP 配分・レーン割当** | Dev | **Dev** | — | PO |
| 直列 / 並列、teammate 構成、誰に振るか | Dev | **Dev** | — | — |
| 設計・実装方式・使う OSS | Dev | **Dev** | PO（Pre-PMF 判断） | QM |
| 新テーブル / 新 interface / セキュリティ機能 / 課金変更 / AWS リソース追加 / 3 人日以上 | Dev | **PO** | — | QM |
| test をどう書くか | Dev | **Dev** | QM | — |

> **PO が「これを先にやって」と個別に指示しない。** 順序は §4.1 の backlog 順で伝わっており、そこから何を取るかは Dev が決める。PO が個別指示を始めると Dev の self-management が消え、**PO がボトルネックになる**（2026-08-01 に実際に起きた）。

### §4.3 品質・出荷に関する決定

| 決定 | D | **A** | C | I |
|---|---|---|---|---|
| 個別 PR を merge してよいか | QM | **QM** | Dev | PO |
| BLOCK 3 類型に該当するか（顧客に実害 / 証跡の真正性 / 不可逆） | QM | **QM** | Dev | PO |
| develop → main 統合 PR の可否 | 監査 | **監査** | QM | PO |
| **release cut** | 監査 | **監査** | — | PO / Dev |
| **staging / 本番 deploy** | 監査 | **オーナー** | — | 全員 |

> **release cut と staging deploy は監査の職掌で、PO も Dev も実行しない。** staging deploy は release run の一部であり、**単独で切り出せない**（[audit-team.md](audit-team.md) §3.8）。

### §4.4 不可逆 4 操作 — **常にオーナー**

| 操作 | 例 |
|---|---|
| **削除** | **本番データ**の削除（`gate` / `guard` / `test` の削除は**対象外** — §4.5） |
| **本番 deploy** | AWS / NUC への反映 |
| **課金書込** | Stripe の price / subscription 変更 |
| **スキーマ変更** | DB migration |

**気づいた人が誰でも `state:needs-owner` を付ける。** 「自分の職掌ではない」ではなく「**この操作が含まれる**」で判定する。

### §4.5 装置（開発基盤）に関する決定

**§0 ルール 1 が SSOT です。** 増やす・良くするは止め、**A（削減）/ B（リリースプロセスへ移管）だけを進めます**。

- **装置を増やす / 直す Issue は起票しない**（PR コメント止まり）
- **A / B の削減・移管は Platform の唯一の仕事**。判定基準は §0
- **例外**（顧客の金かデータに現に届いている装置不具合）の判定は **QM**。PO 決裁は要らない

**本番データの削除は引き続きオーナー**（§4.4）。装置と顧客データを混ぜません。

---

## §5 コミュニケーション

### §5.1 渡し方は label のみ

**SSOT**: [label-mailbox.md](label-mailbox.md)

```
PO ──state:needs-dev──▶ Dev ──state:dev-done──▶ QM ──state:ready-to-merge──▶ (merge)
                         ▲                       │
                         └──state:qm-blocked─────┘

誰でも ──state:needs-qm──▶ QM        （**問い合わせ・見解確認**。完成していなくても送れる）
誰でも ──state:needs-audit──▶ 監査    （cut 依頼 / 問い合わせ）
誰でも ──state:needs-po──▶ PO        （不可逆 4 操作**以外**の判断）
誰でも ──state:needs-owner──▶ オーナー （不可逆 4 操作）
```

**宛先 label（6 ロール分）は「誰に用があるか」だけを表し、用件を含意しない。** 何の用かは Issue / PR のコメントに書く。工程 label（`dev-done` / `qm-blocked` / `ready-to-merge`）だけが前提条件（実装完了・BLOCK 判定・approve 済）を含意する（#4180、[label-mailbox.md](label-mailbox.md) §3.1）。

**守るべきことは 3 つだけ。**

1. **`@mention` / コメント / PR body は通知経路ではない。** 各ロールは label を polling しており、本文を読みに行かない
2. **`state:*` を外すときは必ず次を付ける。** どれも付かないと全受信箱から消え、「空」と「滞留」が見分けられなくなる
3. **受け取った側は、対応が終わったら次の state に移す**（復路。[label-mailbox.md](label-mailbox.md) §3.1.1 の遷移表）

> **Platform には `state:needs-platform` で渡す。** 復路（Platform が対応を終えたら何に移すか）は [label-mailbox.md](label-mailbox.md) §3.1.1 の遷移表。
>
> **問い合わせは往復である。** `state:needs-qm` に答えたら**問い合わせ元の state に戻す**。戻さないと送り手は「返ってこない」だけを観測する。**どのロールからどのロールへ渡せるか**の全数は [label-mailbox.md §3.3.1 経路マトリクス](label-mailbox.md)（空欄 = 経路の欠落）。

### §5.2 判断を仰ぐとき

**「不可逆 4 操作に当たらないから label を付けない」で終わらせない。** それは判断が要らないという意味ではなく、`state:needs-po` がその受け皿。

| 種類 | label |
|---|---|
| **本番データ**の削除 / 本番 deploy / 課金書込 / スキーマ変更を含む | `state:needs-owner` |
| gate / guard / test の削除 | **`state:needs-po`**（方針）→ 実行は通常の PR + QM レビュー（§4.5） |
| 方針 / 優先度 / repo 設定 / 受容判断 / 語彙・ルールの改訂 | `state:needs-po` |

### §5.3 1 ロール内の並列化

**SSOT**: [agent-teams.md](agent-teams.md)

teammate は**自分のクローン内でだけ**組む。**ロールを跨いだ team は組まない** — teammate は lead の作業ディレクトリと gh 認証で動くため、ADR-0022 の作成者 ≠ 承認者が空洞化する。

**重い検証の並列化には使えない**（`heavy` lock はマシン全体で 1 本、[agent-concurrency.md](agent-concurrency.md)）。

---

## §6 未解決の課題

**この憲章で解けていないことを明示する。** 解けたと書くと、次に困った人が原因を探せなくなる。

| 課題 | 現状 | 影響 |
|---|---|---|
| **Scrum Master 相当の人的部分が不在** | 装置面の阻害要因は §3.4 が引き取るが、**ロール間の中継と判断の橋渡しはオーナーのまま**。クローンが 5 つに増えた分、中継の量も増える | オーナー不在の間、レーンが止まる |
| **Product Backlog が整理されていない** | open Issue に EPIC / 単発 / 装置起因が混在し、順序が付いていない | PO が「次に何が価値が高いか」を示せず、Dev が上から取れない |
| **Definition of Done がロールごとに散っている** | ADR-0004 / ADR-0060 / `pre-ready` / 各 CLAUDE.md に分散 | 「完了」の意味が揃わない。ADR-0060 の 10 項目検証義務が事実上の DoD だが、そう呼ばれていない |
| **手戻りの実測値が無い** | §3.4 の成功指標（差し戻し件数 / `pre-ready` の落ち回数 / PR 往復回数）を**まだ測っていない** | 改善したかを事実で言えない。**最初にやるのは計測** |

**これらを解くのは本ファイルの改訂ではなく、個別の Issue。** 気づいた人が `state:needs-po` を付けて起票する。

---

## §7 関連ファイル

| ファイル | 役割 |
|---|---|
| [po-session.md](po-session.md) | PO の作業手順（Issue 起票 / LP レビュー / 優先度判断） |
| [dev-session.md](dev-session.md) | Dev の作業手順（実装 / CI/CD / 設計書同期） |
| [qm-session.md](qm-session.md) | QM の作業手順（PR レビュー / 品質ゲート） |
| [audit-team.md](audit-team.md) | 監査の役割定義（統合 gate / release cut） |
| [platform-session.md](platform-session.md) | Platform の作業手順（装置の削減 / 統合 / 自動生成） |
| [clone-setup.md](clone-setup.md) | **クローンの立ち上げ手順**（Node 要件 / `npm ci` 2 段 / gh アカウント / ロール別の起動プロンプトと cron 分） |
| [label-mailbox.md](label-mailbox.md) | ロール間の受け渡し（`state:*` label） |
| [agent-teams.md](agent-teams.md) | 1 ロール内の並列化 |
| [agent-concurrency.md](agent-concurrency.md) | 重い検証の排他（`heavy` lock） |
| [branch-strategy.md](branch-strategy.md) | ブランチ戦略（develop 二層 + gate 二層） |
| [webui-review-process.md](webui-review-process.md) | WebUI レビュー & 改善プロセス |
| [dev-process/README.md](dev-process/README.md) | 開発プロセス運用知の各論 |

**出典**（§1 診断 / §2 原則 3 / §3.2 / §3.4 の根拠）:
[Scrum Guide](https://scrumguides.org/scrum-guide.html) ｜
[Scrubbing Sprint Zero (Scrum.org)](https://www.scrum.org/resources/blog/scrubbing-sprint-zero) ｜
[The Truth About Sprint Zero (Scrum.org)](https://www.scrum.org/resources/blog/truth-about-sprint-zero-and-why-ken-hates-it) ｜
[Team Topologies — Platform Engineering](https://teamtopologies.com/platform-engineering) ｜
[What are golden paths (platformengineering.org)](https://platformengineering.org/blog/what-are-golden-paths-a-guide-to-streamlining-developer-workflows) ｜
[RACI vs DACI vs RAPID](https://routine.co/blog/posts/raci-daci-rapid-decision-framework)
