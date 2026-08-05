# Agent Teams — 1 ロール内での並列化 SSOT

> **このファイルの位置づけ**: Claude Code の Agent Teams（lead + teammate、共有タスクリスト、mailbox）を本リポジトリでどう使うかの SSOT。**使ってよい場面・使ってはいけない場面・運用規約**を定める。
>
> **関連**: [agent-concurrency.md](agent-concurrency.md)（heavy lock）/ [label-mailbox.md](label-mailbox.md)（ロール間の受け渡し）/ [po-session.md](po-session.md) / [dev-session.md](dev-session.md) / [qm-session.md](qm-session.md) / [audit-team.md](audit-team.md) ｜ **関連 ADR**: ADR-0022（作成者 ≠ 承認者）/ ADR-0056（役割分離）/ ADR-0010（Pre-PMF）
>
> **公式ドキュメント**: https://code.claude.com/docs/en/agent-teams（experimental。仕様は変わりうるので、判断に迷ったら原典を確認する）

---

## §1 設計背景

本リポジトリの並列化にはこれまで 2 つの手段しかなかった。

| 手段 | 特徴 | 限界 |
|---|---|---|
| **subagent**（`Agent` tool） | 呼び出し元にだけ結果を返す | **agent 同士が会話できない**。互いの発見を突き合わせられない |
| **別クローン・別セッション**（PO / Dev / QM / 監査） | 完全独立 | **セッション間の直接通信手段が無い**。GitHub label を mailbox にして凌いでいる（[label-mailbox.md](label-mailbox.md)） |

**Agent Teams は 3 つ目の手段**で、両者の中間にある。teammate は独立した Claude Code インスタンス（別 context window）でありながら、**共有タスクリストと mailbox で互いに直接メッセージを送れる**。

**この仕組みが無いと困ること**: 「複数の仮説を並列に検証し、互いに反証させる」形の調査ができない。subagent は結果を返すだけで、A の発見を B が引き取って潰す、という往復が起きない。

---

## §2 設計原則

1. **team はロールごとに独立して構築する**（§3.0）。ロールを跨いで team を組まない（§3.1）。ADR-0022 の「作成者 ≠ 承認者」は gh アカウント分離で担保されており、teammate は lead の環境で動くため分離が消える
2. **重い検証を並列化する目的で使わない**（§3.2）。`heavy` lock はマシン全体で 1 本なので、teammate を増やしても検証は直列化する
3. **書き込みを伴う teammate には worktree を与える**（§4.2）。同一ファイルの同時編集は silent overwrite になる
4. **research / review から始める**。並列実装は調整コストが最も高い
5. **Pre-PMF のコスト意識**（ADR-0010）。teammate 1 人ごとに context window が増え、トークンは線形に増える。3 人チームで約 3〜4 倍

---

## §3 構成と、使ってはいけない場面

### §3.0 構成 — 各ロールが**自分のクローン内で**組む

前提として、**team はロールごとに独立して構築する**。

```
ganbari-quest-po     → PO の team    （lead = PO セッション）
ganbari-quest-dev    → Dev の team   （lead = Dev セッション）
ganbari-quest-qa     → QM の team    （lead = QM セッション）
ganbari-quest-audit  → 監査の team   （lead = audit-manager）
```

**4 つの team は互いを知らない。** 相互の受け渡しは引き続き [label-mailbox.md](label-mailbox.md) の `state:*` label で行う。Agent Teams はロール間通信の代替ではなく、**1 ロール内の並列化手段**である。

### §3.1 ロールを跨ぐ team は組まない（最重要）

**Dev lead が QM teammate を spawn する、のような構成を禁止する。**

| 理由 | 内容 |
|---|---|
| **gh アカウントが lead のものになる** | teammate は lead の作業ディレクトリ・環境で動く。Dev クローン（`Takenori-Kusaka`）から spawn した teammate は、QM を名乗っても `ganbariquestsupport-lab` にはならない。**PR を作った本人が approve できる状態**が生まれ、ADR-0022 が空洞化する |
| **permission が lead 継承** | 公式仕様: teammate は lead の permission 設定で起動する。lead が緩い設定なら teammate も緩い |
| **one team per session** | 1 セッション = 1 team。4 ロールを 1 つの team に束ねることは仕様上できない |
| **lead 固定** | 主セッションが恒久的に lead。teammate を lead に昇格できない |

