# Personal Agent You Can Text

A personal AI agent that you talk to by text message. It searches the web, reads pages, remembers your preferences, and replies on your phone with a short answer and a source link card. You can also chat with it in the terminal.

The agent runs on your own machine. The language model, web search, browser and messaging run through hosted APIs. Your saved preferences are stored locally.

## What it does

- **Answers with current information.** It uses Exa web search and cites the URLs it found.
- **Reads specific pages.** It opens a public web page in a remote Kernel browser when the search highlights are not enough.
- **Remembers you.** It saves, lists and forgets personal preferences (for example "I only eat halal meat") only when you explicitly ask, using Mem0 stored under `.data/`.
- **Replies over messaging.** It receives texts through Linq (iMessage, RCS, SMS), replies in plain texting style, and sends the best source as a link preview card.
- **Optional extras.** Emoji reactions to your messages, an iMessage typing bubble while it works, voice replies, and a WhatsApp text channel.

Only messages from the phone number you configure as the owner are accepted.

## How it works

```
your phone -> Linq -> webhook (HTTPS tunnel) -> your machine
                                                   |
                       model <-> tools: Exa search, Kernel browser, Mem0 memory
                                                   |
your phone <- Linq <- reply + source card <--------+
```

| Folder | Contents |
| --- | --- |
| `src/` | The complete agent, tool loop, adapters and servers |
| `starter/` | The step-by-step version, with each integration in `starter/integrations.ts` |
| `docs/` | Setup guides (Linq, WhatsApp, MCP) |
| `test/` | Tests for the agent, memory, browser and messaging |

## Requirements

- Node.js **26.12.1 or newer** and npm
- A free ngrok account, only for the phone mode (a public HTTPS address for your webhook)
- The API keys below

## API keys and where to get them

Copy `.env.example` to `.env` and fill in the values. Never commit `.env`; it is git-ignored.

| Variable | What it is for | Where to get it |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Model replies, plus memory extraction and embeddings | https://openrouter.ai/settings/keys |
| `MODEL_API_KEY` | Optional. Use another OpenAI-compatible provider instead. It takes priority over `OPENROUTER_API_KEY`. Also set `MODEL_BASE_URL` and `MODEL_NAME` | Your model provider's dashboard |
| `EXA_API_KEY` | Web search | https://dashboard.exa.ai/api-keys |
| `KERNEL_API_KEY` | Remote browser sessions for reading pages | https://dashboard.onkernel.com/api-keys |
| `LINQ_API_KEY` | Sending and receiving texts | Free Linq CLI: https://linqapp.com/cli, or the sandbox dashboard: https://dashboard.linqapp.com/sandbox |
| `LINQ_PHONE_NUMBER` | The Linq line your agent texts from | Printed by `linq whoami` after signing up |
| `OWNER_PHONE_NUMBER` | Your own phone, the only sender the agent answers. Use `+` and the country code. It must differ from the Linq line | Your own number |
| `LINQ_WEBHOOK_SECRET` | Verifies that webhook requests really come from Linq | Returned once when you create the webhook subscription with `linq webhooks create` |
| ngrok authtoken | Not stored in `.env`. Run `ngrok config add-authtoken ...` once | https://dashboard.ngrok.com/get-started/your-authtoken |

Other settings have defaults: `WORKSHOP_MILESTONE`, `MODEL_NAME`, `AGENT_TIMEZONE`, `PORT` (3400) and `DATA_DIR` (`.data`). The optional `WHATSAPP_*` variables are only for the WhatsApp channel; see [docs/WHATSAPP.md](docs/WHATSAPP.md).

`WORKSHOP_MILESTONE` switches features on in steps:

| Value | Adds |
| --- | --- |
| 1 | Model replies |
| 2 | Exa search (needs `EXA_API_KEY`) |
| 3 | Kernel browser (needs `KERNEL_API_KEY`) |
| 4 | Mem0 memory |
| 5 | Phone messaging through Linq |

## Setup

```sh
npm ci
cp .env.example .env
# edit .env and add your keys
npm run doctor
```

`npm run doctor` checks your configuration. It makes no network calls, so a real reply is the actual test.

## Run it

Terminal chat (milestones 1 to 4):

```sh
npm run solution:chat
```

Phone mode (milestone 5). See [docs/LINQ.md](docs/LINQ.md) for the full Linq setup.

1. Start an HTTPS tunnel to port 3400 and leave it running: `ngrok http 3400`
2. Create a webhook subscription pointing at `https://YOUR-TUNNEL/webhooks/linq?version=2026-02-03` for the `message.received` event. Save the `signing_secret` it returns as `LINQ_WEBHOOK_SECRET`.
3. Set `WORKSHOP_MILESTONE=5`, then start the agent:

```sh
npm run doctor
npm run solution:phone
```

4. From your owner phone, text the Linq number. On a free shared Linq line, the contact must text the line first.

Try: `Remember that I'm vegetarian`, `Find a sushi dinner near me under $40`, `What do you remember about me?`

The agent only works while the server and tunnel are running on your machine. Stop both when you are done and disable the webhook subscription.

## Test

```sh
npm run typecheck
npm test
```

## Security notes

- Keep `.env` out of git. It is listed in `.gitignore`, and only `.env.example` is tracked.
- Conversations and memories are stored in `.data/`, which is also git-ignored.
- The webhook verifies Linq's signature, and the agent ignores everyone except `OWNER_PHONE_NUMBER`.
- The browser tool only opens public HTTPS pages with a domain name, never local or IP addresses.
- If a key is ever exposed, delete it in the provider's dashboard and create a new one.

## License

MIT. See [LICENSE](LICENSE).
