#!/usr/bin/env python3
"""Resolve and publish verified, two-platform releases of the personal fork."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import urllib.error
import urllib.request

REPO = 'RicardoNid/t3code'
BASE = 'feat/device-text-icons'
PROVENANCE = '.github/personal-release-provenance.json'


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def api(path):
    request = urllib.request.Request('https://api.github.com/' + path, headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'User-Agent': 't3-personal-release'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def integrated(base, marker, provenance, upstream, recipe):
    return (base == marker and provenance.get('upstreamSha') == upstream
            and provenance.get('recipe') == recipe)


def release_files(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+-personal\.\d{8}\.\d+', version):
        raise ValueError('Unexpected personal build version')
    return {f'T3-Code-{version}-arm64.dmg', f'T3-Code-{version}-amd64.deb'}


def emit(values):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        for key, value in values.items():
            output.write(f'{key}={value}\n')


def merge_candidate(base, upstream, provenance):
    git('checkout', '--detach', base)
    merged = subprocess.run(['git', 'merge', '--no-edit', upstream])
    if merged.returncode:
        conflicts = git('diff', '--name-only', '--diff-filter=U')
        raise RuntimeError('Integration needs conflict review:\n' + conflicts)
    pathlib.Path(PROVENANCE).parent.mkdir(exist_ok=True)
    text = '{\n' + ',\n'.join('  ' + json.dumps(key) + ': ' + json.dumps(value)
                                for key, value in provenance.items()) + '\n}\n'
    pathlib.Path(PROVENANCE).write_text(text)
    git('add', PROVENANCE)
    git('commit', '-m', f'chore(release): prepare personal {provenance["upstreamTag"]}')
    return git('rev-parse', 'HEAD')


def resolve():
    controller = pathlib.Path(__file__).resolve()
    workflow = controller.parent.parent / '.github/workflows/personal-release.yml'
    recipe = hashlib.sha256(controller.read_bytes() + workflow.read_bytes()).hexdigest()
    latest = api('repos/pingdotgg/t3code/releases/latest')
    if not latest or latest['draft'] or latest['prerelease']:
        raise RuntimeError('No stable upstream release')
    tag = latest['tag_name']
    if not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise RuntimeError('Unexpected upstream tag')
    git('config', 'user.name', 'T3 Personal Release')
    git('config', 'user.email', 'actions@users.noreply.github.com')
    git('fetch', 'origin', f'+refs/heads/{BASE}:refs/remotes/origin/{BASE}', '--tags')
    base = git('rev-parse', f'origin/{BASE}')
    git('-c', 'http.https://github.com/.extraheader=', 'fetch',
        'https://github.com/pingdotgg/t3code.git', f'refs/tags/{tag}')
    upstream = git('rev-parse', 'FETCH_HEAD^{commit}')
    previous = {}
    existing = subprocess.run(['git', 'show', f'{base}:{PROVENANCE}'], capture_output=True, text=True)
    if existing.returncode == 0:
        previous = json.loads(existing.stdout)
        if previous.get('upstreamTag') == tag and previous.get('upstreamSha') != upstream:
            raise RuntimeError('Upstream tag changed; review required')
        marker = git('log', '-1', '--format=%H', base, '--', PROVENANCE)
        if integrated(base, marker, previous, upstream, recipe):
            published = api(f'repos/{REPO}/releases/tags/{previous["releaseTag"]}')
            if published and not published['draft']:
                emit({'needed': 'false'})
                print('Already released this upstream/fork/recipe combination')
                return
            release_tag = previous['releaseTag']
        else:
            release_tag = f'personal-{tag}-f{base[:12]}-r{recipe[:12]}'
    else:
        release_tag = f'personal-{tag}-f{base[:12]}-r{recipe[:12]}'
    found = subprocess.run(['git', 'rev-parse', '--verify', f'refs/tags/{release_tag}^{{commit}}'],
                           capture_output=True, text=True)
    if found.returncode == 0:
        commit = found.stdout.strip()
        provenance = json.loads(git('show', f'{commit}:{PROVENANCE}'))
        if (provenance.get('upstreamSha') != upstream or provenance.get('recipe') != recipe
                or base not in (provenance.get('forkBase'), commit)):
            raise RuntimeError('Existing candidate provenance changed; review required')
    else:
        version = tag[1:] + '-personal.' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d') + '.' + os.environ['GITHUB_RUN_NUMBER']
        provenance = {'upstreamTag': tag, 'upstreamSha': upstream, 'forkBase': base,
                      'recipe': recipe, 'version': version, 'releaseTag': release_tag,
                      'platforms': ['macos-arm64', 'ubuntu-26.04-x64']}
        commit = merge_candidate(base, upstream, provenance)
        git('tag', release_tag, commit)
        git('push', 'origin', f'{commit}:refs/heads/personal-candidates/{release_tag}',
            f'refs/tags/{release_tag}')
    emit({'needed': 'true', 'ref': commit, 'base': provenance['forkBase'],
          'version': provenance['version'], 'tag': release_tag})
    print(json.dumps(provenance, indent=2))


def publish(args):
    directory = pathlib.Path(args.directory)
    metadata = json.loads(git('show', f'{args.ref}:{PROVENANCE}'))
    expected = release_files(metadata['version'])
    actual = {p.name for p in directory.iterdir() if p.is_file()}
    if actual != expected:
        raise RuntimeError(f'Only the two requested installers may be published: {actual}')
    current = git('ls-remote', 'origin', f'refs/heads/{BASE}').split()[0]
    if current not in (metadata['forkBase'], args.ref):
        raise RuntimeError('Personal branch moved during build; refusing stale publication')
    checksums = []
    assets = []
    for name in sorted(expected):
        path = directory / name
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        checksums.append(f'{digest}  {name}')
        assets.append({'name': name, 'bytes': path.stat().st_size, 'sha256': digest})
    (directory / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    metadata.update(sourceCommit=args.ref, assets=assets)
    (directory / 'personal-release.json').write_text(json.dumps(metadata, indent=2) + '\n')
    notes = directory / 'notes.txt'
    notes.write_text(f"上游 {metadata['upstreamTag']} + 个人版功能\n\n"
                     f"源码：{args.ref}\n仅提供 macOS Apple Silicon DMG 与 Ubuntu 26.04 x64 DEB。\n"
                     "macOS 使用临时签名，未进行 Apple 公证。不会自动安装。\n")
    old = api(f'repos/{REPO}/releases/tags/{metadata["releaseTag"]}')
    if old and not old['draft']:
        raise RuntimeError('Published release is immutable')
    if not old:
        subprocess.run(['gh', 'release', 'create', metadata['releaseTag'], '--repo', REPO,
                        '--draft', '--verify-tag', '--title', metadata['version'], '--notes-file', str(notes)], check=True)
    subprocess.run(['gh', 'release', 'upload', metadata['releaseTag'], '--repo', REPO,
                    *[str(directory / name) for name in sorted(expected)], str(directory / 'SHA256SUMS'),
                    str(directory / 'personal-release.json'), '--clobber'], check=True)
    uploaded = api(f'repos/{REPO}/releases/tags/{metadata["releaseTag"]}')
    allowed = expected | {'SHA256SUMS', 'personal-release.json'}
    if {a['name'] for a in uploaded['assets']} != allowed:
        raise RuntimeError('Release assets differ from the two-platform allowlist')
    if current != args.ref:
        git('push', 'origin', f'{args.ref}:refs/heads/{BASE}')
    subprocess.run(['gh', 'release', 'edit', metadata['releaseTag'], '--repo', REPO,
                    '--draft=false', '--latest'], check=True)
    print(f'https://github.com/{REPO}/releases/tag/{metadata["releaseTag"]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('resolve')
    final = commands.add_parser('publish')
    final.add_argument('--ref', required=True)
    final.add_argument('--directory', required=True)
    args = parser.parse_args()
    if args.command == 'resolve':
        resolve()
    else:
        publish(args)


if __name__ == '__main__':
    main()
