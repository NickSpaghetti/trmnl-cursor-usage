'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runTransform, fixture } = require('./harness');

// Expected totals for fixtures/filtered-usage-events.json:
//
//   model              chargedCents        events   fast (requestsCosts)
//   claude-opus-4      196 + 182 = 378          2   0  (token-based)
//   gpt-5          88 + 71 + 76 = 235          3   0  (token-based)
//   claude-sonnet-4.5   47+52+41 = 140          3   1 + 2 + 1 = 4
//   gemini-2.5-pro       38 + 36 =  74          2   0  (token-based)
//   claude-haiku-4.5     26 + 24 =  50          2   1 + 1 = 2
//                                   ----                     ---
//                                    877                       6

test('aggregates a real Cursor response by model', () => {
  const out = runTransform(fixture()).IDX_0;

  assert.equal(out.totalSpendCents, 877);
  assert.equal(out.totalEvents, 12);
  assert.equal(out.truncated, false);
  assert.equal(out.models.length, 5);

  const opus = out.models.find((m) => m.name === 'claude-opus-4');
  assert.equal(opus.spendCents, 378);
  assert.equal(opus.requests, 2);
  assert.equal(opus.name, 'claude-opus-4');
});

test('pre-formats dollars to 2 decimals for the templates', () => {
  // Liquid's `round: 2` renders 140 cents as "1.4" and has no sprintf, so the
  // transform hands the templates finished strings.
  const out = runTransform(fixture()).IDX_0;

  assert.equal(out.totalSpend, '8.77');
  assert.equal(out.models.find((m) => m.name === 'claude-sonnet-4.5').spend, '1.40');
  assert.equal(out.models.find((m) => m.name === 'claude-haiku-4.5').spend, '0.50');
});

test('formats a zero total as 0.00', () => {
  assert.equal(runTransform({ usageEvents: [] }).IDX_0.totalSpend, '0.00');
});

test('reports model ids verbatim, keeping near-identical ones distinct', () => {
  // A previous version prettified these with a regex, collapsing all three
  // Opus ids to "Opus 4" and both Gemini ids to "Gemini 2.5" — distinct rows
  // with distinct spend rendered identically.
  const data = fixture();
  data.usageEvents = [
    { userEmail: 'a@b.com', model: 'claude-opus-4', chargedCents: 100, isTokenBasedCall: true },
    { userEmail: 'a@b.com', model: 'claude-opus-4-1-20250805', chargedCents: 200, isTokenBasedCall: true },
    { userEmail: 'a@b.com', model: 'claude-opus-4-5-thinking', chargedCents: 300, isTokenBasedCall: true },
    { userEmail: 'a@b.com', model: 'gemini-2.5-pro', chargedCents: 400, isTokenBasedCall: true },
    { userEmail: 'a@b.com', model: 'gemini-2.5-flash', chargedCents: 500, isTokenBasedCall: true },
  ];

  const out = runTransform(data).IDX_0;
  const names = out.models.map((m) => m.name);

  assert.equal(new Set(names).size, 5, `labels collided: ${names.join(', ')}`);
  assert.ok(names.includes('gemini-2.5-pro'));
  assert.ok(names.includes('gemini-2.5-flash'));
  assert.ok(names.includes('claude-opus-4-5-thinking'));
});

test('falls back to unknown for an event with no model', () => {
  const data = fixture();
  data.usageEvents = [{ userEmail: 'a@b.com', chargedCents: 42, isTokenBasedCall: true }];

  assert.equal(runTransform(data).IDX_0.models[0].name, 'unknown');
});

test('ranks models by spend, descending', () => {
  const out = runTransform(fixture()).IDX_0;

  assert.deepEqual(
    out.models.map((m) => m.name),
    ['claude-opus-4', 'gpt-5', 'claude-sonnet-4.5', 'gemini-2.5-pro', 'claude-haiku-4.5'],
  );
});

