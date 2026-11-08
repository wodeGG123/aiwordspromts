// 前端唯一的“开始/继续/重开/章节入口”层。返回值须整体原子持久化。
// 纯函数不会替调用方保存状态，也不构成账号防作弊服务。
import * as R from './runtime.mjs';
import {assertCampaignSequence,buildChapterRecord,fallbackRecap} from './review.mjs';
const copy=x=>structuredClone(x);
const need=(ok,msg)=>{if(!ok)throw new Error(msg)};
function check(s,expectedRevision){
 need(s?.schema_version===3,'adventure存档版本非法');
 need(Number.isInteger(expectedRevision)&&expectedRevision===s.revision,'过期adventure.revision；必须读取当前存档');
 assertCampaignSequence(s.campaign);
 if(s.runtime){need(s.runtime.campaign_id===s.campaign.campaign_id&&s.runtime.campaign_revision===s.campaign.revision,'活动run不属于当前冒险');need(R.getChapter(s.runtime.chapter_id).index===s.campaign.chapter_results.length+1,'活动章游标错误');}
}
export function createAdventure(campaignId){return {schema_version:3,revision:0,campaign:R.newCampaign(campaignId),runtime:null,retired_campaign_ids:[],used_run_ids:[]}}
export function closeAdventureChapter(s,{expectedRevision,finaleOutput=null}={}){
 check(s,expectedRevision);const r=s.runtime;need(r&&['cleared','failed'].includes(r.run_status),'当前章未结束');
 need(!(r.reward_requests??[]).some(q=>q.status==='pending'),'章节关闭前先同步已有奖励回执；重开可另行保留未完成请求');
 const next=copy(s);next.campaign=r.run_status==='cleared'?R.promoteChapter(s.campaign,r,{finaleOutput}):R.failCampaign(s.campaign,r,{finaleOutput});
 next.runtime=null;next.revision++;return next;
}
export function continueAdventure(s,args={}){
 check(s,args.expectedRevision);need(!('chapterId' in args)&&!('chapter_id' in args),'继续入口不接受选章参数');need(!('mode' in args)||args.mode==='story','禁止replay');
 if(s.runtime?.run_status==='ongoing'){need(!args.runId||args.runId===s.runtime.run_id,'续玩只能恢复原run，不能新开本章');return copy(s)}
 let next=copy(s);if(next.runtime){need(next.runtime.run_status==='cleared','失败后只能从第一章重开');next=closeAdventureChapter(next,{expectedRevision:next.revision,finaleOutput:args.finaleOutput});}
 need(next.campaign.status==='ongoing','整次冒险已结束，不能继续');
 const chapter=R.chapters[next.campaign.chapter_results.length];need(chapter,'已经完成全部章节');
 need(typeof args.runId==='string'&&args.runId&&!next.used_run_ids.includes(args.runId),'每章必须使用从未使用的run_id');
 next.runtime=R.createChapterRun({...args,campaign:next.campaign,chapterId:chapter.id,mode:'story'});
 next.used_run_ids.push(args.runId);next.revision++;return next;
}
export function prepareAdventureMessages(s,operation,{expectedRevision}={}){
 check(s,expectedRevision);need(s.runtime,'没有活动章节');
 return {...R.prepareAiMessages(R.request(s.runtime,operation)),requestGuard:{session_revision:s.revision,campaign_id:s.campaign.campaign_id,run_id:s.runtime.run_id,state_version:s.runtime.state_version}};
}
export function updateAdventure(s,nextRuntime,{expectedRevision}={}){
 check(s,expectedRevision);const old=s.runtime;need(old,'没有活动run');
 need(nextRuntime.campaign_id===old.campaign_id&&nextRuntime.run_id===old.run_id&&nextRuntime.chapter_id===old.chapter_id,'旧冒险、旧章或旧run回包');
 need(nextRuntime.campaign_revision===old.campaign_revision,'跨章版本不符');
 need(nextRuntime.state_version>old.state_version,'重复或过期运行态，不允许回滚');
 need(nextRuntime.current_round>=old.current_round,'不得回退当前章轮数');
 if(old.run_status!=='ongoing')need(nextRuntime.run_status===old.run_status,'已结束run不能恢复进行中');
 need(nextRuntime.story_state.completed_events.length>=old.story_state.completed_events.length,'不得退回已完成事件');
 need(JSON.stringify(nextRuntime.story_state.completed_events.slice(0,old.story_state.completed_events.length))===JSON.stringify(old.story_state.completed_events),'不得改写已提交事件');
 const next=copy(s);next.runtime=copy(nextRuntime);next.revision++;return next;
}
export function restartAdventure(s,{campaignId,expectedRevision}={}){
 check(s,expectedRevision);need(typeof campaignId==='string'&&campaignId&&campaignId!==s.campaign.campaign_id&&!s.retired_campaign_ids.includes(campaignId),'重开必须使用全新campaign_id');
 const archive=copy(s.campaign);const r=s.runtime;
 if(r){archive.chapter_results.push(buildChapterRecord(r,{outcome:r.run_status==='failed'?'failed':r.run_status==='cleared'?'cleared':'abandoned'}));archive.npc_states=copy(r.story_state.npc_states);}
 archive.status=r?.run_status==='failed'||s.campaign.status==='failed'?'failed':s.campaign.status==='completed'||(r?.chapter_id==='CH08'&&r.run_status==='cleared')?'completed':'abandoned';
 archive.key_items=[];archive.read_only=true;
 const next=createAdventure(campaignId);next.revision=s.revision+1;
 next.retired_campaign_ids=[...s.retired_campaign_ids,s.campaign.campaign_id];next.used_run_ids=copy(s.used_run_ids);
 return {adventure:next,archive,pending_reward_requests:copy((r?.reward_requests??[]).filter(q=>q.status==='pending'))};
}
export function getAdventureView(s){
 check(s,s.revision);const records=s.campaign.chapter_results;const r=s.runtime;
 const terminal=s.campaign.status!=='ongoing'||r?.run_status==='failed'||(r?.chapter_id==='CH08'&&r.run_status==='cleared');
 const nextIndex=records.length;
 const chapterCards=R.chapters.map((c,i)=>{
  const record=records.find(x=>x.chapter_id===c.id);const active=r?.chapter_id===c.id;
  const available=!terminal&&((!r&&i===nextIndex)||(r?.run_status==='cleared'&&i===nextIndex+1));
  const state=record?(record.outcome==='cleared'?'cleared':'failed'):active?(r.run_status==='ongoing'?'in_progress':r.run_status==='cleared'?'cleared_pending_review':'failed'):available?'available':'locked';
  const facts=record?.review_facts??(active?R.chapterReviewFacts(r):null);
  return {chapter_id:c.id,name:c.name,state,lit:!!record||active||available,enterable:available||(active&&r.run_status==='ongoing'),reviewable:!!record||active,recap:record?.recap??(active?fallbackRecap(r):''),recap_source:record?.recap_source??(active?'fallback':null),critical_npcs:copy(facts?.npc_states.filter(n=>['dead','departed'].includes(n.state))??[])};
 });
 const canContinue=!terminal;
 return {campaign_id:s.campaign.campaign_id,status:r?.run_status==='failed'?'failed':s.campaign.status,actions:canContinue?['continue','restart']:['restart'],continue_kind:canContinue?(r?.run_status==='ongoing'?'resume':records.length===0&&!r?'start':'next_chapter'):null,chapter_cards:chapterCards};
}
