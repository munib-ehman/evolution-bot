"""Owner setup happens in the message thread. Every activation has an explicit review."""
import json
import os
import re
import sqlite3
import time


def save(store, business):
    store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(business['config']), business['id']))


def inbox_bound(business):
    return bool(re.fullmatch(r'[0-9]{5,32}', business['phone_id']))


def bind_inbox(store, business_id, phone_id):
    """Bind a customer inbox after the operator has obtained the owner's Meta grant."""
    from channels import whatsapp_phone

    business = store.business(business_id)
    operator = business['config'].get('operator_phone_id') or os.environ.get('NOVA_WHATSAPP_PHONE_ID')
    if phone_id == operator or store.db.execute(
        "SELECT 1 FROM businesses WHERE json_extract(config,'$.operator_phone_id')=?", (phone_id,)
    ).fetchone():
        raise ValueError('Use the customer-facing inbox, separate from the Nova owner chat.')
    if inbox_bound(business) and business['phone_id'] != phone_id:
        raise ValueError('This business already has an inbox. Reconcile pending work before changing it.')
    display = whatsapp_phone(phone_id)
    try:
        bound = store.db.execute('UPDATE businesses SET phone_id=? WHERE id=? AND phone_id=?',
                                 (phone_id, business_id, business['phone_id']))
        if not bound.rowcount:
            raise ValueError('The inbox changed during verification. Check the current connection and retry.')
    except sqlite3.IntegrityError:
        raise ValueError('This inbox is already assigned to a business.') from None
    return display


def start(store, business):
    previous = business['config'].get('onboarding', {})
    business['config']['onboarding'] = {'stage': 'profile', **{key: True for key in ('detailed', 'require_inbox') if previous.get(key)}}
    save(store, business)
    return 'Hi, I’m Nova by Evolution. What does your business sell, and who are your customers? You can send a voice note.'


