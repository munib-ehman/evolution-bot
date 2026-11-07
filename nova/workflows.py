"""Reviewed workflow recipes, opportunity estimates and activation."""
import json
import time


RECIPES = {
    'inquiries': {'name': 'Answer and qualify incoming inquiries',
                  'outcome': 'Collect customer requirements and prepare a useful next reply.',
                  'requires': ['Customer-safe service information', 'Connected business messaging number'],
                  'tools': ['save_lead', 'send_message'], 'minutes_per_case': 3},
    'followups': {'name': 'Follow up on unanswered inquiries',
                 'outcome': 'Prepare one follow-up within the active messaging window, then stop for review.',
                 'requires': ['Approved follow-up timing', 'Customer-safe business information', 'Connected messaging number'],
                 'tools': ['save_lead', 'send_message'], 'minutes_per_case': 2},
    'quotes': {'name': 'Prepare quotes for owner review',
               'outcome': 'Record a price and scope for approval, with a separate approved send step.',
               'requires': ['Current owner-approved prices', 'Existing lead record'],
               'tools': ['save_lead', 'prepare_quote', 'send_message'], 'minutes_per_case': 5},
}


def recommend(business):
    baseline = business['config'].get('baseline', {})
    volume = baseline.get('weekly_inquiries')
    minutes = baseline.get('minutes_per_inquiry')
    result = []
    for key, recipe in RECIPES.items():
        saved = round(volume * min(minutes, recipe['minutes_per_case']) / 60, 1) if volume is not None and minutes is not None else None
        result.append({'id': key, **recipe, 'estimated_weekly_hours_saved': saved,
                       'estimate_basis': 'Owner-provided volume and handling time; assumes supported work can be handled successfully.',
                       'running_cost': 'Needs measured sample usage and configured provider rates; not yet quoted.'})
    return result


def recommendations_text(business):
    lines = ['Here are three places I can start. These estimates need a pilot to validate.']
    for row in recommend(business):
        estimate = str(row['estimated_weekly_hours_saved']) + ' hours/week' if row['estimated_weekly_hours_saved'] is not None else 'time savings need a baseline'
        lines.append(f"{row['id']}: {row['name']} ({estimate}). {row['outcome']}")
    lines.append('Reply BUILD inquiries, BUILD followups or BUILD quotes. I’ll prepare a workflow for review before activation.')
    return '\n\n'.join(lines)


def handle(store, business, text, planner):
    parts = text.strip().split()
    normalized = text.strip().lower().rstrip('.!')
    if normalized in {'recommend', 'what should i automate', 'suggest automations', 'optimize'}:
        return recommendations_text(business)
    if len(parts) == 3 and parts[0].lower() == 'baseline':
        try:
            volume, minutes = int(parts[1]), float(parts[2])
            if not 0 <= volume <= 100000 or not 0 < minutes <= 1440:
                raise ValueError()
        except (ValueError, OverflowError):
            raise ValueError('Use BASELINE followed by weekly inquiry count and minutes spent per inquiry.') from None
        business['config']['baseline'] = {'weekly_inquiries': volume, 'minutes_per_inquiry': minutes}
        save(store, business)
        return recommendations_text(business)
    if len(parts) == 2 and parts[0].lower() == 'build':
        key = parts[1].lower()
        if key not in RECIPES:
            return 'I can assemble inquiries, followups or quotes. Another process needs a reviewed integration first.'
        business['config']['workflow_draft'] = {'recipe': key, 'stage': 'sample', 'created': time.time()}
        save(store, business)
        recipe = RECIPES[key]
        return f"I prepared {recipe['name']}. It needs " + ', '.join(recipe['requires']) + '. Send a sample customer message to test it.'
    draft = business['config'].get('workflow_draft')
    if draft and draft['stage'] == 'sample' and normalized not in {'cancel workflow', 'activate workflow'}:
        answer = planner(store, business, 'Practice only. Prepare a response for workflow ' + draft['recipe'] + '. Return no actions. Customer sample:\n' + text)
        draft.update(stage='review', sample=text, response=answer['reply'])
        save(store, business)
        return 'Practice response\n\n' + answer['reply'] + '\n\nReply ACTIVATE WORKFLOW to enable this workflow, or CANCEL WORKFLOW.'
    if normalized == 'cancel workflow':
        business['config'].pop('workflow_draft', None)
        save(store, business)
        return 'Workflow draft cancelled.'
    if normalized == 'activate workflow':
        if not draft or draft['stage'] != 'review':
            return 'Choose a workflow and review its sample first.'
        shared = store.db.execute('SELECT 1 FROM documents WHERE business=? AND customer_safe=1 LIMIT 1', (business['id'],)).fetchone()
        if not shared:
            return 'Share an approved package, service or FAQ file with customers first using SHARE followed by the file name.'
        business['config'].setdefault('workflows', {})[draft['recipe']] = {'active': True, 'activated': time.time(), 'followup_hours': 4}
        business['config'].pop('workflow_draft', None)
        save(store, business)
        return 'Workflow activated under your existing approval rules. Say PAUSE to stop work or REPORT to check results.'
    return None


def save(store, business):
    store.db.execute('UPDATE businesses SET config=? WHERE id=?', (json.dumps(business['config']), business['id']))


def optimization(store, business):
    since = time.time() - 7 * 86400
    failures = store.db.execute("SELECT COUNT(*) FROM actions WHERE business=? AND created>=? AND state IN ('failed','uncertain')", (business['id'], since)).fetchone()[0]
    pending = store.db.execute("SELECT COUNT(*) FROM actions WHERE business=? AND state='approval'", (business['id'],)).fetchone()[0]
    if failures:
        return f'Next improvement: review {failures} failed or uncertain actions before increasing volume.'
    if pending:
        return f'Next improvement: review {pending} pending approvals to find where work is waiting.'
    return 'Next improvement: compare staff handling time and completed bookings with your baseline before expanding automation.'
