# Import Hub UX 再設計 — 競合分析と統一動線提案

| 項目 | 内容 |
|---|---|
| 起票日 | 2026-05-22 |
| 起票者 | PO (takenori.kusaka@gmail.com) |
| 種別 | research / design proposal |
| 関連 EPIC | #2362 (UnifiedImportHub 統一) |
| Issue 起票 | **不要** (本研究自体が成果物) |
| 目的 | 5 admin route + setup + marketplace の追加導線 SSOT 設計 |

---

## §1 競合分析 — 5 業界 12 事例

### §1.1 子供向け / 家族向けタスク管理アプリ

| アプリ | 業界 | テンプレート / プリセット動線 | 「追加」階層 | 子供 / メンバー選択タイミング |
|---|---|---|---|---|
| **Cozi** (家族カレンダー) | Family Organizer | List Library (premade checklists: Birthday Party / Vacation / After School) は **`Add a list from the Cozi list library`** リンクから 1 hop。各家族メンバーには Chores 内で個別リスト自動生成 | リスト全体は FAB / 「+」、家族メンバーごとのチョア追加は pencil icon (inline) | リスト追加時にメンバー選択 (pin で各人 top に固定可能) |
| **OurHome** (チョア共有) | Family Organizer | テンプレートライブラリは別画面、メイン UI は assign-to-member 中心。FAB + 「+」 で都度作成 | プライマリ = 「+」(FAB) で個別作成 / テンプレートは設定経由 | チョア作成時に「誰に」を選ぶ inline 選択 |
| **Greenlight** (allowance + chores) | Kids Finance | 「Up for grabs」(共有プール) と「assigned」両方サポート。テンプレート概念は薄く、繰り返し設定で代替 | プライマリ = 「Create a chore」CTA / chore detail で割当 | chore 作成時に child 単独 or 全員選択 |
| **Tody** (掃除) | Household | 各 room 単位で **chore library から pick** が標準フロー。room 設定 → task 選択 → 頻度設定の 3 step | テンプレート (library) が **first-class**。empty room から add task でライブラリ起動 | 担当者割当はオプション (single-person 想定が強い) |

### §1.2 汎用 productivity / project management

| アプリ | 業界 | テンプレート動線 | 「追加」階層 | スコープ選択 |
|---|---|---|---|---|
| **Notion** | Workspace | Sidebar 「Templates」button → modal popup でカテゴリ別 gallery → **`Start with this template`** で workspace の Private section に自動追加。新規 page でも空ページ右側に Template panel 自動表示 (empty state) | 通常 add は `+ New page` (sidebar)。テンプレートは **同層 sibling**、ただし popup で隔離 | workspace 切替が前提だが、Add 時に「どの workspace に」を ask しない (現在 workspace に直追加) |
| **Todoist** | Task | テンプレートは **プロジェクト context menu (三点リーダー)** から起動 (UI Extensions として実装)。modal で gallery 表示 → import 完了で現在 project に統合 | プライマリ = global「+」(top header) / テンプレートは **overflow menu** (1-2 hop 深い) | import 先 project は context (= 現在 project) で自動決定 |
| **Asana** | Project | Homepage の `+` button (recent projects 配下) または create project modal 内に「Use template」option。Project Templates Gallery は team / industry 別カテゴリ | プライマリ = bottom-right multicolor FAB / テンプレートは create modal 内 tab | new project 時に team 選択 |
| **Linear** | Issue tracker | Issue 作成 modal 内に **Template dropdown** (team 名横、shortcut `Alt+C`)。Project 作成も同型 | プライマリ = sidebar「New issue」/ テンプレートは create modal の inline element | issue / project 作成時に team 選択 |
| **Trello** | Board | **3 経路同時提供**: (1) Home の Templates section、(2) `Create` button → `Start with a Template`、(3) New board dialog 内の template browser | プライマリ = global header `Create` / テンプレートは **`Create` の 1st-class submenu** | board 作成時に workspace / visibility 選択 |

### §1.3 マーケットプレイス / プラグインストア

| アプリ | 業界 | install 動線 | 「追加」プライマリ | スコープ選択 |
|---|---|---|---|---|
| **VSCode Extensions** | IDE | Activity Bar の Extensions icon (`Ctrl+Shift+X`) → list view → `Install` button (1 click)。完了後 `Manage` gear button に変化 | プライマリ = 個別 extension card 上の `Install` button / 別経路は `Install from VSIX...` (`Views and More Actions` = overflow menu) | install 先は user-global or workspace-local (settings で切替) |

