import { 
    App, Editor, MarkdownView, Plugin, Notice, TFile, 
    HeadingCache, PluginSettingTab, Setting, TAbstractFile 
} from 'obsidian';

interface TextSorterSettings {
    showFloatingBar: boolean;
    barLeft: number;
    barTop: number;
    targetFilePath: string | null;
    useCustomFormatting: boolean;
    mdTemplate: string;
    pdfTemplate: string;
    webTemplate: string;
}

const DEFAULT_SETTINGS: TextSorterSettings = {
    showFloatingBar: true,
    barLeft: 20,
    barTop: 80,
    targetFilePath: null,
    useCustomFormatting: true,
    mdTemplate: "{{text}} (Source: [[{{file}}]])",
    pdfTemplate: "{{text}} (Source: [[{{file}}#page={{page}}]])",
    webTemplate: "{{text}} (Source: [Web]({{url}}))"
};

export default class TextSorterPlugin extends Plugin {
    settings: TextSorterSettings;
    floatingBar: SortingFloatingBar;
    activeTargetHeading: string | null = null; 

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new TextSorterSettingTab(this.app, this));

        this.floatingBar = new SortingFloatingBar(this);

        // 1) ADD COMMANDS FOR HOTKEYS
        this.addCommand({
            id: 'toggle-sorter-bar',
            name: 'Show/Hide sorting bar',
            callback: () => this.floatingBar.toggle(!this.settings.showFloatingBar)
        });

        this.addCommand({
            id: 'send-smart',
            name: 'Send selection/line to target heading',
            callback: () => this.handleTransfer('smart')
        });

        this.addCommand({
            id: 'send-clipboard',
            name: 'Send clipboard to target heading',
            callback: () => this.handleTransfer('clipboard')
        });

        // Watch for file renames to keep target locked
        this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            if (oldPath === this.settings.targetFilePath) {
                this.settings.targetFilePath = file.path;
                this.saveSettings();
                this.floatingBar.refreshHeadings();
            }
        }));

        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.floatingBar.refreshHeadings()));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (file.path === this.settings.targetFilePath || file === this.app.workspace.getActiveFile()) {
                this.floatingBar.refreshHeadings();
            }
        }));

        this.app.workspace.onLayoutReady(() => {
            if (this.settings.showFloatingBar) this.floatingBar.toggle(true, false);
        });
    }

    async onunload() {
        this.floatingBar.clearUI();
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    // 2) ACTUAL FORMATTING LOGIC USING {{text}}
    async formatOutput(rawText: string, activeView: any): Promise<string> {
        if (!this.settings.useCustomFormatting || !activeView) return rawText;

        const viewType = activeView.getViewType();

        if (["web-viewer", "webviewer", "webview", "surfer-view"].includes(viewType)) {
            const url = activeView.getState()?.url || activeView.url;
            return this.settings.webTemplate
                .replace("{{text}}", rawText)
                .replace("{{url}}", url || "");
        }

        if (viewType === "pdf") {
            const file = activeView.file;
            const internalViewer = activeView.viewer?.child?.pdfViewer?.pdfViewer;
            const page = internalViewer?._location?.pageNumber || internalViewer?.currentPageNumber || activeView.getState()?.page || 1;

            if (file instanceof TFile) {
                return this.settings.pdfTemplate
                    .replace("{{text}}", rawText)
                    .replace("{{file}}", file.path)
                    .replace("{{page}}", page.toString());
            }
        }

        if (viewType === "markdown") {
            const file = activeView.file;
            if (file instanceof TFile) {
                return this.settings.mdTemplate
                    .replace("{{text}}", rawText)
                    .replace("{{file}}", file.path);
            }
        }
        
        return rawText;
    }

    async handleTransfer(type: 'clipboard' | 'smart') {
        const activeLeaf = this.app.workspace.getMostRecentLeaf();
        const activeView = activeLeaf?.view as any;
        
        if (!this.activeTargetHeading) {
            new Notice("No target heading selected.");
            return;
        }

        let extractedText = "";

        if (type === 'clipboard') {
            extractedText = await navigator.clipboard.readText();
        } else if (type === 'smart') {
            const viewType = activeView?.getViewType();
            
            if (viewType === "pdf") {
                extractedText = activeView.viewer?.child?.pdfViewer?.pdfViewer?.textSelectionManager?.getSelectedText() || "";
                if (!extractedText) extractedText = window.getSelection()?.toString() || "";
            } 
            else if (["web-viewer", "webviewer", "webview", "surfer-view"].includes(viewType)) {
                const webviewEl = activeView.contentEl.querySelector('webview');
                if (webviewEl && webviewEl.executeJavaScript) {
                    try {
                        extractedText = await webviewEl.executeJavaScript('window.getSelection().toString()');
                    } catch (e) { console.error("Webview JS failed", e); }
                }
                if (!extractedText || !extractedText.trim()) {
                    extractedText = await navigator.clipboard.readText();
                }
            }
            else if (viewType === "markdown") {
                const isReadingMode = activeView.getMode() === "preview";
                const editor = activeView.editor as Editor;
                
                if (isReadingMode) {
                    extractedText = window.getSelection()?.toString() || "";
                } else {
                    const selection = editor.getSelection();
                    if (selection && selection.trim().length > 0) {
                        // MODE: Move Selection
                        const formatted = await this.formatOutput(selection, activeView);
                        const success = await this.processTransfer(this.activeTargetHeading, formatted);
                        if (success) editor.replaceSelection("");
                        return;
                    } else {
                        // MODE: Move Line
                        const lineNum = editor.getCursor().line;
                        const lineText = editor.getLine(lineNum);
                        if (lineText.trim()) {
                            const formatted = await this.formatOutput(lineText, activeView);
                            const success = await this.processTransfer(this.activeTargetHeading, formatted);
                            if (success) {
                                editor.replaceRange("", { line: lineNum, ch: 0 }, { line: lineNum + 1, ch: 0 });
                            }
                        }
                        return;
                    }
                }
            }
        }

        if (!extractedText || !extractedText.trim()) {
            new Notice("Selection is empty.");
            return;
        }

        const finalFormatted = await this.formatOutput(extractedText, activeView);
        await this.processTransfer(this.activeTargetHeading, finalFormatted);
    }

    async processTransfer(headingName: string, text: string): Promise<boolean> {
        let targetFile: TFile | null = null;
        if (this.settings.targetFilePath) {
            const f = this.app.vault.getAbstractFileByPath(this.settings.targetFilePath);
            if (f instanceof TFile) targetFile = f;
        }
        if (!targetFile) targetFile = this.app.workspace.getActiveFile();

        if (!targetFile || targetFile.extension !== 'md') {
            new Notice("Target must be a Markdown file.");
            return false;
        }

        let openEditor: Editor | null = null;
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file.path === targetFile?.path) {
                openEditor = leaf.view.editor;
            }
        });

        if (openEditor) {
            return this.insertViaEditor(openEditor, targetFile, headingName, text);
        }

        return this.insertViaVaultProcess(targetFile, headingName, text);
    }

    insertViaEditor(editor: Editor, file: TFile, headingName: string, text: string): boolean {
        const cache = this.app.metadataCache.getFileCache(file);
        const headings = cache?.headings || [];
        const targetIdx = headings.findIndex(h => h.heading === headingName);
        
        if (targetIdx === -1) { new Notice(`Heading "${headingName}" not found.`); return false; }

        const isLastHeading = targetIdx === headings.length - 1;
        const insertLine = isLastHeading ? editor.lineCount() : headings[targetIdx + 1].position.start.line;

        const content = `\n${text}\n`;
        editor.replaceRange(content, { line: insertLine, ch: 0 });
        
        new Notice(`Added to "${headingName}"`);
        return true;
    }

    async insertViaVaultProcess(file: TFile, headingName: string, text: string): Promise<boolean> {
        try {
            await this.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                const cache = this.app.metadataCache.getFileCache(file);
                const headings = cache?.headings || [];
                const targetIdx = headings.findIndex(h => h.heading === headingName);
                
                if (targetIdx === -1) throw new Error("Heading not found");

                const isLastHeading = targetIdx === headings.length - 1;
                const insertLine = isLastHeading ? lines.length : headings[targetIdx + 1].position.start.line;
                
                lines.splice(insertLine, 0, text);
                return lines.join('\n');
            });
            new Notice(`Sent to "${file.basename}"`);
            return true;
        } catch (e) {
            new Notice(e.message);
            return false;
        }
    }

    getHeadings(file: TFile | null): HeadingCache[] {
        if (!file) return [];
        return this.app.metadataCache.getFileCache(file)?.headings || [];
    }
}

