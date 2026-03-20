# gemini-cli-connect

Connect [Gemini CLI](https://github.com/google-gemini/gemini-cli) to Telegram. Run Gemini as a background daemon and interact with it from your phone — send messages, photos, documents, voice notes, and get full agentic responses with tool execution.

Built on top of [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core), the same engine that powers the Gemini CLI.

## Quick Start

```bash
npx gemini-cli-connect
```

That's it. On first run, a setup wizard will guide you through:

1. Creating a Telegram bot (via [@BotFather](https://t.me/BotFather))
2. Setting your allowed Telegram user IDs
3. Choosing a default model (optional)
4. Authenticating with Google (OAuth or API key)

The daemon starts in the background automatically.

## Requirements

- Node.js >= 20
- A Telegram account
- A Google account (for OAuth) or a [Gemini API key](https://aistudio.google.com/apikey)

No need to install Gemini CLI separately — `@google/gemini-cli-core` is included as a dependency.

## CLI Commands

```
gemini-cli-connect                  Start daemon in background (default)
gemini-cli-connect --foreground     Start daemon in foreground
gemini-cli-connect stop             Stop the background daemon
gemini-cli-connect status           Check if daemon is running
gemini-cli-connect logs             Show recent daemon logs
gemini-cli-connect setup            Run the full setup wizard
gemini-cli-connect setup token      Change bot token only
gemini-cli-connect setup users      Change allowed users only
gemini-cli-connect setup model      Change default model only
gemini-cli-connect setup auth       Set up Gemini authentication
gemini-cli-connect help             Show this help message
```

## Telegram Commands

Once the bot is running, interact with it in Telegram:

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh session |
| `/cancel` | Cancel the current operation |
| `/resume` | List or resume a previous session |
| `/model <name>` | Switch model |
| `/addfolder <path>` | Add a folder for read+write access |
| `/compact` | Compress chat history |
| `/stats` | Show session statistics |
| `/id` | Show current session ID |
| `/help` | Show help message |

Send any text message to chat with Gemini. You can also send photos, voice notes, audio, video, and documents — they're forwarded to Gemini as multimodal input.

## How It Works

`gemini-cli-connect` runs Gemini CLI's core engine as a long-lived daemon process. Each Telegram chat gets its own session with full conversation history, tool execution, and context management — the same capabilities as the interactive CLI.

Tools run in **YOLO mode** (auto-execute, no confirmation prompts) since user interaction happens through Telegram, not the terminal.

The daemon has:
- Read access to your home directory (`~/`)
- Write access to the working directory where it was started
- Expandable access via `/addfolder` for additional directories

## Configuration

Config is stored at `~/.gemini-cli-connect/config.json`:

```json
{
  "telegramBotToken": "...",
  "allowedUsers": [123456789],
  "model": "gemini-2.5-pro"
}
```

- `telegramBotToken` — required
- `allowedUsers` — required, array of Telegram user IDs
- `model` — optional, overrides the default model. Falls back to your Gemini CLI settings (`~/.gemini/settings.json`)

Run `gemini-cli-connect setup` to reconfigure.

## Authentication

Authentication is handled the same way as Gemini CLI. The setup wizard will detect if you're already authenticated and skip this step. If not, you'll be asked to choose:

- **OAuth** (recommended) — opens your browser to sign in with Google. Tokens are stored at `~/.gemini/oauth_creds.json`.
- **API Key** — paste your key during setup and it gets saved securely in your system keychain (same storage Gemini CLI uses). Alternatively, set the `GEMINI_API_KEY` environment variable.

If you've already authenticated with Gemini CLI, no extra setup is needed — gemini-cli-connect uses the same credentials.

## Gemini CLI Settings

Since this project uses `@google/gemini-cli-core`, your existing Gemini CLI configuration works out of the box:

- **Model settings** — `~/.gemini/settings.json`
- **MCP servers** — configured in Gemini CLI settings
- **Extensions** — loaded from Gemini CLI config
- **Context files** — `GEMINI.md` and `AGENTS.md` are picked up automatically

## Acknowledgments

This project would not be possible without [Gemini CLI](https://github.com/google-gemini/gemini-cli) by Google. Thank you for making it open source under the Apache 2.0 license — it enabled building this Telegram integration on top of the same powerful core engine.

## License

[Apache 2.0](LICENSE)
