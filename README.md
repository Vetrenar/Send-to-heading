# Send to Heading

This plugin adds a floating control bar to Obsidian that lets you quickly move text or clipboard content to specific headings in your notes.

## Features

- **Move Text**: Move the line at your current cursor position to a selected heading.
- **Clipboard Support**: Send the contents of your clipboard directly to a specific heading.
- **Target Locking**: Lock a specific note as the destination so you can send snippets to it while browsing other files.
- **Floating Interface**: A draggable bar that stays on top of your editor for quick access.
- **Heading Selection**: A dropdown menu that lists all headings in the file, with indentation to show heading levels.

## How to Use

### The Floating Bar
The bar contains the following controls:
- **Target Lock**: Sets the current file as the permanent destination. When locked, a lock symbol and the filename appear.
- **Heading Dropdown**: Choose which heading you want to send text to.
- **Move Button (Arrow)**: Moves the line where your cursor is currently located to the end of the selected heading.
- **Clipboard Button**: Pastes your current clipboard content to the end of the selected heading.
- **Close Button**: Hides the bar.

### Sending Text to a Heading
1. Place your cursor on the line of text you want to move.
2. Select a heading from the dropdown menu in the floating bar.
3. Click the Move button. The text will disappear from its current location and appear under the chosen heading.

### Sending Clipboard Content
1. Copy any text to your system clipboard.
2. Select a destination heading from the dropdown menu.
3. Click the Clipboard button. The text will be appended under that heading.

### Using a Dedicated "Inbox" File
1. Open the file you want to use as your destination (e.g., a "To Do" list or "Notes" file).
2. Click the Target Lock button.
3. You can now navigate to any other file in your vault. When you click the Move or Clipboard buttons, the text will be sent to the locked file instead of the one you are currently viewing.

## Commands

- **Show/Hide sorting bar**: Use the Command Palette to toggle the visibility of the floating bar.

## Installation

1. Create a folder named `obsidian-send-to-heading` in your vault's `.obsidian/plugins/` directory.
2. Place the `main.js` and `manifest.json` files inside that folder.
3. Go to Obsidian Settings > Community Plugins and enable the plugin.