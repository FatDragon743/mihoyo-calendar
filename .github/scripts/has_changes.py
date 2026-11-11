# -*- coding: utf-8 -*-
"""判断 data/ 下是否有实质变化。

update_data.py 每次运行都会刷新 generated 时间戳，直接 git diff 会天天报"有变化"。
这里把 "generated": "..." 统一归一化后再比较，只有版本 / 卡池 / 里程碑真的变了才算变化。

输出：GITHUB_OUTPUT 里写 changed=true|false
"""
import os
import re
import subprocess

GEN = re.compile(rb'"generated":\s*"[^"]*"')


def normalize(raw: bytes) -> bytes:
    # 仅对文本文件做归一化；二进制（图片）原样返回
    if b'\x00' in raw[:1024]:
        return raw
    # Windows 上 Python 写文件会带 CRLF，仓库里存的是 LF，先统一换行
    s = raw.replace(b'\r\n', b'\n')
    return GEN.sub(b'"generated": ""', s)


def tracked_changes():
    out = subprocess.run(['git', 'diff', '--name-only', 'HEAD'],
                         capture_output=True, text=True, check=True).stdout
    return [p for p in out.splitlines() if p.strip()]


def untracked():
    out = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard'],
                         capture_output=True, text=True, check=True).stdout
    return [p for p in out.splitlines() if p.strip()]


def head_bytes(path: str) -> bytes:
    r = subprocess.run(['git', 'show', f'HEAD:{path}'], capture_output=True)
    return r.stdout if r.returncode == 0 else b''


def main():
    changed, details = [], []

    for p in untracked():
        changed.append(p)
        details.append(f'+ {p} (新增)')

    for p in tracked_changes():
        if not os.path.exists(p):
            changed.append(p)
            details.append(f'- {p} (删除)')
            continue
        with open(p, 'rb') as f:
            cur = f.read()
        old = head_bytes(p)
        if normalize(old) != normalize(cur):
            changed.append(p)
            details.append(f'~ {p}')

    flag = 'true' if changed else 'false'
    output = os.environ.get('GITHUB_OUTPUT')
    if output:
        with open(output, 'a', encoding='utf-8') as f:
            f.write(f'changed={flag}\n')
    print('changed =', flag)
    for d in details:
        print(' ', d)
    if not changed:
        print('（只有 generated 时间戳变化，忽略）')


if __name__ == '__main__':
    main()
