// Optional local Codex CLI evaluation. Reuses saved CLI login; no API key export.
// Synthetic data only. Not run by CI. Every attempt consumes account usage.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE_IDS, FIXTURE_SEED, buildFixture } from './fixtures.mjs';
import { score, usageCounters, summarize } from './metrics.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const activeChildren=new Set();
let cancelled=false;
function signalChild(child,signal) {try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch{}}
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
  cancelled=true;
  for(const child of activeChildren) signalChild(child,'SIGTERM');
  setTimeout(()=>{for(const child of activeChildren)signalChild(child,'SIGKILL');},3000).unref();
});
const hash=value=>createHash('sha256').update(value).digest('hex');
const arg=name=>{ const i=process.argv.indexOf(name); return i<0?null:process.argv[i+1]; };
const schema={type:'object',additionalProperties:false,properties:{answers:{type:'array',items:{type:'object',
  additionalProperties:false,properties:{field:{type:'string'},value:{type:['string','null']}},required:['field','value']}}},required:['answers']};
function sources() {
  const walk=dir=>readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
  return Object.fromEntries(['package.json','package-lock.json',...['adapters/mcp','mio-core/src','mio-core/migrations','experiments/accuracy-cost'].flatMap(walk)]
    .filter(p=>/\.(?:m?js|json|sql)$/.test(p)).sort().map(p=>[p,hash(readFileSync(join(root,p)))]));
}
function random(seed) { let state=seed>>>0; return ()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;}; }
const version=()=>spawnSync('codex',['--version'],{encoding:'utf8'}).stdout?.trim();
function makePlan(model) {
  const tasks=[];
  for(const caseId of CASE_IDS) for(const variant of [0,1]) {
    const fixture=buildFixture(caseId,variant);
    tasks.push({caseId,variant,prompt:fixture.task.prompt,expected:fixture.task.expected}); fixture.close();
  }
  const rng=random(20261114);
  const cases=[...CASE_IDS];for(let i=cases.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[cases[i],cases[j]]=[cases[j],cases[i]];}
  const schedule=[];
  // Reverse arm order between the two profiles within each template.
  for(const variant of [0,1]) for(const [index,caseId] of cases.entries()) {
    const arms=(index+variant)%2?['compact','legacy']:['legacy','compact'];
    for(const arm of arms) schedule.push({caseId,variant,arm});
  }
  return {schemaVersion:'mio.accuracy-cost-plan.v1',createdAt:new Date().toISOString(),model,reasoningEffort:'low',
    clientVersion:version(),nodeVersion:process.version,fixtureSeed:FIXTURE_SEED,sourceHashes:sources(),
    taskCountPerArm:tasks.length,concurrency:2,attemptTimeoutMs:120000,automaticRetries:0,tasks,schedule,outputSchema:schema,
    primaryMetrics:['exact task correctness with tool evidence','readable and unavailable field correctness',
      'tool calls per attempt','input / cached input / input-minus-cached / output tokens per attempt and per success'],
    limitations:['Exploratory synthetic self-evaluation, not independent real-user evidence.',
      'Both arms use identical fixed host policies. Only toolset/instructions differ.',
      'Two profiles per task template are not two new task types.',
      'Concurrent runs and provider caching make wall time descriptive only.',
      'CLI usage is not an invoice; hypothetical weights are not model prices.',
      'No retries and no removal of unsuccessful attempts.']};
}

