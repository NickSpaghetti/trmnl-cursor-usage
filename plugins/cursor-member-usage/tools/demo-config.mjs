// Writes a .trmnlp.yml that feeds the demo fixture straight into the renderer,
// so `make screenshots` produces the README images without a Cursor API key.
//
// trmnlp deep-merges `variables` into the polled data before the transform
// runs, so putting the fixture's own keys there is the same as having polled
// them. YAML is a superset of JSON, so we emit JSON and skip the dependency.
//
// Runs with cwd = /plugin inside the trmnl/trmnlp container.

import { readFileSync, writeFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync('demo.json', 'utf8'));

const config = {
  watch: ['.trmnlp.yml', 'src'],
  custom_fields: {
    // No key needed: `variables` below supplies the data the poll would return.
    cursor_api_key: 'demo',
    cursor_member_email: fixture.usageEvents[0].userEmail,
    cursor_member_budget_dollars: 25,
  },
  variables: {
    name: fixture.name,
    totalUsageEventsCount: fixture.totalUsageEventsCount,
    pagination: fixture.pagination,
    usageEvents: fixture.usageEvents,
    trmnl: { plugin_settings: { instance_name: 'Cursor Member Usage' } },
  },
};

writeFileSync('.trmnlp.yml', JSON.stringify(config, null, 2));
console.log(`demo config: ${fixture.usageEvents.length} events for ${fixture.name}`);
