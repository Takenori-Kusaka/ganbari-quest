import type {
	ChecklistLog,
	ChecklistOverride,
	ChecklistTemplate,
	ChecklistTemplateItem,
	InsertChecklistOverrideInput,
	InsertChecklistTemplateInput,
	InsertChecklistTemplateItemInput,
	UpdateChecklistTemplateInput,
	UpsertChecklistLogInput,
} from '../types';

export interface IChecklistRepo {
	// Templates
	findTemplatesByChild(childId: number, includeInactive?: boolean): Promise<ChecklistTemplate[]>;
	findTemplateById(id: number): Promise<ChecklistTemplate | undefined>;
	insertTemplate(input: InsertChecklistTemplateInput): Promise<ChecklistTemplate>;
	updateTemplate(
		id: number,
		input: UpdateChecklistTemplateInput,
	): Promise<ChecklistTemplate | undefined>;
	deleteTemplate(id: number): Promise<void>;

	// Template items
	findTemplateItems(templateId: number): Promise<ChecklistTemplateItem[]>;
	insertTemplateItem(input: InsertChecklistTemplateItemInput): Promise<ChecklistTemplateItem>;
	deleteTemplateItem(id: number): Promise<void>;

	// Logs
	findTodayLog(
		childId: number,
		templateId: number,
		date: string,
	): Promise<ChecklistLog | undefined>;
	upsertLog(input: UpsertChecklistLogInput): Promise<ChecklistLog>;

	// Overrides
	findOverrides(childId: number, date: string): Promise<ChecklistOverride[]>;
	insertOverride(input: InsertChecklistOverrideInput): Promise<ChecklistOverride>;
	deleteOverride(id: number): Promise<void>;
}
