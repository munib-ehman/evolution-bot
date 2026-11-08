const log=document.querySelector('#messages'),choices=document.querySelector('#choices'),form=document.querySelector('#chat'),input=document.querySelector('#message');
let stage=0,paused=false,completed=false;
function bubble(text,who='nova'){const node=document.createElement('div');node.className='bubble '+who;node.textContent=text;log.append(node);log.scrollTop=log.scrollHeight;}
function options(labels){choices.replaceChildren();for(const label of labels){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>send(label);choices.append(button);}}
function start(){stage=0;paused=false;completed=false;log.replaceChildren();bubble('Hi, I’m Nova. What kind of business do you run?');options(['Travel agency','Car detailing']);}
function send(text){text=text.trim();if(!text)return;bubble(text,'owner');input.value='';const t=text.toLowerCase();
if(t==='pause'){paused=true;bubble('Work paused. Nothing new will run until you say RESUME.');return options(['Resume','Report']);}
if(t==='resume'){paused=false;bubble('Ready to continue.');return options(stage===5?['Approve','Reject']:['Report']);}
if(t==='report'){bubble('Sample activity report\nWorkflow: '+(stage>=4?'Inquiry follow-up':'Not activated')+'\nApproved sample actions: '+(completed?'1':'0')+'\nReal customer messages sent: 0\nMeasured savings: not available in preview');return options(['Start over']);}
if(t==='start over')return start();
if(paused){bubble('Work is paused. Say RESUME when ready.');return options(['Resume']);}
if(stage===0){stage=1;bubble('What recurring task would you like off your plate first?');options(['Follow up on inbound inquiries']);}
else if(stage===1){stage=2;bubble('Let’s start with follow-ups. In the live pilot, you can share selected chats and your current service information. Keep customer-facing facts separate from private notes.\nFor this preview, use a sample catalog: consultations are free and prices require your confirmation.');options(['Use sample catalog']);}
else if(stage===2){stage=3;bubble('Suggested first workflow: capture the inquiry and prepare one follow-up after four hours. Cancel it if the customer replies or opts out.\nShould every outgoing message need your approval?');options(['Ask before every message']);}
else if(stage===3){stage=4;bubble('Trial message\n“Hi, are you still interested? I can help confirm the details and get a quote ready for you.”\nNo prices or availability are assumed. Review this before activating the sample workflow.');options(['Activate sample workflow']);}
else if(stage===4){stage=5;bubble('Sample workflow activated.\nA sample inquiry is waiting for a follow-up. Proposed message:\n“Hi, are you still interested? I can help confirm the details and get a quote ready for you.”\nApprove or reject?');options(['Approve','Reject','Pause']);}
else if(stage===5){if(!['approve','reject'].includes(t)){bubble('Choose Approve or Reject to review the sample action.');return options(['Approve','Reject']);}completed=t==='approve';stage=6;bubble(completed?'Approved in this preview. No real message was sent. In the live pilot, delivery needs the connected business channel and its delivery confirmation.':'Sample action rejected. Nothing will be sent.');options(['Report','Start over']);}
else{bubble('This is a guided preview. Real free-form reasoning needs the configured AI provider.');options(['Report','Start over']);}}
form.addEventListener('submit',event=>{event.preventDefault();send(input.value);});document.querySelector('#reset').onclick=start;start();
