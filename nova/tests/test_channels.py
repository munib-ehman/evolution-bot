import base64
import io
import json
import os
import sys
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import channels


class ChannelsTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'WHATSAPP_ACCESS_TOKEN': 'meta-test-token', 'META_GRAPH_VERSION': 'v-test',
            'NOVA_TRANSCRIPTION_MODEL': 'test-model', 'NOVA_AI_BASE_URL': 'https://ai.example/v1/',
            'NOVA_AI_KEY': 'ai-test-key', 'TWILIO_ACCOUNT_SID': 'ACtest',
            'TWILIO_AUTH_TOKEN': 'twilio-test-token'}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        # Block the network even if a test forgets to mock a provider request.
        self.network = patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('Unexpected HTTP'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def metadata(self, body=b'conversation', mime='text/plain', **changes):
        return {'url': 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?id=test',
                'file_size': len(body), 'mime_type': mime, **changes}

    def test_document_exports_and_source_names(self):
        cases = [('chat.txt', 'text/plain', 'Hello, دنیا'),
                 ('C:\\exports\\CHAT.CSV', 'text/csv; charset=utf-8', 'name,message\nAli,Hello'),
                 ('/exports/chat.json', 'application/json', '{"message": "Hello"}'),
                 ('chat.csv', 'text/plain', 'name,message'),
                 ('chat.json', 'text/plain', '{"message": "Hello"}')]
        for filename, mime, text in cases:
            with self.subTest(filename=filename, mime=mime):
                body = b'\xef\xbb\xbf' + text.encode()
                metadata = self.metadata(body, mime)
                with patch('channels.request', side_effect=[json.dumps(metadata).encode(), body]) as http:
                    self.assertEqual(channels.whatsapp_document('media/id?x=1', filename),
                                     (filename.replace('\\', '/').rsplit('/', 1)[-1], text))
                    self.assertEqual(http.call_args_list[0].args,
                                     ('https://graph.facebook.com/v-test/media%2Fid%3Fx%3D1',))
                    self.assertEqual(http.call_args_list[0].kwargs,
                                     {'headers': {'Authorization': 'Bearer meta-test-token'}})
                    self.assertEqual(http.call_args_list[1].args, (metadata['url'],))
                    self.assertEqual(http.call_args_list[1].kwargs,
                                     {'headers': {'Authorization': 'Bearer meta-test-token'}, 'limit': 2_000_000})

    def test_document_rejects_unsupported_names_before_http(self):
        for filename in [None, '', 'archive.zip', 'chat.txt.exe', 'chat.txt\n', 'chat\x00.txt', 'path/']:
            with self.subTest(filename=filename), patch('channels.request') as http:
                with self.assertRaises(ValueError):
                    channels.whatsapp_document('media', filename)
                http.assert_not_called()

    def test_document_rejects_binary_invalid_utf8_and_blank_text(self):
        for body in [b'\xff\xfe', b'hello\x00world', b' \n\t', b'\xef\xbb\xbf']:
            with self.subTest(body=body), patch('channels.request', side_effect=[
                    json.dumps(self.metadata(body)).encode(), body]):
                with self.assertRaises(ValueError):
                    channels.whatsapp_document('media', 'chat.txt')

    def test_document_checks_mime_against_extension(self):
        for filename, mime in [('chat.txt', 'application/json'), ('chat.csv', 'application/pdf'),
                               ('chat.json', 'text/csv'), ('chat.txt', 'application/octet-stream')]:
            with self.subTest(filename=filename, mime=mime), patch('channels.request', return_value=
                    json.dumps(self.metadata(mime=mime)).encode()) as http:
                with self.assertRaises(ValueError):
                    channels.whatsapp_document('media', filename)
                self.assertEqual(http.call_count, 1)

    def test_media_rejects_bad_metadata_before_download(self):
        cases = [None, [], {}, self.metadata(file_size=None), self.metadata(file_size=True),
                 self.metadata(file_size='12'), self.metadata(file_size=1.5),
                 self.metadata(file_size=-1), self.metadata(file_size=0),
                 self.metadata(file_size=2_000_001), self.metadata(mime_type=None),
                 self.metadata(mime_type='image/png'), self.metadata(url=None)]
        for metadata in cases:
            with self.subTest(metadata=metadata), patch('channels.request', return_value=
                    json.dumps(metadata).encode()) as http:
                with self.assertRaises(ValueError):
                    channels.whatsapp_document('media', 'chat.txt')
                self.assertEqual(http.call_count, 1)

    def test_media_requires_official_https_host_without_credentials_or_redirect_tricks(self):
        urls = ['http://lookaside.fbsbx.com/media', 'https://example.com/media',
                'https://lookaside.fbsbx.com.evil.example/media',
                'https://evil.lookaside.fbsbx.com/media',
                'https://lookaside.fbsbx.com@evil.example/media',
                'https://user:pass@lookaside.fbsbx.com/media',
                'https://lookaside.fbsbx.com:444/media',
                'https://lookaside.fbsbx.com:bad/media',
                'https://lookaside.fbsbx.com/media#fragment',
                'https://lookaside.fbsbx.com/\nmedia', '//lookaside.fbsbx.com/media']
        for url in urls:
            with self.subTest(url=url), patch('channels.request', return_value=
                    json.dumps(self.metadata(url=url)).encode()) as http:
                with self.assertRaises(ValueError):
                    channels.whatsapp_document('media', 'chat.txt')
                self.assertEqual(http.call_count, 1)

    def test_media_allows_both_official_hosts(self):
        for host in ['lookaside.fbsbx.com', 'lookaside.facebook.com:443']:
            body = b'chat'
            metadata = self.metadata(body, url='https://' + host + '/media')
            with self.subTest(host=host), patch('channels.request', side_effect=[json.dumps(metadata).encode(), body]):
                self.assertEqual(channels.whatsapp_media('media', mime_types={'text/plain'}, limit=4),
                                 (metadata, body))

    def test_media_enforces_actual_size_and_metadata_size(self):
        for body, size in [(b'12345', 4), (b'123', 4), (b'', 4)]:
            with self.subTest(body=body), patch('channels.request', side_effect=[
                    json.dumps(self.metadata(file_size=size)).encode(), body]):
                with self.assertRaises(ValueError):
                    channels.whatsapp_media('media', mime_types={'text/plain'}, limit=4)

    def test_media_rejects_invalid_id_or_limit_before_http(self):
        for media_id, limit in [(None, 4), ('', 4), (' ', 4), ('.', 4), ('..', 4),
                                ('media', 0), ('media', -1), ('media', True)]:
            with self.subTest(media_id=media_id, limit=limit), patch('channels.request') as http:
                with self.assertRaises(ValueError):
                    channels.whatsapp_media(media_id, mime_types={'text/plain'}, limit=limit)
                http.assert_not_called()

    def test_media_propagates_metadata_and_download_failures_without_retry(self):
        error = urllib.error.HTTPError('https://lookaside.fbsbx.com', 302, 'Redirect', {}, None)
        for responses, count in [([error], 1), ([json.dumps(self.metadata()).encode(), error], 2),
                                 ([b'not JSON'], 1)]:
            with self.subTest(count=count, responses=responses), patch('channels.request', side_effect=responses) as http:
                with self.assertRaises((urllib.error.HTTPError, ValueError)):
                    channels.whatsapp_document('media', 'chat.txt')
                self.assertEqual(http.call_count, count)

    def test_transcribe_uses_shared_validation_and_correct_audio_format(self):
        for mime, extension in [('audio/ogg; codecs=opus', 'ogg'), ('audio/mpeg', 'mp3'), ('audio/mp4', 'mp4')]:
            audio = b'fake audio\x00\xff'
            with self.subTest(mime=mime), patch('channels.request', side_effect=[
                    json.dumps(self.metadata(audio, mime)).encode(), audio, b'{"text":"Hello"}']) as http:
                self.assertEqual(channels.transcribe('audio-id'), 'Hello')
                self.assertEqual(http.call_args_list[1].kwargs['limit'], 15_000_000)
                url, data, headers = http.call_args.args
                self.assertEqual(url, 'https://ai.example/v1/audio/transcriptions')
                self.assertEqual(headers['Authorization'], 'Bearer ai-test-key')
                boundary = headers['Content-Type'].split('boundary=')[1]
                self.assertTrue(data.startswith(('--' + boundary + '\r\n').encode()))
                self.assertTrue(data.endswith(('--' + boundary + '--\r\n').encode()))
                self.assertIn(b'name="model"\r\n\r\ntest-model\r\n', data)
                self.assertIn(('filename="voice.' + extension + '"').encode(), data)
                self.assertIn(('Content-Type: ' + mime.split(';')[0] + '\r\n\r\n').encode() + audio, data)

    def test_transcribe_rejects_bad_media_before_ai_call(self):
        for metadata in [self.metadata(mime='text/plain'), self.metadata(mime='audio/ogg', file_size=15_000_001),
                         self.metadata(mime='audio/ogg', url='https://evil.example/audio')]:
            with self.subTest(metadata=metadata), patch('channels.request', return_value=json.dumps(metadata).encode()) as http:
                with self.assertRaises(ValueError):
                    channels.transcribe('audio-id')
                self.assertEqual(http.call_count, 1)

    def test_sms_send_uses_official_rest_basic_auth_and_form_encoding(self):
        text = 'Hello & welcome + دنیا\nNext line'
        with patch('channels.request', return_value=b'{"sid":"SMtest"}') as http:
            self.assertEqual(channels.sms_send('+15555550101', '+15555550202', text), 'SMtest')
            http.assert_called_once()
            url, data, headers = http.call_args.args
            self.assertEqual(url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json')
            self.assertEqual(urllib.parse.parse_qs(data.decode()),
                             {'From': ['+15555550101'], 'To': ['+15555550202'], 'Body': [text]})
            self.assertEqual(headers, {'Authorization': 'Basic ' + base64.b64encode(
                b'ACtest:twilio-test-token').decode(), 'Content-Type': 'application/x-www-form-urlencoded'})
            self.assertEqual(http.call_args.kwargs, {'method': 'POST'})

    def test_sms_errors_propagate_without_retry(self):
        for response in [TimeoutError('timeout'), b'not JSON', b'{"error_code": 123}']:
            with self.subTest(response=response), patch('channels.request', side_effect=[response]) as http:
                with self.assertRaises((TimeoutError, ValueError, KeyError)):
                    channels.sms_send('+15555550101', '+15555550202', 'Hello')
                self.assertEqual(http.call_count, 1)

    def test_sms_requires_configuration_before_http(self):
        for key in ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']:
            with self.subTest(key=key), patch.dict(os.environ), patch('channels.request') as http:
                del os.environ[key]
                with self.assertRaises(KeyError):
                    channels.sms_send('+15555550101', '+15555550202', 'Hello')
                http.assert_not_called()

    def test_request_bounds_read_and_installs_no_redirect_handler(self):
        for body in [b'1234', b'12345']:
            response = Mock()
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
            response.read.return_value = body
            with self.subTest(body=body), patch('channels.urllib.request.build_opener') as build:
                build.return_value.open.return_value = response
                if len(body) > 4:
                    with self.assertRaises(ValueError):
                        channels.request('https://example.com', limit=4)
                else:
                    self.assertEqual(channels.request('https://example.com', limit=4), body)
                response.read.assert_called_once_with(5)
                self.assertIsInstance(build.call_args.args[0], channels.NoRedirect)
                self.assertEqual(build.return_value.open.call_args.kwargs, {'timeout': 45})

    def test_redirect_handler_refuses_all_redirects(self):
        opener = urllib.request.build_opener(channels.NoRedirect())
        req = urllib.request.Request('https://lookaside.fbsbx.com/media', headers={'Authorization': 'Bearer test'})
        for code in [301, 302, 303, 307, 308]:
            with self.subTest(code=code):
                with self.assertRaises(urllib.error.HTTPError):
                    opener.error('http', req, io.BytesIO(), code, 'Redirect',
                                 {'location': 'https://evil.example/stolen'})


if __name__ == '__main__':
    unittest.main()
