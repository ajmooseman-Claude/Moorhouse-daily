# The Moorhouse Daily

A personal front page: morning brief, weather, iCloud diary, notebook, three daily priorities, countdowns, a social desk, and a Claude assistant you can talk to. Hosted on Vercel, behind a password.

## What runs where

| Piece | Where |
|---|---|
| The page (`public/index.html`) | Vercel, static |
| Server code (`api/`) | Vercel Functions |
| Notes, priorities, settings | Upstash Redis (free tier, added inside Vercel) |
| Morning brief | Vercel Cron, weekdays, runs some time between 06:00 and 07:00 in summer (05:00 to 06:00 in winter) |
| Weather | Open-Meteo, free, no key |
| Diary | Any number of iCloud, Google or Outlook calendar links, each colour-coded |
| Brief, Ask, post drafts, email sorting | Anthropic API (your key, pay as you go) |
| Email notifications | iCloud and Gmail over IMAP (app passwords), Outlook / Microsoft 365 via Microsoft Graph. Read-only. |

If the cron runs late or fails, the page writes a fresh brief the first time you open it each day, and keeps weather and diary current (at most every 30 minutes) while it's open.

## One-time setup (about 15 minutes)

### 1. Get an Anthropic API key
1. Go to console.anthropic.com and sign in (this is separate from your Claude subscription).
2. Settings > Billing: add a card and a small credit, £5 to £10 is plenty to start. Set a monthly limit if you like.
3. API Keys > Create Key. Copy it somewhere safe; it starts `sk-ant-`.

### 2. Import the project into Vercel
1. Sign in at vercel.com with your GitHub account.
2. Add New > Project, pick this repository, and press Deploy. Leave every build setting on its default.

### 3. Add storage
1. In the project, open the Storage tab > Create Database > Upstash for Redis (free plan).
2. Connect it to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.

### 4. Add the secrets
Project > Settings > Environment Variables. Add each of these for Production (see `.env.example`):

| Name | Value |
|---|---|
| `DASHBOARD_PASSWORD` | The password you'll type to open the dashboard. Make it long. |
| `SESSION_SECRET` | 64 random characters. On a Mac, run `openssl rand -hex 32` in Terminal. |
| `CRON_SECRET` | Another random string (same command). Vercel sends it with the morning job. |
| `ANTHROPIC_API_KEY` | The key from step 1. |
| `MAIN_MAN_API_KEY` | Optional. A long random string. The main man sends it as `Authorization: Bearer <key>` when it posts to the dashboard. |
| `MAIN_MAN_WEBHOOK_URL` | Optional. Where the message box delivers what you type. Must be `https://` on Vercel. |
| `MAIN_MAN_WEBHOOK_KEY` | Optional. Secret sent with each message. |
| `MAIN_MAN_WEBHOOK_KEY_HEADER` | Optional. Header name for that secret. Leave it unset to send `Authorization: Bearer <key>`. Set `X-Api-Key` (or whatever the webhook expects) to send the key as that header's value. |

Then Deployments > the latest one > Redeploy, so the new values take effect.

### 5. Point your domain at it
1. Project > Settings > Domains > Add, and type e.g. `daily.yourdomain.co.uk`.
2. Vercel shows one DNS record (usually a CNAME to `cname.vercel-dns.com`). Add it wherever your domain's DNS is managed. It's live within minutes; the HTTPS certificate is automatic.

### 6. First visit
1. Open your address, enter the password.
2. Gear icon (top right): set the weather town, add your calendars (name, link and colour for each), choose the reading voice.
3. On iPhone: Safari > Share > Add to Home Screen, for a full-screen app icon.

## Email notifications

While the dashboard is open it checks your inboxes every 2 minutes. Newsletters, promotions and automated mail are dropped first (unsubscribe headers, bulk senders, Gmail's Promotions, Social and Forums tabs, Outlook's "Other" inbox). Claude then sorts what's left: real people, business contacts, and money or deadlines pop up; everything else stays quiet. Relevant emails wait in the bell tray (top right) until you mark them read. Nothing in your mailboxes is ever changed.

Passwords and sign-in tokens are encrypted before they're stored.

### iCloud
1. Go to account.apple.com › Sign-In and Security › App-Specific Passwords, and create one called "Moorhouse Daily".
2. Dashboard › gear › Email accounts › + iCloud. Enter your iCloud address (e.g. you@me.com) and that password.

