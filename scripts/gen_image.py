#!/usr/bin/env python3
"""极简文生图脚本：纯标准库直连 OpenAI 兼容图片端点（优先复用已验证实现）。

用法:
  set OPENAI_API_KEY=sk-xxx            # Windows cmd
  $env:OPENAI_API_KEY="sk-xxx"         # PowerShell
  python scripts/gen_image.py "prompt 内容" --size 1536x1024 --out outputs

可选环境变量:
  OPENAI_BASE_URL  默认 https://api.999555999.com/v1
  IMAGE_MODEL      默认 gpt-image-2.6
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = os.environ.get("OPENAI_BASE_URL", "https://api.999555999.com/v1")
DEFAULT_MODEL = os.environ.get("IMAGE_MODEL", "gpt-image-2.6")
DEFAULT_KEY = os.environ.get("OPENAI_API_KEY", "")
SUPPORTED_MODELS = (
    "gpt-image-2.6",
    "gpt-image-2.5",
    "gpt-image-2",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
)
ALLOWED_SIZES = ("1024x1024", "1536x1024", "1024x1536")


def slugify(text: str, limit: int = 24) -> str:
    s = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fa5]+", "-", text.strip()).strip("-")
    return (s[:limit] or "image").lower()


def redact(text: str, key: str) -> str:
    cleaned = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", text, flags=re.IGNORECASE)
    if key:
        cleaned = cleaned.replace(key, "[redacted]")
    return cleaned


def post_json(url: str, payload: dict, key: str, timeout: int = 320) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt")
    ap.add_argument("--size", default="1024x1024", help="1024x1024 | 1536x1024 | 1024x1536（禁止 2048）")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"默认 {DEFAULT_MODEL}；可选: {', '.join(SUPPORTED_MODELS)}")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--key", default=DEFAULT_KEY)
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--timeout", type=int, default=320)
    ap.add_argument("--retries", type=int, default=2)
    args = ap.parse_args()

    if not args.key:
        print("缺少 API key：请设置环境变量 OPENAI_API_KEY 或传入 --key", file=sys.stderr)
        return 2

    if "2048" in args.size or args.size not in ALLOWED_SIZES:
        print(
            f"不支持的尺寸「{args.size}」：该端点仅允许 {', '.join(ALLOWED_SIZES)}（2048 会被上游以无关的 content_policy_violation 拒绝）",
            file=sys.stderr,
        )
        return 2

    os.makedirs(args.out, exist_ok=True)
    payload = {
        "model": args.model,
        "prompt": args.prompt,
        "n": args.n,
        "size": args.size,
    }

    last_err = None
    for attempt in range(args.retries + 1):
        try:
            result = post_json(f"{args.base.rstrip('/')}/images/generations", payload, args.key, timeout=max(300, args.timeout))
            break
        except urllib.error.HTTPError as e:
            body = redact(e.read().decode("utf-8", "ignore"), args.key)
            last_err = f"HTTP {e.code}: {body[:500]}"
            if e.code < 500 and e.code != 429:
                print(last_err, file=sys.stderr)
                return 1
        except Exception as e:  # 连接断开、超时
            last_err = redact(f"{type(e).__name__}: {e}", args.key)
        if attempt < args.retries:
            wait = 3 * (attempt + 1)
            print(f"第 {attempt + 1} 次失败（{last_err}），{wait}s 后重试", file=sys.stderr)
            time.sleep(wait)
    else:
        print(f"生成失败：{last_err}", file=sys.stderr)
        return 1

    stamp = time.strftime("%Y%m%d-%H%M%S")
    base_name = f"{stamp}-{slugify(args.prompt)}"
    meta = []
    for i, item in enumerate(result.get("data", [])):
        suffix = "" if args.n == 1 else f"-{i + 1}"
        path = os.path.join(args.out, f"{base_name}{suffix}.png")
        if item.get("b64_json"):
            with open(path, "wb") as f:
                f.write(base64.b64decode(item["b64_json"]))
        elif item.get("url"):
            with urllib.request.urlopen(item["url"], timeout=120) as r, open(path, "wb") as f:
                f.write(r.read())
        else:
            print("返回里没有 b64_json / url：", json.dumps(item)[:300], file=sys.stderr)
            return 1
        meta.append({"file": path, "revised_prompt": item.get("revised_prompt")})
        print(path)

    sidecar = os.path.join(args.out, f"{base_name}.json")
    with open(sidecar, "w", encoding="utf-8") as f:
        json.dump(
            {
                "prompt": args.prompt,
                "revised_prompt": meta[0].get("revised_prompt") if meta else None,
                "request": payload,
                "results": meta,
                "usage": result.get("usage"),
                "created": result.get("created"),
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"元数据: {sidecar}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
