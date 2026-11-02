"""
把依赖下载到本地 vendor/（走本地 SOCKS5 代理）。
用法：python tools/fetch-vendor.py
"""
import importlib.util
import os
import ssl
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("v", os.path.join(BASE, "tools", "verify-live.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def get(host, path):
    s = m.socks_connect(host, 443)
    ss = ssl.create_default_context().wrap_socket(s, server_hostname=host)
    req = ("GET " + path + " HTTP/1.1\r\nHost: " + host +
           "\r\nUser-Agent: cl-vendor\r\nAccept: */*\r\nConnection: close\r\n\r\n")
    ss.sendall(req.encode())
    data = b""
    while True:
        c = ss.recv(65536)
        if not c:
            break
        data += c
    head, _, body = data.partition(b"\r\n\r\n")
    text = head.decode("latin1")
    status = int(text.split(" ")[1])
    if "chunked" in text.lower():
        out, i = b"", 0
        while True:
            j = body.find(b"\r\n", i)
            if j < 0:
                break
            size = int(body[i:j], 16)
            if size == 0:
                break
            out += body[j + 2:j + 2 + size]
            i = j + 2 + size + 2
        body = out
    return status, body


TARGETS = [
    ("three.module.min.js", [
        ("cdn.jsdelivr.net", "/npm/three@0.160.0/build/three.module.min.js"),
        ("unpkg.com", "/three@0.160.0/build/three.module.min.js"),
    ]),
]

ok = True
for name, sources in TARGETS:
    dest = os.path.join(BASE, "vendor", name)
    if os.path.exists(dest) and os.path.getsize(dest) > 100000:
        print("已存在 %s（%d 字节）" % (name, os.path.getsize(dest)))
        continue
    saved = False
    for host, path in sources:
        try:
            status, body = get(host, path)
            print("%s%s -> %s %d 字节" % (host, path, status, len(body)))
            if status == 200 and len(body) > 100000:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as f:
                    f.write(body)
                print("  已保存 vendor/%s" % name)
                saved = True
                break
        except Exception as e:
            print("%s 失败: %s" % (host, e))
    if not saved:
        ok = False

sys.exit(0 if ok else 1)
