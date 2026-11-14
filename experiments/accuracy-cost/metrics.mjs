// Exact task scoring and resource accounting. No model-based judge or API prices.
export function toolData(tool) {
  if (tool.result?.structured_content) return tool.result.structured_content;
  try { return JSON.parse(tool.result?.content?.find(c => c.type === 'text')?.text); } catch { return null; }
}

export function score(expected, answer, tools, exitCode) {
  const entries = Array.isArray(answer?.answers) ? answer.answers : [];
  const shape = answer && Object.keys(answer).length === 1 && entries.length === Object.keys(expected).length
    && new Set(entries.map(x => x?.field)).size === entries.length
    && entries.every((x,i) => x && Object.keys(x).length === 2 && x.field === Object.keys(expected)[i]
      && (x.value === null || typeof x.value === 'string'));
  const received = Object.fromEntries(entries.filter(x => x?.field).map(x => [x.field, x.value]));
  const values = tools.map(toolData).flatMap(x => x?.fields && !Array.isArray(x.fields) ? Object.entries(x.fields) : []);
  const unavailableEvidence = field => tools.some(tool => {
    const data=toolData(tool);
    if (Array.isArray(data?.unavailable) && data.unavailable.includes(field)) return true;
    if (Array.isArray(data?.fields) && !data.fields.includes(field)) return true;
    const denied=tool.result?.content?.some(c=>c.type==='text' && c.text.startsWith('Mio operation denied or unavailable.'));
    if (!denied) return false;
    return tool.arguments?.fields?.includes(field)
      || tool.tool==='mio_list_fields' || (tool.tool==='mio_context' && tool.arguments?.fields===undefined);
  });
  let readableCorrect = 0, readableTotal = 0, unavailableCorrect = 0, unavailableTotal = 0, unsupportedValues = 0;
  for (const [field, value] of Object.entries(expected)) {
    if (value === null) { unavailableTotal++; if (Object.hasOwn(received, field) && received[field] === null && unavailableEvidence(field)) unavailableCorrect++; }
    else { readableTotal++; if (received[field] === value && values.some(([k,v]) => k === field && v === value)) readableCorrect++; }
    if (received[field] !== undefined && received[field] !== null && received[field] !== value) unsupportedValues++;
  }
  const unexpectedToolValues = values.filter(([field]) => Object.hasOwn(expected, field) && expected[field] === null).length;
  const extraToolValues = values.filter(([field]) => !Object.hasOwn(expected, field)).length;
  const mutationCalls = tools.filter(t => t.tool === 'mio_propose_update').length;
  return { taskCorrect: Boolean(exitCode === 0 && shape && tools.length > 0 && readableCorrect === readableTotal
      && unavailableCorrect === unavailableTotal && unexpectedToolValues === 0 && mutationCalls === 0),
    readableCorrect, readableTotal, unavailableCorrect, unavailableTotal, unsupportedValues,
    unexpectedToolValues, extraToolValues, mutationCalls, toolCalls: tools.length };
}

export function usageCounters(usage) {
  if (!usage || !['input_tokens','cached_input_tokens','output_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)
      || usage.cached_input_tokens > usage.input_tokens) return null;
  return { input: usage.input_tokens, cachedInput: usage.cached_input_tokens,
    uncachedInput: usage.input_tokens - usage.cached_input_tokens, output: usage.output_tokens,
    cacheWriteInput: usage.cache_write_input_tokens ?? null, reasoningOutput: usage.reasoning_output_tokens ?? null };
}

function aggregate(rows) {
  const successful = rows.filter(r => r.score.taskCorrect).length;
  const totals = Object.fromEntries(['readableCorrect','readableTotal','unavailableCorrect','unavailableTotal',
    'unsupportedValues','unexpectedToolValues','extraToolValues','mutationCalls','toolCalls']
    .map(k => [k, rows.reduce((s,r) => s+r.score[k],0)]));
  const usageComplete = rows.every(r => r.counters !== null);
  const tokenTotals = usageComplete ? Object.fromEntries(['input','cachedInput','uncachedInput','output']
    .map(k => [k, rows.reduce((s,r) => s+r.counters[k],0)])) : null;
  return { attempts: rows.length, successful, taskAccuracy: rows.length ? successful/rows.length : null,
    ...totals, usageComplete, tokenTotals,
    tokensPerSuccessfulTask: tokenTotals && successful ? Object.fromEntries(Object.entries(tokenTotals).map(([k,v]) => [k,v/successful])) : null,
    elapsedMsTotal: rows.reduce((s,r) => s+r.elapsedMs,0) };
}

export function summarize(rows) {
  const arms = Object.fromEntries(['legacy','compact'].map(arm => [arm,aggregate(rows.filter(r => r.arm === arm))]));
  const reduction = (a,b) => a > 0 ? (a-b)/a : null;
  const resourceReduction = { toolCalls: reduction(arms.legacy.toolCalls,arms.compact.toolCalls) };
  if (arms.legacy.tokenTotals && arms.compact.tokenTotals) for (const key of ['input','cachedInput','uncachedInput','output']) {
    resourceReduction[key] = reduction(arms.legacy.tokenTotals[key],arms.compact.tokenTotals[key]);
  }
  const sensitivity = [];
  if (arms.legacy.tokenTotals && arms.compact.tokenTotals && rows.every(r => r.counters.cacheWriteInput === 0)) {
    for (const cachedWeight of [0,0.1,0.5,1]) for (const outputWeight of [1,3,5,10]) {
      const units = arm => { const t=arms[arm].tokenTotals; return t.uncachedInput+cachedWeight*t.cachedInput+outputWeight*t.output; };
      sensitivity.push({cachedWeight,outputWeight,legacyUnits:units('legacy'),compactUnits:units('compact'),
        reduction:reduction(units('legacy'),units('compact'))});
    }
  }
  const cases = [...new Set(rows.map(r => r.caseId))].map(caseId => ({caseId,
    legacy:aggregate(rows.filter(r => r.caseId===caseId && r.arm==='legacy')),
    compact:aggregate(rows.filter(r => r.caseId===caseId && r.arm==='compact'))}));
  return { arms, resourceReduction, cases, sensitivity,
    scope: 'Exploratory paired interface comparison on synthetic tasks; two profiles per template are not independent users. No invoice or price claim.',
    sensitivityNote: 'Hypothetical weights only: uncached input + cachedWeight*cached input + outputWeight*output. Not model prices or actual Codex subscription cost. Reasoning tokens are not added again.' };
}
