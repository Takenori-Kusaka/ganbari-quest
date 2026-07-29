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

**同一性と生存判定で別の値を使う** (Issue #4013 の修正)。

| 役割 | 使う値 |
|---|---|
| 同一性 (再入・解放の照合) | hook payload の `session_id`。無ければ `ownerPid` にフォールバック |
| 生存判定 (セッション断の回収) | `ownerPid` = 祖先を辿って得た**セッションプロセス** |

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

## §5 適用範囲と限界

- **worktree 分離は別の層**: ファイルの相互上書きは「チャンネルごとに専用 worktree を使う」ことで防ぐ。lock は**マシン資源と作業の重複**を防ぐもので、両方が要る
- **hook が効くのは Claude Code 経由の Bash のみ**: 人間が直接ターミナルで叩く分には効かない。オーナーが手で重い検証を回すときは、エージェントが動いていないことを確認する
- **hook はセッションの設定に登録されて初めて効く**: 本リポジトリの `.claude/settings.json` は **project 設定**なので、リポジトリを起動ディレクトリにしていないセッションには読み込まれない。Buzz エージェントの起動ディレクトリは `~/.buzz` であり、**`~/.buzz/.claude/settings.json` に登録しない限り本 hook は 1 度も走らない** (2026-07-27 実測: Buzz セッションから `git push` しても `task-<n>.lock` が作られなかった)。登録する場合は (a) `command` を絶対パスにする、(b) `matcher` を `"Bash|PowerShell"` にする (PowerShell tool 経由が素通りするため) の 2 点が要る
- **`gh pr merge` / `gh pr edit` は task lock の対象外**: これらは PR 番号で他人の PR を操作する role (QM / 監査) のコマンドで、自分の branch とは対応しないため。ここを排他するなら PR 単位の別 key が要る (未実装)
- **判定は文字列マッチ**: セグメント (`&&` / `;` / `|`) 単位で判定するため無害な前置きでは回避できないが、新しい重量コマンドを足したら `HEAVY_PATTERNS` の更新が要る

## §6 検証

```bash
npx vitest run tests/unit/hooks/agent-lock.test.ts
```

hook 単体の挙動 (block / 奪取 / fail closed / 解放) は上記テストで固定している。lock 置き場は `AGENT_LOCK_DIR` で temp へ逃がしているため、**テスト実行が実際に並走している別セッションの lock を壊すことはない**。