test('sharePct is each model share of total spend and sums to 100', () => {
  const out = runTransform(fixture()).IDX_0;

  const opus = out.models.find((m) => m.name === 'claude-opus-4');
  assert.ok(Math.abs(opus.sharePct - (378 / 877) * 100) < 1e-9);

  const total = out.models.reduce((sum, m) => sum + m.sharePct, 0);
  assert.ok(Math.abs(total - 100) < 1e-9, `expected ~100, got ${total}`);
});

test('counts fast requests from requestsCosts, skipping token-based calls', () => {
  // 4 from sonnet (one is max-mode, worth 2) + 2 from haiku. The token-based
  // gpt-5 / opus / gemini events bill on tokens and contribute nothing.
  assert.equal(runTransform(fixture()).IDX_0.totalFastRequests, 6);
});

test('prefers chargedCents over tokenUsage.totalCents', () => {
  // The discounted gpt-5 event: totalCents 84 pre-discount, chargedCents 76.
  const data = fixture();
  data.usageEvents = data.usageEvents.filter(
    (e) => e.tokenUsage && e.tokenUsage.discountPercentOff != null,
  );

  assert.equal(data.usageEvents.length, 1);
  assert.equal(runTransform(data).IDX_0.totalSpendCents, 76);
});

test('falls back to tokenUsage.totalCents when chargedCents is absent', () => {
  const data = fixture();
  data.usageEvents = [
    { model: 'gpt-5', isTokenBasedCall: true, tokenUsage: { totalCents: 123 } },
  ];

  assert.equal(runTransform(data).IDX_0.totalSpendCents, 123);
});

test('accepts a top-level response (single polling URL — the real case)', () => {
  // The runtime only wraps in IDX_0 when a plugin declares multiple polling
  // URLs. This one declares one, so the response arrives unwrapped.
  assert.equal(runTransform(fixture()).IDX_0.totalSpendCents, 877);
});

test('accepts an IDX_0-wrapped response (multi-URL parity)', () => {
  assert.equal(runTransform({ IDX_0: fixture() }).IDX_0.totalSpendCents, 877);
});

test('derives email and display name from the events', () => {
  const out = runTransform(fixture()).IDX_0;

  assert.equal(out.email, 'nick.spaghetti@example.com');
  assert.equal(out.name, 'Nick Spaghetti');
});

test('falls back to the configured member email when events are empty', () => {
  const out = runTransform({
    usageEvents: [],
    trmnl: {
      plugin_settings: {
        custom_fields_values: { cursor_member_email: 'ada.lovelace@example.com' },
      },
    },
  }).IDX_0;

  assert.equal(out.email, 'ada.lovelace@example.com');
  assert.equal(out.name, 'Ada Lovelace');
});

// The polling body asks Cursor for one member. These cover the client-side
// backstop for when that filter doesn't hold.

function withMember(data, email) {
  return {
    ...data,
    trmnl: { plugin_settings: { custom_fields_values: { cursor_member_email: email } } },
  };
}

test('drops events belonging to other people', () => {
  const data = fixture();
  data.usageEvents.push(
    { userEmail: 'someone.else@example.com', model: 'gpt-5', chargedCents: 5000, isTokenBasedCall: true },
    { userEmail: 'third.person@example.com', model: 'claude-opus-4', chargedCents: 9000, isTokenBasedCall: true },
  );

  const out = runTransform(withMember(data, 'nick.spaghetti@example.com')).IDX_0;

  // Unchanged from the unpolluted fixture: the $140 of foreign spend is excluded.
  assert.equal(out.totalSpendCents, 877);
  assert.equal(out.totalEvents, 12);
  assert.equal(out.foreignEvents, 2);
});

test('foreignEvents is 0 when the server-side filter held', () => {
  const out = runTransform(withMember(fixture(), 'nick.spaghetti@example.com')).IDX_0;

  assert.equal(out.foreignEvents, 0);
  assert.equal(out.totalSpendCents, 877);
});

