# チーム憲章 — 誰が何を決め、誰に渡すか

> **このファイルの位置づけ**: `docs/sessions/` 配下の**入口**であり、ロール体制・決定権・コミュニケーション経路の SSOT。
> 各ロールの作業手順は個別ファイルにあり、本ファイルは**その間の境界だけ**を定める。
>
> **読む順序**: 本ファイル（体制・決定権）→ 自分のロールファイル（作業手順）→ [label-mailbox.md](label-mailbox.md)（渡し方）

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

| 決定 | D | **A** | C | I |
|---|---|---|---|---|
| gate を**残すか消すか**の方針（判断原則 v2 / 類型 1〜4） | Platform | **PO** | QM / 監査 | Dev |
| 装置を**どう減らすか・どう自動生成に置き換えるか** | Platform | **Platform** | Dev | QM |
| テンプレート・skill・hook の設計 | Platform | **Platform** | Dev | QM |
| **gate / guard / test の削除の実行** | Platform | **PO** | QM / 監査 | Dev |

> **gate / guard / test の削除はオーナー決裁ではありません**（2026-08-02 改訂）。**消すか残すかの方針が PO の Approver 事項**（上表 1 行目）である以上、**その実行だけをオーナーに上げても判断が増えるだけで、質は上がりません**。
>
> **代わりに削除 PR で次を必須にします。**
>
> - **何を守っていた検査かを 1 行で書く。** 書けないなら、それは消してよい根拠になります
> - **同じ観点を別の装置が見ているなら、その場所を示す。** 見ていないなら「**この観点は今後検査されない**」と明記する（silent に消さない）
> - **QM がレビューで確認する。** 削除も通常の PR と同じレビューを通ります（ADR-0022 作成者 ≠ 承認者）
>
> **本番データの削除は引き続きオーナー**（§4.4）。装置と顧客データを混ぜません。

#### 起票してよいもの・いけないもの

`po-session.md` の「装置起因は Issue 化しない」を、**方向で区別する**。

| 方向 | 扱い |
|---|---|
| 装置を**増やす** / 個別の不具合を**直す** | **Issue にしない**（PR コメント止まり）。装置を守る装置が増える連鎖を断つため |
| 装置を**減らす** / **統合する** / **自動生成に置き換える** | **Issue にしてよい**（Platform の backlog）。同規律の「処方は削減」に沿う |
| Dev が**繰り返し同じ取りこぼしをする** | **Issue にしてよい**。これは装置の不具合ではなく **道が舗装されていない**という現象 |

---

## §5 コミュニケーション

### §5.1 渡し方は label のみ

**SSOT**: [label-mailbox.md](label-mailbox.md)

```
PO ──state:needs-dev──▶ Dev ──state:dev-done──▶ QM ──state:ready-to-merge──▶ (merge)
                         ▲                       │
                         └──state:qm-blocked─────┘

PO ──state:needs-audit──▶ 監査
誰でも ──state:needs-po──▶ PO        （不可逆 4 操作**以外**の判断）
誰でも ──state:needs-owner──▶ オーナー （不可逆 4 操作）
```

**守るべきことは 3 つだけ。**

1. **`@mention` / コメント / PR body は通知経路ではない。** 各ロールは label を polling しており、本文を読みに行かない
2. **`state:*` を外すときは必ず次を付ける。** どれも付かないと全受信箱から消え、「空」と「滞留」が見分けられなくなる
3. **受け取った側は、対応が終わったら次の state に移す**（復路。[label-mailbox.md](label-mailbox.md) §3.1.1 の遷移表）

> **Platform には `state:needs-platform` で渡す。** 復路（Platform が対応を終えたら何に移すか）は [label-mailbox.md](label-mailbox.md) §3.1.1 の遷移表。

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
| [qa-session.md](qa-session.md) | QM の作業手順（PR レビュー / 品質ゲート） |
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
