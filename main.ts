import { 
    App, 
    Editor, 
    MarkdownView, 
    Plugin, 
    Notice,
    TFile,
    HeadingCache
} from 'obsidian';

// --- Settings ---
interface TextSorterSettings {
    showFloatingBar: boolean;
    barLeft: number;
    barTop: number;
    targetFilePath: string | null;
}

const DEFAULT_SETTINGS: TextSorterSettings = {
    showFloatingBar: true,
    barLeft: 20,
    barTop: 80,
    targetFilePath: null
};

// --- Main Plugin ---
export default class TextSorterPlugin extends Plugin {
    settings: TextSorterSettings;
    floatingBar: SortingFloatingBar;
    
    activeTargetHeading: string | null = null; 

    async onload() {
        await this.loadSettings();

        // 1. Initialize UI
        this.floatingBar = new SortingFloatingBar(this);

        // 2. Command: Toggle Bar
        this.addCommand({
            id: 'toggle-sorter-bar',
            name: 'Show/Hide sorting bar',
            callback: () => {
                const newState = !this.settings.showFloatingBar;
                this.floatingBar.toggle(newState);
                new Notice(newState ? "Sorting bar shown" : "Sorting bar hidden");
            }
        });

        // 3. Events
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            this.floatingBar.refreshHeadings();
        }));
        
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile === file || this.settings.targetFilePath === file.path) {
                this.floatingBar.refreshHeadings();
            }
        }));

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (this.settings.targetFilePath === oldPath) {
                this.settings.targetFilePath = file.path;
                this.saveSettings();
                this.floatingBar.refreshHeadings();
            }
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (this.settings.targetFilePath === file.path) {
                this.settings.targetFilePath = null;
                this.saveSettings();
                this.floatingBar.refreshHeadings();
            }
        }));

        this.app.workspace.onLayoutReady(() => {
            if (this.settings.showFloatingBar) {
                this.floatingBar.toggle(true, false);
            }
        });
    }

    async onunload() {
        this.floatingBar.clearUI();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // --- Core Logic ---
    getHeadings(file: TFile | null): HeadingCache[] {
        if (!file || file.extension !== 'md') return [];
        const cache = this.app.metadataCache.getFileCache(file);
        return cache?.headings || [];
    }

    // Used by Clipboard Button
    async sendClipboardToHeading(targetHeadingName: string) {
        const text = await navigator.clipboard.readText();
        if (!text || text.trim() === "") {
            new Notice("Clipboard is empty.");
            return;
        }
        
        // Clipboard is always just an "Insert", no deletion needed
        await this.transferTextOnly(targetHeadingName, text);
    }

    // Used by Move (Arrow) Button
    async moveParagraphToHeadingName(editor: Editor, view: MarkdownView, targetHeadingName: string) {
        const cursor = editor.getCursor();
        const sourceLineNum = cursor.line;
        const textToMove = editor.getLine(sourceLineNum);

        if (!textToMove || !textToMove.trim()) {
            new Notice("Current line is empty.");
            return;
        }

        // 1. Determine Target File
        let targetFile: TFile | null = null;
        if (this.settings.targetFilePath) {
            const abstractFile = this.app.vault.getAbstractFileByPath(this.settings.targetFilePath);
            if (abstractFile instanceof TFile) targetFile = abstractFile;
        }
        if (!targetFile) targetFile = this.app.workspace.getActiveFile();

        // 2. Logic Split: Same File vs Different File
        const activeFile = this.app.workspace.getActiveFile();
        const isSameFile = activeFile === targetFile;

        if (isSameFile) {
            // FIX: Handle index shifting internally
            this.moveTextWithinCurrentEditor(editor, sourceLineNum, targetHeadingName, textToMove);
        } else {
            // Cross-file move
            if (targetFile) {
                const success = await this.insertIntoBackgroundFile(targetFile, targetHeadingName, textToMove);
                if (success) {
                    // Safe to delete local line as remote file didn't shift local indices
                    editor.replaceRange(
                        "", 
                        { line: sourceLineNum, ch: 0 }, 
                        { line: sourceLineNum + 1, ch: 0 }
                    );
                    this.fixCursorAfterDelete(editor, sourceLineNum);
                }
            } else {
                new Notice("Target file not found.");
            }
        }
    }

    // --- Helper: Move text inside the SAME active editor ---
    moveTextWithinCurrentEditor(editor: Editor, sourceLine: number, headingName: string, text: string) {
        const file = this.app.workspace.getActiveFile();
        const headings = this.getHeadings(file);
        const targetHeading = headings.find(h => h.heading === headingName);

        if (!targetHeading) {
            new Notice(`Heading "${headingName}" not found.`);
            return;
        }

        const targetIndex = headings.indexOf(targetHeading);
        let insertLineIndex = -1;

        if (targetIndex === headings.length - 1) {
            insertLineIndex = editor.lineCount();
        } else {
            const nextHeading = headings[targetIndex + 1];
            insertLineIndex = nextHeading.position.start.line;
        }

        // FIX FOR ANDROID/DESKTOP: Adjust delete index based on insert position
        if (insertLineIndex <= sourceLine) {
            // MOVING UP: Insert first, which pushes source down by 1
            editor.replaceRange(text + "\n", { line: insertLineIndex, ch: 0 });
            
            const adjustedSourceLine = sourceLine + 1;
            editor.replaceRange(
                "", 
                { line: adjustedSourceLine, ch: 0 }, 
                { line: adjustedSourceLine + 1, ch: 0 }
            );
            
            // Move cursor to the new location
            editor.setCursor(insertLineIndex, 0); 
        } 
        else {
            // MOVING DOWN: Insert after, source index remains valid
            editor.replaceRange(text + "\n", { line: insertLineIndex, ch: 0 });

            editor.replaceRange(
                "", 
                { line: sourceLine, ch: 0 }, 
                { line: sourceLine + 1, ch: 0 }
            );
            
            this.fixCursorAfterDelete(editor, sourceLine);
        }

        new Notice(`Moved to "${headingName}"`);
    }

    // --- Helper: Insert text (Clipboard or Cross-file) ---
    async transferTextOnly(targetHeadingName: string, content: string): Promise<boolean> {
        let targetFile: TFile | null = null;
        
        if (this.settings.targetFilePath) {
            const abstractFile = this.app.vault.getAbstractFileByPath(this.settings.targetFilePath);
            if (abstractFile instanceof TFile) targetFile = abstractFile;
        }

        if (!targetFile) {
            targetFile = this.app.workspace.getActiveFile();
        }

        if (!targetFile) {
            new Notice("No target file identified.");
            return false;
        }
        
        if(targetFile.extension !== 'md') {
            new Notice("Target must be a Markdown file.");
            return false;
        }

        const activeFile = this.app.workspace.getActiveFile();
        const isSameFile = activeFile === targetFile;
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

        if (isSameFile && activeView) {
            return this.pasteIntoEditor(activeView.editor, targetHeadingName, content);
        }

        return this.insertIntoBackgroundFile(targetFile, targetHeadingName, content);
    }

    // Simple paste, no deletions calculated
    pasteIntoEditor(editor: Editor, headingName: string, text: string): boolean {
        const file = this.app.workspace.getActiveFile();
        const headings = this.getHeadings(file);
        const targetHeading = headings.find(h => h.heading === headingName);

        if (!targetHeading) {
            new Notice(`Heading "${headingName}" not found.`);
            return false;
        }

        const targetIndex = headings.indexOf(targetHeading);
        let insertLineIndex = -1;

        if (targetIndex === headings.length - 1) {
            insertLineIndex = editor.lineCount(); 
        } else {
            const nextHeading = headings[targetIndex + 1];
            insertLineIndex = nextHeading.position.start.line;
        }

        const insertPos = { line: insertLineIndex, ch: 0 };
        
        if (insertLineIndex >= editor.lineCount()) {
            editor.replaceRange("\n" + text, { line: editor.lineCount(), ch: 0 });
        } else {
            editor.replaceRange(text + "\n", insertPos);
        }
        
        new Notice(`Pasted to "${headingName}"`);
        return true;
    }

    async insertIntoBackgroundFile(file: TFile, headingName: string, text: string): Promise<boolean> {
        const fileContent = await this.app.vault.read(file);
        const headings = this.getHeadings(file); 
        
        const targetHeading = headings.find(h => h.heading === headingName);
        if (!targetHeading) {
            new Notice(`Heading "${headingName}" not found in target.`);
            return false;
        }

        const lines = fileContent.split('\n');
        const targetIndex = headings.indexOf(targetHeading);
        
        let insertLine = lines.length;

        if (targetIndex < headings.length - 1) {
            const nextHeading = headings[targetIndex + 1];
            insertLine = nextHeading.position.start.line;
        }

        lines.splice(insertLine, 0, text);

        await this.app.vault.modify(file, lines.join('\n'));
        new Notice(`Sent to "${file.basename}"`);
        return true;
    }

    fixCursorAfterDelete(editor: Editor, deletedLine: number) {
        const maxLines = editor.lineCount();
        if (deletedLine >= maxLines) {
             editor.setCursor(maxLines - 1, 0);
        } else {
            editor.setCursor(deletedLine, 0);
        }
    }
}

