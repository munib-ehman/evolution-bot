#!/usr/bin/env python3
"""Managed local Nova host. Run as the signed-in macOS user, never as root."""
import argparse
import json
import os
import plistlib
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data'
CONFIG=ROOT/'.env.local'
LABEL='io.runevolution.nova'
PLIST=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
PUBLIC_ORIGIN='https://nova-evolution-v4.vercel.app'
INSTALLED=Path.home()/'Library/Application Support/EvolutionNova'


def settings(path=None):
    path = path or CONFIG
    values={}
    if path.exists():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=line.split('=',1)
                parts=shlex.split(value)
                values[key.strip()]=parts[0] if parts else ''
    return values


def write_settings(values):
    temp=CONFIG.with_suffix('.local.tmp')
    temp.write_text(''.join(key+'='+json.dumps(str(value))+'\n' for key,value in sorted(values.items())))
    temp.chmod(0o600)
    temp.replace(CONFIG)


def prepare():
    os.umask(0o077)
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    values=settings()
    values.update(NOVA_AI_PROVIDER='ollama',NOVA_AI_MODEL='llama3.2:3b',
                  NOVA_AI_BASE_URL='http://127.0.0.1:11434/v1',
                  NOVA_DB=str(DATA/'nova.sqlite'),NOVA_PUBLIC_URL=PUBLIC_ORIGIN,
                  NOVA_ACCEPT_SIGNUPS='false')
    values.setdefault('NOVA_ADMIN_TOKEN',secrets.token_urlsafe(36))
    values.setdefault('WHATSAPP_VERIFY_TOKEN',secrets.token_urlsafe(36))
    write_settings(values)
    return values


def reachable(url):
    try:
        with urllib.request.urlopen(url,timeout=2) as response:return response.status==200
    except Exception:return False


def runtime():
    values=prepare()
    env={**os.environ,**values,'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','PYTHONUNBUFFERED':'1','OLLAMA_NO_CLOUD':'true','OLLAMA_HOST':'127.0.0.1:11434'}
    from store import Store
    from billing import setup
    initial = Store(values['NOVA_DB'])
    setup(initial)
    initial.db.close()
    children={}
    logs={}
    specs={'server':[sys.executable,str(ROOT/'nova.py'),'serve'],
           'worker':[sys.executable,str(ROOT/'nova.py'),'worker'],
           'gateway':[sys.executable,str(ROOT/'gateway.py')],
           'awake':['/usr/bin/caffeinate','-is']}
    if not reachable('http://127.0.0.1:11434/api/tags'):
        ollama=shutil.which('ollama',path=env['PATH'])
        if not ollama:raise ValueError('Install Ollama and the selected local model before starting Nova.')
        specs['model']=[ollama,'serve']
    cloudflared=shutil.which('cloudflared',path=env['PATH'])
    if not cloudflared:raise ValueError('cloudflared is required for the public callback route')
    specs['tunnel']=[cloudflared,'tunnel','--url','http://127.0.0.1:4191','--no-autoupdate','--loglevel','info']
    stopped=False
    def stop(*_):
        nonlocal stopped
        stopped=True
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    previous_url=None
    try:
        while not stopped:
            if 'model' not in specs and not reachable('http://127.0.0.1:11434/api/tags'):
                model_binary=shutil.which('ollama',path=env['PATH'])
                if model_binary:specs['model']=[model_binary,'serve']
            for name,command in specs.items():
                child=children.get(name)
                if child and child.poll() is None:continue
                if name in logs:logs[name].close()
                logs[name]=open(DATA/(name+'.log'),'w' if name=='tunnel' else 'a')
                children[name]=subprocess.Popen(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=logs[name],stderr=subprocess.STDOUT)
            tunnel_log=DATA/'tunnel.log'
            text=tunnel_log.read_text(errors='replace')[-16000:] if tunnel_log.exists() else ''
            matches=re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com',text)
            url=matches[-1] if matches else None
            state={'updated':time.time(),'model_local':True,'services':{name:child.poll() is None for name,child in children.items()},
                   'public_tunnel':url,'public_origin':PUBLIC_ORIGIN,
                   'local_model_reachable':reachable('http://127.0.0.1:11434/api/tags'),
                   'whatsapp_configured':all(values.get(k) for k in ('META_APP_SECRET','META_GRAPH_VERSION','WHATSAPP_ACCESS_TOKEN','NOVA_WHATSAPP_PHONE_ID')),
                   'note':'Mac must be awake. Free tunnel URL changes on reconnect; reconnect website after a change.'}
            temp=DATA/'host-status.tmp';temp.write_text(json.dumps(state,indent=2)+'\n');temp.replace(DATA/'host-status.json')
            if url and url!=previous_url:
                print('Public callback tunnel ready. Run mac_host.py link-website to connect the website.',flush=True)
                previous_url=url
            time.sleep(3)
    finally:
        for child in children.values():
            if child.poll() is None:child.terminate()
        for child in children.values():
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.kill()
        for handle in logs.values():handle.close()


