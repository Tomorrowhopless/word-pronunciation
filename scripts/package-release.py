#!/usr/bin/env python3
"""Build an offline distribution; assemble same-origin Pages from that release."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIRS = ('assets', 'browserAction', 'options', 'data', 'models', 'vendor', 'web')
FILES = ('manifest.json', 'background.js', 'content.js', 'content.css', 'speech-client.js',
         'speech-engine.js', 'translation-client.js', 'reviewed-translations.js',
         'local-model-core.js', 'local-model.html', 'local-model.js', 'model-bridge.js',
         'local-speech-core.js', 'local-speech-document.js', 'local-speech-bridge.js',
         'piper-phonemizer.js', 'README.md', 'LICENSE', 'DATA-LICENSE.html', 'ECDICT-LICENSE.txt', 'WORDSET-LICENSE.txt')

def selected(root):
    for name in FILES:
        path = root / name
        if not path.is_file():
            raise ValueError('Missing runtime file: ' + name)
        yield path
    for name in DIRS:
        directory = root / name
        if not directory.is_dir():
            raise ValueError('Missing distribution directory: ' + name)
        for path in sorted(directory.rglob('*')):
            if path.is_symlink():
                raise ValueError('Symlink not allowed: ' + str(path.relative_to(root)))
            if path.is_file() and not any(p.startswith('.') or p == '__pycache__' for p in path.relative_to(root).parts):
                if path.suffix in ('.pyc', '.bak', '.tmp'):
                    continue
                yield path

def build(root, output):
    version = json.loads((root / 'manifest.json').read_text())['version']
    files = list(selected(root))
    if (root / "models/model-info.json").is_file():
        subprocess.run(["node", str(root / "scripts/verify-local-model.js")], cwd=root, check=True)
    for path in files:
        relative = path.relative_to(root)
        # Scan authored text and provenance, never publish local-machine records.
        if path.suffix in ('.json', '.md', '.html', '.txt') or (relative.parts[0] not in ('vendor', 'models') and path.suffix in ('.js', '.css')):
            text = path.read_text(errors='replace')
            if '/Users/' in text or '/private/tmp/' in text:
                raise ValueError('Local path in release: ' + str(relative))
    output.mkdir(parents=True, exist_ok=True)
    archive = output / ('wordworkshop-' + version + '.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for directory in DIRS:
            bundle.writestr('WordWorkshop/' + directory + '/', '')
        for path in files:
            bundle.write(path, 'WordWorkshop/' + path.relative_to(root).as_posix())
    if archive.stat().st_size >= 2 * 1024**3:
        raise ValueError('Release asset must be under 2 GiB')
    digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest + '  ' + archive.name + '\n')
    print(json.dumps({'archive': str(archive), 'sha256': digest, 'files': len(files), 'bytes': archive.stat().st_size}))

def pages(archive, output):
    if output.exists():
        raise ValueError('Pages output must not already exist')
    with tempfile.TemporaryDirectory() as temporary:
        staging = Path(temporary)
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                path = PurePosixPath(item.filename)
                if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'WordWorkshop' or '\\' in item.filename:
                    raise ValueError('Unsafe archive path')
                if (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Symlink in archive')
            if sum(item.file_size for item in bundle.infolist()) >= 1_000_000_000:
                raise ValueError('Pages site must be below 1 GB')
            bundle.extractall(staging)
        root = staging / 'WordWorkshop'
        list(selected(root))
        if not (root / 'web/index.html').is_file():
            raise ValueError('Missing web/index.html')
        shutil.copytree(root, output)
    (output / '.nojekyll').touch()
    (output / 'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./web/"><title>WordWorkshop</title><a href="./web/">打开离线词典网页版</a></html>')
    print(json.dumps({'pages': str(output), 'bytes': sum(p.stat().st_size for p in output.rglob('*') if p.is_file())}))

def source(root, output):
    if output.exists():
        raise ValueError('Source output must not already exist')
    excluded = {'dist', '_site', 'release-assets', 'node_modules', '.git', '__pycache__', 'test-results'}
    private = {'browser-verification.json', 'verification.json', 'PRODUCT.md', '.DS_Store'}
    bundles = {'vendor/transformers/transformers.min.js', 'vendor/piper/phonemize.js', 'models/opus-mt-en-zh/tokenizer.json'}
    selected_files = []
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if any(part in excluded for part in rel.parts) or path.name in private or path.is_symlink() or not path.is_file():
            continue
        if path.suffix in ('.onnx', '.wasm', '.data', '.pyc', '.zip', '.sha256') or rel.as_posix() in bundles or (rel.parts[0] == 'data' and path.name.endswith('.json.gz')) or (rel.parts[:2] == ('vendor', 'onnx') and path.suffix == '.mjs'):
            continue
        if path.stat().st_size > 100 * 1024**2:
            raise ValueError('Source file exceeds GitHub limit: ' + str(rel))
        if path.suffix in ('.js', '.json', '.md', '.html', '.txt', '.py', '.yml', '.css'):
            text = path.read_text(errors='replace')
            # Scripts may contain path-rejection checks; prohibit actual user-home paths.
            import re
            if re.search(r'/Users/[A-Za-z0-9_.-]+/', text) or ('/private/' + 'tmp/wordworkshop') in text:
                raise ValueError('Private local path in source: ' + str(rel))
        selected_files.append((path, rel))
    output.mkdir(parents=True)
    for path, rel in selected_files:
        target = output / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    print(json.dumps({'source': str(output), 'files': len(selected_files)}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--pages-from', type=Path)
    parser.add_argument('--pages-output', type=Path, default=ROOT / 'dist/pages')
    parser.add_argument('--source-output', type=Path)
    args = parser.parse_args()
    if args.source_output:
        source(args.root.resolve(), args.source_output.resolve())
    elif args.pages_from:
        pages(args.pages_from, args.pages_output)
    else:
        build(args.root, args.output)
