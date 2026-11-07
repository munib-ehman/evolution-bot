import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import onboarding
from engine import command, execute, propose, work_once
from store import Store


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(str(Path(self.temp.name) / 'flow.sqlite'))
        self.store.add_business('travel', 'Travel', '15555550101', 'travel-wa')
        self.store.add_business('detail', 'Detailing', '15555550202', 'detail-wa')

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def turn(self, text, planner=None, business='travel'):
        event = self.store.enqueue(business, 'owner', {'text': text, 'channel': 'local'})
        work_once(self.store, planner or (lambda *_: {'reply': 'Ready', 'actions': []}))
        return json.loads(self.store.db.execute('SELECT result FROM events WHERE id=?', (event,)).fetchone()[0])

    def action(self, tool, args, business='travel'):
        event = self.store.enqueue(business, 'owner', {'text': 'test'})
        self.store.db.execute("UPDATE events SET state='done' WHERE id=?", (event,))
        result = propose(self.store, self.store.business(business), event, tool, args)
        command(self.store, self.store.business(business), 'APPROVE ' + result['id'])
        execute(self.store, result)
        return self.store.db.execute('SELECT * FROM actions WHERE id=?', (result['id'],)).fetchone()

    def test_conversational_setup_and_explicit_activation(self):
        onboarding.start(self.store, self.store.business('travel'))
        self.turn('We sell family travel packages')
        self.turn('Handle inquiries and follow up on quotes')
        self.turn('Packages and policies can be sent as a file')
        self.turn('done')
        self.turn('2')
        def practice(*_):
            return {'reply': 'Where would you like to travel?', 'actions': [
                {'tool': 'send_message', 'args': {'to': '15555550303', 'text': 'Must never send'}}]}
        self.turn('A family of four wants Dubai', practice)
        self.assertEqual(self.store.business('travel')['config']['onboarding']['stage'], 'review')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM actions').fetchone()[0], 0)
        self.turn('activate')
        config = self.store.business('travel')['config']
        self.assertEqual(config['onboarding']['stage'], 'active')
        self.assertEqual(config['rules']['send_message'], 'auto')
        self.assertNotIn('confirm_booking', config['rules'])

    def test_failed_practice_keeps_setup_at_trial(self):
        business = self.store.business('travel')
        business['config']['onboarding'] = {'stage': 'trial'}
        onboarding.save(self.store, business)
        def unavailable(*_):
            raise ValueError('AI is not configured')
        result = self.turn('Sample inquiry', unavailable)
        self.assertEqual(result['error'], 'ValueError')
        self.assertEqual(self.store.business('travel')['config']['onboarding']['stage'], 'trial')

    def test_pause_blocks_actions_and_resume_restores_them(self):
        self.turn('pause everything')
        result = self.action('remember', {'name': 'test', 'text': 'Business rule'})
        self.assertEqual(result['state'], 'held')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM documents').fetchone()[0], 0)
        self.turn('resume')
        execute(self.store, dict(result))
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM documents').fetchone()[0], 1)

    def test_customer_activation_gate(self):
        onboarding.start(self.store, self.store.business('travel'))
        event = self.store.enqueue('travel', 'customer', {'text': 'Dubai prices?', 'from': '15555550303', 'channel': 'whatsapp'})
        work_once(self.store, lambda *_: self.fail('No model before activation'))
        self.assertEqual(self.store.db.execute('SELECT state FROM events WHERE id=?', (event,)).fetchone()[0], 'awaiting_activation')

    def test_owner_can_import_and_share_chat_file(self):
        self.store.enqueue('travel', 'import', {'document': {'id': 'media1', 'filename': 'packages.txt'}, 'channel': 'local'})
        with patch('engine.whatsapp_document', return_value=('packages.txt', 'Dubai with breakfast')):
            work_once(self.store)
        self.assertEqual(self.store.context('travel', 'Dubai', customer='15555550303')['references'], [])
        self.turn('SHARE packages.txt')
        self.assertIn('breakfast', json.dumps(self.store.context('travel', 'Dubai', customer='15555550303')))
        command(self.store, self.store.business('detail'), 'SHARE packages.txt')
        self.assertEqual(self.store.context('detail', 'Dubai', customer='15555550303')['references'], [])

    def test_inquiry_quote_and_approved_booking(self):
        lead = self.action('save_lead', {'contact': '15555550303', 'name': 'Pilot buyer', 'need': 'Dubai holiday'})
        lead_id = json.loads(lead['result'])['lead_id']
        quote = self.action('prepare_quote', {'lead_id': lead_id, 'description': 'Approved package', 'amount': '500.00', 'currency': 'USD'})
        result = json.loads(quote['result'])
        self.assertFalse(result['sent'])
        self.assertEqual(self.store.report('travel')['sales']['bookings_confirmed'], 0)
        booking = self.action('confirm_booking', {'quote_id': result['quote_id'], 'starts_at': '2099-03-01T10:00:00+00:00', 'ends_at': '2099-03-02T10:00:00+00:00'})
        self.assertEqual(booking['state'], 'succeeded')
        self.assertFalse(json.loads(booking['result'])['calendar_synced'])
        self.assertEqual(self.store.report('travel')['sales']['bookings_confirmed'], 1)

    def test_foreign_lead_cannot_be_quoted(self):
        lead = self.action('save_lead', {'contact': '15555550303', 'name': 'Buyer', 'need': 'Trip'})
        lead_id = json.loads(lead['result'])['lead_id']
        quote = self.action('prepare_quote', {'lead_id': lead_id, 'description': 'Other business', 'amount': '100', 'currency': 'USD'}, business='detail')
        self.assertEqual(quote['state'], 'failed')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM quotes').fetchone()[0], 0)

    def test_quote_amount_validation(self):
        for amount in ['NaN', '-1', '0', '1.001', 'Infinity']:
            with self.assertRaises(ValueError):
                self.action('prepare_quote', {'lead_id': 'x', 'description': 'Package', 'amount': amount, 'currency': 'USD'})

    def test_customer_stop_blocks_even_approved_reply(self):
        self.store.enqueue('travel', 'customer', {'text': 'STOP', 'from': '15555550303', 'channel': 'whatsapp'})
        work_once(self.store, lambda *_: self.fail('No AI after STOP'))
        result = self.action('send_message', {'to': '15555550303', 'text': 'A quote'})
        self.assertEqual(result['state'], 'failed')

    def test_sms_reply_uses_customer_channel(self):
        business = self.store.business('detail')
        business['config']['sms_number'] = '+15555550404'
        onboarding.save(self.store, business)
        self.store.enqueue('detail', 'customer', {'text': 'Need a wash', 'from': '15555550303', 'channel': 'sms'})
        self.store.db.execute("UPDATE events SET state='done'")
        with patch('engine.sms_send', return_value='SM123') as sender, patch('engine.whatsapp_send') as whatsapp:
            action = self.action('send_message', {'to': '15555550303', 'text': 'What vehicle?'}, business='detail')
            sender.assert_called_once_with('+15555550404', '+15555550303', 'What vehicle?')
            whatsapp.assert_not_called()
            self.assertEqual(action['state'], 'succeeded')

    def test_calendar_command_handles_connected_account(self):
        with patch('connections.connection_link', return_value={'status': 'connected'}):
            result = self.turn('connect calendar')
        self.assertEqual(result['reply'], 'Your Google Calendar is connected.')

    def test_calendar_event_requires_approval_and_preserves_action_id(self):
        event = self.store.enqueue('travel', 'owner', {'text': 'Add appointment'})
        self.store.db.execute("UPDATE events SET state='done' WHERE id=?", (event,))
        args = {'summary': 'Agency consultation', 'start': '2099-03-01T10:00:00+00:00', 'end': '2099-03-01T11:00:00+00:00'}
        action = propose(self.store, self.store.business('travel'), event, 'calendar_event', args)
        with patch('connections.calendar_event', return_value={'status': 'created', 'event_id': 'calendar-1'}) as calendar:
            execute(self.store, action)
            calendar.assert_not_called()
            command(self.store, self.store.business('travel'), 'APPROVE ' + action['id'])
            execute(self.store, action)
            calendar.assert_called_once_with(self.store, 'travel', action['id'], args)

    def test_same_quote_cannot_be_booked_twice(self):
        lead = self.action('save_lead', {'contact': '15555550303', 'name': 'Buyer', 'need': 'Trip'})
        quote = self.action('prepare_quote', {'lead_id': json.loads(lead['result'])['lead_id'], 'description': 'Package', 'amount': '100', 'currency': 'USD'})
        args = {'quote_id': json.loads(quote['result'])['quote_id'], 'starts_at': '2099-04-01T10:00:00+00:00', 'ends_at': '2099-04-01T11:00:00+00:00'}
        self.assertEqual(self.action('confirm_booking', args)['state'], 'succeeded')
        self.assertEqual(self.action('confirm_booking', args)['state'], 'failed')
        self.assertEqual(self.store.report('travel')['sales']['bookings_confirmed'], 1)

    def test_paused_and_setup_actions_cannot_execute(self):
        onboarding.start(self.store, self.store.business('travel'))
        action = self.action('remember', {'name': 'test', 'text': 'Must wait until activation'})
        self.assertEqual(action['state'], 'held')
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM documents').fetchone()[0], 0)
