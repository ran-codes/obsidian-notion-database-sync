import { Client } from "@notionhq/client";

export interface NotionFreezeSettings {
	apiKey: string;
	defaultOutputFolder: string;
}

export const DEFAULT_SETTINGS: NotionFreezeSettings = {
	apiKey: "",
	defaultOutputFolder: "Notion",
};

export interface FreezeFrontmatter {
	"notion-id": string;
	"notion-url": string;
	"notion-frozen-at": string;
	"notion-last-edited": string;
	"notion-database-id"?: string;
	"notion-deleted"?: boolean;
	[key: string]: unknown;
}

export type DetectionResult =
	| { type: "page"; id: string }
	| { type: "database"; id: string };

export interface FreezeOptions {
	client: Client;
	notionId: string;
	outputFolder: string;
	databaseId?: string;
}

export interface PageFreezeResult {
	status: "created" | "updated" | "skipped";
	filePath: string;
	title: string;
}

export interface DatabaseFreezeResult {
	title: string;
	folderPath: string;
	created: number;
	updated: number;
	skipped: number;
	deleted: number;
	failed: number;
	errors: string[];
}
