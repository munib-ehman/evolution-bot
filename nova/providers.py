"""Explicit model connections. No automatic paid-provider fallback."""
import os
from urllib.parse import urlsplit


def configuration(customer=False, transcription=False):
    provider = os.environ.get('NOVA_AI_PROVIDER', 'custom').lower()
    if provider == 'groq':
        base = 'https://api.groq.com/openai/v1'
        key = os.environ.get('GROQ_API_KEY') or os.environ.get('NOVA_AI_KEY', '')
    elif provider == 'ollama':
        base = os.environ.get('NOVA_AI_BASE_URL', 'http://127.0.0.1:11434/v1').rstrip('/')
        parsed = urlsplit(base)
        if (parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1', '::1'}
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path != '/v1'):
            raise ValueError('Local Ollama must use a loopback HTTP /v1 endpoint')
        key = 'ollama'
    elif provider == 'custom':
        base = os.environ.get('NOVA_AI_BASE_URL', '').rstrip('/')
        key = os.environ.get('NOVA_AI_KEY', '')
        parsed = urlsplit(base)
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Configure an HTTPS AI provider URL')
    else:
        raise ValueError('Choose custom, groq or ollama as NOVA_AI_PROVIDER')
    model = os.environ.get('NOVA_CUSTOMER_AI_MODEL') if customer else None
    model = os.environ.get('NOVA_TRANSCRIPTION_MODEL', '') if transcription else (model or os.environ.get('NOVA_AI_MODEL', ''))
    if provider == 'ollama' and (model.endswith(':cloud') or model.endswith('-cloud')):
        raise ValueError('Choose an installed local model; cloud models are disabled for this profile')
    if not key or not model:
        raise ValueError('Configure the selected AI provider key and model first')
    return {'provider': provider, 'base_url': base, 'key': key, 'model': model,
            'token_parameter': 'max_tokens' if provider == 'ollama' else 'max_completion_tokens'}


def configured():
    try:
        configuration()
        return True
    except ValueError:
        return False