### §1.4 業界横断 — 確立された UX 原則 (NN/G, Material 3, Hick's/Fitts)

| 原則 | 推奨パターン | 出典 |
|---|---|---|
| **FAB は 1 screen 1 primary action** | 最頻度 action のみ FAB に。secondary 以下は menu / inline | Material 3 |
| **Overflow menu (kebab)** | 「less frequently used options」を畳む。top-right が標準位置 | PatternFly / NN/G |
| **Hick's Law** | 選択肢を減らすことで decision time 短縮 | Dovetail UX |
| **Empty state** | 「pre-loaded template / 教育コンテンツ」で blank page problem 回避 | Notion / Monday / NN/G |
| **Fitts's Law** | 頻度高 action は大きく / 親指近く配置 | NN/G |

---

## §2 標準パターン抽出 (5 業界収束)

業界 12 事例から、以下 5 パターンが**強い収束**を見せる。

### Pattern A: 「+追加 (manual)」は FAB / プライマリ button、「テンプレート取込」は同層 sibling だが 1 hop 深い

採用例: Cozi / Notion / Asana / Linear / Trello / Todoist / VSCode

- **manual add** = bottom-right FAB or top-right `+ New` (Fitts's Law: 親指 reach)
- **template/marketplace** = (a) Trello-style: `Create` button の submenu、(b) Notion-style: sidebar の sibling button、(c) Todoist-style: overflow menu (1 hop 深い)
- **共通点**: 同一画面で **両方の動線を同時提示しない**。少なくとも 1 click の意思決定で分岐させる
- **頻度差の構造化**: manual > template の頻度差を hierarchy で表現

### Pattern B: 「テンプレート選択 → 即追加」が主流 (preview なし or オプション)

採用例: VSCode (1 click install) / Cozi (List Library 直追加) / Notion (Start with this template)

- VSCode は **1 click install** で extension detail 経由不要 (詳細は別画面)
- Notion は detail page 経由するが、CTA は 1 つ (`Start with this template`)
- **child / scope 選択**は import 動作の手前 inline (Linear/Asana の team 選択と同型)
- **遷移先は自動推論**: VSCode は extensions list / Notion は新規 page / Trello は新 board

→ がんばりクエスト現状: marketplace 詳細 → child 選択 → import → 管理画面に手動遷移、で **child 選択タイミングが詳細画面に閉じ込められている**のは標準パターンと整合。改善余地はトースト後の **遷移誘導の明示**

### Pattern C: Empty state で template 推奨 + 通常 state で「全件表示」を変える

採用例: Notion (pre-populated workspace) / Monday (パーソナライズ template) / Carbon DS (empty state pattern)

- **真っ新ユーザ** = template gallery を first-class で表示 (Notion: 新規 page 右パネル / Monday: 「Recommended for you」)
- **既存ユーザ** = 「+追加」が primary、template は 1 hop 深い menu に格納
- **トリガー**: 一覧件数 = 0 で UI を切替 (現状 `ActivityEmptyState` がこれに該当するパターンだが、テンプレート / marketplace 誘導が無い)

### Pattern D: Overflow menu (kebab) に「テンプレート / バックアップ / エクスポート」を畳む

採用例: Todoist (project の三点メニュー) / VSCode (`Views and More Actions` = More 経路) / Material 3 / Android 標準

- 共通対象: ① テンプレート取込、② Export、③ Import (file/CSV)、④ アーカイブ、⑤ 設定
- **kebab 位置**: top-right action bar (NN/G / PatternFly)
- **ラベル順**: 頻度高 → 頻度低、destructive action は最下段 (`削除` 等は separator + 赤字)

→ がんばりクエストの user 指針「テンプレート / バックアップ / エクスポートを同層に」は **業界標準と完全一致**

### Pattern E: テンプレート選択時の scope (誰に / どこに) は **import 動作の手前で選択**、別画面化しない

採用例: Linear (issue create modal 内 team 選択) / Asana (template apply 時 team) / Cozi (list 追加時 member 選択)

- 「テンプレート選択 → 別画面で child 選択 → 確定」は **2 step 過剰** (Hick's Law 違反)
- 「テンプレート detail 画面の CTA 直前に inline で child 選択」が標準 (現状 `marketplace/[type]/[itemId]/+page.svelte` 281-294 行で `NativeSelect` を form 内に置く実装は適合)
- ただし「marketplace 一覧画面」での child 切替は **複雑性追加** で標準パターン外。一覧では child 非依存で browse、detail で child 選択が望ましい

---

## §3 がんばりクエスト適用提案

### §3.1 統一動線図 — 5 admin route の add UX

```text
                    ┌─────────────────────────────────────────────────┐
                    │  管理画面 (admin/{activities,checklists,...})    │
                    └─────────────────────────────────────────────────┘
                       │            │                  │
              empty ?  │  非 empty  │                  │ top-right
            ┌──────────┴──┐       │                  │ overflow
       一覧 0 件         一覧 N件   │                  │ menu (⋮)
            │              │      │                  │
            ▼              ▼      ▼                  ▼
  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐
  │ EmptyState      │  │ プライマリ FAB    │  │ Overflow menu       │
  │  + AI 提案       │  │ (右下、+追加)    │  │  ├ みんなのテンプレ │
  │  + 「みんなの    │  │  → manual form  │  │  ├ バックアップ     │
  │    テンプレ」CTA │  │  (Dialog)       │  │  │  ├ エクスポート  │
  │  + 「手動で1件   │  └─────────────────┘  │  │  └ インポート    │
  │    追加」secondary│                       │  └ ヘルプ           │
  └─────────────────┘                       └────────────────────┘
                                                       │
                                                       ▼
                                              /marketplace?type=<X>
                                                       │
                                          [child 選択は detail で]
                                                       ▼
                                              import → トースト
                                                       │
                                          「○○管理を開く」link で遷移
```

### §3.2 階層配置 SSOT (5 route + setup + marketplace)

| 画面 | 「+追加」(manual) 位置 | 「みんなのテンプレ」位置 | empty state | 備考 |
|---|---|---|---|---|
| `/admin/activities` | **右下 FAB** (`AddActivityFab.svelte` 既存活用) | top-right **⋮** → 「みんなのテンプレから取込」 | `ActivityEmptyState` に template CTA 追加 | 現状: Dialog 内 mode selector 3 step → **1 step に短縮** (FAB = manual 直行 / template は overflow) |
| `/admin/checklists` | **右下 FAB** (新規追加) | top-right **⋮** → 「みんなのテンプレから取込」 | 「テンプレート + 1件追加 + AI 提案」3 CTA を empty 専用カードで提示 | 現状: ページ上部に marketplace カード常時表示 → **0 step だが頻度低なので overflow に格下げ** |
| `/admin/rewards` | **右下 FAB** (新規追加) | top-right **⋮** → 「みんなのテンプレから取込」 | テンプレート + AI 提案 + プリセットカタログ | 現状: preset toggle + marketplace toggle 同一ページ並列 → **両方とも overflow へ集約** |
| `/admin/settings/rules` | **N/A** (個別 rule の手動追加 UI は別 Issue) | empty 時の `browseLink` を ⋮ に格上げ + empty 維持 | 現状の empty CTA は残置 (rule は templates から派生する想定) | rules はテンプレート起点が主動線 → 例外的に **empty state が first-class** |
| `/admin/challenges` | プライマリ button (上部 `creating` toggle、現状維持) | top-right **⋮** → 「みんなのテンプレから取込」 | Family plan 未契約時の locked banner 維持 | 現状: marketplace 未統合 → 追加実装が必要 |
| `/setup/packs` (初回 setup) | 既存 flow 維持 | **first-class、推奨自動選択** (現状実装で OK) | 全ユーザ empty 前提 | 初期ユーザは setup フロー内で template を**強推奨** (Notion empty state 標準) |
| `/setup/{rewards,rules,challenges}` (初回 setup) | 同上 | 同上 | 同上 | テンプレ強推奨を統一 |
| `/marketplace` (一覧) | N/A (browse 専用) | 自分自身 | データなし時の reset link 維持 | **child 選択は一覧では行わない** (Pattern E) |
| `/marketplace/[type]/[itemId]` (詳細) | N/A | 自分自身 (CTA = import) | N/A | child 選択は CTA 直前 inline (現状実装で OK) |

### §3.3 marketplace ページ sequence (Pattern E 適用)

```text
[marketplace 一覧] (child 選択なし)
    │
    │ アイテム card click
    ▼
[marketplace/{type}/{itemId}] 詳細
    │
    │ scroll → CTA エリア
    ▼
┌──────────────────────────────┐
│ 内容プレビュー (件数 / アイコン) │
│                                │
│  どのお子さまに?  [▼ たろう]   │  ← inline NativeSelect (Pattern E)
│  [ + 取り込む (5件) ]          │  ← プライマリ Button
└──────────────────────────────┘
    │
    │ submit
    ▼
[トースト: "5件を取り込みました"] + 「○○管理を開く」link
    │
    │ link click
    ▼
[/admin/{type}] 一覧画面に対象アイテムが先頭表示
```

**改善差分** (現状 vs 提案):

- 現状 `/admin/checklists` トースト後の遷移なし → **遷移誘導 link を追加** (`invalidateAll` 後)
- 現状 `marketplace/[type]/[itemId]` のトースト後リンクは「signup へ誘導」優先 → **管理画面遷移 link** を主、signup は未ログイン時のみ
- 4 type (`activity-pack` / `reward-set` / `checklist` / `rule-preset`) の CTA 文言を **`MARKETPLACE_LABELS.detailCtaImportXxx` で SSOT 化** (現状 reward / checklist で分岐コード散在)

### §3.4 overflow menu (⋮) のラベル順

業界標準 (Todoist / VSCode / Material 3) を踏まえた推奨順:

```text
⋮ メニュー (top-right、admin route 共通)
  ├ 📦 みんなのテンプレから取込    ← marketplace?type=<X> へ
  ├ 🤖 AI で提案してもらう         ← 現状 AI Panel を menu 起動に統合可
  ├ ─────────────────────
  ├ ⬇ バックアップから復元         ← /admin/settings の import 機能を menu 経由でも起動
  ├ ⬆ エクスポート                ← 同上 (現状 settings 内のみ)
  ├ ─────────────────────
  └ ❓ このページのヘルプ           ← 既存 PageHelpButton 統合
```

### §3.5 並行実装影響 (`docs/design/parallel-implementations.md`)

- **labels.ts SSOT 追加**: `OVERFLOW_MENU_LABELS` namespace 新設 (5 admin route で共有)
- **新規 primitive**: `OverflowMenu.svelte` (Ark UI Menu wrapper)。`Button.svelte` / `Dialog.svelte` と同列で `src/lib/ui/primitives/` に配置
- **既存コンポーネント影響**:
  - `AddActivityFab.svelte` → 他 4 route に汎用化 (`AddItemFab.svelte` rename + props)
  - `AddActivityModeSelector.svelte` → **削除** (FAB = manual 直行 / template は overflow に分離)
  - `marketplace-import-section` (admin/checklists) の常時 Card → **削除**、overflow menu からの導線 1 本化
  - `showMarketplace` toggle (admin/rewards) → **削除**、同様に overflow 経由
- **demo 側並行実装**: `src/routes/demo/(parent)/admin/` 配下も同期更新必須 (ADR-0047 + memory `demo_prod_ui_unification_blocker`)

---

## §4 Pre-PMF 段階での妥当性 (ADR-0010 判定)

| Bucket | 判定 | 根拠 |
|---|---|---|
| **A (必須)** | ❌ | LP truth 違反 / 法務 / 認証 などのリスク領域ではない |
| **B (動線改善 = 価値直結)** | ✅ **該当** | 5 admin route の add UX 不統一は **既存 PMF 障害** (#2362 EPIC で繰り返し是正試行)。Hick's Law 違反による「+追加で迷う」状態は離脱要因。修正コストは中規模 (1 primitive 新設 + 5 ページの import section 削除) |
| **C (過剰防衛 / 引き延ばし可)** | ❌ | overflow menu は確立 OSS pattern (Ark UI Menu / Material 3) なので独自実装 0 行 |

**実装規模見積もり** (S/M/L):

- `OverflowMenu.svelte` primitive 新設: **S** (Ark UI Menu wrapper、~30 行)
- `OVERFLOW_MENU_LABELS` 追加 (terms.ts + labels.ts): **S** (~15 行)
- 5 admin route の section 統廃合 (activities / checklists / rewards / challenges + settings/rules empty 維持): **M** (~150 行 net 削減)
- `marketplace/[type]/[itemId]` 詳細 CTA の遷移 link 追加: **S** (~20 行)
- demo 側並行実装の同期 (ADR-0047): **M**
- E2E test (5 route × overflow menu open + template path): **M**
- 設計書同期 (`docs/DESIGN.md §5` プリミティブ表 + `docs/design/06-UI設計書.md`): **S**

**全体**: **M (推奨 1 PR、~400 行 net、5 SS)**。Pre-PMF Bucket B として正当性あり。

**ADR 起票要否**: ❌ **不要**。本研究 docs を SSOT として参照する、または `docs/DESIGN.md §5` プリミティブ表に `OverflowMenu` を追加すれば充足。ADR は「機械強制できない判断原則」を残す枠 (10 件上限) なので、UI primitive 追加には使わない。

---

## §5 残懸念 / PO 判断が必要な選択肢

### Q1. overflow menu icon 表記

| 選択肢 | 推奨度 | 根拠 |
|---|---|---|
| **⋮ (vertical kebab、Material 標準)** | ★★★ | Android / Web で最も認知度高い |
| ⋯ (horizontal meatball、iOS 風) | ★★ | iOS Safari / Apple アプリで標準。子供向けには違和感小 |
| 「その他 ▾」テキスト button | ★ | 子供画面でなく親画面なので affordance は icon でも OK |

**推奨**: ⋮ (Material 標準) + aria-label「メニューを開く」(`UI_LABELS` SSOT 経由)

### Q2. EmptyState での「みんなのテンプレ」CTA 位置

| 選択肢 | 推奨度 | 根拠 |
|---|---|---|
| (a) primary CTA = template、secondary = 手動 1 件追加 | ★★ | Notion empty state pattern。初心者には強推奨が効く |
| (b) primary CTA = 手動 1 件追加、secondary = template | ★★ | 既存 user の習慣に近い (Cozi の List Library は secondary) |
| (c) 両方を equal weight で並列 (現状 `ActivityEmptyState` 拡張) | ★ | 選択コスト高 |

**推奨**: **初回 setup フロー = (a)** (Notion model)、**setup 完了後の empty state = (b)** (再追加時は手動の方が頻度高い)。

### Q3. AI 提案 panel の位置

現状 `AiSuggestPanel` / `AiSuggestRewardPanel` / `AiSuggestChecklistPanel` はページ上部に常時 Card 表示。

| 選択肢 | 推奨度 |
|---|---|
| 現状維持 (常時 Card 表示) | ★ (3 つの動線が並列で Hick's Law 違反) |
| **overflow menu (⋮) → 「AI で提案」起動 → Dialog で表示** | ★★★ |
| empty state にのみ AI CTA を表示 | ★★ (一覧空ではない場合 AI を使わない実装になる) |

**推奨**: overflow menu 経由に統一 (Q1 の menu 内 2 番目)。AI 提案 = 「困った時の助け」性質で頻度低、template と同層が自然。

### Q4. setup フローで「みんなのテンプレ」を強推奨する範囲

現状 `/setup/packs` は推奨自動選択あり。同パターンを `/setup/rewards` `/setup/rules` `/setup/challenges` (challenges は family plan 限定) に拡張するか?

**推奨**: ✅ **拡張する** (Pattern C: Notion / Monday の「Recommended for you」)。ただし「困ったらスキップ」secondary CTA は必須 (現状 packs に `selectSkip()` あり、流用)。

### Q5. バックアップ機能の overflow 配置 SSOT 化範囲

現状 export/import は `/admin/settings` 内に集約。overflow menu からも起動可能にする場合:

- 案 A: overflow → `/admin/settings#data` への deep link (UI 単純化、機能重複なし)
- 案 B: overflow → Dialog で settings の export/import を inline 起動 (action proximity 改善、実装複雑)

**推奨**: **案 A (deep link)**。Pre-PMF では実装 complexity 最小化 (ADR-0010 Bucket C 回避)。Dialog inline 起動は usage 観察後の Phase 2。

### Q6. challenges page の marketplace 未統合

現状 `/admin/challenges` は marketplace 連携なし (Family plan 限定 page なので priority 低い可能性)。

**推奨**: 本リファクタの **scope 外**。別 Issue 起票 (challenges 単独テンプレート機能、family plan の付加価値設計込み) で扱う。

---

## §6 参考文献

### 業界事例

- [Notion - Template Gallery](https://www.notion.com/help/guides/the-ultimate-guide-to-notion-templates) — Sidebar Templates button + popup gallery
- [Notion - Buttons](https://www.notion.com/help/buttons) — `/button` で workspace 内アクション
- [Todoist - Use templates](https://www.todoist.com/help/articles/use-todoist-templates-uofJ8i40M) — project context menu の三点リーダーから template UI
- [Todoist - UI Extensions](https://developer.todoist.com/ui-extensions) — templates は modal で表示
- [Asana - Templates](https://asana.com/templates) — Project Templates Gallery
- [Asana - Project & Task Templates](https://asana.com/features/workflow-automation/project-task-templates) — `+` button → template
- [Linear - Issue templates](https://linear.app/docs/issue-templates) — Issue 作成 modal 内 Template dropdown (`Alt+C`)
- [Linear - Project templates](https://linear.app/docs/project-templates) — Project 作成 modal 内
- [Linear - New issue creation UI](https://linear.app/changelog/2021-03-10-new-issue-creation-ui) — Sidebar New issue + inline template
- [Trello - Template Gallery](https://blog.trello.com/trello-board-templates-gallery) — 3 経路 (Home / Create button / New board dialog)
- [Trello - Templates](https://trello.com/templates) — 公式 gallery
- [Cozi - To-Do Lists](https://www.cozi.com/to-do-lists/) — `Add a list from the Cozi list library`
- [Cozi - Premade Checklists](https://www.cozi.com/premade-checklists/) — Birthday / Vacation / After School
- [Cozi - Chores](https://www.cozi.com/blog/cozi-chores/) — 家族メンバーごとリスト自動生成 + pin
- [OurHome](http://ourhomeapp.com/) — assign-to-member 中心 UX
- [Tody](https://todyapp.com/) — Room-first chore library
- [Greenlight - Create chore](https://help.greenlight.com/hc/en-us/articles/360019240274-How-do-I-create-a-chore-for-my-child) — Up for grabs / assigned
- [VSCode - Extension Marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace) — Activity Bar + 1 click install / `Views and More Actions`

### UX 原則 / Design system

- [Material 3 - FAB](https://m3.material.io/components/floating-action-button/overview) — 1 screen 1 primary action
- [Material 3 Expressive - FAB Menu](https://medium.com/@renaud.mathieu/discovering-material-3-expressive-fab-menu-ecfae766a946) — Secondary actions を畳む FAB Menu
- [PatternFly - Overflow menu](https://www.patternfly.org/components/overflow-menu/design-guidelines/) — Kebab icon の design guideline
- [NN/G - Contextual Menus](https://www.nngroup.com/articles/contextual-menus-guidelines/) — 10 guidelines
- [NN/G - Fitts's Law](https://www.nngroup.com/articles/fitts-law/) — Target size / distance
- [Dovetail - Hick's Law](https://dovetail.com/ux/hicks-law/) — 選択肢削減
- [Usability People - Hick's & Fitts](https://theusabilitypeople.com/thought_leadership/hick-s-and-fitt-s-laws-two-important-psychological-principles-consider-when) — 両者の相補関係
- [Carbon DS - Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/) — Empty state pattern
- [UserOnboard - Empty State patterns](https://www.useronboard.com/onboarding-ux-patterns/empty-states/) — Notion / Monday の pre-loaded 戦略
- [Eleken - Empty state UX](https://www.eleken.co/blog-posts/empty-state-ux) — 実例 + 設計ルール
- [Bomberbot - Case against Overflow Menus](https://www.bomberbot.com/ux/overflowing-with-problems-the-case-against-overflow-menus-in-user-interface-design/) — overflow 濫用への警鐘 (反対意見、Q1 判断材料)

---

## §7 次の作業 (本 docs を起点とする場合)

本研究を実装に落とす場合の推奨 PR 分割 (Issue 起票は user 判断):

1. **PR-1 (primitive 追加)**: `OverflowMenu.svelte` 新設 + `OVERFLOW_MENU_LABELS` (terms.ts + labels.ts) — S
2. **PR-2 (admin/activities リファクタ)**: `AddActivityModeSelector` 削除 + FAB → manual 直行 + overflow menu 追加 — M
3. **PR-3 (admin/checklists リファクタ)**: 常時 marketplace Card 削除 + overflow 化 + FAB 追加 — M
4. **PR-4 (admin/rewards リファクタ)**: marketplace / preset toggle 削除 + overflow 化 + FAB 追加 — M
5. **PR-5 (marketplace 詳細 CTA 統一)**: 4 type の CTA 文言 SSOT + 遷移 link 追加 — S
6. **PR-6 (setup フロー empty 強推奨拡張)**: rewards / rules / challenges に「Recommended for you」適用 — M
7. **PR-7 (demo 並行実装同期 + 設計書同期)**: ADR-0047 規約遵守 — M

各 PR は **screenshots/ branch で SS 必須** (memory: `feedback_screenshot_mandatory_rule`)。

