/**
 * Minnesota's Choice — Bills Worker
 * Runs daily via cron trigger
 * Fetches bill status from MN Revisor XML (free, no key)
 * Stores in Cloudflare KV
 * Triggers alert emails via Resend when status changes
 *
 * Cron schedule: 0 8 * * * (8am CT daily)
 *
 * KV namespace: BILLS_CACHE
 * Required secrets: RESEND_API_KEY
 */

// ── TRACKED BILLS ──
// Add or remove bills here. Format: { id, body, number, year, label, stakes }
const TRACKED_BILLS = [
  {
    id: 'HF1191',
    body: 'House',
    number: '1191',
    year: '2026',
    ssn: '0',
    label: 'HF 1191 — End Prison Forced Labor',
    stakes: 'Would close the MN constitutional loophole allowing forced prison labor. Affects thousands of incarcerated Minnesotans.',
    link: 'https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF1191&ssn=0&y=2026'
  },
  {
    id: 'SF1529',
    body: 'Senate',
    number: '1529',
    year: '2026',
    ssn: '0',
    label: 'SF 1529 — End Prison Forced Labor (Senate)',
    stakes: 'Senate companion to HF 1191. Would amend the MN constitution to remove the forced labor exemption for incarcerated people.',
    link: 'https://www.revisor.mn.gov/bills/bill.php?b=Senate&f=SF1529&ssn=0&y=2026'
  }
];

// ── FETCH BILL STATUS FROM MN REVISOR XML ──
async function fetchBillStatus(bill) {
  const url = `https://www.revisor.mn.gov/bills/bill.php?b=${bill.body}&f=${bill.body === 'House' ? 'HF' : 'SF'}${bill.number}&ssn=${bill.ssn}&y=${bill.year}&format=xml`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MinnesotasChoice/1.0 (minnesotaschoice.pages.dev; civic accountability tool)' }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseXML(xml, bill);
  } catch (err) {
    console.error(`Failed to fetch ${bill.id}:`, err.message);
    return null;
  }
}

// ── PARSE MN REVISOR XML ──
function parseXML(xml, bill) {
  const get = (tag) => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? match[1].trim().replace(/<[^>]+>/g, '') : '';
  };

  const getAll = (tag) => {
    const matches = [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))];
    return matches.map(m => m[1].trim().replace(/<[^>]+>/g, ''));
  };

  // Extract last action from action history
  const actions = getAll('action');
  const lastAction = actions.length > 0 ? actions[actions.length - 1] : 'No actions recorded';

  // Extract action dates
  const actionDates = getAll('action_date');
  const lastActionDate = actionDates.length > 0 ? actionDates[actionDates.length - 1] : '';

  // Check for scheduled vote keywords
  const voteKeywords = ['calendar', 'floor', 'vote', 'third reading', 'passage', 'concurrence'];
  const isVoteScheduled = voteKeywords.some(kw =>
    lastAction.toLowerCase().includes(kw)
  );

  return {
    id: bill.id,
    label: bill.label,
    stakes: bill.stakes,
    link: bill.link,
    status: get('status') || get('bill_status') || 'In Progress',
    lastAction,
    lastActionDate,
    isVoteScheduled,
    authors: getAll('author').slice(0, 3).join(', '),
    fetchedAt: new Date().toISOString()
  };
}

