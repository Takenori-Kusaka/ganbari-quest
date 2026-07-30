# 0056. QM Orchestrator role drift の構造的対処 (Adversarial Reviewer + PreToolUse Hook + JSON Schema 強制)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-28 |
| 起票者 | Claude Opus 4.7 (1M context) — Dev Session Agent (worktree mode) |
| 関連 Issue | #2597 (drift baseline scan) / #2590 / #2591 / #2592 |
| 関連 ADR | ADR-0010 (Pre-PMF) / ADR-0022 (admin bypass + QM Approve 体制) |
| Research SSOT | [docs/research/qm-drift-prevention-2026-05-28.md](../research/qm-drift-prevention-2026-05-28.md) |

## コンテキスト

QM Orchestrator (Claude Code session) が「顧客品質最終ゲート」役割から「BLOCK 列挙 / CI proxy」役割に drift する事象を **33 日で 42 回観測**。memory / ADR / checklist の追加 (5 回試行) は再発率を変えなかった。

drift の原因類型 (文献根拠、詳細は research SSOT §2):

1. **Persona Drift** (Wang et al. 2024): 多段会話で agent 役割が薄まり単純 executor 役に slide
2. **Echoing** (arXiv:2511.09710): Dev 主張を肯定的に echo し独立 judgment が消失
3. **Normalization of Deviance** (Vaughan 1996): 「ここまで事故ゼロ」累積経験が逸脱を許容と再定義
4. **Goodhart's Law**: 「CI 全 PASS + BLOCK 列挙」が target 化し本来の顧客 judgment が proxy された

memory / ADR で覆せない理論根拠 (詳細は research SSOT §3):
- **Sleeper Agents (Hubinger 2024)**: instruction 経由の役割強化は「演じる」能力を強化するだけで drift trigger には対処しない
- **Constitutional AI (Anthropic 2022)**: self-monitoring は target が "judgmental" な場合は精度低下。drift 中の agent は drift を否認する (identity drift の定義)
- **Lost in the Middle (Liu 2023)**: memory / ADR 量増加は context window 圧迫で重要 instruction の参照率を逆に下げる

42 回再発はこの理論群と整合する。**agent 内部の自覚に依存しない構造的対処** が必要である。

## 検討した選択肢 (OSS / 確立パターン最低 2 件、#1350)

詳細比較は research SSOT §7。

### 選択肢 A: 多 verifier / heterogeneous ensemble

- 概要: 異なる model 2 つで verifier ensemble (Comet 2024 LLM-as-Judge production guide、確立パターン)
- メリット: 単 verifier より drift 耐性高
- デメリット: API cost 2 倍 + orchestration 工数大、Pre-PMF 段階では過剰防衛 (ADR-0010)

### 選択肢 B: Adversarial Reviewer + structured JSON schema (採用)

- 概要: subagent が `must_object_count: 3` の structured output を強制、`PreToolUse` hook が schema 検証で approve 系 Bash command を物理 block
- 根拠 OSS / 既存知見: **arXiv:2511.09710** "Echoing: Identity Failures when LLM Agents Talk to Each Other" で structured response schema 強制が echoing 30-40% → <10% を実証 + Claude Code hooks 公式 spec (`permissionDecision: "deny"`) が agent 自覚に依存せず物理 block 可能
- メリット: 文献で実証済 + Pre-PMF cost 最小 (1-2 日工数) + agent 役職を剥奪せず autonomous 維持
- Pre-PMF コスト: hook 1 本 + subagent skill 1 件 + 検証 script 1 本 + unit test 1 spec で完遂 (ADR-0010 整合)

### 選択肢 C: Hard Gate + human merge (案 3)

- 概要: agent から approve action を完全剥奪し人間が最終 merge
- デメリット: PO が本日明示否定 ("agent-led / autonomous 維持")。agent 責務剥奪は解決ではない。PR 10x で human cost 線形成長

### 選択肢 D: 独自 instruction 補強

- 既試行 5 回 / 42 回再発で実証不能。Sleeper Agents 根拠で原理的に効かない (棄却)

**選定**: B を採用。理論根拠が文献実証済 + Pre-PMF cost 最小 + autonomous 維持の制約に整合する唯一の解。

## 決定

### 1. PreToolUse hook (`.claude/hooks/gate-approve.mjs`)

