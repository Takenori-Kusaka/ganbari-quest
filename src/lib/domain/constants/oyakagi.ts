// src/lib/domain/constants/oyakagi.ts
// おやカギコード（親向けご家族の見守り画面ロック）関連の定数
// 用語ラベルは labels.ts の OYAKAGI_LABELS を参照。ここはロジック定数のみ。

/** pin_hash 未設定テナントに対する照合用デフォルト値（がんばり語呂合わせ）。
 * コード公開情報扱い。家庭内軽仕切りの脅威モデルと整合（ADR-0010）。
 * legacy local 経路 (`/login` の `login()` / `changePin()`) のみが参照する (#1360 互換)。
 * **顧客可視 UI には出さない** (#2353 / #4698: 既定値の案内は子供が見て即入力できる脆弱性であり、
 * #2992 以降は初回に親ゲートで新規作成するため「初期値は 5086」自体が誤案内になる)。 */
export const DEFAULT_PIN = '5086';

/**
 * おやカギコードの桁数 (#4661 / #4662 / #4698)。**入口も出口もこの 1 つの値で揃える。**
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
 * (家庭内の軽い仕切りという脅威モデル / Apple Screen Time も 4 桁、ADR-0010。
 * PO 判断 #4698: ゲートの「4 桁目で自動送信」UX を崩さない。可変長が必要になったら ADR)。
 *
 * 表示文字列は `OYAKAGI_TERMS.digitRange` が本定数から導出する。
 * 回帰は `tests/unit/domain/oyakagi-pin-length-ssot.test.ts` (呼び出し点の桁数直書き) と
 * `tests/unit/architecture/pin-length-ssot-fitness.test.ts` (src 全走査 + 既定値案内の残存) が gate する。
 */
export const PIN_LENGTH = 4;

/** おやカギコードの形式 (数字ちょうど {@link PIN_LENGTH} 桁)。全ての検証点がこれを使う。 */
export const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

/**
 * おやカギコードが {@link PIN_LENGTH} 桁の数字か (#4698)。
 * API の JSON body のように **string とは限らない値**を受ける入口があるため、型ガードを兼ねる
 * (`typeof` チェックを各 route で書き分けると、片方だけ緩い入口が生まれる)。
 */
export function isValidPinFormat(pin: unknown): pin is string {
	return typeof pin === 'string' && PIN_PATTERN.test(pin);
}