class SortingFloatingBar {
    private plugin: TextSorterPlugin;
    public container: HTMLElement | null = null;
    private dropdown: HTMLSelectElement | null = null;
    private label: HTMLSpanElement | null = null;
    private moveBtn: HTMLButtonElement | null = null;

    constructor(plugin: TextSorterPlugin) { this.plugin = plugin; }

    public clearUI() { this.container?.remove(); this.container = null; }

    public async toggle(show: boolean, save = true) {
        this.clearUI();
        if (show) {
            this.createUI();
            this.refreshHeadings();
        }
        if (save) {
            this.plugin.settings.showFloatingBar = show;
            await this.plugin.saveSettings();
        }
    }

    private createUI() {
        this.container = this.plugin.app.workspace.containerEl.createDiv({ cls: 'sorter-bar' });
        Object.assign(this.container.style, {
            position: 'absolute', zIndex: 'var(--layer-cover)',
            left: `${this.plugin.settings.barLeft}px`, top: `${this.plugin.settings.barTop}px`,
            background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)',
            borderRadius: '8px', padding: '5px 10px', boxShadow: 'var(--shadow-l)', 
            display: 'flex', gap: '8px', alignItems: 'center'
        });

        const createBtn = (text: string, cb: () => void, cls = "") => {
            const btn = this.container!.createEl('button', { text, cls });
            btn.addEventListener('mousedown', (e) => { e.preventDefault(); cb(); });
            btn.addEventListener('click', (e) => e.preventDefault());
            return btn;
        };

