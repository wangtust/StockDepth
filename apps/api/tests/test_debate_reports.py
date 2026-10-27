from stockdepth.api.analysis_runner import save_report_parts
from stockdepth.api.server import read_report_files


def test_debate_reports_are_discovered_with_chronological_history(tmp_path):
    reports = tmp_path / 'reports'
    reports.mkdir()
    state = {
        'investment_debate_state': {'history': 'Bull Analyst: first\nBear Analyst: reply\nBull Analyst: second',
                                    'bull_history': 'Bull Analyst: first\nBull Analyst: second',
                                    'bear_history': 'Bear Analyst: reply'},
        'risk_debate_state': {'history': 'Aggressive Analyst: first\nConservative Analyst: reply\nNeutral Analyst: last',
                              'aggressive_history': 'Aggressive Analyst: first',
                              'conservative_history': 'Conservative Analyst: reply',
                              'neutral_history': 'Neutral Analyst: last'},
    }
    save_report_parts(state, reports)
    found = {r['key']: r['content'] for r in read_report_files(tmp_path)}
    assert set(found) == {'research_debate', 'bull', 'bear', 'risk_debate', 'aggressive', 'conservative', 'neutral'}
    assert found['research_debate'].index('first') < found['research_debate'].index('reply') < found['research_debate'].index('second')
    assert found['risk_debate'].index('first') < found['risk_debate'].index('reply') < found['risk_debate'].index('last')


def test_legacy_report_paths_remain_discoverable(tmp_path):
    reports = tmp_path / 'reports' / '2_research'
    reports.mkdir(parents=True)
    (reports / 'bull.md').write_text('legacy', encoding='utf8')
    found = read_report_files(tmp_path)
    assert [(r['key'], r['content']) for r in found] == [('bull', 'legacy')]
