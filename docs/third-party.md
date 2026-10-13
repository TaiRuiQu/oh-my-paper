# Word 公式转换依赖

Word 导出复用项目已有的 KaTeX 和 docx，并使用以下依赖：

| 依赖                | 用途                                                            | 许可与来源                                                                                                                     |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `mathml2omml@0.5.0` | MathML 转 Office Math（OMML），无运行时依赖，运行时代码约 67 KB | LGPL-3.0-or-later；[项目源码](https://github.com/fiduswriter/mathml2omml)、[npm 包](https://www.npmjs.com/package/mathml2omml) |
| `xml-js@1.6.11`     | 解析并序列化生成的 XML，修正伸缩括号、无横线分式和重复属性      | MIT；[项目源码](https://github.com/nashwaan/xml-js)。此前已由 docx 间接依赖，本次直接声明并复用同一版本                        |

`mathml2omml` 以未修改、未打包压缩的独立运行时模块随 Web 应用分发。项目的兼容处理位于 `src/server/exams/export/math.ts`；Web 独立部署产物同时包含转换库的 `LICENSE` 与 `README.md`，其中保留原作者和源码链接。Worker 不执行文档导出，不包含该库。
