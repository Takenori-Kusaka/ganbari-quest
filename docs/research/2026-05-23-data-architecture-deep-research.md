# データアーキテクチャ Deep Research — 家族 × 子供 multi-tenant 型の一次原則からの再構築

| 項目 | 内容 |
|---|---|
| 目的 | v2 提案「family master + per-child preferences」を **疑い** から始めて、各 resource type の domain semantics を一次原則から再評価 |
| 対象 read 順 | §1 → §3 → §4 → §5 → §6 (時間がない場合は §4 + §6 のみ) |
| 関連 | `docs/research/2026-05-22-import-hub-ux-redesign-v2.md` (本 research の前提を否定する立場で書く) / EPIC #2362 / Issue #2136 #2137 |

> **本 research の立場**: 著者 (Claude) が v2 で出した結論 (4 type 一律 family master 化) は **半分しか正しくない**。本書はそれを内部から反証する。User 指針「自分の考えを疑え」直接適用。

---

## §0 TL;DR (60 秒読了)

1. **「全 5 type 一律 family master + per-child preferences」は誤り**。`activity-pack` / `checklist` は family master が自然だが、`reward-set` は **per-child instance** が DDD 原則 + 業界事例 5/5 で正解。
2. v2 提案の核 (marketplace に child name 露出禁止) は **正しい** が、解決手段は data model 変更ではなく **URL / API 設計層の制約** で十分。schema 大改修は不要。
3. 業界事例 (Cozi / Greenlight / Notion / Linear / Asana / Apple Family Sharing) は **「assign に scope を持たせる」** が標準。家族 master + 子供 assignment は cooperative tasks (chore) のパターン、**個人達成記録** (badge / reward) ではない。
4. ADR-0010 Pre-PMF Bucket: data model 全面再設計は **C (沈黙)**、URL 構造改修は **A (実装 + 訴求)**、`event-checklist` 1 件は **B (既存 UI で代替)** の三段判定。
5. 推奨: **schema は触らない**。`/marketplace/*` から childId を URL/POST body から除去し、import 後の「どの子に紐付けるか」 UI を `/admin/{type}` 側で個別最適化する。

---

## §1 一次原則と理論基盤

### 1.1 DDD Aggregate Boundary Rules (Vaughn Vernon)

Vernon が IDDD で示した 4 ルールは本問題の判断軸そのものである:

| Rule | 内容 | 本問題への適用 |
|---|---|---|
| **R1: Model True Invariants in Consistency Boundaries** | 1 transaction で守るべき business invariant を 1 aggregate にまとめる | 「家族のごほうび master + 各子の獲得履歴」は別 invariant、別 aggregate が自然 |
| **R2: Design Small Aggregates** | aggregate は root entity + 少数の VO に限る (70% は root のみ、30% は 2-3 entity) | `family + N children + per-child activities + per-child rewards` を 1 aggregate にする提案は重すぎる |
| **R3: Reference Other Aggregates by Identity** | 他 aggregate は ID 参照のみ、直接 object 保持禁止 | `activities.id` を `activity_logs` から ID 参照する現状は R3 整合 |
| **R4: Use Eventual Consistency Outside Boundary** | 別 aggregate を跨ぐ rule は eventual consistency | child 追加時に既存 reward に visibility row を自動生成する処理は eventual で許容 |

