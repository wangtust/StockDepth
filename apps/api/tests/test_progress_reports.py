import tempfile
import unittest
from pathlib import Path

from langchain_core.messages import AIMessage, ToolMessage
from stockdepth.api.analysis_runner import save_progress
from stockdepth.api.server import read_report_files


class ProgressReportsTest(unittest.TestCase):
    def test_progress_survives_stage_reset_and_excludes_reasoning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report_dir = root / 'reports'
            message = AIMessage(content='公开回复', id='reply', additional_kwargs={'reasoning_content': 'private reasoning'}, tool_calls=[{'name': 'get_stock_data', 'args': {'symbol': 'ORCL'}, 'id': 'call'}])
            save_progress({'messages': [message]}, report_dir)
            save_progress({'messages': [message]}, report_dir)
            save_progress({'messages': [ToolMessage(content='行情数据', name='get_stock_data', tool_call_id='call', id='result')]}, report_dir)
            content = (report_dir / 'progress.md').read_text()
            self.assertEqual(content.count('公开回复'), 1)
            self.assertIn('行情数据', content)
            self.assertIn('ORCL', content)
            self.assertNotIn('private reasoning', content)
            reports = read_report_files(root)
            self.assertEqual(reports[0]['key'], 'progress')
            self.assertEqual(reports[0]['content'], content)
