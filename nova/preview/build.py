"""Build the public pages from the backend's signup renderer."""
from pathlib import Path
import shutil
import sys
root = Path(__file__).resolve().parent
sys.path.insert(0, str(root))
from signup_template import page
out = root / 'public'
out.mkdir(exist_ok=True)
for filename in ('demo.html', 'style.css', 'app.js'):
    shutil.copyfile(root / filename, out / filename)
for filename, path in [('index.html','/signup'),('signup.html','/signup'),('complete.html','/signup/complete'),('cancel.html','/signup/cancel')]:
    html=page(path)
    if filename in {'index.html','signup.html'}:
        html=html.replace('</main>', '<p class="fine"><a href="https://nova-evolution-v4.vercel.app/demo.html">Explore a sample conversation ↗</a></p></main>')
    (out / filename).write_text(html)
