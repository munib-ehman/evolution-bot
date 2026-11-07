"""Owner setup happens in the message thread. Every activation has an explicit review."""
import json
import time


def save(store, business):
    store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(business['config']), business['id']))


def start(store, business):
    business['config']['onboarding'] = {'stage': 'profile'}
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
        flow['stage'] = 'knowledge'
        reply = ('Send exported conversations as .txt files and your current packages or services as .txt or .csv files. '
                 'I’ll keep imports private. For information I can use with customers, reply SHARE followed by the exact file name. '
                 'You can also describe the business information here. Say DONE when ready.')
    elif stage == 'knowledge':
        if normalized != 'done':
            store.ingest(business['id'], 'Setup information ' + str(time.time_ns()), text)
            return 'Saved privately. You can send more information or files. Say DONE when ready.'
        flow['stage'] = 'permissions'
        reply = ('How should I work? Reply 1 to ask before every action. Reply 2 to answer customer messages and schedule tasks automatically, '
                 'while asking before quotes, bookings and other changes. You can change these rules later.')
    elif stage == 'permissions':
        if normalized not in {'1', '2'}:
            return 'Reply 1 to approve every action, or 2 for automatic replies and task scheduling with approval for other changes.'
        business['config']['rules'] = {'send_message': 'auto' if normalized == '2' else 'approve',
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
    else:
        raise ValueError('Setup state is unavailable')
    business['config']['onboarding'] = flow
    save(store, business)
    return reply
