import { eventDefinitions, eventDefinitionSchemaVersion } from "./腐化魔王危机_结构化事件定义_20260904_v2.js";

export const packageMeta = Object.freeze({
  "package_type": "dungeon_runtime",
  "package_id": "dungeon1.corrupted-demon-king.runtime",
  "package_version": "2026.09.04.1",
  "dungeon_id": "dungeon_1",
  "world_id": "western_fantasy",
  "compatible_engine": "adventure.engine.ai-led-five-template",
  "required_world_package": "world.western-fantasy.rules",
  "asset_slice_id": "western_fantasy.dungeon_1.assets"
});

const dungeonPromptSource = `
#副本：腐化魔王危机
##这里定义可用资产、事件、路线、道具、奖励授权与结局。具体事件规则高于引擎默认和世界通用事实，但不得改动五个输出模板、固定枚举或runtime绝对状态。

#资产白名单
##完整降级模式会装载本副本全部角色与场景；裁剪模式只装载候选事件asset_scope的传输并集和当前场景。无论哪种模式，实际出现在当前事件中的本地角色与目标场景都必须属于所选事件自己的core/possible范围，不得补写表外实体或借用其它候选事件的资产。
##current_team中的外来队员不需要出现在本表；他们的权威资料始终来自runtime。角色表中的当前队员不得再作为NPC或敌人生成。

#角色表
卡牌ID：300000001
名称：骸骨督军
职业：战士
轮数：1-24
条件：无
权重：0
场景：无
品质：3
性别：男
种族：不死族
性格：仇恨

卡牌ID：200000102
名称：持盾骷髅
职业：坦克
轮数：1-24
条件：无
权重：0
场景：无
品质：2
性别：男
种族：不死族
性格：仇恨

卡牌ID：200000103
名称：骨弓手
职业：弓箭手
轮数：1-24
条件：无
权重：0
场景：无
品质：2
性别：男
种族：不死族
性格：仇恨

卡牌ID：200000104
名称：自爆骨鼠
职业：战士
轮数：1-24
条件：无
权重：0
场景：无
品质：1
性别：男
种族：不死族
性格：仇恨

卡牌ID：100000003
名称：熔岩矮人王
职业：战士
轮数：1-24
条件：无
权重：0
场景：无
品质：4
性别：男
种族：矮人
性格：热血

卡牌ID：200000121
名称：花岗岩像鬼
职业：坦克
轮数：1-24
条件：无
权重：0
场景：无
品质：3
性别：男
种族：石像鬼
性格：优雅

卡牌ID：100000006
名称：星穹法师
职业：法师
轮数：1-24
条件：无
权重：0
场景：无
品质：2
性别：男
种族：人类
性格：睿智

卡牌ID：200000169
名称：大祭司埃莉诺
职业：牧师
轮数：1-24
条件：无
权重：0
场景：无
品质：3
性别：女
种族：人类
性格：沉稳庄严

卡牌ID：200000129
名称：村长艾德
职业：平民
轮数：1-7
条件：无
权重：0
场景：艾德村庄
品质：1
性别：男
种族：人族
性格：善良

卡牌ID：200000130
名称：史莱姆
职业：战士
轮数：1-6
条件：无
权重：50
场景：艾德村庄、遗忘洞穴
品质：1
性别：男
种族：兽族
性格：懦弱

卡牌ID：200000145
名称：史莱姆王
职业：战士
轮数：2-7
条件：无
权重：0
场景：遗忘洞穴
品质：2
性别：男
种族：兽族
性格：愚蠢

卡牌ID：200000131
名称：猎人马克
职业：战士
轮数：1-8
条件：无
权重：0
场景：艾德村庄、酒馆、幽暗森林
品质：2
性别：男
种族：人族
性格：勇敢

卡牌ID：100000001
名称：实习牧师
职业：法师
轮数：1-8
条件：无
权重：40
场景：神圣教堂
品质：4
性别：女
种族：人族
性格：优雅

卡牌ID：290000011
名称：重甲守卫
职业：战士
轮数：1-7
条件：无
权重：40
场景：艾德村庄
品质：4
性别：男
种族：人族
性格：优雅

卡牌ID：290000012
名称：林地猎人
职业：弓箭手
轮数：2-10
条件：无
权重：50
场景：幽暗森林、精灵营地
品质：4
性别：男
种族：人族
性格：优雅

卡牌ID：290000013
名称：游荡者
职业：刺客
轮数：1-9
条件：无
权重：40
场景：酒馆、幽暗森林
品质：4
性别：女
种族：人族
性格：优雅

卡牌ID：200000150
名称：布伦南·铁砧
职业：战士
轮数：1-7
条件：无
权重：30
场景：铁匠铺
品质：2
性别：男
种族：人类
性格：沉稳可靠

卡牌ID：200000151
名称：奥利维亚·火锤
职业：战士
轮数：1-7
条件：无
权重：30
场景：铁匠铺
品质：2
性别：女
种族：人类
性格：热情开朗

卡牌ID：200000164
名称：吟游诗人塞琳娜
职业：法师
轮数：1-7
条件：无
权重：30
场景：酒馆
品质：2
性别：女
种族：人类
性格：开朗浪漫

卡牌ID：200000165
名称：老板娘玛莎
职业：战士
轮数：1-7
条件：无
权重：30
场景：酒馆
品质：1
性别：女
种族：人类
性格：热情豪爽

卡牌ID：200000189
名称：主教劳伦斯
职业：牧师
轮数：1-8
条件：无
权重：0
场景：神圣教堂、光明神殿
品质：3
性别：男
种族：人类
性格：沉稳威严

卡牌ID：200000190
名称：祭司索菲亚
职业：牧师
轮数：1-8
条件：无
权重：30
场景：神圣教堂
品质：2
性别：女
种族：人类
性格：热情善良

卡牌ID：200000155
名称：艾露恩·影叶
职业：战士
轮数：3-10
条件：无
权重：0
场景：幽暗森林、精灵营地
品质：3
性别：女
种族：精灵
性格：果敢

卡牌ID：200000156
名称：莱戈拉斯·绿溪
职业：刺客
轮数：3-10
条件：无
权重：40
场景：幽暗森林、精灵营地
品质：2
性别：男
种族：精灵
性格：单纯

卡牌ID：200000158
名称：凯勒布理安·银矢
职业：弓箭手
轮数：3-10
条件：无
权重：40
场景：幽暗森林、精灵营地
品质：3
性别：男
种族：精灵
性格：单纯

卡牌ID：200000160
名称：格洛芬德尔·橡木盾
职业：战士
轮数：3-10
条件：无
权重：40
场景：幽暗森林、精灵营地
品质：2
性别：男
种族：精灵
性格：单纯

卡牌ID：200000224
名称：巨熊
职业：坦克
轮数：2-10
条件：无
权重：50
场景：幽暗森林
品质：2
性别：男
种族：兽族
性格：狂野

卡牌ID：200000226
名称：狂狼
职业：战士
轮数：2-10
条件：无
权重：50
场景：幽暗森林
品质：1
性别：男
种族：人类
性格：孤傲

卡牌ID：200000227
名称：林地步兵
职业：战士
轮数：2-10
条件：无
权重：50
场景：幽暗森林
品质：1
性别：男
种族：人类
性格：警惕

卡牌ID：200000235
名称：森林捕猎者
职业：弓箭手
轮数：2-10
条件：无
权重：50
场景：幽暗森林
品质：1
性别：男
种族：人类
性格：冷静

卡牌ID：200000109
名称：毒藤母体
职业：法师
轮数：3-11
条件：corruption_value > 20
权重：200
场景：幽暗森林、幽灵沼泽
品质：3
性别：女
种族：植物
性格：偏执

卡牌ID：200000110
名称：荆棘守卫
职业：战士
轮数：3-11
条件：corruption_value > 20
权重：200
场景：幽暗森林、幽灵沼泽
品质：2
性别：女
种族：植物
性格：偏执

卡牌ID：200000111
名称：喷吐毒花
职业：法师
轮数：3-11
条件：corruption_value > 20
权重：200
场景：幽暗森林、幽灵沼泽
品质：1
性别：女
种族：植物
性格：偏执

卡牌ID：200000112
名称：孢子蘑菇
职业：法师
轮数：3-11
条件：corruption_value > 20
权重：200
场景：幽暗森林、幽灵沼泽
品质：1
性别：女
种族：植物
性格：偏执

卡牌ID：200000208
名称：苔藓古卫
职业：坦克
轮数：3-11
条件：corruption_value > 20
权重：200
场景：幽暗森林、幽灵沼泽
品质：1
性别：男
种族：德鲁伊
性格：古老

卡牌ID：200000132
名称：幽灵莉娜
职业：刺客
轮数：6-11
条件：无
权重：0
场景：幽灵沼泽
品质：3
性别：女
种族：幽灵
性格：阴暗

卡牌ID：200000133
名称：普通幽灵
职业：战士
轮数：6-11
条件：无
权重：50
场景：幽灵沼泽
品质：1
性别：男
种族：幽灵
性格：阴暗

卡牌ID：300000006
名称：哀嚎女妖
职业：术士
轮数：6-12
条件：corruption_value > 20
权重：200
场景：幽灵沼泽、吸血鬼庄园
品质：1
性别：女
种族：恶魔
性格：疯狂

卡牌ID：200000204
名称：诅咒娃娃
职业：法师
轮数：6-12
条件：无
权重：50
场景：幽灵沼泽、吸血鬼庄园
品质：1
性别：女
种族：恶魔
性格：怨毒

卡牌ID：200000225
名称：骷髅火枪手
职业：弓箭手
轮数：6-12
条件：无
权重：50
场景：幽灵沼泽、吸血鬼庄园
品质：1
性别：男
种族：不死族
性格：冷酷

卡牌ID：200000241
名称：亡灵守卫
职业：坦克
轮数：6-12
条件：corruption_value > 20
权重：200
场景：幽灵沼泽、吸血鬼庄园
品质：1
性别：男
种族：不死族
性格：忠诚

卡牌ID：200000242
名称：亡灵巫师
职业：术士
轮数：6-12
条件：corruption_value > 20
权重：200
场景：幽灵沼泽、吸血鬼庄园
品质：1
性别：男
种族：不死族
性格：阴险

卡牌ID：300000004
名称：吸血鬼贵族
职业：法师
轮数：6-12
条件：无
权重：0
场景：吸血鬼庄园
品质：3
性别：男
种族：不死族
性格：阴暗

卡牌ID：200000147
名称：吸血鬼仆从盾
职业：战士
轮数：6-12
条件：无
权重：50
场景：吸血鬼庄园
品质：2
性别：男
种族：不死族
性格：阴暗

卡牌ID：200000118
名称：影刃刺客
职业：刺客
轮数：6-12
条件：无
权重：50
场景：吸血鬼庄园
品质：2
性别：女
种族：暗精灵
性格：神秘

卡牌ID：200000119
名称：诅咒巫师
职业：法师
轮数：6-12
条件：无
权重：50
场景：吸血鬼庄园
品质：3
性别：女
种族：暗精灵
性格：神秘

卡牌ID：200000134
名称：镇长汤姆
职业：平民
轮数：10-16
条件：无
权重：0
场景：河畔镇、黑市、强盗营地
品质：2
性别：男
种族：人族
性格：暴躁

卡牌ID：200000135
名称：黑暗商人
职业：平民
轮数：10-16
条件：无
权重：0
场景：河畔镇、黑市、强盗营地
品质：3
性别：男
种族：人族
性格：暴躁

卡牌ID：200000136
名称：强盗头领
职业：弓箭手
轮数：10-16
条件：无
权重：0
场景：河畔镇、黑市、强盗营地
品质：3
性别：男
种族：人族
性格：霸道

卡牌ID：200000137
名称：普通强盗
职业：坦克
轮数：10-16
条件：无
权重：0
场景：河畔镇、黑市、强盗营地
品质：1
性别：男
种族：人族
性格：怯懦

卡牌ID：300000005
名称：豺狼人督头
职业：战士
轮数：10-18
条件：无
权重：50
场景：强盗营地、黑风山脉
品质：2
性别：男
种族：兽族
性格：贪婪

卡牌ID：200000106
名称：双刀豺狼人
职业：战士
轮数：10-18
条件：无
权重：50
场景：强盗营地、黑风山脉
品质：1
性别：男
种族：兽族
性格：贪婪

卡牌ID：200000107
名称：投网豺狼人
职业：弓箭手
轮数：10-18
条件：无
权重：50
场景：强盗营地、黑风山脉
品质：1
性别：男
种族：兽族
性格：贪婪

卡牌ID：300000008
名称：癫狂豺狼萨满
职业：法师
轮数：10-18
条件：无
权重：50
场景：强盗营地、黑风山脉
品质：2
性别：男
种族：兽族
性格：贪婪

卡牌ID：200000113
名称：地精工头
职业：坦克
轮数：9-17
条件：无
权重：50
场景：河畔镇、黑市、强盗营地
品质：3
性别：男
种族：地精
性格：疯狂

卡牌ID：200000114
名称：地精拳击手
职业：战士
轮数：9-17
条件：无
权重：50
场景：河畔镇、黑市、强盗营地
品质：1
性别：男
种族：地精
性格：疯狂

卡牌ID：200000115
名称：火箭筒地精
职业：弓箭手
轮数：9-17
条件：无
权重：50
场景：河畔镇、黑市、强盗营地
品质：1
性别：男
种族：地精
性格：疯狂

卡牌ID：200000116
名称：维修地精
职业：牧师
轮数：9-17
条件：无
权重：50
场景：河畔镇、黑市、强盗营地
品质：2
性别：男
种族：地精
性格：疯狂

卡牌ID：200000162
名称：卫兵队长理查德
职业：战士
轮数：10-16
条件：无
权重：0
场景：河畔镇、城市广场
品质：2
性别：男
种族：人类
性格：勇敢正直

卡牌ID：200000163
名称：商人格雷厄姆
职业：刺客
轮数：10-16
条件：无
权重：40
场景：河畔镇、旅店、城市广场
品质：1
性别：男
种族：人类
性格：狡诈精明

卡牌ID：200000166
名称：侍者威尔
职业：刺客
轮数：10-16
条件：无
权重：40
场景：河畔镇、旅店、城市广场
品质：1
性别：男
种族：人类
性格：阴冷寡言

卡牌ID：200000192
名称：学者以西结
职业：法师
轮数：10-16
条件：无
权重：40
场景：河畔镇、旅店、城市广场
品质：2
性别：男
种族：人类
性格：执着严谨

卡牌ID：200000193
名称：治疗师丽贝卡
职业：牧师
轮数：10-16
条件：无
权重：40
场景：河畔镇、旅店、城市广场
品质：2
性别：女
种族：人类
性格：开朗温柔

卡牌ID：200000206
名称：暗影窃贼
职业：盗贼
轮数：10-17
条件：无
权重：50
场景：黑市、强盗营地
品质：1
性别：男
种族：人类
性格：狡猾

卡牌ID：200000246
名称：银月刺客
职业：刺客
轮数：10-17
条件：无
权重：50
场景：黑市、强盗营地
品质：2
性别：男
种族：人类
性格：冷酷

卡牌ID：200000249
名称：优雅毒师
职业：术士
轮数：10-17
条件：无
权重：50
场景：黑市、强盗营地
品质：2
性别：男
种族：人类
性格：阴险

卡牌ID：200000148
名称：古老守护者
职业：法师
轮数：11-17
条件：无
权重：0
场景：古老神庙
品质：4
性别：男
种族：石像鬼
性格：正义

卡牌ID：200000210
名称：雷电符文巨魔像
职业：战士
轮数：11-17
条件：无
权重：50
场景：古老神庙
品质：2
性别：男
种族：石像鬼
性格：狂暴

卡牌ID：200000174
名称：布瑞娜·熔炉之符
职业：法师
轮数：14-20
条件：无
权重：0
场景：黑风山脉、矮人矿洞
品质：3
性别：女
种族：矮人
性格：睿智

卡牌ID：200000175
名称：索林·铁砧咆哮
职业：战士
轮数：14-20
条件：无
权重：50
场景：黑风山脉、矮人矿洞
品质：2
性别：男
种族：矮人
性格：勇猛

卡牌ID：200000236
名称：山民祭祀
职业：牧师
轮数：14-20
条件：无
权重：50
场景：黑风山脉、矮人矿洞
品质：1
性别：男
种族：人类
性格：虔诚

卡牌ID：200000237
名称：山丘领主
职业：战士
轮数：14-20
条件：无
权重：50
场景：黑风山脉、矮人矿洞
品质：2
性别：男
种族：人类
性格：固执

卡牌ID：200000239
名称：霜鬃猛犸
职业：坦克
轮数：14-20
条件：无
权重：50
场景：黑风山脉、矮人矿洞
品质：2
性别：男
种族：兽族
性格：沉稳

卡牌ID：200000149
名称：巨龙
职业：法师
轮数：15-20
条件：无
权重：0
场景：巨龙巢穴
品质：4
性别：男
种族：龙族
性格：残暴

卡牌ID：300000002
名称：幼龙·辛萨瑞拉
职业：战士
轮数：14-20
条件：无
权重：50
场景：黑风山脉、巨龙巢穴
品质：2
性别：女
种族：巨龙
性格：凶狠

卡牌ID：200000177
名称：幼龙·纳兹瑞尔
职业：战士
轮数：14-20
条件：无
权重：50
场景：黑风山脉、巨龙巢穴
品质：2
性别：男
种族：巨龙
性格：凶狠

卡牌ID：300000007
名称：黑翼飞龙
职业：战士
轮数：14-20
条件：无
权重：50
场景：黑风山脉、巨龙巢穴
品质：2
性别：男
种族：龙族
性格：贪婪

卡牌ID：200000138
名称：城堡守卫
职业：坦克
轮数：16-22
条件：无
权重：0
场景：魔王城堡、光明神殿
品质：2
性别：男
种族：人族
性格：正义

卡牌ID：200000139
名称：古老法师
职业：法师
轮数：16-22
条件：无
权重：0
场景：魔王城堡、光明神殿
品质：4
性别：男
种族：人族
性格：睿智

卡牌ID：200000140
名称：恶魔守卫
职业：坦克
轮数：16-24
条件：无
权重：50
场景：魔王城堡、恶魔祭坛、魔王大厅
品质：3
性别：男
种族：恶魔族
性格：固执

卡牌ID：200000141
名称：魔王
职业：法师
轮数：20-24
条件：无
权重：0
场景：魔王大厅
品质：4
性别：男
种族：恶魔族
性格：阴暗

卡牌ID：200000142
名称：魔王侍卫盾
职业：坦克
轮数：20-24
条件：无
权重：0
场景：魔王大厅
品质：3
性别：男
种族：恶魔族
性格：阴暗

卡牌ID：200000143
名称：魔王侍卫剑
职业：战士
轮数：20-24
条件：无
权重：0
场景：魔王大厅
品质：3
性别：男
种族：恶魔族
性格：阴暗

卡牌ID：200000144
名称：魔王侍卫牧师
职业：牧师
轮数：20-24
条件：无
权重：0
场景：魔王大厅
品质：3
性别：男
种族：恶魔族
性格：阴暗

卡牌ID：200000183
名称：小恶魔·扎克
职业：刺客
轮数：17-24
条件：无
权重：50
场景：魔王城堡、恶魔祭坛
品质：1
性别：男
种族：恶魔
性格：狡诈

卡牌ID：200000186
名称：钢颚·加尔
职业：战士
轮数：17-24
条件：无
权重：50
场景：魔王城堡、恶魔祭坛
品质：2
性别：男
种族：恶魔
性格：狡诈

卡牌ID：200000187
名称：血角·赛娜
职业：战士
轮数：17-24
条件：无
权重：50
场景：魔王城堡、恶魔祭坛
品质：2
性别：女
种族：恶魔
性格：热血

卡牌ID：200000229
名称：魔剑术士
职业：术士
轮数：17-24
条件：无
权重：50
场景：魔王城堡、恶魔祭坛
品质：2
性别：男
种族：人类
性格：冷酷

卡牌ID：200000201
名称：梦境之主
职业：术士
轮数：18-24
条件：corruption_value > 20
权重：0
场景：时间裂缝
品质：4
性别：女
种族：恶魔
性格：神秘

卡牌ID：200000203
名称：时空穿越者
职业：法师
轮数：18-24
条件：无
权重：0
场景：时间裂缝
品质：2
性别：女
种族：人类
性格：睿智

#场景ID映射
##scene_village：艾德村庄
##scene_church：神圣教堂
##scene_forge：铁匠铺
##scene_tavern：酒馆
##scene_forgotten_cave：遗忘洞穴
##scene_forest：幽暗森林
##scene_elf_camp：精灵营地
##scene_vampire_manor：吸血鬼庄园
##scene_swamp：幽灵沼泽
##scene_rivertown：河畔镇
##scene_square：城市广场
##scene_inn：旅店
##scene_black_market：黑市
##scene_ancient_temple：古老神庙
##scene_mountains：黑风山脉
##scene_dwarf_mine：矮人矿洞
##scene_dragon_nest：巨龙巢穴
##scene_bandit_camp：强盗营地
##scene_castle：魔王城堡
##scene_demon_altar：恶魔祭坛
##scene_light_temple：光明神殿
##scene_time_rift：时间裂缝
##scene_throne：魔王大厅
##输出scene.id与scene.name时必须使用同一行映射，不得混搭或创造近义名称。

#关键实体映射
##ghost_lina：幽灵莉娜，card_id=200000132；hunter_mark：猎人马克，card_id=200000131。二者使用角色表中的独立card_id，不得使用空card_id或互相混用。
##其它角色优先使用角色表中唯一card_id；entity_key使用稳定的小写英文标识，同一实体整局保持一致。

#场景白名单
##只能使用以下精确scene_name。场景转换必须符合位置关系；不能从一个一级场景无铺垫跳到不相邻场景。

##场景名称: 艾德村庄
##场景类型: 一级场景
##场景位置关系: 起点；连接神圣教堂与幽暗森林
##场景的来源和故事: 边境人类村庄，史莱姆袭击打破了长期和平
##场景的特点: 木石房屋、泥泞村道与临时路障；适合初期村庄危机、求援和早期休整

##场景名称: 神圣教堂
##场景类型: 一级场景
##场景位置关系: 位于艾德村庄附近；连接光明神殿与幽暗森林
##场景的来源和故事: 光明信徒建立的古老教堂，是净化腐化与取得圣水的地点
##场景的特点: 石砌圣坛、旧图书室与微弱圣光；可提供净化、圣水与古老信仰线索

##场景名称: 铁匠铺
##场景类型: 二级场景
##场景位置关系: 从属于艾德村庄
##场景的来源和故事: 退役战士经营的村庄工坊
##场景的特点: 炉火、砧台与工具架；只用于合理的修整和线索，不创造表外装备奖励

##场景名称: 酒馆
##场景类型: 二级场景
##场景位置关系: 从属于艾德村庄
##场景的来源和故事: 旅行者与村民交换消息的公共空间
##场景的特点: 温暖、喧闹、消息混杂；可铺垫猎人马克和通往幽暗森林的路径

##场景名称: 遗忘洞穴
##场景类型: 二级场景
##场景位置关系: 位于艾德村庄与幽暗森林交界
##场景的来源和故事: 留有史莱姆活动痕迹的古代洞穴
##场景的特点: 潮湿壁画、浅水与粘液；适合黏液生物、旧封印和隐蔽洞穴事件

##场景名称: 幽暗森林
##场景类型: 一级场景
##场景位置关系: 连接艾德村庄、幽灵沼泽、吸血鬼庄园与河畔镇
##场景的来源和故事: 被腐化侵蚀的古老精灵林地
##场景的特点: 潮湿、低光、方向感易失；用于追踪怪物异动和铺垫莉娜

##场景名称: 精灵营地
##场景类型: 二级场景
##场景位置关系: 从属于幽暗森林
##场景的来源和故事: 受结界保护的秘密营地
##场景的特点: 树屋、星光符文与警惕的守望；只允许角色表中存在的角色发言

##场景名称: 吸血鬼庄园
##场景类型: 二级场景
##场景位置关系: 从属于幽暗森林
##场景的来源和故事: 吸血鬼贵族的阴冷领地
##场景的特点: 石棺、血色帷幕与古老契约；适合血族契约、交易和冲突事件

##场景名称: 幽灵沼泽
##场景类型: 二级场景
##场景位置关系: 从属于幽暗森林，之后可通往河畔镇
##场景的来源和故事: 被莉娜及普通幽灵困住的迷雾湿地
##场景的特点: 冷雾、泥潭与断续低语；适合亡灵记忆、净化和失踪调查

##场景名称: 河畔镇
##场景类型: 一级场景
##场景位置关系: 连接幽暗森林、黑风山脉与古老神庙
##场景的来源和故事: 贸易繁荣却被强盗与秘密交易侵蚀的人类城镇
##场景的特点: 河港、集市与紧张巡逻；适合中期调查、贸易冲突和阴谋事件

##场景名称: 城市广场
##场景类型: 二级场景
##场景位置关系: 从属于河畔镇
##场景的来源和故事: 镇民集会与公告中心
##场景的特点: 摊位、喷泉、告示和可被调查的公共记录

##场景名称: 旅店
##场景类型: 二级场景
##场景位置关系: 从属于河畔镇
##场景的来源和故事: 商旅休息并交换路线情报的场所
##场景的特点: 客房、餐厅和来自山路的流言；可作休整或线索事件

##场景名称: 黑市
##场景类型: 二级场景
##场景位置关系: 从属于河畔镇
##场景的来源和故事: 与强盗和黑暗商人相连的地下交易网络
##场景的特点: 隐蔽入口、暗号与伪造账目；适合回收走私、账目与腐化运输线索

##场景名称: 古老神庙
##场景类型: 二级场景
##场景位置关系: 位于河畔镇郊外
##场景的来源和故事: 守护神圣之心的遗迹
##场景的特点: 符文谜题、石像与陷阱；适合古老封印、遗物探索和高风险解谜

##场景名称: 黑风山脉
##场景类型: 一级场景
##场景位置关系: 连接河畔镇、巨龙巢穴与魔王城堡
##场景的来源和故事: 曾属矮人王国、现被魔王势力控制的险峻山地
##场景的特点: 悬崖、废矿道、寒风与恶魔巡逻；用于决战前升级压力

##场景名称: 矮人矿洞
##场景类型: 二级场景
##场景位置关系: 从属于黑风山脉
##场景的来源和故事: 被遗弃的矮人采矿通道
##场景的特点: 矿车、支撑梁与旧路线标记；可提供路线线索，不创造表外矿物道具

##场景名称: 巨龙巢穴
##场景类型: 二级场景
##场景位置关系: 从属于黑风山脉
##场景的来源和故事: 巨龙守护古老力量与魔王情报的火热洞窟
##场景的特点: 龙骨、焦岩与财宝堆；适合巨龙协商、巢穴防卫和高危战斗

##场景名称: 强盗营地
##场景类型: 二级场景
##场景位置关系: 位于河畔镇通往黑风山脉的入口
##场景的来源和故事: 运输魔王物资的强盗据点
##场景的特点: 帐篷、赃物和运输账目；适合回收强盗、货运和城镇阴谋线索

##场景名称: 魔王城堡
##场景类型: 一级场景
##场景位置关系: 位于黑风山脉深处；连接恶魔祭坛、时间裂缝与魔王大厅
##场景的来源和故事: 由黑暗力量维系的魔王堡垒
##场景的特点: 高墙、符文、陷阱和恶魔守卫；适合城门突破、潜入和后期防线事件

##场景名称: 恶魔祭坛
##场景类型: 二级场景
##场景位置关系: 从属于魔王城堡
##场景的来源和故事: 为魔王防护持续供能的腐化祭坛
##场景的特点: 黑暗符文、祭品与脉动能量；适合恶魔契约、腐化仪式和黑暗交易

##场景名称: 光明神殿
##场景类型: 二级场景
##场景位置关系: 从属于神圣教堂，可通过古老法师的知识与魔王城堡产生剧情联系
##场景的来源和故事: 封存光明护符的地下神殿
##场景的特点: 神像、净化法阵与试炼；适合净化、真相审判和信仰试炼

##场景名称: 时间裂缝
##场景类型: 二级场景
##场景位置关系: 只在魔王城堡或其邻近区域显现
##场景的来源和故事: 魔王时空法术失控形成的不稳定通道
##场景的特点: 重复影像、错位声音与未来残片；适合时间异常、重复行动和未来线索

##场景名称: 魔王大厅
##场景类型: 二级场景
##场景位置关系: 从属于魔王城堡，是冒险终点
##场景的来源和故事: 魔王王座及最终防护核心所在
##场景的特点: 压迫性的王座、黑暗结界与四名指定敌人；用于最终对峙


#档位事件权重
##高压事件为R_P1_SLIME_TRAIL、R_P2_VAMPIRE_ENVOY、R_P3_BANDIT_TOLL、R_P4_DEMON_SENTRY、R_P4_SIEGE_CART、R_P5_SOUL_PRISON、R_P5_CULT_QUARTERMASTER、R_P5_THRONE_GUARD。
##恢复事件为R_P1_TAINTED_GRANARY、R_P2_DROWNED_CAMP、R_P3_PLAGUE_WELL、R_P4_COLLAPSED_SHRINE、R_P5_TIME_CHAMBER。按引擎档位倍率调整权重。

#场景迁移白名单
##程序在接受“新一轮事件”时用manifest把scene_name映射为目标scene_id，并按下列无向连接校验；同场景重访始终合法。二级场景先连接其所属一级场景，只有下列明确额外连接允许跨支路。
##scene_village连接scene_church、scene_forge、scene_tavern、scene_forgotten_cave、scene_forest；scene_forest连接scene_elf_camp、scene_vampire_manor、scene_swamp、scene_rivertown；scene_swamp额外连接scene_rivertown。
##scene_rivertown连接scene_square、scene_inn、scene_black_market、scene_ancient_temple、scene_bandit_camp、scene_mountains；scene_mountains连接scene_dwarf_mine、scene_dragon_nest、scene_bandit_camp、scene_castle。
##scene_castle连接scene_demon_altar、scene_time_rift、scene_throne；scene_church额外连接scene_light_temple；scene_light_temple只可在拥有M03_LINA_BLESSING、900003或cleanse≥2时与scene_castle形成一次剧情连接。
##固定主线目标场景由事件表授权：M01 scene_village、M02 scene_forest、M03 scene_swamp、M04 scene_rivertown、M05 scene_castle、M06与B_P5_LAST_STAND均为scene_throne。固定轮到来时，AI可在该新事件开场叙述穿越连接路径，并把scene_name直接锁定为目标；程序不要求另造一个无选择的过渡事件。

#战斗实体分类
##只有本节或具体事件敌人组明确列出的角色才能进入enemies。角色表的权重只控制叙事候选，不代表可作为敌人；叙事NPC、受救援者和商人不得因权重或品质被当成敌人。
##可重复普通敌人：史莱姆、巨熊、狂狼、荆棘守卫、喷吐毒花、孢子蘑菇、苔藓古卫、普通幽灵、诅咒娃娃、骷髅火枪手、亡灵守卫、亡灵巫师、吸血鬼仆从盾、影刃刺客、普通强盗、双刀豺狼人、投网豺狼人、地精拳击手、火箭筒地精、维修地精、暗影窃贼、银月刺客、小恶魔·扎克、钢颚·加尔、血角·赛娜、魔剑术士。
##可替换精英敌人：毒藤母体、哀嚎女妖、诅咒巫师、豺狼人督头、癫狂豺狼萨满、地精工头、优雅毒师、雷电符文巨魔像、霜鬃猛犸、黑翼飞龙、恶魔守卫。只能在角色表当前轮数、条件和场景均合法时使用。
##固定唯一敌人：史莱姆王、幽灵莉娜、吸血鬼贵族、强盗头领、巨龙、魔王、魔王侍卫盾、魔王侍卫剑、魔王侍卫牧师。只能由对应主线、隐藏事件、B_P5_LAST_STAND或明确点名的R_P5_THRONE_GUARD使用，不参与档位随机增加或替换。
##hard/nightmare强化只在上述普通/精英池内进行；若没有同场景合法对象则保持normal组合。不得用实习牧师、重甲守卫、猎人、林地士兵、镇民、商人、治疗师、学者、山民或其它叙事角色补位。

#圣物事件影响
##持有10002“橡木护符”时，幽暗森林或幽灵沼泽中涉及辨路、腐化植被或自然生存的最近一次检定获得优势（+2）；持有10003“鸦羽墨囊”时，涉及普通幽灵、亡灵记忆或尸灯真伪的最近一次检定获得优势（+2）。
##两者不降低基础难度、不重复叠加同源优势、不对Boss战生效。未列出的圣物不产生AI事件层影响，战斗数值仍由程序处理。

#隐藏事件的线索与计划
##隐藏事件不是无提示抽奖。第一次结算时，若程序没有提供隐藏计划，AI依据run_seed、路线和场景从H01-H07内部选择1-3项，用稳定flag持久化；合法计划flag只有PLAN_H01、PLAN_H02、PLAN_H03、PLAN_H04、PLAN_H05、PLAN_H06、PLAN_H07。未有对应PLAN flag的隐藏事件不得临时生成。
##隐藏事件正式出现前，至少一个较早事件须加入对应线索flag；合法线索flag只有HINT_H01、HINT_H02、HINT_H03、HINT_H04、HINT_H05、HINT_H06、HINT_H07，并以世界内迹象写入memory_notes或unresolved_hooks；H01黏液王冠与避铁痕迹，H02失血兽尸与封蜡请柬，H03残图缺口与古老铭文，H04焦风、巨大抓痕与鳞片回响，H05动作重演与失时钟声，H06逆风钟鸣与微光圣痕，H07无火灰烬与地下搏动。
##玩家只有在看见线索并满足事件条件后才可进入隐藏事件。线索不直接写“这里有隐藏事件”或承诺奖励；它应让细心玩家能够推断值得继续调查。
##若阶段结束仍未满足条件，PLAN/HINT可以作为本局错过的支线保留，不强行插入。跨局recent_run_summaries用于降低相同隐藏计划连续出现的概率。

#Roguelike总结构
##标准局为22-24个决策轮，分为五个阶段。固定主线约25%，路线回收约25%，随机事件约40%，稀有隐藏事件约10%。
##P1轮1-4“求援与启程”：M01固定第1轮，M02固定第4轮。
##P2轮5-8“追踪与异象”：M03固定第8轮。
##P3轮9-12“情报与阴谋”：M04固定第12轮。
##P4轮13-17“山路与城门”：M05固定第17轮。
##P5轮18-24“城内与决战”：M06安排在第22-24轮；第21轮后不得再生成与终局无关的事件。

#AI受控事件调度
##程序明确指定本轮事件时直接使用，AI不改选；程序未指定时由AI承担调度。
##程序可以先依据event_schedule_index只做阶段、轮数、固定主线和已完成事件的硬过滤，再把过滤后的完整事件块作为本轮上下文。该过滤不判断PLAN/HINT、道具、路线分、NPC关系、场景细节或叙事适配；这些复杂条件仍由AI根据事件正文与完整runtime状态判断。
##上下文同时给出included_event_ids时，它是本次调用唯一可选事件集合。AI不得选择未装载事件；若其中某些事件因复杂前置不成立，则从其余合格事件中调度。集合过滤后无合格项时属于程序降级问题，不得创造包外事件。
##程序直接读取候选事件YAML的asset_scope，合并core/possible角色与场景并补入当前场景作为传输上下文；不扫描rules_text推断关联。AI选定event_id后必须回到该事件自己的asset_scope，不能借用其它候选事件带入的资产。
##调度优先级：终章阈值→当前固定主线轮→主线窗口上限→必要场景过渡→本局合格隐藏事件→未回收的主要路线事件→普通随机蓝图。
##主线与隐藏事件每局最多一次；每阶段最多1个隐藏事件；整局最多3个隐藏事件。
##程序可选提供event_candidates；提供时保持输入顺序，先过滤目标场景可达性、阶段、条件、已触发与近期重复项，再按weight选择。run_seed为整数时使用event_roll=(abs(run_seed)+current_round×11+已触发随机事件数×7) mod 总权重，选择累计权重首次大于event_roll的候选。
##未提供event_candidates时，从本次included_event_ids对应的事件YAML中按阶段职责、因果回收与反重复规则选择；程序应缓存完整“新一轮事件”响应，防止重试改选。
##AI调度不能改变主线轮次、隐藏事件上限、永久奖励边界和场景连通关系。选定蓝图后必须把稳定ID写入新一轮事件的event_id，并在结算story_patch.completed_event_id中原样返回。

#事件牌库与跨局反重复
##AI只能从下列25个具体事件骨架中选择随机事件，并在对应阶段的当前场景或迁移白名单允许的相邻目标场景中具体化；目标由新事件scene_name锁定。不得只选择“战斗、资源、交涉”等抽象类别后自由编造没有骨架的事件。
##同一局不得重复同一事件ID；最近3轮不得重复相同敌人组合、核心冲突或奖励结构。连续3轮没有恢复机会时，提高本阶段恢复骨架的选择优先级。
##程序可选输入recent_run_summaries，最多3项；生产推荐使用结构化对象，字段为run_archetype、run_modifier_ids、hidden_event_ids、random_event_ids、dominant_route、ending_variant与可选content。兼容期也可只传上一局终章content；未提供时只执行单局反重复。
##选择新一局内容时：主叙事压力不得与上一局相同；两个词缀与上一局最多重合1个；隐藏事件与上一局最多重合1个；上一局明确出现过的随机事件骨架权重乘0.25，前第2-3局明确出现过的随机事件骨架权重乘0.5。候选不足时依次放宽随机事件、隐藏事件、词缀限制，但不得改变固定主线。
##上一局终章是纯文本时，AI按其中明确出现的人物、场景、异常、重大抉择和结局做语义去重，不得臆造终章未提及的事件ID。
##程序明确提供event_candidates时，仍先应用场景、阶段、条件、已触发、recent_run_summaries与近期重复过滤，再按最终权重使用既有run_seed公式选择。
##程序未提供event_candidates时，当前阶段所有条件合格且本局未出现的具体骨架基础权重均为10，再依次应用副本档位、机械词缀、跨局反重复和连续高压修正；最终权重最低为1。

#本局主压力与机械词缀
##run_archetype只允许corruption_hunt、scarcity、ghost_tide、underworld、time_fracture五种之一，决定主要叙事压力。生产环境由程序在start前按下列公式确定，AI不补选。
##主压力有序表为[corruption_hunt,scarcity,ghost_tide,underworld,time_fracture]。令base=abs(run_seed)，先取base mod 5；若与recent_run_summaries最近一局run_archetype相同，则循环后移1位。结果固定整局。
##每局选择2个run_modifier_ids。词缀有序表按下文出现顺序排列10项；第一项从(base+13) mod 10起循环取第一个合法项；第二项从(base+37) mod 10起循环扫描，必须与第一项不同互斥组。若第一项已经与最近一局重合，第二项还必须避开最近一局两个词缀；否则第二项最多允许造成1项跨局重合。程序保存结果并在首轮输入，AI只应用。所有数值效果只应用一次，检定最终仍限制在0-20。
##MOD_FAMINE 饥荒余波〔资源组〕：每轮档位基础消耗额外supply-1；R_P1_TAINTED_GRANARY、R_P2_DROWNED_CAMP、R_P4_SIEGE_CART基础权重×1.5。
##MOD_BROKEN_ROADS 断路风暴〔资源组〕：过渡、攀爬、涉水类检定难度+2；这类失败造成的supply损失额外-2；R_P1_BROKEN_BRIDGE、R_P4_AVALANCHE权重×1.5。
##MOD_GHOST_TIDE 亡魂潮〔异常组〕：幽灵与记忆类事件权重×1.5；相关净化检定难度-2，失败时corruption额外+3。
##MOD_TIME_ECHO 时序回声〔异常组〕：R_P2_ECHO_HUNTER、R_P5_TIME_CHAMBER和H05权重×1.75；每阶段第一次隐藏检定难度-2，但失败时corruption额外+3。
##MOD_BLOOD_MOON 血月围猎〔遭遇组〕：伏击与精英事件权重×1.5；战斗阵容按档位规则强化但仍最多4名；战斗失败或撤退额外supply-2。
##MOD_DEMON_PATROLS 恶魔巡猎〔遭遇组〕：P4-P5战斗事件权重×1.5；恶魔相关交涉检定难度+2；成功绕过恶魔时corruption-3。
##MOD_BLACK_MARKET 黑市暗潮〔交涉组〕：黑市、走私与交易事件权重×1.5；相关社交或狡诈检定难度-2；接受黑暗交易时corruption额外+3。
##MOD_FRACTURED_TRUST 猜疑蔓延〔交涉组〕：没有猎人信任、NPC承诺或证据时，社交检定难度+2；拥有任一真实信任依据时取消该惩罚并获得一个+2情境优势。
##MOD_SACRED_ECHO 圣迹复苏〔腐化组〕：净化事件权重×1.5；每次事件结算的corruption降低量额外增加3但单次最多降低20；黑暗交易的corruption增加量额外+3。
##MOD_DEEP_CORRUPTION 深层侵蚀〔腐化组〕：所有检定失败造成的corruption增加量额外+3；R_P3_PLAGUE_WELL、R_P5_SOUL_PRISON、H07权重×1.5；净化成功不受削弱。
##互斥组为资源、异常、遭遇、交涉、腐化；同组词缀不得同时选择。首轮必须通过天气、伤亡、NPC告诫或异常现象自然表现两个词缀，禁止直接朗读ID、倍率或规则；之后至少每4轮让一个词缀产生一次可见机械或叙事反馈。

#三条构筑路线
##combat：通过正面战斗、精英挑战和强行突破积累；优势是战斗修正和材料奖励触发标记，代价通常是生命或补给压力。
##scheme：通过调查、谈判、伪装和情报积累；优势是降低检定难度、绕过战斗和增加选项，代价通常是资源或失败后腐化。
##cleanse：通过净化、安抚和抵抗腐化积累；优势是降低腐化与净化结局，代价通常是消耗稀有局内道具。
##每个主线事件至少提供combat、scheme、cleanse中的两条路线；M03与M06必须同时提供三条。M04明确为战斗、调查与黑暗交易三种方法，其中后两者都计入scheme，不虚构净化路线。
##路线分数只是一局内的方向，不是职业锁。任何队伍都至少有一个可选方案；高路线分数提供优势，但不得让低分路线造成必死局。
##同一事件只给实际选择的一个主要路线+1。不得为了平衡同时增加多个路线。

#局内道具表
##所有局内道具离开副本清空。局内道具ID使用900000号段，与服务器永久圣物、因缘和装备材料ID隔离。
##900001 圣水：事件3净化路线消耗1；可在P1教堂事件获得。
##900002 魔王印记：事件5谋略路线消耗1；通过M04黑暗合作或稀有黑市事件获得。
##900003 圣心残片：事件6净化路线核心条件；通过H03古老神庙获得。
##900004 粘液核心：M04调查的优势来源；通过M01谋略成功或H01史莱姆王获得。
##900005 龙心余烬：M06战斗路线只产生可见战术反馈、不修改程序战斗数值；M06净化检定提供优势+2。通过H04巨龙事件获得。
##900006 时序碎片：可消耗以修复H05时间裂缝；持有时开放M06谋略路线并为该检定提供优势+2。通过M03或异常事件获得。
##900007 未来战术书：M06战斗路线只产生可见战术反馈；M06谋略检定提供优势+2。通过H05获得。
##900008 光明印记：增强M06净化路线；通过H06光明神殿获得。
##900009 腐化核心：获得时由H07一次性增加corruption+15；之后持有可开放M06谋略路线并为该检定提供优势+2，不再次增加腐化。通过H07恶魔祭坛获得。
##900010 龙鳞信物：触发H04；P4稀有探索获得。
##900011 古老地图：触发H03；P3线索事件获得。
##900020 猎人信任：M02追踪检定提供优势+2，不改变基础难度；M01解决危机后获得。
##900021 黑市账页：使M04谋略路线直接成功；P3线索事件获得。
##900022 莉娜记忆：使M05古老法师提供净化入口；M03非暴力解决获得。
##900050 材料奖励触发标记：纯协议层信号，只允许正count；程序立即拦截并生成具体材料，不加入current_package.tools、不显示内部ID或名称、不可消费。
##900060 圣物奖励触发标记：纯协议层信号，每局最多1次；程序立即拦截并生成具体圣物，不加入current_package.tools。
##900061 因缘奖励触发标记：纯协议层信号，每局最多1次；仅H04驯龙成功或以后明确授权的因缘事件产生，程序立即拦截并生成具体因缘。

#永久奖励授权
##仅授权局内道具表中的900050、900060、900061作为永久奖励触发信号；每个具体事件是否可以产生、次数上限和前置条件以事件表及随机事件规则为准。
##材料、圣物和因缘的具体内容由程序生成；AI只决定何时满足事件条件，不判断首通、周首次、概率、保底、账号拥有状态或最终入账。
#叙事与内容定位
##整体情绪是阴暗但可抵抗的英雄冒险：威胁真实、失败昂贵，但玩家的调查、牺牲和关系经营能够改变局势。事件应逐步揭示腐化运输、灵魂利用和时空操纵之间的联系，同时保留村民、商人、亡者与守护者的日常生活、善意、幽默、利益冲突和各自选择。
##场景只能使用资产表中的精确name；内部事件表的scene_id只用于选择场景，不得作为输出字段。场景转换遵循连接关系，不得瞬移到无关地图。
##主线、隐藏和随机事件都只能使用所选事件asset_scope中的本地角色与场景。core是事件可依赖的核心资产，possible由AI结合runtime选择；角色表的轮数、条件与权重仅用于策划资产生产，不再覆盖事件的显式范围。当前队员仍不得作为NPC或敌人。
#终章条件
##成功条件：M06的战斗、谋略、净化或B_P5_LAST_STAND之一按事件规则成功；AI在结算中输出对应成功flag与final_chapter=true，程序依据event_id、outcome与白名单把run_status设置为cleared。战斗路线只有程序返回victory后才可通关；谋略与净化路线只有对应检定成功后才可通关。
##失败条件除引擎通用资源与全灭阈值外，还包括M05失去全部可行入口、M06最终分支失败，以及副本事件明确使核心任务不可达。AI通过story_patch提案，最终run_status由程序确认。
##终章不少于800字，必须回收至少3项本局真实发生的路线、局内道具、重要选择、牺牲、词缀或隐藏/随机事件影响，不提未触发事件。
#目标与主线场景
##副本前提：队伍从边境怪物异动出发，逐步确认魔王正在利用腐化与时空法术操纵怪物和灵魂。
##核心目标：击败、净化或通过有充分证据和代价的方式真正解除魔王对世界的威胁。
##固定主线场景顺序：艾德村庄→幽暗森林→幽灵沼泽→河畔镇→黑风山脉→魔王城堡→魔王大厅。
#随机事件补充规则
##随机事件必须选择本次included_event_ids中某个R_P事件YAML，并严格使用其阶段、核心冲突、分支授权、奖励边界和asset_scope；具体NPC、敌人与目标场景不得越过该事件自己的core/possible范围。current_team始终可作为主角参与。
##材料奖励触发标记900050只允许由明确写有该奖励的具体骨架、主线或隐藏事件产生；普通事件一次最多count=1，精英事件一次最多count=2。material_reward_slots_remaining为0时不得输出。
##圣物奖励触发标记900060只能由R_P5_THRONE_GUARD或事件表明确授权的精英/稀有隐藏事件产生，每局最多1次；因缘触发标记900061仅能由H04驯龙成功或以后明确授权的因缘事件产生，每局最多1次。
##随机选项的直接数值变化限制为supply±3至10、corruption±3至15，再应用已选词缀明确规定的单次修正。gold或diamond只允许在骨架分别明确标记对应allowed且满足对应policy时输出。
##不得用随机事件新增世界地图、主线Boss、表外NPC、表外敌人、表外局内道具或未经程序揭晓的永久奖励。
#内容约束自检
##只在内部检查，不输出检查过程；通用模板、YAML、状态、检定和奖励协议由最终内部自检负责。
##1. event_generation存在included_event_ids时，event_id是否严格属于该集合；完整降级模式下是否属于M01-M06、H01-H07、B_P5_LAST_STAND或25个R_P事件；是否满足阶段、轮数、锁定场景、前置和未完成条件。不得创造带轮数后缀的动态ID。
##2. M01-M06是否遵守固定窗口与场景顺序；第21轮后是否只推进终局；M05/M06失败是否按替代入口和T3/T4规则处理。
##3. 隐藏事件是否同时拥有PLAN_Hxx、HINT_Hxx、合法场景与触发条件；每阶段最多1个、整局最多3个，且线索已经以世界内迹象出现。
##4. run_archetype是否为前文五种之一，run_modifier_ids是否恰为两个且不属于同一互斥组；词缀是否真正影响本轮而未重复结算。
##5. combat、scheme、cleanse是否只按实际选择改变；局内道具、前置flag和NPC关系是否在后续1-2个合格事件中产生明确反馈。
##6. 场景、NPC和敌人是否来自所选事件自己的asset_scope；是否没有借用其它候选事件仅为传输而装载的资产；current_team是否只作为主角参与。
##7. 900050是否仍有材料槽且符合事件授权；900060和900061是否各不超过1次；是否未把三个触发信号写进玩家可见文本或局内背包。
##8. 通关是否只来自M06或B_P5_LAST_STAND成功；是否只输出final_chapter提案而未增加run_status字段；失败是否没有成功路线分、成功奖励或虚假的魔王威胁解除。
`;