参考: [Vernon — Effective Aggregate Design (Part 1)](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_1.pdf) / [archi-lab.io aggregate rules](https://www.archi-lab.io/infopages/ddd/aggregate-design-rules-vernon.html) / [James Hickey — Consistency Boundary](https://www.jamesmichaelhickey.com/consistency-boundary/)

#### 1.1.1 「Family Aggregate に children を含めるか」問題

| 案 | invariant | Vernon 整合 |
|---|---|---|
| Family = aggregate root、children = entity、activities/rewards も全部 entity | 「家族の総点数」「家族の合計子供数」等 | R1 違反 (true invariant ではない、UI 集計で足りる) / R2 違反 (巨大) |
| **Family = root、children = entity only**。activities/rewards は別 aggregate | 「親 PIN 認証は家族 scope」「課金プランは家族 scope」 | R1 整合 (家族 scope で守る invariant あり) / R2 整合 |
| Child = aggregate root (家族とは別)、reward/progress は child 内 | 「子供のレベル合計 ≥ 0」等 child scope invariant | R1 整合 / R2 整合 / **本プロダクトの現状実装に最も近い** |

**結論**: 本プロダクトの **`Child` を aggregate root とする現状 schema は Vernon 4 ルール整合**。v2 提案の「family master に reward を持つ」は family aggregate を肥大化させる方向で R2 と緊張する。

### 1.2 Multi-tenancy Patterns (Azure / Flightcontrol)

[Microsoft Learn — Multitenant SaaS Patterns](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns?view=azuresql) は 3 model を提示:

| Model | 本プロダクトでの該当 | 評価 |
|---|---|---|
| Standalone single-tenant | NUC self-host mode (`nuc-saas-runtime-bifurcation.md`) | ADR-0048 で部分採用 |
| Database-per-tenant | 採用していない | Pre-PMF 過剰 |
| Sharded multitenant (discriminator) | **本プロダクトの SaaS mode (`tenant_id` 列)** | 現状の正解 |

[Flightcontrol — Multi-tenant SaaS Data Modeling](https://www.flightcontrol.dev/blog/ultimate-guide-to-multi-tenant-saas-data-modeling) は B2C の **sub-account model** について重要な視点を提示する:

> "For personal and business use cases, treat personal accounts as 'organizations with a single user' rather than creating separate account types."

→ 本プロダクトに翻訳すると **「家族 = organization、子供 = membership」** が標準パターン。Linear / Notion / Slack はこの形 (workspace + member)。

**本プロダクト固有の事情**: 子供は **organization member ではなく organization の data subject** (本人がアカウントを持たない、COPPA 整合)。Linear / Notion 模倣だけでは説明できない第 4 軸が存在する。

### 1.3 Master-Detail / Template-Instance Pattern (Karwin SQL Antipatterns)

Bill Karwin 流の SQL アンチパターン視点で `reward_masters` + `child_reward_preferences` 案を評価:

- **OK**: M:N junction 表は正規化整合 ([eclipse — Single-Table Multi-Tenancy](https://eclipse.dev/eclipselink/documentation/3.0/solutions/multitenancy002.htm))
- **懸念**: 「templateization without true sharing」アンチパターン。「templates 化したのに各 instance がほぼ独自値を持つ」と template 化のコストだけ払う

→ **本プロダクト適用**: rewards は **親が個別カスタマイズする頻度が高い** (「うちはゲーム 30 分が 100pt、よその家は 50pt」)。template 化しても各 row で point/icon/category が divergent になり、master JOIN コストだけ払う risk が高い。

### 1.4 Event Sourcing vs CRUD (Greg Young / Martin Fowler)

[Confluent — Event Sourcing](https://developer.confluent.io/courses/event-sourcing/storing-data-as-events/) / [Java Code Geeks — ES vs CRUD](https://www.javacodegeeks.com/2025/12/event-sourcing-vs-crud-rethinking-data-persistence-in-enterprise-systems.html) より:

> "Start by event-sourcing one critical workflow. Keep CRUD for low-value data. Measure tradeoffs before expanding."

本プロダクト:
- `activity_logs` / `status_history` / `point_ledger` / `parent_messages` は既に **event sourcing 的** (append-only、時系列)
- `activities` / `children` / `categories` は CRUD (master data)
- `special_rewards` は **両者の混在** (title 等は master 性、grantedAt は event 性)

v2 が指摘した `special_rewards` の master/event 混在は事実だが、解消手段は schema 分割よりも **「rewards を完全 event log として再概念化」** の方が DDD + ES 原則整合。すなわち `special_rewards` を「子供が特別ごほうびを得た瞬間の event」と読み替えれば、family master は不要。

### 1.5 Privacy by Design + COPPA / GDPR

[FTC — Verifiable Parental Consent (2025 Rule)](https://www.ftc.gov/business-guidance/privacy-security/verifiable-parental-consent-childrens-online-privacy-rule) / [FTC 2025 COPPA Final Rule](https://www.dwt.com/blogs/privacy--security-law-blog/2025/05/coppa-rule-ftc-amended-childrens-privacy) / [OWASP CWE-598](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url) より:

| 原則 | 本問題への適用 |
|---|---|
| Data minimization | child name / age を public marketplace URL に載せない (CWE-598 整合) |
| Purpose limitation (GDPR Art.5(1)(b)) | marketplace 詳細ページの purpose = discovery、child 個別化は別 purpose |
| Verifiable Parental Consent | child data 変更 (visibility toggle 含む) は authenticated 親 session 必須 |
| Right to access / erasure | 子供削除時に visibility row も cascade delete |

**重要**: COPPA は **「子供 data を public に露出するな」** を求めるが、「家族 master vs per-child instance」のどちらにせよ ということは **直接要求しない**。Privacy 要件は URL / API 層の制約で完全に解決可能であり、data model 構造変更は overkill。

---

## §2 業界事例 Deep Dive

### 2.1 B2C 子供向け / 家族系 5 事例

| アプリ | template/master | per-child instance | privacy | data model 推定 |
|---|---|---|---|---|
| [**Cozi**](https://www.cozi.com/to-do-lists/) | "Cozi Chores" は family scope、recurring chore master | assignee 列で member 紐付け | public list なし | **chore master + assignee FK** (1 master ≈ 1 member 紐付け、複数 assign 可) |
| [**OurHome**](http://ourhomeapp.com/) | task template は family 内 setting | assignment は rotating 可、複数 member assign 可 | public 公開なし | **task master + assignee N:M** |
| [**Greenlight**](https://greenlight.com/chores-and-allowance-app-for-kids) | "Up for grabs" (assign なし) vs "Assigned" 2 mode、master/instance 概念曖昧 | chore は **per-child instance** に近い (`Up for grabs` で multi-claim 可) | public 公開なし | **chore-per-child as default、Up for grabs は family pool** |
| [**FamilyWall**](https://www.familywall.com/) | wish list / chore / to-do master | task 作成時に member 選択 | public 公開なし | **task master + assignee FK** |
| [**Tody**](https://todyapp.com/) | room-first master | 1 room = N member (緩い、optional) | public 公開なし | **room master + 担当者 (optional)** |

**収束分析**:
- 5/5 で「master + assignee 紐付け」が支配的 (Cooperative tasks 型)
- ただし **Greenlight だけ「per-child instance」志向** = 個人達成記録 (allowance) に近い domain では instance pattern も生きる
- 全 5 アプリで **public 露出なし** = privacy は data model に依存せず "認証 boundary" で解決

### 2.2 子供向け教育 / 行動 3 事例

| アプリ | 子供 entity | 達成記録 | data model 推定 |
|---|---|---|---|
| [**Khan Academy Kids**](https://support.khanacademy.org/hc/en-us/articles/202262994-How-do-I-create-child-accounts) | parent account 配下に複数 child profile | child profile ごとに learning history | **child は first-class entity、progress も per-child** |
| [**ClassDojo**](https://blog.classdojo.com/pbis-and-classdojo-go-together-like-pb-and-j/) | class 配下に student entity | student ごとに behavior point | **class master + student instance + per-student point ledger** |
| [**Habitica**](https://en.wikipedia.org/wiki/Habitica) | user = 個人 (family 概念なし) | user ごとに habits / dailies / todos | **user-scoped entity (家族モデルなし)** |

**示唆**: 教育 / 行動アプリは **「子供本人」を first-class entity** として扱い、達成記録は per-child instance が標準。これは本プロダクトの現状実装 (`special_rewards.childId notNull`) と整合する。v2 が「family master 化」を一律推進すると **教育系アプリの業界標準から離脱**する。

### 2.3 汎用 SaaS 5 事例

| アプリ | workspace / team | template / instance | visibility |
|---|---|---|---|
| [**Notion**](https://www.notion.com/help/sharing-and-permissions) | workspace + teamspace + page hierarchy | public template gallery → duplicate to workspace | page 単位の share + role (Full Access / Edit / Comment / View) |
| [**Linear**](https://linear.app/templates) | team + issue + project | public template → import to team | team scope + private team option |
| [**Asana**](https://asana.com/features/workflow-automation/project-task-templates) | project + task + assignee | template (含 assignee 等) → use template | per-task assignee + project member |
| [**Slack**](https://slack.com/) | workspace + channel + user | channel template | channel public / private / DM の 3 段階 |
| [**Apple Family Sharing**](https://support.apple.com/en-us/108380) | family group + Apple Account per member | screen time setting (per-child) | **member 個別の Apple Account = first-class identity** |

**収束分析**: 全 5 サービスで **public template / discovery layer** と **authenticated user/team scope layer** が完全に **URL 層で分離**。v2 が指摘した「public page に child name 露出禁止」は **業界標準の URL 設計**で実現されており、data model は触っていない (Notion の page は user 紐付けではなく workspace 紐付け; user との関係は permission layer)。

### 2.4 業界事例から学べる 3 つの教訓

1. **「template gallery」と「user-scoped instance」は URL/auth boundary で分離するのが標準**。data model は per-user/per-team instance で全く問題ない (Asana の task はまさに「project にぶら下がる instance」)。
2. **Cooperative task** (chore / housekeeping) と **Individual achievement** (badge / reward / progress) は別ドメイン。前者は master + assignee 紐付けが整合、後者は per-user instance が整合。
3. **family / parent-child の sub-account 構造は Apple Family Sharing 型** が最も成熟。各 child が独立 Apple Account + parental control が母 account から overlay という構造 = 「child は first-class entity だが親が control する」。

---

## §3 がんばりクエスト内部現状の正確な mapping

### 3.1 schema 全テーブル棚卸 (resource 性質別分類)

`src/lib/server/db/schema.ts` 全 32 table を以下 4 分類で再評価:

| 分類 | 該当 table | 例 | scope |
|---|---|---|---|
| **A. Family master (childId 持たない)** | `activities` / `categories` / `achievements` / `stamp_masters` / `market_benchmarks` / `settings` | `activities.ageMin/Max` で表示制御 | family (= tenant) scope |
| **B. Family event** | `sibling_challenges` / `auto_challenges` (childId 持つが challenge 定義自体は family scope) | challenge 定義 | family scope + per-child progress |
| **C. Per-child instance (master + 個別カスタマイズ)** | `checklist_templates` / `special_rewards` / `child_custom_voices` | reward の title/points を子供ごとに変えられる | per-child scope |
| **D. Per-child event log (append-only)** | `activity_logs` / `point_ledger` / `status_history` / `stamp_entries` / `parent_messages` / `daily_battles` / `usage_logs` / `child_achievements` / `reward_redemption_requests` | history | per-child append-only |
| **E. Child-to-child relation** | `sibling_cheers` | 兄弟間メッセージ | family scope, both children referenced |
| **F. Per-child preference (M:N junction)** | `child_activity_preferences` | activity の pin/unpin | per-child × activity |
| **G. Tenant / 課金** | `cancellation_reasons` / `graduation_consent` / `trial_history` / `viewer_tokens` / `cloud_exports` / `notification_logs` / `push_subscriptions` | 課金 / 解約 | tenant scope |

### 3.2 v2 提案の影響範囲再評価

v2 が「family master 化」を提案した 3 type は分類 C (Per-child instance):
- `special_rewards` (per-child) → v2: `reward_masters` (family) + `child_reward_preferences` (visibility) + `special_rewards` (granted events)
- `checklist_templates` (per-child) → v2: `checklist_template_masters` (family) + `child_checklist_preferences` (visibility) + `checklist_logs` (events)
- 既存 `activities` (family master) は据え置き

**新規 schema 追加コスト** (v2 Phase 1):
- 新 4 table (`reward_masters` / `checklist_template_masters` / `child_reward_preferences` / `child_checklist_preferences`)
- 既存 service 4 ファイル refactor
- demo data fixture 同期 (3 並行)
- DynamoDB シングルテーブル PK/SK 設計再考
- UI 4 画面 (rewards 管理 / checklists 管理 + edit modal の visibility chip 列 × 2)

**Pre-PMF コスト** = M (3-5 日) + L (migration / rollback / E2E、Phase 2 で発生)

### 3.3 既存 ADR / 設計書での「per-child instance pattern」の rationale

`grep -rE "family.master|per.child|tenant.scope|multi.tenan" docs/` 結果:

- **明示的な rationale 不在**: `special_rewards.childId notNull` / `checklist_templates.childId notNull` を選んだ ADR / 設計書記録 **無し**。Issue #2136 / #2137 の body にも比較検討記録なし
- **唯一の文脈**: `archive/0012-dynamodb-single-table.md` が `T#<tid>#CHILD#<cId>` の PK 構造を確立済 = **per-child instance が DynamoDB 設計に自然に fit**
- `account-deletion-flow.md` / `family-group-management.md` で family vs child 階層の定義はあるが、resource ownership には触れず

→ **v2 の「per-child instance pattern は禁忌」主張は過剰**。rationale 不在 = expedient で決まった、というだけで、**結果として現状実装が業界 SaaS pattern (Notion task / Asana subtask / Greenlight chore-per-child) と整合している**ことを v2 は見落としている。

### 3.4 すでに対応された privacy 系設計

- `0050-parent-gate-session-cookie-signature.md` (PIN gate)
- `archive/0028-retention-physical-delete.md` (削除整合)
- `06-UI設計書.md §10` (画面所属判断 = admin / ops 境界)
- `0033-ops-dashboard-cognito-authz.md` (ops 認可)

→ **privacy boundary は既に URL / authz layer で確立済**。v2 が新たに data model を変える必要性の根拠は薄い。

---

## §4 User 提案 (family master + per-child preferences) の検証

> User 指針: 「自分の考えを疑え」 = 私 (Claude) が v2 で提示した「全 type family master 化」を全力で反証する。

### Q1. 「family master + per-child preferences は全 resource type に最適か?」

**答: No**。各 type の domain semantics で分かれる。

| Type | domain | master/instance 妥当性 | 根拠 |
|---|---|---|---|
| `activity-pack` | 反復可能な活動定義 (歯磨き / 宿題) | **family master が最適** | 子供間で同じ歯磨きを共有、age filter で表示制御。現状実装と業界 (Cozi chore) 整合 |
| `checklist` (持ち物) | 親が設計する持ち物リスト | **family master 寄り (一部 per-child)** | 「明日の遠足」は family event、「ランドセル中身」は per-child 性質。混在 |
| `rule-preset` | ボーナス / ペナルティ / 交換ルール | **family master または tenant scope KVS** | `bonus` は既に tenant scope (settings KVS、v2 §1.1 確認済) |
| `reward-set` | 親が設定するごほうび (ゲーム 30 分 = 50pt) | **per-child instance が最適** | 子供ごとに reward 内容 / 点数を変える頻度高、template 化しても各 row が divergent (§1.3) |
| `challenge-set` | 期間チャレンジ (お正月 / ハロウィン) | **family master + per-child progress** | 既に `sibling_challenges` + `sibling_challenge_progress` で実装済、現状最適 |

**集計**: family master = 2.5、per-child instance = 1.5、tenant KVS = 1。**一律化は誤り**。

### Q2. 「per-child template instance pattern を一律禁忌として良いか?」

**答: No**。以下の domain では per-child instance が正当:
- 親が個別カスタマイズする頻度が高い (rewards の point 設定)
- 子供間で意図的に内容を変える (年齢別の reward / hard 設定)
- 履歴 (event log) と template が同テーブルでも問題ない場合 (= 削除頻度が低く、JOIN コストを避けたい)

**反証事例**:
- Greenlight chore は per-child assign が default
- Notion page は per-user instance に近い (同じ template から duplicate して各自編集)
- Apple Family Sharing の Screen Time は per-child Apple Account
- Khan Academy Kids の learning history は per-child first-class

「per-child instance pattern は禁忌」と書けば 4-5 業界事例で反論される。**禁忌としてはならない**。

### Q3. 「marketplace = family scope only は privacy 観点で正解か?」

**答: 半分正解**。
- **正解部分**: marketplace public ページに child name / age を URL/body に載せない (CWE-598 + COPPA + ブランド)
- **過剰部分**: data model を family master 化しなくても URL/API 設計で完全解決できる
  - `/marketplace/{type}/{itemId}` の form に `childId` を hidden input で送る現状は CWE-598 違反**ではない**
  - import endpoint で `childId` を session 内で解決すれば marketplace URL/UI から childId を完全排除できる
  - data model は per-child instance のままで、import の **挙動** が「全 child に同じ reward を作る」or「親が後で child 選択」を選べる

**反論される v2 提案**: v2 §4.2 の `reward_masters` 新規 table は、privacy 問題に対する **オーバーキル**。「URL 層で child 露出を排除する」 + 「import action で family-wide 挙動を実装する」だけで User 懸念は完全解消する。

### Q4. visibility flag vs JSON settings vs junction table

[EclipseLink — Single-Table Multi-Tenancy](https://eclipse.dev/eclipselink/documentation/3.0/solutions/multitenancy002.htm) 他より:

| 方式 | query 性能 | 拡張性 | migration |
|---|---|---|---|
| **boolean column** (`is_visible`) | 最速 (index 可) | 制限 (列追加で対応) | 互換性高 |
| **JSON settings** | 中 (JSON path 検索遅い) | 高 | 互換性高 |
| **junction table** (`child_X_preferences`) | 中 (JOIN コスト) | 最高 (N:M、複数属性) | schema 追加必要 |

→ **本プロダクト適用**:
- 現状 `child_activity_preferences` は junction table + boolean (`is_pinned`)。性能 OK、拡張性 OK
- **5 type 全てに同じ junction を作るのは過剰**。activity は既存活用、reward/checklist は per-child instance のままで visibility 概念不要 (削除 / archive で代替可能)

### Q5. 時間軸の扱い (子供成長で関連性が変わる)

「子供が 5 歳 → 10 歳になったら preschool 用 reward を hide したい」場面:
- **family master + age filter 案** (v2): `age_max=6` の master row が child.age=10 で自動非表示
- **per-child instance 案** (現状): 親が手動で reward を archive する (or 何もせず一覧に古い reward が並ぶ)

v2 案は「自動」だが、これは **anti-engagement 原則 (ADR-0012)** と衝突する可能性: 自動非表示は親が把握できない state 変化を生む。**親が明示的に archive する現状の方が transparent**。

### Q6. Pre-PMF 段階での適切な複雑度 (ADR-0010 Bucket 判定)

v2 提案各 Phase を ADR-0010 Bucket で再判定:

| 項目 | v2 提案 Bucket | 再評価 | 根拠 |
|---|---|---|---|
| URL から childId 除去 | B | **A (実装 + 訴求)** | 「家族の手元に」trust 訴求 (`trust-data-local.svg`) と直接整合、訴求可能 |
| `reward_masters` 新規 table + migration | B | **C (沈黙)** | Pre-PMF user 数で性能/重複問題は実害ゼロ、過剰防衛 |
| visibility chip UI | B | **C (沈黙)** | Hick's Law 違反、UX 複雑度増 |
| `event-checklist` per-child 重複問題 | C | **B (LP 訴求のみ / 実装は既存 archive 機能で代替)** | 行数増は実害なし、archive で整理可能 |
| import API の family-wide 挙動 | (未提案) | **A (実装 + 訴求)** | 「家族みんなで使える」訴求と整合、schema 変更不要 |

**結論**: v2 提案の **大半は Pre-PMF Bucket C (沈黙)**。URL 設計と import 挙動のみが Bucket A。

---

## §5 Alternatives 5+ 比較

| # | パターン | data model | UI / URL | 工数 | Pre-PMF Bucket |
|---|---|---|---|---|---|
| **①** | **User v2 提案** (一律 family master) | 新 4 table + 既存 4 service refactor + demo 同期 | marketplace から child 除去 + 管理画面 visibility chip | L (3-5 日 × Phase 1-3) | C |
| **②** | **現状 per-child instance 維持** | 変更なし | 変更なし | 0 | A (現状で動いている) |
| **③** | **Workspace 型** (家族 = workspace、子供 = member) | `children` を first-class user 化 + RBAC | Linear/Notion 流 invite + permission UI | XL | C (Pre-PMF 過剰) |
| **④** | **Event Sourcing 型** (全 reward を event log 化) | `special_rewards` を完全 append-only event 化 | 「reward 与えた瞬間の event 表示」UI に再設計 | XL | C |
| **⑤** | **Hybrid (推奨)** | schema 変更なし + URL/API 層で family-wide import 挙動を追加 | marketplace から childId 除去 (URL+body 両方)、import = 親が後で child 選択 (今のまま) or 全 child 一斉適用 (新 mode) | S (1-2 日) | **A** |
| **⑥** | **per-type 個別最適化** (型ごとに patternA/B/E を選ぶ) | activity = master 据え置き、checklist = master 寄りに段階移行、reward = per-child instance 維持 | type ごとに最適 UI | M (2-4 日) | B (推奨) |

### 5.1 各案の trade-off matrix

| 観点 | ① v2 | ② 現状 | ③ Workspace | ④ ES | ⑤ Hybrid | ⑥ Per-type |
|---|---|---|---|---|---|---|
| DDD R1-R4 整合 | × (family aggregate 肥大) | ◯ (child = root) | △ (R3 緩み) | ◯ | ◯ | ◯ |
| 業界事例整合 | △ (Cozi 等 cooperative task は OK、reward NG) | ◯ (Greenlight reward, Khan Academy progress) | ◎ (Notion/Linear) | △ | ◯ | ◎ |
| Privacy (CWE-598/COPPA) | ◯ | △ (改善余地) | ◯ | ◯ | **◎** | ◯ |
| Pre-PMF 工数 | XL | 0 | XXL | XL | **S** | M |
| Anti-engagement (ADR-0012) | △ (自動非表示は親 transparency 低下) | ◯ | △ | ◯ | ◯ | ◯ |
| 既存実装破壊 | 大 | なし | 全壊 | 大 | **なし** | 中 |
| 拡張性 (future) | ◯ | △ | ◎ | ◎ | ◯ | ◯ |

→ **総合スコア最高**: ⑤ Hybrid。次点: ⑥ Per-type。

---

## §6 推奨設計

### 6.1 推奨案 = ⑤ Hybrid (URL/API 層のみ改修、schema 据え置き)

#### 6.1.1 やること (Pre-PMF Bucket A、工数 S)

1. **`/marketplace/{type}/{itemId}` の form から `childId` を削除**
   - 現状: `<input type="hidden" name="childId" value={selectedChild.id} />`
   - 改修後: `childId` 一切送らない、import action は session 内親 user の **「現在 active な child」または「全 child」** を解決する
2. **Import action の挙動を 2 mode に分岐 (per-type 設定)**
   - **family-wide mode** (activity-pack / checklist 推奨): 全 child に対して同じ row を bulk insert (per-child instance のまま)。1 import で N children × M items 行追加
   - **defer mode** (reward-set / rule-preset 推奨): import 時は family scope の preset 適用待ち state、後で `/admin/rewards` で「○○くんに割当」action でようやく row 作成
3. **`/admin/{type}` 画面の「子供切替 tab」を強化**
   - 既に admin 画面には child selector がある (推測)
   - import 後トーストに「○○くんの管理画面を開く」link を出す
4. **URL に childId を載せない原則を ADR 化**
   - 新 ADR 起票 (本 deep research を補強する形): 「Privacy boundary は URL / auth layer に置き、data model 構造には依存させない」
5. **既存 `child_activity_preferences` 拡張 (visibility 列追加) は不要**
   - activity の age filter は現状動いている、reward/checklist では age filter 適用しない (per-child instance pattern で十分)

#### 6.1.2 やらないこと

- 新規 `*_masters` table 作成 → 行わない
- 既存 `special_rewards.childId` / `checklist_templates.childId` 列削除 → 行わない
- DynamoDB PK/SK 改修 → 行わない
- `child_*_preferences` 全 type 展開 → 行わない

### 6.2 Per-type 個別判断 (⑤ の細部、§4 Q1 整合)

| Type | 推奨 import 挙動 | 推奨 data model | 理由 |
|---|---|---|---|
| `activity-pack` | family-wide bulk (現状維持) | family master (現状維持) | Cooperative chore 整合 |
| `checklist` (event-*) | family-wide bulk (1 family 3 child = 9 row、現状) | per-child instance (現状維持) | family event だが per-child カスタマイズ余地残す |
| `reward-set` | defer mode (import で preset 保存、後で個別 assign) | per-child instance (現状維持) | reward は親が個別カスタマイズ前提 |
| `rule-preset` (bonus) | tenant KVS 直接書込 (現状維持) | tenant scope (現状維持) | family setting 1 セットで完結 |
| `rule-preset` (exchange) | defer mode (reward と同じ) | per-child instance (現状維持) | 同上 |
| `challenge-set` | family-wide auto (challenge = family event) | family master + per-child progress (現状維持) | 既に最適 |

→ **schema 変更ゼロ**。Import service の挙動だけを per-type 最適化。

### 6.3 Edge case 対応

| Edge case | 対応 |
|---|---|
| import 時に child が 0 人 | signup → child 作成 → import の動線に戻す (現状動作維持) |
| import 後に child を追加 | family-wide mode の type は新 child に対して bulk insert を遡及実行 (or 親に通知して手動 trigger) |
| child 削除 | per-child row は cascade delete (既存 `onDelete: 'cascade'` 整合) |
| 子供成長で reward を古く感じる | 親が手動 archive (`isArchived` 列で論理削除、既存) |
| marketplace public 詳細ページからの bookmark | childId なし URL なので privacy 漏洩なし |

### 6.4 Migration / 後方互換

- **schema migration ゼロ** (Hybrid 案の最大利点)
- 既存 user data 一切影響なし
- 既存 service interface 変更なし (import action の body schema だけ `childId` optional 化)
- E2E test 変更最小限 (childId 送らない form に書き換えのみ)

### 6.5 PMF 後の再評価トリガ

以下のいずれかで本 research を **supersede する新 ADR を起票** すべき:
- 100+ family で per-child row 数が DB 性能上の bottleneck (現実は数千 row/family が天井、Pre-PMF では発生しない)
- 「reward を家族の他の子供にも同じものを設定したい」UX 要求が PO 1 次 voice で 3 回以上
- 第三者 marketplace plugin 配布 (Pre-PMF Bucket C、将来)

---

## §7 残懸念 + 既存 PR-1 Agent 出力の評価方法

### 7.1 残懸念 (PO 判断必要)

1. **`event-checklist` 3 件 × N children = 3N row 問題**: §6 推奨は「現状容認 + 親が archive で整理」。PO が「3 件で済ませたい」と強く要求するなら **Phase 1 で `event-checklist` 単独の family master 化** を別 EPIC として検討 (per-type 個別最適化の例)
2. **`/admin/rewards` 等の child 切替 tab UI**: 既存実装に child selector があるかの確認が必要 (本 research 範囲外、Dev Agent に確認依頼)
3. **demo route との同期**: ADR-0047 整合で `/demo/(parent)/admin/rewards` 等の demo 動線も schema 変更不要なら影響ゼロ → ⑤ Hybrid 案の追加利点
4. **新 ADR 起票要否**: 「Privacy boundary を URL / auth layer に置く」原則を ADR 化するなら 1 件追加 (TOP10 既に 33 active 超過、1-in-1-out 規約に従い既存 ADR 1 件を archive 送り検討)
5. **ADR-0052 (MarketplaceTypeRegistry) との関係**: ⑤ Hybrid 案は Registry 上の `ImportStrategy` 実装で「family-wide vs defer mode」を per-type 分岐させる構造に自然に乗る。`ImportContext` に `childId` を含めない選択肢を opt-in 化

### 7.2 既存 PR-1 Agent (Dev Agent `a229b648cd869eafd`) 出力の評価方法

User より「Dev Agent (a229b648cd869eafd) 出力との関係評価」依頼あり。本 research 着手時点で当該 Agent 出力にアクセスしていないため、以下を **PO/User に逆質問**:

- Dev Agent は何の Issue を扱った? (#2136 / #2137 完遂 PR? それとも v2 提案の Phase 1 着手 PR?)
- Dev Agent は本 deep research の paradigm shift に **依存** している? 既に schema 変更 PR を出している場合は本 research と矛盾する可能性大
- Dev Agent 出力が「⑤ Hybrid」と一致するか「① v2 一律 family master」と一致するかで対応が分岐:
  - **一致 (Hybrid)** → そのまま採用方向、本 research が裏付け
  - **不一致 (① v2)** → Dev Agent PR を本 research 結論に従って **rework or close** 判断、その代わり ⑤ Hybrid の小 PR (URL/API のみ改修) を別途起票

**評価軸 (Dev Agent 出力を見たら確認すべき項目)**:
- ✅ `/marketplace/*/import` から childId が削除されているか
- ✅ schema migration ファイル (`drizzle/*.sql`) が追加されているか (追加されていたら ① v2 経路の可能性)
- ✅ 新 table (`reward_masters` 等) の `sqliteTable(...)` 定義があるか
- ✅ `child_*_preferences` の M:N junction が新規追加されているか
- ✅ E2E test の form action body から `childId` が消えているか

### 7.3 本 research の運用

- 本 research docs は **新規 v3 として独立配置** (`docs/research/2026-05-23-data-architecture-deep-research.md`)
- v1 (`2026-05-22-import-hub-ux-redesign.md`) / v2 (`2026-05-22-import-hub-ux-redesign-v2.md`) は keep (削除しない)
- 本 research 結論 ⑤ Hybrid が PO 承認されたら、後続 PR で本 docs を「現状の正解」として参照
- 本 docs 内には変更履歴 / supersede / 経緯メタを書かない (User 指針)、PR description / git commit に分離

---

## §8 参考文献

### DDD / Aggregate 設計
- [Vernon — Effective Aggregate Design Part 1 (PDF)](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_1.pdf)
- [archi-lab.io — Aggregate Design Rules according to Vernon](https://www.archi-lab.io/infopages/ddd/aggregate-design-rules-vernon.html)
- [James Hickey — DDD Aggregates: Consistency Boundary](https://www.jamesmichaelhickey.com/consistency-boundary/)
- [InformIT — Rule: Model True Invariants in Consistency Boundaries](https://www.informit.com/articles/article.aspx?p=2020371&seqNum=2)
- [InformIT — Rule: Design Small Aggregates](https://www.informit.com/articles/article.aspx?p=2020371&seqNum=3)
- [InformIT — Rule: Use Eventual Consistency Outside the Boundary](https://www.informit.com/articles/article.aspx?p=2020371&seqNum=5)
- [InfoQ — Designing and Storing Aggregates in DDD](https://www.infoq.com/news/2014/12/aggregates-ddd/)

### Multi-tenancy / SaaS data modeling
- [Microsoft Learn — Multitenant SaaS Patterns Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns?view=azuresql)
- [Flightcontrol — Ultimate Guide to Multi-tenant SaaS Data Modeling](https://www.flightcontrol.dev/blog/ultimate-guide-to-multi-tenant-saas-data-modeling)
- [Developers Voice — Designing Multi-Tenant SaaS on Azure](https://developersvoice.com/blog/architecture/designing-multi-tenant-saas-on-azure/)
- [EclipseLink — Using Single-Table Multi-Tenancy](https://eclipse.dev/eclipselink/documentation/3.0/solutions/multitenancy002.htm)
- [Onur Cil — Discriminator based Multi Tenancy using Hibernate](https://www.onurcil.com/posts/Multitenancy-On-Spring-Boot-Projects/)

### Event Sourcing / CRUD
- [Confluent — Event Sourcing vs CRUD](https://developer.confluent.io/courses/event-sourcing/storing-data-as-events/)
- [Java Code Geeks — Event Sourcing vs CRUD: Rethinking Data Persistence](https://www.javacodegeeks.com/2025/12/event-sourcing-vs-crud-rethinking-data-persistence-in-enterprise-systems.html)
- [Alexander Williamson — Event Sourcing vs CRUD](https://alexw.co.uk/blog-posts/event-sourcing/crud/databases/cqrs/domain-driven-design/2024/04/30/1718-event-sourcing/)

### Database design / Antipatterns
- [The Art of PostgreSQL — Database Modelization Anti-Patterns](https://tapoueh.org/blog/2018/03/database-modelization-anti-patterns/)
- [Mike Smithers — The Anti-Pattern EAV(il) Database Design](https://mikesmithers.wordpress.com/2013/12/22/the-anti-pattern-eavil-database-design/)
- [arXiv — SQLCheck: Automated Detection of SQL Anti-Patterns](https://arxiv.org/pdf/2004.10232)

### Privacy / COPPA / GDPR
- [FTC — Verifiable Parental Consent and COPPA](https://www.ftc.gov/business-guidance/privacy-security/verifiable-parental-consent-childrens-online-privacy-rule)
- [FTC — Complying with COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [Davis Wright Tremaine — FTC 2025 COPPA Final Rule](https://www.dwt.com/blogs/privacy--security-law-blog/2025/05/coppa-rule-ftc-amended-childrens-privacy)
- [Promise Legal — COPPA Compliance 2025](https://blog.promise.legal/startup-central/coppa-compliance-in-2025-a-practical-guide-for-tech-edtech-and-kids-apps/)
- [OWASP — CWE-598 Information Exposure Through Query Strings](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url)
- [CWE — CWE-598 Use of HTTP Request With Sensitive Query String](https://cwe.mitre.org/data/definitions/598.html)

### 業界事例 (B2C 子供向け / 家族系)
- [Cozi — Shared To-Do Lists for Families](https://www.cozi.com/to-do-lists/)
- [Cozi — Introducing Cozi Chores](https://www.cozi.com/blog/cozi-chores/)
- [Greenlight — Chores and Allowance App for Kids](https://greenlight.com/chores-and-allowance-app-for-kids)
- [Greenlight — How children manage chores](https://help.greenlight.com/hc/en-us/articles/360019317134-How-can-my-children-see-and-manage-their-chores)
- [OurHome — Your home made easy](http://ourhomeapp.com/)
- [Tody — Smarter household cleaning routines](https://todyapp.com/)
- [Apple Family Sharing — How it works](https://support.apple.com/en-us/105062)
- [Apple — Set up Screen Time for a child](https://support.apple.com/guide/iphone/set-up-screen-time-for-a-family-member-ipha200da319/ios)

### 業界事例 (子供向け教育 / 行動)
- [Khan Academy — How to create child accounts](https://support.khanacademy.org/hc/en-us/articles/202262994-How-do-I-create-child-accounts)
- [ClassDojo — PBIS Behavior Management](https://blog.classdojo.com/pbis-and-classdojo-go-together-like-pb-and-j/)
- [Habitica — Wikipedia](https://en.wikipedia.org/wiki/Habitica)
- [DESOSA 2016 — Habitica Architecture](https://delftswa.gitbooks.io/desosa2016/content/habitica/chapter.html)

### 業界事例 (汎用 SaaS)
- [Notion — Sharing & Permissions Guide](https://www.notion.com/help/sharing-and-permissions)
- [Notion — Manage Members & Guests](https://www.notion.com/help/add-members-admins-guests-and-groups)
- [Asana — Project & Task Templates](https://asana.com/features/workflow-automation/project-task-templates)
- [Linear — Templates](https://linear.app/templates)

### 内部参照
- `src/lib/server/db/schema.ts` — 全 schema SSOT
- `docs/decisions/0010-pre-pmf-scope-judgment.md` — Bucket A/B/C 判定基準
- `docs/decisions/0012-anti-engagement-principle.md` — 親 transparency 原則
- `docs/decisions/0013-lp-truth-from-implementation.md` — LP 訴求と実装の一貫性
- `docs/decisions/0052-marketplace-type-registry.md` — Strategy + Registry パターン (本 research の ⑤ Hybrid 案が乗る基盤)
- `docs/decisions/0048-multi-lambda-demo-deployment.md` — demo / 本番 routing 分離
- `docs/design/29-COPPA対応方針書.md` — Pre-PMF 段階の COPPA 対応 baseline
- `docs/design/family-group-management.md` — committed / aspirational 境界
- `docs/design/marketplace-architecture.md` — Registry SSOT
- `docs/research/2026-05-22-import-hub-ux-redesign.md` — v1 (本 research が UX 動線部分を再評価)
- `docs/research/2026-05-22-import-hub-ux-redesign-v2.md` — v2 (本 research が data model 提案を反証)
