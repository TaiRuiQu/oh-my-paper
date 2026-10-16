# 第三方声明与 MIT 兼容性审查

审查日期：2026-10-16。项目原创代码按根目录 [LICENSE](LICENSE) 中的 MIT 条款授权。下述第三方软件、字体及技能保留原许可证，不受根 MIT 文件重新授权。

## 结论与适用范围

**当前源码可以采用 MIT 发布；分发含第三方组件的构建产物或容器时，必须同时满足这些组件的原始条款。** 本结论区分项目原创代码、独立库和独立运行的系统程序，不能理解为整个镜像只有 MIT 许可证。

已核对 `pnpm-lock.yaml` 的全部 **1,082 个 npm 包版本**（包含直接、传递、开发和各平台可选依赖），以及两个 Python requirements 在 CPython 3.11 / Linux x86_64 下解析出的 **16 个包版本**。npm 包和 Python wheel 下载后按注册表提供的完整性值核验，并提取其 LICENSE、COPYING、NOTICE 等文件。记录见：

- [npm 包、版本、许可证、来源与完整性](legal/npm-packages.json)
- [npm 原始许可证与声明](legal/npm-NOTICES.txt)
- [Python 包、wheel 来源与完整性](legal/python-packages.json)
- [Python wheel 及内嵌库的原始许可证](legal/python-NOTICES.txt)
- [补充核对与上游许可证](legal/supplemental-NOTICES.txt)

Docker 的 Debian 系统包没有锁定完整二进制版本，镜像标签也不是固定 digest。下述系统组件审查说明许可边界；它不等于针对某一已发布镜像的逐文件 SBOM 或完整源码交付证明。每次发布镜像仍需按实际 digest 与安装清单履行对应的源码提供义务。

## 需要特别遵守的条款

