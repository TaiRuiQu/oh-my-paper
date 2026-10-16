# 来源、版本与覆盖边界

核实日期：2026-10-15。维护者采集了国家平台公开同步教学书目及对应完整目录树，按平台原始版本标签筛选统编、人教及其合编系列。仅整理书目和章节标题，不复制课文、习题、谱例或整本教材。

## 官方来源

- [国家中小学智慧教育平台：课程教学](https://basic.smartedu.cn/syncClassroom)；[电子教材](https://basic.smartedu.cn/tchMaterial)。
- [同步教学书目版本入口](https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/national_lesson/teachingmaterials/version/data_version.json)，本次 `module_version=141554650`，指向 [part_100](https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/national_lesson/teachingmaterials/part_100.json)、[part_101](https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/national_lesson/teachingmaterials/part_101.json)、[part_102](https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/national_lesson/teachingmaterials/part_102.json)、[part_103](https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/national_lesson/teachingmaterials/part_103.json)。
- 每册 `source` 指向国家平台的 `zxx/ndrv2/national_lesson/trees/{id}.json`，该树完整保留于相应资源的 `units` 与递归 `children` 中。此为官方同步课程目录，可能包含复习课、实验、附录和专题；不是逐册纸质教材版权页与目录的逐字核验。
- [人教社官方电子教材](https://jc.pep.com.cn/)另提供 303 册普通小学、初中、高中教材书目（排除特殊教育、教师用书、活动手册）。每条有官方阅读链接，仅书目已核实，目录尚未与课程树逐册交叉核实，不计入 500 册单元覆盖。平台阅读器本次多数未提供可读目录文本，页面图部分出现验证页面，未将其 OCR 候选当作已核实目录。
- [义务教育课程方案和课程标准（2022 年版）通知](https://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)说明 2022 年秋季执行课标；[2024 年义务教育教学用书目录（按 2022 年版课标修订）](https://www.moe.gov.cn/srcsite/A26/s8001/202408/W020240805496325238752.pdf)提供教材版本与册次清单。这些政策文件不证明本资源每一册的实际版次。
- [普通高中课程方案和课程标准（2017 年版 2020 年修订）通知](https://www.moe.gov.cn/srcsite/A26/s8001/202006/t20200603_462199.html)是高中课标基准入口。不能把课标年份、教材首版年份、印刷年份相互替代。

## 如何报告覆盖

先读 [catalog.json](catalog.json)。主范围为 `stage` 严格等于“小学”“初中”“高中”的 433 册；只有明确五四学制时才读“初中（五•四学制）”“小学（五•四学制）”的 67 册。新旧目录和英语分支等分别计册，因此计数不等于独立学科教材数量。

`subject_catalogs`列出各学段学科已核实官方树的册数及新/旧/未标新旧分布；对应的学科 `catalog.json`枚举每册，`resource`指向完整层级和主题。`coverage=official_tree_complete`仅表示来源树已完整收录，不表示每个课标考点都已穷尽。`topics_kind=editorial_from_official_headings`表示知识点范围根据真实章/节/课题递归整理，详细公式、语法、词表或教学目标仍需结合正文和试题核实。

目前已核实所有 500 册的官方目录树；准确纸质版次核实数为 0。义务教育“新教材/旧教材”为平台标签，不自动转换成“2024 版/2012 版”；高中未标新旧也不自动转成“2019 版”。每册保留来源书目更新时间，不能将其当教材出版时间。

学科范围：小学语文、数学、英语、道德与法治、科学、音乐、美术、体育；初中另含物理、化学、生物、地理、历史及日语/俄语、舞蹈/影视/戏剧；高中包含语数英、物化生、史地政、信息技术、通用技术、美术、艺术和体育。人教鄂教、人教中图、人教大同/澳门等合编版在 `version`中独立记录。PEP/精通/一年级起点、数学 A/B、音乐五线谱等不能互换。

## 出版社书目附录（仅书目已核实）

- 小学：[第 1 部分](publisher-primary-1.json)、[第 2 部分](publisher-primary-2.json)。
- 初中：[第 1 部分](publisher-junior-1.json)、[第 2 部分](publisher-junior-2.json)。
- 高中：[第 1 部分](publisher-senior-1.json)、[第 2 部分](publisher-senior-2.json)。

附录与官方同步树使用不同 ID，未建立自动一一映射。类似题名不能证明相同修订版。以两边目录和版权信息一致为合并条件。

## 明确缺口与扩展

劳动、综合实践、校本课程以及义务教育信息科技等未在本次筛选的课程树中完整收录；高中音乐独立模块、部分日语/俄语、部分通用技术模块可能仅有出版社书目或缺少对应树。具体缺口记录在根 `catalog.json.unverified`，也可对照出版社附录查册。不要把“未收录”说成“不存在教材”。

其他出版社不在用户本次选择范围；需扩展时先在国家平台按实际版本查原教材，记录版次与来源后再使用，不能用人教目录代替。

维护更新时重新读取官方书目，比较册次、版本、新旧标签和树内容；逐项确认新增或删除，不能因来源更新时间变动推断全部教材改版。维护者运行 `node skills/xiaozhi/textbooks/scripts/validate-catalog.mjs` 验证唯一性、资源大小、层级、知识点和来源；此脚本不会访问网络或执行外部写操作，小纸运行任务时不需要执行它。
