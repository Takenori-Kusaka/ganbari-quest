# Import Hub UX 再設計 v2 — 「家族 master + per-child visibility」一次原則の検証

| 項目 | 内容 |
|---|---|
| 起票日 | 2026-05-22 (v2: 2026-05-23 着手) |
| 起票者 | PO (takenori.kusaka@gmail.com) |
| 種別 | research / paradigm shift |
| 関連 EPIC | #2362 (UnifiedImportHub 統一)、Marketplace EPIC #2135 |
| Issue 起票 | **不要** (本研究自体が成果物、PR レビューで PO 判断) |
| v1 | [`docs/research/2026-05-22-import-hub-ux-redesign.md`](./2026-05-22-import-hub-ux-redesign.md) — keep (参考価値あり、ただし前提崩壊) |
| 目的 | User 提案「家族 master + 各管理画面で per-child visibility toggle」の裏付け / 反証 + 設計案再構築 |

---

## §0 v1 からの paradigm shift

### v1 が前提にしていたこと

v1 (§3.3 marketplace sequence) は **「marketplace 詳細画面の CTA 直前で child 選択を inline 行う」(Pattern E)** を最終形として提案した。これは Linear / Asana / Cozi の「import 動作の手前で scope 選択」業界標準と整合する。

### User が指摘した懸念

> **マーケットプレイスと家族グループの関係に子供の概念を持ち込むと**、未認証でも閲覧できる marketplace 機能に **子供情報が渡るような UI** にならざるを得ず、結果的にユーザから見ると **「子供の情報が public マーケットプレイスに流出している」と誤認される懸念** が生じる。

User の正しい指摘:
- marketplace `/marketplace` 一覧は public (未認証アクセス可)
- marketplace 詳細 `/marketplace/[type]/[itemId]` も public (未認証で閲覧可、CTA で signup 誘導)
- v1 提案 では import CTA 直前で child を選ぶため、**詳細画面 = authenticated UI と未認証 UI の混在**、結果として「child 名のプルダウンが marketplace 文脈に居る」状態

### v2 paradigm shift

v1 は **UX 動線の連続性** を優先したが、user 提案は **「marketplace = 家族 scope の resource discovery、child × resource の visibility は別 UI で完結する」** という関心分離 (SoC) を選ぶ。

| 観点 | v1 | v2 (user 提案) |
|---|---|---|
| marketplace の認知モデル | resource shopping (どの子に何を買うか) | resource discovery (家族のリソースに何を加えるか) |
| child × resource の binding 場所 | marketplace 詳細 CTA inline | 各管理画面の per-child visibility toggle |
| public UI に child name の露出 | 必要 (Pattern E) | **不要** (Pattern Y) |
| 既存 activities テーブル設計との整合 | 不整合 (activities は family master、reward/checklist は per-child) | **整合** (4 type すべてを family master + per-child progress / visibility に統一) |

v2 は **既存 `activities` テーブルの設計思想を 4 type 全体に拡張する一次原則** を提示する。

---

## §1 一次原則 — 「家族 master + per-child progress / visibility」

### §1.1 既存 schema の事実 (`src/lib/server/db/schema.ts`)