async function attempt(plan,job,diagnostics) {
  const task=plan.tasks.find(t=>t.caseId===job.caseId&&t.variant===job.variant);
  const id=`${String(job.index).padStart(2,'0')}-${job.caseId}-${job.variant}-${job.arm}`;
  const workspace=join(diagnostics,id);mkdirSync(workspace,{mode:0o700});
  const schemaPath=join(workspace,'schema.json'),answerPath=join(workspace,'answer.json');
  // The expected answer never enters this directory or the model prompt.
  writeFileSync(schemaPath,JSON.stringify(plan.outputSchema),{mode:0o600});
  const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check',
    '--sandbox','read-only','--json','-C',workspace,'--model',plan.model,
    '--output-schema',schemaPath,'--output-last-message',answerPath,
    '-c','model_reasoning_effort="low"','-c','approval_policy="never"',
    '-c','features.apps=false','-c','features.plugins=false','-c','features.memories=false',
    '-c','features.shell_tool=false','-c','features.multi_agent=false','-c','features.skip_host_skill_discovery=true',
    '-c','web_search="disabled"',
    '-c',`mcp_servers.mio.command=${JSON.stringify(process.execPath)}`,
    '-c',`mcp_servers.mio.args=${JSON.stringify([join(root,'experiments/accuracy-cost/server.mjs'),'--case',job.caseId,'--variant',String(job.variant),'--arm',job.arm])}`,
    '-c','mcp_servers.mio.required=true','-c','mcp_servers.mio.startup_timeout_sec=30',task.prompt];
  let stdout='',stderr='',timedOut=false,overflow=false,spawnError=null;
  const start=performance.now();
  const child=spawn('codex',args,{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  activeChildren.add(child);
  let killTimer;
  const stop=()=>{signalChild(child,'SIGTERM');killTimer??=setTimeout(()=>signalChild(child,'SIGKILL'),3000);};
  const timer=setTimeout(()=>{timedOut=true;stop();},plan.attemptTimeoutMs);
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>16*1024*1024){overflow=true;stop();}});
  child.stderr.on('data',chunk=>{if(stderr.length<4*1024*1024)stderr+=chunk;});
  const exitCode=await new Promise(res=>{child.once('error',error=>{spawnError=error.code??'spawn_error';res(null);});child.once('close',code=>res(code));});
  clearTimeout(timer);
  clearTimeout(killTimer);activeChildren.delete(child);
  const elapsedMs=Math.round(performance.now()-start);
  writeFileSync(join(workspace,'events.jsonl'),stdout,{mode:0o600});
  writeFileSync(join(workspace,'stderr.txt'),stderr,{mode:0o600});
  const events=stdout.split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
  const tools=events.filter(e=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call').map(e=>({
    server:e.item.server,tool:e.item.tool,arguments:e.item.arguments,result:e.item.result,error:e.item.error}));
  let answer=null;try{if(existsSync(answerPath))answer=JSON.parse(readFileSync(answerPath,'utf8'));}catch{}
  const usage=events.findLast(e=>e.type==='turn.completed')?.usage??null;
  return {...job,elapsedMs,exitCode,timedOut,overflow,spawnError,answer,expected:task.expected,
    score:score(task.expected,answer,tools,exitCode),usage,counters:usageCounters(usage),tools};
}

async function main() {
  const planPath=arg('--run-plan');
  if(!planPath) {
    const model=arg('--model'),out=arg('--out');
    if(!model||!out) throw new Error('Use --model MODEL --out /new/directory --plan-only, then --run-plan /directory/plan.json');
    const directory=resolve(out);if(existsSync(directory))throw new Error('Output directory must be new');
    const plan=makePlan(model);mkdirSync(directory,{recursive:true,mode:0o700});
    writeFileSync(join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({plan:join(directory,'plan.json'),attempts:plan.schedule.length,networkRequests:0}));
    if(!process.argv.includes('--plan-only'))throw new Error('Review plan, then explicitly use --run-plan. No model run started.');
    return;
  }
  const full=resolve(planPath),directory=resolve(full,'..'),planText=readFileSync(full,'utf8'),plan=JSON.parse(planText);
  if(plan.schemaVersion!=='mio.accuracy-cost-plan.v1'||plan.concurrency!==2||plan.attemptTimeoutMs!==120000||plan.automaticRetries!==0)
    throw new Error('Unsupported or altered execution limits');
  if(plan.nodeVersion!==process.version)throw new Error('Node version changed since plan creation');
  if(JSON.stringify(plan.sourceHashes)!==JSON.stringify(sources()))throw new Error('Source changed after plan creation; generate a new plan before running');
  if(plan.clientVersion!==version())throw new Error('Codex CLI changed since plan creation');
  const rowsPath=join(directory,'attempts.jsonl');if(existsSync(rowsPath))throw new Error('Refusing to overwrite/retry an existing experiment');
  writeFileSync(rowsPath,'',{mode:0o600});
  const diagnostics=mkdtempSync(join(tmpdir(),'mio-cost-eval-'));
  const rows=[];let cursor=0;
  async function worker() {
    while(!cancelled && cursor<plan.schedule.length) {
      const index=cursor++; const row=await attempt(plan,{...plan.schedule[index],index},diagnostics);
      rows.push(row);appendFileSync(rowsPath,JSON.stringify(row)+'\n');
      console.log(JSON.stringify({completed:rows.length,total:plan.schedule.length,caseId:row.caseId,variant:row.variant,arm:row.arm,
        correct:row.score.taskCorrect,calls:row.score.toolCalls,usage:row.counters,elapsedMs:row.elapsedMs}));
    }
  }
  await Promise.all(Array.from({length:plan.concurrency},worker));
  rows.sort((a,b)=>a.index-b.index);
  const report={schemaVersion:'mio.accuracy-cost-result.v1',generatedAt:new Date().toISOString(),planSha256:hash(planText),
    model:plan.model,clientVersion:plan.clientVersion,reasoningEffort:plan.reasoningEffort,cancelled,plannedAttempts:plan.schedule.length,sourceHashesUnchanged:JSON.stringify(plan.sourceHashes)===JSON.stringify(sources()),
    summary:summarize(rows),attempts:rows};
  writeFileSync(join(directory,'results.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({complete:!cancelled,result:join(directory,'results.json'),diagnostics,summary:report.summary.arms}));
  if(!report.sourceHashesUnchanged||cancelled)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
