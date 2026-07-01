# DSQL 移管（EPIC #3424）実装フェーズ実行計画

> **目的**: 凍結設計書 `docs/design/dsql-data-model.md`（§1-§13）を、各実装者（Claude Code 含む）が**誤解釈せず忠実に実装しきる**ための実行計画。t-wada の Canon TDD と ADR-0061 の failing-test-first を実装単位に焼き込む。
> **関連**: EPIC #3424 / 設計 SSOT `dsql-data-model.md` / 裏付け `tmp/dsql-data-model-research-results-2026-06-29.md`（判断①-⑭ + spike#1-8）/ rationale `13-aurora-dsql-migration-evaluation-rationale.md` / ADR-0061 / ADR-0001。

## 0. 貫く 3 つの構造的判断

1. **実装スライスの単位 = DDD 集約境界（§3）**。DSQL 移管は「DB 層の horizontal 貼り替え」で純 vertical slice が当てにくいが、設計書 §3 の集約（Family / Child / StampCard / ChecklistTemplate / global master）を切断面に取ると、各スライスが「DDL 2 方言 + repo + tenant 述語 + backup 契約 + fitness」を一体で持ち、round-trip/repo テストで独立検証できる INVEST 準拠 unit になる。集約境界は設計が txn 境界の根拠として既に確定済（§3「1 txn=1 集約」）＝実装スライスと設計 SSOT が一致。
2. **PR-0 凍結は hard gate でなく revisitable baseline（§12.5）**。zero-user 期は PK が rebuildable（§12.3 greenfield swap）。fitness#9（PK-freeze manifest）で「どんな PK 変更も manifest 更新 + migration ADR を人手強制」だけ機械化し front-load を最小化。真の freeze ceremony は first real cohort 後に予約。
3. **忠実 transfer の核 = 15 fitness function（§13.1）を t-wada の "red" に変換**。Canon TDD は「List→Red→Green→Refactor→Repeat」で test list が最初の分析ステップ。設計の fitness#1-15 と spike#1-8 確証済み不変条件が各 issue の test list = red 候補集合になる。ADR-0061 failing-test-first = この List/Red を CI gate 化したもの。

## 1. Issue 階層ツリー

```
EPIC #3424  DynamoDB → Aurora DSQL 移管
├─ Phase 0  設計凍結の manifest 化（PR-0）                     … linchpin、最優先（P0）
├─ Phase A  基盤プリミティブ（txn / OCC / tx-handle、PR-0b）    … 全 write path の前提（P1）
├─ Phase B  auth リレーショナル化（PR-1）                       … children UUID に依存（P1）
├─ Phase C  集約別 DDL+repo+backup+fitness（PR-2..N）           … 集約=スライス単位（P2）
├─ Phase D  cron / tenant 分離 の横断不変条件                   … Phase C 適用対象が揃ってから（P2）
├─ Phase I  インフラ（CDK / alarm / dashboard / DR / client）   … Phase C と並列可（P2）
└─ Phase Z  DynamoDB 撤去 + rationale 13 supersede             … 全 merge + cutover 後（P6）
```

依存工程（`.github/CLAUDE.md` P0-P7）: 下流は上流 close まで着手しない。

### 1.1 既存 #3425-3438 の scope 更新（実装 issue は未起票＝要新設）

