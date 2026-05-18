# 家族グループ管理 設計書

| 項目 | 内容 |
|------|------|
| Issue | #2179 (EPIC #2176 子 Issue) |
| 版数 | 1.0 |
| 作成日 | 2026-05-18 |
| 作成者 | Dev セッション |
| ステータス | committed (現状実装) + aspirational (将来拡張) を分離 |
| 関連 ADR | ADR-0013 (LP truth, committed/aspirational 分離) |

---

## §1 設計背景

### 1.1 なぜこの SSOT が必要か

がんばりクエストは「家族」を単位とする家庭内専用 Webアプリ。テナント = 1 家族で、家族内に複数のこども・複数の保護者メンバーが所属する。Phase Admin-Nav-Restructure (#2176 EPIC) で親管理画面に「家族」カテゴリを新設するに伴い、「家族グループ」という概念の SSOT が必要になった。

これまでの問題:

- 「こども」管理と「メンバー」管理は別ページとして実装されているが、概念上は「家族グループ」配下の構成要素であることが文書化されていなかった
- 将来拡張 (家族グループ招待リンク / テナント名設定 / 家族プロフィール) が PO の頭の中にあるだけで、committed と aspirational の境界が曖昧だった
- ADR-0013 (LP truth) が要求する「実装にない機能を LP / UI に記載しない」原則を守るため、何が committed で何が aspirational かを明示する必要があった

### 1.2 この設計がなかった場合に何が困るか

- 開発者: 「家族グループ管理」の概念図がないと、新規機能追加時にどの aspirational が将来 committed に昇格する想定なのか分からない
- PO / マーケ: LP / UI に書いてよい committed と書いてはいけない aspirational の境界が共有されていない
- レビュー: PR で「これは家族グループの何 ?」と問われたときに参照先がない

---

## §2 設計原則

1. **committed / aspirational を明示分離** (ADR-0013 整合): 現状実装ファイル参照を伴う committed と、将来構想のみの aspirational を表で完全分離
2. **aspirational を LP / UI に書かない**: 本 SSOT 改訂時に aspirational → committed 昇格があった場合のみ LP / UI 表現を許可
3. **概念図は最小限**: 階層が深くなる前は表で十分。階層化したくなったら drawio で追加
4. **既存 URL を変えない**: 概念の SSOT 化であって、URL リネームは伴わない

---

## §3 仕様

### 3.1 概念階層

```
家族グループ (= テナント = 1 家庭)
├── こども (1〜N 人、年齢別モード = baby/preschool/elementary/junior/senior)
└── メンバー (1〜N 人、保護者の招待 / 権限管理)
```

### 3.2 committed (現状実装)

LP / UI に記載してよい範囲。実装ファイル参照付き。

| 機能 | URL | 主な実装ファイル | 概要 |
|---|---|---|---|
| **こども管理** | `/admin/children` | `src/routes/(parent)/admin/children/+page.svelte` / `src/routes/(parent)/admin/children/+page.server.ts` | こども追加・編集・年齢モード設定・テーマ色変更・アーカイブ (`is_archived`) |
| **メンバー管理** | `/admin/members` | `src/routes/(parent)/admin/members/+page.svelte` / `src/routes/(parent)/admin/members/+page.server.ts` | 家族メンバーの招待 / 権限ロール (`owner` / `parent` / `child`) |

### 3.3 aspirational (将来拡張、現状 LP / UI 非記載)

> **ADR-0013 整合**: 以下は **LP / 法務文書 / アプリ UI に「実装済み」と書いてはいけない**。本表が SSOT。

| 構想機能 | 想定 URL | 想定実装 | 構想概要 |
|---|---|---|---|
| **家族グループ招待リンク** | (未定、`/admin/family/invite` 等) | (未着手) | 招待リンクを発行して家族メンバー / 親族を accept フローで追加。現状は `/admin/members` の手動追加のみ |
| **テナント名 (家族グループ名) 設定** | (未定、`/admin/family/profile` 等) | (未着手) | 家族グループに「○○家」のような名前を付ける。現状はテナント ID (`tenant_id`) のみで、家族名概念は持たない |
| **家族プロフィール** | (未定) | (未着手) | 家族全体を表現する 1 つのプロフィール (アイコン / 自己紹介 / 共通テーマ)。Apple Family Sharing 流 |

### 3.4 共通権限ポリシー (現状実装範囲)

| ロール | こども管理 | メンバー管理 | 備考 |
|---|---|---|---|
| `owner` | ✅ 全権 | ✅ 全権 (招待 / ロール変更 / 削除) | テナント作成者 |
| `parent` | ✅ 全権 | △ 招待のみ (owner 変更 / 削除不可) | 副管理者 |
| `child` | ❌ | ❌ | 親管理画面アクセス不可 (リダイレクト) |

詳細は `docs/design/14-セキュリティ設計書.md` §5 認可境界を参照。

### 3.5 ナビゲーション配置 (EPIC #2176 / AN-1 #2177 同期)

`NAV_CATEGORIES.family` (本 EPIC で新設) 配下に統合:

```typescript
// src/lib/domain/labels.ts (改訂後)
export const NAV_CATEGORIES = {
  family: { label: '家族', icon: '👨‍👩‍👧' },  // 新設
  activity: { label: '活動', icon: '🎮' },
  record: { label: '記録', icon: '📊' },
  settings: { label: '設定', icon: '⚙️' },
} as const;
```

| カテゴリ | 配下項目 | 備考 |
|---|---|---|
| **家族** (新設) | こども (`/admin/children`) + メンバー (`/admin/members`) | subject-first 上位化 (Family Link 流) |
| 活動 | (変更なし、こども項目を「家族」に移動済) | |
| 記録 | (変更なし) | |
| 設定 | (変更なし、メンバー項目を「家族」に移動済) | |

---

## §4 関連ドキュメント

- [docs/design/admin-ia.md](admin-ia.md) — 親管理画面 IA v2.0 (本 EPIC で改訂)
- [docs/design/06-UI設計書.md](06-UI設計書.md) — UI コンポーネント仕様
- [docs/design/14-セキュリティ設計書.md](14-セキュリティ設計書.md) — 認可境界 (owner / parent / child)
- [docs/rationale/10-admin-nav-restructure-rationale.md](../rationale/10-admin-nav-restructure-rationale.md) — 5 tab + family カテゴリ採用経緯
- [src/lib/domain/labels.ts](../../src/lib/domain/labels.ts) — NAV_CATEGORIES SSOT
- [src/routes/(parent)/admin/children/](../../src/routes/(parent)/admin/children/) — こども管理実装
- [src/routes/(parent)/admin/members/](../../src/routes/(parent)/admin/members/) — メンバー管理実装

---

## §5 更新ルール

- **aspirational → committed 昇格時**: 当該行を `§3.2 committed` に移動し、実装ファイルパス + URL を明記。同 PR で LP / UI 訴求も解禁可
- **新規 committed 機能追加時**: `§3.2 committed` 表に行追加
- **新規 aspirational 構想追加時**: `§3.3 aspirational` 表に行追加 (LP / UI 訴求禁止のまま)
- **権限ポリシー変更時**: `§3.4 共通権限ポリシー` + `docs/design/14-セキュリティ設計書.md §5` を同期更新
