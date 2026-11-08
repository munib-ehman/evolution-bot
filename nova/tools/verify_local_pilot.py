#!/usr/bin/env python3
"""Opt-in acceptance check against an already installed local model. Fictional data only."""
import json
import os
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['NOVA_AI_PROVIDER']='ollama'
os.environ.setdefault('NOVA_AI_MODEL','llama3.2:3b')
from store import Store
from pilots import create
from engine import work_once,execute


def main():
    with tempfile.TemporaryDirectory() as folder:
        store=Store(Path(folder)/'acceptance.sqlite')
        create(store,'demo','Fictional travel agency','15555550101','test-phone')
        def owner(text):
            event=store.enqueue('demo','owner',{'text':text,'channel':'local'})
            for _ in range(30):
                if not work_once(store):break
            row=store.db.execute('SELECT state,result FROM events WHERE id=?',(event,)).fetchone()
            if row['state']!='done':raise AssertionError(row['result'])
            return json.loads(row['result'])
        for text in ['Hello','Family holidays','Prepare inquiries and follow-ups','WhatsApp and Calendar',
                     'We answer inquiries, quote manually and follow up later','40 10']:
            owner(text)
        assert store.business('demo')['config']['onboarding']['stage']=='knowledge'
        store.ingest('demo','packages.txt','Consultation is free. A sample Dubai package costs USD 500 per adult. Availability requires confirmation.',True)
        for text in ['DONE','1','How much is a consultation?','ACTIVATE']:
            answer=owner(text)
        assert store.business('demo')['config']['onboarding']['stage']=='active'
        owner('BUILD inquiries')
        owner('Can you tell me about the Dubai package?')
        owner('ACTIVATE WORKFLOW')
        assert store.business('demo')['config']['workflows']['inquiries']['active']
        event=store.enqueue('demo','customer',{'text':'I want a Dubai holiday for two adults','from':'15555550202','channel':'local'})
        work_once(store)
        proposals=[dict(row) for row in store.db.execute('SELECT * FROM actions WHERE event=?',(event,))]
        assert {a['tool'] for a in proposals}=={'save_lead','send_message'}
        assert all(a['state']=='approval' for a in proposals)
        lead=next(a for a in proposals if a['tool']=='save_lead')
        owner('APPROVE '+lead['id'])
        execute(store,lead)
        assert store.db.execute('SELECT COUNT(*) FROM leads').fetchone()[0]==1
        send=next(a for a in proposals if a['tool']=='send_message')
        owner('REJECT '+send['id'])
        owner('PAUSE');assert store.business('demo')['config']['paused']
        owner('RESUME');assert not store.business('demo')['config']['paused']
        report=owner('REPORT')
        assert report['reply']
        assert store.db.execute("SELECT COUNT(*) FROM actions WHERE tool='send_message' AND state='succeeded'").fetchone()[0]==0
        result={'model':os.environ['NOVA_AI_MODEL'],'provider':'local Ollama','detailed_interview':'passed',
                'sample_review_activation':'passed','workflow_build':'passed','customer_reply_proposal':'passed',
                'lead_approval_execution':'passed','send_rejection':'passed','pause_resume_report':'passed',
                'real_external_messages':0,'paid_api_calls':0,
                'model_tokens':store.report('demo')['costs']['recorded_model_tokens']}
        store.db.close()
        print(json.dumps(result,indent=2))
        return result

if __name__=='__main__':main()
