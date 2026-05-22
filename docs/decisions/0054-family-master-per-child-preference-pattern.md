# 0054. 家族 master + per-child preference データモデルパターン

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-23 |
| 起票者 | Dev (EPIC #2362 PR-1 / `docs/research/2026-05-22-import-hub-ux-redesign-v2.md`) |
| 関連 Issue | #2362 (EPIC) / #2136 (MP-1 reward-set) / #2137 (MP-2 event-checklist) |

## コンテキスト

がんばりクエストは家族グループ単位のリソース (活動 / ごほうび / 持ち物チェックリスト / ルール / チャレンジ) を扱う。現状 schema (`src/lib/server/db/schema.ts`) は `activities` のみ **family master + per-child visibility** パターンで設計され (`activities` + `child_activity_preferences`)、その他 4 type は **per-child instance** パターンで重複登録される設計になっている (`special_rewards.childId notNull` / `checklist_templates.childId notNull` 等)。

この paradigm 不整合は、marketplace 詳細画面で child 選択を inline 行う UI 設計を強制し、以下の構造的問題を引き起こしている:

1. **privacy / 公開ページでの child 露出懸念**: marketplace は未認証 browse 可 (`marketplace/[type]/[itemId]/+page.server.ts:50` の `isAuthenticated` 分岐)。child 選択 UI を marketplace 詳細に置くと、authenticated state で child 名がプルダウン露出し、「子供の情報が public マーケットプレイスに流出している」と誤認されるリスクが発生 (OWASP CWE-598 / COPPA / GDPR Article 8 観点)
2. **データ重複**: `event-checklist` 3 preset × 子供 3 人 = 9 行の per-child template 増殖 (#2137)。同一内容を子供数分コピーする冗長性
3. **paradigm 不一致による認知負荷**: activities は age filter で表示制御、reward / checklist は per-child 登録、と type ごとに親の操作モデルが異なる
4. **marketplace URL に childId が乗ると Referer leak / browser history 残存リスク**: CWE-598 違反路線への inviting design

詳細な調査と業界 8 事例比較 (Notion / Asana / Linear / Trello / Cozi / OurHome / Greenlight / FamilyWall) は `docs/research/2026-05-22-import-hub-ux-redesign-v2.md` を参照。本 ADR はその research の paradigm shift を意思決定として確定する。

## 検討した選択肢 (OSS / 確立パターン 3 件比較、ADR-0014 / #1350 整合)

### 選択肢 A: family master + per-child preferences (採用)

**概要**: 全リソースを「家族 scope の master テーブル」+「per-child × resource の preferences (visibility / pin / progress) junction table」で表現。child 選択は authenticated 内部 UI (admin 画面) でのみ完結。

- **OSS / 確立パターンの実装例**:
  - **RBAC junction table**: <https://medium.com/@07rohit/designing-a-role-based-access-control-rbac-system-a-scalable-approach-441f05168933> — user × resource の visibility 表現として industry standard
  - **Cozi To-Do Lists**: <https://www.cozi.com/to-do-lists/> — list master + assign-to-member、`activities` 同型
  - **OurHome chore master + assignee**: 5 サービス中 5/5 が family master + post-import assign で実装
  - **既存 `activities` + `child_activity_preferences`**: 既に動作している自社実装、5 type 全体へ拡張するだけで paradigm 統一可
- **メリット**:
  - **privacy 整合**: marketplace 詳細から child 選択 UI 撤去 → public ページに child 名が一切露出しない (CWE-598 / COPPA / GDPR Art.8 整合)
  - **データ重複削減**: 3 preset × 3 child = 9 行 → 3 master + 9 visibility 行で論理重複ゼロ (master 列が単一 SSOT)
  - **paradigm 統一**: 5 type すべて同型 → 親の認知負荷削減 (Hick's Law)
  - **age filter 統一**: `activities` の `ageMin/ageMax` パターンを 5 type 全体に拡張可能。default = age filter (Pattern Z) + override = visibility chip (Pattern Y) の 2 段制御
- **デメリット**: 既存 per-child 行から master + visibility への migration が必要 (但し本番 user 0 / α tester 0 のため Pre-PMF 段階では旧 schema drop で十分、本 EPIC #2362 PR-3〜7 で実施)
- **Pre-PMF コスト (ADR-0010)**: **Bucket A** (PMF 直結、privacy リスク + paradigm 不整合の構造解消)

### 選択肢 B: per-child template instance (現状、棄却)

**概要**: `special_rewards.childId notNull` / `checklist_templates.childId notNull` のように child 単位で row を増やす。

- **メリット**: 既存実装維持で migration コスト 0
- **デメリット**:
  - marketplace 詳細から child 選択 inline UI を要求 → privacy リスク放置 (User 指摘 core)
  - 3 preset × N child = 3N 行 のデータ重複 (#2137)
  - `activities` (family master) と他 4 type (per-child) の paradigm 分裂を技術負債として永続化
- **Pre-PMF**: 棄却 (PMF 直結 risk あり、User 「やり切り」モード判断 2026-05-23)

### 選択肢 C: Workspace pattern (Notion 型、棄却)

**概要**: family を workspace と見立て、child を workspace 内 member として扱う。 resource は workspace scope、member 表示は workspace 設定で制御。

- **OSS 実装例**: Notion (`notion.com/templates` + workspace switcher) / Asana team workspace
- **メリット**: 大規模 SaaS 業界の標準解、将来 plugin marketplace 解放時の拡張性
- **デメリット**:
  - がんばりクエストは「家族 1 = workspace 1」固定 (multi-workspace なし) のため抽象 layer が overkill
  - workspace switcher UI / role-based 認可機構の実装コスト大 (Pre-PMF Bucket C)
  - 子供 = member の認知モデルは家族向けには不自然 (Cozi / OurHome / Greenlight は family + member 直結で実装、workspace 抽象を挟まない)
- **Pre-PMF**: Bucket C (将来 multi-tenant 化や plugin marketplace 解放時に再評価、現段階では over-engineering)

## 決定

**A を採用**。5 type すべてを `<resource>_masters` + `child_<resource>_preferences` の 2 表構造で表現する。child 選択は authenticated 内部 UI でのみ行い、marketplace ページには child 名 / プルダウンを一切表示しない。

### 適用範囲 (5 type)

| type | master table | per-child preferences | progress / history |
|---|---|---|---|
| activity | `activities` (既存) | `child_activity_preferences` (既存、`is_visible` 列追加) | `activity_logs` (既存) |
| reward-set | `reward_masters` (新) | `child_reward_preferences` (新) | `special_rewards` (per-child progress として残し master を JOIN) |
| checklist | `checklist_template_masters` (新) | `child_checklist_preferences` (新) | `checklist_logs` / `checklist_overrides` (既存、`template_id` を master 参照に変更) |
| rule-preset | `rule_masters` (新) | `child_rule_preferences` (新、exchange / bonus 区別を含む) | 既存 `special_rewards` (exchange) / settings KVS (bonus) |
| challenge-set | `sibling_challenges` (既存、family-wide のため preferences 不要) | — | `sibling_challenge_progress` (既存) |

### 設計原則 (per-child instance パターン禁忌)

- 新規リソース type を追加する場合は **必ず family master + per-child preferences パターン**で設計する
- `<resource>.childId notNull` 形式の master + progress 混在テーブルを新規作成しない (既存 `special_rewards` / `checklist_templates` は本 EPIC で廃止)
- marketplace ページ (public 経路) には childId / child name を一切露出しない (URL query / hidden form / プルダウンいずれも不可)
- child 単位の表示制御は authenticated 内部 UI でのみ行う (admin 画面の visibility chip / edit modal)

### Pattern Z (age filter) default + Pattern Y (visibility chip toggle) override

- **default**: master の `age_min / age_max` で age filter (90% のケースで親は何もしない、Hick's Law 整合)
- **override**: edit modal 内に per-child visibility chip 列を出し、親が任意に override 可能
- 一覧画面の row には visibility chip を default 非表示 (age filter 結果を信じる)

詳細仕様は `docs/design/import-hub-data-model-principles.md` (本 PR 新規追加) を参照。

## 結果

- privacy リスク (OWASP CWE-598 / COPPA / GDPR Art.8 信頼毀損) を構造的に解消
- データ重複 9 行 → 3 master + 9 visibility 行 (master 列が単一 SSOT)
- 5 type 横断の paradigm が `activities` 同型に統一 → 親の認知負荷削減 / 開発者の type 切替 cost 0
- 移行コスト: 本番 user 0 / α tester 0 のため Pre-PMF 段階で旧 schema drop + 新 schema 適用が可能 (本 EPIC #2362 PR-3〜7 で各 type 別に実施、PR-1 = 本 ADR + 設計書、PR-2 = 共通 primitive / framework、PR-3〜7 = type 別 service refactor + UI + schema drop、PR-8 = demo Lambda + LP SS + 設計書同期)

## 関連

- EPIC #2362 (UnifiedImportHub 統一)
- ADR-0010 (Pre-PMF Bucket A 判断)
- ADR-0013 (LP truth、本 ADR は LP 訴求と整合する master 集約を選んでいる)
- ADR-0014 / #1350 (OSS 先調査ルール)
- ADR-0047 (Demo / 本番 UI Contract SSOT、本 ADR の master + preferences は demo fixture にも同型適用)
- ADR-0052 (MarketplaceTypeRegistry、本 ADR は data model 側、ADR-0052 は import strategy 側で相補)
- `docs/design/import-hub-data-model-principles.md` (本 PR 新規追加、原則の実装 SSOT)
- `docs/design/08-データベース設計書.md` §3.X (本 PR で新 master + preferences schema を追加、旧 schema 廃止予告)
