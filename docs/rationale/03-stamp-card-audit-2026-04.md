# スタンプカード L2 逸脱調査 (2026-04)

| 項目 | 内容 |
|------|------|
| 対象 Issue | #1339 C1-STAMP-AUDIT |
| 調査日 | 2026-04-26 |
| 調査者 | Claude Dev Session |
| 判断基準 | 設計書 `docs/design/26-ゲーミフィケーション設計書.md` §2〜§7 |

---

## 1. 調査サマリー

| 調査項目 | 逸脱有無 | 判定 |
|---------|---------|------|
| 1. stamps コレクション UI の有無 | なし | L2 準拠 |
| 2. レア度演出の UX | 軽微な懸念あり | 条件付き L2 準拠 |
| 3. ポイント以外の独立報酬の有無 | なし | L2 準拠 |
| 4. 毎日 N（最頻度）連続時の UX | 懸念あり | 逸脱の可能性 |

**結論: C1-STAMP-FIX 要否** → 項目 4 について軽微な改善余地があり、後続 Issue 起票を推奨するが **Blocker 相当の逸脱はなし**。

---

## 2. 詳細調査結果

### 2.1 stamps コレクション UI の有無

**調査対象**:
- `src/routes/(child)/` 配下 — stamp を含む Svelte ルート
- `src/lib/features/` 配下 — stamp 関連コンポーネント
- `src/lib/ui/components/` — StampCard.svelte, StampPressOverlay.svelte

**調査結果: スタンプコレクション閲覧専用画面は存在しない**

スタンプカードの UI は以下 2 コンポーネントのみ:

| コンポーネント | 場所 | 役割 |
|--------------|------|------|
| `StampCard.svelte` | `src/lib/ui/components/StampCard.svelte` | ホーム画面に埋め込まれた今週のカード表示 |
| `StampPressOverlay.svelte` | `src/lib/ui/components/StampPressOverlay.svelte` | ログイン押印時の一時的なオーバーレイ演出 |

StampCard.svelte はホーム画面の一部として表示され、スタンプ一覧閲覧のための専用ルートは `src/routes/(child)/` 配下に存在しない。

**着せ替え・並び替え・詳細展開等の長時間滞在誘引演出**: 一切存在しない。

**逸脱なし** — Anti-engagement 原則（ADR-0012）準拠。

---

### 2.2 レア度演出の UX

**調査対象**: `StampPressOverlay.svelte` 全体

**演出内容**:

`StampPressOverlay.svelte` の `rarityConfig` 定義:

```typescript
const rarityConfig = {
  N: { glow: 'none', particles: [], tier: 0 },
  R: { glow: '0 0 15px rgba(59, 130, 246, 0.4)', particles: ['💙', '✨'], tier: 1 },
  SR: { glow: '0 0 20px rgba(147, 51, 234, 0.5)', particles: ['💜', '✨', '🌟'], tier: 2 },
  UR: { glow: '0 0 30px rgba(255, 215, 0, 0.6)', particles: ['🌟', '✨', '💫', '🎊'], tier: 3 },
};
```

演出フェーズ（`$effect` による自動遷移）:
- `phase = 'card'` → 400ms 後 `phase = 'press'`（押印アニメーション）
- `phase = 'press'` → 1200ms 後 `phase = 'points'`（ポイント表示）
- `phase = 'weekly'`（前週 redeem がある場合のみ）

**総演出時間**: 約 1.2 秒でポイント表示まで自動遷移。ユーザーがタップしないと閉じない設計（`closable={false}`）。

**予測可能性示唆 UI**: 「あと何枚で SR が出やすい」等の確率表示や pity システムは一切実装されていない。レア度は純粋にランダム（重み付き）のみ。

**ガチャ的「回す」「引く」アニメーション**: 存在しない。「おしました」の押印演出のみ。

**軽微な懸念点**:
- SR/UR 時にパーティクル (`💜✨🌟` / `🌟✨💫🎊`) が `config.tier >= 2` の場合に表示される
- `soundService.play('special-reward')` も SR/UR 時に追加で鳴る
- これは設計書 §7.5 の「ランク別演出」に対応しており、設計意図の範囲内
- ただし SR/UR の演出が「N と比較して明らかに豪華」であることは、N が出たときの「普通感」を生む

