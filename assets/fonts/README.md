# PDF 导出字体

`nsimsun.ttf` 是新宋体 NSimSun 5.03，随应用保存并内嵌到 PDF 打印页面，导出时不请求远程地址。

- 字体族：`NSimSun` / `新宋体`；PostScript 名称：`NSimSun`。
- 来源：[simsun.ttc](https://raw.githubusercontent.com/jiaxiaochu/font/9a1924487b3e716863ec461fef4b60e03cbd5388/simsun.ttc)，从集合中提取索引 1 的 NSimSun face，保留原有字形、字体名称和版权信息。
- 官方字体资料：[Microsoft Typography — SimSun & NSimSun](https://learn.microsoft.com/en-us/typography/font-list/simsun)。字体版权及使用许可沿用原字体，不因镜像来源改变。
- TTC SHA-256：`ff7d69bfa6588d3fdedbddbe3a29ac11f0c50236723ee72a9ea49ec3e2553f5d`。
- TTF SHA-256：`6628de9c2850eeeb7aa418c36f401210993c70dce6da0126af6d69be06ebf87d`。

提取使用 FontTools 4.66.1，可用下列命令重现；应用运行时不依赖 FontTools：

```python
from fontTools.ttLib import TTFont

font = TTFont("simsun.ttc", fontNumber=1, recalcTimestamp=False)
assert font["name"].getDebugName(6) == "NSimSun"
font.save("nsimsun.ttf")
font.close()
```

先前提供的「新宋体.ttf」链接实际内部字体名为「尚黑」，未采用该文件。数学公式继续使用 KaTeX 的数学字体。