/**
 * UI Class: The Floating Bar
 */
class SortingFloatingBar {
    private plugin: TextSorterPlugin;
    private app: App;
    public container: HTMLElement | null = null;
    private dropdown: HTMLSelectElement | null = null;
    private targetNameDisplay: HTMLElement | null = null;

    constructor(plugin: TextSorterPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    public clearUI() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        this.dropdown = null;
    }

    public async toggle(show: boolean, save: boolean = true) {
        this.clearUI();
        if (show) {
            this.createUI();
            setTimeout(() => this.refreshHeadings(), 50);
        }
        if (save) {
            this.plugin.settings.showFloatingBar = show;
            await this.plugin.saveSettings();
        }
    }

    public refreshHeadings() {
        if (!this.dropdown || !this.targetNameDisplay) return;

        let targetFile: TFile | null = null;
        let isLocked = false;

        if (this.plugin.settings.targetFilePath) {
            const f = this.app.vault.getAbstractFileByPath(this.plugin.settings.targetFilePath);
            if (f instanceof TFile) {
                targetFile = f;
                isLocked = true;
            }
        }

        if (!targetFile) {
            targetFile = this.app.workspace.getActiveFile();
        }

        if (targetFile) {
            this.targetNameDisplay.setText(isLocked ? `🔒 ${targetFile.basename}` : `📄 ${targetFile.basename}`);
            this.targetNameDisplay.style.color = isLocked ? 'var(--text-accent)' : 'var(--text-muted)';
        } else {
            this.targetNameDisplay.setText("No File");
        }

        this.dropdown.empty();

        if (!targetFile || targetFile.extension !== 'md') {
            this.dropdown.createEl('option', { text: '(Need .md file)', value: '' });
            this.plugin.activeTargetHeading = null;
            return;
        }

        const headings = this.plugin.getHeadings(targetFile);
        
        if (headings.length === 0) {
            this.dropdown.createEl('option', { text: 'No Headings', value: '' });
            this.plugin.activeTargetHeading = null;
            return;
        }

        headings.forEach(h => {
            const indent = "\u00A0".repeat((h.level - 1) * 2);
            this.dropdown!.createEl('option', { 
                text: `${indent}# ${h.heading}`, 
                value: h.heading 
            });
        });

        const currentSelection = this.plugin.activeTargetHeading;
        if (currentSelection && headings.some(h => h.heading === currentSelection)) {
            this.dropdown.value = currentSelection;
        } else {
            this.dropdown.selectedIndex = 0;
            this.plugin.activeTargetHeading = this.dropdown.value;
        }
    }