この「普通感」は §2.1 基本原則 3「ポジティブトーンのみ」に引っかかる可能性があるが、現時点では Blocker 相当ではない（後述 §2.4 で詳述）。

**逸脱なし（条件付き）** — L2 設計意図の範囲内。ただし項目 4 との関係で N 演出改善余地あり。

---

### 2.3 ポイント以外の独立報酬の有無

**調査対象**:
- `stamp-card-service.ts` の全 `insertPointEntry` 呼び出し
- 称号・実績サービスとスタンプの連携
- スキーマ上のスタンプ → 称号/実績トリガー

**調査結果**:

スタンプカードサービスが発行するポイントエントリは 3 種類のみ:

```typescript
type: 'stamp_instant'  // 押印時即時ポイント (5pt × レアリティ倍率)
type: 'stamp_card'     // 週末 redeem 時ポイント (スロット数 × 10pt + コンプリートボーナス 50pt)
```

- `custom-achievement-service.ts` にスタンプキーワードは存在しない（`grep` で確認済み）
- 称号・実績テーブルとスタンプカードの JOIN / トリガーはスキーマに存在しない
- 「全 16 種類コレクション達成で追加ボーナス」等の仕組みはコードに存在しない

**ポイント統一原則（§2.4）との照合**:

| 確認事項 | 結果 |
|---------|------|
| スタンプ → 称号解放のトリガー | なし |
| 全種類コレクション達成ボーナス | なし |
| スタンプ独自通貨 | なし |
| ポイント以外の出力 | なし |

**逸脱なし** — ポイント統一原則完全準拠。

---

### 2.4 毎日 N（最頻度）が連続で出た時の UX

**調査対象**: `StampPressOverlay.svelte` の `phase = 'points'` 表示部

**N 出現時のメッセージ**:

```svelte
{#if phase === 'points'}
  <p class="sp__points-value">+{instantPoints}pt</p>
  <!-- consecutiveDays >= 2 の場合のみストリーク表示 -->
  <!-- isComplete の場合 "コンプリート！" -->
  <!-- そうでない場合 "あと{remaining}回でコンプリート！" -->
  <button>やったね！</button>
{/if}
```

N レアリティの場合:
- `instantPoints = 5pt`（N の RARITY_MULTIPLIER = 1）
- `config.tier = 0` なのでグロー・パーティクルなし
- スタンプ画像は `/assets/stamps/kichi.png` または `/assets/stamps/suekichi.png`（現在は絵文字 fallback）

**メッセージのポジティビティ分析**:

| シナリオ | 表示 | ポジティブ度 |
|---------|------|------------|
| N 出た、カード未完成 | `+5pt` + `あとX回でコンプリート！` | 中程度 — ポジティブだが単調 |
| N 出た、連続2日+ | `+5pt` + `X にちれんぞく！` | ポジティブ（連続日数の強調） |
| N 出た、コンプリート | `+5pt` + `コンプリート！週末にボーナスポイント！` | ポジティブ |

**懸念点（逸脱候補）**:

1. **N 連続時のポジティブフレーミング不足**: SR/UR が出た場合は `soundService.play('special-reward')` + パーティクル演出があるが、N の場合は `soundService.play('stamp-press')` + 画像表示のみ。N が 5 日連続で出た場合に「また N か」という感情を生む UX リスクがある

2. **おみくじランク名（吉/末吉）の表示有無**: `StampPressOverlay.svelte` を確認したところ、`stampOmikujiRank` は `getStampImagePathSafe()` の引数としてスタンプ画像パスの決定にのみ使われており、UI 上に「末吉」というテキストは表示されない。これは適切な設計（N でも「末吉」という文字を見せない）

3. **N 独自のポジティブメッセージなし**: N 出現時のコピーが「あとX回でコンプリート！」のみで、N の価値を肯定するメッセージがない。設計書 §7.5 のランク別演出表では N は「通常表示」と記されているが、**ポジティブフレーミング**への言及がない

