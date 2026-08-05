// transform.js — shape Cursor usage events into a per-member, per-model summary.
//
// Input is the raw response of POST /teams/filtered-usage-events for ONE member:
//
//   { totalUsageEventsCount, pagination: { hasNextPage, ... }, usageEvents: [...] }
//
// We aggregate the events by model and emit totals + a ranked model list under
// IDX_0, which is what shared.liquid reads.

function toNumber(value) {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }
  return Number(value);
}

// Spend in cents for one event.
//
// chargedCents is what the team was actually billed, so it wins.
// tokenUsage.totalCents is the pre-discount token cost and only appears on
// token-based calls. The rest are fallbacks for older/other response shapes.
function eventCents(e) {
  if (e == null) {
    return 0;
  }
  if (e.chargedCents != null) {
    return toNumber(e.chargedCents);
  }
  if (e.tokenUsage && e.tokenUsage.totalCents != null) {
    return toNumber(e.tokenUsage.totalCents);
  }
  if (e.costCents != null) {
    return toNumber(e.costCents);
  }
  if (e.spendCents != null) {
    return toNumber(e.spendCents);
  }
  if (e.priceCents != null) {
    return toNumber(e.priceCents);
  }
  if (e.cost != null) {
    return Math.round(toNumber(e.cost) * 100);
  }
  if (e.usdCost != null) {
    return Math.round(toNumber(e.usdCost) * 100);
  }
  return 0;
}

// Model identifier for an event, verbatim.
//
// Deliberately NOT prettified. A previous version mapped these to friendly
// labels with a regex ("claude-opus-4" -> "Opus 4"), which silently collided:
// claude-opus-4, claude-opus-4-1-20250805 and claude-opus-4-5-thinking all
// produced "Opus 4", and gemini-2.5-pro and gemini-2.5-flash both produced
// "Gemini 2.5" despite very different pricing. Distinct rows with distinct
// spend became indistinguishable. Show what the API returned.
function eventModel(e) {
  if (e == null) {
    return 'unknown';
  }
  if (e.model) {
    return e.model;
  }
  if (e.modelIntent) {
    return e.modelIntent;
  }
  if (e.modelName) {
    return e.modelName;
  }
  if (e.tokenUsageModel) {
    return e.tokenUsageModel;
  }
  return 'unknown';
}

// Premium ("fast") requests charged by an event. Token-based calls bill on
// tokens rather than the request quota, so they contribute nothing here.
// requestsCosts is Cursor's own charged-request count — an event can be worth
// more than one request (max mode), so we sum it rather than counting events.
function fastRequests(e) {
  if (e == null) {
    return 0;
  }
  if (e.isTokenBasedCall === true) {
    return 0;
  }
  if (e.usageBasedPricing === true) {
    return 0;
  }
  if (e.requestsCosts != null) {
    return toNumber(e.requestsCosts);
  }
  if (e.requestType) {
    if (String(e.requestType).toLowerCase() === 'fast') {
      return 1;
    }
    return 0;
  }
  return 1;
}

// Cents to a fixed 2-decimal dollar string. Liquid's `round: 2` drops trailing
// zeros ("1.4", "0.5"), which looks broken on a money readout, and Liquid has
// no sprintf — so the templates render these pre-formatted.
function dollars(cents) {
  return (toNumber(cents) / 100).toFixed(2);
}

// "nick.spaghetti@x.com" → "Nick Spaghetti". The filtered-usage-events response
// carries no display name, only userEmail, so we derive one.
function displayName(email) {
  const local = String(email || '').split('@')[0];
  if (!local) {
    return 'Member';
  }
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  if (!words) {
    return 'Member';
  }
  return words;
}

