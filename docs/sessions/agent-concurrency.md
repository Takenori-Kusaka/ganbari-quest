# エージェント並行実行 SSOT — セッション分離と排他

> **このファイルの位置づけ**: 本リポジトリを触る AI エージェントが**同一マシンで複数セッション並走**することを前提に、何が壊れるか・何を機械強制しているか・止められたとき何をするかを定める SSOT。
>
> **関連**: [dev-session.md](dev-session.md) / [qa-session.md](qa-session.md) / [audit-team.md](audit-team.md) / [branch-strategy.md](branch-strategy.md) §3

## §1 前提 — セッションは 1 本ではない

本リポジトリの開発は [Buzz](https://github.com/block/buzz) 上の複数エージェント (Dev / QM / PO / 監査) が担う。ここで押さえるべきは **1 エージェント = 1 セッションではない**ことである。

- Buzz は**チャンネルごとに ACP セッションを作る**。同じ Dev エージェントでも、参加しているチャンネルの数だけセッションが並走しうる
- セッションは互いの存在を知らない。共有しているのは**同じマシンと同じ checkout 群**だけ
- セッションはエラー / idle timeout / 接続断で入れ替わる。前のセッションの記憶は引き継がれない

つまり「自分が 1 本だけ動いている」という前提は成り立たない。**自制では調整できない** — 自分の残存プロセスは片付けられても、他セッションのプロセスは kill できない (相手が引用しようとしている証跡を壊す破壊的操作にあたる)。

## §2 何が壊れたか (実測)

| 日時 | 事象 | 影響 |
|---|---|---|
| 2026-07-26 19:55 | 同一 worktree を 2 セッションが相互上書き | 作業消失 |
| 2026-07-26 | `pre-ready --pr 3996` が **2 本**同時起動 | 片方は必ず捨てられる純粋な無駄 |
| 2026-07-27 | 重い検証が **8 本**並走 (pre-ready ×4 / vitest ×4) | 全員の結果が汚染 |
| 2026-07-27 | 単独 17 分の全ユニットが並走時 **29 分**、`Test timed out in 5000ms` が 5 件 (assertion failure 0 件) | **負荷が偽の red を作る** |
| 2026-07-27 | 別セッションとの二重作業を恐れて着手が停止 | 進行が止まる |

並走の害は「遅くなる」ではない。**結果そのものが根拠として使えなくなる**ことである。落ちても通っても、それが実装のせいなのか負荷のせいなのか切り分けられない。この汚染された結果を引用すると誤診が下流へ伝播する。

## §3 機械強制している排他

### §3.1 lock の実体

| | |
|---|---|
| 置き場 | `~/.buzz/.locks/<key>.lock` (**repo の外**。checkout / worktree が複数あっても同じマシンなら同じ lock を見る) |
| 実装 | [`scripts/lib/agent-lock.mjs`](../../scripts/lib/agent-lock.mjs) (lock 実体) / [`scripts/lib/agent-lock-policy.mjs`](../../scripts/lib/agent-lock-policy.mjs) (対象コマンド判定) / [`scripts/lib/session-owner.mjs`](../../scripts/lib/session-owner.mjs) (持ち主プロセスの解決) |
| 強制点 | `PreToolUse` hook [`.claude/hooks/heavy-run-lock.mjs`](../../.claude/hooks/heavy-run-lock.mjs) / 解放は `PostToolUse` [`heavy-run-unlock.mjs`](../../.claude/hooks/heavy-run-unlock.mjs) |
| 環境変数 | `AGENT_LOCK_DIR` で置き場を差し替え可 (テスト用) |

| key | 対象 | 粒度 | TTL |
|---|---|---|---|
| `heavy` | `pre-ready` / `vitest` / `playwright test` / `svelte-check` / `npm run test\|check\|e2e` | **マシン全体で 1 本** | 60 分 |
| `task-<Issue番号>` | `git push` (branch 名から Issue 番号を導出) | Issue 単位 | 4 時間 |

### §3.2 保持者の同一性と生存判定

**同一性と生存判定で別の値を使う** (Issue #4013 の修正)。さらに **lock の寿命は保護対象プロセスに紐づく** (Issue #4083)。

| 役割 | 使う値 |
|---|---|
| 同一性 (再入・解放の照合) | hook payload の `session_id`。無ければ `ownerPid` にフォールバック |
| 生存判定 (セッション断の回収) | `ownerPid` = 祖先を辿って得た**セッションプロセス** |
| **寿命 (走行中の保護)** | `guardedPids` = **自セッションが起動した検証プロセス**。1 つでも「生存 **かつ** 今も重い検証」なら lock は失効しない (`ownerPid` の死亡・TTL 超過より優先) |

`guardedPids` には 2 つの制約がある。どちらも「止め続ける」と「無関係を巻き込まない」を両立させるために要る。

| 制約 | 何を防ぐか |
|---|---|
| **範囲は自セッションの系列に限る** (`buildGuardedPids`) | マシン全体の heavy を書き込むと、別クローンのセッション / hook を読み込まない Buzz セッション / 人間の `vitest --watch` / オーファンまで自分の lock に入り、**自分の検証が終わっているのに lock が返らず、TTL でも回収されない**。「無関係を止める」の再導入になる |
| **生存確認だけで「生きている」と読まない** (`createHeavyPidVerifier`) | Windows は PID を早く再利用する。記録した PID が別プロセスに再割当されると、`ownerPid` 死亡でも TTL 超過でも**二度と stale にならない**。プロセス表は hook 内で取得済みなので cmdline まで検証する。**表が取れないときは検証を渡さない** (全部「重くない」に倒れて奪う方向に緩むため) |

#### 排他は「lock ファイルの有無」ではなく「プロセスの実在」で判定する (#4083)

検証は detach したバックグラウンドプロセスとして走るため、**起動元セッションが先に落ちても走り続ける**。lock の寿命をセッションに紐づけていると、「走っているのに lock が無い」時間帯が生まれ、第三者が BLOCK されずに並列で検証を始められる (2026-07-29 21:11 起動の `pre-ready --pr 4081` が生存中に lock が無く、21:18 に 2 本目が開始 = 両方の結果が根拠として使えなくなった)。

判定は 1 つの規則にまとめてある。**「保護対象プロセスが実在するか」**だけを見る。

| 状況 | 判定 | 根拠 |
|---|---|---|
| lock が**無い** + 検証プロセスが**走っている** | **BLOCK** | `heavy-run-lock` が `snapshotProcesses()` を見て並走を止める (#4083 AC2) |
| lock が**有る** + 保護対象が**走っている** | **BLOCK** (持ち主が死んでいても / TTL 超過でも) | `isStale` が `guardedPids` の生存を最優先で見る (#4083 AC1) |
| lock が**有る** + 保護対象も持ち主も**死んでいる** | **奪える** (stale) | #4083 AC3 = #4069 AC3。同一判定で両方向を満たす |

`PostToolUse` (解放) も同じ規則で動く。Bash tool が終わっても検証プロセスが残っていれば **解放せず**、その PID を `guardedPids` に書き戻す。

#### 判定の入力は実行文脈ではなく対象そのもの (#4071 / #4076)

| 判定 | 入力 | 入力にしないもの |
|---|---|---|
| 重い検証か (`heavy`) | 実行される**先頭コマンド + サブコマンド**の構造 (`npm run <script>` / `npx <bin>` / `node <script>`)。シェル (`bash -c "…"`) は中身を再帰判定 | コマンド文字列の部分一致。引数・パス・引用符の中の出現は**実行ではない** |
| どの branch の作業か (`task-<n>`) | **push refspec** (`git push origin fix/3980-…`)。無ければ `git -C` / `cd` で解決した**コマンドの実行先**の HEAD | hook プロセス / セッションの cwd (worktree 併用時にメインクローンの branch を見てしまう) |

**どちらの根拠も無い形 (`git push` 単独 / `git push -u origin HEAD`) では task lock を取らない。** hook payload の `cwd` はセッションの作業ディレクトリで、Bash tool が前の呼び出しの `cd` を引き継いでいても反映されない。そこから導いた branch は「押す先」ではないので、掴む lock は二重作業を 1 件も防がず、**無関係な branch を BLOCK するだけ**になる (#4076 の実害そのもの)。判定できないときは黙って代用せず、stderr で `git push origin <branch>` の形を促す。

いずれも「実行しない・触らないものを止めない」ためであって、**実行するものは引き続き止まる**。前置き (`echo x && npx vitest`) やシェル経由 (`bash -c "npx vitest"`) では回避できない。

- 持ち主のプロセスが死んでいれば lock は stale として**奪える**。Buzz のセッション断で lock が残り続けることはない
- TTL は「プロセスは生きているが処理が終わらない」場合の保険であり、生存判定の代替ではない
- 同じセッションからの再取得は成功する (再入可能)
- **持ち主 PID を解決できなかった場合は `ownerPid: null` を記録し、生存判定を行わず TTL のみで判定する。** 解決の経路は lock ファイルの `ownerVia` に、辿った祖先 PID 列は `chain` に残るので、実環境で意図どおりのプロセスを掴めているかは lock を読めば分かる

#### lock ファイルの中身は信用しない (読み出し時に検証する)

lock ファイルは `~/.buzz/.locks/` にあり **同一マシンの任意のプロセスが書ける**。「本 module が唯一の書き手」という前提は保証されていないので、`readLock` は読み出し時にフィールドを検証する。JSDoc の型 cast は runtime の保証にならない。

壊れた値の落とし先はフィールドごとに違う。判断軸は「**奪う方向に倒れないか**」である。

| フィールド | 壊れていたら | なぜ |
|---|---|---|
| `ownerPid` | `null` に落とす | `null` は「解決できなかった」という**設計上の正当な状態**。以降 TTL のみで判定する。「死んでいる」と読んで奪うと排他が消える |
| `startedAt` | **例外 (= block)** | TTL 判定の基準時刻。安全な既定値が無い。`0` に落とすと即 stale 扱いで生きた lock を奪う |
| `ttlMs` | 既定 (1 時間) | 回収が遅れるだけで、奪う方向には効かない |
| `chain` | 1 要素でも不正なら**配列ごと** `null` | 半分だけ正しい証跡は誤読の元。証跡は「正しいか、無いか」のどちらかにする |
| `sessionId` ほか | `null` に落とす | 同一性が取れず再入・解放が no-op になる = TTL まで誰も取れない。fail closed 側 |

**回収されるまでの時間はフィールドによって違う。ここを一律に書くと、実際より強い保証を約束することになる。**

- `ownerPid` / `ttlMs` / `chain` / `sessionId` の破損 → **最大 1 時間 (既定 TTL) で自動回収される**。読み出しは成功し、TTL 判定に入るため
- `startedAt` の破損 → **自動回収されない。手で消すまで恒久的に block する**。`readLock` が throw し、`acquire` / `release` はこれを try/catch していない (`scripts/lib/agent-lock.mjs`) ので、hook の `main().catch` が exit 2 に倒す。TTL 判定に到達しない

どちらの場合も、hook の block メッセージが `~/.buzz/.locks/` の確認と削除を案内する。急ぐ場合は該当ファイルを手で消す。

#### なぜ `process.ppid` を使わないか (#4013)

当初は持ち主を `process.ppid` の 1 値で表していたが、**hook の親プロセスは短命**である。

```
buzz-acp.exe                          ← 全セッション共有。持ち主にすると排他が消える
  buzz-acp.exe → cmd.exe
    node.exe @agentclientprotocol/claude-agent-acp   ← セッションごとに 1 個・常駐 = 持ち主
      claude.exe (複数・後から増える)
        bash → bash → node (hook)     ← process.ppid はこの辺り。呼び出しごとに変わる
```

2026-07-27 の実測では、同一 `session_id` の lock 5 本がすべて別の `ownerPid` を記録し、取得の 1 分後には全て死亡していた。結果として

- 再入判定 (`ownerPid` 一致) が効かない
- `release` が持ち主不一致で常に no-op になり lock ファイルが残り続ける
- `isProcessAlive(ownerPid)` が常に false を返し、lock が取得直後から stale になる

の三重の破綻が同時に起きており、**排他はまったく成立していなかった**。「hook が入っている」ことと「排他が効いている」ことは別である。

### §3.3 判定できないときは通さない (fail closed)

lock ディレクトリが読めない、lock ファイルが壊れている等、**排他が成立しているか判定できない**状態では block する。「判定できない」まま重い検証を走らせると汚染された結果を根拠に使ってしまうためである。

`PreToolUse` は **exit 2 のみが block** で、exit 1 は tool 実行が継続する (= 素通し)。本 hook は全経路を try/catch で囲み、想定外の例外も exit 2 に倒す。これは Issue #3999 で `gate-approve.mjs` が踏んだ失敗モードと同一 class である。

なお `PostToolUse` 側 (解放) は block しない。実行が終わった後に止めても益がなく、解放漏れは生存判定と TTL が回収する。**正しさの担保は lock 側にあり、解放 hook は早期返却の最適化**である。

## §4 止められたときにすること

**待たない。** 待機で turn を潰さず、別の作業に移る。

1. チャンネルに「他セッションが重い検証中のため見送った」と報告する (どの lock に当たったかを書く)
2. PR 本文整備 / Issue 起票 / レビュー対応など、マシンを占有しない作業に移る
3. CI で代替できるなら**ローカル実行を諦めて CI を正とする**。ローカル完走が必要なのは「CI に無い gate」を回すときだけ

`task-<n>` で止められた場合は二重作業である。チャンネルで担当を確認し、**どちらが進めるかを決めてから**再実行する。

## §4.1 中断後の後始末 (#4069)

中断で検証プロセスが残ったときは、**所有権単位で片付ける**。

```bash
npm run agent:cleanup              # 自分の残骸を一覧 (kill しない、既定)
npm run agent:cleanup -- --kill    # lock 保持者を除外して自分の分だけ停止
npm run agent:cleanup -- --json    # 機械可読出力
npm run agent:cleanup -- --pid <n> # 起点セッション PID を明示 (自動解決に失敗するとき)
```

対象は **自分のセッションプロセスの子孫のうち重い検証プロセスだけ**で、**lock 保持者とその子孫は常に除外**される。起点セッションを解決できない場合は「推測で kill しない」ため exit 1 で止まる。

**所有者を辿れない残骸は「⚠ 所有者を辿れない重い検証プロセス」として一覧に出るが、`--kill` でも落とさない。** ハーネス起動の検証チェーンはセッションの子孫から外れることがあり (実測)、そこで「残骸なし」とだけ表示すると見落として全 kill に手が伸びるため、**可視化はするが自動では触らない**。自分の残骸だと確信できる場合だけ、その起点 PID を `--pid <n>` に渡して再実行する。

```bash
npm run agent:cleanup                        # ① 一覧に出た「⚠ 所有者を辿れない」pid を確認
npm run agent:cleanup -- --pid <その pid> --kill   # ② その pid 自身と子孫を停止
```

`--pid <n>` は「**この PID の系列は自分のものだ**」という明示宣言として扱う。したがって

- **起点 PID 自身も対象に入る** (子孫だけではない)。入れないと、案内どおり `--pid <オーファンの pid>` を打っても当の PID は落ちず、**BLOCK されているのに解除手段が無い**状態になる
- 宣言された系列に限り、lock の `guardedPids` 由来の保護を外す。停止済みセッションの lock に guarded として記録されたオーファンを掃除できるようにするため。系列外の lock 保持者は従来どおり除外される
- `--pid` の値が数値でなければ**自動解決に落とさず exit 1**。明示引数の誤りを黙って別の起点で実行すると、指定したつもりのものと違うものが落ちる

**イメージ名一括 kill (`taskkill /F /IM node.exe` / `pkill -f node` / `killall node` / `Stop-Process -Name node`) は hook が BLOCK する**。2026-07-29 にこれが、lock を正当に保持して検証中だった別セッション (PR #4063) を巻き込んで停止させたためである。個別に落としたい場合は PID 指定 (`taskkill /F /PID <pid>`) を使う (こちらは通る)。

## §5 適用範囲と限界

- **worktree 分離は別の層**: ファイルの相互上書きは「チャンネルごとに専用 worktree を使う」ことで防ぐ。lock は**マシン資源と作業の重複**を防ぐもので、両方が要る
- **hook が効くのは Claude Code 経由の Bash のみ**: 人間が直接ターミナルで叩く分には効かない。オーナーが手で重い検証を回すときは、エージェントが動いていないことを確認する
- **hook はセッションの設定に登録されて初めて効く**: 本リポジトリの `.claude/settings.json` は **project 設定**なので、リポジトリを起動ディレクトリにしていないセッションには読み込まれない。Buzz エージェントの起動ディレクトリは `~/.buzz` であり、**`~/.buzz/.claude/settings.json` に登録しない限り本 hook は 1 度も走らない** (2026-07-27 実測: Buzz セッションから `git push` しても `task-<n>.lock` が作られなかった)。登録する場合は (a) `command` を絶対パスにする、(b) `matcher` を `"Bash|PowerShell"` にする (PowerShell tool 経由が素通りするため) の 2 点が要る
- **`gh pr merge` / `gh pr edit` は task lock の対象外**: これらは PR 番号で他人の PR を操作する role (QM / 監査) のコマンドで、自分の branch とは対応しないため。ここを排他するなら PR 単位の別 key が要る (未実装)
- **新しい重量コマンドを足したら判定の更新が要る**: 実行判定は `agent-lock-policy.mjs` (`HEAVY_NPM_SCRIPTS` / `HEAVY_BINS`)、走行中プロセスの同定は `heavy-process.mjs` (`HEAVY_PROCESS_PATTERNS`) の **2 箇所**にある (前者は「これから実行する文字列」、後者は「OS が持つ実行中プロセスの cmdline」で対象が違う)。**片方だけ足すと非対称が生まれる**: 起動は許可されるのに、走り出したら重い検証として検出されて他セッションを全部 BLOCK する。この包含関係は `heavy-run-guard.test.ts` の「起動判定と走行中判定の包含関係」で固定している
- **プロセス表の取得はコストがある**: `snapshotProcesses()` は重い検証コマンドのときだけ呼ぶ。全 Bash 呼び出しで毎回叩くと hook が遅くなる
- **プロセス表が取れなければ実在判定は行われない**: PowerShell の実行ポリシー / CIM 障害 / 高負荷時の spawn 失敗で起こりうる。この場合 hook は **block せず** lock ファイル経路だけに戻るが、「実在ベースの並走判定を行っていない」と stderr に必ず出す (無言で主防御を失わない)。表を取れないだけで全セッションを止めるのは過剰なので、ここは警告に留める
- **引用でくるんだ実行は heavy 判定を通り抜ける**: `npm run "pre-ready"` / `& "npx" vitest` のように**実行位置のトークンを引用**すると、判定は「データであって実行ではない」と読んで通す。これは `gh issue create --title "npm run pre-ready …"` を止めないための代償であり (#4071 の誤爆 3 件が実測)、意図的に回避する動機は薄いので許容している。**回避しないこと**が運用上の前提

### task lock がかからない形 (accepted residual)

`git push` 単独 / `git push -u origin HEAD` は、上記のとおり押す先を特定できないため task lock を取らない。**二重作業の検出を効かせたい場合は `git push origin <branch>` の形で押す** (実運用ではこちらが支配的)。heavy lock (マシン全体 1 本) はコマンド形に依存しないので影響を受けない。

## §6 検証

```bash
npx vitest run tests/unit/hooks/agent-lock.test.ts tests/unit/hooks/heavy-run-guard.test.ts tests/unit/hooks/heavy-run-hooks.test.ts
```

| file | 層 | 固定している不変条件 |
|---|---|---|
| `heavy-run-guard.test.ts` | lib (純関数) | #4083 / #4069 / #4071 / #4076 の 4 欠陥。実測 console 出力を fixture の実名にし、**誤爆しないこと**と**実行を止め続けること**を対で assert する |
| `heavy-run-hooks.test.ts` | **hook 本体** | stdin payload を流して exit code と lock ファイルの結果を見る。「lib は正しいが渡している引数が間違っている」class (保護対象の範囲 / プロセス表取得失敗の扱い) はこの層でしか固定できない |

hook 層のテストは、プロセス表を `AGENT_PROCESS_TABLE_FILE` (テスト専用の差し替え口) で固定する。実プロセス表を使うと**たまたま走っている別セッションの検証**で結果が変わる — それ自体が本 SSOT が扱っている欠陥なので、テストが同じ穴を踏まないようにする。lock 置き場も `AGENT_LOCK_DIR` で temp へ逃がしているため、**テスト実行が実際に並走している別セッションの lock を壊すことはない**。
