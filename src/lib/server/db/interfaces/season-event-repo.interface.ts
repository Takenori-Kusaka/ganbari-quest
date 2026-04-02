import type {
	ChildEventProgress,
	InsertSeasonEventInput,
	SeasonEvent,
	UpdateSeasonEventInput,
} from '../types';

export interface ISeasonEventRepo {
	findAllEvents(tenantId: string): Promise<SeasonEvent[]>;
	findActiveEvents(today: string, tenantId: string): Promise<SeasonEvent[]>;
	findEventById(id: number, tenantId: string): Promise<SeasonEvent | undefined>;
	findEventByCode(code: string, tenantId: string): Promise<SeasonEvent | undefined>;
	insertEvent(input: InsertSeasonEventInput, tenantId: string): Promise<SeasonEvent>;
	updateEvent(id: number, input: UpdateSeasonEventInput, tenantId: string): Promise<void>;
	deleteEvent(id: number, tenantId: string): Promise<void>;

	findChildProgress(
		childId: number,
		eventId: number,
		tenantId: string,
	): Promise<ChildEventProgress | undefined>;
	findChildActiveEvents(
		childId: number,
		today: string,
		tenantId: string,
	): Promise<ChildEventProgress[]>;
	upsertChildProgress(
		childId: number,
		eventId: number,
		status: string,
		progressJson: string | null,
		tenantId: string,
	): Promise<void>;
	claimReward(childId: number, eventId: number, tenantId: string): Promise<void>;
}
