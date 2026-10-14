本机扫描仪桥接
==============

在连接扫描仪的电脑运行 Python 3。USB / SANE 设备需要安装 sane-utils 并确保 `scanimage --list-devices` 可见；网络扫描仪使用设备实际提供的 eSCL 根地址。

```sh
python3 scripts/scanner-bridge/bridge.py --origin http://localhost:3000 --escl office=http://192.168.1.20/eSCL
```

生产站点使用实际 HTTPS 网站 origin。启动输出中的随机 token 填入扫描页面；桥接只监听 127.0.0.1，拒绝非允许 origin，所有请求要求 `X-Scanner-Token`。浏览器须允许网站访问本地网络；若浏览器禁止 HTTPS 页面访问本机 HTTP 服务，可在受信任的本机 HTTPS 反向代理后提供桥接。

GET `/devices` 返回 `{devices:[{id,name,backend,unavailable?}]}`。POST `/scan` 接收 `{deviceId,resolution:300,source:"Platen"}`，返回 image/png 或 image/jpeg；网页将响应 Blob 转为 File 后沿常规上传接口处理。POST `/scan-batch` 使用 `{deviceId,source:"Feeder",duplex:true,maxPages:100}`，返回 `{pages:[{mime,data:base64}]}`，用于 eSCL 自动进纸器。SANE 单页调用 `/scan`。

在网页「连接扫描仪」填写桥接地址和令牌，点击查找，再选择可用设备。纸张来源为「平板单页」时每次采集一页；eSCL 设备选择「自动进纸器」后，可以设置单/双面、分辨率和 1–100 页的单次上限，再点击「批量扫描并添加图像」。达到页数上限时会提示继续采集，待上传列表每批最多 100 页。各页保留 PNG/JPEG 格式和采集顺序；错误不清空已有文件，不可用设备不能开始扫描。SANE 自动进纸每次仍只采集一页，可重复采集后统一上传。

实现采用 SANE `scanimage` 和 [sane-airscan 的 eSCL 请求结构](https://github.com/alexpevzner/sane-airscan/blob/master/airscan-escl.c)。扫描设备尚未接入当前验收环境。`python3 -m unittest discover -s scripts/scanner-bridge -p 'test_*.py'` 启动真实 HTTP 模拟 eSCL 设备，验证发现、创建扫描任务、取回多页、销毁任务及桥接 token/origin；模拟结果不能替代设备硬件验收。
