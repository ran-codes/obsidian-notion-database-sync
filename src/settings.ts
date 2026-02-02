import { App, PluginSettingTab, Setting } from "obsidian";
import NotionFreezePlugin from "./main";

export class NotionFreezeSettingTab extends PluginSettingTab {
	plugin: NotionFreezePlugin;

	constructor(app: App, plugin: NotionFreezePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Notion API key")
			.setDesc(
				"Create an integration at notion.so/profile/integrations and paste the key here."
			)
			.addText((text) =>
				text
					.setPlaceholder("ntn_...")
					.setValue(this.plugin.settings.apiKey)
					.then((t) => {
						t.inputEl.type = "password";
						t.inputEl.addClass("notion-sync-input-wide");
					})
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default output folder")
			.setDesc("Where synced Notion content will be saved by default.")
			.addText((text) =>
				text
					.setPlaceholder("Notion")
					.setValue(this.plugin.settings.defaultOutputFolder)
					.onChange(async (value) => {
						this.plugin.settings.defaultOutputFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}
}
