import test from 'node:test';
import assert from 'node:assert/strict';
import {score,usageCounters,summarize} from '../experiments/accuracy-cost/metrics.mjs';
const expected={name:'Fictional',missing:null};
const tools=[{tool:'mio_context',result:{structured_content:{fields:{name:'Fictional'},unavailable:['missing']}}}];
test('scoring rejects all-null, duplicate, guessed-without-read and leaked answers',()=>{
  const good={answers:[{field:'name',value:'Fictional'},{field:'missing',value:null}]};
  assert.equal(score(expected,good,tools,0).taskCorrect,true);
  assert.equal(score(expected,good,[],0).taskCorrect,false);
  assert.equal(score(expected,good,[{tool:'mio_read',result:{structured_content:{fields:{name:'Fictional'}}}}],0).taskCorrect,false);
  assert.equal(score(expected,{answers:[...good.answers].reverse()},tools,0).taskCorrect,false);
  assert.equal(score(expected,{answers:[{field:'name',value:null},{field:'missing',value:null}]},tools,0).taskCorrect,false);
  assert.equal(score(expected,{answers:[{field:'name',value:'Fictional'},{field:'name',value:'Fictional'}]},tools,0).taskCorrect,false);
  const leaked=[...tools,{tool:'mio_read',result:{structured_content:{fields:{missing:'SECRET_SENTINEL'}}}}];
  assert.equal(score(expected,good,leaked,0).unexpectedToolValues,1);
  assert.equal(score(expected,good,leaked,0).taskCorrect,false);
  assert.equal(score(expected,good,tools,1).taskCorrect,false);
});
test('usage validates subset counters and does not double count reasoning',()=>{
  assert.equal(usageCounters({input_tokens:10,cached_input_tokens:11,output_tokens:1}),null);
  const usage=usageCounters({input_tokens:100,cached_input_tokens:70,output_tokens:20,reasoning_output_tokens:5});
  assert.equal(usage.uncachedInput,30); assert.equal(usage.output,20);
});
test('failed attempts stay in resource totals and cost per success denominator',()=>{
  const good=score(expected,{answers:[{field:'name',value:'Fictional'},{field:'missing',value:null}]},tools,0);
  const counters=usageCounters({input_tokens:100,cached_input_tokens:70,output_tokens:20});
  const result=summarize([{arm:'legacy',caseId:'a',score:good,counters,elapsedMs:1},
    {arm:'legacy',caseId:'a',score:{...good,taskCorrect:false},counters,elapsedMs:1},
    {arm:'compact',caseId:'a',score:good,counters,elapsedMs:1}]);
  assert.equal(result.arms.legacy.tokenTotals.input,200);
  assert.equal(result.arms.legacy.tokensPerSuccessfulTask.input,200);
  assert.equal(result.arms.legacy.taskAccuracy,0.5);
  assert.equal(result.sensitivity.length,0,'unknown cache-write counters must not be assumed zero');
});
