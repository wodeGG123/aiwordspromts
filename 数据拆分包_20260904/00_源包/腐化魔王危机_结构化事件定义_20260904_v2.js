// 本文件由一次性迁移脚本生成；生产运行不得扫描事件正文推断调度或资产关系。
export const eventDefinitionSchemaVersion = "dungeon-event-yaml-v1";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const eventDefinitionsSource = {
  "M01": {
    "event_id": "M01",
    "event_type": "main",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 1,
      "round_max": 1,
      "fixed": true,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000129",
            "name": "村长艾德"
          },
          {
            "role_id": "200000130",
            "name": "史莱姆"
          }
        ],
        "possible": [
          {
            "role_id": "290000011",
            "name": "重甲守卫"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 1
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_village",
            "name": "艾德村庄"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##M01 边境求援\n###阶段与轮数：P1，第1轮固定。场景：scene_village / 艾德村庄。叙事NPC：村长艾德。战斗敌人：史莱姆200000130×4。failure_tier=T1。\n###表面目标与转折：表面是史莱姆抢粮；证据是它们避开近处活人、反复撞击旧井图。转折为“袭击其实在搜寻或标记某物”，幕后力量把村庄当作通往森林的路标。\n###选项1：迎着黏液潮挡在村民身前；resolution_type=battle。victory：combat+1、猎人信任900020×1、材料奖励触发标记900050×1、M01_COMBAT、M01_CLUE_DAMAGED；村民获救但黑纹证据被战斗破坏。defeat：corruption+5、M01_VILLAGE_BREACHED、村长艾德=wary，无成功奖励，主线继续。retreat：supply-5、M01_VILLAGE_BREACHED、村长艾德=wary，无成功奖励，主线继续。\n###选项2：推倒旧货车封住狭巷；resolution_type=check；standard_fixed intelligence难度12。success：scheme+1、粘液核心900004×1、猎人信任900020×1、M01_SCHEME、村长艾德=trusted。great_success：在成功基础上免除后续一次追踪腐化痕迹的情境劣势，并加入M01_WELL_MAP_INTACT。failure：supply-5、M01_FAILED_CLUE、村长艾德=neutral，主线继续。\n###选项3：俯身观察黏液中的黑纹；resolution_type=check；hidden_attribute perception难度13。success：cleanse+1、corruption-5、猎人信任900020×1、M01_CLEANSE、M01_CORRUPTION_SIGNATURE。great_success：先按隐藏计划规则选择并写入PLAN，再加入与其中一个PLAN相符的合法HINT，不能额外发永久奖励。failure：corruption+5、M01_MARK_TOUCHED，主线继续。\n###链条回收：M02必须引用旧井图、黑纹或村庄受损状态之一；M01_CLUE_DAMAGED使M02追踪不能获得“证据完整”优势，M01_WELL_MAP_INTACT或M01_CORRUPTION_SIGNATURE则提供一次可见帮助。"
  },
  "M02": {
    "event_id": "M02",
    "event_type": "main",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 4,
      "round_max": 4,
      "fixed": true,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000131",
            "name": "猎人马克"
          }
        ],
        "possible": [
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000224",
            "name": "巨熊"
          },
          {
            "role_id": "200000226",
            "name": "狂狼"
          },
          {
            "role_id": "200000227",
            "name": "林地步兵"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          },
          {
            "scene_id": "scene_swamp",
            "name": "幽灵沼泽"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##M02 森林入口\n###阶段与轮数：P1，第4轮固定。场景：scene_forest / 幽暗森林。叙事NPC：猎人马克。failure_tier=T1。\n###表面目标与转折：表面是沿猎人留下的安全路进入森林；证据是路标切口方向正确却沾着沼泽尸蜡。转折为“有人复制了马克的标记，把追兵和猎物同时引向幽灵沼泽”。\n###选项1：沿着兽径追上骚动的影子；resolution_type=battle；敌人从当前场景合法角色中选择。victory：combat+1、supply+4、M02_FORCED_PATH、M02_FALSE_SIGNS_TRAMPLED；救下猎人但踩乱伪造路标，不发材料。defeat：supply-6、M02_HUNTER_INJURED、猎人马克=wary，无成功奖励，主线继续。retreat：supply-4、corruption+3、M02_PREY_ESCAPED，无成功奖励，主线继续。\n###选项2：循着腐化痕迹深入林中；resolution_type=check；standard_fixed survival难度15；猎人信任900020、粘液核心900004、M01_WELL_MAP_INTACT、P1_SCOUT_SAVED、P1_BRIDGE_RESCUE、P1_SLIME_SAMPLED或10002橡木护符各可提供有依据的优势但总加值仍受上限。success：scheme+1、M02_FOUND_GHOST_TRAIL、猎人马克=cooperative。great_success：再加入M02_IDENTIFIED_FORGER，后续M03或M04一次相关检定获得优势。failure：supply-5、M02_LOST_TIME，主线继续。\n###选项3：绕道教堂准备净化之物；resolution_type=direct；visible条件为尚未拥有圣水900001。结算：cleanse+1、圣水900001×1、supply-2、M02_CHURCH_PREP、HINT_H06；猎人马克=neutral。教堂钟绳被人割断，提示腐化势力也在封锁净化路线。\n###链条回收：M03必须让伪造路标、猎人伤势、被踩乱的证据或教堂准备之一改变叙事与至少一个检定依据。"
  },
  "M03": {
    "event_id": "M03",
    "event_type": "main",
    "schedule": {
      "phases": [
        "P2"
      ],
      "round_min": 8,
      "round_max": 8,
      "fixed": true,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000132",
            "name": "幽灵莉娜"
          }
        ],
        "possible": [
          {
            "role_id": "200000133",
            "name": "普通幽灵"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000241",
            "name": "亡灵守卫"
          },
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          },
          {
            "role_id": "300000006",
            "name": "哀嚎女妖"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_swamp",
            "name": "幽灵沼泽"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##M03 莉娜的残响\n###阶段与轮数：P2，第8轮固定。场景：scene_swamp / 幽灵沼泽。叙事NPC：幽灵莉娜。战斗敌人：幽灵莉娜200000132×1、普通幽灵200000133×3。failure_tier=T2。\n###表面目标与转折：表面是亡魂围猎；证据是莉娜每次尖啸都在重复同一句未说完的警告。转折为“她既是攻击者也是被魔王反复重放的记忆容器”，消灭她可以快速脱困，却会永久毁掉部分证词。\n###选项1：在尖啸合围前拔出武器；resolution_type=battle。victory：combat+1、时序碎片900006×1、材料奖励触发标记900050×1、M03_COMBAT、M03_MEMORY_SHATTERED；幽灵莉娜=departed，后续不得获得莉娜记忆900022。defeat：corruption+8、M03_LINA_LOST、幽灵莉娜=departed，无成功奖励，主线继续但M05圣路更难。retreat：supply-5、corruption+5、M03_GHOST_TIDE_STRENGTHENED，无成功奖励，主线继续。\n###选项2：拼合莉娜破碎的记忆；resolution_type=check；standard_fixed social难度17；scheme≥2、M02_FOUND_GHOST_TRAIL、M02_IDENTIFIED_FORGER或P2_ECHO_CLUE为优势。success：scheme+1、莉娜记忆900022×1、时序碎片900006×1、M03_MEMORY、幽灵莉娜=cooperative。great_success：再corruption-5并加入M03_TRUE_WARNING。failure：corruption+8、M03_MEMORY_DISTORTED、幽灵莉娜=wary，无道具奖励，主线继续。\n###选项3：让圣水流过她的伤痕；resolution_type=check；hidden_context难度20；available条件为拥有圣水900001或cleanse≥2。success：cleanse+1、莉娜记忆900022×1、时序碎片900006×1、M03_CLEANSED；若依靠圣水则消耗900001×1；幽灵莉娜=trusted。great_success：保留本应消耗的圣水并加入M03_LINA_BLESSING。failure：若使用圣水仍消耗900001×1，corruption+5、M03_CLEANSING_BACKLASH，幽灵莉娜=departed，无道具奖励，主线继续。\n###链条回收：M04必须使用完整证词、扭曲记忆或记忆已毁之一解释运输线真相；M03_TRUE_WARNING或M03_LINA_BLESSING在M05/M06提供一次明确优势，M03_MEMORY_SHATTERED或M03_LINA_LOST关闭对应的圣路便利。"
  },
  "M04": {
    "event_id": "M04",
    "event_type": "main",
    "schedule": {
      "phases": [
        "P3"
      ],
      "round_min": 12,
      "round_max": 12,
      "fixed": true,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000134",
            "name": "镇长汤姆"
          }
        ],
        "possible": [
          {
            "role_id": "200000135",
            "name": "黑暗商人"
          },
          {
            "role_id": "200000136",
            "name": "强盗头领"
          },
          {
            "role_id": "200000137",
            "name": "普通强盗"
          },
          {
            "role_id": "200000113",
            "name": "地精工头"
          },
          {
            "role_id": "200000114",
            "name": "地精拳击手"
          },
          {
            "role_id": "200000115",
            "name": "火箭筒地精"
          },
          {
            "role_id": "200000116",
            "name": "维修地精"
          },
          {
            "role_id": "200000206",
            "name": "暗影窃贼"
          },
          {
            "role_id": "200000246",
            "name": "银月刺客"
          },
          {
            "role_id": "200000249",
            "name": "优雅毒师"
          },
          {
            "role_id": "200000163",
            "name": "商人格雷厄姆"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_rivertown",
            "name": "河畔镇"
          },
          {
            "scene_id": "scene_black_market",
            "name": "黑市"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##M04 河畔镇阴谋\n###阶段与轮数：P3，第12轮固定。场景：scene_rivertown / 河畔镇。叙事NPC：镇长汤姆、黑暗商人。战斗敌人：强盗头领200000136×1、普通强盗200000137×3。failure_tier=T2。\n###表面目标与转折：表面是揭发镇长勾结强盗；证据是账本上的运货日期早于镇长上任。转折为“镇长是受胁迫的中转者，真正掌握城门与腐化货运的是黑暗商人”；公开开战能救人，却会给商人焚毁证据的时间。\n###选项1：把染血账本摔在镇长面前；resolution_type=battle。victory：combat+1、supply+6、M04_PUBLIC_ROUTE、M04_LEDGER_BURNED；镇长汤姆=cooperative、黑暗商人=hostile；不发材料，M05获得正门支援但M06谋略证据较弱。defeat：supply-6、corruption+8、M04_OUTLAWED；镇长汤姆=wary、黑暗商人=hostile，无成功奖励，主线继续。retreat：supply-5、M04_LEDGER_BURNED、M04_MERCHANT_ESCAPED，无成功奖励，主线继续。\n###选项2：趁夜潜入封锁的账房；resolution_type=check；standard_fixed deception难度18；拥有黑市账页900021时auto_success=true且仍输出一次检定“成功”，不掷点；否则粘液核心900004、M03_TRUE_WARNING、H01_WASTE_ROUTE_FOUND、H02_INTEL、P3_PLAGUE_EVIDENCE、P3_WITNESS或scheme≥3各可提供有依据的优势。success：scheme+1；没有900021时获得黑市账页900021×1；加入M04_EVIDENCE；镇长汤姆=neutral、黑暗商人=wary。great_success：再加入M04_GATE_CIPHER，使M05进入路线免除一次资源代价或使M06谋略检定获得优势。failure：corruption+8、M04_EXPOSED；黑暗商人=hostile，无道具奖励，主线继续。\n###选项3：接过商人递来的黑色印记；resolution_type=direct；visible条件corruption≥30。结算：魔王印记900002×1、corruption+10、scheme+1、M04_DARK_DEAL、M04_MERCHANT_CLAIM；黑暗商人=cooperative。印记可快速进入城堡，但M05必须展示其开始反噬或索取代价。\n###链条回收：M05必须让M04_PUBLIC_ROUTE、M04_EVIDENCE、M04_GATE_CIPHER、M04_DARK_DEAL、M04_OUTLAWED或M04_LEDGER_BURNED至少一项实际改变入口、代价或NPC反应。"
  },
  "M05": {
    "event_id": "M05",
    "event_type": "main",
    "schedule": {
      "phases": [
        "P4"
      ],
      "round_min": 17,
      "round_max": 17,
      "fixed": true,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000138",
            "name": "城堡守卫"
          }
        ],
        "possible": [
          {
            "role_id": "200000139",
            "name": "古老法师"
          },
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          },
          {
            "role_id": "200000229",
            "name": "魔剑术士"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##M05 魔王城门\n###阶段与轮数：P4，第17轮固定。场景：scene_castle / 魔王城堡。叙事NPC：城堡守卫、古老法师。战斗敌人：恶魔守卫200000140×4。failure_tier=T3。\n###表面目标与转折：表面是击败守卫或解开城门；证据是每名倒下的守卫都把黑雾送入王座方向。转折为“城门试炼既是防线也是供能仪式”，强闯最快却会增强终局黑潮；印记是通行证也是追踪烙印；圣路会暴露被封存的牺牲者。\n###选项1：踏上守卫划出的试炼场；resolution_type=battle。victory：combat+1、材料奖励触发标记900050×1、M05_BREACHED、M05_THRONE_FED；进入城堡，M06战斗前必须展示王座吸收了守卫残余。defeat：先检查900002、M04_PUBLIC_ROUTE、M04_EVIDENCE、M04_GATE_CIPHER、P4_SENTRY_BYPASSED、900022、M03_LINA_BLESSING任一替代；有则supply-8、corruption+8、M05_FORCED_ENTRY并继续，无则M05_GATE_LOST且任务失败、final_chapter=true。retreat：有替代则supply-6、M05_FORCED_ENTRY并继续；无替代则M05_GATE_LOST且任务失败、final_chapter=true。\n###选项2：把魔王印记按上城门；resolution_type=direct；available条件拥有900002。结算：消耗900002×1、scheme+1、M05_INFILTRATED、M05_MARK_AWAKENED；若有M04_GATE_CIPHER则不增加腐化，否则corruption+5。M06必须回收商人的烙印代价。\n###选项3：请法师唤醒墙中的圣路；resolution_type=check；hidden_context难度20；available条件拥有莉娜记忆900022、M03_LINA_BLESSING或cleanse≥3；M03_TRUE_WARNING提供优势。success：cleanse+1、光明印记900008×1、M05_HOLY_ROUTE。great_success：再corruption-5并使古老法师=trusted。failure：corruption+10、supply-5、M05_SACRED_ROUTE_COLLAPSED；若M04_PUBLIC_ROUTE、M04_EVIDENCE、900002、M04_GATE_CIPHER或P4_SENTRY_BYPASSED任一替代仍存在则继续，否则任务失败、final_chapter=true。\n###链条回收：M06开场必须呈现M05_THRONE_FED、M05_MARK_AWAKENED、M05_HOLY_ROUTE、M05_FORCED_ENTRY或M05_SACRED_ROUTE_COLLAPSED之一带来的可见变化。"
  },
  "M06": {
    "event_id": "M06",
    "event_type": "main",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 22,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000141",
            "name": "魔王"
          }
        ],
        "possible": [
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000142",
            "name": "魔王侍卫盾"
          },
          {
            "role_id": "200000143",
            "name": "魔王侍卫剑"
          },
          {
            "role_id": "200000144",
            "name": "魔王侍卫牧师"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 4
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_throne",
            "name": "魔王大厅"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##M06 魔王终局\n###阶段与轮数：P5，第22-24轮安排；场景：scene_throne / 魔王大厅。叙事NPC：魔王。战斗敌人：魔王200000141×1、魔王侍卫盾200000142×1、魔王侍卫剑200000143×1、魔王侍卫牧师200000144×1。failure_tier=T4。\n###表面目标与转折：表面是击败或逼退魔王；转折必须由本局证据决定：他在利用城门试炼、黑暗印记或时间碎片把队伍过去的胜利转为王座燃料。玩家此前保住的记忆、NPC、圣路与证据决定能否切断这层反制。\n###选项1：迎着王座前的黑潮前进；resolution_type=battle；combat≥3、龙心余烬900005或未来战术书900007提供世界内战术反馈但不删敌人、不修改程序战斗数值。victory：M06_COMBAT_CLEAR、final_chapter=true，程序确认cleared。defeat或retreat：M06_COMBAT_FAILED、final_chapter=true，无成功奖励，程序确认failed。\n###选项2：用掌握的秘密逼他让步；resolution_type=check；hidden_context难度20；available条件scheme≥3或拥有900006/900007/900009。900006、900007、900009、M04_EVIDENCE、M04_GATE_CIPHER、M03_TRUE_WARNING、P5_SOULS_FREED或P5_TIME_INSIGHT各可提供有依据的优势但总加值受上限；M04_LEDGER_BURNED或M03_MEMORY_SHATTERED不额外惩罚但代表缺失证据。success或great_success：M06_SCHEME_CLEAR、final_chapter=true，程序确认cleared；大成功只能改善终章中的NPC/区域后果，不额外发永久奖励。failure：若current_round<24、run_status=ongoing且本次corruption+12后的未钳制结果仍低于100，则corruption+12、M06_SCHEME_BACKFIRED、final_chapter=false，下一轮必须生成B_P5_LAST_STAND且只有一个战斗选项；否则加入M06_SCHEME_FAILED并final_chapter=true，程序确认failed。\n###选项3：将圣心残片嵌入法阵；resolution_type=check；hidden_context难度20；available条件cleanse≥3且拥有圣心残片900003；光明印记900008、龙心余烬900005、M03_LINA_BLESSING、M05_HOLY_ROUTE、H03_LOCK_MASTERED、H04_DRAGON_COUNSEL、P4_SHRINE_ECHO或P5_SOULS_FREED为优势但总加值受上限。success或great_success：消耗900003×1、M06_CLEANSE_CLEAR、final_chapter=true，程序确认cleared；大成功只改善区域/NPC后果。failure：不消耗900003，加入M06_CLEANSE_FAILED、final_chapter=true，无成功奖励，程序确认failed。AI不得通过开场文案临时改变失败是否消耗道具。\n###最后反扑：稳定event_id为B_P5_LAST_STAND，只能承接M06_SCHEME_BACKFIRED且每局最多一次；场景scene_throne，只有一个template_name为“战斗事件”的可用选项，敌人从魔王侍卫盾、魔王侍卫剑、魔王侍卫牧师、恶魔守卫中选择恰好4名且同名可重复规则服从战斗池。victory设置M06_LAST_STAND_CLEAR、final_chapter=true并由程序确认cleared；defeat或retreat设置M06_LAST_STAND_FAILED、final_chapter=true并由程序确认failed。不得再次提供谋略或净化选项。"
  },
  "H01": {
    "event_id": "H01",
    "event_type": "hidden",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 1,
      "round_max": 4,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000145",
            "name": "史莱姆王"
          }
        ],
        "possible": [
          {
            "role_id": "200000130",
            "name": "史莱姆"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 1
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_forgotten_cave",
            "name": "遗忘洞穴"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##H01 史莱姆王\n###阶段：P1；场景：遗忘洞穴；NPC：史莱姆王；敌人：史莱姆王200000145×1、史莱姆200000130×3。线索：HINT_H01。\n###转折：史莱姆王不是腐化源头，而是在吞噬带黑纹的废料阻止其流入井道；杀死它能取得材料，却会让腐化残液失去天然拦截。\n###选项1正面挑战；resolution_type=battle；敌人史莱姆王200000145×1、史莱姆200000130×3。victory：combat+1、粘液核心900004×1、材料奖励触发标记900050×1、H01_SLAIN、corruption+3。defeat：supply-6、H01_CAVE_COLLAPSED，无奖励，支线关闭。retreat：supply-4、H01_CAVE_SEALED，无奖励，支线关闭。\n###选项2打开废料沟放它离开；resolution_type=direct。结算：scheme+1、H01_SPARED、H01_WASTE_ROUTE_FOUND，使M04调查检定获得优势。\n###选项3尝试让它辨认队伍的气味；resolution_type=check；hidden_context难度16。success：scheme+1、H01_ALLY，使一次后续史莱姆或腐化废料事件获得优势；great_success再获得粘液核心900004×1；failure：supply-4、H01_CAVE_SEALED，无奖励。不得直接永久发卡。"
  },
  "H02": {
    "event_id": "H02",
    "event_type": "hidden",
    "schedule": {
      "phases": [
        "P2"
      ],
      "round_min": 5,
      "round_max": 8,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "300000004",
            "name": "吸血鬼贵族"
          }
        ],
        "possible": [
          {
            "role_id": "200000147",
            "name": "吸血鬼仆从盾"
          },
          {
            "role_id": "200000241",
            "name": "亡灵守卫"
          },
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          },
          {
            "role_id": "300000006",
            "name": "哀嚎女妖"
          },
          {
            "role_id": "200000118",
            "name": "影刃刺客"
          },
          {
            "role_id": "200000119",
            "name": "诅咒巫师"
          },
          {
            "role_id": "200000204",
            "name": "诅咒娃娃"
          },
          {
            "role_id": "200000225",
            "name": "骷髅火枪手"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_vampire_manor",
            "name": "吸血鬼庄园"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##H02 吸血鬼庄园\n###阶段：P2；场景：吸血鬼庄园；NPC：吸血鬼贵族；敌人：吸血鬼贵族300000004×1、吸血鬼仆从盾200000147×3。线索：HINT_H02。\n###转折：庄园在捕食旅人，也在收留逃离魔王征税的亡者；账册证明双方都利用同一条血运线。\n###选项1攻击庄园主人；resolution_type=battle；敌人吸血鬼贵族300000004×1、吸血鬼仆从盾200000147×3。victory：combat+1、材料奖励触发标记900050×1、H02_SLAIN，但销毁一部分魔王情报。defeat：corruption+8、H02_BLOOD_TITHE，无奖励，支线关闭。retreat：supply-5、H02_WATCHED，无奖励，支线关闭。\n###选项2交换账册并追问血运线；resolution_type=check；hidden_context难度17。success：scheme+1、H02_INTEL，使M04调查检定获得优势；great_success再使吸血鬼贵族=cooperative；failure：corruption+8、H02_BLOOD_TITHE，无奖励，支线关闭。\n###选项3接受黑暗结盟；resolution_type=direct。结算：scheme+1、corruption+10、H02_BLOOD_PACT、吸血鬼贵族=cooperative；不得授予表外道具或永久卡牌。"
  },
  "H03": {
    "event_id": "H03",
    "event_type": "hidden",
    "schedule": {
      "phases": [
        "P3"
      ],
      "round_min": 9,
      "round_max": 12,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000148",
            "name": "古老守护者"
          }
        ],
        "possible": [
          {
            "role_id": "200000210",
            "name": "雷电符文巨魔像"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 1
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_ancient_temple",
            "name": "古老神庙"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##H03 古老神庙\n###阶段：P3；场景：古老神庙；NPC：古老守护者；触发条件为拥有古老地图900011，或current_team中最高knowledge≥12；线索：HINT_H03。\n###转折：守护者保护的不是宝物本身，而是防止圣心残片被用作王座法阵的最后一块锁。\n###选项1解读守护铭文；resolution_type=check；standard_fixed intelligence难度20。success：scheme+1、圣心残片900003×1、H03_LOCK_UNDERSTOOD；great_success再加入H03_LOCK_MASTERED，使M06净化检定获得优势；failure：corruption+8、H03_RIDDLE_CLOSED，无奖励，支线关闭。\n###选项2强行穿过守护阵；resolution_type=check；hidden_attribute strength难度20。success：combat+1、圣心残片900003×1、H03_WARD_BROKEN；great_success不增加永久奖励；failure：supply-8、H03_FORCE_FAILED，无奖励，支线关闭。\n###选项3以自身腐化喂饱封印；resolution_type=direct。结算：scheme+1、corruption+20、圣心残片900003×1、H03_CORRUPTED_RELIC。每局最多获得一个900003；已拥有时三个选项都不得再次发放，只保留各自flag和其它后果。"
  },
  "H04": {
    "event_id": "H04",
    "event_type": "hidden",
    "schedule": {
      "phases": [
        "P4"
      ],
      "round_min": 13,
      "round_max": 17,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000149",
            "name": "巨龙"
          }
        ],
        "possible": [
          {
            "role_id": "200000177",
            "name": "幼龙·纳兹瑞尔"
          },
          {
            "role_id": "300000002",
            "name": "幼龙·辛萨瑞拉"
          },
          {
            "role_id": "300000007",
            "name": "黑翼飞龙"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_dragon_nest",
            "name": "巨龙巢穴"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##H04 巨龙盟约\n###阶段：P4；场景：巨龙巢穴；NPC与敌人：巨龙200000149×1；触发条件为拥有龙鳞信物900010，或current_team中最高perception≥14；线索：HINT_H04。\n###转折：巨龙守护山路并非效忠魔王，而是在防止城堡抽走龙脉；战斗会证明力量，却也破坏谈判所需的巢穴信任。\n###选项1以力量证明来意；resolution_type=battle；敌人巨龙200000149×1。victory：combat+1、龙心余烬900005×1、材料奖励触发标记900050×1、H04_DRAGON_WOUNDED。defeat：supply-8、corruption+5、H04_NEST_HOSTILE，无奖励，支线关闭。retreat：supply-5、H04_NEST_CLOSED，无奖励，支线关闭。\n###选项2递出鳞片谈论龙脉；resolution_type=check；standard_fixed social难度18；available条件拥有龙鳞信物900010。success：消耗900010×1、scheme+1、H04_DRAGON_COUNSEL、巨龙=cooperative，使M06净化检定获得优势；great_success再corruption-5；failure：不消耗900010、corruption+8、H04_NEST_CLOSED，无奖励，支线关闭。\n###选项3回应巨龙设下的盟誓；resolution_type=check；hidden_context难度20。success或great_success：scheme+1、H04_DRAGON_ALLY、巨龙=trusted，并在本局尚未触发因缘奖励时输出900061×1；great_success不增加第二次触发。failure：corruption+8、H04_NEST_HOSTILE，无奖励且不得输出900061，支线关闭。"
  },
  "H05": {
    "event_id": "H05",
    "event_type": "hidden",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 18,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [],
        "optional_select_min": 0,
        "optional_select_max": 0
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_time_rift",
            "name": "时间裂缝"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##H05 时间裂缝\n###阶段：P5；场景：时间裂缝；触发条件为corruption≥60或拥有时序碎片900006；线索：HINT_H05。\n###转折：裂缝展示的“胜利未来”是魔王用来诱使队伍重复失败动作的剪影，未来战术书只有在识破重复时才真实存在。\n###选项1进入裂缝辨认重复；resolution_type=check；standard_fixed intelligence难度20。success：scheme+1、未来战术书900007×1、H05_PATTERN_BROKEN；great_success再加入ONCE_H05_TIME_SHIELD，免除一次后续时间类明确资源代价；failure：corruption+15、H05_LOOP_SCAR，无道具奖励。\n###选项2用时序碎片缝合裂口；resolution_type=direct；available条件拥有900006。结算：消耗900006×1、cleanse+1、corruption-20但程序最低钳制到0、H05_SEALED。\n###选项3离开重复的未来；resolution_type=direct。结算：无物品或数值变化，加入H05_LEFT_OPEN。"
  },
  "H06": {
    "event_id": "H06",
    "event_type": "hidden",
    "schedule": {
      "phases": [
        "P4",
        "P5"
      ],
      "round_min": 13,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000139",
            "name": "古老法师"
          }
        ],
        "possible": [],
        "optional_select_min": 0,
        "optional_select_max": 0
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_light_temple",
            "name": "光明神殿"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##H06 光明神殿\n###阶段：P4或P5；场景：光明神殿；NPC：古老法师；触发条件为cleanse≥2或拥有圣心残片900003；线索：HINT_H06。\n###转折：神殿之光会净化腐化，也会显露队伍曾经默许的牺牲，使NPC关系与终章评价发生变化。\n###选项1接受神殿对过往选择的审视；resolution_type=check；hidden_context难度19。success：cleanse+1、光明印记900008×1、H06_TRUTH_SEEN；great_success再使一个处于hostile、wary、neutral或cooperative的合理NPC关系改善一级，不得改变met、departed或dead；failure：corruption+8、H06_JUDGED，无道具奖励，支线关闭。\n###选项2让神殿之光净化队伍；resolution_type=direct。结算：cleanse+1，corruption delta固定为-max(0,min(20,corruption_value))，不获得道具，加入H06_PURIFIED；程序提交后最低为0。\n###选项3拒绝审判并离开；resolution_type=direct。结算：无物品或数值变化，加入H06_LEFT_UNTOUCHED。"
  },
  "H07": {
    "event_id": "H07",
    "event_type": "hidden",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 18,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "200000135",
            "name": "黑暗商人"
          },
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          },
          {
            "role_id": "200000229",
            "name": "魔剑术士"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_demon_altar",
            "name": "恶魔祭坛"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##H07 恶魔祭坛\n###阶段：P5；场景：恶魔祭坛；触发条件为corruption≥40或M04_DARK_DEAL=true；线索：HINT_H07。\n###转折：祭坛核心与黑暗商人的印记同源；摧毁它能削弱烙印，接受它则获得进入王座秘密的同时让魔王更容易定位队伍。\n###选项1切断祭坛与印记的回路；resolution_type=check；hidden_context难度20。success：cleanse+1、corruption-15、H07_DESTROYED，并移除M05_MARK_AWAKENED（若存在）；great_success不额外发永久奖励；failure：corruption+10、H07_BACKLASH，无道具奖励。\n###选项2接受祭坛吐出的核心；resolution_type=direct。结算：scheme+1、腐化核心900009×1、corruption+15、H07_CORE_TAKEN；已拥有900009时不得重复获得，只增加腐化并设置flag。\n###选项3绕过仍在搏动的祭坛；resolution_type=direct。结算：无物品或数值变化，加入H07_BYPASSED。"
  },
  "R_P1_FLOODED_CHAPEL": {
    "event_id": "R_P1_FLOODED_CHAPEL",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 1,
      "round_max": 4,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000189",
            "name": "主教劳伦斯"
          }
        ],
        "possible": [
          {
            "role_id": "200000190",
            "name": "祭司索菲亚"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000130",
            "name": "史莱姆"
          },
          {
            "role_id": "200000224",
            "name": "巨熊"
          },
          {
            "role_id": "200000226",
            "name": "狂狼"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_village",
            "name": "艾德村庄"
          },
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_church",
            "name": "神圣教堂"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P1_FLOODED_CHAPEL 淹水礼拜堂：主教劳伦斯与祭司索菲亚在艾德村庄或幽暗森林边缘抢救被污水包围的圣器；搬开断梁为standard_fixed strength检定，辨认安全水路为standard_fixed perception检定，放弃物资直接救人为结算。成功可获得圣水900001或corruption-5，不得同时获得。"
  },
  "R_P1_TRAPPED_SCOUT": {
    "event_id": "R_P1_TRAPPED_SCOUT",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 1,
      "round_max": 4,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000131",
            "name": "猎人马克"
          }
        ],
        "possible": [
          {
            "role_id": "290000012",
            "name": "林地猎人"
          },
          {
            "role_id": "200000224",
            "name": "巨熊"
          },
          {
            "role_id": "200000226",
            "name": "狂狼"
          },
          {
            "role_id": "200000235",
            "name": "森林捕猎者"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000130",
            "name": "史莱姆"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_forgotten_cave",
            "name": "遗忘洞穴"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P1_TRAPPED_SCOUT 受困斥候：猎人马克派出的林地猎人或森林捕猎者被狂狼、巨熊或腐化植物逼入旧瞭望台；迎战为战斗，诱开怪物为standard_fixed survival检定，拆毁补给架开路为supply-4直接结算。成功设置P1_SCOUT_SAVED并使后续森林事件获得优势。"
  },
  "R_P1_TAINTED_GRANARY": {
    "event_id": "R_P1_TAINTED_GRANARY",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 1,
      "round_max": 4,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000129",
            "name": "村长艾德"
          }
        ],
        "possible": [
          {
            "role_id": "200000165",
            "name": "老板娘玛莎"
          },
          {
            "role_id": "200000130",
            "name": "史莱姆"
          },
          {
            "role_id": "290000011",
            "name": "重甲守卫"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_village",
            "name": "艾德村庄"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P1_TAINTED_GRANARY 腐粮争执：村长艾德与老板娘玛莎面对争抢仅存粮袋的村民，其中部分粮食已被腐化；分辨粮食为standard_fixed knowledge检定，镇住人群为standard_fixed authority检定，焚毁污染区为corruption-3且supply-3的直接结算。成功最多supply+8。"
  },
  "R_P1_SLIME_TRAIL": {
    "event_id": "R_P1_SLIME_TRAIL",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 1,
      "round_max": 4,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000130",
            "name": "史莱姆"
          }
        ],
        "possible": [
          {
            "role_id": "100000001",
            "name": "实习牧师"
          },
          {
            "role_id": "290000011",
            "name": "重甲守卫"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000224",
            "name": "巨熊"
          },
          {
            "role_id": "200000226",
            "name": "狂狼"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_village",
            "name": "艾德村庄"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          },
          {
            "scene_id": "scene_forgotten_cave",
            "name": "遗忘洞穴"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P1_SLIME_TRAIL 黏液伏线：史莱姆故意留下通向村外的痕迹，实习牧师或重甲守卫正试图阻止村民误入；追击为最多4敌人的战斗，采样为standard_fixed intelligence检定，设伏为hidden_context检定。战斗成功设置P1_SLIME_DRIVEN；调查成功设置P1_SLIME_SAMPLED并使M02追踪检定获得优势。战斗或高质量调查成功可输出材料奖励触发标记900050×1。"
  },
  "R_P1_BROKEN_BRIDGE": {
    "event_id": "R_P1_BROKEN_BRIDGE",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P1"
      ],
      "round_min": 1,
      "round_max": 4,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "290000013",
            "name": "游荡者"
          },
          {
            "role_id": "200000227",
            "name": "林地步兵"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000130",
            "name": "史莱姆"
          },
          {
            "role_id": "200000224",
            "name": "巨熊"
          },
          {
            "role_id": "200000226",
            "name": "狂狼"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_village",
            "name": "艾德村庄"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P1_BROKEN_BRIDGE 断桥抉择：洪水切断森林道路，游荡者或林地步兵被困在另一侧呼救；修桥为standard_fixed intelligence检定，涉水为standard_fixed constitution检定，绕行直接supply-5。成功救人设置P1_BRIDGE_RESCUE并提高猎人信任的后续效果。"
  },
  "R_P2_GHOST_FERRY": {
    "event_id": "R_P2_GHOST_FERRY",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P2"
      ],
      "round_min": 5,
      "round_max": 8,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          }
        ],
        "possible": [
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000241",
            "name": "亡灵守卫"
          },
          {
            "role_id": "300000006",
            "name": "哀嚎女妖"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_swamp",
            "name": "幽灵沼泽"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P2_GHOST_FERRY 幽灵渡船：一名亡灵巫师驾着幽灵沼泽的渡船，索要一段真实记忆；交出已发生的NPC承诺可直接过河，识破契约为standard_fixed deception检定，强渡为standard_fixed survival检定。成功设置P2_FERRY_PASS，失败corruption+8。"
  },
  "R_P2_DROWNED_CAMP": {
    "event_id": "R_P2_DROWNED_CAMP",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P2"
      ],
      "round_min": 5,
      "round_max": 8,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "290000012",
            "name": "林地猎人"
          },
          {
            "role_id": "290000013",
            "name": "游荡者"
          },
          {
            "role_id": "200000133",
            "name": "普通幽灵"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000241",
            "name": "亡灵守卫"
          },
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          },
          {
            "role_id": "300000006",
            "name": "哀嚎女妖"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_swamp",
            "name": "幽灵沼泽"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P2_DROWNED_CAMP 沉没营地：林地猎人和游荡者留下的旧营地正在没入泥沼，普通幽灵在水下徘徊；先救幸存者为standard_fixed agility检定并获得后续证词，先抢物资为直接supply+8且corruption+3，辨认安全绳结为standard_fixed knowledge检定并兼得较少补给。"
  },
  "R_P2_ECHO_HUNTER": {
    "event_id": "R_P2_ECHO_HUNTER",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P2"
      ],
      "round_min": 5,
      "round_max": 8,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000131",
            "name": "猎人马克"
          }
        ],
        "possible": [
          {
            "role_id": "290000012",
            "name": "林地猎人"
          },
          {
            "role_id": "200000235",
            "name": "森林捕猎者"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000241",
            "name": "亡灵守卫"
          },
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          },
          {
            "role_id": "300000006",
            "name": "哀嚎女妖"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_swamp",
            "name": "幽灵沼泽"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P2_ECHO_HUNTER 回声猎人：猎人马克、林地猎人或森林捕猎者中的一人只重复过去说过的话，挡住道路；唤醒记忆为standard_fixed social检定，追踪回声源为standard_fixed perception检定，回避则supply-3。成功设置P2_ECHO_CLUE并为M03提供优势。"
  },
  "R_P2_CORPSE_LIGHTS": {
    "event_id": "R_P2_CORPSE_LIGHTS",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P2"
      ],
      "round_min": 5,
      "round_max": 8,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "200000133",
            "name": "普通幽灵"
          },
          {
            "role_id": "200000204",
            "name": "诅咒娃娃"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000241",
            "name": "亡灵守卫"
          },
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          },
          {
            "role_id": "300000006",
            "name": "哀嚎女妖"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_swamp",
            "name": "幽灵沼泽"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_forgotten_cave",
            "name": "遗忘洞穴"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P2_CORPSE_LIGHTS 尸灯岔路：普通幽灵与诅咒娃娃引出的尸灯，分别指向安全道路和埋藏遗骸；净化尸灯为hidden_context检定并corruption-8，冒险掘取为standard_auto检定成功后输出材料奖励触发标记900050×1，绕行直接supply-4。"
  },
  "R_P2_VAMPIRE_ENVOY": {
    "event_id": "R_P2_VAMPIRE_ENVOY",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P2"
      ],
      "round_min": 5,
      "round_max": 8,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "300000004",
            "name": "吸血鬼贵族"
          }
        ],
        "possible": [
          {
            "role_id": "200000147",
            "name": "吸血鬼仆从盾"
          },
          {
            "role_id": "200000118",
            "name": "影刃刺客"
          },
          {
            "role_id": "200000119",
            "name": "诅咒巫师"
          },
          {
            "role_id": "200000109",
            "name": "毒藤母体"
          },
          {
            "role_id": "200000110",
            "name": "荆棘守卫"
          },
          {
            "role_id": "200000111",
            "name": "喷吐毒花"
          },
          {
            "role_id": "200000112",
            "name": "孢子蘑菇"
          },
          {
            "role_id": "200000208",
            "name": "苔藓古卫"
          },
          {
            "role_id": "200000241",
            "name": "亡灵守卫"
          },
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          },
          {
            "role_id": "300000006",
            "name": "哀嚎女妖"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_swamp",
            "name": "幽灵沼泽"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_vampire_manor",
            "name": "吸血鬼庄园"
          },
          {
            "scene_id": "scene_forest",
            "name": "幽暗森林"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P2_VAMPIRE_ENVOY 血族使者：吸血鬼贵族派吸血鬼仆从盾、影刃刺客或诅咒巫师提出交换魔王情报；拒绝后迎战为战斗，谈判为standard_fixed social检定，接受血契为corruption+10并设置P2_VAMPIRE_INTEL。成功谈判只能给情报优势，不直接发永久奖励。"
  },
  "R_P3_BLACK_LEDGER": {
    "event_id": "R_P3_BLACK_LEDGER",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P3"
      ],
      "round_min": 9,
      "round_max": 12,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000135",
            "name": "黑暗商人"
          }
        ],
        "possible": [
          {
            "role_id": "200000163",
            "name": "商人格雷厄姆"
          },
          {
            "role_id": "200000113",
            "name": "地精工头"
          },
          {
            "role_id": "200000114",
            "name": "地精拳击手"
          },
          {
            "role_id": "200000115",
            "name": "火箭筒地精"
          },
          {
            "role_id": "200000116",
            "name": "维修地精"
          },
          {
            "role_id": "200000206",
            "name": "暗影窃贼"
          },
          {
            "role_id": "200000246",
            "name": "银月刺客"
          },
          {
            "role_id": "200000249",
            "name": "优雅毒师"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_rivertown",
            "name": "河畔镇"
          },
          {
            "scene_id": "scene_black_market",
            "name": "黑市"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P3_BLACK_LEDGER 黑市账册：黑暗商人与商人格雷厄姆争夺河畔镇账房，证据即将被焚毁；潜入取证为standard_fixed dexterity检定，公开追问为standard_fixed authority检定；gold_allowed=spend或diamond_allowed=spend时，可从对应policy的allowed_spend_values选择一个合法金额收买看守并直接结算，玩家可见选项必须明确币种与金额，同一事件金币和钻石二选一。成功获得黑市账页900021，每局最多1个。"
  },
  "R_P3_BANDIT_TOLL": {
    "event_id": "R_P3_BANDIT_TOLL",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P3"
      ],
      "round_min": 9,
      "round_max": 12,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000136",
            "name": "强盗头领"
          }
        ],
        "possible": [
          {
            "role_id": "200000137",
            "name": "普通强盗"
          },
          {
            "role_id": "200000106",
            "name": "双刀豺狼人"
          },
          {
            "role_id": "200000107",
            "name": "投网豺狼人"
          },
          {
            "role_id": "200000113",
            "name": "地精工头"
          },
          {
            "role_id": "200000114",
            "name": "地精拳击手"
          },
          {
            "role_id": "200000115",
            "name": "火箭筒地精"
          },
          {
            "role_id": "200000116",
            "name": "维修地精"
          },
          {
            "role_id": "200000206",
            "name": "暗影窃贼"
          },
          {
            "role_id": "200000246",
            "name": "银月刺客"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_rivertown",
            "name": "河畔镇"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_bandit_camp",
            "name": "强盗营地"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P3_BANDIT_TOLL 强盗税卡：强盗头领带着普通强盗、投网豺狼人或双刀豺狼人，用难民作掩护索取物资；正面突破为战斗，伪造通行凭证为standard_fixed deception检定；gold_allowed=spend时可从allowed_spend_values选择合法金额缴纳税卡并设置P3_PAID_TOLL。"
  },
  "R_P3_PLAGUE_WELL": {
    "event_id": "R_P3_PLAGUE_WELL",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P3"
      ],
      "round_min": 9,
      "round_max": 12,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "200000192",
            "name": "学者以西结"
          },
          {
            "role_id": "200000193",
            "name": "治疗师丽贝卡"
          },
          {
            "role_id": "200000113",
            "name": "地精工头"
          },
          {
            "role_id": "200000114",
            "name": "地精拳击手"
          },
          {
            "role_id": "200000115",
            "name": "火箭筒地精"
          },
          {
            "role_id": "200000116",
            "name": "维修地精"
          },
          {
            "role_id": "200000163",
            "name": "商人格雷厄姆"
          },
          {
            "role_id": "200000166",
            "name": "侍者威尔"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_rivertown",
            "name": "河畔镇"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_square",
            "name": "城市广场"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P3_PLAGUE_WELL 疫井封锁：治疗师丽贝卡与学者以西结争论是否封死仍有人呼救的旧井；下井救人为standard_fixed constitution检定，研究污染为standard_fixed knowledge检定，彻底净化为hidden_context检定。成功可corruption-8或设置P3_PLAGUE_EVIDENCE使M04调查检定获得优势，不得同时取得两项。"
  },
  "R_P3_SMUGGLER_CACHE": {
    "event_id": "R_P3_SMUGGLER_CACHE",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P3"
      ],
      "round_min": 9,
      "round_max": 12,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "200000206",
            "name": "暗影窃贼"
          },
          {
            "role_id": "200000246",
            "name": "银月刺客"
          },
          {
            "role_id": "200000106",
            "name": "双刀豺狼人"
          },
          {
            "role_id": "200000107",
            "name": "投网豺狼人"
          },
          {
            "role_id": "200000113",
            "name": "地精工头"
          },
          {
            "role_id": "200000114",
            "name": "地精拳击手"
          },
          {
            "role_id": "200000115",
            "name": "火箭筒地精"
          },
          {
            "role_id": "200000116",
            "name": "维修地精"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_black_market",
            "name": "黑市"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_rivertown",
            "name": "河畔镇"
          },
          {
            "scene_id": "scene_bandit_camp",
            "name": "强盗营地"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P3_SMUGGLER_CACHE 走私藏窖：暗影窃贼与银月刺客盯上的藏窖里，有装备材料与通往神庙的残图；排除机关为standard_fixed perception检定，强拆为standard_fixed strength检定且失败supply-6，追踪残图为hidden_attribute perception检定。材料路线成功输出材料奖励触发标记900050×1；残图路线成功获得古老地图900011；检定大成功且gold_allowed=gain、gain_limit_remaining>0时，可从allowed_gain_values选择一个合法正金币奖励，每事件最多一次。"
  },
  "R_P3_TOWN_WITNESS": {
    "event_id": "R_P3_TOWN_WITNESS",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P3"
      ],
      "round_min": 9,
      "round_max": 12,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000163",
            "name": "商人格雷厄姆"
          }
        ],
        "possible": [
          {
            "role_id": "200000166",
            "name": "侍者威尔"
          },
          {
            "role_id": "200000113",
            "name": "地精工头"
          },
          {
            "role_id": "200000114",
            "name": "地精拳击手"
          },
          {
            "role_id": "200000115",
            "name": "火箭筒地精"
          },
          {
            "role_id": "200000116",
            "name": "维修地精"
          },
          {
            "role_id": "200000192",
            "name": "学者以西结"
          },
          {
            "role_id": "200000193",
            "name": "治疗师丽贝卡"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_rivertown",
            "name": "河畔镇"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_tavern",
            "name": "酒馆"
          },
          {
            "scene_id": "scene_inn",
            "name": "旅店"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P3_TOWN_WITNESS 沉默证人：侍者威尔或商人格雷厄姆掌握运输线证据，却准备逃离；安抚为standard_fixed social检定，揭穿谎言为standard_fixed deception检定，护送为最多4敌人的战斗。成功设置P3_WITNESS并使M04一个相关检定获得+2优势。"
  },
  "R_P4_DRAGON_TRACK": {
    "event_id": "R_P4_DRAGON_TRACK",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P4"
      ],
      "round_min": 13,
      "round_max": 17,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "300000002",
            "name": "幼龙·辛萨瑞拉"
          }
        ],
        "possible": [
          {
            "role_id": "200000177",
            "name": "幼龙·纳兹瑞尔"
          },
          {
            "role_id": "300000007",
            "name": "黑翼飞龙"
          },
          {
            "role_id": "200000106",
            "name": "双刀豺狼人"
          },
          {
            "role_id": "200000107",
            "name": "投网豺狼人"
          },
          {
            "role_id": "200000175",
            "name": "索林·铁砧咆哮"
          },
          {
            "role_id": "200000236",
            "name": "山民祭祀"
          },
          {
            "role_id": "200000237",
            "name": "山丘领主"
          },
          {
            "role_id": "200000239",
            "name": "霜鬃猛犸"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_mountains",
            "name": "黑风山脉"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_dragon_nest",
            "name": "巨龙巢穴"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P4_DRAGON_TRACK 龙痕雪线：幼龙·辛萨瑞拉、幼龙·纳兹瑞尔或黑翼飞龙在黑风山脉留下被高温熔化的足迹；追踪为standard_fixed survival检定，采集鳞片为standard_fixed perception检定，避开巢区直接supply-3。采集成功获得龙鳞信物900010，每局最多1个。"
  },
  "R_P4_AVALANCHE": {
    "event_id": "R_P4_AVALANCHE",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P4"
      ],
      "round_min": 13,
      "round_max": 17,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000175",
            "name": "索林·铁砧咆哮"
          }
        ],
        "possible": [
          {
            "role_id": "200000236",
            "name": "山民祭祀"
          },
          {
            "role_id": "200000237",
            "name": "山丘领主"
          },
          {
            "role_id": "200000106",
            "name": "双刀豺狼人"
          },
          {
            "role_id": "200000107",
            "name": "投网豺狼人"
          },
          {
            "role_id": "200000177",
            "name": "幼龙·纳兹瑞尔"
          },
          {
            "role_id": "200000239",
            "name": "霜鬃猛犸"
          },
          {
            "role_id": "300000002",
            "name": "幼龙·辛萨瑞拉"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_mountains",
            "name": "黑风山脉"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_dwarf_mine",
            "name": "矮人矿洞"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P4_AVALANCHE 雪崩余震：队伍与索林·铁砧咆哮、山民祭祀或山丘领主中的一人被分隔在两处岩台；固定绳索为standard_fixed dexterity检定，劈开冰壁为standard_fixed strength检定，丢弃补给减重为supply-6直接结算。成功救援设置P4_MOUNTAIN_RESCUE。"
  },
  "R_P4_DEMON_SENTRY": {
    "event_id": "R_P4_DEMON_SENTRY",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P4"
      ],
      "round_min": 13,
      "round_max": 17,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          }
        ],
        "possible": [
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          },
          {
            "role_id": "200000106",
            "name": "双刀豺狼人"
          },
          {
            "role_id": "200000107",
            "name": "投网豺狼人"
          },
          {
            "role_id": "200000175",
            "name": "索林·铁砧咆哮"
          },
          {
            "role_id": "200000177",
            "name": "幼龙·纳兹瑞尔"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_mountains",
            "name": "黑风山脉"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P4_DEMON_SENTRY 恶魔哨卡：恶魔守卫带着小恶魔·扎克、钢颚·加尔或血角·赛娜封锁城门前道路；强攻为最多4敌人的战斗，利用魔王印记伪装为直接结算并可消耗900002，制造假命令为standard_fixed deception检定。非战斗绕过成功设置P4_SENTRY_BYPASSED，作为M05失败时的一个替代入口。"
  },
  "R_P4_COLLAPSED_SHRINE": {
    "event_id": "R_P4_COLLAPSED_SHRINE",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P4"
      ],
      "round_min": 13,
      "round_max": 17,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000174",
            "name": "布瑞娜·熔炉之符"
          }
        ],
        "possible": [
          {
            "role_id": "200000236",
            "name": "山民祭祀"
          },
          {
            "role_id": "200000106",
            "name": "双刀豺狼人"
          },
          {
            "role_id": "200000107",
            "name": "投网豺狼人"
          },
          {
            "role_id": "200000175",
            "name": "索林·铁砧咆哮"
          },
          {
            "role_id": "200000177",
            "name": "幼龙·纳兹瑞尔"
          },
          {
            "role_id": "200000210",
            "name": "雷电符文巨魔像"
          },
          {
            "role_id": "200000237",
            "name": "山丘领主"
          },
          {
            "role_id": "200000239",
            "name": "霜鬃猛犸"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_mountains",
            "name": "黑风山脉"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_ancient_temple",
            "name": "古老神庙"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P4_COLLAPSED_SHRINE 倾塌圣龛：山民祭祀与布瑞娜·熔炉之符守着受损圣龛，它仍在压制山中的腐化；修复为standard_fixed knowledge检定并corruption-8，抽取余力为hidden_context检定成功后设置P4_SHRINE_ECHO使M06净化检定获得优势但corruption+5，离开无变化。"
  },
  "R_P4_SIEGE_CART": {
    "event_id": "R_P4_SIEGE_CART",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P4"
      ],
      "round_min": 13,
      "round_max": 17,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          }
        ],
        "possible": [
          {
            "role_id": "200000136",
            "name": "强盗头领"
          },
          {
            "role_id": "200000106",
            "name": "双刀豺狼人"
          },
          {
            "role_id": "200000107",
            "name": "投网豺狼人"
          },
          {
            "role_id": "200000113",
            "name": "地精工头"
          },
          {
            "role_id": "200000114",
            "name": "地精拳击手"
          },
          {
            "role_id": "200000115",
            "name": "火箭筒地精"
          },
          {
            "role_id": "200000116",
            "name": "维修地精"
          },
          {
            "role_id": "200000175",
            "name": "索林·铁砧咆哮"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_mountains",
            "name": "黑风山脉"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_bandit_camp",
            "name": "强盗营地"
          },
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P4_SIEGE_CART 攻城辎车：强盗头领的部下与恶魔守卫争夺一辆遗弃辎车；趁乱夺取为战斗，破坏车轴为standard_fixed intelligence检定，转移幸存物资为standard_fixed survival检定。成功最多supply+8；完成高风险目标可输出材料奖励触发标记900050×1。"
  },
  "R_P5_LIVING_CORRIDOR": {
    "event_id": "R_P5_LIVING_CORRIDOR",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 18,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000203",
            "name": "时空穿越者"
          }
        ],
        "possible": [
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          },
          {
            "role_id": "200000229",
            "name": "魔剑术士"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P5_LIVING_CORRIDOR 活体回廊：时空穿越者的残影被困其中，魔王城堡的墙壁会根据队伍此前路线改变出口；用战斗痕迹威慑为hidden_context检定，用情报找出假门为standard_fixed intelligence检定，用净化印记固定道路为hidden_context检定。成功设置P5_SHORTCUT，失败corruption+8。"
  },
  "R_P5_SOUL_PRISON": {
    "event_id": "R_P5_SOUL_PRISON",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 18,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "200000204",
            "name": "诅咒娃娃"
          },
          {
            "role_id": "200000242",
            "name": "亡灵巫师"
          },
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          },
          {
            "role_id": "200000229",
            "name": "魔剑术士"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_demon_altar",
            "name": "恶魔祭坛"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P5_SOUL_PRISON 灵魂囚笼：亡灵巫师和诅咒娃娃看守的囚笼里，同时关着无辜灵魂与魔王的诱饵；分辨真伪为standard_fixed perception检定，强行破笼为战斗，净化锁链为hidden_context检定。成功救出灵魂并设置P5_SOULS_FREED，使M06净化或谈判检定获得优势；失败corruption+10。"
  },
  "R_P5_TIME_CHAMBER": {
    "event_id": "R_P5_TIME_CHAMBER",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 18,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000203",
            "name": "时空穿越者"
          }
        ],
        "possible": [
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          },
          {
            "role_id": "200000229",
            "name": "魔剑术士"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_time_rift",
            "name": "时间裂缝"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P5_TIME_CHAMBER 停滞密室：时空穿越者留下的残影在密室里重复播放队伍本局一次真实失败；承认代价为直接结算并corruption-5，重演并改写为hidden_context检定，夺取时序残片为standard_fixed intelligence检定且失败corruption+10。成功可获得时序碎片900006或设置P5_TIME_INSIGHT使M06谋略检定获得优势，不得重复已有唯一道具。"
  },
  "R_P5_CULT_QUARTERMASTER": {
    "event_id": "R_P5_CULT_QUARTERMASTER",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 18,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [],
        "possible": [
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          },
          {
            "role_id": "200000229",
            "name": "魔剑术士"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_demon_altar",
            "name": "恶魔祭坛"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P5_CULT_QUARTERMASTER 邪教军需官：小恶魔·扎克或钢颚·加尔担任军需官，愿以秘密换取撤离通道；揭穿交易为standard_fixed deception检定，接受有代价的情报为corruption+8，伏击护卫为最多4敌人的战斗。高风险成功可输出材料奖励触发标记900050×1。"
  },
  "R_P5_THRONE_GUARD": {
    "event_id": "R_P5_THRONE_GUARD",
    "event_type": "random",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 18,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          }
        ],
        "possible": [
          {
            "role_id": "200000229",
            "name": "魔剑术士"
          },
          {
            "role_id": "200000183",
            "name": "小恶魔·扎克"
          },
          {
            "role_id": "200000186",
            "name": "钢颚·加尔"
          },
          {
            "role_id": "200000187",
            "name": "血角·赛娜"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_castle",
            "name": "魔王城堡"
          }
        ],
        "possible": [
          {
            "scene_id": "scene_throne",
            "name": "魔王大厅"
          }
        ],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 1
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##R_P5_THRONE_GUARD 王座前哨：恶魔守卫、魔剑术士与尚未进入M06的魔王侍卫组成非Boss精英小队，准备向王座增援；抢先消灭为最多4敌人的战斗，封闭通道为standard_fixed intelligence检定，制造假警报为standard_fixed deception检定。成功设置P5_GUARD_REMOVED；精英战胜利且本局尚无匣时可获得圣物奖励触发标记900060×1。"
  },
  "B_P5_LAST_STAND": {
    "event_id": "B_P5_LAST_STAND",
    "event_type": "battle_followup",
    "schedule": {
      "phases": [
        "P5"
      ],
      "round_min": 22,
      "round_max": 24,
      "fixed": false,
      "repeatable": false
    },
    "asset_scope": {
      "roles": {
        "core": [
          {
            "role_id": "200000141",
            "name": "魔王"
          }
        ],
        "possible": [
          {
            "role_id": "200000140",
            "name": "恶魔守卫"
          },
          {
            "role_id": "200000142",
            "name": "魔王侍卫盾"
          },
          {
            "role_id": "200000143",
            "name": "魔王侍卫剑"
          },
          {
            "role_id": "200000144",
            "name": "魔王侍卫牧师"
          }
        ],
        "optional_select_min": 0,
        "optional_select_max": 3
      },
      "scenes": {
        "core": [
          {
            "scene_id": "scene_throne",
            "name": "魔王大厅"
          }
        ],
        "possible": [],
        "include_current_scene_context": true,
        "optional_select_min": 0,
        "optional_select_max": 0
      }
    },
    "ai_selection": {
      "owner": "ai",
      "closed_scope": true
    },
    "rules_text": "##B_P5_LAST_STAND 王座最后反扑\n###阶段与轮数：P5，第22-24轮；只允许承接M06_SCHEME_BACKFIRED且每局最多一次。场景：scene_throne / 魔王大厅。failure_tier=T4。\n###局面与转折：谈判反噬后，魔王把队伍暴露的破绽转化为王座黑潮，侍卫封死退路；此前保住的NPC、证据、圣路或灵魂只能改变战前叙事和战术依据，不能取消这场最后战斗。\n###唯一选项：在王座彻底闭合前迎战；template_name=战斗事件；resolution_type=battle。敌人从魔王侍卫盾200000142、魔王侍卫剑200000143、魔王侍卫牧师200000144、恶魔守卫200000140中选择恰好4名；同名重复仍须服从战斗池和程序校验。\n###结算：victory设置M06_LAST_STAND_CLEAR、final_chapter=true并由程序确认cleared；defeat或retreat设置M06_LAST_STAND_FAILED、final_chapter=true并由程序确认failed。不得再次提供谋略、净化或直接结算选项，不得发放M06成功路线奖励。"
  }
};

eventDefinitionsSource.M06.asset_scope.roles.optional_select_max = 3;
eventDefinitionsSource.B_P5_LAST_STAND.asset_scope.roles.optional_select_max = 4;

export const eventDefinitions = deepFreeze(eventDefinitionsSource);
export default eventDefinitions;