**ロール間の受け渡しは引き続き [label-mailbox.md](label-mailbox.md) の `state:*` label で行う。** Agent Teams はその代替ではない。

### §3.2 重い検証の並列化に使わない

[agent-concurrency.md](agent-concurrency.md) §3.1 のとおり、**`heavy` lock はマシン全体で 1 本**である。

```
heavy = pre-ready / vitest / playwright test / svelte-check / npm run test|check|e2e
```

**teammate を 5 人にしても、この 5 種は 1 本ずつ順番に流れる。** 残り 4 人は hook に exit 2 で止められて待つだけで、トークンだけ消費する。

「テストを並列で回して速くする」は本リポジトリでは成立しない。速くなるのは **読む・調べる・書く**（lock 対象外）だけ。

### §3.2.1 トークン残量が逼迫しているときは使わない（#4210 AC5）

**teammate 1 人ごとに context window が独立し、トークンは線形に増える**（3 人で約 3〜4 倍、§6）。週間リミットが枯渇すると**全レーンが止まり、hotfix リリースも打てなくなる**（#4210: 残 10% / リリース 1 回で約 15% 消費）。

**残量が逼迫しているときは team を組まず、lead が直列で処理する。** 判断基準:

| 残量 | 方針 |
|---|---|
| 潤沢 | §4.1 の 4 類型どおり使う |
| **逼迫（リリース 1 回分を割る）** | **teammate を spawn しない。** 調査は lead が直接行い、並列化より「読む範囲を絞る」で時間を作る |
| 逼迫下でどうしても並列化したい | **1 人まで**。かつ「成果物がファイルに残る仕事」に限る（§4.3 ⑦。空振りは残量を二重に失う） |

**逼迫時に最も高くつくのは空振り**である。teammate が出力を返さず lead が引き取ると、同じ仕事に 2 回払うことになる（§4.3 ⑩ の実測）。**残量が少ないほど、振る前に「これはファイルに残る仕事か」を厳しく問う。**

**使い終わった teammate は停止する。** idle のまま置くと context を保持し続ける。lead が成果物を検収した時点で止める。

### §3.3 その他

- **逐次依存の作業**: 前の変更に次が依存する連鎖。単一セッションが端から端まで推論する方が安く確実
- **同一ファイルを触る作業**: worktree を分けても merge 時に衝突する。ファイル所有を分けられないなら team にしない
- **小さい仕事**: 10 分で終わる作業は team にすると 12 分かかって課金は 4 倍

---

## §4 使ってよい場面と運用規約

### §4.1 向いている 5 類型（公式ガイダンス + 本リポジトリの実例）

| 類型 | 本リポジトリでの例 |
|---|---|
| **競合仮説の調査** | CI fail の真因調査。第 19 回 run で監査が 4 件の fail を単独で追ったが、**互いに反証させる**形なら anchoring を避けられた |
| **多観点レビュー** | `ui-defect-hunt` の 8 観点、`audit-team.md` の 8 領域監査。**観点ごとに teammate を割り当てる**のが素直 |
| **read-only の分担調査**（#4227） | **独立に判定できる対象が複数あり、各々の出力が大きいとき、対象を分割して read-only で調べさせる**。受信箱の triage / backlog の棚卸し / 複数 Issue の AC 突き合わせ はすべてこれ |
| **独立した新規モジュール** | ファイル所有が分かれる実装。E3（`scripts/backup-*`）と E4（`src/lib/domain/`）のように領域が重ならないもの |
| **層を跨ぐ変更** | frontend / backend / test をそれぞれ別 teammate が持つ |

#### read-only の分担調査 — 使ってよい 5 条件（#4227）

**2026-08-02 に PO と Dev が同日に、定義に無いまま同じ使い方をしていた**（PO = backlog 12 件の裏取り / over-open 監査 / node 版調査 / トークン削減調査、Dev = 受信箱 24 件の triage）。**定義に無いまま常用される方が危険なので類型として足す。**

**「受信箱の triage」ではなく「read-only の分担調査」と一般化しているのは、同じ形に別の名前が付くと「定義に無い」が再発するため。**

