# Integrate the personal agent stack

Build in this order: **model → Exa → Kernel → Mem0 → Linq**. Each stage adds a capability to the same application. Use the terminal through milestone 4, then connect the phone in milestone 5.

Attendees edit the five TODOs in `starter/integrations.ts` and run `npm run starter:chat`, then `npm run starter:phone`. Your instructor solution is independent: `npm run solution:chat` and `npm run solution:phone`. The model/tool loop, queue, validation, and provider adapters are supplied infrastructure; the exercises connect the five provider boundaries.


## Prework

Install **Node.js 26.12.1+ and npm** before class. Recommended for macOS, Linux, or Windows WSL: follow the [official nvm installation guide](https://github.com/nvm-sh/nvm#installing-and-updating), then reopen your terminal. After cloning, `nvm install` and `nvm use` read the project’s `.nvmrc`. If you already have a compatible Node installation, skip those two commands. Check with `node --version` and `npm --version`.

Have a local package manager (**npm**, included with Node.js) and an MCP-capable coding agent **installed and running locally**. You do not need to run model inference locally.

Install Node 26.12.1+ and arrange funded model access, an Exa key, and a Kernel key. Clone the repository, install dependencies, and create `.env` at the beginning of the presentation. Have an MCP-capable coding assistant installed. For the phone stage, complete [Linq setup](LINQ.md) before class: provision a line, install an HTTPS tunnel, create a filtered subscription, and save its signing secret.

Set `OWNER_PHONE_NUMBER` before writing memories so the terminal and phone use the same identity. Set the owner's local IANA timezone. Keep keys in `.env`.

## At the start of the presentation — clone the starter

```sh
git clone <your-repository-url>
cd <your-repository-folder>
nvm install
nvm use
npm ci
cp .env.example .env
```

Open the repository in your coding assistant and let dependencies install during the overview. Do not start the TODOs yet.

## First hands-on step — Exa MCP · 0–3 minutes

Follow [MCP setup](MCP.md) to connect `https://mcp.exa.ai/mcp` to your coding assistant. Then paste:

```text
Use Exa to find the official Search API docs.
Show how to request highlights.
Cite the official documentation URL.
Do not write code yet.
```

**Checkpoint:** watch a real Exa MCP tool invocation and open the official documentation link it returns. An answer without a tool invocation does not verify the connection. Then begin TODO 1.

## 1. Model — one conversation · 3–7 minutes

**What it does:** turns the conversation into an assistant message. Later, it can request tools.

Set `WORKSHOP_MILESTONE=1` and your model key. Run `npm run doctor`, then `npm run starter:chat`. The doctor checks local configuration only; a real reply verifies provider access.

Complete TODO 1 (`callModel`) in `starter/integrations.ts`. Read the supplied transport in `src/model.ts` and the `complete(messages, tools, signal)` call in the complete reference `src/agent.ts`. Begin with an empty tool array. Follow a user message through the request and back to the terminal. The supplied system prompt already requests concise phone replies. Keep this exercise focused on the model callback.

**Checkpoint:** “Help me plan a Friday sushi dinner in San Francisco” receives a genuine model reply. Current facts are not verified yet.

## 2. Exa — add a search tool · 7–13 minutes

**What it does:** searches current web information and returns source URLs and relevant excerpts.

Set `WORKSHOP_MILESTONE=2`, add `EXA_API_KEY`, and restart the CLI. Implement TODO 2 (`searchWeb`) in `starter/integrations.ts`. Inspect the `exa_search` definition, the reference `search()` request, and supplied tool dispatch in `src/agent.ts`.

The model receives a tool definition. When it returns a tool call, the application validates the arguments and executes search. The request includes `contents: { highlights: true }`. Results go back as a `role: 'tool'` message with the matching `tool_call_id`; the model is called again.

Ask: “Find sushi dinner options in San Francisco for Friday under $150 per person before tax and tip. Include source links.”

**Checkpoint:** open a returned source and check one claim. Keep title, URL, highlights, and retrieval time together. A published price range does not guarantee a particular booking or the final bill.

## 3. Kernel — read a rendered page · 13–19 minutes

**What it does:** provides a cloud browser that can render a real website.

Set `WORKSHOP_MILESTONE=3`, add `KERNEL_API_KEY`, and restart. Complete TODO 3 (`readPage`) in `starter/integrations.ts`. Inspect the supplied adapter in `src/browser.ts` and the `browse_page` registration in `src/agent.ts`.

Connect it beside Exa in the tool loop. The adapter creates a session, executes fixed read-only Playwright code, returns visible page text, and deletes the session in a `finally` block. The model receives the result and decides how to use it. No local browser or Python installation is needed.

Ask: “Open https://www.robinomakase.com/location/robin-san-francisco/ and read the published omakase price range.” The URL must be supplied in the current user turn or returned by that turn's search.

**Checkpoint:** a real Kernel session returns rendered text with the requested URL. Reading a pre-recorded example does not satisfy this checkpoint. Search can answer directly when its highlights are enough; browsing is conditional. The teaching adapter reads pages rather than implementing an unrestricted clicking agent.

## 4. Mem0 — add persistent personal context · 19–26 minutes

**What it does:** saves personal facts and retrieves them for later requests.

Complete TODO 4 (`connectMemory`) in `starter/integrations.ts`. Set `WORKSHOP_MILESTONE=4`, restart, and send:

```text
Remember I live in San Francisco, love sushi, and aim for $150 per person before tax and tip.
What do you remember about me?
```

Inspect `src/memory.ts`, `src/memory-worker.ts`, and the memory recall before `complete()` in `src/agent.ts`. The OSS store is local; extraction and embeddings use the configured providers. No hosted Mem0 account or Mem0 API key is required.

Exit, restart, and send `What do you remember about me?` again. Ask “Find dinner options for Friday” without repeating the preferences.

**Checkpoint:** the preferences survive restart and enter the next model request. A friend's request for a quieter room remains conversation context. Ordinary messages do not silently update permanent preferences. “Start a fresh conversation” clears chat and keeps preferences. “Forget my sushi preference” removes only that saved record; “forget all my saved preferences” clears the local profile. Deletion also clears prior conversation. The tools use the configured owner scope, never a model-supplied owner. Slash shortcuts remain available: `/remember <fact>`, `/memories`, `/reset`, `/forget`, and `/help`.

## 5. Linq — replace the terminal with phone messaging · 26–35 minutes

**What it does:** delivers incoming phone messages to your webhook and sends replies back.

Complete TODO 5 (`deliverReply`) in `starter/integrations.ts`. Stop the CLI. Set `WORKSHOP_MILESTONE=5`, complete [Linq setup](LINQ.md), and run `npm run doctor`, then `npm run starter:phone`. Start your HTTPS tunnel to port 3400 and confirm that the subscription points to its current URL.

Read `starter/server.ts` and the complete reference `src/server.ts`: the worker calls the same `answer(store, owner, text)` used by the terminal. Follow `src/http.ts` → `src/linq.ts` → `src/store.ts` → `src/worker.ts` → `src/agent.ts`.

The supplied transport verifies signatures and the configured owner, deduplicates and persists the request, acknowledges quickly, then generates and sends the reply asynchronously. Delivery retries reuse the saved answer and a stable idempotency key.

Text your provisioned line: “Find a sushi dinner option for Friday that fits my preferences.” Then send `What do you remember about me?`.

**Checkpoint:** an actual phone message receives a reply generated by the laptop, using the same profile saved in milestone 4. Restart and check persistence. If provisioning is unavailable, pair with a configured participant or mark this stage incomplete; terminal success does not verify phone transport.

## Build order and runtime order

The learning sequence adds capabilities one at a time. Once complete, a phone turn runs:

```text
Linq → verify + queue → recall Mem0 context → model
     → Exa and/or Kernel when needed → model → Linq reply
```

## Extended workshop

For a 60-minute build, allow more time for each integration, then use the final five minutes for paired demonstrations. Each demo should show one saved preference, one checked source, and one genuine phone reply. Alternatives include hikes, local meetups, and research. Scheduling, bookings, purchases, and proactive alerts are future work.

## Prompts for your coding assistant

These are copyable prompts. Paste one at a time. Edit only `starter/integrations.ts` and configure `.env` manually; preserve the supplied engine, validation, and instructor solution. Each prompt ends at one checkpoint.

### 1. Model

```text
Read starter/README.md and src/model.ts.
Implement TODO 1 in starter/integrations.ts.
Connect complete(); forward messages, tools, and signal.
Leave TODOs 2–5 unfinished. Run npm run typecheck.
Show how to verify a real reply with starter:chat.
```

### 2. Exa API

```text
Use Exa MCP to find the official Search API docs.
Implement TODO 2 in starter/integrations.ts.
POST /search: type auto, numResults 5, highlights true.
Preserve URLs and retrieval time; bound the evidence.
Use the existing tool loop. Run npm run typecheck.
```

### 3. Kernel

```text
Use Exa MCP to find the official Kernel browser docs.
Read src/browser.ts; implement TODO 3 only.
Connect browse() in starter/integrations.ts.
Forward URL, question, and signal unchanged.
Keep URL validation and cleanup. Run typecheck.
```

### 4. Mem0

```text
Use Exa MCP to find the official Mem0 OSS docs.
Read src/memory.ts; implement TODO 4 only.
Return personalMemory(store) from connectMemory.
Keep owner scope, recall, and memory tools for explicit requests.
Run typecheck; show a save → restart → recall check.
```

### 5. Linq

```text
Use Exa MCP to find the official Linq webhook docs.
Read docs/LINQ.md; implement TODO 5 only.
Connect sendReply using config.linqKey.
Forward chat, reply, and the idempotency key.
Keep the queue and signature checks. Run typecheck.
For now: sendReply(key, chat, reply, id, fetch, []).
```


## 6. Feature — source cards · 35–40 minutes

First verify the text-only phone baseline. In TODO 5, call `sendReply(config.linqKey, chat, text, key, fetch, [])`: the final empty list disables cards for the before demonstration.

Repeat the same search after this feature prompt:

```text
Implement TODO 6 in starter/integrations.ts.
Extract public HTTPS URLs; prefer returned Exa Library URLs.
In deliverReply, pass sourceCards(text) to sendReply.
Send a short summary without raw URLs, then ONE OG card.
Use sourceCardLimit(request) for explicitly requested extras.
Keep plain texting: no bold, Markdown, or bullet lists.
Run typecheck and tests. Restart starter:phone.
Repeat the same search and compare before vs after.
```

Implement the separate `sourceCards()` TODO 6, then replace the empty list in `deliverReply` with `sourceCards(text)`. The supplied `src/linq.ts` transport sends each card separately and supplies stable retry keys. `replyLinks()` there is the complete reference implementation.

**Compatibility: iMessage + RCS compatible; SMS receives plain URLs.**

**Checkpoint:** the same search produces one or more actual native source cards without duplicate bare URLs on your phone. No-link replies remain text only. Up to three cards means up to three outbound messages. Preview titles/images depend on source metadata; iMessage and RCS support cards, SMS falls back to URLs. The instructor solution already enables cards.

Source-card delivery defaults to one card. For explicit requests such as “two options” or “more sources,” forward the optional fourth `deliverReply` argument to `sourceCardLimit()` from `src/response.ts` and pass the resulting limit as the seventh `sendReply` argument. The maximum is three; Library URLs rank first.

## Optional extension 7 — Jev emojis + typing bubbles · 10–15 minutes

Add this sequence: **emoji reaction → typing bubble → reply**. Jev selects an emoji from a fixed set; the chat model still writes the response.

```text
Implement TODO 7 in starter/extras.ts; wire starter/server.ts.
Use src/reactions.ts, src/typing.ts, and src/worker.ts as refs.
Jev chooses an emoji or none via OpenRouter Decisions.
Allowlist choices; on error or 2s timeout, use local matching.
React to the inbound message ID, then start typing.
Refresh typing every 60s; stop in finally after reply/failure.
Keep owner checks, deduplication, and reply retries.
Test reaction → typing → reply, plus API failures.
```

Set `REACTION_MODE=jev` and `OPENROUTER_API_KEY` in `.env`. Run `npm run doctor`, `npm run typecheck`, and `npm test`, then restart `npm run starter:phone`. Keep ngrok running.

Extend `acknowledgeMessage()` in `starter/extras.ts` to receive message text. Use `src/reactions.ts` for the OpenRouter Decisions request (`typesafe/jev-1.14`), validated choices, and a two-second timeout. Include a `none` choice for sensitive messages or requests to avoid emojis. Use `queryEmoji()` as a local fallback on API errors.

Send the selected emoji with `POST /api/partner/v3/messages/{messageId}/reactions`, Bearer `LINQ_API_KEY`, and JSON `{"operation":"add","type":"custom","custom_emoji":"🍣"}`. Recover the message resource ID by removing the known `chatId:` prefix from the job ID. Never use `event_id`.

Use the supplied Worker’s fourth argument for acknowledgment, fifth for `'linq'`, and sixth for the typing hook. The worker awaits acknowledgment first. Implement a typing helper using `src/typing.ts`: POST `/api/partner/v3/chats/{chatId}/typing`, refresh every 60 seconds, and return a cleanup callback that clears the timer, waits for any in-flight refresh, and DELETEs the same endpoint. The worker calls cleanup in `finally` after success or failure. Bound Linq calls to three seconds and keep failures best effort. Preserve the queue, owner filter, and deduplication.

**Checkpoint:** text “Find sushi in SF” and “I finally shipped my app.” On iMessage, observe a fitting reaction, then typing, then the reply. “Please do not use emojis” skips the reaction. Verify failure cleanup and that duplicate webhook delivery produces one answer.

**Compatibility:** typing is **iMessage only** through Linq. Reactions are **RCS compatible according to Linq’s protocol matrix**, but its reaction guide conflicts; verify custom emoji on your target device. Neither feature is implemented in this demo’s WhatsApp adapter.

Sources: [Jev Decisions API](https://openrouter.ai/blog/insights/what-is-jev/), [Linq reactions](https://docs.linqapp.com/channel/imessage/guides/messaging/reactions/), [typing indicators](https://docs.linqapp.com/channel/imessage/guides/chats/typing-indicators/), [protocol capabilities](https://docs.linqapp.com/channel/imessage/guides/messaging/protocol-selection/).

## Optional extension 8 — an audio reply · 15–20 minutes

Before: a text reply. After: a playable MP3 voice memo. **Native voice bubble: iMessage only. Audio attachment: RCS compatible.** Trigger speech explicitly with `/voice`; ordinary search requests keep their existing card behavior.

```text
Implement TODO 8 in starter/extras.ts.
Add voice routing in starter/server.ts.
Use src/extras.ts and docs/WORKSHOP.md as references.
Also recognize “send me a voice note” / “read that aloud”.
Generate a short Qwen answer, then call OpenRouter TTS:
  mistralai/voxtral-mini-tts-2603, en_paul_neutral, mp3.
Validate audio/mpeg; save the MP3 under .data/audio/.
Upload bytes to Linq; send attachment_id via /voicememo.
Persist audio and delivery state; prevent duplicate sends.
Run checks; restart starter:phone. Test /voice Say hello.
```

`synthesizeSpeech()` starts in `starter/extras.ts`. The existing `OPENROUTER_API_KEY` pays for speech synthesis; the existing `LINQ_API_KEY` delivers it. These exercises are intentionally unfinished in the starter. The instructor server supports Jev emoji reactions, typing indicators, and natural voice requests such as “send me a voice note.”

1. Generate a short plain-text answer with Qwen. Bound speech input to 600 characters and remove raw URLs from the spoken text.
2. Call `POST https://openrouter.ai/api/v1/audio/speech` with Bearer `OPENROUTER_API_KEY` and the body below. This returns binary audio; do not parse it as chat JSON.
3. Require an OK response, `audio/mpeg`, and bounded nonempty bytes. Save the MP3 under ignored `.data/audio/` with a stable job-specific identity. Play it locally (`afplay FILE.mp3` on macOS).
4. Follow [Linq attachments](https://docs.linqapp.com/channel/imessage/guides/messaging/attachments/): create an attachment, then PUT the raw bytes to its `upload_url` using its `required_headers`. Do not forward API bearer tokens to that upload URL.
5. Save the `attachment_id` for retries. Send it via `POST /api/partner/v3/chats/{chatId}/voicememo` as `{"attachment_id":"..."}`. Follow the voice endpoint’s actual idempotency options rather than assuming text-message fields apply.

```json
{
  "model": "mistralai/voxtral-mini-tts-2603",
  "voice": "en_paul_neutral",
  "input": "Here is your short dinner suggestion.",
  "response_format": "mp3"
}
```

**Checkpoint:** listen to the local MP3, then receive a real playable voice memo on the phone. Retry the job without regenerating the audio. iMessage renders native inline playback; RCS/SMS use an audio attachment. This is outbound speech synthesis; inbound voice transcription is not part of the exercise.

[OpenRouter TTS documentation](https://openrouter.ai/docs/guides/overview/multimodal/tts) · [Verified model/voice example](https://openrouter.ai/blog/tutorials/text-to-speech/) · [Linq voice memos](https://docs.linqapp.com/channel/imessage/guides/messaging/voice-memos/).
