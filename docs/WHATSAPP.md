# Use WhatsApp for the complete demo

The instructor solution supports WhatsApp through Meta's WhatsApp Cloud API. Select one phone channel per server: `linq` (the default) or `whatsapp`. The same agent, Exa search, Kernel browser, and Mem0 profile work on both. The starter's TODO 5 remains a Linq exercise; run `npm run solution:phone` for the WhatsApp option.

This adapter handles direct text from your configured owner number and replies with text and source links. It requests a native preview for each source link, one by default and up to three when requested. Preview rendering depends on WhatsApp and the source page. Emoji reactions, outbound voice, incoming audio transcription, media, groups, and template messages are not implemented on this channel. Voice requests receive an explanation in text.

## 1. Set up Meta's test number

Follow [Meta's Cloud API getting started guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started). Create a Meta developer app with the WhatsApp use case and open its API Setup page. Use the supplied test business number for your first round trip. Add and verify your own WhatsApp number as a test recipient when prompted.

Collect these values from your app:

- An access token authorized to send WhatsApp messages for the test number. Temporary dashboard tokens expire; replace an expired token before presenting. Use Meta's appropriate server token setup for ongoing use.
- The **Phone number ID**, not the displayed phone number, app ID, or WhatsApp Business Account ID.
- The **App secret** from the app's settings. It authenticates incoming webhook requests.
- A supported Graph API version shown in API Setup, in `vNN.0` format. The demo requires you to pin this explicitly.

Choose a separate random webhook verification token, for example with `openssl rand -hex 32`. You will put the same value in `.env` and the Meta webhook form. It is distinct from the access token and app secret.

## 2. Configure the project

Complete the Node/dependency setup in [README](../README.md). Copy `.env.example` to `.env` if you have not already done so. Keep your model, Exa, Kernel, and embedding settings, then set:

```dotenv
WORKSHOP_MILESTONE=5
MESSAGING_CHANNEL=whatsapp
OWNER_PHONE_NUMBER=+12025550100
WHATSAPP_ACCESS_TOKEN=<access token from Meta>
WHATSAPP_PHONE_NUMBER_ID=<numeric phone number ID>
WHATSAPP_APP_SECRET=<Meta app secret>
WHATSAPP_VERIFY_TOKEN=<your random verification token>
WHATSAPP_API_VERSION=<supported version from API Setup, formatted vNN.0>
```

Replace the sample owner with your own WhatsApp number in international format, including `+`. It must differ from the business/test number. Linq credentials are not required in WhatsApp mode. The owner number is also the memory scope; use the same value in terminal and phone mode to share your preferences.

This single-owner adapter requires an inbound `from` phone number matching that owner. Events containing only a business-scoped user ID or username are ignored. It does not infer an owner's identity from a display name.

## 3. Start the server and connect the webhook

```sh
npm run doctor
npm run solution:phone
```

In a second terminal, start your authenticated ngrok tunnel:

```sh
ngrok http 3400
```

Open the webhook configuration for your Meta app's WhatsApp integration. Set:

- Callback URL: `https://YOUR-TUNNEL/webhooks/whatsapp`
- Verify token: exactly the value of `WHATSAPP_VERIFY_TOKEN`

Save/verify the callback and subscribe to the **messages** webhook field. Ensure the app is subscribed to the WhatsApp Business Account associated with your test number, following Meta's setup guide. The server must be running during verification. It echoes the GET challenge only for the matching token; POST events require a valid `X-Hub-Signature-256` signed with your app secret. See [Meta's webhook verification reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/) (archived SDK documentation; this project uses direct HTTP, not that SDK).

Check `http://127.0.0.1:3400/healthz` and the tunnel's `/healthz`; both should return `{"ok":true}`. These checks establish server reachability, not token validity or message delivery.

## 4. Verify a real conversation

From your configured owner number, send these messages in WhatsApp to the test business number:

```text
/help
Remember I live in San Francisco and like sushi.
Find a sushi dinner option in San Francisco.
What do you remember about me?
```

Restart the server and send `What do you remember about me?` again to check persistence. Initiate the conversation from your phone and test replies promptly within WhatsApp's customer service window; this demo sends free-form replies and has no template-message flow for conversations outside that window. See [Meta's messaging documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/overview).

The transport uses Meta's [text message endpoint with preview URLs](https://www.postman.com/meta/whatsapp-business-platform/request/0arw2jw/send-text-message-with-preview-url). It sends the summary separately from each source URL and splits long text into bounded messages. A successful send means Meta accepted the message; confirm delivery on your phone. Delivery/status events do not generate agent replies.

## Delivery behavior and troubleshooting

Webhook batches are processed in full, authenticated before parsing, and deduplicated persistently by message ID. Other senders and other phone-number IDs are ignored. Pending jobs are filtered by channel, so changing `MESSAGING_CHANNEL` cannot send an old Linq reply through WhatsApp or vice versa. Stop the existing process before changing channels; run one process per data directory.

Generation failures retain the existing bounded retry behavior. WhatsApp outbound attempts are persisted per message part. Completed parts are skipped on restart. The adapter does not assume a provider-side send idempotency key: network timeouts, uncertain acceptance, and rejected sends put the job in `needs_review`, without automatic resending. This favors avoiding duplicates over automatic delivery recovery.

If the server reports a delivery review, inspect local SQLite `jobs` and `whatsapp_outbox` with a SQLite viewer. `sending` means acceptance may be uncertain, `rejected` means the API returned a failure, and `sent` means acceptance was recorded. The stored reply is retained. Check the recipient phone, Meta dashboard, token validity, permissions, and messaging window before retrying anything manually. After fixing configuration, send a new inbound request with a new message ID. Reposting the old webhook will not requeue it. Do not clear uncertain outbox records to force a resend without checking the phone.

For callback verification failure, check the tunnel URL, server, and verify token. For HTTP 401 on incoming events, check the **app secret**, not the verify token. If events return HTTP 200 without a reply, check the owner number, phone-number ID, `messages` subscription, and that the inbound event is direct text with a phone-number sender. Keep credentials out of screenshots and logs.

Keep the laptop and tunnel running. Update Meta's callback when the tunnel URL changes. After the workshop, stop both processes and remove the temporary webhook subscription in Meta.

Local automated tests cover signatures, verification, owner filtering, batches, duplicate events, reply formatting, delivery holds, and channel switching using fake provider responses. A live Meta account and phone round trip are still required to validate your credentials and end-to-end delivery.
