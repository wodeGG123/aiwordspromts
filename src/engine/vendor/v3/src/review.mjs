import {chapters,events,items} from './data.mjs';
const copy=x=>structuredClone(x);
const need=(ok,msg)=>{if(!ok)throw new Error(msg)};
export function assertCampaignSequence(campaign){
 need(campaign?.schema_version===3,'存档版本不支持；禁止把旧入口快照直接作为新冒险');
 need(['ongoing','failed','completed','abandoned'].includes(campaign.status),'campaign.status非法');
 need(Array.isArray(campaign.chapter_results)&&campaign.chapter_results.length<=8,'章节记录非法');
 campaign.chapter_results.forEach((r,i)=>{
  need(r.chapter_id===chapters[i].id,'章节记录必须从CH01连续排列');
  need(r.outcome==='cleared'||(i===campaign.chapter_results.length-1&&['failed','abandoned'].includes(r.outcome)&&campaign.status===r.outcome),'非通关记录只能在已结束冒险的末尾');
 });
 if(campaign.status==='ongoing')need(campaign.chapter_results.length<8,'八章完成后不能仍为ongoing');
 if(campaign.status==='completed')need(campaign.chapter_results.length===8&&campaign.chapter_results.every(x=>x.outcome==='cleared'),'completed必须八章全通关');
}
export function markRunFailed(r){
 if(r.run_status==='failed'&&!r.terminal_tools){r.terminal_tools=copy(r.current_package.tools);r.current_package.tools=[];}
 return r;
}
export function chapterReviewFacts(r){
 const c=chapters.find(c=>c.id===r.chapter_id);
 const entries=r.chapter_journal??[];
 const keyChoices=r.story_state.completed_events.filter(x=>{
  const e=events[x.event_id];return e.schedule.fixed||entries.some(j=>j.event_id===x.event_id&&(j.npc_updates.length||j.item_changes.length));
 }).map(x=>({event_id:x.event_id,title:events[x.event_id].title,choice:events[x.event_id].options.find(o=>o.id===x.option_id).text,outcome:x.outcome}));
 const npcChanges=entries.flatMap(j=>j.npc_updates.map(n=>({...n,event_id:j.event_id})));
 const itemChanges=entries.flatMap(j=>j.item_changes.map(t=>({...t,name:items.find(i=>i.id===t.id)?.name,event_id:j.event_id})));
 const carried=r.run_status==='cleared'&&c.index<8?r.current_package.tools.filter(t=>items.find(i=>i.id===t.id)?.carry_through_chapter>c.index):[];
 return {chapter_id:c.id,chapter_name:c.name,chapter_outcome:r.run_status,key_choices:keyChoices,npc_changes:npcChanges,npc_states:copy(r.story_state.npc_states),item_changes:itemChanges,remaining_tools:copy(r.current_package.tools),carry_to_next_chapter:copy(carried),lost_on_failure:copy(r.terminal_tools??[]),story_flags:copy(r.story_state.story_flags),unresolved_hooks:copy(r.story_state.unresolved_hooks)};
}
const outcomeNames={success:'成功',great_success:'大成功',failure:'未成功',victory:'战斗胜利',defeat:'战败',retreat:'撤退',resolved:'已执行'};
const npcNames={met:'已经相识',trusted:'建立了信任',cooperative:'愿意合作',neutral:'保持中立',wary:'仍有戒心',hostile:'转为敌对',dead:'已经死亡',departed:'已经离去'};
export function fallbackRecap(r){
 const f=chapterReviewFacts(r),last=f.key_choices.at(-1);
 const end=r.run_status==='cleared'?(r.chapter_id==='CH08'?'魔王危机的主线已经完成。':'这一章的目标已经完成，前路尚未走过。'):r.run_status==='failed'?'这次冒险在此止步，已不能继续前行。':'你们暂时停下，尚未完成这一章。';
 const decision=last?`在${last.title}，你们选择“${last.choice}”，结果是${outcomeNames[last.outcome]}。`:'这一章尚未留下已确认的关键选择。';
 const states=[...new Map(f.npc_changes.map(x=>[x.npc,x])).values()];
 const people=states.map(x=>`${x.npc}${npcNames[x.state]}。`).join('');
 const tools=f.remaining_tools.length?'手中仍有'+f.remaining_tools.map(x=>`${x.name}×${x.count}`).join('、')+'。':'';
 const spent=f.item_changes.filter(x=>x.count<0).map(x=>`${x.name}已消耗${-x.count}份。`).join('');
 const lost=f.lost_on_failure.length?'随这次冒险失去的物品包括'+f.lost_on_failure.map(x=>`${x.name}×${x.count}`).join('、')+'。':'';
 return `${f.chapter_name}。${end}${decision}${people}${spent}${tools}${lost}`;
}
export function buildChapterRecord(r,{finaleOutput=null,outcome=r.run_status}={}){
 need(['cleared','failed','abandoned'].includes(outcome),'章节归档状态非法');
 if(finaleOutput)need(finaleOutput.event_details?.template_name==='终章'&&typeof finaleOutput.event_details.content==='string'&&finaleOutput.event_details.content.trim().length>0,'回顾必须使用完整终章输出');
 const c=chapters.find(x=>x.id===r.chapter_id),facts=chapterReviewFacts(r);
 const text=outcome==='abandoned'?fallbackRecap(r).replace('你们暂时停下，尚未完成这一章。','你们选择结束这次冒险，这一章未完成。'):fallbackRecap(r);
 return {chapter_id:c.id,run_id:r.run_id,outcome,flags:r.story_state.story_flags.filter(f=>c.export_flags.includes(f)),recap:finaleOutput?.event_details.content??text,recap_source:finaleOutput?'ai':'fallback',review_facts:facts};
}