        createBtn('🎯', async () => {
            const active = this.plugin.app.workspace.getActiveFile();
            this.plugin.settings.targetFilePath = this.plugin.settings.targetFilePath ? null : active?.path || null;
            await this.plugin.saveSettings();
            this.refreshHeadings();
            new Notice(this.plugin.settings.targetFilePath ? "Locked Target File" : "Targeting Active File");
        });

        this.label = this.container.createSpan({ attr: { style: 'font-size:0.8em; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' } });
        this.dropdown = this.container.createEl('select');
        this.dropdown.onchange = () => this.plugin.activeTargetHeading = this.dropdown!.value;

        this.moveBtn = createBtn('➤', () => this.plugin.handleTransfer('smart'), 'mod-cta') as HTMLButtonElement;
        createBtn('📋', () => this.plugin.handleTransfer('clipboard'));
        createBtn('×', () => this.toggle(false));

        this.setupDrag(this.container);
    }

    public refreshHeadings() {
        if (!this.dropdown || !this.label || !this.container || !this.moveBtn) return;

        const activeLeaf = this.plugin.app.workspace.getMostRecentLeaf();
        const viewType = activeLeaf?.view.getViewType();
        const isValidView = ["markdown", "pdf", "web-viewer", "webviewer", "surfer-view"].includes(viewType);

        if (!isValidView) { this.container.style.display = 'none'; return; } 
        else { this.container.style.display = 'flex'; }

        const isMarkdown = viewType === "markdown";
        const isReadingMode = isMarkdown && (activeLeaf.view as MarkdownView).getMode() === "preview";
        const hasSelection = isMarkdown && !isReadingMode && (activeLeaf.view as MarkdownView).editor.getSelection().length > 0;
        const isNonEditable = ["pdf", "web-viewer", "webviewer", "surfer-view"].includes(viewType) || isReadingMode || hasSelection;

        this.moveBtn.setText(isNonEditable ? "✨" : "➤");
        this.moveBtn.title = isNonEditable ? "Send Selection" : "Move Current Line";

        const targetPath = this.plugin.settings.targetFilePath;
        const file = targetPath ? this.plugin.app.vault.getAbstractFileByPath(targetPath) : this.plugin.app.workspace.getActiveFile();
        
        if (file instanceof TFile && file.extension === 'md') {
            this.label.setText((targetPath ? "🔒 " : "📄 ") + file.basename);
            const currentSelected = this.plugin.activeTargetHeading;
            const headings = this.plugin.getHeadings(file);
            this.dropdown.empty();
            headings.forEach(h => {
                const opt = this.dropdown!.createEl('option', { text: h.heading, value: h.heading });
                if (h.heading === currentSelected) opt.selected = true;
            });
            this.plugin.activeTargetHeading = this.dropdown.value;
        } else {
            this.label.setText("No MD Target");
            this.dropdown.empty();
            this.plugin.activeTargetHeading = null;
        }
    }

    private setupDrag(el: HTMLElement) {
        let isDown = false, offset = [0, 0];
        const onMouseDown = (e: MouseEvent) => {
            if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
            isDown = true;
            offset = [el.offsetLeft - e.clientX, el.offsetTop - e.clientY];
        };
        const onMouseMove = (e: MouseEvent) => {
            if (!isDown) return;
            el.style.left = (e.clientX + offset[0]) + 'px';
            el.style.top = (e.clientY + offset[1]) + 'px';
        };
        const onMouseUp = async () => {
            if (!isDown) return;
            isDown = false;
            this.plugin.settings.barLeft = el.offsetLeft;
            this.plugin.settings.barTop = el.offsetTop;
            await this.plugin.saveSettings();
        };
        this.plugin.registerDomEvent(el, 'mousedown', onMouseDown);
        this.plugin.registerDomEvent(window, 'mousemove', onMouseMove);
        this.plugin.registerDomEvent(window, 'mouseup', onMouseUp);
    }
}

