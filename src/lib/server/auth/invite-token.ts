// src/lib/server/auth/invite-token.ts
// #3528: invite token_hash 生成 / timing-safe 照合 util (DSQL 移管 EPIC #3424)
//
// 設計 SSOT: docs/design/dsql-data-model.md §6.6 invites 行
//   「token_hash（招待コードの timing-safe ハッシュ、raw 非保存）必須 =
//     現行 inviteCode capability 機構の写像、bare bearer 化による機密性退行を防ぐ（CWE-522）」
//
// 設計判断 (OSS 先調査 #1350 / Pre-PMF ADR-0010):
//   - node:crypto 標準 (randomBytes / createHash / timingSafeEqual) のみで実装し、新規依存は追加しない。
//     repo 内の既存 crypto 慣行に整合:
//       - randomBytes(32).toString('base64url') = viewer-token-service.ts の capability token 生成と同型
//       - sha256 hex + timing-safe hex 比較 (長さ不一致は throw せず false) = pin-reset-otp.ts の
//         timingSafeEqualHex と同パターン
//       - HMAC (cookie-signature / context-token.ts) は「秘密鍵で署名する cookie / stateless payload」
//         用途。invite token は DB に hash を保存して lookup する capability であり、鍵管理を増やさず
//         sha256(token) で十分 (token 自体が 256bit 高エントロピーのため salt / pepper 不要、
//         パスワードと違い辞書攻撃が成立しない)。
//   - raw token は生成時に呼び出し元へ返すのみ。DB には tokenHash (UNIQUE(token_hash)) だけを保存する。
//
// #3588 ①: token の hash は `invite-code-hash.ts` の hashInviteSecret に委譲する (SSOT 統合)。
//   hashInviteToken と hashInviteCode は同一写像 (sha256 hex) の別呼称であり、二重定義を廃して
//   将来のアルゴリズム変更時の片側更新漏れ (invite lookup 不整合) を構造排除する。

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashInviteSecret } from './invite-code-hash';

/** invite token のエントロピー (bytes)。32 bytes = 256 bit、base64url で 43 chars */
export const INVITE_TOKEN_BYTES = 32;

/**
 * 招待 token を新規生成する。
 *
 * - token: crypto 安全乱数 32 bytes の base64url (URL-safe、招待リンクに埋め込む raw capability)
 * - tokenHash: sha256(token) hex。DB (invites.token_hash) にはこちらのみ保存する (raw 非保存、CWE-522)
 */
export function generateInviteToken(): { token: string; tokenHash: string } {
	const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
	return { token, tokenHash: hashInviteToken(token) };
}

/**
 * 提示された token を照合用にハッシュ化する (DB lookup キー算出)。
 * generateInviteToken と同一写像 (sha256 hex 小文字) であることが contract。
 * #3588 ①: hashInviteSecret (SSOT) に委譲。hashInviteCode と同一写像。
 */
export function hashInviteToken(token: string): string {
	return hashInviteSecret(token);
}

/**
 * 提示 token と保存済み token_hash を timing-safe に照合する。
 *
 * - 提示 token を hash してから比較するため、比較対象は常に固定長 (64 hex chars) になり
 *   token 長による timing 差は生じない
 * - storedHash が長さ不一致 / 不正でも throw せず false (timingSafeEqual の長さ例外を漏らさない、
 *   pin-reset-otp.ts の timingSafeEqualHex と同パターン)
 */
export function verifyInviteTokenHash(presentedToken: string, storedHash: string): boolean {
	const presentedHash = hashInviteToken(presentedToken);
	if (presentedHash.length !== storedHash.length) return false;
	try {
		return timingSafeEqual(Buffer.from(presentedHash, 'utf8'), Buffer.from(storedHash, 'utf8'));
	} catch {
		return false;
	}
}