// The member this instance is configured for, or '' if it isn't usable.
//
// trmnlp exposes custom_fields_values verbatim, without interpolating
// `{{ env.X }}`, so locally this can arrive as the literal Liquid tag rather
// than an address. Anything without an '@' or containing '{' is rejected.
function memberEmail(root) {
  if (!root.trmnl || !root.trmnl.plugin_settings) {
    return '';
  }
  const settings = root.trmnl.plugin_settings.custom_fields_values;
  if (!settings) {
    return '';
  }
  const configured = String(settings.cursor_member_email || '').trim();
  if (!configured.includes('@')) {
    return '';
  }
  if (configured.includes('{')) {
    return '';
  }
  return configured;
}

// The events array lives under one of these keys depending on API version.
function eventsFrom(raw) {
  if (Array.isArray(raw.usageEvents)) {
    return raw.usageEvents;
  }
  if (Array.isArray(raw.events)) {
    return raw.events;
  }
  if (Array.isArray(raw.data)) {
    return raw.data;
  }
  return [];
}

function transform(input) {
  const root = input || {};
  // trmnlp and the hosted service only wrap responses in IDX_0 when the plugin
  // declares MULTIPLE polling URLs. This plugin declares one, so the response
  // arrives at the top level — accept both.
  let raw = root;
  if (root.IDX_0) {
    raw = root.IDX_0;
  }

  const returned = eventsFrom(raw);

  // The polling body already asks Cursor for one member's events. Re-filter
  // anyway: a typo'd email or an ignored filter would otherwise let team-wide
  // events through and get labelled "Personal AI Spend". Only filter when the
  // configured address is usable and the events actually carry userEmail —
  // otherwise a schema change would silently zero the dashboard.
  const member = memberEmail(root).toLowerCase();
  const labelled = returned.filter((e) => e && e.userEmail);

  let events = returned;
  let foreignEvents = 0;
  if (member && labelled.length) {
    events = labelled.filter((e) => String(e.userEmail).toLowerCase() === member);
    // Non-zero means the server-side filter did not do what we asked.
    foreignEvents = labelled.length - events.length;
  }

  const byModel = new Map();
  let totalSpendCents = 0;
  let totalFastRequests = 0;

  for (const e of events) {
    const model = eventModel(e);
    const cents = eventCents(e);

    let row = byModel.get(model);
    if (!row) {
      row = { model, spendCents: 0, requests: 0 };
      byModel.set(model, row);
    }
    row.spendCents += cents;
    row.requests += 1;

    totalSpendCents += cents;
    totalFastRequests += fastRequests(e);
  }

  const models = Array.from(byModel.values())
    .map((r) => {
      // share of this member's total spend, 0–100
      let sharePct = 0;
      if (totalSpendCents > 0) {
        sharePct = (r.spendCents / totalSpendCents) * 100;
      }
      return {
        name: r.model,
        spendCents: r.spendCents,
        spend: dollars(r.spendCents),
        requests: r.requests,
        sharePct,
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, 8);

  // Prefer the email the API echoed back on an event; fall back to the
  // configured custom field, which the runtime passes through to transforms.
  let email = '';
  if (raw.email) {
    email = raw.email;
  } else if (raw.userEmail) {
    email = raw.userEmail;
  } else if (events[0] && events[0].userEmail) {
    email = events[0].userEmail;
  } else {
    email = memberEmail(root);
  }

  let name = displayName(email);
  if (raw.name) {
    name = raw.name;
  } else if (raw.userName) {
    name = raw.userName;
  }

  // More events exist than one page holds, so the totals under-report.
  let truncated = false;
  if (raw.pagination && raw.pagination.hasNextPage === true) {
    truncated = true;
  }

  return {
    IDX_0: {
      email,
      name,
      totalSpendCents,
      totalSpend: dollars(totalSpendCents),
      totalFastRequests,
      totalEvents: events.length,
      // Events for other people that came back despite the email filter. Should
      // always be 0; anything else means the request scoping failed.
      foreignEvents,
      truncated,
      models,
      message: raw.message,
      documentation_url: raw.documentation_url,
    },
  };
}
