"""Per-run credentials supplied by SaaS take precedence over local defaults."""

from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

from stockdepth.api import analysis_runner


class RunnerCredentialsTest(unittest.TestCase):
    def test_runner_preserves_injected_api_key(self):
        class StopBeforeAnalysis(Exception):
            pass

        def check_credentials(**kwargs):
            self.assertEqual(os.environ['OPENAI_API_KEY'], 'selected-model-key')
            raise StopBeforeAnalysis

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env').write_text('OPENAI_API_KEY=local-default\n')
            with (
                patch.object(analysis_runner, '__file__', str(root / 'apps' / 'api' / 'stockdepth' / 'api' / 'analysis_runner.py')),
                patch.dict(os.environ, OPENAI_API_KEY='selected-model-key'),
                patch('sys.argv', ['analysis_runner', '--ticker', 'ORCL', '--date', '2026-10-12', '--provider', 'openai-compatible', '--quick-model', 'test', '--deep-model', 'test']),
                patch.dict(analysis_runner.DEFAULT_CONFIG, results_dir=str(root / 'reports')),
                patch.object(analysis_runner, 'StockDepthGraph', check_credentials),
                self.assertRaises(StopBeforeAnalysis),
            ):
                analysis_runner.main()
