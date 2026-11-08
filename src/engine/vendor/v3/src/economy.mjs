import {chapters,events,items,rewardCatalog} from './data.mjs';
const copy=x=>structuredClone(x);
const requireValue=(ok,message)=>{if(!ok)throw new Error(message)};
export const SIGNALS={material:900050,relic:900060,bond:900061,equipment:900062};
export const SLOT_FIELDS={material:'material_reward_slots_remaining',relic:'relic_reward_slots_remaining',bond:'bond_reward_slots_remaining',equipment:'equipment_reward_slots_remaining'};
const natural=x=>Number.isSafeInteger(x)&&x>=0;
export function createRewardState({chapterId,cycleId,previous}){
 const c=chapters.find(c=>c.id===chapterId);requireValue(c,'未知章节');requireValue(typeof cycleId==='string'&&cycleId.length>0,'必须提供奖励周期，不能使用run_id');
 if(previous)requireValue(previous.chapter_id===chapterId&&previous.cycle_id!==cycleId,'已有周期账本不能被重新初始化');
 return {chapter_id:chapterId,cycle_id:cycleId,gold_gain_remaining:c.economy.gold_gain_cap,material_reward_slots_remaining:2,relic_reward_slots_remaining:1,bond_reward_slots_remaining:1,equipment_reward_slots_remaining:[4,8].includes(c.index)?1:0,claimed_reward_keys:copy(previous?.claimed_reward_keys.filter(k=>k.startsWith('lifetime:'))??[]),revealed_pending_rewards:copy(previous?.revealed_pending_rewards??[]),granted_permanent_rewards:copy(previous?.granted_permanent_rewards??[])};
}
export function validateEconomyState(r){
 requireValue(natural(r.gold)&&natural(r.diamond),'金币/钻石余额必须为非负安全整数');
 const s=r.reward_state;requireValue(s&&s.chapter_id===r.chapter_id&&typeof s.cycle_id==='string'&&s.cycle_id.length>0,'奖励账本缺失或章节不一致');
 for(const k of ['gold_gain_remaining',...Object.values(SLOT_FIELDS)])requireValue(natural(s[k]),'奖励额度非法：'+k);
 const c=chapters.find(c=>c.id===r.chapter_id);requireValue(s.gold_gain_remaining<=c.economy.gold_gain_cap,'金币额度超过章节配置');for(const [type,k]of Object.entries(SLOT_FIELDS))requireValue(s[k]<=c.economy[type+'_slots'],'资源额度超过章节配置');
 for(const k of ['claimed_reward_keys','revealed_pending_rewards','granted_permanent_rewards'])requireValue(Array.isArray(s[k]),'奖励账本数组缺失：'+k);
 requireValue(s.claimed_reward_keys.every(k=>typeof k==='string')&&new Set(s.claimed_reward_keys).size===s.claimed_reward_keys.length,'重复/非法领取键');
 for(const k of ['gold_policy','diamond_policy']){const p=r[k];requireValue(p&&typeof p.allow_gain==='boolean'&&typeof p.allow_cost==='boolean'&&natural(p.max_gain_per_event)&&natural(p.max_cost_per_event),'币种policy非法');}
}
export function optionAvailable(r,o){return o.requires_items.every(id=>r.current_package.tools.some(t=>t.id===id&&t.count>0))&&(!(o.requires_gold>0)||(r.gold_policy.allow_cost&&o.requires_gold<=r.gold_policy.max_cost_per_event&&r.gold>=o.requires_gold));}
export function rewardKey(r,e,g){return `${g.claim_scope==='lifetime'?'lifetime':r.reward_state.cycle_id}:${r.chapter_id}:${g.claim_scope==='lifetime'?'chapter':e.event_id}:${g.type}`;}
export function goldKey(r,e){return `${r.reward_state.cycle_id}:${r.chapter_id}:${e.event_id}:gold`;}
export function validateGrant(g){
 requireValue(Object.hasOwn(SIGNALS,g.type),'未知永久资源类别');const asset=rewardCatalog[g.type]?.[g.id];
 requireValue(asset&&asset.name===g.name,'永久资源ID/名称不匹配');requireValue(g.count===1,'本版永久资源每项数量只能为1');
 requireValue(['cycle','lifetime'].includes(g.claim_scope),'未声明奖励幂等范围');
 if(g.type==='relic')requireValue(asset.event_eligible===true&&asset.tier===1&&g.level===1,'事件只能奖励一级类型且Lv.1的圣物');
 else requireValue(!Object.hasOwn(g,'level'),'非圣物不得伪造升级等级');
 return asset;
}
export function effectFor(r,eventId,optionId,outcome){
 validateEconomyState(r);const e=events[eventId],o=e?.options.find(o=>o.id===optionId);requireValue(o?.results[outcome],'结果未授权');requireValue(optionAvailable(r,o),'当前道具或金币不足');
 const fx=copy(o.results[outcome]);fx.permanent_rewards??=[];
 const rawGold=fx.resources.gold??0;requireValue(Number.isSafeInteger(rawGold),'金币增量必须为整数');
 if(rawGold>0)fx.resources.gold=r.gold_policy.allow_gain&&!r.reward_state.claimed_reward_keys.includes(goldKey(r,e))?Math.min(rawGold,r.gold_policy.max_gain_per_event,r.reward_state.gold_gain_remaining):0;
 if(rawGold<0){requireValue(!(o.requires_gold>0)||r.gold>=-rawGold,'交易余额不足');fx.resources.gold=r.gold_policy.allow_cost?-Math.min(-rawGold,r.gold_policy.max_cost_per_event,r.gold):0;if(o.requires_gold>0)requireValue(fx.resources.gold===rawGold,'交易金额不能打折');}
 requireValue(!fx.resources.diamond,'本版没有钻石变更授权');
 const hard=r.supply_value+(fx.resources.supply??0)<=0||r.corruption_value+(fx.resources.corruption??0)>=100||r.team_status==='defeated';
 if(hard||fx.finish==='failed'){if(fx.resources.gold>0)fx.resources.gold=0;fx.permanent_rewards=[];}
 const counts={};fx.permanent_rewards=fx.permanent_rewards.filter(g=>{validateGrant(g);const field=SLOT_FIELDS[g.type];const allowed=!r.reward_state.claimed_reward_keys.includes(rewardKey(r,e,g))&&(counts[g.type]??0)<r.reward_state[field];if(allowed)counts[g.type]=(counts[g.type]??0)+1;return allowed;});
 fx.items=fx.items.filter(x=>items.find(t=>t.id===x.id)?.kind!=='reward_signal');
 for(const g of fx.permanent_rewards)fx.items.push({id:SIGNALS[g.type],count:1});
 fx.resources=Object.fromEntries(Object.entries(fx.resources).filter(([,v])=>v!==0));
 return {event:e,option:o,effect:fx};
}
export function reserveEconomy(r,e,fx,requestId){
 const gold=fx.resources.gold??0;r.gold+=gold;requireValue(natural(r.gold),'金币余额越界');
 if(gold>0){r.reward_state.gold_gain_remaining-=gold;r.reward_state.claimed_reward_keys.push(goldKey(r,e));}
 for(const g of fx.permanent_rewards){const claimKey=rewardKey(r,e,g);requireValue(!r.reward_state.claimed_reward_keys.includes(claimKey),'奖励重复预留');r.reward_state[SLOT_FIELDS[g.type]]--;r.reward_state.claimed_reward_keys.push(claimKey);r.reward_requests??=[];r.reward_requests.push({id:SIGNALS[g.type],count:1,request_id:requestId,event_id:e.event_id,claim_key:claimKey,status:'pending',reward:copy(g)});}
}
export function confirmPermanentReward(runtime,{claim_key,status,reward}){
 const r=copy(runtime);requireValue(['granted','pending','rejected'].includes(status),'奖励回执状态非法');const q=r.reward_requests?.find(x=>x.claim_key===claim_key);requireValue(q,'没有对应的奖励预留');
 if(q.status==='granted'){requireValue(status==='granted'&&JSON.stringify(reward)===JSON.stringify(q.reward),'已确认奖励不可更改');return r;}
 if(status==='granted'){validateGrant(reward);requireValue(JSON.stringify(reward)===JSON.stringify(q.reward),'奖励回执与锁定资源不一致');const entry={type:reward.type,id:reward.id,name:reward.name,count:reward.count,...(reward.type==='relic'?{level:1}:{}),claim_key};r.reward_state.granted_permanent_rewards.push(entry);r.reward_state.revealed_pending_rewards=r.reward_state.revealed_pending_rewards.filter(x=>x.claim_key!==claim_key);if(reward.type==='relic'&&!r.current_package.relics.some(x=>x.id===reward.id))r.current_package.relics.push({id:reward.id,name:reward.name});}
 q.status=status;r.state_version++;return r;
}
export function economicPreview(r,e){return e.options.map(o=>({option_id:o.id,available:optionAvailable(r,o),results:optionAvailable(r,o)?Object.fromEntries(Object.keys(o.results).map(outcome=>[outcome,effectFor(r,e.event_id,o.id,outcome).effect])):{}}));}