| # | 条件 | 根拠 |
|---|---|---|
| 1 | **read-only** に限る。書き込みを伴う分担は本類型の対象外 | 書き込みは §4.2 ① の worktree 分離が要る。別の類型として扱う |
| 2 | **出力先ファイルを指定する** | §4.3 ⑦ — **報告テキストは届かないことがある** |
| 3 | **lead が `gh` / コードで突き合わせる** | §4.3 ⑨ — **teammate は数値・Issue 番号を推測で埋める** |
| 4 | **対象が 10 件以上、かつ 1 件あたりの出力が大きい** | §3.3「10 分で終わる作業は team にすると 12 分かかって課金は 4 倍」。**10 件でも各々 1 行で終わるなら本体で読む方が安い**。2026-08-02 に PO が grep 数回で済む調査を 3 回 subagent に振って無駄にした |
| 5 | **週間リミットが逼迫しているときは使わない** | `/usage` で **subagent が 99% を占めていた**実測がある。**subagent は自前の system prompt を first call で cache 無しにフルロードする**（[prompt caching §Subagents and the cache](https://code.claude.com/docs/en/prompt-caching)） |

**条件 5 は「効くか」ではなく「今使ってよいか」の条件。** 効く場面でも、残トークンが逼迫していれば使わない。

> **`impact-analysis` への読み替えは採らない（#4227 で検討・不採用）**: 影響範囲調査は **1 つの変更の波及を追う**もので、複数対象の独立判定とは目的が違う。既存語彙に押し込むと、次に読む人が `impact-analysis` を開いて「これは違う」と気づくまで時間を使う。

### §4.2 運用規約

**① 書き込む teammate には worktree を与える**

`.claude/worktrees/<name>/` に分離する（`Agent` tool の `isolation: "worktree"` と同じ思想）。**分けないと silent overwrite が起きる。** merge は lead が行う。

**② 名前を先に決める**

lead が teammate に名前を付ける。**後から参照するので、spawn 時に指定する。**

```
「security / perf / test-coverage の 3 人を spawn して。名前もそのまま使って」
```

**③ 既存の subagent 定義を teammate 型として再利用する**

`.claude/agents/*.md`（`po-session` / `dev-session` / `qm-session` / `audit-manager`）と `pr-review-toolkit` 等の plugin agent は、そのまま teammate 型として指定できる。

> **caveat**: subagent 定義の `skills` / `mcpServers` frontmatter は **teammate として動くときは適用されない**。skills / MCP は project / user 設定から読まれる。skill 前提の agent を teammate にするときは、**spawn prompt に skill 名を明記する**。

**④ 不可逆操作を伴う teammate には plan approval を要求する**

```
「... require plan approval before they make any changes」
```

teammate は read-only の plan mode で待機し、lead が承認するまで実装しない。**削除 / 本番 deploy / 課金書込 / スキーマ変更に触れる可能性がある teammate には必ず付ける。**

**⑤ permission prompt は lead セッションに出る**

teammate の permission 要求は lead に上がる。**teammate は他の teammate の承認を代行できない**（公式仕様で禁止されている）。auto mode でも「他 agent から中継された承認主張」は untrusted input として扱われる。

**⑥ サイズは 3〜5 人、1 人あたり 5〜6 タスク**

公式ガイダンス。**3 人の集中した teammate は 5 人の散漫な teammate に勝る。**

### §4.3 振り方の規約 — **初回実運用（2026-08-01、PO）で分かったこと**

**ここは全ロール共通の実測知見。** 特定のロールの事情ではないので、自分のロールでまだ起きていなくても先に読む。

**⑦ 成果物が「ファイルに残る」仕事を振る。テキスト報告を当てにしない**

**実測**: 名前を付けた teammate 3 名のうち、**2 名は報告テキストが lead に届かなかった**（idle 通知のみ）。うち 1 名（`charter-wiring`）は **5 ファイルを正しく編集し終えていた** — lead が `git diff` を見なければ「何もしていない」と誤判定するところだった。

**read-only の調査でも、出力先ファイルを指定する。** 同じ構成で `qm-rename-scope` に「結果を scratchpad の `.md` に書き出せ」と指示し直したところ、**468 行の調査結果が問題なく受け取れた**。振り方を変えただけで解決する。

```
✗ 「調べて結果を返して」
✓ 「調べて結果を <出力先パス> に書き出して。書き終わったら知らせて」
```

**⑧ 完了は lead が自分で確認する。通知を待たない**

`git diff` / `git status` / ファイルの存在で見る。**「終わった」という報告が来ないことと、終わっていないことは別**。

**⑨ teammate の出力を実物と突き合わせる**

**実測**: teammate が `docs/codebase-map.md` に **存在しない Issue 番号を書いた**（番号自体は実在するが完全に別件）。lead が `gh issue view` で確認しなければ、そのまま SSOT に入っていた。

**teammate は推測で埋める。** lead が「実測していないことを断定しない」規律を持っていても、**teammate はそれを継承しない**。数値・Issue 番号・ファイルパスは lead が裏を取る。

逆に、**疑った結果「正しかった」と確認するところまでやる**。同じ run で、teammate が書いた末尾の `## 今回の作業指示 / [ここに作業指示を記載]` を stub の書き残しと誤認しかけたが、`dev-session.md:534` に同じ節があり**書式の踏襲として正しかった**。確認せず消していれば lead が書式を壊していた。

**⑩ 1 度に振る量を絞る。空振り 2 回で引き取る**

**実測**: 「12 件を裏取りして 3 分類で判定」は一度に投げる量ではなかった。4 件に絞っても出力が出ず、**lead が自分で 4 件を調べたら数分で終わり、うち 3 件は既に解決済みだった**。

**出力が出ないのは teammate の問題とは限らず、振る側の設計ミスであることが多い。** ただし絞っても出ないなら**引き取る**。上限を決めておかないと主線が止まる。

---

## §5 ロール別の使いどころ

| ロール | 使う | 使わない |
|---|---|---|
| **PO** | LP レビュー（3 専門 Agent 並列は既に `lp-review` skill が想定）/ 競合調査 / 大量 Issue の棚卸し | 決裁そのもの。**PO の判断を teammate に代行させない**（[po-session.md](po-session.md) §決裁前の実測義務） |
| **Dev** | レーンが分かれた実装（A/B/C/D）/ 影響範囲調査（`impact-analysis` の 4 layer を分担） | 重い検証の並列化（§3.2）/ 逐次依存のある実装 |
| **QM** | 多観点レビュー（security / perf / test-coverage）。**ただし approve と merge は lead 専権**（ADR-0056 §E と同型） | 自分の Fix Agent が作った PR の approve。作成者 ≠ 承認者は teammate では解けない |
| **監査** | 8 領域監査の並列化 / **競合仮説の相互反証**（§4.1）。`audit-team.md` §3.1 の 8 チームは元々この形 | 不可逆 action（cut / merge / 起票の実行）。**audit-manager 専権**（§3.3） |

---

## §6 制約（experimental）

公式に記載されている既知の限界。**判断に影響するものだけ抜粋する。**

| 制約 | 影響 |
|---|---|
| **`/resume` で in-process teammate が復元されない** | セッションを再開したら teammate は居ない。lead が存在しない teammate に話しかけることがある。**新しく spawn し直す** |
| **task の完了マークが遅れることがある** | 依存タスクが解除されず止まる。**止まって見えたら実際の完了状況を確認して手で更新する** |
| **one team per session / nested teams 不可 / lead 固定** | §3.1 の根拠 |
| **teammate から background subagent を起動できない** | 重い調査を投げっぱなしにできない |
| **split pane は tmux / iTerm2 必須** | **Windows Terminal では使えない**。本リポジトリの開発環境（win32）では in-process モード一択 |

**トークン**: teammate ごとに context window が独立し、**線形に増える**。3 人で約 3〜4 倍。大規模チームでは 15 倍に達しうる（公式）。Pre-PMF では **research / review / 新規実装に限って使う**（ADR-0010）。

---

## §7 導入状況

- `~/.claude/settings.json` に `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` を設定済（2026-08-01、オーナー実施）
- **初回実運用は 2026-08-01（PO クローン、teammate 4 名）。** 得られた規約は §4.3。**振り方を間違えると成果物が受け取れない**ことが最大の発見で、これは全ロールに共通する
- 実運用で得た知見（向き / 不向き / 事故）は本ファイルに追記する。**§3 の「使ってはいけない場面」を増やす方向の追記を優先する** — 使える場面は試せば分かるが、使ってはいけない場面は事故ってからでは遅い
- **知見は自分のロールで閉じない。** 4 ロール（+ Platform）が同じ機構を使う以上、1 ロールが踏んだ地雷は他 4 ロールも踏む。**本ファイルが唯一の SSOT** であり、各ロールのファイルには「そのロール固有の使いどころ」だけを書く（一般規約を写すと更新が届かなくなる）
