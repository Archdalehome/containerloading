"""
线上验收（算法这一版）：确认 Cloudflare Pages 上跑的是含「对扣列最优」的最新代码。
走本地 SOCKS5 代理，Windows 的 curl 在沙箱里会因 schannel 失败，所以用 Python + OpenSSL。

用法：
  python tools/verify-algo.py [等待秒数]
退出码 0 = 线上已是最新。
"""
import sys
import time

sys.path.insert(0, "tools")
from importlib import import_module

fetch_mod = import_module("verify-live")
fetch = fetch_mod.fetch

HOST = "containerloading.pages.dev"

CHECKS = [
    ("/js/core/pack.js", "单只只能压在".encode(), "列最优：对扣块 + 顶部单只（排满才许放）"),
    ("/js/core/pack.js", "柜长上限：dp 算的是".encode(), "列最优：柜长上限（不越界）"),
    ("/js/core/pack.js", b"blockTopFlat", "对扣块顶面必须平整才允许叠"),
    ("/js/ui/box-geometry.js", b"applyPose", "姿态统一走 applyPose"),
    ("/js/core/pack.js", b"pairPoseOf", "对扣上件按本列姿态预检"),
    ("/js/core/pack.js", b"runColumnMix", "混装分箱列块"),
    ("/", "对扣列最优".encode(), "智能计算：列最优候选"),
    ("/", "物理校验".encode(), "智能计算：验证结果一行"),
    ("/", "理论下界".encode(), "智能计算：柜长 vs 理论下界"),
    ("/", "已比较".encode(), "智能计算：已比较份数"),
    ("/", "分箱列块".encode(), "智能计算：混装列块候选"),
]


def main():
    wait = int(sys.argv[1]) if len(sys.argv) > 1 else 180
    deadline = time.time() + wait
    attempt = 0
    while True:
        attempt += 1
        try:
            results = []
            for path, needle, label in CHECKS:
                status, body = fetch(HOST, path)
                results.append((status == 200 and needle in body, status, label))
            missing = [r for r in results if not r[0]]
            if not missing:
                print("线上已是最新（第 %d 次检查）：" % attempt)
                for ok, status, label in results:
                    print("  ok  %s  [%d]" % (label, status))
                return 0
            print("第 %d 次：还没更新 -> %s" % (
                attempt, ", ".join("%s(HTTP %d)" % (r[2], r[1]) for r in missing)))
        except Exception as e:
            print("第 %d 次：%s" % (attempt, e))
        if time.time() > deadline:
            print("超时：线上仍是旧版本")
            return 1
        time.sleep(8)


if __name__ == "__main__":
    sys.exit(main())



