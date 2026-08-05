'use strict';

// Runs src/transform.js exactly the way the TRMNL serverless runtime does.
//
// transform.js exports nothing — it's wrapped by the runtime, which reads JSON
// on stdin, splices the user code in, then dispatches to whichever of
// run/transform/result the file happens to define. Reproducing that wrapper
// verbatim (rather than require()-ing the file) means these tests exercise the
// same dispatch path as `trmnlp serve`, including the "no exports" contract.
//
// Mirrors TRMNLP::TransformBackend::Wrapper.node.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TRANSFORM_PATH = path.join(__dirname, '..', 'src', 'transform.js');
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'filtered-usage-events.json');

function wrap(code) {
  return `
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

${code}

let output;
if (typeof run === "function") {
  output = run(input);
} else if (typeof transform === "function") {
  output = transform(input);
} else if (typeof result !== "undefined") {
  output = result;
} else {
  output = input;
}
process.stdout.write(JSON.stringify(output));
`;
}

// Feed `input` through the transform and return the parsed output.
function runTransform(input) {
  const code = fs.readFileSync(TRANSFORM_PATH, 'utf8');
  const stdout = execFileSync(process.execPath, ['-e', wrap(code)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

// A fresh copy each call, so a test mutating it can't leak into the next.
function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

module.exports = { runTransform, fixture };
