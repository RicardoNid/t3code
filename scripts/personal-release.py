#!/usr/bin/env python3
"""Resolve and publish verified, two-platform releases of the personal fork."""
import argparse
import base64
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
    if not os.environ.get('GH_TOKEN'):
        result = subprocess.run(['gh', 'api', path], text=True, capture_output=True)
        if result.returncode:
            if '(HTTP 404)' in result.stderr:
                return None
            raise RuntimeError('GitHub API request failed: ' + result.stderr.strip())
        return json.loads(result.stdout)
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


def find_release(tag):
    published = api(f'repos/{REPO}/releases/tags/{tag}')
    if published:
        return published
    page = 1
    while True:
        releases = api(f'repos/{REPO}/releases?per_page=100&page={page}') or []
        for release in releases:
            if release['tag_name'] == tag:
                return api(f'repos/{REPO}/releases/{release["id"]}')
        if len(releases) < 100:
            return None
        page += 1


def release_files(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+-personal\.\d{8}\.\d+', version):
        raise ValueError('Unexpected personal build version')
    return {f'T3-Code-{version}-arm64.dmg', f'T3-Code-{version}-arm64.zip',
            f'T3-Code-{version}-amd64.deb', 'T3-Code-x86_64.AppImage',
            f't3-{version}-darwin-arm64.tar.gz', f't3-{version}-linux-x64.tar.gz',
            f't3-{version}-linux-arm64.tar.gz',
            'latest-mac.yml', 'latest-linux.yml'}


def next_version(upstream_tag, day, run_number, tags):
    prefix = f'{upstream_tag[1:]}-personal.{day}.'
    pattern = re.compile('v' + re.escape(prefix) + r'(\d+)')
    counters = [int(match.group(1)) for tag in tags if (match := pattern.fullmatch(tag))]
    return prefix + str(max(int(run_number), max(counters, default=0) + 1))


def digest_file(path, algorithm='sha256'):
    digest = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest


def prepare_feed(directory, version, platform):
    release_files(version)
    directory = pathlib.Path(directory)
    names = ([f'T3-Code-{version}-arm64.zip', f'T3-Code-{version}-arm64.dmg']
             if platform == 'mac' else ['T3-Code-x86_64.AppImage', f'T3-Code-{version}-amd64.deb'])
    files = []
    for name in names:
        path = directory / name
        files.append({'url': name, 'sha512': base64.b64encode(digest_file(path, 'sha512').digest()).decode(),
                      'size': path.stat().st_size})
    lines = [f'version: {version}', 'files:']
    for asset in files:
        lines.extend([f'  - url: {asset["url"]}', f'    sha512: {asset["sha512"]}', f'    size: {asset["size"]}'])
    lines.extend([f'path: {files[0]["url"]}', f'sha512: {files[0]["sha512"]}'])
    (directory / ('latest-mac.yml' if platform == 'mac' else 'latest-linux.yml')).write_text('\n'.join(lines) + '\n')


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
    for key in ('AUTHOR', 'COMMITTER'):
        os.environ.setdefault(f'GIT_{key}_NAME', 'T3 Personal Release')
        os.environ.setdefault(f'GIT_{key}_EMAIL', 'actions@users.noreply.github.com')
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
            published = find_release(previous['releaseTag'])
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
        version = next_version(tag, datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d'),
                               os.environ['GITHUB_RUN_NUMBER'],
                               git('for-each-ref', '--format=%(refname:short)', 'refs/tags').splitlines())
        provenance = {'upstreamTag': tag, 'upstreamSha': upstream, 'forkBase': base,
                      'recipe': recipe, 'version': version, 'releaseTag': f'v{version}',
                      'platforms': ['macos-arm64', 'ubuntu-26.04-x64', 'linux-arm64-server']}
        commit = merge_candidate(base, upstream, provenance)
        git('tag', release_tag, commit)
        git('tag', provenance['releaseTag'], commit)
        git('push', 'origin', f'{commit}:refs/heads/personal-candidates/{release_tag}',
            f'refs/tags/{release_tag}', f'refs/tags/{provenance["releaseTag"]}')
    emit({'needed': 'true', 'ref': commit, 'base': provenance['forkBase'],
          'version': provenance['version'], 'tag': release_tag})
    print(json.dumps(provenance, indent=2))


def publish(args):
    directory = pathlib.Path(args.directory)
    metadata = json.loads(git('show', f'{args.ref}:{PROVENANCE}'))
    expected = release_files(metadata['version'])
    actual = {p.name for p in directory.iterdir() if p.is_file()}
    if actual != expected:
        raise RuntimeError(f'Only the requested platform assets and metadata may be published: {actual}')
    current = git('ls-remote', 'origin', f'refs/heads/{BASE}').split()[0]
    if current not in (metadata['forkBase'], args.ref):
        raise RuntimeError('Personal branch moved during build; refusing stale publication')
    checksums = []
    assets = []
    for name in sorted(expected):
        path = directory / name
        digest = digest_file(path).hexdigest()
        checksums.append(f'{digest}  {name}')
        assets.append({'name': name, 'bytes': path.stat().st_size, 'sha256': digest})
    (directory / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    metadata.update(sourceCommit=args.ref, assets=assets, publisherCommit=git('rev-parse', 'HEAD'))
    (directory / 'personal-release.json').write_text(json.dumps(metadata, indent=2) + '\n')
    notes = directory / 'notes.txt'
    notes.write_text(f"上游 {metadata['upstreamTag']} + 个人版功能\n\n"
                     f"源码：{args.ref}\n仅提供 macOS Apple Silicon DMG 与 Ubuntu 26.04 x64 DEB。\n"
                     "包含相同平台的原生更新载荷、CLI 运行包与更新元数据。\n"
                     "macOS 使用临时签名，未进行 Apple 公证；Squirrel 自动安装仍需有效签名。\n")
    old = find_release(metadata['releaseTag'])
    if old and not old['draft']:
        raise RuntimeError('Published release is immutable')
    if not old:
        subprocess.run(['gh', 'release', 'create', metadata['releaseTag'], '--repo', REPO,
                        '--draft', '--verify-tag', '--title', metadata['version'], '--notes-file', str(notes)], check=True)
    subprocess.run(['gh', 'release', 'upload', metadata['releaseTag'], '--repo', REPO,
                    *[str(directory / name) for name in sorted(expected)], str(directory / 'SHA256SUMS'),
                    str(directory / 'personal-release.json'), '--clobber'], check=True)
    uploaded = find_release(metadata['releaseTag'])
    allowed = expected | {'SHA256SUMS', 'personal-release.json'}
    if {a['name'] for a in uploaded['assets']} != allowed:
        raise RuntimeError('Release assets differ from the two-platform update allowlist')
    if current != args.ref:
        git('push', 'origin', f'{args.ref}:refs/heads/{BASE}')
    subprocess.run(['gh', 'release', 'edit', metadata['releaseTag'], '--repo', REPO,
                    '--draft=false', '--latest'], check=True)
    print(f'https://github.com/{REPO}/releases/tag/{metadata["releaseTag"]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('resolve')
    prepare = commands.add_parser('prepare-feed')
    prepare.add_argument('--directory', required=True)
    prepare.add_argument('--version', required=True)
    prepare.add_argument('--platform', choices=['mac', 'linux'], required=True)
    final = commands.add_parser('publish')
    final.add_argument('--ref', required=True)
    final.add_argument('--directory', required=True)
    args = parser.parse_args()
    if args.command == 'resolve':
        resolve()
    elif args.command == 'prepare-feed':
        prepare_feed(args.directory, args.version, args.platform)
    else:
        publish(args)


if __name__ == '__main__':
    main()
