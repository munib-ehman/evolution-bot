"""Bounded on-device voice transcription. No audio is uploaded to an AI provider."""
import array
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave


def configured():
    model = Path(os.environ.get('NOVA_WHISPER_MODEL', str(Path(__file__).resolve().parent/'models/ggml-base.bin')))
    return bool(shutil.which('whisper-cli') and shutil.which('ffmpeg') and model.is_file())


def transcribe_bytes(audio):
    if not isinstance(audio, bytes) or not 0 < len(audio) <= 15_000_000:
        raise ValueError('Voice notes must be 1 byte to 15 MB.')
    if not configured():
        raise ValueError('The local speech model is not configured.')
    model = Path(os.environ.get('NOVA_WHISPER_MODEL', str(Path(__file__).resolve().parent/'models/ggml-base.bin'))).resolve()
    with tempfile.TemporaryDirectory(prefix='nova-voice-') as temp:
        root = Path(temp)
        source, pcm, output = root/'input', root/'voice.wav', root/'transcript'
        source.write_bytes(audio)
        result = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error',
                                 '-i', str(source), '-t', '181', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(pcm)],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=40)
        if result.returncode:
            raise ValueError('Could not decode that voice note. Use a normal audio recording.')
        with wave.open(str(pcm)) as stream:
            duration = stream.getnframes()/stream.getframerate()
            samples = array.array('h', stream.readframes(stream.getnframes()))
        if duration > 180 or duration < 0.3:
            raise ValueError('Use a voice note between 0.3 seconds and 3 minutes.')
        if not samples or max(abs(v) for v in samples) < 100:
            raise ValueError('No audible speech was detected.')
        result = subprocess.run([shutil.which('whisper-cli'), '-m', str(model), '-f', str(pcm),
                                 '-l', 'auto', '-otxt', '-of', str(output), '-nt', '-t', '4'],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=150)
        transcript = output.with_suffix('.txt')
        if result.returncode or not transcript.exists():
            raise ValueError('Local transcription did not finish. Try a shorter voice note.')
        text = transcript.read_text().strip()
        if not text or len(text) > 16000:
            raise ValueError('Could not obtain a usable voice transcript.')
        return text
