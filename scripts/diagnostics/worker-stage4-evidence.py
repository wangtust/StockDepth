"""Independent artifact checks and patch creation from preserved stage-start content."""
from pathlib import Path
import hashlib, json, difflib, statistics, subprocess
root = Path(__file__).resolve().parents[2]
before = root / 'var/codex-performance-team/stage4-worker-before'
out = root / 'var/performance/stage4-worker'
read = lambda name: json.loads((out / name).read_text())
b, a = read('before-browser.json'), read('after-browser.json')
assert all(c['pass'] for c in a['checks'])
assert not next(c['pass'] for c in b['checks'] if c['name'] == 'permission failure hides body')
assert not next(c['pass'] for c in b['checks'] if c['name'] == 'admin body update preserves article')
comparison = {'scope': a['scope'], 'textChars': a['textChars'], 'measurements': []}
for kind in ['markdown', 'progress']:
    row = {'kind': kind}
    for mode, data in [('before', b), ('after', a)]:
        samples = [r for r in data['render'] if r['kind'] == kind]
        row[mode] = {
            'medianUpdateMs': statistics.median(t for s in samples for t in s['times']),
            'medianMountMs': statistics.median(s['mountMs'] for s in samples),
            'mountLongTasks': [t for s in samples for t in s['mountLongtasks']],
            'updateLongTasks': [t for s in samples for t in s['longtasks']],
            'nodes': samples[0]['nodes'], 'rounds': len(samples), 'updates': sum(len(s['times']) for s in samples)
        }
    assert row['after']['medianUpdateMs'] < row['before']['medianUpdateMs']
    if kind == 'progress': assert row['after']['nodes'] < row['before']['nodes'] / 10
    comparison['measurements'].append(row)
soak, http = read('soak.json'), read('http.json')
assert soak['complete'] == soak['submitted'] == 40 and soak['peak'] <= 2 and soak['restartAfterSigkill']
assert 60000 <= soak['durationMs'] < soak['hardLimitMs'] and soak['maxRssKb'] < soak['rssLimitKb']
assert soak['credits'] == 100 and soak['ledger'] == 0
assert http['readOnlyBefore'] == http['readOnlyAfter'] and http['foreignReportStatus'] == 404
assert all(r['requests'] == 80 and r['errors'] == 0 for r in http['results'])
assert read('polling.json')['metrics']['bodyRequests'] == 2
(out / 'comparison.json').write_text(json.dumps(comparison, indent=2))
changed_expected = {
    'apps/web/components/markdown-renderer.tsx', 'apps/web/components/analysis-progress.tsx',
    'apps/web/app/admin/jobs/[id]/admin-report-viewer.tsx',
    'apps/web/app/(dashboard)/dashboard/analysis/analysis-client.tsx'
}
hashes = json.loads((before / 'hashes.json').read_text()); changed = []
for rel, expected in hashes.items():
    assert hashlib.sha256((before / rel).read_bytes()).hexdigest() == expected, f'Backup changed: {rel}'
    if hashlib.sha256((root / rel).read_bytes()).hexdigest() != expected: changed.append(rel)
assert set(changed) == changed_expected
files = sorted(changed_expected | {'apps/web/components/deferred-details.tsx'} | {
    str(p.relative_to(root)) for p in (root / 'scripts/diagnostics').glob('worker-stage4-*')
})
patch = []
for rel in files:
    oldfile, newfile = before / rel, root / rel
    old = oldfile.read_text().splitlines(keepends=True) if oldfile.exists() else []
    new = newfile.read_text().splitlines(keepends=True)
    patch.append(f'diff --git a/{rel} b/{rel}\n')
    if not oldfile.exists(): patch.append('new file mode 100644\n')
    patch.extend(difflib.unified_diff(old, new, fromfile='a/'+rel if oldfile.exists() else '/dev/null', tofile='b/'+rel))
(out / 'stage4-worker.patch').write_text(''.join(patch))
result = subprocess.run(['git', 'apply', '--reverse', '--check', str(out / 'stage4-worker.patch')], cwd=root, capture_output=True, text=True)
(out / 'rollback-check.log').write_text(result.stdout + result.stderr + f'exit={result.returncode}\n')
assert result.returncode == 0
(out / 'preservation.json').write_text(json.dumps({'backupFilesVerified': len(hashes), 'changedExisting': changed, 'unchangedExisting': len(hashes)-len(changed), 'patchFiles': files, 'afterHashes': {rel: hashlib.sha256((root/rel).read_bytes()).hexdigest() for rel in files}}, indent=2))
print(json.dumps({'artifactChecks': 'passed', 'backupFiles': len(hashes), 'patchFiles': files, 'comparison': comparison}, indent=2))
