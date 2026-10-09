#!/usr/bin/env python3
"""Build standalone offline Chinese lookup buckets from a fixed ECDICT CSV."""
import argparse
import csv
import gzip
import hashlib
import json
import re
from pathlib import Path

COMMIT = 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b'
EXPECTED_SHA256 = '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf'
REPO_URL = 'https://github.com/skywind3000/ECDICT'
LETTERS = list('abcdefghijklmnopqrstuvwxyz') + ['misc']
LOCAL_CORRECTIONS = {
    'a': 'art. 一个；一位（不定冠词，用于单数可数名词前）。\nn. 英文字母 A。',
    'i': 'pron. 我（第一人称单数主格）。',
    'run': 'n. 跑；赛跑；奔跑的路程；运行；连续的一段时间。\nv. 跑；奔跑；行驶；运转；运行；管理；经营。\n过去式：ran；过去分词：run。',
}



def clean_text(value):
    # CSV stores escaped line breaks. Decode only those, never general escapes.
    value = re.sub(r'\\+r\\+n|\\+n|\\+r', '\n', value or '')
    return value.replace('\r\n', '\n').replace('\r', '\n').strip()


def bucket_name(word):
    return word[0] if word and 'a' <= word[0] <= 'z' else 'misc'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_path', type=Path)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    raw = args.csv_path.read_bytes()
    source_hash = hashlib.sha256(raw).hexdigest()
    if source_hash != EXPECTED_SHA256:
        raise SystemExit('CSV SHA256 differs from fixed audited ECDICT commit; refusing to build.')
    buckets = {letter: {} for letter in LETTERS}
    stats = dict(sourceRows=0, emptyWords=0, emptyTranslations=0, duplicateRows=0,
                 duplicateTranslationLinesRemoved=0, wordsWithDefinition=0,
                 wordsWithPhonetic=0, wordsWithChineseCharacters=0)
    seen_words = set()
    with args.csv_path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        for row in reader:
            stats['sourceRows'] += 1
            word = (row['word'] or '').strip().lower()
            if not word:
                stats['emptyWords'] += 1
                continue
            seen_words.add(word)
            translation = clean_text(row['translation'])
            if not translation:
                stats['emptyTranslations'] += 1
                continue
            entry = dict(translation=translation,
                         phonetic=clean_text(row['phonetic']),
                         definition=clean_text(row['definition']))
            bucket = buckets[bucket_name(word)]
            if word in bucket:
                # Merge exact lines without duplicating or overwriting Chinese text.
                stats['duplicateRows'] += 1
                previous = bucket[word]
                lines = previous['translation'].splitlines()
                for line in translation.splitlines():
                    if line not in lines:
                        lines.append(line)
                    else:
                        stats['duplicateTranslationLinesRemoved'] += 1
                previous['translation'] = '\n'.join(lines)
                for field in ('phonetic', 'definition'):
                    if not previous[field]:
                        previous[field] = entry[field]
            else:
                bucket[word] = entry
    local_corrections = {}
    for word, translation in LOCAL_CORRECTIONS.items():
        entry = buckets[bucket_name(word)][word]
        local_corrections[word] = dict(
            originalTranslation=entry['translation'], translation=translation,
            note='Local adaptation for English learning: clarify common usage and correct misleading source wording; phonetic and definition are unchanged.')
        entry['translation'] = translation
    out_dir = args.project / 'data' / 'zh'
    out_dir.mkdir(parents=True, exist_ok=True)
    files = {}
    for letter in LETTERS:
        entries = buckets[letter]
        for entry in entries.values():
            stats['wordsWithDefinition'] += bool(entry['definition'])
            stats['wordsWithPhonetic'] += bool(entry['phonetic'])
            stats['wordsWithChineseCharacters'] += bool(re.search(r'[\u3400-\u9fff]', entry['translation']))
        payload = json.dumps(entries, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        packed = gzip.compress(payload, compresslevel=9, mtime=0)
        filename = letter + '.json.gz'
        (out_dir / filename).write_bytes(packed)
        files[filename] = dict(words=len(entries), compressedBytes=len(packed),
                               uncompressedBytes=len(payload), sha256=hashlib.sha256(packed).hexdigest())
    stats.update(sourceUniqueNormalizedWords=len(seen_words),
                 lookupWords=sum(f['words'] for f in files.values()),
                 compressedBytes=sum(f['compressedBytes'] for f in files.values()),
                 uncompressedBytes=sum(f['uncompressedBytes'] for f in files.values()))
    info = dict(source=REPO_URL, sourceCommit=COMMIT,
                sourceCsvUrl=REPO_URL.replace('github.com', 'raw.githubusercontent.com') + '/' + COMMIT + '/ecdict.csv',
                sourceCsvBytes=len(raw), sourceCsvSha256=source_hash,
                license='MIT', licenseFile='ECDICT-LICENSE.txt',
                schema='bucket[trimmedLowercaseWord] = {translation, phonetic, definition}',
                matching='Exact trim/lowercase word matching; no sense-level or example translation alignment.',
                processing='Decode escaped line breaks only. Skip empty translations. Preserve source order and wording except the documented localCorrections. Merge duplicate keys by unique translation lines and first nonempty metadata.',
                localCorrections=local_corrections, stats=stats, files=files)
    (args.project / 'data' / 'chinese-build-info.json').write_text(
        json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