- **コマンド実行系ツール全経路**の matcher で `/gh pr (merge|review --approve)/i` を捕捉 (#4001)。対象ツールの SSOT は `.claude/hooks/command-execution-tools.mjs`、`.claude/settings.json` との一致は `tests/unit/hooks/command-execution-tools.test.ts` が機械検証する。`Bash` のみを対象にすると PowerShell 経由で gate 自体が起動せず bypass できる
- 判別できない入力 (stdin JSON parse 不能 / `tool_name` 欠落 / command 非文字列) は **allow ではなく block** する。SSOT 未登録ツール名で呼ばれた場合も allow に倒さず `tool_input` 内の全文字列を走査する
- `tmp/adversarial-evidence/<pr-number>.json` の **存在 + 30 分 TTL + schema 必須 field** を検証
- 不在 / TTL 切れ / schema 不正で exit 2 + stderr に修正手順 ("Adversarial Reviewer subagent を先に dispatch")
- recursive loop 防止: `CLAUDE_SUBAGENT_ID` env 設定時 (subagent context) は **読み取り専用の review 参照だけ** allow。approve mutation (`gh pr merge` / `--approve` / 非 GET の `gh api`) は subagent でも evidence gate に掛ける (#4082 R2)
- **approve 行為の識別を「PR 番号の書き方」から切り離す** (#4057): `pulls/<ref>/{reviews,merge}` は ref の形 (`4002` / `$n` / `$(…)`) を問わず approve 行為として捕捉し、**番号が確定できないなら block** する。番号は全件抽出し、1 コマンドが複数 PR を叩く形では全 PR の evidence を要求する
- **検証対象 PR は「実際に叩かれる invocation」からのみ確定する** (#4095): 番号は同一 `gh` invocation の argv / API パスから取り、コマンド全体の走査はしない。確定不能な hit が 1 件でもあれば、他にリテラル番号があっても block する (近くの数字を採ると evidence のある PR の番号で別 PR が通る)
- **flag の長短 / API 種別で穴を作らない** (#4095): `gh pr review` の approve 指定は `--approve` と短縮 `-a` (cluster 含む) の両方を argv token 単位で判定し、`gh api graphql` の `addPullRequestReview` / `mergePullRequest` / `event: APPROVE` も approve 相当として捕捉する
- 既存 `scripts/claude-hook-prevent-qa-account-pr.mjs` の規約 (exit 2 / stdin JSON / `.claude/settings.json` の `hooks[].hooks[]` ネスト) を踏襲

#### 残存 bypass の棚卸 (#4001 起票 → #4057 / #4075 / #4082 で処理)

本 gate は「approve 相当操作の検査」であり、塞いだ範囲を過大評価しないため状態を明示する (silent gap 化の防止)。

| # | 経路 | 状態 |
|---|---|---|
| R1 | 汎用コード実行系 MCP ツール (`mcp__ide__executeCode` 等) — matcher にも SSOT にも不在で gate 自体が起動しなかった | **対処 (#4082)**: 判定軸を「shell か」から「任意の副作用を起こせるか」に変更し SSOT + matcher に収録。payload は key 決め打ちせず全文字列 + 区切り均し変種を走査。**残余は accepted residual (下記)** |
| R2 | `CLAUDE_SUBAGENT_ID` の無条件 allow — subagent context ではどのツール経由でも素通りした | **対処 (#4082)**: 許可を「GET の review 参照」だけに絞り、approve mutation は subagent でも block |
| R3 | `Agent` tool の `isolation: "remote"` で hook が継承されるか | **accepted residual (下記)**: このリポジトリからは制御も検証もできない。検知層で代替 |
| R4 | `isApproveAction` の `/pulls/\d+/reviews` が数字リテラル依存で、ループ変数形が素通りした | **対処 (#4057)**: ref の形を問わず捕捉し、番号未確定は block |
| R5 | sibling module の static import 欠落が exit 1 (= 素通し) に倒れる | **対処 (#4075)**: 相対 import を全て dynamic + exit 2 化。static import 0 件を fitness function で機械強制 |
| R6 | `gh pr review -a` (`--approve` の正式な短縮 flag) — 検出 regex が長形しか見ておらず素通りした | **対処 (#4095)**: `gh pr review` の argv を token 単位で見て `-a` / short flag cluster (`-ab`) も捕捉。`-c` / `-r` は非対象 |
| R7 | `gh api graphql` の `addPullRequestReview` / `mergePullRequest` mutation — `parseGhApiInvocation` が `graphql` を path として収集していたのに、参照側が pulls 系しか見ず**死んだ枝**になっていた | **対処 (#4095)**: graphql エンドポイント × approve 相当 mutation 名 / `event: APPROVE` の論理積で捕捉。PR は node ID 指定のため番号確定不能 = 常に block。**payload をファイル / 変数から渡す形は残余 (下記)** |
| R8 | PR 番号確定がコマンド全体 regex で、「実際に叩かれる PR」ではなく近くの数字を採っていた。`for n in 4002 4010; do gh pr merge $n; done # rollup for 4002` が **4002 の evidence で 4010 を merge** できた | **対処 (#4095)**: 番号は同一 `gh` invocation の argv / API パスからのみ取る (shell コメント以降は打ち切り)。確定不能 hit が 1 件でもあれば、他にリテラル番号があっても block |

R6 / R7 / R8 はいずれも **literal 形**であり、下記 accepted residual の定義 (動的組み立て / 未棚卸ツール) には該当しない。塞ぐべきものとして #4095 で処理した。

#### accepted residual — 塞げないと判断したもの (#4082 AC5 / #4095 で追補)

**列挙型の防御は原理的に「次に増える経路」を先回りできない**。以下は prevention では閉じないと判断し、**検知層**で代替する。

| 残余 | なぜ塞げないか | 代替 (検知) |
|---|---|---|
| **R1 残余**: 未棚卸のコード実行ツール / 動的組み立て (変数経由・base64・eval) されたコマンド | 任意言語の構文を完全解釈することは不可能。リテラルで書かれた形しか掴めない | `scripts/audit-approve-evidence.mjs` |
| **R3**: remote isolation での hook 継承 | 実行基盤側の仕様であり、リポジトリ内の設定では保証も検証もできない | 同上 |
| **R7 残余**: GraphQL payload を `--input <file>` / 変数経由で渡す形 | hook はコマンド文字列しか見ないため、外部ファイルの中身は判定材料にできない (R1 残余と同一 class) | 同上 |

検知層 `scripts/audit-approve-evidence.mjs` は **効果が着地した場所 (GitHub の review 一覧)** を入力にするため、approve がどの経路で行われたかに依存しない。`--pr <n>` で APPROVE を列挙し evidence と突き合わせ、裏付けの無い approve を exit 1 で報告する。限界 (evidence は git 管理外のためローカル実行前提 / TTL 30 分) は script 冒頭に明記してある。

**運用**: QM は merge 前に `node scripts/audit-approve-evidence.mjs --pr <n>` を実行する。remote / 未棚卸経路で approve された場合はここで検出し、経路を本表に追記する。

### 2. Adversarial Reviewer subagent (`.claude/skills/adversarial-reviewer/SKILL.md`)

- role identity: `"adversarial_reviewer (NOT QM, NOT Dev)"` を出力 schema に強制
- structured JSON output (`tmp/adversarial-evidence/<pr-number>.json`):
  - `must_object_count: 3` (literal 値)
  - `objections[]`: length 3、3 軸 (business / UX / security) 網羅必須、各 reason >= 100 文字
- skill instruction で「QM の approve 意図に echo するな、反対せよ」を repeated emphasis (Echoing 抑制、arXiv:2511.09710 §5.2 整合)

### 3. Schema validation script (`scripts/verify-adversarial-output.mjs`)

- CLI: `--pr <number>` で evidence file を読込
- 検証: `pr_number` (number) / `must_object_count === 3` / `objections.length === 3` / `axis ∈ {business,UX,security}` Set check / `reason.length >= 100` / `generated_at` 30 分以内
- fail で exit 1 + 修正手順 stderr

### 4. settings 統合

`.claude/settings.json` の既存 `hooks.PreToolUse[].hooks[]` に gate-approve.mjs を追加 (既存 prevent-qa-account hook を破壊せず追加)。matcher は `COMMAND_EXECUTION_MATCHER` (現状 `Bash|PowerShell`) と一致させる。ツール経路を増やすときは SSOT (`command-execution-tools.mjs`) と settings.json を同時に更新する — 片方だけ直すと上記 test が落ちる (#4001)。

### 5. 1-in-1-out 履行

ADR 棚卸ルール (README §10 1-in-1-out) に従い、新規 ADR-0056 追加と引き換えに **ADR-0031 (ADR-0023 deprecation map)** を archive 移動する。ADR-0031 は内容上完了済 historical record (sub-Issue 7 件帰属マップは既に Issue comment で配布完了、現場参照率低) であり、README §2026-05-27 棚卸の P1 課題「ADR-0031 の archive 判断」を本 PR で消化する。

## 結果

### Positive

- **drift identification trap の構造化**: agent が drift しても hook が approve 系 Bash を物理 block する。agent 内部自覚に依存しない (Sleeper Agents / Constitutional AI 根拠整合)
- **echoing 抑制**: `must_object_count: 3` schema 強制で「反対理由なし」の echoing 路を構造的に閉じる (arXiv:2511.09710 §5.2 で 30-40% → <10% 実証済)
- **scalable**: PR throughput 10x でも human cost 0 維持 (autonomous 制約整合)
- **escalate 経路明示**: 案 1 → 案 2 (ensemble) → 案 3 (human merge) の trigger 条件を research SSOT §5.3 で定義

### Negative / Risk

- **subagent dispatch cost**: 全 approve action 前に Adversarial Reviewer dispatch が必要 → token cost +15-30%。Pre-PMF 段階では許容範囲 (ADR-0010)
- **TTL 30 分**: 短すぎると evidence 再生成が頻発、長すぎると stale evidence で drift 抜け。30 分は暫定値、Issue #2597 baseline scan の D1 / D2 結果で調整判断
- **false positive (deny 過剰)**: `gh api repos/.../pulls/<N>/reviews` 等の review 系 REST API も regex で過剰捕捉する可能性。誤検知側に倒す方が安全 (既存 hook と同方針)

### escalate trigger (research SSOT §5.3)

| trigger | escalate 先 |
|---|---|
| 案 1 deploy 後 30 日で drift 再発 ≥ 5 件 | 案 2 (heterogeneous ensemble) |
| 案 2 deploy 後 30 日で drift 再発 ≥ 3 件 | 案 3 (人間最終 approve) |
| 顧客に致命的 defect が漏れた | 即座に案 3 |

## §D. 機構運用層 bypass 防止 (worktree HEAD verify、#2618、2026-05-29 追記)

ADR-0056 第 2 弾 gate (`scripts/check-recent-deploy-deletion.mjs`、#2607 deploy) は本来 **PR HEAD checkout 済 worktree** で実行される設計。しかし Fix Agent worktree モードで `git checkout -B <branch> origin/<branch>` 後の操作で HEAD が `origin/main` と同一化する pattern (#2557 stale cache fix の延長で main 進化追随で発生) では、`origin/main..HEAD` diff が空 → 削除 file 0 件 → 偽陽性 `exit 0` が返る。

**実害観察 (2026-05-28)**: PR #2613 Round 3 で Fix Agent (`abbe53d06e71be222`) が「`check-recent-deploy-deletion.mjs` exit 0 GATE PASS」と完了報告したが、QM Re-Review #3 (`a4523a2072adbf306`) が PR HEAD 明示 checkout で再実行したところ exit 2 (BLOCK) = legal critical 506 行 (`phase3-subscription-confirm-tokushoho-ui-design.md`、改正特商法 12 条の 6 準拠) を喪失する寸前で阻止。第 2 弾 gate が機構として functioning するも、**実行側 (Fix Agent) が worktree HEAD verify せずに gate を回す経路で bypass 可能** = 機構運用層脆弱性。

### 二重防御 (defense in depth)

1. **Agent SKILL 強制ルール** (`.claude/agents/dev-session.md` + `.claude/skills/dev-open-pr/SKILL.md`): gate 実行前 prelude で worktree HEAD = PR HEAD verify 必須を SSOT 化
2. **gate 本体 self-defense** (`scripts/check-recent-deploy-deletion.mjs`): `--pr` 指定時に worktree HEAD ≠ PR HEAD を検出すると exit 3 (新エラーコード意味付け) + `git checkout <PR HEAD>` guidance を stderr 出力で BLOCK

### 実装

純粋関数 `verifyWorktreeHeadMatchesPrHead(prNumber, ghViewFn, gitRevParseHeadFn)` を `scripts/check-recent-deploy-deletion.mjs` から export し、`main()` 内で `--pr` 指定時のみ gate 実行前に呼ぶ。`gh pr view --json headRefOid` で PR HEAD を取得、`git rev-parse HEAD` で worktree HEAD を取得、不一致なら `{ ok: false, reason: 'head-mismatch', prHead, worktreeHead }` を返す (失敗類型は `gh-pr-view-failed` / `gh-pr-view-empty` / `git-rev-parse-failed` / `head-mismatch` の 4 種)。unit test (`tests/unit/scripts/check-recent-deploy-deletion.test.ts` AC-1〜AC-7) で網羅検証。

### 一般化原則

ADR-0056 系列の全 machine-verify gate (Adversarial Reviewer hook / recent-deploy-deletion / verify-adversarial-output 等) は **defense in depth** で:

- **gate 実行側 (Agent / SKILL)**: 前提条件 verify (worktree HEAD / PR 状態 / TTL 等) を skill ルールとして強制
- **gate 本体**: 前提条件 self-defense (実行側の verify 漏れに対する最終 backstop)

両方を実装する。**第 4 弾 deploy** (#2618) = 機構運用層 self-defense 第一例。今後同種 gate 追加時も両層実装を default 化する。

## §E. Persona Drift §C fallback 経路自動化 (#2632、2026-05-29 追記)

ADR-0056 §C (Persona Drift 対策 fallback) は Task subagent dispatch tool 不可環境での QM 自筆 fallback を許可する設計だが、本日 (2026-05-29) 観察で **subagent dispatch 可能環境でも Persona Drift 発生** が 4 連続で実証された:

| PR | Drift 現象 |
|---|---|
| **#2613 RR #4** | subagent が evidence を agent worktree 内のみに生成、main repo に転送されず QM が探索失敗 |
| **#2625** | subagent が「QM Orchestrator に approve action 進行可を報告」のみで停止、QM action 不実行で stuck |
| **#2629** | 同上 (subagent 報告 → QM action skip) |
| **#2630** | 同上 + subagent が `must_object_count: 3` schema を満たすが evidence file が `tmp/adversarial-evidence/` 直下でなく subagent worktree 配下 |

42 回再発の延長線上で、**subagent dispatch を成功させても evidence 流通 / action 接続点で drift する**ことが判明。

### 対策 (構造化)

1. **evidence 配置 SSOT**: `tmp/adversarial-evidence/<pr>.json` は **main repo 直下** 必須 (subagent worktree 内のみは NG)。Adversarial Reviewer skill instruction で「main repo 絶対パスで Write すること」を明示
2. **QM 自身が evidence 存在 verify**: subagent dispatch 後、必ず `ls tmp/adversarial-evidence/<pr>.json` で物理存在確認。不在なら §C fallback (QM 自筆) を即実行 (subagent 再 dispatch ループに陥らない)
3. **approve action 責務明確化**: QM Orchestrator が approve + auto-merge SET を必ず**自分で実行**する (subagent に委ねない)。subagent は evidence 生成までが責務 (action 実行は QM 専権)
4. **`scripts/verify-adversarial-output.mjs` の TTL 厳格化候補**: 現状 TTL 30 分超過時 warning text のみで exit 0、Persona Drift 観察を踏まえ TTL 切れ時 exit 1 に厳格化する案 (別 follow-up Issue 起票判断、本 ADR §E では SSOT 明示のみ)

### 一般化原則: subagent ≠ QM (役割分離 SSOT)

- **subagent (Adversarial Reviewer)**: evidence 生成 (反対理由 3 件 structured JSON) が責務、approve action 不可
- **QM Orchestrator**: subagent 起動 → evidence verify → approve action 実行が責務、evidence 生成不可 (Echoing 抑制)

両者を混同すると drift が再発する (subagent が approve action を肩代わり / QM が evidence 生成を肩代わりで bias)。本 §E は ADR-0056 §B (採用案) の運用層で「役割分離 SSOT」を明示する補強。

### §E 追補: Re-Review agent への射程拡張 + V-7 Orchestrator 専権 (#2756 / #2815 Q-1、2026-06-04 DR 会議)

§E の役割分離は Adversarial Reviewer subagent だけでなく **Tier 2 Review / Re-Review を担う全 agent** に適用する。hook/§E 配備 (5/28) 後も「approve に進みます」と宣言して tool call せず exit する drift が 2 件再発 (#2748 / #2754) し、PreToolUse hook は tool call の**不在**を原理的に検出できないため、prompt/template 強化では止まらないことが実証された (DR 会議全会一致、業界デファクト「不可逆 side-effect は agent でなく orchestrator が実行」整合):

- Review / Re-Review agent の責務は **V-0〜V-6 (semantic verify + evidence 生成・報告) で完結**。V-7 approve action (account switch → approve → merge → 復帰 → cleanup) は **QM Orchestrator 本体が完了報告受領後に直接実行** (qa-session.md §「全手順 Pass → approve & merge」)
- Orchestrator 本体 (`CLAUDE_SUBAGENT_ID` 未設定) 経路は gate-approve hook の evidence 検証が確実に発火する正規経路 (subagent context の無条件 allow を通らない)
- Orchestrator 自身の忘却対策: 「evidence verify 済・approve 未実行」PR を queue とし、次 PR 着手前に未処理 queue を確認する (Tier 1 Step 4)

### #2632 統合 (Ready 化前 5 項目 SSOT)

本 §E と並行で Dev Agent 側にも `Ready 化前 5 項目 SSOT` を明示 (`docs/sessions/dev-session.md` + `.claude/skills/dev-open-pr/SKILL.md`)。Persona Drift が QM 側で発生してもなお Dev 側で `pre-ready -- --pr <N>` PASS が verify されていれば、QA Tier 2 Review (BLOCK 列挙工程) の発生回数自体が減り QM 本質判定時間が確保される (defense in depth 第 3 層)。

### 第 2 弾 gate (recent-deploy-deletion) 補強履歴

| 補強 PR | 内容 |
|---|---|
| #2607 (deploy) | `scripts/check-recent-deploy-deletion.mjs` 初出 (#2603 で起票、QM Tier 2 Step 5 D 項目) |
| #2618 (deploy、第 4 弾) | 機構運用層 bypass (worktree HEAD verify) 検出条文 §D 追加 + script self-defense exit 3 実装 |
| **#2615 (time-aware flag 拡張)** | gate に `--since <ISO>` / `--since-ref <SHA>` / `--since-recent <N>` flag 追加。Fix Agent push → Re-Review 間の main 進化による Time-of-Check vs Time-of-Use race 4 ラウンド連続観察 (PR #2607 Round 5) を構造解決。time window 指定で main 進化新規 file を比較対象外化、main 進化 (新規追加) を「削除」と誤検出しない |
| **#3832 (teardown marker exemption、本 §G)** | develop 二層で main live な feature を意図的に撤去する PR の誤 BLOCK (full `--no-verify` 強制) を解消。`Deploy-Teardown: <path-regex>` commit trailer で宣言 path のみ exempt (audit log 出力)、宣言外は BLOCK 維持。account check を温存したまま `--no-verify` 常態化を根絶 (#3821 で観察) |


## §F. push 時自己検証機構 (第 8 弾 deploy、#2598、2026-05-29 追記)

第 5 弾 #2633 deploy (`pre-ready` CLI Step 9 Readiness gate 強化 + SKILL.md prelude 強化) は Dev 経路で `pre-ready` を経由する場合に systematic verify を強制する設計だが、**Dev が pre-ready を skip して直接 `git push` した場合は依然 push される**事象が本日 7+ 連続観察された (#2625 / #2626 / #2629 / #2630 / #2634 / #2635 / #2636 等)。これらは全て push 前に Dev 自己検証で気づける pattern (rebase drift / PR body 13 セクション欠落 / 禁止語混入 / 本日 deploy 全 file 削除) であり、**push レイヤで機械強制する** 第 4 層 (defense in depth) が必要であることが判明した。

### 対策 (`.husky/pre-push` 軽量 verify chain)

既存 husky pre-push (#1879、gh アカウント verify 単独) に push 時 systematic verify chain を追加:

1. **origin/main rebase drift verify** (#2557 / 本日 7+ 連続 BLOCK の root cause): `git merge-base origin/main HEAD` vs `git rev-parse origin/main` で同期確認、未取込なら exit 1 + 修正手順 stderr
2. **本日 deploy 全 file 削除 0 verify** (PR 存在時のみ、#2603 / #2628 第 4 弾 gate 経由): `scripts/check-recent-deploy-deletion.mjs --pr <N>` 実行
3. **PR body 13 セクション + AC 4 列 + 禁止語 + mojibake verify** (PR 存在時のみ、#2060 / #2576 / #2586 / #2633 第 5 弾): `scripts/check-pr-body.mjs --pr <N> --skip-mergeable` 実行。**Draft PR では Ready 化要件 (Ready チェックリスト全 `[x]` / PO 決裁ブリーフ) のみ deferred する** (#3997)。Draft は「まだ Ready の要件を満たしていない」宣言であり、これを要求すると Draft に 1 commit も push できず成果物が local に滞留する (#3989 実例)。体裁・事実性の検査 (セクション網羅 / AC 4 列 / 禁止語 / mojibake / 変更タイプ / CONFLICTING / hotfix env 配布証跡) は Draft でも enforce し、deferred した gate 名は必ず標準出力に出す (無言 skip は #3969 と同じ失敗 class)
4. **biome check** (軽量 lint): 重い svelte-check / vitest / playwright は CI 委ね、push レイヤは lint のみ

### 設計境界 (Pre-PMF / ADR-0010 整合)

重い検査 (vitest / playwright / svelte-check) は本 hook に **追加しない**:

- **理由 1**: push 速度を保ち、push の bypass 誘惑を減らす (`--no-verify` 常態化の予防)
- **理由 2**: 同 step は CI / `npm run pre-ready` が二重で実行する設計 (defense in depth)
- **理由 3**: ADR-0010 Pre-PMF 過剰防衛境界内 — 軽量 check のみ「BLOCK 早期検出 cost」と「push 速度」のバランス

PR 未作成の初回 push 時は 2-3 を skip (PR_NUM 空)、2nd push 以降 (Fix Agent 修正 push) は PR 存在のため verify 実行。

### Defense in depth 4 層 (本 §F で完成)

| 層 | 機構 | 起動 trigger |
|---|---|---|
| 1. 機構層 | `scripts/check-pr-body.mjs` / `scripts/check-recent-deploy-deletion.mjs` / `pre-ready` Step 9 (#2633) | `pre-ready` CLI 実行時 / CI workflow |
| 2. Agent SKILL ルール | `.claude/agents/dev-session.md` + `.claude/skills/dev-open-pr/SKILL.md` Ready 化前 5 項目 (#2632) | Dev / Fix Agent 自己確認時 |
| 3. ADR SSOT | ADR-0056 §A-§F SSOT 体系 | 全 stakeholder 参照時 |
| **4. push 時自己検証** | `.husky/pre-push` 軽量 verify chain (本 §F、#2598) | 全 `git push` 時 (`--no-verify` 以外) |

### bypass 規定

`git push --no-verify` で skip 可能だが、ADR-0026 で discouraged。本日 7+ 連続 BLOCK の root cause 解消が目的のため、通常 push で skip すると本 hook の存在意義を毀損する。緊急 hotfix 等の極限ケースのみ skip 許容。

### §F 補足 (#2647 hotfix、第 9 弾 deploy、2026-05-29 追記)

第 8 弾 #2645 deploy 直後の Fix Agent (#2644、`a5170826a8750e065`) で **Step 2.2 設計バグ**観察:

| 段階 | 観察 |
|---|---|
| 第 8 弾 #2645 deploy 当初実装 | `node scripts/check-recent-deploy-deletion.mjs --pr "$PR_NUM"` |
| `--pr <N>` 指定時の内部挙動 (#2628 第 4 弾) | `gh pr view <N> --json headRefOid` で **remote PR HEAD** 取得 → `git rev-parse HEAD` (**worktree HEAD**) と比較 → mismatch で exit 3 |
| push 前 hook 経路での side effect | local が rebase + new commit を持つため **worktree HEAD ≠ remote PR HEAD** → 構造的に常時 BLOCK → Fix Agent が `--no-verify` 強制利用 |
| 結果 | hook 自身が QA 機構毀損 (User 明示 priority「QA チーム時間取り戻し」と真逆動作) |

#### Step 2.2 仕様 (#2647 hotfix 確定後)

Step 2.2 (`check-recent-deploy-deletion.mjs`) は **引数なしで呼ぶ** = delete check のみ実行:

- ✅ push 前 hook: local が rebase + new commit で local HEAD ≠ remote PR HEAD でも構造 BLOCK なく動作
- ✅ defense in depth 維持: CI 経路 + QM Re-Review / Fix Agent worktree mode で `--pr` 付き gate が真正実行 (PR HEAD = checkout HEAD 一致状態で worktree HEAD verify が意味を持つ)
- ❌ NEVER: hook 内で `--pr "$PR_NUM"` 付与 (push 前 mismatch で構造 BLOCK = 第 8 弾 #2645 deploy 直後発見 bug)

由来: PR #2645 第 8 弾 deploy 直後の Fix Agent (#2644) 実観察、Issue #2647 で hot fix (第 9 弾 deploy)。
unit test 検証: `tests/unit/scripts/check-recent-deploy-deletion.test.ts` §「#2647 hook context」 — 引数なし時の `prNumber === null` + worktree HEAD verify skip 仕様を pin。

## §G. intentional migration teardown exemption (develop 二層 false-positive 是正、#3832、2026-07-17 追記)

第 2 弾 gate (`scripts/check-recent-deploy-deletion.mjs`) は「直近 deploy した feature の削除 = 事故的消失」を data-loss として BLOCK する。しかし **develop 二層ブランチ戦略 (`docs/sessions/branch-strategy.md`) では「main に live な feature を develop 向け PR が migration で意図的に撤去する」のは正当**であり、gate はこれを区別できず正当な移管撤去 PR を誤 BLOCK する。

**実害観察 (#3821 analytics Sub-B)**: DynamoDB → DSQL 移管の一環で always-on の analytics 収集 cron / service を撤去 (#3805 AC1 の文書化済み scope) した際、gate が「直近 merge file の削除」と誤検出。`.husky/pre-push` hook は gate が案内する `--ignore-pattern` を渡さないため実質使えず、ユーザ承認のもと **full `--no-verify`** で bypass した。`--no-verify` は全 hook を skip する = **account check (`check-gh-account-before-pr.mjs`) まで飛ぶ**副作用があり、常態化すると QA 機構を毀損する。

### 対策 (commit trailer 宣言 + path scope)

PR 自身の commit (`<base>..HEAD`) に **`Deploy-Teardown: <path-regex> #<issue> <理由>`** (別名 `Migration-Teardown:`) trailer を書けば、gate が宣言 path にマッチする削除を exempt する:

- **path scope 必須 (無条件全通し防止)**: trailer の先頭 token は削除対象 path を絞る regex。宣言 path にマッチする削除のみ exempt し、**宣言外の削除は従来通り BLOCK** (genuine data-loss 保護維持)。path token 空は明示 Error。
- **audit log 出力 (監査追跡可能)**: exempt した削除は `TEARDOWN-EXEMPT` として stdout に列挙 (file + 宣言 pattern + reason)。監査が後追いできる。
- **QM-gated**: trailer は git 履歴 / PR body に残り QM / 監査が review する。self-exempt の濫用は path scope + log + QM review で構造的に抑止。
- **`--no-verify` 常態化の根絶**: 本 exemption は deploy-deletion gate **単体**を対象化し、account check 等の他 hook は必ず走る。hook (`.husky/pre-push`) は trailer を自動で読むため引数不要で exemption が効く。
- **両 lane 適用**: trailer は commit と共に develop → main へ流れるため、develop 向け PR で 1 度宣言すれば release/*→main 統合時も同一宣言が自動適用され、#3438 Phase 3 等の同種撤去での再エスカレーションを防ぐ。宣言外の削除は両 lane とも hard-block のまま。

### 実装

純関数 `parseTeardownTrailers` / `compileTeardownPattern` / `partitionDeletionsByTeardown` / `getTeardownPatternsFromCommits` を `scripts/check-recent-deploy-deletion.mjs` から export。`main()` は削除検出後に teardown trailer を読み、宣言 path マッチを exempt (log 出力) してから残りを `findViolations` に回す。regex compile は `compileIgnorePattern` (長さ上限 + fail-closed、#3766) を再利用。unit + 実 git fixture test (`tests/unit/scripts/check-recent-deploy-deletion.test.ts` §「#3832」) で「marker 無し BLOCK / marker 有り通過 / 宣言外は BLOCK 維持」の境界を failing-test-first (ADR-0061) で固定。

### 運用 (migration teardown PR の宣言方法)

意図的に main live な file を撤去する PR は、撤去 commit の message 末尾に trailer を付ける:

```
refactor(analytics): #3821 always-on analytics 収集を撤去

Deploy-Teardown: ^src/lib/analytics/ #3821 analytics Sub-B teardown
Deploy-Teardown: ^src/routes/api/cron/(analytics|challenge)-aggregate/ #3821
```

複数 path は trailer を複数行書く。ADR archive 移動等の非 teardown な既知除外は従来どおり `--ignore-pattern` も併用可。

## 関連

- **Research SSOT**: [docs/research/qm-drift-prevention-2026-05-28.md](../research/qm-drift-prevention-2026-05-28.md)
- **既存 hook 規約**: `scripts/claude-hook-prevent-qa-account-pr.mjs` (#1879 / #1994、本 ADR の実装パターンソース)
- **ADR-0022**: admin bypass 禁止 + ganbariquestsupport-lab QM Approve 体制 (本 ADR はその QM 役を補強)
- **ADR-0010**: Pre-PMF スコープ判断 (本 ADR は Bucket A — 本日 #2588 実観察 defect への直接対処)
- **#2618 (§D 起票元)**: Fix Agent gate 実行時の worktree HEAD verify bypass 脆弱性 (QA self-implement 第 4 弾、2026-05-29 deploy)
- **#2632 (§E 起票元)**: pre-ready CLI Ready checklist gate 統合 + Persona Drift §C fallback 自動化 (QA self-implement 第 5 弾、2026-05-29 deploy)
- **#2598 (§F 起票元)**: `.husky/pre-push` 軽量 verify chain (QA self-implement 第 8 弾、2026-05-29 deploy、本日 7+ 連続 BLOCK 構造的予防)
- **#2647 (§F 補足 hotfix 起票元)**: Step 2.2 `--pr` 引数撤去 (QA self-implement 第 9 弾 hotfix deploy、2026-05-29 deploy、第 8 弾 deploy 直後の hook 設計バグ修正、Fix Agent `--no-verify` 強制利用解消)
- **#3832 (§G 起票元)**: intentional migration teardown exemption (develop 二層 false-positive 是正、2026-07-17 追記、#3821 analytics Sub-B の full `--no-verify` bypass 実害への構造的対処)
- **archive**: ADR-0031 (1-in-1-out 履行で本 PR で archive 移動)