| 既存 # | 現内容 | 帰属・判定 |
|---|---|---|
| #3425 PoC 実DPU/OCC率 | spike#4/#8 実測済 → Phase C の total_point contention 実測（§4.1 残検証）に**縮小** |
| #3426 Lambda接続再利用 | spike#8 済 → Phase I の DSQL client factory 根拠に**転用** |
| #3427 drizzle-kit ASYNC/DDL | spike#1 済 → Phase 0 migration runner 根拠に**転用** |
| #3428 3000行txn上限 | spike#1 済 → Phase A/§9.1 chunk 実装根拠に**転用** |
| #3429 CDK 最小 | Phase I-1 として**存続**（region は **us-east-1** に訂正） |
| #3430 DPU query 規約 ADR | §4.1/§13.2 凍結済 → Phase C repo read-plan に**吸収・縮小** |
| #3431 Alarm/Budgets | Phase I-3 **存続** |
| #3432 dashboard | Phase I-4 **存続**（fitness#11 optional 欠落 metric 受け皿） |
| #3433 drizzle 型差分 | §11.3/§6.6 凍結済 → Phase 0 dialect-parity（fitness#6/#13）に**吸収** |
| #3434 tenantId fitness | = fitness#1。Phase D-1 として**実装 issue 化** |
| #3435 OCC retry | = PR-0b（Phase A）に**統合** |
| #3436 import chunk+saga | = §9.1（#3326 統合済）。Phase C-backup **存続** |
| #3437 AWS Backup PITR | §12.4 凍結 → Phase I-5 **存続** |
| #3438 dynamodb 撤去 | = Phase Z。analytics DynamoDB 経路（§12.1 N3）も**編入** |

**結論**: 既存 14 件は PoC + 設計 ADR + 撤去のみ。**実装主体（PK 凍結 manifest / txn プリミティブ / auth DDL / 集約別 DDL・repo・backup / fitness 実装 / cutover 実行）が未 issue 化**＝下記 §1.2 の新規 issue 群で埋める。

### 1.2 新規 issue（設計 §ref / AC / blocked_by / 粒度根拠）

> AC は必ず `§ref + fitness#N / spike#N` に紐付ける。粒度目安 = 200-400 LOC / 1 reviewable unit。

