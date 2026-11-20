import argparse
import contextlib
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('release', pathlib.Path(__file__).with_name('personal-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_setup_action_receives_filter_arguments_without_literal_shell_quotes(self):
        workflow = pathlib.Path(__file__).resolve().parent.parent / '.github/workflows/personal-release.yml'
        found = []
        for line in workflow.read_text().splitlines():
            if 'install-args:' not in line:
                continue
            value = line.split('install-args:', 1)[1].strip()
            env = dict(os.environ, INSTALL_ARGS=value)
            output = subprocess.check_output(['bash', '-c', 'set -- $INSTALL_ARGS; printf "%s\\n" "$@"'], env=env, text=True)
            tokens = output.splitlines()
            self.assertEqual(tokens[::2], ['--filter'] * (len(tokens) // 2))
            for package in tokens[1::2]:
                self.assertNotIn("'", package)
                self.assertNotIn('"', package)
            found.extend(tokens[1::2])
        self.assertIn('./scripts...', found)
        self.assertIn('@t3tools/scripts...', found)

    def test_successful_promotion_does_not_trigger_another_hourly_build(self):
        provenance = {'upstreamSha': 'upstream', 'recipe': 'recipe'}
        self.assertTrue(release.integrated('promoted', 'promoted', provenance, 'upstream', 'recipe'))
        self.assertFalse(release.integrated('new-personal-feature', 'promoted', provenance, 'upstream', 'recipe'))
        self.assertFalse(release.integrated('promoted', 'promoted', provenance, 'next-upstream', 'recipe'))
        self.assertFalse(release.integrated('promoted', 'promoted', provenance, 'upstream', 'changed-recipe'))

    def test_asset_policy_rejects_extra_platforms_or_incomplete_builds_before_publication(self):
        version = '0.1.11-personal.20261120.1'
        expected = release.release_files(version)
        self.assertEqual(expected, {f'T3-Code-{version}-arm64.dmg', f'T3-Code-{version}-amd64.deb'})
        with self.assertRaises(ValueError):
            release.release_files('../../bad')
        for extra in (False, True):
            with tempfile.TemporaryDirectory() as temporary, patch.object(release, 'git') as git, patch.object(release, 'api') as api:
                import json
                git.return_value = json.dumps({'version': version})
                for name in expected:
                    (pathlib.Path(temporary) / name).write_bytes(b'fixture')
                if extra:
                    (pathlib.Path(temporary) / 'windows.exe').write_bytes(b'not allowed')
                else:
                    (pathlib.Path(temporary) / sorted(expected)[0]).unlink()
                with self.assertRaises(RuntimeError):
                    release.publish(argparse.Namespace(directory=temporary, ref='candidate'))
                api.assert_not_called()

    def test_real_merge_preserves_both_histories_and_refuses_conflicts(self):
        for conflict in (False, True):
            with self.subTest(conflict=conflict), tempfile.TemporaryDirectory() as temporary:
                previous = os.getcwd()
                with contextlib.ExitStack() as cleanup:
                    cleanup.callback(os.chdir, previous)
                    os.chdir(temporary)
                    def git(*args):
                        return subprocess.check_output(['git', *args], text=True, stderr=subprocess.DEVNULL).strip()
                    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com')
                    pathlib.Path('shared').write_text('base\n'); git('add', '.'); git('commit', '-m', 'base')
                    common = git('rev-parse', 'HEAD')
                    pathlib.Path('shared' if conflict else 'personal').write_text('personal\n')
                    git('add', '.'); git('commit', '-m', 'personal'); base = git('rev-parse', 'HEAD')
                    git('checkout', '--detach', common)
                    pathlib.Path('shared' if conflict else 'upstream').write_text('upstream\n')
                    git('add', '.'); git('commit', '-m', 'upstream'); upstream = git('rev-parse', 'HEAD')
                    if conflict:
                        with self.assertRaisesRegex(RuntimeError, 'conflict review'):
                            release.merge_candidate(base, upstream, {'upstreamTag': 'v0.1.11'})
                        self.assertEqual(git('rev-parse', 'HEAD'), base)
                    else:
                        candidate = release.merge_candidate(base, upstream, {'upstreamTag': 'v0.1.11'})
                        for ancestor in (base, upstream):
                            git('merge-base', '--is-ancestor', ancestor, candidate)
                        self.assertEqual(pathlib.Path('personal').read_text(), 'personal\n')
                        self.assertEqual(pathlib.Path('upstream').read_text(), 'upstream\n')


if __name__ == '__main__':
    unittest.main()
