// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	// #702: E2E hydration marker — +layout.svelte で $effect 内からセットし、
	// Playwright の waitForFunction で Svelte 5 onclick バインド完了を待つ
	interface Window {
		__APP_HYDRATED__?: boolean;
	}

	namespace App {
		// interface Error {}
		interface Locals {
			requestId: string;
			authenticated: boolean;
			identity: import('$lib/server/auth/types').Identity | null;
			context: import('$lib/server/auth/types').AuthContext | null;
			// #1180 / ADR-0039: デモ実行モード判定。hooks.server.ts で `?mode=demo` or
			// cookie `gq_demo=1` から確定。`+layout.server.ts` が `data.isDemo` として
			// client に配布する。
			isDemo: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
