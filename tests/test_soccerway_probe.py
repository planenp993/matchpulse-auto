import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import urllib.error

from scripts import soccerway_probe as sw


def page():
    return ('tournamentTemplateId: "dYlOSQOD";'+''.join(
        'cjs.initialFeeds["'+name+'"] = {data: `'+data+'`};' for name, data in [
        ('summary-fixtures','ZA÷ENGLAND: Premier League¬ZEE÷dYlOSQOD¬~AA÷AbCd1234¬AD÷1793449800¬AE÷Chelsea¬AF÷Manchester Utd¬AB÷1¬AC÷1¬AL÷TV ADS¬ODDS÷9.9'),
        ('summary-results','ZA÷ENGLAND: Premier League¬ZEE÷dYlOSQOD¬~AA÷EfGh5678¬AD÷1792945800¬AE÷Sunderland¬AF÷Leeds¬AB÷3¬AC÷3¬AG÷0¬AH÷0')])).encode()


class SoccerwayProbeTests(unittest.TestCase):
    def test_only_observed_facts_are_retained_and_epoch_is_utc(self):
        data=sw.parse_page(page());future=data['summary-fixtures'][0];past=data['summary-results'][0]
        self.assertEqual(future['kickoff_utc'],'2026-10-31T12:30:00+00:00')
        self.assertEqual(future['display_score'],[None,None]);self.assertEqual(past['display_score'],[0,0])
        self.assertEqual(set(future),{'id','kickoff_utc','home','away','display_score','state_code','stage_code'})
        report=sw.probe(lambda:page());self.assertTrue(report['usable_sample'])
        self.assertFalse(report['production_enabled']);self.assertEqual(report['imported_matches'],0)

    def test_successful_html_without_real_data_is_rejected(self):
        for raw in [b'<html>Premier League Loading...</html>',page().replace(b'dYlOSQOD',b'OtherDiv'),page().replace(b'1793449800',b'TBD')]:
            self.assertFalse(sw.probe(lambda:raw)['usable_sample'])

    def test_duplicate_matches_and_dynamic_templates_are_rejected(self):
        for raw in [page().replace(b'AA'+bytes('÷','utf8')+b'AbCd1234',bytes('AA÷AbCd1234¬AD÷1793449800¬AE÷A¬AF÷B¬AB÷1¬AC÷1¬~AA÷AbCd1234','utf8')),
                    page().replace(b'TV ADS',b'${run()}')]:
            with self.assertRaises(ValueError):sw.parse_page(raw)

    def test_access_denial_is_reported_without_any_retry(self):
        calls=[]
        def blocked():
            calls.append(1);raise urllib.error.HTTPError(sw.URL,403,'Forbidden',{},None)
        result=sw.probe(blocked)
        self.assertEqual(calls,[1]);self.assertFalse(result['usable_sample']);self.assertEqual(result['http_status'],403)

    def test_ordinary_code_push_cannot_trigger_source_requests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
            git('init','-q');git('config','user.name','test');git('config','user.email','test@example.com')
            (root/'ops').mkdir();(root/sw.REQUEST).write_text(json.dumps({'schema':1,'provider':'Soccerway','id':'one'}))
            git('add','.');git('commit','-qm','[source-probe] Initial explicit request')
            # The production request is a non-root commit containing only this file.
            (root/sw.REQUEST).write_text(json.dumps({'schema':1,'provider':'Soccerway','id':'two'}))
            git('add','.');git('commit','-qm','[source-probe] Explicit second request')
            self.assertEqual(sw.validate_request(root,'push',git('rev-parse','HEAD')),'two')
            (root/'code.py').write_text('changed = True\n');git('add','.');git('commit','-qm','Ordinary code change')
            with self.assertRaises(ValueError):sw.validate_request(root,'push',git('rev-parse','HEAD'))
            (root/'code.py').write_text('changed = 2\n')
            (root/sw.REQUEST).write_text(json.dumps({'schema':1,'provider':'Soccerway','id':'three'}))
            git('add','.');git('commit','-qm','[source-probe] Mixed code and request must fail')
            with self.assertRaises(ValueError):sw.validate_request(root,'push',git('rev-parse','HEAD'))
