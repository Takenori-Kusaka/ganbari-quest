// tests/unit/features/dialog-state-machine.test.ts
// Dialog State Machine unit tests — #671 combo bonus infinite loop fix

import { beforeEach, describe, expect, it } from 'vitest';
import {
	DialogFSM,
	type DialogTriggers,
	type DialogType,
} from '../../../src/lib/features/child-home/dialog-state-machine';

describe('DialogFSM', () => {
	let fsm: DialogFSM;

	beforeEach(() => {
		fsm = new DialogFSM();
	});

	describe('initial state', () => {
		it('starts in idle state with empty queue', () => {
			expect(fsm.current).toBe('idle');
			expect(fsm.queue).toEqual([]);
			expect(fsm.data.size).toBe(0);
			expect(fsm.processed.size).toBe(0);
		});
	});

	describe('transition', () => {
		it('transitions from idle to a dialog type', () => {
			const result = fsm.transition('confirm');
			expect(result).toBe(true);
			expect(fsm.current).toBe('confirm');
		});

		it('stores payload data when provided', () => {
			const payload = { activityId: 1, name: 'test' };
			fsm.transition('confirm', payload);
			expect(fsm.getData('confirm')).toEqual(payload);
		});

		it('enqueues when another dialog is active', () => {
			fsm.transition('confirm');
			const result = fsm.transition('result');
			expect(result).toBe(true);
			expect(fsm.current).toBe('confirm');
			expect(fsm.queue).toEqual(['result']);
		});

		it('does not enqueue the same type twice', () => {
			fsm.transition('confirm');
			fsm.transition('result');
			const result = fsm.transition('result');
			expect(result).toBe(false);
			expect(fsm.queue).toEqual(['result']);
		});

		it('does not enqueue the currently active type', () => {
			fsm.transition('confirm');
			const result = fsm.transition('confirm');
			expect(result).toBe(false);
			expect(fsm.queue).toEqual([]);
		});

		it('rejects transition to idle', () => {
			const result = fsm.transition('idle');
			expect(result).toBe(false);
			expect(fsm.current).toBe('idle');
		});

		it('transitions to each dialog type from idle', () => {
			const types: DialogType[] = [
				'confirm',
				'result',
				'levelUp',
				'specialReward',
				'stampPress',
				'birthday',
				'adventure',
				'parentMessage',
				'monthlyReward',
				'siblingCheer',
				'celebration',
			];
			for (const type of types) {
				const f = new DialogFSM();
				expect(f.transition(type)).toBe(true);
				expect(f.current).toBe(type);
			}
		});
	});

	describe('close', () => {
		it('returns to idle when queue is empty', () => {
			fsm.transition('confirm');
			const closed = fsm.close();
			expect(closed).toBe('confirm');
			expect(fsm.current).toBe('idle');
		});

		it('dequeues next dialog when queue is not empty', () => {
			fsm.transition('confirm');
			fsm.transition('result');
			fsm.transition('levelUp');

			const closed1 = fsm.close();
			expect(closed1).toBe('confirm');
			expect(fsm.current).toBe('result');

			const closed2 = fsm.close();
			expect(closed2).toBe('result');
			expect(fsm.current).toBe('levelUp');
		});

		it('drains the queue completely to idle', () => {
			fsm.transition('stampPress');
			fsm.transition('specialReward');
			fsm.transition('parentMessage');

			fsm.close(); // stampPress -> specialReward
			fsm.close(); // specialReward -> parentMessage
			const closed3 = fsm.close(); // parentMessage -> idle
			expect(closed3).toBe('parentMessage');
			expect(fsm.current).toBe('idle');
			expect(fsm.queue).toEqual([]);
		});

		it('returns idle when closing from idle state', () => {
			const closed = fsm.close();
			expect(closed).toBe('idle');
			expect(fsm.current).toBe('idle');
		});
	});

	describe('canTransition', () => {
		it('returns true when idle and type is not in queue', () => {
			expect(fsm.canTransition('confirm')).toBe(true);
		});

		it('returns false when a dialog is active', () => {
			fsm.transition('confirm');
			expect(fsm.canTransition('result')).toBe(false);
		});

		it('returns false for idle type', () => {
			expect(fsm.canTransition('idle')).toBe(false);
		});

		it('returns false when type is already in queue', () => {
			fsm.transition('confirm');
			fsm.transition('result');
			// Close confirm, result becomes current, queue is empty
			fsm.close();
			// Now result is active
			expect(fsm.canTransition('levelUp')).toBe(false);
		});
	});

	describe('onDataLoad', () => {
		it('enqueues dialogs in priority order', () => {
			const triggers: DialogTriggers = {
				parentMessage: { id: 1, body: 'hi' },
				adventure: true,
				specialReward: { id: 2, title: 'reward' },
			};

			fsm.onDataLoad(triggers);

			// adventure has highest priority, so it becomes current
			expect(fsm.current).toBe('adventure');
			// specialReward is next, then parentMessage
			expect(fsm.queue).toEqual(['specialReward', 'parentMessage']);
		});

		it('does not re-enqueue processed dialogs with same id', () => {
			const triggers: DialogTriggers = {
				adventure: true,
				stampPress: { emoji: '⭐' },
			};

			fsm.onDataLoad(triggers);
			expect(fsm.current).toBe('adventure');
			expect(fsm.queue).toEqual(['stampPress']);

			// Close both
			fsm.close(); // adventure -> stampPress
			fsm.close(); // stampPress -> idle

			// Reload data with same triggers — should not re-enqueue
			fsm.onDataLoad(triggers);
			expect(fsm.current).toBe('idle');
			expect(fsm.queue).toEqual([]);
		});

		it('re-enqueues same type with different id (processed key: type:id)', () => {
			// First reward with id=1
			fsm.onDataLoad({
				specialReward: { id: 1, title: 'Reward A' },
			});
			expect(fsm.current).toBe('specialReward');

			fsm.close(); // idle
			expect(fsm.current).toBe('idle');

			// New reward with id=2 should trigger even though type was processed
			fsm.onDataLoad({
				specialReward: { id: 2, title: 'Reward B' },
			});
			expect(fsm.current).toBe('specialReward');
			expect(fsm.getData('specialReward')).toEqual({ id: 2, title: 'Reward B' });
		});

		it('uses type as key when payload has no id', () => {
			fsm.onDataLoad({
				adventure: { childName: 'test' },
			});
			expect(fsm.current).toBe('adventure');

			fsm.close();

			// Same type without id — should NOT re-trigger
			fsm.onDataLoad({
				adventure: { childName: 'test2' },
			});
			expect(fsm.current).toBe('idle');
		});

		it('does nothing when no triggers match', () => {
			fsm.onDataLoad({});
			expect(fsm.current).toBe('idle');
			expect(fsm.queue).toEqual([]);
		});

		it('skips falsy trigger values', () => {
			const triggers: DialogTriggers = {
				adventure: undefined,
				stampPress: null as unknown as undefined,
				specialReward: false as unknown as undefined,
				parentMessage: { id: 1 },
			};

			fsm.onDataLoad(triggers);
			expect(fsm.current).toBe('parentMessage');
			expect(fsm.queue).toEqual([]);
		});

		it('stores data payloads for each triggered dialog', () => {
			const adventureData = { childName: 'test' };
			const rewardData = { id: 1, title: 'Special' };

			fsm.onDataLoad({
				adventure: adventureData,
				specialReward: rewardData,
			});

			expect(fsm.getData('adventure')).toEqual(adventureData);
			expect(fsm.getData('specialReward')).toEqual(rewardData);
		});

		it('does not duplicate dialogs already in queue', () => {
			fsm.transition('confirm'); // occupy current
			fsm.transition('adventure'); // enqueue adventure

			fsm.onDataLoad({
				adventure: true,
				stampPress: { emoji: '⭐' },
			});

			// adventure already in queue, should not be duplicated
			expect(fsm.queue).toEqual(['adventure', 'stampPress']);
		});

		it('does not enqueue dialog that is already current', () => {
			fsm.transition('adventure');

			fsm.onDataLoad({
				adventure: true,
				stampPress: { emoji: '⭐' },
			});

			expect(fsm.current).toBe('adventure');
			// stampPress should be enqueued but adventure should not
			expect(fsm.queue).toEqual(['stampPress']);
		});

		it('respects full priority order: adventure > stampPress > specialReward > parentMessage > birthday > monthlyReward > siblingCheer > celebration', () => {
			fsm.onDataLoad({
				celebration: true,
				siblingCheer: true,
				monthlyReward: true,
				birthday: true,
				parentMessage: true,
				specialReward: true,
				stampPress: true,
				adventure: true,
			});

			expect(fsm.current).toBe('adventure');
			expect(fsm.queue).toEqual([
				'stampPress',
				'specialReward',
				'parentMessage',
				'birthday',
				'monthlyReward',
				'siblingCheer',
				'celebration',
			]);
		});
	});

	describe('getData / clearData', () => {
		it('returns undefined for unknown type', () => {
			expect(fsm.getData('confirm')).toBeUndefined();
		});

		it('clears data for a specific type', () => {
			fsm.transition('confirm', { id: 1 });
			expect(fsm.getData('confirm')).toEqual({ id: 1 });
			fsm.clearData('confirm');
			expect(fsm.getData('confirm')).toBeUndefined();
		});
	});

	describe('reset', () => {
		it('resets everything to initial state', () => {
			fsm.transition('confirm', { id: 1 });
			fsm.transition('result', { total: 100 });
			fsm.onDataLoad({ adventure: true });

			fsm.reset();

			expect(fsm.current).toBe('idle');
			expect(fsm.queue).toEqual([]);
			expect(fsm.data.size).toBe(0);
			expect(fsm.processed.size).toBe(0);
		});
	});

	describe('getState', () => {
		it('returns a snapshot of the current state', () => {
			fsm.transition('confirm', { id: 1 });
			fsm.transition('result');

			const state = fsm.getState();

			expect(state.current).toBe('confirm');
			expect(state.queue).toEqual(['result']);
			expect(state.data.get('confirm')).toEqual({ id: 1 });
			expect(state.processed.size).toBe(0);
		});

		it('snapshot is independent of the FSM (mutations do not propagate)', () => {
			fsm.transition('confirm');
			const state = fsm.getState();

			fsm.close();
			// Original state snapshot should be unchanged
			expect(state.current).toBe('confirm');
			expect(fsm.current).toBe('idle');
		});
	});

	describe('#671 regression: combo bonus infinite loop', () => {
		it('closing result dialog triggers levelUp then idle without re-entering result', () => {
			// Simulate: user taps activity -> confirm -> result -> levelUp
			fsm.transition('confirm');
			fsm.close(); // confirm done, go idle

			fsm.transition('result');
			fsm.transition('levelUp'); // enqueued

			fsm.close(); // result -> levelUp
			expect(fsm.current).toBe('levelUp');

			fsm.close(); // levelUp -> idle
			expect(fsm.current).toBe('idle');

			// Verify no re-entry into result
			expect(fsm.queue).toEqual([]);
		});

		it('stampPress -> specialReward -> parentMessage chain works via queue', () => {
			// Simulate page load with all three triggers
			fsm.onDataLoad({
				stampPress: { emoji: '⭐' },
				specialReward: { id: 1, title: 'reward' },
				parentMessage: { id: 2, body: 'message' },
			});

			expect(fsm.current).toBe('stampPress');
			expect(fsm.queue).toEqual(['specialReward', 'parentMessage']);

			fsm.close();
			expect(fsm.current).toBe('specialReward');

			fsm.close();
			expect(fsm.current).toBe('parentMessage');

			fsm.close();
			expect(fsm.current).toBe('idle');
		});

		it('onDataLoad after invalidateAll does not re-trigger processed dialogs', () => {
			// First load
			fsm.onDataLoad({
				stampPress: { emoji: '⭐' },
				specialReward: { id: 1 },
			});

			// Close both
			fsm.close(); // stampPress -> specialReward
			fsm.close(); // specialReward -> idle

			// Simulate invalidateAll → page data reloads with same triggers (same id)
			fsm.onDataLoad({
				stampPress: { emoji: '⭐' },
				specialReward: { id: 1 },
			});

			// Nothing should happen — both are in processed set (specialReward:1, stampPress)
			expect(fsm.current).toBe('idle');
			expect(fsm.queue).toEqual([]);
		});

		it('onDataLoad after invalidateAll re-triggers with new id', () => {
			// First load with reward id=1
			fsm.onDataLoad({
				specialReward: { id: 1 },
			});
			fsm.close(); // idle

			// invalidateAll returns a NEW reward id=2
			fsm.onDataLoad({
				specialReward: { id: 2 },
			});

			// Should re-trigger because id changed
			expect(fsm.current).toBe('specialReward');
			expect(fsm.getData('specialReward')).toEqual({ id: 2 });
		});
	});
});
