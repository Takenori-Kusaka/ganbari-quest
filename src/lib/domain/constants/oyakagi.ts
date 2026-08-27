// src/lib/domain/constants/oyakagi.ts
// おやカギコード（親向けご家族の見守り画面ロック）関連の定数
// 用語ラベルは labels.ts の OYAKAGI_LABELS を参照。ここはロジック定数のみ。

/** pin_hash 未設定テナントに対する照合用デフォルト値（がんばり語呂合わせ）。
 * コード公開情報扱い。家庭内軽仕切りの脅威モデルと整合（ADR-0010）。 */
export const DEFAULT_PIN = '5086';

/**
 * おやカギコードの桁数 (#4661 / #4662)。**入口も出口もこの 1 つの値で揃える。**
 *
 * 桁数は以前 4 通りに割れていた:
 *   - `/switch` の入力 (`PinInput length={4}`) — 顧客が毎日使う唯一の入口。**ちょうど 4 桁しか打てない**
 *   - parent-gate の setup / verify / reset API と `/auth/reset-pin` — `/^\d{4,6}$/`
 *   - `/admin/settings/account` の変更フォーム — 4〜8 桁を受理
 *   - 表示文言 — 「4桁」「4〜6桁」「4〜8桁」が同一画面に混在
 *
 * この不一致は文言だけの問題ではなく、**保護者が見守り画面から締め出される**経路だった:
 * 設定 > アカウント で 5〜8 桁に変更すると、`/switch` の入力欄は 4 桁で確定してしまい
 * 二度と正しいコードを送れない (復旧には パスワード / 確認コードによる再設定が必要)。
 * 受理側を広げるのではなく、**実際に打てる桁数 (4) を唯一の正**として狭める
 * (家庭内の軽い仕切りという脅威モデル / Apple Screen Time も 4 桁、ADR-0010)。
 *
 * 表示文字列は `OYAKAGI_TERMS.digitRange` が本定数から導出する。
 * 回帰は `tests/unit/domain/oyakagi-pin-length-ssot.test.ts` が gate する。
 */
export const PIN_LENGTH = 4;

/** おやカギコードの形式 (数字ちょうど {@link PIN_LENGTH} 桁)。全ての検証点がこれを使う。 */
export const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);
