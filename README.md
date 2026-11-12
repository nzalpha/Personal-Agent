# Personal Agent You Can Text

A personal AI agent that you talk to by text message. It searches the web, reads pages, remembers your preferences, and replies on your phone with a short answer and a source link card. You can also chat with it in a terminal.

The agent runs on **your own machine**. The language model, web search, browser and messaging run through hosted APIs, and your saved preferences are stored locally in `.data/`.

## What it does

- **Current information.** It uses Exa web search and cites the URLs it found.
- **Reads specific pages.** It opens a public web page in a remote Kernel browser when search highlights are not enough.
- **Remembers you.** It saves, lists and forgets personal preferences (for example "I only eat halal meat") only when you explicitly ask. Memory is handled by Mem0 and stored under `.data/`.
- **Replies over messaging.** It receives texts through Linq (iMessage, RCS, SMS), answers in a plain texting style, and sends the best source as a link preview card.
- **Optional extras.** Emoji reactions to your messages, an iMessage typing bubble while it works, voice replies, and a WhatsApp text channel.

Only messages from the phone number you set as the owner are accepted.

## How it works

```
your phone -> Linq -> webhook (HTTPS tunnel) -> your machine
                                                   |
                    model <-> tools: Exa search, Kernel browser, Mem0 memory
                                                   |
your phone <- Linq <- reply + source card <--------+
```

The agent can only receive texts while the server **and** the tunnel are running on your machine. Terminal chat needs neither Linq nor a tunnel.

| Folder | Contents |
| --- | --- |
| `src/` | The complete agent: tool loop, adapters, servers (`solution:*` commands) |
| `starter/` | The same agent built step by step, with each integration in `starter/integrations.ts` (`starter:*` commands) |
| `docs/` | Detailed guides: [Linq](docs/LINQ.md), [WhatsApp](docs/WHATSAPP.md), [Exa MCP](docs/MCP.md), [architecture](docs/ARCHITECTURE.md) |
| `test/` | Tests for the agent, memory, browser and messaging |

## Forking or cloning this repository

```sh
git clone https://github.com/YOUR-USERNAME/YOUR-FORK.git
cd YOUR-FORK
```

Your `.env` file holds secrets and is git-ignored, so it is **not** in the repository. You create it yourself in step 4 below. Never commit it.

## What you need

| Requirement | Used for | Needed for |
| --- | --- | --- |
| **Node.js 26.12.1 or newer** and npm | Running the agent | Everything |
| An **OpenRouter** account with credits (or another OpenAI-compatible model provider) | The language model | Everything |
| An **Exa** account | Web search | Milestone 2+ |
| A **Kernel** account | Reading web pages | Milestone 3+ |
| The **Linq CLI** and a free Linq account | Phone number and messaging | Milestone 5 (phone) |
| **ngrok** installed and signed in | A public HTTPS address for the webhook | Milestone 5 (phone) |
| A phone that can text | Talking to the agent | Milestone 5 (phone) |

The examples below use macOS and zsh. On Linux or Windows, use the same steps with each tool's own installer.

## Step 1 · Install Node.js

