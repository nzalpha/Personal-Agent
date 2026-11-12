# Attendee starter

After cloning at the start of the presentation, begin hands-on work with [Exa MCP](../docs/MCP.md): connect it to your coding assistant and use it to find the official Search documentation. Then wire the providers into the supplied agent in this order: **model → Exa → Kernel → Mem0 → Linq**. The five unfinished integrations are in [integrations.ts](integrations.ts). They throw explicit TODO errors until implemented; they do not fall back to completed provider callbacks.

Run commands from the workshop root, where `.env` and dependencies live:

```sh
npm run starter:chat
# After all five integrations and Linq prework:
npm run starter:phone
```

Set `WORKSHOP_MILESTONE=1` initially, then increase it after completing each checkpoint in [the participant guide](../docs/WORKSHOP.md).

The terminal, bounded model/tool loop, tool schemas, owner isolation, webhook verification, durable queue, and provider adapters are supplied infrastructure. The exercise is to connect and understand the five integration boundaries. Exa's request is the small HTTP implementation exercise; the other providers use supplied adapters whose internals you inspect. This is an integration workshop rather than an exercise in rebuilding SDKs or webhook signing.

The complete instructor version remains in `src/`. Run `npm run solution:chat` or `npm run solution:phone` from the workshop root. The instructor entry points never import this starter, so unfinished exercises cannot break the phone demo.

After the five integrations, implement feature TODO 6 (`sourceCards`) in `integrations.ts`. Keep TODO 5 text-only with a final `[]` argument to `sendReply`, then switch to `sourceCards(text)` for the before/after comparison. See the participant guide.

Optional longer-workshop exercises live in [extras.ts](extras.ts): TODO 7 adds an emoji acknowledgment; TODO 8 generates MP3 speech through OpenRouter and connects Linq voice delivery. Neither runs until implemented and wired.