| 组件                                                        | 许可证与使用方式                                             | 与 MIT 原创代码共存的条件                                                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mathml2omml@0.5.0`                                         | LGPL-3.0-or-later；服务端 Word 公式转换                      | 保留 LGPL 和其纳入的 GPL 文本，提供库的对应源码与重建方式，允许用户修改、替换库及为调试库修改而逆向分析。Next.js 中作为外部包独立加载，Worker 构建也保留外部依赖，避免将库合入不可替换的应用代码。 |
| `sharp@0.35.5` 与 `@img/sharp-*` / libvips 预编译库         | Apache-2.0，部分平台包同时含 LGPL-3.0-or-later 与 MIT 组件   | 分别保留上游声明；libvips 及内嵌库不能改标 MIT，分发二进制时提供对应源码及替换/重建途径。                                                                                                          |
| `lightningcss@1.32.0`、`1.33.0` 与平台包，`axe-core@4.14.0` | MPL-2.0；主要用于构建、检查                                  | 保留 MPL 文件及对应版本源码来源；修改过的 MPL 文件仍按 MPL 发布，项目其他独立文件可继续 MIT。                                                                                                      |
| `elkjs@0.11.1`                                              | EPL-2.0；由 Prisma Studio 传递引入，迁移镜像的依赖树也包含它 | 保留 EPL、版权及源码获取说明，分发该组件或其修改时遵循 EPL；不能仅因是开发工具就忽略迁移镜像中的副本。                                                                                             |
| `jszip@3.10.2`                                              | MIT OR GPL-3.0-or-later                                      | 本项目选择 MIT 分支，保留 MIT 声明。                                                                                                                                                               |
| `json-schema@0.4.0`                                         | AFL-2.1 OR BSD-3-Clause                                      | 选择 BSD-3-Clause 分支。                                                                                                                                                                           |
| `pako@1.0.11`                                               | MIT AND Zlib                                                 | 同时保留两份适用条款，不能把 AND 当作任选其一。                                                                                                                                                    |
| `caniuse-lite@1.0.30001815`                                 | CC-BY-4.0 数据                                               | 保留数据来源、许可链接及署名；如修改数据，注明修改。                                                                                                                                               |
| Geist、Noto Sans SC 字体                                    | OFL-1.1                                                      | 保留字体版权与 OFL；字体本身不改为 MIT，修改字体须遵守保留字体名规则，不将字体单独售卖。                                                                                                           |
| 内置 `skills/xiaozhi/pdf/`                                  | Apache-2.0，上游 OpenAI PDF skill 的适配版本                 | 保留原文、固定源提交、原许可证与已有修改说明。                                                                                                                                                     |

其余 npm 声明包括 MIT、ISC、BSD-2-Clause、BSD-3-Clause、Apache-2.0、0BSD、MIT-0、BlueOak-1.0.0、CC0-1.0、Unlicense，以及 MIT/ISC、MIT/X11 的旧式写法。依各自条款保留版权、许可和免责声明。注册表未填写许可证字段的 `seq-queue@0.0.5`，其发布包内含完整 MIT LICENSE；`buffers@0.1.1` 的作者后续提交明确声明 MIT/X11，已核对该提交的 `index.js` 与当前发布包一致，固定依据见补充声明。

126 个 npm 平台包或旧包没有单独附带可识别的许可证文件。它们不因此自动成为 MIT；清单保留其注册表声明与上游来源，补充文件收录相关项目许可。后续新增未知或无法核实的许可，应先解决再发布。

## LGPL、MPL、EPL 对应源码

以下来源用于定位本次审查版本，使用镜像或打包应用时须一并保留声明与源码获取说明；若上游失效，分发者仍需按许可证提供对应源码，不能只留下失效链接。

- mathml2omml：[固定源码提交](https://github.com/fiduswriter/mathml2omml/tree/0ddeb8b59ff1a97796b25d8f682dfb410febde1d)，构建步骤由该源码的 `package.json` 定义。
- sharp/libvips：[sharp 源码](https://github.com/lovell/sharp/tree/v0.35.5)、[sharp-libvips 发布与构建材料](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4)。各平台内嵌组件与版本以其发布包为准。
- Lightning CSS：[1.32.0 源码](https://github.com/parcel-bundler/lightningcss/tree/v1.32.0)、[1.33.0 源码](https://github.com/parcel-bundler/lightningcss/tree/v1.33.0)。
- axe-core：[4.14.0 源码](https://github.com/dequelabs/axe-core/tree/v4.14.0)。
- elkjs：[固定源码提交](https://github.com/kieler/elkjs/tree/572e73323791d05f09b0815ff639af2b67f202ab)。

应用本身允许 MIT 所授予的使用与修改；对相关库的修改、替换及为调试这些修改进行的逆向分析，不添加超出其许可证的限制。替换 JavaScript 库可在源码树安装兼容修改版后重新构建；生产目录中的外部包也保留独立形式。替换原生库按 sharp/libvips 上游构建说明重新构建包与应用镜像。

## Python 与系统运行组件

Python 顶层包主要为 MIT、MIT-CMU、BSD、Apache-2.0 及其双许可组合。`pdfplumber` 的 PyPI license 字段为空，但 wheel 内含 MIT LICENSE。NumPy、SciPy、OpenCV、pypdfium2 的 wheel 包含原生组件及第三方代码，**不能仅按 Python 包顶层的 BSD/Apache 标签认定整个 wheel**；原始第三方声明已保留。特别留意 FFmpeg、libquadmath、GCC 运行库及其 LGPL、GPL 与运行库例外，是否适用以所分发的实际 wheel 文本为准。

Compose 中 Qdrant 为 Apache-2.0、PostgreSQL 为 PostgreSQL License、Caddy 为 Apache-2.0；独立服务的许可不替换应用原创代码的 MIT。Node.js 使用 MIT 与其内嵌组件声明，Python 使用 PSF 及其组合声明，Noto 字体使用 OFL。Bubblewrap 为 LGPL-2.0-or-later，Poppler 为 GPL-2.0-or-later，util-linux 含多种许可证；Debian 基础镜像还含 GPL/LGPL 系统工具。

应用通过独立进程调用 Poppler、Bubblewrap 与系统工具，没有把这些程序的 GPL 源码复制进应用。按当前架构，应用可以保留 MIT。**对外分发 Docker 镜像仍是分发这些程序的二进制副本**：需保留 `/usr/share/doc/*/copyright` 等上游材料，并按实际组件版本提供相应源码与构建材料或满足条款的源码提供方式。单纯列出 Debian 网站或加入 MIT 文件不代替这些义务。

来源：[PostgreSQL 许可](https://www.postgresql.org/about/licence/)、[Qdrant 许可](https://github.com/qdrant/qdrant/blob/master/LICENSE)、[Caddy 许可](https://github.com/caddyserver/caddy/blob/master/LICENSE)、[Node.js 许可](https://github.com/nodejs/node/blob/main/LICENSE)、[Poppler](https://poppler.freedesktop.org/)、[Bubblewrap 许可](https://github.com/containers/bubblewrap/blob/main/COPYING)、[util-linux 许可](https://github.com/util-linux/util-linux/blob/master/README.licensing)。

## 如何刷新清单

在 Linux/Python 3.11 环境中，使用当前约束重新解析（只解析，不安装），再生成并人工核对：

```bash
mkdir -p .local/open-source-audit
python3 -m pip install --dry-run --ignore-installed --only-binary=:all: --report .local/open-source-audit/python-resolution.json -c tools/python-constraints.txt -r tools/card-scan/requirements.txt -r tools/sandbox/requirements.txt
python3 scripts/audit-licenses.py
pnpm exec prettier legal/*.json --write
```

生成程序读取所有 npm 锁条目，包括本机没有安装的其他平台包。生成清单后须核对复合许可、原生内嵌库、缺失声明和使用方式；生成成功不是兼容性自动通过的证明。改变部署平台时需重新解析并审查 Python wheel。镜像中附带本文件和 `legal/`，但完整镜像的源码分发安排仍由镜像发布者负责。

许可依据：[Apache-2.0 第 4 条](https://www.apache.org/licenses/LICENSE-2.0)、[MPL 2.0 第 3 条](https://www.mozilla.org/en-US/MPL/2.0/)、[LGPL 3.0 第 4 条](https://www.gnu.org/licenses/lgpl-3.0.html)、[EPL 2.0](https://www.eclipse.org/legal/epl-2.0/)、[SIL OFL](https://openfontlicense.org/)。