The project needs Node 26.12.1 or newer (see `.nvmrc`). The easiest way is [nvm](https://github.com/nvm-sh/nvm#installing-and-updating): install it, reopen your terminal, then run this inside the project folder:

```sh
nvm install
nvm use
node --version   # should print v26.12.1 or newer
```

## Step 2 · Install dependencies

```sh
npm ci
```

## Step 3 · Get your API keys

Create each key in its provider's dashboard and copy it right away. Several providers show the full key only once.

| Variable in `.env` | What it is for | Where to get it |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Model replies, plus memory extraction and embeddings. Add credits to your account, or you will get an HTTP 402 error. | https://openrouter.ai/settings/keys |
| `MODEL_API_KEY` | Optional. Use another OpenAI-compatible provider instead of OpenRouter. It takes priority over `OPENROUTER_API_KEY`. Also set `MODEL_BASE_URL` and `MODEL_NAME` (see Troubleshooting). | Your model provider's dashboard |
| `EXA_API_KEY` | Web search (milestone 2+) | https://dashboard.exa.ai/api-keys (new accounts start with free credits) |
| `KERNEL_API_KEY` | Reading web pages in a cloud browser (milestone 3+) | https://dashboard.onkernel.com/api-keys |
| `LINQ_API_KEY` | Sending and receiving texts (milestone 5) | Free Linq CLI (see Step 7), or the sandbox dashboard https://dashboard.linqapp.com/sandbox |
| `LINQ_PHONE_NUMBER` | The Linq line your agent texts from | Printed by `linq whoami` after you sign up |
| `OWNER_PHONE_NUMBER` | **Your own phone**, the only sender the agent answers. Use `+` and the country code, for example `+14155551234`. It must be different from the Linq line. | Your own number |
| `LINQ_WEBHOOK_SECRET` | Verifies that webhook requests really come from Linq | Returned once when you create the webhook subscription (Step 8) |

ngrok's authtoken is not stored in `.env`. You register it once with `ngrok config add-authtoken ...` (Step 7).

## Step 4 · Create your `.env` file

```sh
cp .env.example .env
```

Open `.env` in an editor and fill in the values from Step 3. Write each value with **no spaces around `=` and no quotes**:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

Each variable must appear **only once**. If a name appears twice, the later line wins, and an empty later line silently overrides a real key above it.

`WORKSHOP_MILESTONE` turns features on in steps, so you can bring the agent up one piece at a time:

| `WORKSHOP_MILESTONE` | Adds | Keys needed |
| --- | --- | --- |
| `1` | Model replies | `OPENROUTER_API_KEY` |
| `2` | Exa web search | + `EXA_API_KEY` |
| `3` | Kernel browser (reads pages) | + `KERNEL_API_KEY` |
| `4` | Mem0 memory | (no new key with the defaults) |
| `5` | Phone messaging through Linq | + all `LINQ_*` values and `OWNER_PHONE_NUMBER` |

Other settings have defaults: `AGENT_TIMEZONE` (set it to yours, for example `America/Los_Angeles`), `PORT` (`3400`), `DATA_DIR` (`.data`), `REACTION_MODE` (`local`) and `MESSAGING_CHANNEL` (`linq`).

## Step 5 · Check your configuration

```sh
npm run doctor
```

It should print `Configuration valid for milestone N`. The doctor makes **no network calls**, so a passing check does not prove your keys work. The next step does.

## Step 6 · Try it in the terminal (milestones 1 to 4)

```sh
npm run solution:chat
```

Ask `what is temperature` to prove the model works. Then raise `WORKSHOP_MILESTONE` one step at a time and **restart the chat each time**, because `.env` is only read at startup:

| Milestone | Try asking |
| --- | --- |
| 2 | `What's the latest Node.js LTS version?` (should cite sources) |
| 3 | `Read https://example.com and tell me what it says` |
| 4 | `Remember that I'm vegetarian`, then exit, restart, and ask `What do you remember about me?` |

Type `/exit` to quit. Terminal chat needs no Linq account and no tunnel.

## Step 7 · Set up the phone (milestone 5)

You do this part once. It needs three things: a Linq line, an ngrok tunnel, and a webhook subscription.

### 7a. Linq line (free tier)

1. Install the Linq CLI (needs Node 22 or newer):
   ```sh
   npm install -g @linqapp/cli@latest
   ```
2. Create your account. It emails you a 6-digit code:
   ```sh
   linq signup
   ```
3. Show your line and key:
   ```sh
   linq whoami
   ```
   Put the **Linq Number** in `.env` as `LINQ_PHONE_NUMBER`. Get the full token with `linq tokens` and put it in `.env` as `LINQ_API_KEY`.
4. Add your own phone as a contact:
   ```sh
   linq contacts add +14155551234
   ```
5. From that phone, **text your Linq number first** (for example "hi"). The free shared line is inbound-first: a contact must text the line before it can reply. It allows up to 20 contacts and is shared with other users, so do not send anything sensitive through it.

Details and the paid or sandbox options: https://linqapp.com/cli, [docs/LINQ.md](docs/LINQ.md) and https://apidocs.linqapp.com.

### 7b. ngrok (public HTTPS address)

Linq must reach your machine over the internet, and your laptop has no public address. ngrok creates one.

1. Install ngrok. On macOS:
   ```sh
   brew install ngrok
   ```
   For Linux and Windows, use https://ngrok.com/download.
2. Create a free ngrok account, then copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken and register it once:
   ```sh
   ngrok config add-authtoken YOUR_AUTHTOKEN
   ```
   Keep the authtoken private. It is not part of this project's `.env`.
3. Start the tunnel in **its own terminal** and leave it running:
   ```sh
   ngrok http 3400
   ```
   Copy the HTTPS forwarding URL it prints, for example `https://something.ngrok-free.dev`.
4. Your free account includes a dev domain. Using it with `ngrok http 3400 --url https://YOUR-DEV-DOMAIN` keeps the address the same every time, so you do not have to update Linq when you restart. Find it in the ngrok dashboard.

### 7c. Webhook subscription

This tells Linq to send incoming texts to your tunnel. With the tunnel running, in another terminal:

```sh
linq webhooks create --url "https://YOUR-TUNNEL/webhooks/linq?version=2026-02-03" --events message.received --json
```

Keep the quotes. The output contains a `signing_secret`. **Copy it right away, because it is shown only once.** Paste it into `.env` as `LINQ_WEBHOOK_SECRET` (it is different from your API key, and has no quotes). Do not create a second subscription for the same URL. Check with `linq webhooks list`.

## Step 8 · Start the phone agent

Set `WORKSHOP_MILESTONE=5` in `.env`, make sure `OWNER_PHONE_NUMBER` is your own number, then run:

```sh
npm run doctor
npm run solution:phone
```

You need **two terminals** open the whole time: one for `ngrok`, one for the agent. The agent prints `Linq webhook ready on http://127.0.0.1:3400/webhooks/linq`.

Check that it is reachable. Both of these should return `{"ok":true}`:

- `http://127.0.0.1:3400/healthz`
- `https://YOUR-TUNNEL/healthz` (ngrok's free tier may show a warning page first; click through it)

Now text your Linq number from your owner phone. Try:

```text
/help
Remember I live in San Francisco, love sushi, and budget $150 per person.
Find a sushi dinner option for Friday.
What do you remember about me?
```

Search answers arrive as a short summary, then one source link card. Ask for "two options" or "more sources" for up to three cards.

## Optional features

- **Smarter emoji reactions:** set `REACTION_MODE=jev` (uses your OpenRouter key). The default `local` mode picks an emoji by keyword and needs no extra key.
- **Typing bubble:** shown while the agent works. This is iMessage only.
- **Voice replies:** text `/voice Say hello in one sentence` (milestone 5, uses OpenRouter text-to-speech).
- **WhatsApp instead of Linq:** see [docs/WHATSAPP.md](docs/WHATSAPP.md), then set `MESSAGING_CHANNEL=whatsapp`.
- **Step-by-step version:** `npm run starter:chat` and `npm run starter:phone` run the same agent from `starter/integrations.ts`. In this copy, the model, search, browser, memory, messaging, source-card and reaction/typing integrations are filled in. Voice replies in `starter/extras.ts` are left unfinished.

## Troubleshooting

The terminal chat prints only `Request failed. Check your integration and provider access.` for most errors, which hides the real cause. Use this table:

| Symptom | What to check |
| --- | --- |
| `Request failed` after you changed `.env` | Exit and restart. `.env` is read only when the program starts. |
| HTTP 401 from the model | The key does not match the provider. For example, an OpenRouter key (`sk-or-...`) sent to `api.openai.com`. Make sure `MODEL_API_KEY`, `MODEL_BASE_URL` and `MODEL_NAME` all belong to the same provider. |
| Your key seems ignored | Look for a second, empty `MODEL_API_KEY=` line further down `.env`. The last duplicate wins. |
| HTTP 402 | Your OpenRouter balance or the key's spending limit is empty. |
| The agent says it cannot read a page | `WORKSHOP_MILESTONE` is below 3, or `KERNEL_API_KEY` is missing. |
| "I'm having trouble saving that preference" | Memory needs milestone 4 or higher and a working embedding model. If you use a model provider other than OpenRouter, also change `MEM0_EMBEDDING_MODEL` and `MEM0_EMBEDDING_DIMENSIONS` to values that provider supports. For OpenAI, `text-embedding-3-small` at `1536` is a likely choice but untested here. Changing the embedding model or dimensions requires reindexing existing memories. |
| `Missing script: "doctor."` | A stray character after the script name. Type exactly `npm run doctor`. |
| No reply to your text | The ngrok terminal is closed, the agent is not running, or the webhook URL is wrong. Confirm both `/healthz` addresses. |
| Webhook returns 401 | `LINQ_WEBHOOK_SECRET` is not the exact `signing_secret` from the subscription (no quotes, no spaces). |
| Webhook returns 400 | The URL must include `?version=2026-02-03`. |
| Linq will not let you text first | On the free shared line a contact must text the Linq number first. |
| The link arrives as a plain URL, not a card | The preview comes from the target page's metadata, and some pages block it. SMS conversations only show the bare URL. |
| No typing bubble | Typing indicators work on iMessage only. |

## When you are done

- Press **Ctrl+C** in the agent terminal and the ngrok terminal.
- Disable or remove your webhook subscription so nothing keeps pointing at a closed tunnel. List it with `linq webhooks list`, and check `linq webhooks --help` for the delete command.
- If a key is ever exposed, delete it in the provider's dashboard and create a new one. Removing the file from git is not enough.

## Security notes

- `.env` and `.data/` are git-ignored. Only `.env.example` (which has no secrets) is tracked.
- The webhook verifies Linq's signature, and the agent ignores everyone except `OWNER_PHONE_NUMBER`.
- ngrok opens only port 3400 to the internet, and only while the tunnel is running. Close it when you are not using the agent.
- The browser tool only opens public HTTPS pages with a domain name, never local addresses or IP addresses.
- Prefer a spending limit on each model key.

## Test

```sh
npm run typecheck
npm test
```

## License

MIT. See [LICENSE](LICENSE).
