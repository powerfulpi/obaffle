import shlex
import subprocess
from unittest.mock import AsyncMock

import pytest

from waffle import audio
from waffle.audio import PRESETS, Stream, Track, YouTube, filters, query_target


@pytest.mark.parametrize('version', ['2025.12.08', '2026.8.18'])
def test_outdated_ytdlp_reports_upgrade_for_running_interpreter(monkeypatch, version):
    interpreter = '/tmp/waffle python/bin/python3'
    monkeypatch.setattr(audio, 'YTDLP_VERSION', version)
    monkeypatch.setattr(audio.sys, 'executable', interpreter)

    with pytest.raises(RuntimeError) as error:
        audio.check_ytdlp_version()

    message = str(error.value)
    assert version in message
    assert audio.MIN_YTDLP_VERSION in message
    assert f'{shlex.quote(interpreter)} -m pip install ' in message
    assert 'yt-dlp[default]' in message
    assert '--upgrade' in message or ' -U ' in message
    assert 'restart' in message.lower()


@pytest.mark.parametrize('version', [
    '2026.08.19', '2026.8.19', '2026.09.01', '2026.09.08.232902', '2027.01.01',
])
def test_supported_ytdlp_versions_allow_startup(monkeypatch, version):
    monkeypatch.setattr(audio, 'YTDLP_VERSION', version)

    assert audio.check_ytdlp_version() is None


async def test_stream_preserves_extractor_headers():
    youtube = YouTube()
    headers = {'User-Agent': 'Android client', 'Referer': 'https://www.youtube.com/'}
    youtube.extract = AsyncMock(return_value={
        'url': 'https://test.googlevideo.com/audio', 'http_headers': headers,
    })
    stream = await youtube.stream(Track('test', 'https://youtu.be/abcdefghijk', 1, 1))
    args = shlex.split(stream.ffmpeg_before_options())
    assert stream.url == 'https://test.googlevideo.com/audio'
    assert args[args.index('-headers') + 1] == (
        'User-Agent: Android client\r\nReferer: https://www.youtube.com/\r\n')


@pytest.mark.parametrize('headers', [{'User-Agent': 'ok\r\nInjected: value'}, {'Bad\nName': 'x'}])
def test_stream_rejects_header_injection(headers):
    with pytest.raises(ValueError, match='HTTP header'):
        Stream('https://test.googlevideo.com/audio', headers).ffmpeg_before_options()


@pytest.mark.parametrize('query', ['http://youtube.com/watch?v=x', 'https://localhost/test',
                                     'file:///etc/passwd', 'https://youtube.com.evil.test/a',
                                     'https://youtube.com@evil.test/a', 'https://youtube.com/playlist?list=abc', ''])
def test_reject_unsafe_queries(query):
    with pytest.raises(ValueError):
        query_target(query)


def test_search_and_link():
    assert query_target('lofi beats', 5) == 'ytsearch5:lofi beats'
    assert query_target('https://youtu.be/abcdefghijk') == 'https://youtu.be/abcdefghijk'


@pytest.mark.parametrize('preset', PRESETS)
def test_ffmpeg_accepts_and_renders_every_effect(preset):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                             'sine=frequency=440:duration=0.1:sample_rate=48000',
                             '-ac', '2', '-af', filters(preset, 4, -2, 3, 80),
                             '-f', 's16le', '-'], capture_output=True, timeout=10, check=False)
    assert result.returncode == 0, result.stderr.decode()
    assert len(result.stdout) > 1000


def test_filter_limits():
    with pytest.raises(ValueError):
        filters('normal', 99, 0, 0, 80)
    with pytest.raises(ValueError):
        filters('normal', 0, 0, 0, 999)
