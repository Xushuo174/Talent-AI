// Uses the pinned n8n scheduler and native IF/Manual Trigger nodes.
// Code nodes use a local VM adapter instead of the n8n task-runner service.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const packages = path.join(root, 'upstream/n8n/packages');
const { Workflow, NodeHelpers } = require(path.join(packages, 'workflow'));
const { WorkflowExecute } = require(path.join(packages, 'core/dist/execution-engine/workflow-execute'));
const { ExecutionLifecycleHooks } = require(path.join(packages, 'core/dist/execution-engine/execution-lifecycle-hooks'));
const { If } = require(path.join(packages, 'nodes-base/dist/nodes/If/If.node'));
const { ManualTrigger } = require(path.join(packages, 'nodes-base/dist/nodes/ManualTrigger/ManualTrigger.node'));
const clone = x => JSON.parse(JSON.stringify(x));
const fixtures = require('../workflows/loop-engineering/fixtures.cjs');
const codeAdapter = {
  description: {displayName:'Code',name:'code',group:['transform'],version:2,description:'Local check adapter',defaults:{name:'Code'},inputs:['main'],outputs:['main'],properties:[
    {displayName:'Mode',name:'mode',type:'string',default:'runOnceForAllItems'},
    {displayName:'Code',name:'jsCode',type:'string',default:''},
  ]},
  async execute() {
    const proxy = this.getWorkflowDataProxy(0);
    const items = this.getInputData();
    const result = vm.runInNewContext('(function(){\n'+this.getNodeParameter('jsCode',0)+'\n})()', {
      $: proxy.$, $runIndex: proxy.$runIndex,
      $input:{first:()=>clone(items[0]),all:()=>clone(items)},
    }, {timeout:1000});
    return [clone(result)];
  },
};
async function main() {
  const types = {'n8n-nodes-base.code':codeAdapter,'n8n-nodes-base.if':new If(),'n8n-nodes-base.manualTrigger':new ManualTrigger()};
  const nodeTypes = {getByName:n=>types[n],getByNameAndVersion:(n,v)=>NodeHelpers.getVersionedNodeType(types[n],v),getKnownTypes:()=>({})};
  for (const [mode, expected, round, repair] of [['retry_then_pass','success',2],['always_fail','failed',3],['pass_first','success',1],['invalid_json','blocked',1],['missing_input','blocked',1],['pass_first','success',1,true],['always_fail','failed',3,true]]) {
    const spec=JSON.parse(fs.readFileSync(path.join(root,'workflows/loop-engineering',repair?'03C-review-and-repair.json':'03A-control-check.json'),'utf8'));
    spec.nodes=spec.nodes.filter(n=>n.type!=='n8n-nodes-base.stickyNote' && !n.type.includes('lmChat'));
    if (repair) {
      delete spec.connections['DeepSeek Chat Model'];
      for (const n of spec.nodes.filter(n=>n.type==='@n8n/n8n-nodes-langchain.agent')) {
        n.type='n8n-nodes-base.code';n.typeVersion=2;
        const text=n.name==='Writer Agent'
          ? Object.values(fixtures).map(f=>f.toString()).join('\n')+'\nreturn [{json:{output:fixtureWriter($input.first().json)}}];'
          : n.name.includes('Review') ? 'return [{json:{output:JSON.stringify({verdict:"pass",issues:[]})}}];'
          : 'return [{json:{output:"固定样本分析"}}];';
        n.parameters={mode:'runOnceForAllItems',jsCode:text};
      }
    }
    spec.nodes.find(n=>n.name==='Demo Input').parameters.jsCode=spec.nodes.find(n=>n.name==='Demo Input').parameters.jsCode.replace("const testMode = 'retry_then_pass'",`const testMode = '${mode}'`);
    const workflow=new Workflow({...spec,id:'local-loop-check',active:false,nodeTypes});
    const hooks=new ExecutionLifecycleHooks('manual','local-loop-check',spec);
    const additionalData={hooks,currentNodeExecutionIndex:0,executionId:'local-loop-check',
      executionTimeoutTimestamp:Date.now()+15000,
      webhookWaitingBaseUrl:'http://localhost:5678/webhook-waiting',formWaitingBaseUrl:'http://localhost:5678/form-waiting',
      credentialsHelper:{},variables:{},executeWorkflow:async()=>{throw new Error('Subworkflows are not used.');}};
    const result=await new WorkflowExecute(additionalData,'manual').run({workflow,startNode:workflow.getNode('Manual Trigger')});
    if(result.data.resultData.error) throw new Error(JSON.stringify(result.data.resultData.error));
    const data=result.data.resultData.runData;
    const end=data['End Success']??data['End Stop']??data['End Blocked Input'];
    assert.ok(end,'No terminal node reached');
    const state=end.at(-1).data.main[0][0].json;
    assert.equal(state.status,expected);assert.equal(state.round,round);
    if(mode!=='missing_input') {assert.equal(data['Requirement Agent'].length,1);assert.equal(data['Analysis Agent'].length,1);}
    if(repair) {
      assert.equal(data['Load User Draft'].length,1);
      assert.equal(state.historySummary[0].round,0);
      assert.ok(state.historySummary[0].issues.some(i=>i.id==='PASSWORD_BOUNDARY_21'));
      assert.equal(state.historySummary.length,round+1);
      assert.ok(data['Context Builder'][0].data.main[0][0].json.context.mustFix.some(i=>i.id==='PASSWORD_BOUNDARY_21'));
    }
    console.log(`n8n scheduler: ${repair?'03C ':''}${mode} => ${state.status}, round ${state.round}`);
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