// ── SEND ALERT EMAIL VIA RESEND ──
async function sendAlertEmail(bill, previousAction, alertEmails, resendKey) {
  if (!resendKey || !alertEmails || alertEmails.length === 0) return;

  const subject = `🚨 Vote Alert: ${bill.label}`;
  const body = `
A bill you're tracking just had a major update.

Bill: ${bill.label}
Status: ${bill.status}
Latest Action: ${bill.lastAction}
${bill.lastActionDate ? `Date: ${bill.lastActionDate}` : ''}
${bill.isVoteScheduled ? '\n⚠️ A VOTE MAY BE SCHEDULED. Contact your rep NOW.' : ''}

Previous status: ${previousAction}

What this bill does:
${bill.stakes}

Contact your representative now:
minnesotaschoice.pages.dev

View the full bill:
${bill.link}

---
You signed up for bill alerts at minnesotaschoice.pages.dev.
This is a one-time alert for this bill update.
  `.trim();

  for (const email of alertEmails) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: "Minnesota's Choice <alerts@minnesotaschoice.pages.dev>",
          to: email,
          subject,
          text: body
        })
      });
    } catch (err) {
      console.error(`Failed to send alert to ${email}:`, err.message);
    }
  }
}

// ── MAIN CRON HANDLER ──
async function handleCron(env) {
  console.log('Bills Worker running:', new Date().toISOString());

  const results = [];

  for (const bill of TRACKED_BILLS) {
    const current = await fetchBillStatus(bill);
    if (!current) continue;

    // Get previous state from KV
    const prevRaw = await env.BILLS_CACHE.get(`bill:${bill.id}`);
    const previous = prevRaw ? JSON.parse(prevRaw) : null;

    // Detect status change
    const statusChanged = previous && previous.lastAction !== current.lastAction;

    if (statusChanged || current.isVoteScheduled) {
      console.log(`Status change detected for ${bill.id}:`, current.lastAction);

      // Get alert subscribers for this bill
      const subscribersRaw = await env.BILLS_CACHE.get(`alerts:${bill.id}`);
      const subscribers = subscribersRaw ? JSON.parse(subscribersRaw) : [];

      if (subscribers.length > 0) {
        await sendAlertEmail(
          current,
          previous?.lastAction || 'Unknown',
          subscribers,
          env.RESEND_API_KEY
        );
        console.log(`Alerts sent to ${subscribers.length} subscribers for ${bill.id}`);
      }
    }

    // Write current state to KV (expires in 48 hours as safety net)
    await env.BILLS_CACHE.put(`bill:${bill.id}`, JSON.stringify(current), { expirationTtl: 172800 });
    results.push(current);
  }

  // Write summary for frontend to read
  const summary = {
    bills: results,
    updatedAt: new Date().toISOString(),
    billOfWeek: results[0] || null
  };

  await env.BILLS_CACHE.put('bills:summary', JSON.stringify(summary));
  console.log(`Worker complete. ${results.length} bills updated.`);
}

// ── FETCH HANDLER (frontend reads bill data) ──
async function handleFetch(request, env) {
  const url = new URL(request.url);

  // CORS headers for Pages frontend
  const cors = {
    'Access-Control-Allow-Origin': 'https://minnesotaschoice.pages.dev',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600'
  };

  // GET /api/bills - returns all tracked bills summary
  if (url.pathname === '/api/bills') {
    const data = await env.BILLS_CACHE.get('bills:summary');
    if (!data) {
      return new Response(JSON.stringify({ error: 'No data yet', bills: [] }), { headers: cors });
    }
    return new Response(data, { headers: cors });
  }

  // POST /api/alerts - subscribe to bill alerts
  if (url.pathname === '/api/alerts' && request.method === 'POST') {
    try {
      const { email, billId } = await request.json();

      // Basic validation
      if (!email || !billId || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: cors });
      }

      // Add to subscriber list
      const key = `alerts:${billId}`;
      const existing = await env.BILLS_CACHE.get(key);
      const subscribers = existing ? JSON.parse(existing) : [];

      if (!subscribers.includes(email)) {
        subscribers.push(email);
        await env.BILLS_CACHE.put(key, JSON.stringify(subscribers));
      }

      return new Response(JSON.stringify({ success: true }), { headers: cors });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: cors });
    }
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
}

// ── EXPORT ──
export default {
  // HTTP requests from frontend
  async fetch(request, env, ctx) {
    return handleFetch(request, env);
  },

  // Daily cron trigger
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  }
};
