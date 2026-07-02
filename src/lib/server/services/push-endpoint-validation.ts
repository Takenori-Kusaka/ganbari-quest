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
	// Firefox (Mozilla push service)
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
 * IPv4 リテラルが private / loopback / link-local (metadata) / CGN 帯か。
 * IPv4 形式でない文字列 (public hostname 等) は false。
 */
function isPrivateIpv4(host: string): boolean {
	const parts = host.split('.');
	if (parts.length !== 4) return false;
	const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
	if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
	const a = octets[0] ?? -1;
	const b = octets[1] ?? -1;
	if (a === 0) return true; // 0.0.0.0/8 (this network)
	if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
	if (a === 127) return true; // 127.0.0.0/8 (loopback)
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + cloud metadata 169.254.169.254)
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
	if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (shared address space)
	return false;
}

/**
 * hostname が private / loopback / link-local の internal target か (SSRF 確定判定用)。
 * public hostname (未知ベンダー含む) は false を返す。
 */
function isPrivateOrLoopbackHost(hostname: string): boolean {
	let host = hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost')) return true;
	// URL.hostname は IPv6 を bracket 付きで返すため除去
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
	if (host.includes(':')) {
		// IPv6 literal
		if (host === '::1' || host === '::') return true; // loopback / unspecified
		if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 (unique local)
		if (/^fe[89ab]/.test(host)) return true; // fe80::/10 (link-local)
		// IPv4-mapped (::ffff:a.b.c.d)。URL API は dotted を hex 圧縮形 (::ffff:7f00:1) に正規化するため両形を処理
		const mappedDotted = host.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
		if (mappedDotted) return isPrivateIpv4(mappedDotted[1] ?? '');
		const mappedHex = host.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
		if (mappedHex) {
			const hi = Number.parseInt(mappedHex[1] ?? '0', 16);
			const lo = Number.parseInt(mappedHex[2] ?? '0', 16);
			return isPrivateIpv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
		}
		return false;
	}
	return isPrivateIpv4(host);
}

/**
 * endpoint が「確定的に不正 (SSRF target)」か。**cleanup 削除の述語**。
 *
 * `validatePushEndpoint().ok === false` には 2 種類が混在する:
 *   (1) 確定 SSRF — 非 https scheme / private・loopback・link-local(metadata) IP host。
 *       web-push protocol 上 正規になり得ず、残しても永久に skip されるだけなので削除して安全。
 *   (2) allowlist 網羅漏れ — https + 未知だが plausible な公開ベンダー host。
 *       `ALLOWED_PUSH_HOSTS` は静的ハードコードのため、ベンダーが push host を新設/移行すると
 *       正規 subscription がここに落ちる。削除すると正規購読を恒久喪失する (allowlist 追記で
 *       可逆回復できるのに不可逆破壊になる) ため、**削除しない** (送信 skip + warn に留める)。
 *
 * 本関数は (1) のみ true を返す。(2) は false (= skip するが削除しない)。
 */
export function isDefinitelyMaliciousEndpoint(endpoint: unknown): boolean {
	if (typeof endpoint !== 'string' || endpoint.length === 0) return false;
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false; // parse 不能な junk は確定判定しない (保守的に skip のみ)
	}
	// web push は https のみ。http: / file: 等は内部 host を狙う典型的 SSRF vector であり正規たり得ない
	if (url.protocol !== 'https:') return true;
	return isPrivateOrLoopbackHost(url.hostname);
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