### Gmail
1. 2-Step Verification must be on for the Google account.
2. Go to myaccount.google.com/apppasswords, create one called "Moorhouse Daily" and copy the 16 letters.
3. Dashboard › gear › Email accounts › + Gmail. Enter the address and the app password.

### Outlook / Microsoft 365 (one-off, about 5 minutes)
Microsoft needs a small app registration so the dashboard can ask for read-only access to mail.
1. Go to entra.microsoft.com and sign in (a work Microsoft 365 account is easiest).
2. Applications › App registrations › New registration.
   - Name: Moorhouse Daily
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Leave Redirect URI empty. Press Register.
3. Copy the **Application (client) ID** from the Overview page.
4. Authentication (left menu) › Advanced settings › **Allow public client flows: Yes** › Save.
5. In Vercel add an environment variable `MS_CLIENT_ID` with that ID, then redeploy.
6. Dashboard › gear › Email accounts › + Outlook › Sign in with Microsoft. Enter the code it shows at microsoft.com/devicelogin and accept.

If a work account says it needs admin approval, the Microsoft 365 administrator has to allow the app (Enterprise applications › Moorhouse Daily › Permissions › Grant admin consent).

## The main man

The assistant can post the morning brief, today's three things, and alerts. You can write back from the dashboard. Both sides use the same Redis store as the rest of the page (in memory when you run it locally without Redis).

The morning brief he posts fills the brief already on the page. The morning job will not overwrite it later that day. Press Refresh on the brief if you want a new one written from the diary and the weather. The three things replace the three slots. A repeated notification with the same `id` does not create a second copy, and it will not mark a read or dismissed one as new again.

Alerts show under **From The main man**, newest first, and new ones also pop up and sit in the bell tray, labelled The main man. The message box is behind the normal dashboard password. `POST /api/main-man` is not: it ignores the password and accepts only the bearer token, compared in constant time.

```bash
curl -s -X POST https://moorhouse-daily.vercel.app/api/main-man \
  -H "Authorization: Bearer $MAIN_MAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "brief": "Two meetings today. Send the heads of terms before lunch.",
    "priorities": ["Send the heads of terms", "Call the surveyor", "Review the 5pm draft"],
    "notification": {
      "id": "appleton-reply-42",
      "title": "Prospect replied",
      "body": "Helen answered the teaser.",
      "business": "Appleton",
      "link": "https://example.com/thread/42",
      "priority": "high"
    }
  }'
```

Send any one of `brief`, `priorities` or `notification`, or all three. `business` is `Appleton`, `Bellgreave`, `5pm Theory`, `Personal` or `Other`. `priority` is optional: `low`, `normal` or `high`. `id` is optional, up to 80 characters (letters, numbers, `.`, `_`, `:` or `-`).

Missing or wrong token: `401` and `{"error":"Not allowed"}`. The dashboard password is not accepted on this path. Anything other than JSON: `415`. A bad body: `400`. Success: `200` and `{"ok":true,...}`.

A message from the dashboard is posted as JSON:

```json
{"message": "...", "sent_at": "2026-09-30T11:35:00.000Z", "source": "moorhouse-daily"}
```

Set the `MAIN_MAN_` variables for Production, then redeploy. Locally, without Redis, posts last only until you stop the process.

## Voice
- **Talking to it:** the mic buttons and the Talk button in the dock use the browser's speech recognition (Safari and Chrome). The first time, allow microphone access for your address.
- **It talking back:** uses the voices installed on each device. Samantha is the default; if she's missing on a device, add her in System Settings > Accessibility > Spoken Content (Mac) or Settings > Accessibility > Spoken Content > Voices (iPhone).

## Running it locally
```
npm install
DASHBOARD_PASSWORD=test SESSION_SECRET=0123456789abcdef0123456789 CRON_SECRET=x node dev-server.js
# in another terminal
npm test
node test/calendar.js
```
Without Redis variables it keeps data in memory, so nothing persists between restarts.

## Costs
- Vercel Hobby, Upstash free tier and Open-Meteo: £0.
- Anthropic API: roughly a penny or two per brief and per question. Typical personal use is a few pounds a month.

## Security notes
- Every data route checks a signed, HttpOnly session cookie. Sessions last 90 days; Settings > Sign out ends yours.
- Login attempts are rate-limited (8 per 10 minutes per address).
- Your calendar link and notes live only in your Upstash database.
- The page asks search engines not to index it.