def handle(store, business, text, planner):
    normalized = text.strip().lower().rstrip('.!')
    if normalized in {'setup', 'set up nova', 'start setup'}:
        return start(store, business)
    flow = business['config'].get('onboarding', {})
    stage = flow.get('stage', 'active')
    if stage == 'welcome':
        return start(store, business)
    if stage == 'active':
        return None
    if stage == 'profile':
        store.ingest(business['id'], 'Business description', text)
        flow['stage'] = 'goal'
        reply = 'What would you like me to handle first? For example, customer inquiries, quotes and follow-ups.'
    elif stage == 'goal':
        store.ingest(business['id'], 'Owner goal', text)
        flow['stage'] = 'tools' if flow.get('detailed') else 'knowledge'
        reply = ('Send exported conversations as .txt files and your current packages or services as .txt or .csv files. '
                 'I’ll keep imports private. For information I can use with customers, reply SHARE followed by the exact file name. '
                 'You can also describe the business information here. Say DONE when ready.')
        if flow.get('detailed'):
            reply = 'Which tools and messaging numbers does your team use? Where do inquiries, quotes, bookings and payments get recorded?'
    elif stage == 'tools':
        store.ingest(business['id'], 'Current business tools', text)
        flow['stage'] = 'bottlenecks'
        reply = 'Walk me through one customer from first inquiry to completed booking. Which steps take the most time or get forgotten?'
    elif stage == 'bottlenecks':
        store.ingest(business['id'], 'Business process and bottlenecks', text)
        flow['stage'] = 'baseline'
        reply = 'About how many inquiries do you handle each week, and how many staff minutes does each take? Reply with two numbers, for example 40 10, or say SKIP.'
    elif stage == 'baseline':
        if normalized != 'skip':
            try:
                count, minutes = text.split()
                count, minutes = int(count), float(minutes)
                if not 0 <= count <= 100000 or not 0 < minutes <= 1440:
                    raise ValueError()
            except (ValueError, OverflowError):
                return 'Reply with weekly inquiries and minutes per inquiry, for example 40 10, or SKIP.'
            business['config']['baseline'] = {'weekly_inquiries': count, 'minutes_per_inquiry': minutes}
        flow['stage'] = 'knowledge'
        reply = 'Send your current packages, services, FAQs and exported conversations as text files. Imports stay private until you explicitly SHARE a file for customer use. Say DONE when ready.'
    elif stage == 'knowledge':
        if normalized != 'done':
            store.ingest(business['id'], 'Setup information ' + str(time.time_ns()), text)
            return 'Saved privately. You can send more information or files. Say DONE when ready.'
        if flow.get('require_inbox'):
            if not store.db.execute('SELECT 1 FROM documents WHERE business=? AND customer_safe=1', (business['id'],)).fetchone():
                return 'Share one current package or FAQ for customer use first. Reply SHARE followed by its file name, then DONE.'
            flow['stage'] = 'access'
            save(store, business)
            return 'Next, authorize Nova for your WhatsApp Business inbox through Meta. Reply INBOX STATUS to check the connection, then DONE. For optional Google Calendar access, say CONNECT CALENDAR.'
        flow['stage'] = 'permissions'
        reply = ('I can run supported work automatically and report back. Reply CONTINUE for this mode. Or reply 1 to ask before every action, or 2 for automatic replies and scheduling, '
                 'while asking before quotes, bookings and other changes. You can change these rules later.')
    elif stage == 'access':
        if normalized != 'done' or not inbox_bound(business):
            return 'Once Evolution has linked the inbox you authorized in Meta, reply DONE. You can check with INBOX STATUS.'
        flow['stage'] = 'permissions'
        reply = 'Choose how I handle your inbox. Reply 1 to review every action, or 2 for automatic replies and follow-ups. Quotes and bookings still go to your team.'
    elif stage == 'permissions':
        if normalized not in {'1', '2', '3', 'continue'}:
            return 'Reply CONTINUE for automatic work, 1 to review every action, or 2 for automatic replies and scheduling only.'
        if flow.get('require_inbox') and normalized not in {'1', '2'}:
            return 'Reply 1 to review every action, or 2 for automatic replies and follow-ups.'
        automatic = normalized in {'3', 'continue'}
        business['config']['execution_mode'] = 'automatic' if automatic else 'review'
        business['config']['rules'] = {} if automatic else {'send_message': 'auto' if normalized == '2' else 'approve',
                                       'schedule': 'auto' if normalized == '2' else 'approve'}
        flow['stage'] = 'trial'
        reply = 'Let’s check my understanding. Send a sample customer inquiry. I’ll prepare a practice response for you to review.'
    elif stage == 'trial':
        # The model cannot execute trial actions, even if its response proposes them.
        answer = planner(store, business, 'Prepare a clearly labelled practice response to this sample inquiry. Do not propose actions.\n' + text)
        store.ingest(business['id'], 'Reviewed setup sample', json.dumps({'inquiry': text, 'response': answer['reply']}))
        flow['stage'] = 'review'
        reply = 'Practice response, not sent to a customer\n\n' + answer['reply'] + '\n\nReply ACTIVATE if this is right, or send a correction.'
    elif stage == 'review':
        if normalized not in {'activate', 'go live'}:
            store.ingest(business['id'], 'Owner setup correction ' + str(time.time_ns()), text)
            flow['stage'] = 'trial'
            reply = 'Saved your correction. Send another sample inquiry so we can test it.'
        else:
            flow['stage'] = 'active'
            reply = 'Nova is active. Message me your work, ask for a report, or say PAUSE anytime. Quotes and bookings follow your approval rules.'
            if flow.get('require_inbox'):
                reply += ' To start follow-ups, say “Follow up after four hours.”'
            if flow.get('detailed'):
                from workflows import recommendations_text
                reply += '\n\n' + recommendations_text(business)
    else:
        raise ValueError('Setup state is unavailable')
    business['config']['onboarding'] = flow
    save(store, business)
    return reply