| テーブル | scope | child binding | 行数 / 設計時期 |
|---|---|---|---|
| `activities` (L46) | **family master** | なし (`ageMin/ageMax` で表示制御) | core schema、`source_preset_id` (#1254 G1) |
| `child_activity_preferences` (L480) | **per-child × activity** | `(childId, activityId)` unique | `isPinned` のみ実装、**visibility 用に拡張可** |
| `activity_logs` (L83) | per-child progress | `(childId, activityId, recordedDate)` | core schema |
| `special_rewards` (L316) | **per-child** | `childId notNull` | `source_preset_id` (#1254 G1) |
| `checklist_templates` (L366) | **per-child** | `childId notNull` | `source_preset_id` (#1254 G1) |
| `checklist_template_items` (L390) | per-template (= per-child) | indirect via `templateId` | — |
| `rule-preset bonus` (settings KVS) | **tenant scope** | なし | `+page.server.ts:180` で「bonus: childId 不要」 |
| `rule-preset exchange` (special_rewards 経由) | per-child | `childId notNull` | 同上 |
| `challenges` (challenge-set) | family master + per-child progress | `sibling_challenge_progress.childId` | core schema |

### §1.2 一次原則の定式化

**家族グループに登録されているリソース** = **family master テーブル** (childId なし、`source_preset_id` 持ち、age filter or visibility toggle で per-child 表示制御)

**どっちの子供向けに表示するしないのコントロール** = **per-child × resource の visibility 表** (`child_X_visibility` または既存 `child_activity_preferences` 拡張)

**子供のごほうび履歴 / チェックリスト記録 / 活動ログ** = **per-child progress テーブル** (履歴系は当然 per-child、master とは別)

### §1.3 現状の不整合 (paradigm shift で解消する対象)

`activities` は L1 原則を既に体現している (family master + `child_activity_preferences` 拡張ポイントあり) が、`special_rewards` / `checklist_templates` は **master と progress を混在** している:

- `special_rewards.title` (master 情報) と `special_rewards.grantedAt` (progress 情報) が同テーブル
- `checklist_templates` の template 自体が per-child (本来 family master + per-child visibility が自然)
- `event-checklist` 3 件 (#2137) も 1 family に 3 子供いれば **9 行に増殖** (family-master なら 3 行で済む)

この不整合は **設計時期 (`source_preset_id` 整備が #1254 G1 = 2025 末)** に起因した expedient で、Issue #2136 / #2137 の `body` を確認しても「family master vs per-child」の比較検討は記録されていない。

---

## §2 競合分析 v2 — privacy 観点を加えた業界 8 事例

v1 §1 (UX 動線) に **privacy / 公開ページでの user data 露出** という観点を加えて再評価する。

### §2.1 子供 / 家族向けタスク管理アプリ

| アプリ | template gallery | child scope 選択 | public ページに child 露出 | data model 推定 |
|---|---|---|---|---|
| **Cozi** | List Library (premade) は **authenticated 内部 UI** のみ。public 経路なし | リスト追加時にメンバー pin (post-import) | なし | リスト master + member 紐付け |
| **OurHome** | テンプレートライブラリは **設定経由の authenticated 内部 UI** | chore 作成時に assign-to-member (post-import) | なし | chore master + assign 表 |
| **Greenlight** | **テンプレート概念なし**。"Up for grabs" (assign なし) vs "Assigned" 2 mode | chore 作成時 (authenticated) | なし | chore master + per-child assignment |
| **FamilyWall** | wish list / chore / to-do の **authenticated 内部 UI** で家族メンバーに assign | task 作成時に member 選択 (post-import) | なし | task master + assignee 紐付け |
| **Tody** | room-first chore library。room template は **authenticated 内部 UI** のみ | 1 room = 1-N member (緩い) | なし | room master + 担当者 (任意) |

**収束パターン**: 子供 / 家族向けアプリは **5/5 すべて authenticated 内部 UI でテンプレート提示 → post-import で per-child / per-member 紐付け**。public ページに child name の露出は **0/5**。

### §2.2 汎用 productivity / workspace (privacy 視点)

| アプリ | public template gallery の存在 | gallery → workspace import 時の scope 選択 | public ページに user data 露出 |
|---|---|---|---|
| **Notion** | あり ([notion.com/templates](https://www.notion.com/templates)) | gallery は **anonymous で browse 可**、`Duplicate` clicked 時に workspace 選択は **authenticated session の workspace switcher** | なし (template page には workspace 名すら載らない) |
| **Asana** | あり ([asana.com/templates](https://asana.com/templates)) | gallery anonymous browse 可、`Use template` → 認証フロー → 認証後の workspace 内 modal で team 選択 | なし |
| **Linear** | あり ([linear.app/templates](https://linear.app/templates)) | 同上 | なし |
| **Trello** | あり ([trello.com/templates](https://trello.com/templates)) | 同上 | なし |
| **VSCode Marketplace** | あり (`marketplace.visualstudio.com`) | gallery 別ホスト、`Install` で local IDE が認証済み user の `~/.vscode` に書き込み | なし (extension 詳細ページに user 情報なし) |

**収束パターン**: 汎用 SaaS は **5/5 すべて public gallery → 認証フロー → 認証後 UI で workspace/team 選択**。**public 詳細ページに user-specific data (member 名 / workspace 名) を露出する例は 0/5**。

### §2.3 v1 §1 で見落とした事象

v1 §1.2 で「Linear (issue create modal 内 team 選択) / Asana (template apply 時 team) / Cozi (list 追加時 member 選択)」を Pattern E (import 動作の手前 inline 選択) の根拠として挙げたが、これらはすべて **authenticated UI** (modal が authenticated session の workspace switcher 経由) であり、**public template gallery ページ上で team / member プルダウンを露出している例は 1 件もない**。v1 はこの差を見落とした。

がんばりクエストの現状実装 (`marketplace/[type]/[itemId]/+page.svelte`) は **`isAuthenticated` で分岐し、未認証なら children を空配列で出して signup 誘導** という防御を入れているため (`+page.server.ts:50`)、**現時点で未認証 user に child 名は露出していない**。しかし v1 提案の Pattern E inline 選択を強化すると、authenticated state の child 名が UI 全体を支配し、誤認リスクが高まる (User 指摘の core)。

---

## §3 Privacy 観点 — COPPA / GDPR / OWASP 観点

### §3.1 COPPA / GDPR Article 8 観点

がんばりクエストはターゲット年齢 3-18 歳 (ADR-0011)、家庭内専用 (ADR-0010)。**子供本人の data を public 配信していない** ため、現状 COPPA / GDPR Article 8 の収集制限規制には**直接抵触しない**。ただし以下のリスクは要件として明示すべき:

1. **「子供の情報が public マーケットプレイスに流出している」と誤認されるリスク** (User 指摘) — 法的リスクではなくブランドリスク (信頼毀損)。COPPA 2.0 (2026-03 上院通過、17 歳未満まで対象拡張) が成立すれば適用範囲も広がる ([Usercentrics](https://usercentrics.com/us/knowledge-hub/coppa-compliance/))
2. **将来 marketplace を完全 public 化する** (anonymous user 向けマーケティング強化) ときに、child name / age が UI に露出していると改修コストが膨らむ
3. **「子供の data は家族の手元に」(`asset-catalog.md` trust-data-local.svg)** の trust badge 訴求と整合させる UI 設計が必要

### §3.2 OWASP CWE-598: Use of HTTP Request With Sensitive Query String

URL クエリ文字列に sensitive data (子供 ID / 名前) を載せると以下のリスクが発生する ([OWASP](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url)):

- **Referer leak**: `?childId=903` を持つ URL から外部リンクをクリックすると、Referer header で childId が漏れる ([Mozilla Security Blog](https://blog.mozilla.org/security/2018/01/31/preventing-data-leaks-by-stripping-path-information-in-http-referrers/))
- **Browser history / cache 残存**: 共用 PC で他家族が URL bar 履歴を見ると child name が表示される
- **logging**: CDN / Lambda / アクセスログに childId が記録される (DSA 規制で削除義務発生時のコスト)

**現状実装の評価**:
- `marketplace/[type]/[itemId]` の form は `name="childId"` を **hidden input + POST body** で送る (URL に乗らない、CWE-598 違反なし)
- ただし v1 §3.3 で提案した「marketplace 一覧画面で child 切替」を実装すると `?childId=X` 形式の URL 状態管理に陥りやすく、CWE-598 違反路線

**v2 設計指針**: marketplace 系 URL に childId / child name を一切載せない。child 選択は authenticated 内部画面でのみ行う

### §3.3 「家族の手元に」trust 訴求との整合

LP `site/assets/ui/trust-data-local.svg` (#1796) で「データを家族の手元に」を訴求している。marketplace 詳細画面の URL に childId が露出する設計は **この訴求と矛盾** する (ADR-0013 LP truth 違反候補)。v2 設計は trust 訴求と整合する。

---

## §4 提案設計 — family master + per-child visibility toggle

### §4.1 統一動線図 (v1 §3.1 を paradigm shift で修正)

```text
                ┌──────────────────────────────────────────────────┐
                │ /marketplace (public、anonymous browse 可)      │
                │   - resource discovery のみ                     │
                │   - child name / age プルダウン非表示           │
                └──────────────────────────────────────────────────┘
                                  │
                                  │ アイテム card click
                                  ▼
                ┌──────────────────────────────────────────────────┐
                │ /marketplace/{type}/{itemId} (public)            │
                │   - content preview のみ                        │
                │   - CTA = 「家族に取り込む」(child 選択なし)    │
                │   - 未認証なら signup 誘導                      │
                └──────────────────────────────────────────────────┘
                                  │
                                  │ 「家族に取り込む」click (authenticated)
                                  ▼
                ┌──────────────────────────────────────────────────┐
                │ POST action: importToFamily                     │
                │   - family-wide master row として登録            │
                │   - childId 受け取らない                        │
                │   - 既定 visibility = 全 child ON               │
                │     (= activities の age filter デフォルト相当)   │
                └──────────────────────────────────────────────────┘
                                  │
                                  ▼
                ┌──────────────────────────────────────────────────┐
                │ [トースト: "家族に取り込みました"] +            │
                │   「○○管理を開く」link                          │
                └──────────────────────────────────────────────────┘
                                  │
                                  ▼
                ┌──────────────────────────────────────────────────┐
                │ /admin/{type} (authenticated)                    │
                │   - master 一覧表示                             │
                │   - 各 row に **per-child visibility toggle**     │
                │     (chip / switch / matrix)                    │
                │   - child name はここで初めて UI に現れる       │
                └──────────────────────────────────────────────────┘
```

### §4.2 data model 設計 (3 type 共通)

既存 `child_activity_preferences` (L480) を template として 3 type に横展開する。

#### activity (現状維持 + visibility 追加)

```sql
-- 既存 (family master)
activities (id, name, ageMin, ageMax, sourcePresetId, ...)

-- 拡張 (per-child visibility)
ALTER TABLE child_activity_preferences ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1;
-- 既存 isPinned 列はそのまま keep
```

#### reward-set (新規 table、family master へ移行)

```sql
-- 新規 (family master)
CREATE TABLE reward_masters (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  points INTEGER NOT NULL,
  icon TEXT,
  category TEXT NOT NULL,
  source_preset_id TEXT,  -- #1254 G1 流用
  age_min INTEGER,        -- activities と同型
  age_max INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 新規 (per-child × reward visibility)
CREATE TABLE child_reward_preferences (
  id INTEGER PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES children(id),
  reward_id INTEGER NOT NULL REFERENCES reward_masters(id),
  is_visible INTEGER NOT NULL DEFAULT 1,
  UNIQUE(child_id, reward_id)
);

-- 既存 special_rewards は per-child progress (granted_at 時系列) として残す
-- title / description / points は master へ JOIN し、history 表示に使う
```

#### checklist (同型)

```sql
-- 新規 (family master)
CREATE TABLE checklist_template_masters (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📋',
  points_per_item INTEGER NOT NULL DEFAULT 2,
  completion_bonus INTEGER NOT NULL DEFAULT 5,
  time_slot TEXT NOT NULL DEFAULT 'anytime',
  source_preset_id TEXT,
  age_min INTEGER,
  age_max INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- checklist_template_items は master_id 参照に変更 (per-template scope)

-- 新規 (per-child × template visibility)
CREATE TABLE child_checklist_preferences (
  id INTEGER PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES children(id),
  template_id INTEGER NOT NULL REFERENCES checklist_template_masters(id),
  is_visible INTEGER NOT NULL DEFAULT 1,
  UNIQUE(child_id, template_id)
);

-- 既存 checklist_logs / checklist_overrides は per-child progress として残す
```

### §4.3 UI 設計 — 「per-child visibility toggle」

#### Pattern Y (User 提案): 各管理画面に per-child visibility chip 列

```text
┌─ /admin/rewards ──────────────────────────────────────┐
│  🏆 家族のごほうび一覧 (12 件)                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 🎮 ゲーム 30 分                          [編集] │ │
│  │   👧 さくら ●  👦 たろう ○  👶 はる ○         │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 🍰 おやつ追加                           [編集] │ │
│  │   👧 さくら ●  👦 たろう ●  👶 はる ●         │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

- chip 上の `●/○` を tap で per-child visibility toggle
- 子供が 1 人なら chip 列非表示 (singleton optimization)
- 子供 5 人 × reward 30 件 = 150 chip。1 row 5 chip なので可視性 OK (`docs/DESIGN.md §4` tap-size 56-80px に収まる)

#### Pattern Z (現状 activities 流用): age filter で自動制御 (toggle 不要)

- master row の `age_min / age_max` と child の age を比較して自動表示
- 親が明示的に override したいとき (= 9 歳の子に preschool 用ごほうびを見せたい) のみ Pattern Y の override toggle が出現
- **default = Pattern Z**、**override = Pattern Y** の併用が最も Hick's Law 整合

### §4.4 marketplace 詳細画面の UI 変更 (v1 §3.3 修正)

```text
┌─ /marketplace/reward-set/kinder-rewards ──────────────┐
│  🏆 幼児向けごほうびセット                              │
│  対象年齢: 3-6 歳                                     │
│                                                       │
│  含まれるごほうび (5件):                              │
│   - 🎮 ゲーム 30 分                                    │
│   - 🍰 おやつ追加                                     │
│   - 📺 アニメ 1 話                                    │
│   ...                                                 │
│                                                       │
│  ┌──────────────────────────────────┐                │
│  │ [+ 家族に取り込む]                │  ← child 選択なし
│  └──────────────────────────────────┘                │
│                                                       │
│  取り込み後、ごほうび管理画面でお子さま別に             │
│  表示するかしないかを設定できます                       │
└────────────────────────────────────────────────────────┘
```

- **未認証**: CTA = 「無料で始めて取り込む」(signup 誘導)
- **認証済み**: CTA = 「家族に取り込む」(POST → トースト → admin/{type} へ遷移)
- **child name はこの画面に一切登場しない** (User 懸念解消)

### §4.5 トースト後の per-child visibility 設定促し

import 完了直後トーストに「お子さま別の表示を設定」secondary CTA を入れ、admin/{type} 画面の **対象 row** に scroll + highlight して visibility chip を visually 強調する (見つけやすさ確保)。

---

## §5 移行 path — 既存 per-child data から family master へ

### §5.1 段階移行 strategy (3 phase)

#### Phase 1 (新規 import のみ family master、既存は per-child のまま)

- DB schema 拡張 (新 master tables + visibility tables を追加、既存テーブル一切触らない)
- 新規 import service を family master 経由に切替
- 既存 user の per-child reward / checklist は **そのまま動作維持**
- UI は管理画面に visibility chip 列を追加するが、既存 per-child row は `child_id = X / visible = true` の 1 行と同等扱いで描画 (UI 上は等価)

工数: M (新 4 tables + 3 service refactor + UI chip 列 + E2E)

#### Phase 2 (バックフィル: 既存 per-child を family master に統合)

- migration script: 同一 `(family, source_preset_id)` の per-child row を 1 master row + N visibility row に集約
- 同名 / 同 sourcePresetId の duplicate 検出 → master 化 + 各 child の visibility=true
- 既存 progress (special_rewards.granted_at 等) は master row への参照を `reward_id` 経由で張り直す

工数: L (migration + reconciliation テスト + rollback plan)

#### Phase 3 (per-child テーブル列の縮退)

- `special_rewards.title / description / points / icon / category` の master 重複列を削除 → master JOIN 必須化
- `checklist_templates.childId` 列削除 → master_id 必須化
- 全アプリ参照を JOIN に書き換え

工数: M (schema 整理 + repo / service の参照変更)

### §5.2 Pre-PMF 観点 (ADR-0010)

| Phase | Bucket 判定 | 根拠 |
|---|---|---|
| **Phase 1** | **B (動線改善)** | User 指摘の privacy 懸念解消 + paradigm 整合化 (PMF 直結)、工数中 |
| **Phase 2** | **C (Pre-PMF 引き延ばし可)** | 既存 user に visible change なし、PMF 後の data 整理として実施 |
| **Phase 3** | **C (Pre-PMF 引き延ばし可)** | schema 整理は PMF 後 |

**v2 推奨**: Phase 1 のみを直近で実装、Phase 2-3 は別 EPIC として PMF 後に持ち越す。

### §5.3 risk 一覧

| risk | 緩和策 |
|---|---|
| 既存 per-child row との「両方が存在する」状態 (transition 期間) | UI は visibility chip の OR 演算で表示判定 (master 由来か per-child 由来かの両対応) |
| Phase 1 で `event-checklist` 3 件 × 子供 3 人 = 9 行を 3 行に削減できないトレードオフ | 容認 (Pre-PMF では DB 行数より paradigm 整合性が優先) |
| reward の history (granted_at 時系列) と master が分離する複雑性 | 既に `activity_logs` / `activities` で動いている同型パターン (新規概念なし) |
| visibility=false で過去 progress が見えなくなる懸念 | history 画面は visibility filter を無視して全件表示 (`activities` の archive 同様) |

---

## §6 Pattern Y vs Pattern Z 比較 (toggle vs age filter)

User 提案は明示的に **Pattern Y (toggle)** を選んだが、`activities` の現状 は **Pattern Z (age filter)** で動いている。両者をどう統合するかが重要判断点。

### §6.1 各 Pattern の特徴

| 観点 | Pattern Y (per-child visibility toggle) | Pattern Z (age filter 自動) |
|---|---|---|
| **新規概念** | visibility 表 (新規 DB tables × 3 type) | 既存 `ageMin/ageMax` の延長 |
| **UI 複雑度** | chip 列 + tap で toggle (子供 N 人で N chip / row) | 何もない (自動表示制御) |
| **親のコントロール感** | 強い (任意の per-child binding) | 弱い (age 自動判定、override は edit modal 内) |
| **マーケットプレイス側の child 露出** | 0 (post-import の管理画面でのみ child name 登場) | 0 (同上) |
| **schema migration** | 必要 (3 新 visibility tables) | 不要 (ageMin/ageMax を 3 type 全部に追加するだけ) |
| **Pre-PMF Bucket 判定** | B (動線改善 + privacy 整合) | C 寄り (現状で動いている、新規実装はオーバー) |

### §6.2 推奨 — 「default Pattern Z + override Pattern Y」併用

- **default = Pattern Z** (age filter): import 時点で `age_min / age_max` が master に書き込まれ、child の `age` と照合して自動表示。**90% のケースで親は何もしない**
- **override = Pattern Y** (visibility toggle): 親が「9 歳の上の子に preschool 用ごほうびも見せたい」等の override 操作をしたいとき、edit modal 内の visibility chip 列を編集する
- chip 列は **default = 一覧画面に表示しない** (age filter 結果を信じる)、edit modal 内でのみ露出する
- これにより 90% の親は chip UI を見ずに済み (Hick's Law 整合)、override したい 10% にも対応できる

### §6.3 v2 最終提案

| Phase | data model | UI | 工数 |
|---|---|---|---|
| **Phase 1a** (Pre-PMF Bucket B) | 3 type 全てに `age_min / age_max` 列を master 化 (`reward_masters` / `checklist_template_masters` 新規) | marketplace 詳細から child 選択 UI 撤去、import = family-wide | M |
| **Phase 1b** (Phase 1a と同 PR or 直後) | `child_*_preferences` 拡張 (visibility 列 + 3 type 分) | edit modal 内に visibility chip 列 | M |
| **Phase 2** (PMF 後) | バックフィル | UI 変更なし | L |
| **Phase 3** (PMF 後) | schema 縮退 | 同上 | M |

---

## §7 残懸念 / PO 判断が必要な選択肢

### Q1. v1 提案を完全廃案にするか、Pattern E (詳細 inline) を併用するか

| 選択肢 | 推奨度 | 根拠 |
|---|---|---|
| **v2 完全採用** (marketplace から child 選択撤去) | ★★★ | privacy / data model 一次原則 / 業界標準 (Notion / Asana / Linear / Cozi の **5/5**) 整合 |
| v1 と v2 併用 (marketplace 詳細に child 選択 inline 残し、admin にも visibility) | ★ | UI が 2 経路に分裂、Hick's Law 違反 |
| v1 維持 | × | User 指摘の privacy 懸念未解消 |

**推奨**: ★★★ v2 完全採用

### Q2. Phase 1a / 1b を 1 PR で出すか分割か

| 選択肢 | 推奨度 | 根拠 |
|---|---|---|
| **1 PR (大 PR、~600 行)** | ★★ | data model と UI が 1 paradigm に紐付くため一括ロールアウトが本質 |
| 2 PR (1a = data model & service、1b = UI chip 列) | ★★★ | レビュー粒度 / rollback 単位として健全 |
| 3 PR (1a, 1b, marketplace 詳細 UI 改修) | ★ | PR 数増で同期コスト高 |

**推奨**: ★★★ 2 PR (1a → 1b 順、1a 単独で marketplace 詳細から child UI 撤去)

### Q3. event-checklist 3 件 (#2137) の per-child 増殖をどう扱うか

現状 `event-pool / event-school-start / event-field-trip` 3 preset × N 子供 = 3N templates。v2 移行後は 3 master + N × 3 visibility 行になり **半分の重複削減**。

| 選択肢 | 推奨度 | 根拠 |
|---|---|---|
| Phase 1 と同時に 3 件分の reconciliation を実施 | ★★ | 既存実装の bug 半解消 |
| **Phase 2 (バックフィル EPIC) に纏める** | ★★★ | Pre-PMF 引き延ばし可、既存 user 体験に visible 差分なし |
| 既存 per-child のまま放置 (新 paradigm と二重管理) | × | 長期的に技術負債 |

**推奨**: ★★★ Phase 2 に纏める (#2137 ベース修正は別 Issue 起票)

### Q4. age filter のデフォルト (master.age_min/max) はどう決めるか

marketplace preset の `targetAgeMin / targetAgeMax` を master の `age_min / age_max` に流すのが自然 ([`src/lib/domain/marketplace-item.ts`](../../src/lib/domain/marketplace-item.ts) で既に定義あり)。

- preset 由来 → marketplace 定義値を引き継ぐ
- 親が手動で master を作るとき → form に `age_min / age_max` 入力欄を出す (任意、未指定なら全 child 表示)
- 既存 `activities` の挙動と完全同型

**推奨**: marketplace 定義値を master に流す。手動作成時は任意入力。

### Q5. visibility chip UI の primitive 化

`src/lib/ui/primitives/` に新規追加するか、`Badge` / `IconButton` の組合せで吸収するか。

| 選択肢 | 推奨度 | 根拠 |
|---|---|---|
| **新規 `VisibilityChipRow.svelte` primitive** | ★★ | 3 type で使い回す + age-tier タップサイズ整合 |
| `IconButton` + `Badge` 組合せで都度実装 | ★ | 3 箇所で同一 UI 重複 |

**推奨**: ★★ 新規 primitive (`docs/DESIGN.md §5` プリミティブ表に追加)

### Q6. demo route 同期 (ADR-0047 / ADR-0048 / #2097 PR-B3)

demo 専用ルート (`/demo/**` 配下) は **#2097 PR-B3 (#2188) で完全削除済**。demo Lambda 環境 (`AUTH_MODE=anonymous` + `DATA_SOURCE=demo`、ADR-0048 Multi-Lambda) でも本番ルート (`(parent)/admin/{rewards,checklists}/` / `(child)/<uiMode>/`) を直接 host する方式に統合された。demo fixture (`demo-data.ts`) を新 master + visibility 表に修正する作業が発生する点は変わらないが、同期対象はあくまで **本番ルート 1 系統 + demo fixture** であり、別系統の demo 専用ルートを同期する必要はない (ADR-0047 demo/prod UI Contract SSOT で ViewModel 型強制 + 禁止語 SSOT として担保)。SS 撮影手順は `docs/sessions/qa-session.md` 参照。

**推奨**: Phase 1b PR に含める (ADR-0047 demo/prod UI Contract / ADR-0048 Multi-Lambda demo deployment 整合)

---

## §8 v1 (前 research) の修正反映方針

v1 docs は **§1 競合分析 / §2 標準パターン抽出 / §4 Pre-PMF 妥当性 / §6 参考文献** が引き続き有効。一方、以下は v2 に置換される:

| v1 セクション | v2 での扱い |
|---|---|
| §3.1 統一動線図 | **§4.1 に paradigm shift で修正**。marketplace から child 選択撤去 |
| §3.2 階層配置 SSOT | 概ね有効。`/marketplace/[type]/[itemId]` 行のみ「child 選択は detail 内では行わない」に修正 |
| §3.3 marketplace ページ sequence (Pattern E) | **§4.4 で全廃 (Pattern Y 採用)** |
| §3.4 overflow menu | 有効 (v2 で変更なし) |
| §3.5 並行実装影響 | demo 同期 (ADR-0047) は引き継ぎ。新規 `VisibilityChipRow` primitive 追加 + 3 visibility tables を `parallel-implementations.md` に追記 |
| §5 残懸念 Q1-Q6 | 有効。本 v2 §7 と統合せず別問として残す (PO 判断時に v1 §5 / v2 §7 両方を見る) |

**運用**:
- v1 docs は keep (削除しない、git 履歴と訴求コンテキストの SSOT として残す)
- 本 v2 docs を直近の **implementation SSOT** として参照
- PR comment で「v1 と v2 の関係 / paradigm shift」を明示し、QM レビューで両方を見る運用にする

---

## §9 参考文献 (v1 に追加した privacy 観点ソース)

### Privacy / 規制

- [OWASP - Information exposure through query strings in URL](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url) — CWE-598
- [Mozilla Security Blog - Preventing data leaks via Referrer](https://blog.mozilla.org/security/2018/01/31/preventing-data-leaks-by-stripping-path-information-in-http-referrers/)
- [PortSwigger - Cross-domain Referer leakage](https://portswigger.net/kb/issues/00500400_cross-domain-referer-leakage)
- [FTC - Children's Privacy (COPPA)](https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy)
- [Usercentrics - COPPA Compliance 2026](https://usercentrics.com/us/knowledge-hub/coppa-compliance/) — 2026-04 compliance deadline + COPPA 2.0 senate 通過
- [GDPR Article 8 - Children's consent](https://gdpr-info.eu/art-8-gdpr/)
- [OWASP - User Privacy Protection Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/User_Privacy_Protection_Cheat_Sheet.html)

### data model 設計

- [Designing RBAC - Junction tables for explicit relationships](https://medium.com/@07rohit/designing-a-role-based-access-control-rbac-system-a-scalable-approach-441f05168933) — visibility 表 (child × resource junction) の設計根拠
- [LoginRadius - Row-level access control](https://www.loginradius.com/blog/identity/rbac-data-security-access-control)

### 業界事例 (v1 から継続 + privacy 観点で再評価)

- [Notion Template Gallery](https://www.notion.com/templates) — public gallery、認証フローで workspace 内 import
- [Asana Templates](https://asana.com/templates) — 同型
- [Linear Templates](https://linear.app/templates) — 同型
- [Trello Templates](https://trello.com/templates) — 同型
- [VSCode Marketplace](https://marketplace.visualstudio.com/) — public、別ホスト
- [Cozi To-Do Lists](https://www.cozi.com/to-do-lists/) — authenticated 内部のみ
- [Greenlight - Assigned vs Up for grabs](https://help.greenlight.com/hc/en-us/articles/360000651493-What-is-the-difference-between-Assigned-chores-and-Up-for-Grabs-chores) — chore 単位の per-child assign
- [FamilyWall](https://www.familywall.com/help.html) — task 単位の assignee

### がんばりクエスト内部

- `src/lib/server/db/schema.ts` L46 (`activities` family master), L316 (`special_rewards` per-child), L366 (`checklist_templates` per-child), L480 (`child_activity_preferences` visibility 拡張点)
- `src/routes/marketplace/[type]/[itemId]/+page.server.ts` L50 `isAuthenticated` 分岐 (現状の防御線)
- ADR-0010 Pre-PMF / ADR-0013 LP truth / ADR-0042 LP spacing / ADR-0047 demo-prod 等価性
- Issue #2136 (MP-1 reward-set) / #2137 (MP-2 event-checklist) — per-child 採用の expedient (rationale 記録なし)
- v1 docs: [`docs/research/2026-05-22-import-hub-ux-redesign.md`](./2026-05-22-import-hub-ux-redesign.md)
