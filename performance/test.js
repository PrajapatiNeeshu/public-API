/**
 * Simple K6 GET API performance test
 * ENV_NAME = staging | prod
 * SCENARIO = smoke | baseline | load | stress | spike | soak
 */
import exec from 'k6/execution';
import { callGet, makeReport, scenarioOptions } from './helpers.js';

const scenario = (__ENV.SCENARIO || 'smoke').toLowerCase();
const apis = JSON.parse(open('./apis.json'));

export const options = scenarioOptions(scenario);
export const handleSummary = makeReport(`pli-${__ENV.ENV_NAME || 'staging'}-${scenario}`);

export default function () {
  // For "once": use absolute iteration index so each API is called exactly once.
  // For other scenarios: round-robin across the collection.
  const i =
    (__ENV.SCENARIO || '').toLowerCase() === 'once'
      ? exec.scenario.iterationInTest % apis.length
      : (exec.vu.idInTest + exec.vu.iterationInScenario) % apis.length;
  const api = apis[i];
  callGet(api.path, api.service);
}
