/**
 * Dialog State Machine (FSM) for child home page.
 *
 * Ensures only one dialog is shown at a time. Pending dialogs are queued
 * and dequeued in priority order. Prevents the infinite-loop bug (#671)
 * caused by $effect chains re-triggering dialog opens.
 *
 * Pure TypeScript — no Svelte-specific code.
 */

/** All dialog types that the FSM manages. */
export type DialogType =
	| 'idle'
	| 'confirm'
	| 'result'
	| 'levelUp'
	| 'specialReward'
	| 'stampPress'
	| 'birthday'
	| 'adventure'
	| 'parentMessage'
	| 'monthlyReward'
	| 'siblingCheer'
	| 'celebration';

/** Priority order for auto-triggered dialogs (lower index = higher priority). */
const PRIORITY_ORDER: DialogType[] = [
	'adventure',
	'stampPress',
	'specialReward',
	'parentMessage',
	'birthday',
	'monthlyReward',
	'siblingCheer',
	'celebration',
];

/** Immutable snapshot of the FSM state. */
export interface DialogState {
	/** Currently displayed dialog, or 'idle' if none. */
	current: DialogType;
	/** Pending dialogs waiting to be shown. */
	queue: DialogType[];
	/** Data payloads keyed by dialog type. */
	data: Map<DialogType, unknown>;
	/** Dialogs already processed this page load (prevents re-triggering).
	 *  Key format: `${type}:${id}` for payload with id, or `${type}` for others. */
	processed: Set<string>;
}

/**
 * Triggers derived from page data.
 * Each key corresponds to a DialogType and its boolean indicates whether
 * the dialog should be shown. The value (if truthy) is the data payload.
 */
export interface DialogTriggers {
	adventure?: unknown;
	stampPress?: unknown;
	specialReward?: unknown;
	parentMessage?: unknown;
	birthday?: unknown;
	monthlyReward?: unknown;
	siblingCheer?: unknown;
	celebration?: unknown;
}

export class DialogFSM {
	current: DialogType = 'idle';
	queue: DialogType[] = [];
	data: Map<DialogType, unknown> = new Map();
	processed: Set<string> = new Set();

	/** Build a processed-set key from type + payload id (if available). */
	private processedKey(type: DialogType, payload?: unknown): string {
		if (payload && typeof payload === 'object' && 'id' in payload) {
			return `${type}:${(payload as { id: unknown }).id}`;
		}
		return type;
	}

	/** Attempt to show a dialog. If idle, show immediately. Otherwise enqueue. */
	transition(type: DialogType, payload?: unknown): boolean {
		if (type === 'idle') return false;

		if (payload !== undefined) {
			this.data.set(type, payload);
		}

		if (this.current === 'idle') {
			this.current = type;
			return true;
		}

		// Already showing this type or already in queue
		if (this.current === type || this.queue.includes(type)) {
			return false;
		}

		this.queue.push(type);
		return true;
	}

	/** Close the current dialog and show the next queued one (or go idle). */
	close(): DialogType {
		const closed = this.current;

		if (this.queue.length > 0) {
			const next = this.queue.shift();
			this.current = next ?? 'idle';
		} else {
			this.current = 'idle';
		}

		return closed;
	}

	/** Returns false if a dialog is already active (not idle). */
	canTransition(type: DialogType): boolean {
		if (type === 'idle') return false;
		return this.current === 'idle' && !this.queue.includes(type);
	}

	/**
	 * Process page data triggers and enqueue dialogs in priority order.
	 * Uses the `processed` set to prevent re-triggering dialogs that
	 * have already been shown this page load.
	 */
	onDataLoad(triggers: DialogTriggers): void {
		// Collect triggered dialogs in priority order
		const toEnqueue: DialogType[] = [];

		for (const type of PRIORITY_ORDER) {
			const triggerValue = triggers[type as keyof DialogTriggers];
			if (!triggerValue) continue;
			const key = this.processedKey(type, triggerValue);
			if (this.processed.has(key)) continue;
			if (this.current === type || this.queue.includes(type)) continue;

			this.data.set(type, triggerValue);
			this.processed.add(key);
			toEnqueue.push(type);
		}

		// If idle and we have triggers, show the first immediately
		if (this.current === 'idle' && toEnqueue.length > 0) {
			const first = toEnqueue.shift();
			this.current = first ?? 'idle';
		}

		// Enqueue the rest
		for (const type of toEnqueue) {
			if (!this.queue.includes(type)) {
				this.queue.push(type);
			}
		}
	}

	/** Get the data payload for a dialog type. */
	getData<T>(type: DialogType): T | undefined {
		return this.data.get(type) as T | undefined;
	}

	/** Clear data for a specific dialog type. */
	clearData(type: DialogType): void {
		this.data.delete(type);
	}

	/** Reset the FSM to initial state. */
	reset(): void {
		this.current = 'idle';
		this.queue = [];
		this.data.clear();
		this.processed.clear();
	}

	/** Get a snapshot of the current state (for debugging/testing). */
	getState(): DialogState {
		return {
			current: this.current,
			queue: [...this.queue],
			data: new Map(this.data),
			processed: new Set(this.processed),
		};
	}
}
