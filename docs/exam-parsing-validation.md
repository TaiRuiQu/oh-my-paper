# 真实样例验证

`examples` 下的六份用户文件是开发样例。预期结构记录在 [样例标注](../evals/exam-samples.ts)，用于检测漏页、漏题、误建答案页题目及材料覆盖。

| 样例 ID | 文件 | 预期页数 | 人工结构期望题数 | 关注内容 |
| --- | --- | ---: | ---: | --- |
| `math` | 数学_仅试题.pdf | 2 | 19 | 跨页题目、数学公式与配图 |
| `chemistry` | 化学_试题_学生作答.pdf | 4 | 20 | 学生笔迹隔离、表格与实验图 |
| `physics` | 物理_试题_学生作答_答题卡_答案.pdf | 11 | 15 | 题干、作答、答题卡与参考答案分离 |
| `biology` | 生物_试题_学生作答_照片.jpg | 1 | 4 | 270° 方向校正、手写覆盖与材料图 |
| `teacher` | 数学_教师教案.pdf | 10 | 15 | 教案中题干与讲解分离、板块重置题号 |
| `chinese` | 语文_仅参考答案.pdf | 4 | 0 | 仅提取参考答案，不构造题目 |

表中数字是人工结构期望，模型实际输出在每次运行的 `report.json` 中记录。教案中某板块没有第 2 题，后续板块重新从 1 编号，应保留原始顺序。

## 运行方法

使用后台六阶段模型配置进行识别，不生成新标准答案：

```bash
pnpm run eval:exams --configured --no-answers
```

也可以选择部分样例并提取完整学生作答：

```bash
pnpm run eval:exams --configured --no-answers --student-answers --only chemistry,physics,biology
```

实际模型请求会产生 API 费用。`--no-answers` 跳过无参考答案题目的独立求解，已有参考答案仍会提取和整理。不带 `--configured` 时使用 DeepSeek 环境变量适配器，所有阶段使用同一个模型。

默认产物位于 `STORAGE_ROOT/exam-evals/<随机 ID>/`，包括原件、页图、裁切图、`exam.json`、`exam.md`、`verification.json` 和合并报告。使用 `--out <新目录>` 指定输出位置。产物包含用户资料，目录被 Git 忽略。

已有产物可以重新执行结构检查；该命令不调用模型，会更新该目录的汇总报告：

```bash
pnpm run eval:exams --reuse --out storage/exam-evals/<已有运行目录>
```

单份文件的 CLI 支持相同模型与生成选项：

```bash
pnpm run parse:exam examples/数学_仅试题.pdf --configured --no-answers
```

## 结果如何解读

当前检查包括页数、题号顺序、最低材料覆盖、定位和文本化是否失败、污染图是否排除于干净产物，以及对应样例的方向和答案页隔离。只有启用作答提取时才检查学生作答分离。

这些结构标注没有逐字题干、每个材料框、每空标准答案或教师评分的完整真值。`passed` 表示这些结构检查通过；`verified` 表示程序核对状态，均不能换算成转录、解答或批改准确率。

2026-10-12 流程重写期间的真实请求仍出现过教案漏题或分类错误、材料框不完整、文本化失败及参考答案提取失败。后续修复做了局部复核，但没有完成最终版本对全部样例的统一准确率评测。失败题目和 `findings` 应逐项检查；工程回归记录见 [集成验证](ai-web-validation.md)。
