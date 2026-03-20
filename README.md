# gemini-cli-connect

Connect [Gemini CLI](https://github.com/google-gemini/gemini-cli) to Telegram. Run Gemini as a background daemon and interact with it from your phone — send messages, photos, documents, voice notes, and get full agentic responses with tool execution.

Built on top of [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core), the same engine that powers the Gemini CLI.

## Quick Start

```bash
npx gemini-cli-connect start
```

Or install globally:

```bash
npm install -g gemini-cli-connect
gemini-cli-connect start
```

On first run, a setup wizard will guide you through:

1. Creating a Telegram bot (via [@BotFather](https://t.me/BotFather))
2. Setting your allowed Telegram user IDs
3. Choosing a default model (optional)
4. Authenticating with Google (OAuth or API key)

The daemon starts in the background automatically after setup.

## Requirements

- Node.js >= 20
- A Telegram account
- A Google account (for OAuth) or a [Gemini API key](https://aistudio.google.com/apikey)

No need to install Gemini CLI separately — `@google/gemini-cli-core` is included as a dependency.

## CLI Usage

```
gemini-cli-connect <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `start` | Start the daemon |
| `stop` | Stop the running daemon |
| `status` | Check if the daemon is running |
| `logs` | Show recent daemon logs |
| `setup [step]` | Run setup wizard (steps: `token`, `users`, `model`, `auth`) |

### Options

| Option | Description |
|--------|-------------|
| `--live`, `-l` | Run in foreground instead of backgrounding (with `start`) |
| `--help`, `-h` | Show help message |
| `--version`, `-v` | Show version number |

## Telegram Commands

Once the bot is running, interact with it in Telegram:

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh session |
| `/cancel` | Cancel the current operation |
| `/resume` | List or resume a previous session |
| `/model <number or name>` | Switch model |
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

Authentication is handled the same way as Gemini CLI. The setup wizard will check if you're already authenticated and skip this step. If not, you'll be asked to choose:

- **OAuth** (recommended) — opens your browser to sign in with Google. Tokens are stored securely by the core library (keychain or encrypted file).
- **API Key** — paste your key during setup and it gets saved securely in your system keychain (same storage Gemini CLI uses). Alternatively, set the `GEMINI_API_KEY` environment variable.

If you've already authenticated with Gemini CLI, no extra setup is needed — gemini-cli-connect uses the same credentials.

## Gemini CLI Settings

Since this project uses `@google/gemini-cli-core`, your existing Gemini CLI configuration works out of the box:

- **Model settings** — `~/.gemini/settings.json`
- **MCP servers** — configured in Gemini CLI settings
- **Extensions** — loaded from Gemini CLI config
- **Context files** — `GEMINI.md` and `AGENTS.md` are picked up automatically

## My Weird Patches on Top of Gemini CLI

Building this wasn't as simple as "just import the core library and go." Here's some of the jank we had to work around:

**Running gemini-cli-core as a daemon** — The core library is designed to power an interactive terminal session, not a background daemon. We essentially run it in a loop — each Telegram message creates a Gemini session, sends the message, streams the response, handles tool calls, and replies. From Google's perspective this looks identical to someone using the regular Gemini CLI, just over and over. Trying to avoid TOS violations 😢, no custom API calls — it's the same `@google/gemini-cli-core` package doing the same thing it always does.

**Suppressing a ton of noisy logs** — The Gemini CLI has a fancy TUI (built with React/Ink) that captures all `console.log`/`console.debug` output and routes it to a debug drawer. We don't have a TUI. So all those internal debug messages (`[DEBUG] MemoryDiscovery`, `Hook registry initialized`, `Experiments loaded { ... }`, etc.) would just dump straight to the user's terminal. We had to mute `console.log`/`console.debug`/`console.warn` globally and use our own custom logger that writes to stderr instead. Works fine, but it's a bit of a hack — if the core library ever logs something actually important via `console.error`, we'd miss it. Could probably be improved with a smarter filter later.

**OAuth consent handler** — The core library's OAuth flow expects either a TUI consent dialog (via an event emitter) or headless mode. We're neither — we're an interactive terminal during setup but a background daemon after. So we register a custom `ConsentRequest` event listener that prompts via readline, close it before the OAuth probe runs (to avoid two readline instances fighting over stdin), and then reopen it after. The readline juggling is ugly but necessary.

**Markdown formatting** — Gemini's responses come as markdown, but Telegram needs HTML. We convert with `markdown-it`, which works great for complete messages. During streaming though, partial markdown (like `**bold` without the closing `**`) produces ugly output with literal asterisks. So we stream as plain text and only apply formatting on the final message — one clean edit at the end.

A lot of these things can be improved, which I would do as I get time, but thing still works (and also good enough for my mom)

## Acknowledgments

This project would not be possible without [Gemini CLI](https://github.com/google-gemini/gemini-cli) by Google. Thank you for making it open source under the Apache 2.0 license — it enabled building this Telegram integration on top of the same powerful core engine.

## License

[Apache 2.0](LICENSE)