def link_website():
    host_data=(INSTALLED/'data') if (INSTALLED/'mac_host.py').exists() else DATA
    state=json.loads((host_data/'host-status.json').read_text())
    url=state.get('public_tunnel','')
    if not re.fullmatch(r'https://[a-z0-9-]+\.trycloudflare\.com',url):raise ValueError('No active callback tunnel found')
    preview=ROOT/'preview'
    command=['vercel','env','add','NOVA_BACKEND_URL','--environment','production','--cwd',str(preview),'--scope','subhana-uas-projects','--force','--yes']
    subprocess.run(command,input=url+'\n',text=True,check=True)
    subprocess.run(['vercel','deploy',str(preview),'--prod','--yes','--scope','subhana-uas-projects'],check=True)
    (host_data/'website-linked.json').write_text(json.dumps({'tunnel':url,'linked':time.time()})+'\n')


def install():
    prepare()
    if sys.platform!='darwin':raise ValueError('The login service is only for macOS')
    # Background services cannot read Documents under macOS privacy controls.
    # Install reviewed source in the user's Application Support directory instead.
    INSTALLED.mkdir(parents=True,exist_ok=True,mode=0o700)
    (INSTALLED/'preview').mkdir(exist_ok=True,mode=0o700)
    for source in ROOT.glob('*.py'):
        shutil.copyfile(source,INSTALLED/source.name)
    shutil.copyfile(ROOT/'preview/signup_template.py',INSTALLED/'preview/signup_template.py')
    if CONFIG.exists():
        merged = {**settings(), **settings(INSTALLED/'.env.local')}
        installed_config=INSTALLED/'.env.local'
        installed_config.write_text(''.join(k+'='+json.dumps(str(v))+'\n' for k,v in sorted(merged.items())))
        installed_config.chmod(0o600)
    subprocess.run([sys.executable,str(INSTALLED/'mac_host.py'),'prepare'],check=True)
    PLIST.parent.mkdir(parents=True,exist_ok=True)
    installed_data=INSTALLED/'data'
    obj={'Label':LABEL,'ProgramArguments':[sys.executable,str(INSTALLED/'mac_host.py'),'run'],
         'WorkingDirectory':str(INSTALLED),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':30,
         'StandardOutPath':str(installed_data/'host.log'),'StandardErrorPath':str(installed_data/'host-error.log')}
    with PLIST.open('wb') as handle:plistlib.dump(obj,handle)
    PLIST.chmod(0o600)
    domain='gui/'+str(os.getuid())
    subprocess.run(['launchctl','bootout',domain+'/'+LABEL],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['launchctl','bootstrap',domain,str(PLIST)],check=True)
    print('Nova login service installed and started. It runs while this user is logged in. No paid services activated.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['prepare','install','run','stop','status','link-website'])
    args=parser.parse_args()
    if args.command=='prepare':prepare();print('Local model and private runtime configuration prepared.')
    elif args.command=='install':install()
    elif args.command=='run':runtime()
    elif args.command=='link-website':link_website()
    elif args.command=='stop':
        subprocess.run(['launchctl','bootout','gui/'+str(os.getuid())+'/'+LABEL],check=True)
        print('Nova host stopped.')
    else:
        path=(INSTALLED/'data/host-status.json') if (INSTALLED/'mac_host.py').exists() else DATA/'host-status.json'
        print(path.read_text() if path.exists() else 'Host not started.')

if __name__=='__main__':main()