**#N0-1 PK 凍結 manifest + `children` linchpin DDL + dialect-parity 土台**（Phase 0）
- §ref: §11.1/§11.2/§12.2.1(PR-0)/§13.1(#6,#9,#13) / AC: fitness#9(PK==manifest) / fitness#13(pg/sqlite CHECK 文字列一致、CHECK 値は age-tier.ts/archive-types.ts 生成) / temporal `{mode:'string'}` / children secondary 0 本(§4.1) / blocked_by: なし（最上流 linchpin） / 粒度: child_id が ~20 表 PK 先頭＝最初に凍結し下流手戻り防止。manifest+1表DDL+parity test ≤400 LOC。

**#N1-1 `runInTransaction`+`withOccRetry`+tx-handle 引き回し（Unit of Work）**（Phase A、#3435 統合）
- §ref: §8/§12.2.1(PR-0b)/§13.1(#7,#8)/spike#4 / AC: fitness#8(write-path repo は tx 必須引数・module db 直結禁止・**core 1操作を tx 外に逃がすと pg で部分コミット再現を failing-test-first**) / fitness#7(core txn 内 await は tx-bound のみ allowlist) / spike#4(SAVEPOINT不可・25P02 前提で optional を core に入れない) / backend dispatch(pg async+withOccRetry / SQLite BEGIN IMMEDIATE+retry no-op) / blocked_by: #N0-1 / 粒度: recordActivity と import が共有する土台。

**#N2-1 auth 5 表 DDL + owner_guard/consent 不変条件**（Phase B、PR-1）
- §ref: §6.6/§11.2(auth)/§13.1(#2,#3,#6)/spike#3,#6 / AC: owner_guard 生成列+UNIQUE で owner≤1 DB強制(spike#3、2人目23505) / **fitness#3(全 role-mutation を requireRole(['owner']) 背後に+parent→403 negative test、owner_guard は「誰が書けるか」を守らない)** / fitness#2(consents append-only+erasure caller 束縛) / invite 受諾単一txn(rowCount0/40001/23505 厳密分岐+token_hash) / email_lower GENERATED UNIQUE / blocked_by: #N0-1(invites.child_id 依存) / 粒度: ≤400 LOC 超なら (a)users/families/memberships+owner_guard (b)invites/consents+受諾txn に 2 分割。

**#N4-1 Child 集約 DDL(core hot-path 表)+派生列**（Phase C）
- §ref: §11.2/§5(派生列)/§4.1(index)/§13.1(#14) / AC: point_ledger secondary(family,child,type,recorded_date) は spike#7 採用/date secondary 初期不使用 / children.total_point 派生列 / fitness#14(total_point==SUM 突合) / blocked_by: #N0-1

**#N4-2 `recordActivity` 単一txn原子化+冪等guard+optional隔離**（Phase C）
- §ref: §8/§3.5.1/§13.1(#10,#11,#14) / AC: core=単一txn all-or-nothing / fitness#10(mission-bonus once-per-period 冪等、TOCTOU 二重付与検出) / fitness#11(optional-write 失敗で観測カウンタ metric) / 演出契約(確定 point_ledger/total_point からのみ描画、optional=compute-on-read) / blocked_by: #N1-1,#N4-1 / 粒度: 「最大の質的改善」。txn化+3 fitness に集中。

**#N4-3 Child 集約 repo(tenant述語+backup契約)+round-trip**（Phase C）
- §ref: §9.2/§9.2.1/§13.1(#1,#5,#12) / AC: findAllByChild+insertForRestore / fitness#1(tenant述語+raw SQL ban) / fitness#5(round-trip を pg で1回+storage re-link count assert(R2 silent 全skip 検出)+秘密不在 assert) / fitness#12(cross-tenant 404、#3139移植) / blocked_by: #N4-1

**#N4-4..N 残 Child/Family/StampCard/ChecklistTemplate 集約 DDL+repo+backup**（Phase C）
- §ref: §11.2 全表/§5 JSON解体(checklist_log_items/evaluation_scores/displayConfig 列展開/certificates.metadata=jsonb)/§6(per-child instance 維持) / 各集約を DDL/repo/backup の 3 スライス型で反復 / blocked_by: #N0-1(+該当プリミティブ)

**#Nbackup 一括 import chunk+saga+R2/R5**（Phase C、#3436/#3326 統合）
- §ref: §9.1/§9.2.1(R2,R5)/§13.1(#4,#5) / AC: import-then-swap(errors>0→中止) / chunk ≤3000行(spike#1) / R2(avatar/voice path `\d+`→`[^/]+`、childIdMap `Map<string,string>`) / fitness#4(registry schema⊆ + auth/consent/subscription excluded + settings **allowlist 化**) / blocked_by: #N1-1

**#ND-1 全テナント表 tenant 分離 fitness**（Phase D、#3434=fitness#1）
- §ref: §P9/§3.5.4/ADR-0063(open PR #3467)/§13.1(#1) / AC: schema walk+repo AST+**raw sql ban**(fail-open 防止) / blocked_by: Phase C 各集約 + #3467 merge

**#ND-2 cron per-tenant chunk 強制**（Phase D、§8.1=fitness#15）
- §ref: §8.1/§13.1(#15) / AC: 全テナント横断 cron を per-tenant+chunk≤3000+OCC retry / age 系は age compute-on-read 化で撤去(N4) / blocked_by: #N1-1

**Phase I（並列可）**: #3429 CDK L1 CfnCluster(**us-east-1**)+deletion protection+IAM / #3437 DSQL PITR/AWS Backup(§12.4、本番前 MUST) / #3431 Alarm+Budgets¥100 / #3432 dashboard(OccConflicts/CommitLatency/接続数+fitness#11 metric) / #Nclient Lambda DSQL client factory(handler 外生成+IAM token/接続 age 1h 再接続、§12.1)。**ADR-0024 インフラ PR 必須要件を追加適用**。

**Phase Z**: #3438 `db/dynamodb/` 39file+CI gate 2本+migration hydrate 撤去+analytics DynamoDB 経路確定(§12.1 N3)+rationale 13 supersede。blocked_by: Phase C/D 全 merge+cutover 検証。

## 2. TDD t-wada 実行フロー（Canon TDD: List→Red→Green→Refactor→Repeat）

**共通ルール**: test list を最初に書く（設計 fitness#N/spike 不変条件が源）。**全テストを先に書かない**。ADR-0061 failing-test-first = List/Red の PR gate 化。

### 2.1 PR-0 children DDL + PK 凍結 manifest（#N0-1）
- **List**: ①PK==manifest ②pg/sqlite CHECK 一致 ③temporal string mode ④secondary 0本 ⑤CHECK は SSOT 生成
- **Red**: `pk-freeze-manifest.test.ts` に「manifest に無い PK があれば fail」を先に（schema 未実装で red）→ dialect-parity で「pg/sqlite CHECK 値相違で fail」を red
- **Green**: children DDL を pg-core/sqlite-core 最小記述、CHECK は age-tier.ts 生成、manifest に PK 登録
- **Refactor**: 生成列変換 helper 化、manifest ローダ共通化
- 要点: manifest が schema より先に存在し schema がそれに従う＝§11.2 PK 表が唯一の真実（誤解釈の余地を消す）

### 2.2 recordActivity 単一txn（#N4-2）— 最重要非対称バグを red 化
- **List**: ①core 5行 all-or-nothing ②tx外操作は pg で部分コミット(SQLite で隠蔽) ③二連打二重付与 ④optional 失敗 metric ⑤演出は確定値
- **Red**: **「core 1操作を tx 外に逃がすと pg で部分コミット観測」failing test を pg backend で**（SQLite 単一接続では緑ゆえ pg integration 必須、Finding 2）→「同一 child 二連打で mission bonus 2回」red(fitness#10 TOCTOU)
- **Green**: runInTransaction で core 単一txn化、mission bonus に自然キー UNIQUE、optional は core commit 後の独立 mini-txn(各 point_ledger INSERT+total_point 加算を 1 txn)
- **Refactor**: optional dispatch を additive・冪等関数群に、演出を compute-on-read 化
- 要点: 「E2E 緑で本番崩壊」の非対称を下位層(pg integration)に push down(ADR-0061)

### 2.3 owner_guard authz（#N2-1）
- **Red**: owner_guard は「誰が書けるか」を守らない(§6.6⚠️)ゆえ **requireRole 無しで parent が role 変更できる negative test を先に red**(positive だけだと単一点防御の穴を見逃す) → **Green**: 全 role-mutation を owner 専用 route guard 背後へ → **Refactor**: /admin owner+parent 同居を owner 専用 route に分離

### 2.4 backup round-trip（#N4-3/#Nbackup）
- **Red**: **「UUID childId で avatar が静かに全 skip(restored=0)」failing test を先に**(R2)、既存 completeness test を backend パラメタ化し pg で red → **Green**: path 正規表現/childIdMap 修正、import-then-swap → **Refactor**: registry allowlist 化(settings denylist 是正)

## 3. 忠実 transfer の仕掛け（誤解釈防止・多層防御）

| 仕掛け | 内容 | 根拠 |
|---|---|---|
| ① 全 issue AC に `§ref + fitness#N/spike#N` 必須紐付け | issue-triage skill の AC 記法に「DSQL issue は §ref 必須」追加 | ADR-0001 |
| ② PR body に「設計 §参照マップ」欄 | AC 検証マップ 4列→**5列拡張**(`AC/内容/設計§ref/検証手段/結果`)、check-pr-body.mjs は非破壊流用 | ADR-0004 |
| ③ PK 凍結 manifest=単一真実源(fitness#9) | §11.2 PK 表を manifest に写経、schema がそれに従うことを CI 強制(drift を人手レビューに委ねない) | fitness#9/ADR-0061 |
| ④ dialect-parity test(fitness#6/#13) | pg/sqlite 生成列・CHECK・temporal mode 一致で「同一論理・物理 index は backend 別」の誤読を封じる | Finding 4 |
| ⑤ 「未決→確定」対応表を issue に転記 | §10 の 12 項は全確定(catalog不採用/report廃止/displayConfig列展開/optional欠落許容 等)、各 issue に依存確定事項を明記し再議論禁止 | §10 |
| ⑥ 変換規則 SSOT(§11.3)を helper 化 | int→uuid/+family_id/複合PK/生成列/CHECK/jsonb 判定を machine-derive、jsonb vs 列は §11.3 確定判定表のみ入力 | §11.3 |
| ⑦ ADR-0061 根本原因欄運用 | dev ticket に「なぜ e2e-only でなく unit/fitness に降りるか」を記入し push-down 明文化 | ADR-0061 |

## 4. 品質ゲート適用表

| gate | Phase0 | PhaseA | PhaseB | PhaseC | PhaseD | PhaseI | PhaseZ |
|---|---|---|---|---|---|---|---|
| pre-ready 14 step | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ADR-0004 AC 検証マップ(5列) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ADR-0060 完了10項目(設計書同期) | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓(rationale supersede=項目10) |
| failing-test-first(ADR-0061) | ✓ | ✓(最重要) | ✓ | ✓ | ✓ | 一部 | — |
| fitness function CI | #9/#13/#6 | #7/#8 | #2/#3/#6 | #1/#5/#10/#11/#12/#14 | #1/#15 | #11 metric | 撤去後除去 |
| pg integration test | — | ✓必須 | ✓ | ✓(write path) | ✓ | — | — |
| dialect-parity test | ✓ | ✓ | ✓ | ✓ | — | — | — |
| impact-analysis skill | ✓(child_id) | — | ✓(role二重書き廃止) | ✓(int→UUID) | — | — | ✓(11000行削除) |

Phase I は ADR-0024（インフラ PR 必須要件）追加。DB スキーマ変更は db-migration skill + `.env`/スキーマ確認プロンプト必須。

## 5. リスクと対策

| # | リスク | 対策 |
|---|---|---|
| R1 | PK 凍結逸脱 | fitness#9 manifest で CI hard-fail。zero-user は rebuildable(§12.5)ゆえ変更は manifest 更新+migration ADR |
| R2 | 並列 Agent の設計乖離 | ①集約=スライス境界で疎結合 ②fitness#1/#6/§11.3 helper で解釈を機械固定 ③worktree 分離 |
| R3 | 大規模 PR 分割失敗 | 集約を DDL/repo/backup の 3 スライスに割る、auth も 2 分割 |
| R4 | SQLite 緑・pg 崩壊の非対称(fitness#8) | pg integration test を write-path 必須、failing-test-first で先に再現 |
| R5 | ADR-0063 未 merge 依存 | Phase D を #3467 merge に blocked_by、現行 SSOT は 14-セキュリティ §5.2 暫定参照 |
| R6 | optional 欠落 silent 化 | fitness#11 metric+演出契約、欠落許容は §10-8 PO 確認済を issue 明記 |
| R7 | region 誤記伝播 | #3429 AC に「本番スタック同一 us-east-1」明記、APPI 開示義務は §9.4/§10-12 を legal issue 連携 |
| R8 | stripe_webhook 未実装で課金 | データモデルと decouple、別 billing issue で必須実装(webhook 冪等統合テスト)、「課金稼働前 MUST」を EPIC 注記 |

## 6. 一次ソース

- t-wada「テスト駆動開発の定義」(Canon TDD 翻訳): https://t-wada.hatenablog.jp/entry/canon-tdd-by-kent-beck
- INVEST + vertical/horizontal slicing(Humanizing Work): https://www.humanizingwork.com/the-humanizing-work-guide-to-splitting-user-stories/
- Vertical slice(Thoughtworks): https://www.thoughtworks.com/insights/blog/slicing-your-development-work-multi-layer-cake
- PR サイズ 200-400 LOC 実証: https://www.propelcode.ai/blog/pr-size-impact-code-review-quality-data-study

## 7. 次アクション

1. 本計画を PO レビュー。承認後 §1.2 の新規 issue 群を `issue-triage` skill 経由で起票（既存 #3425-3438 に scope 更新コメント同時付与）。
2. 起票順は依存 DAG（Phase 0 → A → B → C → D/I → Z）。**#N0-1（PK 凍結 manifest + children）が最上流 linchpin**。
3. 各 issue は failing-test-first（設計 fitness→red）で着手、pre-ready + AC マップ(5列) + fitness CI を DoD に。
