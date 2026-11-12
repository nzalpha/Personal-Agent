# Connect Linq to your laptop

This guide uses `MESSAGING_CHANNEL=linq` (the default). For the complete demo's optional WhatsApp text channel, follow [WhatsApp setup](WHATSAPP.md).

Complete this before the workshop. Each independently running agent needs its own provisioned Linq line, subscription, signing secret, and HTTPS tunnel URL. Arrange account access and line provisioning with the organizer; do not assume an API key alone includes a usable line. A shared organizer line cannot independently route each participant's conversation to every laptop using this single-owner starter.

## Activate your sandbox

1. Go to [Linq sandbox](https://dashboard.linqapp.com/sandbox).
2. Verify your account for the seven-day free trial.
3. Activate your sandbox and follow the dashboard prompts.
4. In API Tokens, click **Generate new token** and save it in the repository root `.env` as `LINQ_API_KEY`. Use the sandbox environment; the slide’s reference screenshot is labeled Production.
5. Obtain your assigned line, then configure the webhook below. The subscription’s `signing_secret` goes in the same `.env` as `LINQ_WEBHOOK_SECRET`; it is not the API token.

Linq advertises its [seven-day free trial](https://linqapp.com/). The verification and activation sequence above follows Linq’s dashboard instructions. See the [official API quickstart](https://docs.linqapp.com/channel/imessage/getting-started/quickstart/) for token, line, messaging, and webhook setup. In sandbox mode, [recipients must message your line first](https://docs.linqapp.com/channel/imessage/error/codes/2xxx/2008/); start the workshop check from your own phone.

## Configure the owner and line

From your project folder, open `.env`:

```sh
nano .env
```

Add these values locally. Save with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**:

```dotenv
WORKSHOP_MILESTONE=5
LINQ_API_KEY=<your API token>
LINQ_PHONE_NUMBER=<your assigned Linq line in E.164 format>
OWNER_PHONE_NUMBER=<your own phone number in E.164 format>
```

The line and owner must differ. The starter handles direct inbound text from that owner only. Group messages, other senders, and outbound echoes are ignored. Set `AGENT_TIMEZONE` to the owner's local IANA timezone.

## Expose only the webhook service

Install [ngrok and authenticate your account](https://ngrok.com/download) before the workshop. Start the tunnel **before** creating the subscription; the agent itself starts after its signing secret has been saved:

In the ngrok dashboard, choose **Getting Started → Your Authtoken** ([direct link](https://dashboard.ngrok.com/get-started/your-authtoken)). Copy the token and authenticate once:

```sh
ngrok config add-authtoken YOUR_AUTHTOKEN
```

Then start the tunnel:

```sh
ngrok http 3400
```

Keep the tunnel terminal running. Copy its HTTPS URL. It forwards to the loopback server on port 3400; do not expose the presentation or a browser debugging port. Tunnel providers may require an account and initial authentication. Follow your provider's setup before class.

## Create the subscription

Your Linq API key can create the subscription directly. Paste this into your local coding agent after ngrok is running:

```text
Read docs/LINQ.md. Use LINQ_API_KEY from .env.
Get the HTTPS URL from ngrok at 127.0.0.1:4040/api/tunnels.
Create a Linq V3 webhook subscription via the API:
  target: HTTPS URL + /webhooks/linq?version=2026-02-03
  event: message.received
  phone filter: LINQ_PHONE_NUMBER from .env
Save signing_secret as LINQ_WEBHOOK_SECRET in .env.
Keep the subscription ID. Do not print any secrets.
Check for an existing subscription; avoid duplicates.
```

For an existing matching subscription with a saved secret, reuse it. Update its target URL when ngrok changes; keep the existing signing secret. If the secret has been lost, it cannot be retrieved from Linq—resolve that before recreating a subscription.

The API request below is a reference; no manual dashboard step is required. Send `POST https://api.linqapp.com/api/partner/v3/webhook-subscriptions` with `Authorization: Bearer <your API token>` and `Content-Type: application/json`.

```json
{
  "target_url": "https://YOUR-TUNNEL/webhooks/linq?version=2026-02-03",
  "subscribed_events": ["message.received"],
  "phone_numbers": ["+12025550123"]
}
```

Save the returned `signing_secret` as `LINQ_WEBHOOK_SECRET` in `.env`. Keep the subscription ID for updating or disabling it later. The secret is shown when the subscription is created and cannot be retrieved later. The version is pinned through the target URL query parameter. See [Linq subscription documentation](https://docs.linqapp.com/channel/imessage/guides/webhooks/subscriptions/) and [webhook versioning and signatures](https://docs.linqapp.com/channel/imessage/guides/webhooks/).

## Verify a real round trip

```sh
npm run doctor
npm start
```

Open `http://127.0.0.1:3400/healthz`, then the tunnel's `/healthz`. Both should return `{"ok":true}`. Text your provisioned line from the owner phone. Send `/help` first, then a research request to exercise the model and Exa.

The API can choose iMessage, RCS, or SMS according to service support. Describe the demo as “text your agent”; call it iMessage only after confirming the actual conversation uses iMessage. A successful send API call means Linq accepted the reply; it is not a device delivery receipt. See [Linq sending and idempotency documentation](https://docs.linqapp.com/channel/imessage/guides/messaging/sending-messages/).

## Troubleshoot

| Symptom | Check |
| --- | --- |
| Local health check fails | Node version, server terminal, port conflicts |
| Public health check fails | Tunnel still running and forwarding to 3400 |
| No inbound events | Subscription active, correct line filter, current target URL |
| HTTP 401 on webhook | Subscription's exact signing secret, raw body, laptop clock |
| HTTP 400 on webhook | Target URL pins `version=2026-02-03` |
| HTTP 200 but no response job | Owner number and line match the event; direct inbound text only |
| Generation or delivery fails | Model/Exa/Linq keys, account credits, model tool support |
| Memories differ from CLI | `OWNER_PHONE_NUMBER` was set before writing the CLI profile |

The worker retries a failed job up to three attempts and saves a generated reply before attempting delivery. Failed jobs remain inspectable in local SQLite. Run one server per data directory; queue leasing across multiple servers is outside this starter's scope.

When a temporary tunnel URL changes, update the existing subscription target URL and retain its version query. After class, stop the server and tunnel and disable your workshop subscription. Local hosting lasts only while your laptop and tunnel are running.

## Search result cards

Phone replies with source URLs send a short summary without raw URLs, followed by one native Linq `link` message by default. Replies with no valid source URLs remain plain text. Exa Library URLs are preferred when available. Send one card by default. The worker passes the inbound request to the transport; explicit requests for multiple options or sources may receive up to three. Each card is a separate message with a stable idempotency key, so partial-send retries do not duplicate earlier messages. The source page supplies the preview metadata; no extra Exa request is needed. iMessage and RCS support rich previews; SMS falls back to the URL. Pages without accessible metadata may also show a plain link. See [Linq rich link previews](https://docs.linqapp.com/channel/imessage/guides/messaging/rich-link-previews/).

## Instructor emoji and voice checks

The complete `solution:phone` server reacts 👀 to a new owner message before generating its answer. Reaction failure does not block the reply. Send `/voice Say hello in one sentence` to generate a short MP3 through OpenRouter and deliver it using Linq’s native voice endpoint. Ordinary messages retain the one-card default.

Audio files are stored under ignored `.data/audio/`; generated files and attachment IDs are reused on retries. The voice endpoint does not document a send idempotency key: an ambiguous in-flight voice send is held for review rather than automatically resent. Local synthesis and Linq upload have been verified; confirm playback on your phone. The starter exercises remain TODOs 7–8 in `starter/extras.ts`; complete code is in `src/extras.ts`.

Acknowledgment reactions now follow the message topic using local keyword rules: sushi 🍣, weather 🌦️, food 🍽️, coding 💻, travel ✈️, music 🎵, sports 🏟️/🏀, finance 📈, memory 🧠, and /voice 🎙️. Unknown topics use 👀. Selection does not make a model call. `queryEmoji()` in `src/extras.ts` is the instructor reference.

Voice requests may use `/voice ...` or natural wording such as “send me a voice note” and “read that aloud.” These route to speech generation and voice-memo delivery; ordinary questions about how voice notes work remain text.
