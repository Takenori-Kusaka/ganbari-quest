# 並行実装マップ — がんばりクエスト

**ステータス**: 🟥 **注意** — 本プロジェクトには同じ概念を扱う並行実装が 8 カテゴリ以上存在する。
修正時には必ずこのマップを参照し、すべての並行実装ペアに対応を行うこと。

**最終更新**: 2026-04-07（#564 Tier 1 対策として新設）

---

## なぜこのマップが必要か

同じ概念を扱う並行実装が複数存在するため、片方だけ修正して片方が放置される「同期漏れ」が繰り返し発生している。

### 直近の同期漏れ事例

| Issue | 事象 | 原因の並行実装ペア |
|-------|------|------------------|
| [#531](https://github.com/Takenori-Kusaka/ganbari-quest/issues/531) | 「ちゃんの」suffix修正の横展開漏れ | 5 つの年齢モードディレクトリ |
| [#561](https://github.com/Takenori-Kusaka/ganbari-quest/issues/561) | LP の「ようちえんキッズ」が #537 年齢区分再設計時に漏れた | アプリラベル vs LPラベル |
| [#562](https://github.com/Takenori-Kusaka/ganbari-quest/issues/562) | デモシードが年齢区分再設計に追従せず矛盾 | 本番コード vs デモシード |
| [#563](https://github.com/Takenori-Kusaka/ganbari-quest/issues/563) | デモガイドが Step 2 で停止 | 本番チュートリアル vs デモガイド |

---

## 並行実装ペア一覧

### 🔴 優先度: 最高 — 同期漏れが頻発

#### 1. アプリ (src/) vs LP (site/)

| 場所 | 内容 | 技術 |
|------|------|------|
| `src/lib/domain/labels.ts` | アプリの用語辞書（Single Source of Truth） | TypeScript |
| `site/index.html` | LP トップページの用語直書き | 静的 HTML |
| `site/pamphlet.html` | パンフレットページの用語直書き | 静的 HTML |
| `site/shared-labels.js` | LP 共通用語ラッパ（2026-04-07 新設、#561） | JavaScript |

**同期メカニズム**:
- **現状（手動）**: アプリ側 `labels.ts` 変更 → LP 側 HTML を `grep` で探して手動更新 → `site/shared-labels.js` も同期
- **Tier 2（#565 で予定）**: `scripts/generate-lp-labels.mjs` で `labels.ts` から自動生成
- **Tier 3（#566 で予定）**: LP ビルド時の Svelte から静的 HTML 生成（SSG 統合）

**修正時チェック**:
```bash
# アプリ側の用語変更が LP に影響していないか grep
grep -rn "変更前の用語" site/ src/lib/domain/labels.ts
```

---

#### 2. 年齢モード 5 ディレクトリ

| 場所 | 内容 |
|------|------|
| `src/routes/(child)/baby/` | 乳幼児モード（0〜2歳） |
| `src/routes/(child)/preschool/` | 幼児モード（3〜5歳） |
| `src/routes/(child)/elementary/` | 小学生モード（6〜12歳） |
| `src/routes/(child)/junior/` | 中学生モード（13〜15歳） |
| `src/routes/(child)/senior/` | 高校生モード（16〜18歳） |

**同期メカニズム**:
- **現状（手動）**: 1 モード修正 → 残り 4 モードを手動で横展開
- **Tier 3（#566 で予定）**: `src/routes/(child)/[uiMode]/` のパラメータルートに集約

**修正時チェック**:
```bash
# 特定機能のファイル横串検索
grep -rn "修正対象のコンポーネント名" src/routes/\(child\)/
```

**旧名称との対応** (2026-04-06 #537 で改名):
- `baby` ← 旧 `baby`（変更なし）
- `preschool` ← 旧 `kinder`
- `elementary` ← 旧 `lower` + 一部 `upper`
- `junior` ← 旧 `upper` の 13 歳以上 + 旧 `teen` の 15 歳
- `senior` ← 旧 `teen` の 16 歳以上

---

#### 3. 本番コード vs デモ

| 場所 | 内容 |
|------|------|
| `src/routes/(child)/`, `src/routes/(parent)/` | 本番コード |
| `src/routes/demo/(child)/[mode]/` | デモの子供画面 |
| `src/routes/demo/(parent)/admin/` | デモの親画面 |
| `src/lib/server/demo/demo-data.ts` | デモ用シードデータ（静的） |

**同期メカニズム**:
- **現状（手動）**: 本番コード変更 → デモ画面を手動で追従
- **Tier 3（#566 で予定）**: デモアダプタパターンで本番コードを流用

**修正時チェック**:
- 新しいページを追加したら `src/routes/demo/(child)/[mode]/<新ページ>` も作ること
- デモシードのデータ構造がスキーマと整合しているか `tests/unit/demo/demo-data-integrity.test.ts` で検証

---

### 🟡 優先度: 高 — 定期的な漏れがある

#### 4. デスクトップナビ vs モバイルナビ

| 場所 | 内容 |
|------|------|
| `src/lib/features/admin/components/AdminLayout.svelte` | デスクトップの親ナビ（ドロップダウン） |
| `src/lib/ui/components/BottomNav.svelte` | モバイルのボトムナビ |
| `src/lib/features/admin/components/AdminMobileNav.svelte` | モバイルの親ナビ |

**同期メカニズム**:
- **現状（手動）**: 1 箇所でメニュー追加 → 全ナビで追加
- **Tier 2（#565 で予定）**: `src/lib/domain/navigation.ts` に一元化

**修正時チェック**:
```bash
grep -rn "ナビ項目ラベル" src/lib/features/admin/ src/lib/ui/components/BottomNav.svelte
```

---

#### 5. 本番ナビ vs デモナビ

| 場所 | 内容 |
|------|------|
| 本番 admin | `src/routes/(parent)/admin/` |
| デモ admin | `src/routes/demo/(parent)/admin/` |

**同期メカニズム**:
- **現状（手動）**
- **Tier 3（#566 で予定）**: デモアダプタで統合

---

#### 6. 本番チュートリアル vs デモガイド

| 場所 | 内容 |
|------|------|
| `src/lib/features/tutorial/tutorial-chapters.ts` | 本番チュートリアル |
| `src/lib/features/demo/demo-guide-state.svelte.ts` | デモガイドツアー |

**同期メカニズム**:
- **現状（別ロジック）**: UI も進行ロジックも独立
- 将来的に共通化を検討

**修正時チェック**:
- ナビ構造変更 → 両方のセレクタ更新が必要
- ページ追加 → 両方のステップ定義更新が必要

---

### 🟢 優先度: 中 — スキーマ変更時に注意

#### 7. シードデータ vs マイグレーション

| 場所 | 内容 |
|------|------|
| `tests/e2e/global-setup.ts` | E2E テスト用シードデータ |
| `tests/unit/helpers/test-db.ts` | ユニットテスト用 DB 初期化 |
| `drizzle/` | 本番マイグレーション |
| `src/lib/server/demo/demo-data.ts` | デモ用シードデータ |

**同期メカニズム**:
- **現状（手動）**: スキーマ変更 → シード 3 箇所を手動更新
- **Tier 2（#565 で予定）**: シード生成の一元化

**修正時チェック**:
- DB テーブル追加 → `tests/e2e/global-setup.ts` + `test-db.ts` + `demo-data.ts` 全て更新

---

#### 8. 設計書 vs 実装

| 場所 | 内容 |
|------|------|
| `docs/design/07-API設計書.md` | API 仕様 |
| `docs/design/08-データベース設計書.md` | DB スキーマ |
| `docs/design/06-UI設計書.md` | UI 設計 |
| 実装コード | 実体 |

**同期メカニズム**:
- **現状（手動）**: チケット完了時に設計書更新チェック

---

## 修正時チェックリスト

**すべての修正前に、以下のどれに該当するか確認し、対応するペアを触ること**:

- [ ] **UI ラベル・用語** → `src/lib/domain/labels.ts` + `site/index.html` + `site/pamphlet.html` + `site/shared-labels.js` + `tutorial-chapters.ts`
- [ ] **年齢モード** → `src/routes/(child)/{baby,preschool,elementary,junior,senior}/` の 5 ディレクトリ全て
- [ ] **本番画面** → 同等機能が `src/routes/demo/` にも存在しないか確認
- [ ] **アプリ機能** → LP (`site/`) で紹介している場合は文言同期
- [ ] **ナビゲーション** → デスクトップ (`AdminLayout`) + モバイル (`AdminMobileNav`) + ボトムナビ (`BottomNav`)
- [ ] **DB スキーマ** → `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts`
- [ ] **チュートリアル** → 本番 (`tutorial-chapters.ts`) + デモ (`demo-guide-state.svelte.ts`)
- [ ] **設計書** → 影響する `docs/design/*.md` を更新

---

## 解消計画

| Tier | Issue | 内容 | ステータス |
|------|-------|------|-----------|
| Tier 1 | [#564](https://github.com/Takenori-Kusaka/ganbari-quest/issues/564) | 本マップ作成 + CLAUDE.md/PR/Issue テンプレ更新 | 🟢 実施中 |
| Tier 2 | [#565](https://github.com/Takenori-Kusaka/ganbari-quest/issues/565) | CI 自動チェック + ナビ一元化 + LP ラベル自動生成 | 🔴 未着手 |
| Tier 3 | [#566](https://github.com/Takenori-Kusaka/ganbari-quest/issues/566) | 年齢モード統合 + デモアダプタ + LP ビルド統合 | 🔴 未着手 |