    private createUI() {
        this.container = document.body.createDiv({ cls: 'sorter-floating-bar' });

        this.container.style.cssText = `
            position: fixed; 
            z-index: 15; 
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border); 
            border-radius: 6px;
            padding: 4px 8px; 
            box-shadow: var(--shadow-s); 
            display: flex; 
            gap: 6px; 
            align-items: center;
            width: auto;
            max-width: 90vw;
            cursor: move; 
            font-size: 0.8em;
            user-select: none;
        `;

        this.applyInitialPosition(this.container);
        this.setupContainerStylesAndDrag(this.container);

        // 1. Lock Button
        const lockBtn = this.container.createEl('button', {
            text: '🎯',
            attr: { 
                style: 'padding: 2px 6px; background: transparent; border: 1px solid var(--background-modifier-border); flex-shrink: 0;' 
            }
        });
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const activeFile = this.app.workspace.getActiveFile();
            if (this.plugin.settings.targetFilePath) {
                this.plugin.settings.targetFilePath = null;
                new Notice("Target unlocked");
            } else if (activeFile && activeFile.extension === 'md') {
                this.plugin.settings.targetFilePath = activeFile.path;
                new Notice(`Locked: ${activeFile.basename}`);
            } else {
                new Notice("Select a Markdown file to lock.");
            }
            this.plugin.saveSettings();
            this.refreshHeadings();
        });

        // 2. Label
        this.targetNameDisplay = this.container.createSpan({ 
            text: '...', 
            attr: { style: 'font-weight: bold; max-width: 80px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: inline-block;' } 
        });

        // 3. Dropdown
        this.dropdown = this.container.createEl('select', {
            cls: 'sorter-dropdown',
            attr: { style: 'flex: 1; min-width: 60px; max-width: 150px;' }
        });
        this.dropdown.addEventListener('change', () => {
            if (this.dropdown) this.plugin.activeTargetHeading = this.dropdown.value;
        });
        this.dropdown.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        this.dropdown.addEventListener('mousedown', (e) => e.stopPropagation());

        // 4. Send Button (The Move Logic)
        const sendBtn = this.container.createEl('button', { 
            text: '➤', 
            attr: { 
                style: 'padding: 2px 8px; background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 3px; flex-shrink: 0;' 
            } 
        });
        sendBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && this.plugin.activeTargetHeading) {
                this.plugin.moveParagraphToHeadingName(view.editor, view, this.plugin.activeTargetHeading);
            } else {
                new Notice(view ? "No heading selected." : "Open Markdown file.");
            }
        });

        // 5. Clipboard Button
        const clipBtn = this.container.createEl('button', {
            text: '📋',
            attr: {
                style: 'padding: 2px 8px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 3px; flex-shrink: 0;'
            }
        });
        clipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.plugin.activeTargetHeading) {
                this.plugin.sendClipboardToHeading(this.plugin.activeTargetHeading);
            } else {
                new Notice("No target heading.");
            }
        });

        // 6. Close Button
        const closeBtn = this.container.createEl('button', {
            text: '×',
            attr: { 
                style: 'background: transparent; border: none; color: var(--text-muted); font-size: 1.2em; line-height: 1; padding: 0 4px; margin-left: 2px; flex-shrink: 0;' 
            }
        });
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(false);
        });
    }

    private applyInitialPosition(container: HTMLElement) {
        let left = this.plugin.settings.barLeft;
        let top = this.plugin.settings.barTop;
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (left > viewportWidth - 50) left = viewportWidth - 320;
        if (top > viewportHeight - 50) top = viewportHeight - 100;
        if (left < 0) left = 10;
        if (top < 0) top = 10;

        container.style.left = `${left}px`;
        container.style.top = `${top}px`;
    }

    private setupContainerStylesAndDrag(container: HTMLElement) {
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        const getEventCoords = (e: MouseEvent | TouchEvent) => {
            if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
            if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            return null;
        };

        const onDragStart = (e: MouseEvent | TouchEvent) => {
            if ((e.target as HTMLElement).closest('select, button')) return;
            if (e instanceof MouseEvent && e.button !== 0) return;

            const coords = getEventCoords(e);
            if (!coords) return;

            isDragging = true;
            const rect = container.getBoundingClientRect();
            dragOffset = { x: coords.x - rect.left, y: coords.y - rect.top };
            container.style.cursor = 'grabbing';
            e.preventDefault(); 

            if (e instanceof MouseEvent) {
                document.addEventListener('mousemove', onDragMove);
                document.addEventListener('mouseup', onDragEnd);
            } else {
                document.addEventListener('touchmove', onDragMove, { passive: false });
                document.addEventListener('touchend', onDragEnd);
            }
        };

        const onDragMove = (e: MouseEvent | TouchEvent) => {
            if (!isDragging) return;
            e.preventDefault(); 

            const coords = getEventCoords(e);
            if (!coords) return;

            const x = coords.x - dragOffset.x;
            const y = coords.y - dragOffset.y;

            container.style.left = `${x}px`;
            container.style.top = `${y}px`;
        };

        const onDragEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            container.style.cursor = 'move';

            const rect = container.getBoundingClientRect();
            this.plugin.settings.barLeft = rect.left;
            this.plugin.settings.barTop = rect.top;
            this.plugin.saveSettings();

            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchmove', onDragMove);
            document.removeEventListener('touchend', onDragEnd);
        };

        container.addEventListener('mousedown', onDragStart);
        container.addEventListener('touchstart', onDragStart, { passive: false });
    }
}