**逸脱の可能性あり（軽微）** — ポジティブトーン原則（§2.1 原則 3）への対応が不完全。

---

## 3. 逸脱有無サマリー（表形式）

| # | 調査項目 | 逸脱 | 根拠コード / 設計原則 | 備考 |
|---|---------|------|---------------------|------|
| 1 | stamps コレクション閲覧画面の有無 | **なし** | ルート一覧に専用画面なし | L2 準拠 |
| 2 | レア度演出の UX（予測可能性示唆なし） | **なし** | `rarityConfig` に pity/確率表示なし | 条件付き準拠 |
| 2 | ガチャ的「回す」「引く」アニメーション | **なし** | `StampPressOverlay` に該当なし | L2 準拠 |
| 3 | ポイント以外の独立報酬（称号解放等） | **なし** | `insertPointEntry` の type は stamp_instant/stamp_card のみ | 完全準拠 |
| 4 | N 連続時のポジティブフレーミング | **逸脱候補** | N 時の独自肯定メッセージなし | 軽微 — §2.1 原則 3 |

---

## 4. 結論

**全体判定: L2 概ね準拠。Blocker 相当の逸脱はなし。**

Anti-engagement 原則（ADR-0012）、ポイント統一原則（§2.4）、1 日 1 回 cap（`ALREADY_STAMPED` guard）はすべて実装で遵守されている。

### 軽微な改善候補（C1-STAMP-FIX 起票要否）

| 改善候補 | 優先度 | 具体的な対応案 |
|---------|--------|--------------|
| N 出現時のポジティブフレーミング強化 | 低 | 「がんばったね！」「スタンプゲット！」等の専用コピーを N 時に追加 |
| N/R/SR/UR 全レアリティ共通の"獲得祝福"表現の統一 | 低 | レアリティに関わらず「スタンプ もらったよ！」の基底メッセージを維持 |

**C1-STAMP-FIX 起票判断**: Blocker ではないため **必須ではない**。ただし §2.1 原則 3「ポジティブトーンのみ」の細かい適用として、PO が判断して軽微改善 Issue を起票することを推奨する。

---

## 5. 調査範囲と除外項目

| 対象 | 調査 | 備考 |
|------|------|------|
| `src/lib/ui/components/StampCard.svelte` | 完了 | ホーム画面表示コンポーネント |
| `src/lib/ui/components/StampPressOverlay.svelte` | 完了 | 演出・UX メイン |
| `src/lib/server/services/stamp-card-service.ts` | 完了 | ビジネスロジック全体 |
| `src/lib/server/db/schema.ts` (stamp 関連テーブル) | 完了 | stamp_masters / stamp_cards / stamp_entries |
| `src/lib/domain/stamp-image.ts` | 完了 | omikuji ランク↔レアリティのマッピング |
| `src/routes/(child)/[uiMode=uiMode]/home/+page.server.ts` | 完了 | loginStamp action |
| `/demo` 配下のスタンプ関連画面 | 除外 | デモ側は別 Issue scope |

---

## 6. 参照コードパス

| 機能 | コードパス |
|------|-----------|
| 押印ロジック（1 日 1 回 cap） | `src/lib/server/services/stamp-card-service.ts` L174-252 |
| レアリティ抽選 | `src/lib/server/services/stamp-card-service.ts` L87-113 |
| 即時ポイント付与 | `src/lib/server/services/stamp-card-service.ts` L229-246 |
| 週末 redeem ポイント | `src/lib/server/services/stamp-card-service.ts` L254-324 |
| 演出設定（rarityConfig） | `src/lib/ui/components/StampPressOverlay.svelte` L53-58 |
| N 出現時メッセージ | `src/lib/ui/components/StampPressOverlay.svelte` L157-168 |
| omikuji ランク非表示（適切設計） | `src/lib/ui/components/StampPressOverlay.svelte` L64, 112, 116 |
| ホーム画面スタンプカード表示 | `src/lib/ui/components/StampCard.svelte` |
| loginStamp action | `src/routes/(child)/[uiMode=uiMode]/home/+page.server.ts` L336-384 |
