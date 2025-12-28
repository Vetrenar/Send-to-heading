# Text Sorter Plugin for Obsidian

Text Sorter is a productivity tool for Obsidian designed to help you quickly organize information. It provides a floating UI bar that allows you to "send" text snippets, current lines, or clipboard content directly to specific headings within your notes.

## Key Features

- **Floating Sorting Bar**: A movable UI overlay that stays accessible while you browse your vault.
- **Smart Context Detection**:
    - **Markdown**: Moves the current line or the selected text.
    - **PDF**: Extracts selected text and automatically includes the page number.
    - **Web Viewer**: Extracts selections from web views  and includes the source URL.
- **Target Locking**: Click the 🎯 icon to "lock" a specific note as the destination. This allows you to browse multiple sources while funneling all highlights into a single research note.
- **Custom Templates**: Define exactly how your snippets appear using placeholders:
    - `{{text}}`: The content being moved.
    - `{{file}}`: The source filename.
    - `{{page}}`: The PDF page number.
    - `{{url}}`: The source web address.
- **Clipboard Support**: Send your current system clipboard directly to a selected heading without pasting it manually.

## How to Use

1. **Toggle the Bar**: Use the command palette (`Show/Hide sorting bar`) or set a hotkey.
2. **Select a Target**: 
    - The dropdown shows all headings in your current note (or locked note).
    - Use the 🎯 button to lock the current file as the permanent destination.
3. **Send Text**:
    - Click **➤ / ✨**: Sends the current line or selection to the chosen heading.
    - Click **📋**: Sends your clipboard content to the chosen heading.
4. **Customization**: Go to Plugin Settings to toggle custom formatting and edit your Markdown, PDF, and Web templates.

## UI Breakdown

- **🎯**: Lock/Unlock the target file.
- **Dropdown**: Select the destination heading within the target file.
- **➤ / ✨**: Smart Transfer (Selection or Line).
- **📋**: Transfer from Clipboard.
- **×**: Hide the bar.

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` (if applicable) to your vault's `.obsidian/plugins/obsidian-text-sorter/` folder.

2. Enable the plugin in Obsidian settings.
