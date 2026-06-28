// src/lib/server/services/push-endpoint-validation.ts
//
// #3188 (#3186 follow-up): Web Push subscribe endpoint の SSRF hardening。
//
// 背景: `/api/v1/notifications/subscribe` は受け取った `endpoint` URL を scheme/host 検証なしで
// raw 保存していた。cron の server push (web-push) はこの保存済 URL へ POST するため、攻撃者が
// internal host (169.254.169.254 / localhost / RFC1918) を endpoint に指定すると server-side
// request forgery (CWE-918) の余地があった。p256dh / auth も未検証で raw 保存していた。
//
// 対策 (defense-in-depth):
//   1. https 強制 (push protocol は https のみ)
//   2. 既知 push service host の allowlist (FCM / Mozilla / Apple / WNS)。allowlist 方式は
//      新規ブラウザの push host を拒否するリスクがあるが、SSRF 面では「公開だが内部 proxy な
//      host」も弾ける最も強い静的防御であり、主要ブラウザ (Chrome/Edge=FCM, Firefox=Mozilla,
//      Safari=Apple) を網羅するため Pre-PMF では allowlist を採用する (ADR-0010)。
//   3. p256dh (65 byte ≈ 88 char) / auth (16 byte ≈ 24 char) の base64url 形式 + 長さ上限検証。

/** 既知 Web Push service の host (hostname の exact または dot-suffix で照合)。 */
const ALLOWED_PUSH_HOSTS: readonly string[] = [
	// Chrome / Edge / Brave / Opera (FCM)
	'fcm.googleapis.com',
	'android.googleapis.com',
	// Firefox (autopush)
	'.push.services.mozilla.com',
	// Safari / iOS / macOS (Apple Push)
	'.push.apple.com',
	// 旧 Edge / Windows (WNS)
	'.notify.windows.com',
	'.wns.windows.com',
];

/**
 * hostname が allowlist に含まれるか。先頭ドット付きエントリは「その下のサブドメイン」を許可
 * (`x.push.services.mozilla.com` は `.push.services.mozilla.com` で末尾一致)。ドットなしエントリは
 * exact 一致のみ (`fcm.googleapis.com`)。末尾一致のため `evil.com.push.apple.com` のような
 * 偽装ホストは弾かれる (真に Apple/Mozilla 管理ドメイン配下のみ通る)。
 */
function isAllowedPushHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	for (const entry of ALLOWED_PUSH_HOSTS) {
		if (entry.startsWith('.')) {
			if (host.endsWith(entry)) return true;
		} else if (host === entry) {
			return true;
		}
	}
	return false;
}

/**
 * push endpoint URL を検証する。https + 既知 push service host のみ許可 (SSRF 防御)。
 *
 * @returns ok=true で通過、ok=false で reason に拒否理由 (logger 用、ユーザーには汎用文言を返す)
 */
export function validatePushEndpoint(
	endpoint: unknown,
): { ok: true; url: string } | { ok: false; reason: string } {
	if (typeof endpoint !== 'string' || endpoint.length === 0) {
		return { ok: false, reason: 'endpoint is empty or not a string' };
	}
	if (endpoint.length > 2048) {
		return { ok: false, reason: 'endpoint exceeds 2048 chars' };
	}
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return { ok: false, reason: 'endpoint is not a valid URL' };
	}
	if (url.protocol !== 'https:') {
		return { ok: false, reason: `endpoint scheme must be https (got ${url.protocol})` };
	}
	if (!isAllowedPushHost(url.hostname)) {
		return { ok: false, reason: `endpoint host not in push-service allowlist (${url.hostname})` };
	}
	return { ok: true, url: endpoint };
}

/**
 * Web Push key (p256dh / auth) が base64url 形式かつ妥当な長さか検証する。
 * p256dh は uncompressed EC public key (65 byte ≈ 88 base64 char)、auth は 16 byte (≈ 24 char)。
 * 厳密なバイト長はブラウザ実装で padding 差があるため、charset と上限のみ静的検証する。
 */
export function isValidPushKey(key: unknown, maxLen = 256): boolean {
	if (typeof key !== 'string' || key.length === 0 || key.length > maxLen) return false;
	// base64 / base64url の両方を許容 (+ / - _ と任意の = padding)
	return /^[A-Za-z0-9_+/-]+={0,2}$/.test(key);
}
