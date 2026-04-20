# マーケットプレイス・ごほうびプリセット監査

**作成日**: 2026-04-21
**対象**: `src/lib/data/marketplace/reward-sets/` 配下 10 ファイル (年齢別 5 + テーマ別 5)
**目的**: 各ごほうびセットを「プリセット顧客付加価値原則 (こんなの もらいたかった！ / あげたかった！)」に照らして監査し、メタごほうび・件数非対称・漢字かな混在等の運用欠陥を洗い出す
**先行資料**: `marketplace-preset-activity-audit.md` (活動プリセット側の監査), `marketplace-overhaul-spec.md`

---

## 要約 (TL;DR)

1. **総報酬インスタンス数**: 77 (年齢別 10×5 = 50 + テーマ別 5-6×5 = 27)
2. **メタごほうび (アプリ内機能の二重計上)**: **2 件**（critical、本 PR で削除）
   - `kinder-rewards` の「ごほうびシール もらえる」
   - `elementary-rewards` の「連続記録バッジGET」
3. **件数非対称**: 年齢別 10 件 / テーマ別 5-6 件（同一扱いなら件数揃える or 役割を分離する必要）
4. **テーマ型ごほうびセットの運用方針**: **PO 判断待ち**（`memory: プリセット顧客付加価値原則` はテーマ型は追加インポートで扱う方針だが、現状 reward 側は同梱継続）
5. **elementary-rewards のひらがな/カタカナ混在**: 軽微（「連続記録バッジGET」のみ漢字+カタカナ → 1 で削除対象のため解消）
6. **experience-rewards の年齢 cap**: 3〜12 歳のみ。高校生世代の家族体験ごほうびは senior-rewards 内でも少ない（低優先 follow-up）

---

## §1 インベントリ

### §1.1 年齢別 5 セット (各 10 件)

| itemId | 対象 | 件数 | personas |
|---|---|---|---|
| toddler-rewards | 0〜3 歳 | 10 | first-child / relaxed |
| kinder-rewards | 3〜5 歳 | 10 | routine-focused / relaxed |
| elementary-rewards | 6〜9 歳 | 10 | achievement-focused / game-oriented |
| junior-rewards | 10〜12 歳 | 10 | achievement-focused / game-oriented |
| senior-rewards | 13〜18 歳 | 10 | achievement-focused / relaxed |

### §1.2 テーマ別 5 セット (各 5〜6 件)

| itemId | 対象 | 件数 | personas |
|---|---|---|---|
| experience-rewards | 3〜12 歳 | 5 | outdoor / sibling |
| screen-time-rewards | 5〜18 歳 | 5 | game-oriented / dual-income |
| creative-rewards | 3〜12 歳 | 5 | creative-oriented / indoor |
| food-rewards | 2〜12 歳 | 6 | relaxed / routine-focused |
| privilege-rewards | 5〜15 歳 | 6 | achievement-focused / self-care |

---

## §2 CRITICAL 所見 — メタごほうび (アプリ内機能の二重計上)

「ごほうび」は実生活で子供が楽しみにするリアルな報酬 (おやつ / お小遣い / 特別体験) である。**アプリ内で既に実装されている仕組み (stamp / badge)** を「ごほうび」として再掲載するのはユーザに二重計上に見え、ごほうび機能の価値を希薄化させる。

### §2.1 `kinder-rewards`: 「ごほうびシール もらえる」(10pt)

```json
{
  "title": "ごほうびシール もらえる",
  "points": 10,
  "icon": "🌟",
  "category": "other",
  "description": "きょうの ごほうびシールを 1まい もらおう"
}
```

**問題**: ごほうびシール (stamp) は活動達成時に自動付与される中核機能 (`src/lib/ui/features/StampGallery.svelte` 他)。それをポイント消費型の「ごほうび」として再登場させると、子供からは「シールもらうのにポイント要るの？」という混乱を生む。

**修正**: 削除し、3〜5 歳向けの代替ごほうびに差替 (例: 「すきな おもちゃで 30ぷんあそぶ」)。

### §2.2 `elementary-rewards`: 「連続記録バッジGET」(70pt)

```json
{
  "title": "連続記録バッジGET",
  "points": 70,
  "icon": "🥇",
  "category": "other",
  "description": "連続達成でバッジがもらえる（コレクション）"
}
```

**問題**: 連続達成バッジは既存のストリーク/称号機能で自動付与される。ポイント消費で購入するものではない。また description の「連続達成で」という条件は「ポイントで交換」の意味合いと矛盾し、子供に理解不能。

**修正**: 削除し、小学生に現実的な代替ごほうびに差替 (例: 「くじびき 1かい」)。

---

## §3 運用方針欠落 — テーマ型ごほうびセット 5 件の扱い

### 背景

活動プリセット側では memory 記載の「プリセット顧客付加価値原則」に基づき 15 パック純化 (年齢×性別のみ、テーマ型 9 件廃止) 済み (#1212-C, task #106 完了)。

### reward 側の現状

年齢別 5 セット (各 10 件) + **テーマ別 5 セット (各 5-6 件)** が `allItems` に同梱されている。テーマ別は activity 側の廃止方針と**非対称**。

### 選択肢

- **(A) 年齢別に純化**: テーマ別 5 セットは追加インポート (今後の「テーマパック」機能) に分離。年齢別 10 件でベースは充足するので同梱不要
- **(B) 年齢別 + テーマ別を別役割で維持**: 年齢別=生活導線、テーマ別=ごほうび拡張として両立
- **(C) 件数対称にして両方同梱**: テーマ別も 10 件に拡充

### PO 判断を要するポイント

- activity 側 (A) に合わせて reward も純化するか
- reward の方が「嗜好が分かれる体験型・特権型」の価値が高く、テーマ別を維持する価値があるか

→ **本監査では PO 判断待ちとして記録のみ。Issue 化は PO 応答後。**

---

## §4 LOW PRIORITY 所見 (follow-up 候補)

### §4.1 `experience-rewards` の年齢 cap (3〜12 歳)

高校生世代（13-18）は `senior-rewards` にカバーされるが、家族体験系（キャンプ・水族館等）は senior に少ない。experience を 3-18 に拡張するか、senior 側に家族体験を追加する選択肢。

### §4.2 `screen-time-rewards` の「特別感」不足

単なる時間延長 (ゲーム 15分 / YouTube 15分 / タブレット 30分 / アプリ 30分 / 映画 1本) のみで、「こんなのもらいたかった」要素が薄い。「親子対戦 30分」「家族映画会」等、体験要素を含む案あり。

### §4.3 カテゴリ誤分類の疑い

| ファイル | 報酬 | 現カテゴリ | 要検討 |
|---|---|---|---|
| kinder-rewards | シャボンだまあそび | sports | creative / other のほうが妥当 |
| experience-rewards | すいぞくかん | academic | other (体験) |

軽微。PO 判断不要な範囲で調整可能。

---

## §5 本 PR の対応範囲

- **§2.1 / §2.2 のメタごほうび 2 件を差替**（即修正）
- 本監査レポートを新規保存
- §3 (テーマ型運用方針) と §4 (LOW PRIORITY) は本 PR 対応外。PO 判断待ち・follow-up 候補として記録のみ。
