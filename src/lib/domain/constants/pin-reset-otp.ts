// src/lib/domain/constants/pin-reset-otp.ts
// おやカギコード再設定 (#3070) でメールに送る確認コードの形式。
//
// #4661: おやカギコード本体の桁数 (constants/oyakagi.ts の PIN_LENGTH) とは**別概念**。
// 桁数の直書きが両者で混ざると、片方を変えたときにもう片方の入力欄 / 検証がずれる。
// server 側 (`$lib/server/services/pin-reset-otp`) と client 側 (`/auth/reset-pin`) の
// 双方から引けるよう domain 層に置く。

/** 確認コードの桁数 */
export const PIN_RESET_OTP_LENGTH = 6;

/** 確認コードの形式 (数字ちょうど {@link PIN_RESET_OTP_LENGTH} 桁) */
export const PIN_RESET_OTP_PATTERN = new RegExp(`^\\d{${PIN_RESET_OTP_LENGTH}}$`);