test('matches the member email case-insensitively', () => {
  const out = runTransform(withMember(fixture(), 'Nick.Spaghetti@Example.com')).IDX_0;

  assert.equal(out.totalSpendCents, 877);
  assert.equal(out.foreignEvents, 0);
});

test('keeps every event when no member is configured', () => {
  // No custom field at all — don't blank the dashboard, just report what came back.
  const out = runTransform(fixture()).IDX_0;

  assert.equal(out.totalSpendCents, 877);
  assert.equal(out.foreignEvents, 0);
});

test('keeps every event when the response carries no userEmail', () => {
  // A schema change that drops userEmail must not silently zero the dashboard.
  const data = fixture();
  data.usageEvents = data.usageEvents.map(({ userEmail, ...rest }) => rest);

  const out = runTransform(withMember(data, 'nick.spaghetti@example.com')).IDX_0;

  assert.equal(out.totalSpendCents, 877);
  assert.equal(out.foreignEvents, 0);
});

test('reports zero rather than someone else’s spend on an email mismatch', () => {
  // Typo'd CURSOR_MEMBER_EMAIL. Showing $0.00 is correct; showing the team's
  // spend as "Personal AI Spend" would not be.
  const out = runTransform(withMember(fixture(), 'wrong.person@example.com')).IDX_0;

  assert.equal(out.totalSpendCents, 0);
  assert.deepEqual(out.models, []);
  assert.equal(out.foreignEvents, 12);
});

test('ignores an uninterpolated custom field', () => {
  // trmnlp hands transforms custom_fields_values verbatim, so with no env var
  // set locally this arrives as the literal Liquid tag. Rendering that as a
  // name puts "{{ env CURSOR MEMBER EMAIL }}" in the title bar.
  const out = runTransform({
    usageEvents: [],
    trmnl: {
      plugin_settings: {
        custom_fields_values: { cursor_member_email: '{{ env.CURSOR_MEMBER_EMAIL }}' },
      },
    },
  }).IDX_0;

  assert.equal(out.email, '');
  assert.equal(out.name, 'Member');
});

test('handles an empty billing period without dividing by zero', () => {
  const out = runTransform({ totalUsageEventsCount: 0, usageEvents: [] }).IDX_0;

  assert.equal(out.totalSpendCents, 0);
  assert.equal(out.totalFastRequests, 0);
  assert.equal(out.totalEvents, 0);
  assert.deepEqual(out.models, []);
  assert.equal(out.name, 'Member');
});

test('survives the empty object the poller returns on a failed request', () => {
  // Poller#parse_failure logs the body and hands the renderer {}.
  const out = runTransform({}).IDX_0;

  assert.equal(out.totalSpendCents, 0);
  assert.deepEqual(out.models, []);
});

test('flags a truncated result when more pages exist', () => {
  const data = fixture();
  data.pagination.hasNextPage = true;

  assert.equal(runTransform(data).IDX_0.truncated, true);
});

test('caps the model list at 8', () => {
  const data = fixture();
  data.usageEvents = Array.from({ length: 12 }, (_, i) => ({
    model: `model-${i}`,
    chargedCents: (i + 1) * 10,
    isTokenBasedCall: false,
    requestsCosts: 1,
  }));

  const out = runTransform(data).IDX_0;
  assert.equal(out.models.length, 8);
  // The 8 most expensive, still ranked descending.
  assert.equal(out.models[0].name, 'model-11');
  assert.equal(out.models[7].name, 'model-4');
});

test('always emits the IDX_0 key shared.liquid reads', () => {
  for (const input of [{}, fixture(), { usageEvents: [] }, { IDX_0: {} }]) {
    const out = runTransform(input);
    assert.ok(Object.hasOwn(out, 'IDX_0'));
    assert.ok(Array.isArray(out.IDX_0.models));
    assert.equal(typeof out.IDX_0.totalSpendCents, 'number');
    assert.equal(typeof out.IDX_0.totalFastRequests, 'number');
  }
});