function splitTopLevelSections(source) {
  const matches = [...source.matchAll(/^#([^#\n].*)$/gm)];
  const sections = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    sections.set(matches[index][1].trim(), source.slice(start, end).trim());
  }
  return sections;
}

const dungeonSections = splitTopLevelSections(dungeonPromptSource);

function parseRoleAssets(sectionText) {
  const assets = {};
  const records = sectionText.replace(/^#角色表\s*/, "").split(/\n\s*\n/).map(record => record.trim()).filter(record => record.startsWith("卡牌ID："));
  for (const source of records) {
    const fields = Object.fromEntries(source.split("\n").map(line => {
      const separator = line.indexOf("：");
      return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const roundMatch = fields["轮数"]?.match(/^(\d+)-(\d+)$/);
    if (!fields["名称"] || !roundMatch) throw new Error(`无法解析角色资产: ${source.slice(0, 80)}`);
    assets[fields["名称"]] = Object.freeze({
      name: fields["名称"],
      card_id: fields["卡牌ID"],
      round_min: Number(roundMatch[1]),
      round_max: Number(roundMatch[2]),
      weight: Number(fields["权重"] ?? 0),
      scenes: Object.freeze((fields["场景"] ?? "").split("、").filter(scene => scene && scene !== "无")),
      source
    });
  }
  return Object.freeze(assets);
}

function parseSceneAssets(sectionText) {
  const matches = [...sectionText.matchAll(/^##场景名称:\s*([^\n]+)$/gm)];
  const assets = {};
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index;
    const end = index + 1 < matches.length ? matches[index + 1].index : sectionText.length;
    const name = matches[index][1].trim();
    assets[name] = Object.freeze({ name, source: sectionText.slice(start, end).trim() });
  }
  return Object.freeze(assets);
}

function parseSceneIdMap(sectionText) {
  return Object.freeze(Object.fromEntries([...sectionText.matchAll(/^##(scene_[a-z_]+)：([^\n]+)$/gm)]
    .map(match => [match[1], match[2].trim()])));
}

export const roleAssetByName = parseRoleAssets(dungeonSections.get("角色表"));
export const sceneAssetByName = parseSceneAssets(dungeonSections.get("场景白名单"));
export const sceneNameById = parseSceneIdMap(dungeonSections.get("场景ID映射"));

const phaseRanges = Object.freeze({
  P1: Object.freeze([1, 4]),
  P2: Object.freeze([5, 8]),
  P3: Object.freeze([9, 12]),
  P4: Object.freeze([13, 17]),
  P5: Object.freeze([18, 24])
});

export const roleAssetById = Object.freeze(Object.fromEntries(Object.values(roleAssetByName).map(role => [role.card_id, role])));
export const sceneAssetById = Object.freeze(Object.fromEntries(Object.entries(sceneNameById).map(([sceneId, name]) => [sceneId, sceneAssetByName[name]])));

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function renderAssetRefs(refs, idKey, indent) {
  const prefix = " ".repeat(indent);
  return refs.map(ref => `${prefix}- ${idKey}: ${quoteYaml(ref[idKey])}\n${prefix}  name: ${quoteYaml(ref.name)}`).join("\n");
}

function renderAssetListField(key, refs, idKey, indent) {
  const prefix = " ".repeat(indent);
  if (refs.length === 0) return `${prefix}${key}: []`;
  return `${prefix}${key}:\n${renderAssetRefs(refs, idKey, indent + 2)}`;
}

function renderEventYaml(definition) {
  const { schedule, asset_scope: scope } = definition;
  const rules = definition.rules_text.split("\n").map(line => `    ${line}`).join("\n");
  return `event_definition:
  schema_version: ${quoteYaml(eventDefinitionSchemaVersion)}
  event_id: ${quoteYaml(definition.event_id)}
  event_type: ${quoteYaml(definition.event_type)}
  schedule:
    phases: [${schedule.phases.map(quoteYaml).join(", ")}]
    round_min: ${schedule.round_min}
    round_max: ${schedule.round_max}
    fixed: ${schedule.fixed}
    repeatable: ${schedule.repeatable}
  asset_scope:
    roles:
${renderAssetListField("core", scope.roles.core, "role_id", 6)}
${renderAssetListField("possible", scope.roles.possible, "role_id", 6)}
      optional_select_min: ${scope.roles.optional_select_min}
      optional_select_max: ${scope.roles.optional_select_max}
    scenes:
${renderAssetListField("core", scope.scenes.core, "scene_id", 6)}
${renderAssetListField("possible", scope.scenes.possible, "scene_id", 6)}
      include_current_scene_context: ${scope.scenes.include_current_scene_context}
      optional_select_min: ${scope.scenes.optional_select_min}
      optional_select_max: ${scope.scenes.optional_select_max}
  ai_selection:
    owner: ai
    closed_scope: true
  rules_text: |-
${rules}`;
}

export const eventPromptById = Object.freeze(Object.fromEntries(Object.entries(eventDefinitions)
  .map(([eventId, definition]) => [eventId, renderEventYaml(definition)])));

export const eventScheduleIndex = Object.freeze(Object.fromEntries(Object.entries(eventDefinitions)
  .map(([eventId, definition]) => [eventId, Object.freeze({
    type: definition.event_type,
    phases: Object.freeze([...definition.schedule.phases]),
    round_min: definition.schedule.round_min,
    round_max: definition.schedule.round_max,
    fixed: definition.schedule.fixed
  })])));

export const eventAssetIndex = Object.freeze(Object.fromEntries(Object.entries(eventDefinitions)
  .map(([eventId, definition]) => {
    const roles = [...definition.asset_scope.roles.core, ...definition.asset_scope.roles.possible];
    const scenes = [...definition.asset_scope.scenes.core, ...definition.asset_scope.scenes.possible];
    return [eventId, Object.freeze({
      role_ids: Object.freeze(roles.map(role => role.role_id)),
      role_names: Object.freeze(roles.map(role => role.name)),
      scene_ids: Object.freeze(scenes.map(scene => scene.scene_id)),
      scene_names: Object.freeze(scenes.map(scene => scene.name))
    })];
  })));

export const dungeonEventOutlinePrompt = `#副本全局短提纲
##M01 P1：边境怪物异动暴露人为腐化痕迹；M02 P1：森林伪造路标把线索引向沼泽；M03 P2：莉娜的破碎记忆指向魔王仪式；M04 P3：河畔镇账目揭露腐化运输网络；M05 P4：城门既是防线也是王座供能仪式；M06 P5：以战斗、谋略或净化解除最终威胁。
##H01史莱姆王、H02吸血鬼庄园、H03古老神庙、H04巨龙盟约、H05时间裂缝、H06光明神殿、H07恶魔祭坛是可错过隐藏支线。短提纲只用于长期铺垫；只有本次included_event_ids中装载了完整事件块的事件才能在当前轮正式生成。`;

export function getStageForRound(currentRound) {
  if (!Number.isInteger(currentRound) || currentRound < 1 || currentRound > 24) {
    throw new RangeError("currentRound必须是1-24的整数");
  }
  return Object.entries(phaseRanges).find(([, [min, max]]) => currentRound >= min && currentRound <= max)[0];
}

function completedIdSet(completedEvents = []) {
  return new Set(completedEvents.map(entry => {
    if (typeof entry === "string") return entry;
    return entry?.event_id ?? entry?.id;
  }).filter(Boolean));
}

export function getScheduledEventIds({ currentRound, completedEvents = [], forcedEventId } = {}) {
  const stage = getStageForRound(currentRound);
  const completed = completedIdSet(completedEvents);

  if (forcedEventId) {
    const rule = eventScheduleIndex[forcedEventId];
    if (!rule || !rule.phases.includes(stage) || currentRound < rule.round_min || currentRound > rule.round_max || completed.has(forcedEventId)) {
      throw new RangeError(`forcedEventId在当前轮不合法: ${forcedEventId}`);
    }
    return Object.freeze([forcedEventId]);
  }

  const fixed = Object.entries(eventScheduleIndex)
    .filter(([eventId, rule]) => rule.fixed && currentRound === rule.round_min && !completed.has(eventId))
    .map(([eventId]) => eventId);
  if (fixed.length > 0) return Object.freeze(fixed);

  if (currentRound === 24 && !completed.has("M06")) return Object.freeze(["M06"]);

  return Object.freeze(Object.entries(eventScheduleIndex)
    .filter(([eventId, rule]) => eventId !== "B_P5_LAST_STAND"
      && !rule.fixed
      && rule.phases.includes(stage)
      && currentRound >= rule.round_min
      && currentRound <= rule.round_max
      && !completed.has(eventId))
    .map(([eventId]) => eventId));
}

const generationSectionNames = [
  "副本：腐化魔王危机", "资产白名单", "档位事件权重",
  "场景迁移白名单", "战斗实体分类", "圣物事件影响",
  "隐藏事件的线索与计划", "Roguelike总结构", "AI受控事件调度",
  "事件牌库与跨局反重复", "本局主压力与机械词缀", "三条构筑路线",
  "局内道具表", "永久奖励授权", "叙事与内容定位", "终章条件", "目标与主线场景"
];

const activeSectionNames = [
  "副本：腐化魔王危机", "场景迁移白名单", "战斗实体分类", "圣物事件影响",
  "隐藏事件的线索与计划", "本局主压力与机械词缀", "局内道具表",
  "永久奖励授权", "叙事与内容定位", "终章条件",
  "随机事件补充规则", "内容约束自检"
];

const activeSectionNamesByTemplate = Object.freeze({
  "战斗事件": Object.freeze([
    "副本：腐化魔王危机", "战斗实体分类", "本局主压力与机械词缀",
    "叙事与内容定位"
  ]),
  "检定": Object.freeze([
    "副本：腐化魔王危机", "圣物事件影响", "隐藏事件的线索与计划",
    "本局主压力与机械词缀", "局内道具表", "叙事与内容定位"
  ]),
  "结算": Object.freeze([
    "副本：腐化魔王危机", "场景迁移白名单", "圣物事件影响",
    "隐藏事件的线索与计划", "本局主压力与机械词缀", "局内道具表",
    "永久奖励授权", "叙事与内容定位", "终章条件",
    "随机事件补充规则"
  ])
});

const activeSelfCheckByTemplate = Object.freeze({
  "战斗事件": `#当前战斗局部自检
##只在内部检查：event_id、option_id与pending_interaction是否一致；scene_name是否仍为锁定场景；敌人是否全部属于当前事件asset_scope和合法战斗池、没有使用current_team名称且总数不超过4；是否没有提前输出summary、story_patch或胜负。`,
  "检定": `#当前检定局部自检
##只在内部检查：event_id、option_id与pending_interaction是否一致；是否逐字使用选项快照中的check_type与check_difficulty；行动角色和属性是否来自current_team真实输入；结果是否按唯一公式稳定计算；是否没有提前输出summary、story_patch或奖励。`,
  "结算": `#当前结算局部自检
##只在内部检查：event_id、option_id与pending_interaction是否一致；检定或战斗结果是否逐字服从程序回传；是否只应用当前事件该结果授权的后果且没有成功失败混发；story_patch是否只提交一次；永久奖励信号、局内道具与final_chapter是否满足当前事件及剩余配额。`
});

const finaleSectionNames = [
  "副本：腐化魔王危机", "本局主压力与机械词缀", "三条构筑路线",
  "叙事与内容定位", "终章条件", "目标与主线场景"
];

function joinSections(names) {
  return names.map(name => dungeonSections.get(name)).filter(Boolean).join("\n\n");
}

export const structuredEventContractPrompt = `#结构化事件定义契约
##以下事件记录使用YAML。schedule、asset_scope和ai_selection是程序与AI共同遵守的权威字段，rules_text是AI负责解释的剧情与后果规则；不得从rules_text反向猜测或扩大程序字段。
##asset_scope.roles.core与possible的并集是该事件可出场、发言、行动或成为敌人的本地角色全集；asset_scope.scenes.core与possible的并集是该事件可作为目标地点的场景全集。core表示事件可以依赖的核心资产，possible由AI结合current_team、story_state、当前位置与近期重复情况选择，不要求全部使用。rules_text可以把未列入范围的已知角色或地点当作不在场的背景信息提及，但这种提及不授权其现身、发言、行动、参战或成为本轮目标场景。
##候选事件合并装载的资产只是传输层并集。AI选定event_id后，必须回到该事件自身asset_scope，不能借用另一个候选事件的角色或场景。current_team始终可参与，不受本地角色范围限制；include_current_scene_context只授权理解开场位置，不自动把当前位置变成目标场景。
##程序直接读取结构化字段完成轮数/阶段过滤与资产装载，不扫描rules_text、角色名称或场景名称推断关系。复杂PLAN/HINT、道具、关系、路线与叙事适配仍由AI依据rules_text和runtime判断。`;

const fullDungeonSectionNames = [
  "副本：腐化魔王危机", "资产白名单", "角色表", "场景ID映射", "关键实体映射",
  "场景白名单", "档位事件权重", "场景迁移白名单", "战斗实体分类", "圣物事件影响",
  "隐藏事件的线索与计划", "Roguelike总结构", "AI受控事件调度", "事件牌库与跨局反重复",
  "本局主压力与机械词缀", "三条构筑路线", "局内道具表", "永久奖励授权",
  "叙事与内容定位", "终章条件", "目标与主线场景"
];

export const dungeonPrompt = [
  joinSections(fullDungeonSectionNames),
  structuredEventContractPrompt,
  "#事件定义YAML\n" + Object.values(eventPromptById).join("\n\n---\n\n"),
  joinSections(["随机事件补充规则", "内容约束自检"])
].join("\n\n");

export const dungeonFinalePrompt = [
  joinSections(finaleSectionNames),
  dungeonEventOutlinePrompt,
  `#终章专用上下文
##程序已经确认run_status并完成永久奖励落库。终章只依据完整story_state、granted_permanent_rewards、实际completed_events、npc_states、memory_notes、run_archetype与run_modifier_ids回收本局经历。
##不得为了补足篇幅引用未完成事件、未出现角色或未访问场景；不需要角色表、场景表、候选事件YAML、调度权重、局内道具定义或战斗池。范围外名称只有已经存在于runtime真实记录中时才可写入终章。`
].join("\n\n");

function scopePrompt(mode, includedEventIds, activeEventId = null) {
  const ids = includedEventIds.length > 0 ? includedEventIds.join(", ") : "无";
  return `#本次上下文范围\n##mode=${mode}；included_event_ids=[${ids}]；active_event_id=${activeEventId ?? "null"}。本段由装配器生成，不属于玩家可见输出。`;
}

function collectGenerationAssets(eventIds, currentSceneId) {
  const roleIds = new Set();
  const sceneIds = new Set();

  for (const eventId of eventIds) {
    const links = eventAssetIndex[eventId];
    if (!links) throw new Error(`事件缺少结构化资产范围: ${eventId}`);
    links.role_ids.forEach(roleId => roleIds.add(roleId));
    links.scene_ids.forEach(sceneId => sceneIds.add(sceneId));
  }

  if (currentSceneId && !sceneNameById[currentSceneId]) {
    throw new RangeError(`currentSceneId不在场景ID映射中: ${currentSceneId}`);
  }
  if (currentSceneId) sceneIds.add(currentSceneId);

  const missingRoleIds = [...roleIds].filter(roleId => !roleAssetById[roleId]);
  const missingSceneIds = [...sceneIds].filter(sceneId => !sceneAssetById[sceneId]);
  if (missingRoleIds.length > 0 || missingSceneIds.length > 0) {
    throw new Error(`结构化事件引用无效资产: roles=[${missingRoleIds.join(",")}], scenes=[${missingSceneIds.join(",")}]`);
  }

  const roles = [...roleIds].map(roleId => roleAssetById[roleId]);
  const scenes = [...sceneIds].map(sceneId => sceneAssetById[sceneId]);
  const roleSources = roles.map(role => role.source);
  const sceneSources = scenes.map((scene, index) => `##scene_id: ${[...sceneIds][index]}\n${scene.source}`);
  if (sceneSources.length === 0) {
    throw new Error("结构化事件没有可装载场景，属于包配置错误");
  }

  return Object.freeze({
    roleIds: Object.freeze([...roleIds]),
    roleNames: Object.freeze(roles.map(role => role.name)),
    sceneIds: Object.freeze([...sceneIds]),
    sceneNames: Object.freeze(scenes.map(scene => scene.name)),
    prompt: [
      "#本轮角色资产白名单\n##下列资产是候选事件asset_scope的并集；AI只为最终选中的事件使用其自身core/possible范围，不能跨事件借用角色。current_team仍以runtime为准。\n" + (roleSources.join("\n\n") || "本轮无额外本地角色；只允许current_team参与。"),
      "#本轮场景资产白名单\n##下列资产是候选事件asset_scope与当前场景的并集；最终事件场景仍须属于该事件自身core/possible范围并满足迁移白名单。\n" + sceneSources.join("\n\n")
    ].join("\n\n")
  });
}

export function buildDungeonContext({
  mode,
  expectedTemplateName,
  currentRound,
  currentSceneId,
  completedEvents = [],
  forcedEventId,
  includedEventIds,
  activeEventId
} = {}) {
  if (mode === "finale") {
    return Object.freeze({ mode, prompt: dungeonFinalePrompt, includedEventIds: Object.freeze([]), stage: null });
  }

  if (mode === "active_event") {
    if (!activeEventId || !eventPromptById[activeEventId]) {
      throw new RangeError(`activeEventId不存在: ${activeEventId}`);
    }
    if (expectedTemplateName != null && !activeSectionNamesByTemplate[expectedTemplateName]) {
      throw new RangeError(`active_event不支持的expectedTemplateName: ${expectedTemplateName}`);
    }
    const ids = Object.freeze([activeEventId]);
    const selectedSections = activeSectionNamesByTemplate[expectedTemplateName] ?? activeSectionNames;
    const localSelfCheck = activeSelfCheckByTemplate[expectedTemplateName] ?? joinSections(["内容约束自检"]);
    const prompt = [joinSections(selectedSections), structuredEventContractPrompt, scopePrompt(mode, ids, activeEventId), "#当前事件完整YAML\n" + eventPromptById[activeEventId], localSelfCheck].join("\n\n");
    return Object.freeze({ mode, prompt, includedEventIds: ids, stage: null });
  }

  if (mode !== "event_generation") throw new RangeError(`不支持的mode: ${mode}`);
  if (!currentSceneId) throw new TypeError("event_generation必须提供currentSceneId");
  const stage = getStageForRound(currentRound);
  const scheduled = getScheduledEventIds({ currentRound, completedEvents, forcedEventId });
  const allowed = new Set(scheduled);
  const ids = includedEventIds == null ? [...scheduled] : [...new Set(includedEventIds)];
  if (ids.length === 0 || ids.some(eventId => !allowed.has(eventId) || !eventPromptById[eventId])) {
    throw new RangeError("includedEventIds必须是当前轮调度索引的非空子集");
  }
  const frozenIds = Object.freeze(ids);
  const assets = collectGenerationAssets(frozenIds, currentSceneId);
  const blocks = ids.map(eventId => `#候选事件 ${eventId}\n${eventPromptById[eventId]}`).join("\n\n");
  const prompt = [joinSections(generationSectionNames), structuredEventContractPrompt, assets.prompt, dungeonEventOutlinePrompt, scopePrompt(mode, frozenIds), blocks, joinSections(["随机事件补充规则", "内容约束自检"])].join("\n\n");
  return Object.freeze({
    mode,
    prompt,
    includedEventIds: frozenIds,
    includedRoleIds: assets.roleIds,
    includedRoleNames: assets.roleNames,
    includedSceneIds: assets.sceneIds,
    includedSceneNames: assets.sceneNames,
    stage
  });
}

export { eventDefinitions, eventDefinitionSchemaVersion };
export default dungeonPrompt;
