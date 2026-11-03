"""
线上验收：通过本地 SOCKS5 代理（127.0.0.1:10808）拉取 Cloudflare Pages 上的真实文件。
Windows 版 curl 走 schannel，沙箱里会报 SEC_E_NO_CREDENTIALS，所以这里用 Python + OpenSSL。

用法：
  python tools/verify-live.py [站点根地址] [等待秒数]
默认 https://containerloading.pages.dev
退出码 0 = 线上已经是最新代码。
"""
import socket
import ssl
import sys
import time

PROXY = ("127.0.0.1", 10808)


def socks_connect(host, port):
    s = socket.create_connection(PROXY, timeout=20)
    s.sendall(b"\x05\x01\x00")
    if s.recv(2) != b"\x05\x00":
        raise RuntimeError("SOCKS5 握手失败")
    name = host.encode()
    s.sendall(b"\x05\x01\x00\x03" + bytes([len(name)]) + name + port.to_bytes(2, "big"))
    reply = s.recv(4)
    if len(reply) != 4 or reply[1] != 0:
        raise RuntimeError("SOCKS5 连接失败: %r" % (reply,))
    atyp = reply[3]
    if atyp == 1:
        s.recv(4 + 2)
    elif atyp == 3:
        n = s.recv(1)[0]
        s.recv(n + 2)
    elif atyp == 4:
        s.recv(16 + 2)
    return s


def fetch(host, path):
    sock = socks_connect(host, 443)
    ctx = ssl.create_default_context()
    ss = ctx.wrap_socket(sock, server_hostname=host)
    req = (
        "GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: containerloading-verify\r\n"
        "Accept: */*\r\nConnection: close\r\n\r\n" % (path, host)
    )
    ss.sendall(req.encode())
    data = b""
    while True:
        chunk = ss.recv(65536)
        if not chunk:
            break
        data += chunk
    ss.close()

    head, _, body = data.partition(b"\r\n\r\n")
    status = int(head.split(b" ")[1])
    headers = {}
    for line in head.split(b"\r\n")[1:]:
        if b":" in line:
            k, v = line.split(b":", 1)
            headers[k.strip().lower()] = v.strip()

    if headers.get(b"transfer-encoding", b"").lower() == b"chunked":
        out, i = b"", 0
        while True:
            j = body.find(b"\r\n", i)
            size = int(body[i:j], 16)
            if size == 0:
                break
            out += body[j + 2:j + 2 + size]
            i = j + 2 + size + 2
        body = out
    return status, body


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "https://containerloading.pages.dev"
    host = base.replace("https://", "").replace("http://", "").strip("/")

    checks = [
        ("/js/core/pack.js", b"MAX_BOXES", "M2 排布算法文件"),
        ("/js/core/pack.js", b"extraContainers", "补柜估算"),
        ("/js/core/pack.js", b"pair-overlap", "对扣实体重叠断言"),
        ("/js/core/pack.js", b"fillStripSameSku", "同款换姿态填条带"),
        ("/js/core/pack.js", b"facesRel", "真实接触面（侧放/倒扣）"),
        ("/js/core/explain.js", "为什么停".encode(), "为什么停模块"),
        ("/js/core/solid.js", b"pairFit", "实体几何模块"),
        ("/js/ui/health.js", "本单体检".encode(), "本单体检"),
        ("/js/ui/result.js", "货量上限".encode(), "全部装入文案"),
        ("/js/ui/result.js", "可承重".encode(), "空间拆分文案"),
        ("/js/ui/viewer.js", b"CL3D", "M3 3D 模块"),
        ("/js/ui/viewer.js", b"EdgesGeometry", "描边由箱体几何生成"),
        ("/vendor/three.module.min.js", b"THREE", "three.js 本地文件"),
        ("/", "计算装柜".encode(), "首页按钮"),
        ("/", "为什么有空间却装不进去".encode(), "使用说明含为什么停"),
        ("/", "默认不限方向".encode(), "使用说明含默认不限方向"),
        ("/", "所需柜数".encode(), "结果页所需柜数"),
        ("/", "本单体检".encode(), "使用说明含体检"),
        ("/", b"js/ui/viewer.js", "首页引用 3D 模块"),
        ("/", b"js/ui/health.js", "首页引用体检模块"),
        ("/", b"js/core/solid.js", "首页引用实体模块"),
        ("/", b'id="viewer-canvas"', "首页有 3D 容器"),
    ]

    deadline = time.time() + 180
    attempt = 0
    while True:
        attempt += 1
        try:
            results = []
            for path, needle, label in checks:
                status, body = fetch(host, path + ("?v=m2" if "?" not in path else ""))
                results.append((status == 200 and needle in body, status, label))
            if all(r[0] for r in results):
                print("线上已更新（第 %d 次检查）：" % attempt)
                for ok, status, label in results:
                    print("  ok  %s  [%d]" % (label, status))
                return 0
            print("第 %d 次：还没更新 -> %s" % (
                attempt, ", ".join("%s=%s" % (r[2], "ok" if r[0] else "HTTP %d" % r[1]) for r in results)))
        except Exception as e:  # 部署期间网络抖动
            print("第 %d 次：%s" % (attempt, e))

        if time.time() > deadline:
            print("超时：线上仍是旧版本")
            return 1
        time.sleep(8)


if __name__ == "__main__":
    sys.exit(main())
