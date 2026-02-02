import { Client } from "@notionhq/client";
import {
	DatabaseObjectResponse,
	DataSourceObjectResponse,
	PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { App, normalizePath, TFile, TFolder } from "obsidian";
import { DatabaseFreezeResult, FreezeOptions } from "./types";
import { notionRequest } from "./notion-client";
import { convertRichText } from "./block-converter";
import { freezePage } from "./page-freezer";

export type ProgressCallback = (current: number, total: number, title: string) => void;

export async function freezeDatabase(
	app: App,
	options: Omit<FreezeOptions, "databaseId">,
	onProgress?: ProgressCallback
): Promise<DatabaseFreezeResult> {
	const { client, notionId, outputFolder } = options;

	// Fetch database metadata
	const database = (await notionRequest(() =>
		client.databases.retrieve({ database_id: notionId })
	)) as DatabaseObjectResponse;

	const dbTitle = convertRichText(database.title) || "Untitled Database";
	const safeName = dbTitle.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled Database";
	const folderPath = normalizePath(`${outputFolder}/${safeName}`);

	// Get the data source ID for querying entries and reading properties
	if (!database.data_sources || database.data_sources.length === 0) {
		throw new Error(
			"This appears to be a linked database, which is not supported by the Notion API."
		);
	}
	const dataSourceId = database.data_sources[0].id;

	// Retrieve the data source to get property schema
	const dataSource = (await notionRequest(() =>
		client.dataSources.retrieve({ data_source_id: dataSourceId })
	)) as DataSourceObjectResponse;

	// Create folder if needed
	await ensureFolderExists(app, folderPath);

	// Generate .base file
	await generateBaseFile(app, dataSource, folderPath, notionId);

	// Query all entries via dataSources.query (paginated)
	const entries = await queryAllEntries(client, dataSourceId);

	// Scan existing local files for this database
	const localFiles = scanLocalFiles(app, folderPath);

	// Track results
	let created = 0;
	let updated = 0;
	let skipped = 0;
	let deleted = 0;
	let failed = 0;
	const errors: string[] = [];

	// Process each entry — continue on failure
	const total = entries.length;
	const processedIds = new Set<string>();
	let current = 0;
	for (const entry of entries) {
		processedIds.add(entry.id);
		current++;

		if (onProgress) onProgress(current, total, dbTitle);

		try {
			const result = await freezePage(app, {
				client,
				notionId: entry.id,
				outputFolder: folderPath,
				databaseId: notionId,
			});

			switch (result.status) {
				case "created":
					created++;
					break;
				case "updated":
					updated++;
					break;
				case "skipped":
					skipped++;
					break;
			}
		} catch (err) {
			failed++;
			const msg = `Entry ${entry.id}: ${err instanceof Error ? err.message : String(err)}`;
			errors.push(msg);
			console.error(`Notion Freeze: Failed to freeze entry ${entry.id}:`, err);
		}
	}

	// Mark deleted entries (in Notion but not returned in query)
	for (const [id, file] of localFiles) {
		if (!processedIds.has(id)) {
			await markAsDeleted(app, file);
			deleted++;
		}
	}

	return { title: dbTitle, folderPath, created, updated, skipped, deleted, failed, errors };
}

async function queryAllEntries(
	client: Client,
	dataSourceId: string
): Promise<PageObjectResponse[]> {
	const entries: PageObjectResponse[] = [];
	let cursor: string | undefined = undefined;

	do {
		const response = await notionRequest(() =>
			client.dataSources.query({
				data_source_id: dataSourceId,
				start_cursor: cursor,
				page_size: 100,
			})
		);
		for (const result of response.results) {
			if (result.object === "page" && "properties" in result) {
				entries.push(result);
			}
		}
		cursor = response.has_more
			? (response.next_cursor ?? undefined)
			: undefined;
	} while (cursor);

	return entries;
}

function scanLocalFiles(
	app: App,
	folderPath: string
): Map<string, TFile> {
	const map = new Map<string, TFile>();
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) return map;

	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== "md") continue;
		const cache = app.metadataCache.getFileCache(child);
		const notionId = cache?.frontmatter?.["notion-id"];
		if (notionId) {
			map.set(notionId, child);
		}
	}

	return map;
}

async function markAsDeleted(app: App, file: TFile): Promise<void> {
	const content = await app.vault.read(file);

	// Check if already marked
	if (content.includes("notion-deleted: true")) return;

	// Insert notion-deleted into frontmatter
	if (content.startsWith("---\n")) {
		const endIdx = content.indexOf("\n---", 3);
		if (endIdx !== -1) {
			const before = content.slice(0, endIdx);
			const after = content.slice(endIdx);
			await app.vault.modify(file, before + "\nnotion-deleted: true" + after);
			return;
		}
	}

	// No frontmatter found, add it
	const fm = "---\nnotion-deleted: true\n---\n";
	await app.vault.modify(file, fm + content);
}

async function generateBaseFile(
	app: App,
	dataSource: DataSourceObjectResponse,
	folderPath: string,
	notionId: string
): Promise<void> {
	const title = convertRichText(dataSource.title) || "Untitled Database";
	const basePath = normalizePath(`${folderPath}/${title}.base`);

	// Build property order from data source schema
	const order: string[] = [];
	for (const [name, config] of Object.entries(dataSource.properties)) {
		if (config.type === "title") continue;
		order.push(name);
	}

	// Obsidian Bases use YAML with expression-based filters
	const yamlLines: string[] = [];
	yamlLines.push("filters:");
	yamlLines.push("  and:");
	yamlLines.push(`    - file.inFolder("${folderPath}")`);
	yamlLines.push(`    - 'note["notion-database-id"] == "${notionId}"'`);
	yamlLines.push("");
	yamlLines.push("views:");
	yamlLines.push("  - type: table");
	yamlLines.push("    name: All entries");
	if (order.length > 0) {
		yamlLines.push("    order:");
		for (const prop of order) {
			yamlLines.push(`      - "${prop}"`);
		}
	}
	yamlLines.push("");

	const baseContent = yamlLines.join("\n");

	const existingFile = app.vault.getAbstractFileByPath(basePath);
	if (existingFile instanceof TFile) {
		await app.vault.modify(existingFile, baseContent);
	} else {
		await app.vault.create(basePath, baseContent);
	}
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	if (app.vault.getAbstractFileByPath(normalized)) return;

	const parts = normalized.split("/");
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}
