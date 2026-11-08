"""Constrained output shape for local models; execution still validates every action."""
FIELDS = {
 'remember': ('name','text'), 'schedule': ('instruction','at'), 'send_message': ('to','text'),
 'connector': ('name','payload'), 'save_lead': ('contact','name','need'),
 'prepare_quote': ('lead_id','description','amount','currency'),
 'confirm_booking': ('quote_id','starts_at','ends_at'), 'calendar_event': ('summary','start','end'),
 'call_owner': (),
}


def response_format(customer=False, quote_lead=None):
    variants=[]
    for tool, fields in FIELDS.items():
        if quote_lead and tool != 'prepare_quote':
            continue
        args={field: {'type':'object'} if field=='payload' else {'type':'string'} for field in fields}
        variants.append({'type':'object','properties':{'tool':{'const':tool},'args':{
            'type':'object','properties':args,'required':list(fields),'additionalProperties':False}},
            'required':['tool','args'],'additionalProperties':False})
    return {'type':'json_schema','json_schema':{'name':'nova_plan','strict':True,'schema':{
        'type':'object','properties':{'reply':{'type':'string'},'actions':{
            'type':'array','items':{'anyOf':variants},'maxItems':0 if customer and not quote_lead else 1 if quote_lead else 4}},
        'required':['reply','actions'],'additionalProperties':False}}}