class TextSorterSettingTab extends PluginSettingTab {
    plugin: TextSorterPlugin;
    constructor(app: App, plugin: TextSorterPlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Formatting & Templates' });

        new Setting(containerEl)
            .setName("Use Custom Appending Formats")
            .setDesc("Apply the templates below to your text. Use {{text}} for the content.")
            .addToggle(t => t.setValue(this.plugin.settings.useCustomFormatting).onChange(async v => { 
                this.plugin.settings.useCustomFormatting = v; 
                await this.plugin.saveSettings(); 
            }));

        new Setting(containerEl)
            .setName("Markdown Template")
            .setDesc("Variables: {{text}}, {{file}}")
            .addTextArea(t => t.setValue(this.plugin.settings.mdTemplate).onChange(async v => { 
                this.plugin.settings.mdTemplate = v; 
                await this.plugin.saveSettings(); 
            }));

        new Setting(containerEl)
            .setName("PDF Template")
            .setDesc("Variables: {{text}}, {{file}}, {{page}}")
            .addTextArea(t => t.setValue(this.plugin.settings.pdfTemplate).onChange(async v => { 
                this.plugin.settings.pdfTemplate = v; 
                await this.plugin.saveSettings(); 
            }));

        new Setting(containerEl)
            .setName("Web Viewer Template")
            .setDesc("Variables: {{text}}, {{url}}")
            .addTextArea(t => t.setValue(this.plugin.settings.webTemplate).onChange(async v => { 
                this.plugin.settings.webTemplate = v; 
                await this.plugin.saveSettings(); 
            }));
    }
}