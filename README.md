# Minnesota's Choice

Lawmaker accountability infrastructure for every Minnesotan.

**Live at:** [minnesotaschoice.pages.dev](https://minnesotaschoice.pages.dev)

## What It Does

- Enter your zip code - see exactly who represents you
- Call, email, and request a meeting with one tap
- Every action is logged publicly on your rep's record
- Lawmakers' response rates are visible and shareable
- Bill of the Week with live status updates from the MN Legislature
- Bill alerts when a vote is scheduled - email notification, one click to act

## Stack

- **Hosting:** Cloudflare Pages (free)
- **Worker:** Cloudflare Workers with cron trigger (free)
- **Storage:** Cloudflare KV for bill data cache (free)
- **Rep Lookup:** Google Civic API (free)
- **Bill Data:** MN Office of the Revisor of Statutes XML (free, public)
- **Alerts:** Resend (100 emails/day free tier)
- **Ledger:** Supabase (free tier)

Total cost to run: $0

## File Structure

```
minnesotaschoice/
├── index.html              - The full app (mobile-first, single file)
├── _headers                - Cloudflare Pages security headers
├── wrangler.toml           - Cloudflare Worker config
└── workers/
    └── bills-worker.js     - Daily cron: fetches MN Revisor XML, stores in KV, sends alerts
```

## Setup

### 1. Cloudflare Pages
- Connect this repo to Cloudflare Pages
- Build command: none (static)
- Output directory: `/`

### 2. KV Namespace
- Cloudflare dashboard - Workers & Pages - KV
- Create namespace: `BILLS_CACHE`
- Paste the ID into `wrangler.toml`

### 3. Deploy Worker
```bash
npx wrangler deploy
```

### 4. Set Secrets
```bash
npx wrangler secret put RESEND_API_KEY
```

### 5. Environment Variables
Add to `index.html` before deploying:
- `YOUR_GOOGLE_CIVIC_API_KEY` - replace placeholder with real key from Google Cloud Console
- Supabase URL and anon key for ledger persistence

## Adding Tracked Bills

Edit `TRACKED_BILLS` array in `workers/bills-worker.js`:

```js
{
  id: 'HF0000',
  body: 'House',
  number: '0000',
  year: '2026',
  ssn: '0',
  label: 'HF 0000 - Bill Name',
  stakes: 'Plain language description of what this bill does and who it affects.',
  link: 'https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF0000&ssn=0&y=2026'
}
```

## Built By

Vinny Branchaud - Saint Paul, MN
North Star Human Rights - northstarhr.pages.dev

Free. No ads. No data sold. No party affiliation.
Your voice. Their record.
