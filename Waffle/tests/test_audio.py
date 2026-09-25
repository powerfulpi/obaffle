import shlex
import subprocess
from array import array
from unittest.mock import AsyncMock, Mock

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
                                     'https://youtube.com@evil.test/a', 'https://youtube.com/playlist', ''])
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


async def test_transient_extraction_failure_retries_then_succeeds(monkeypatch):
    extractor = Mock()
    extractor.extract_info.side_effect = [
        audio.yt_dlp.utils.DownloadError('HTTP Error 403: Forbidden'),
        {'url': 'https://test.googlevideo.com/fresh'},
    ]
    factory = Mock()
    factory.return_value.__enter__ = Mock(return_value=extractor)
    factory.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(audio.yt_dlp, 'YoutubeDL', factory)
    monkeypatch.setattr(audio.asyncio, 'sleep', AsyncMock())
    result = await YouTube().extract('https://youtu.be/abcdefghijk')
    assert result['url'].endswith('/fresh')
    assert extractor.extract_info.call_count == 2


@pytest.mark.parametrize(('message', 'attempts', 'expected'), [
    ('HTTP Error 403: Forbidden', 2, 'after a retry'),
    ('Sign in to confirm you are not a bot', 1, 'sign-in'),
    ('HTTP Error 429: Too Many Requests', 1, 'rate-limiting'),
    ('Private video', 1, 'another public upload'),
    ('This video is unavailable', 1, 'another public upload'),
])
async def test_extraction_failures_are_bounded_and_actionable(monkeypatch, message, attempts, expected):
    extractor = Mock()
    extractor.extract_info.side_effect = audio.yt_dlp.utils.DownloadError(message)
    factory = Mock()
    factory.return_value.__enter__ = Mock(return_value=extractor)
    factory.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(audio.yt_dlp, 'YoutubeDL', factory)
    monkeypatch.setattr(audio.asyncio, 'sleep', AsyncMock())
    with pytest.raises(audio.YouTubeError, match=expected):
        await YouTube().extract('https://youtu.be/abcdefghijk')
    assert extractor.extract_info.call_count == attempts


def test_normal_filters_preserve_volume_without_makeup_gain():
    result = subprocess.run([
        'ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=1000:duration=0.2:sample_rate=48000',
        '-af', filters('normal', 0, 0, 0, 80), '-f', 'f32le', '-',
    ], capture_output=True, timeout=10, check=True)
    samples = array('f', result.stdout)
    # FFmpeg's sine source peaks at 1/8 full scale; 80% should peak at 0.1.
    assert max(abs(value) for value in samples) == pytest.approx(0.1, abs=0.001)


@pytest.mark.parametrize('url', [
    'https://www.youtube.com/playlist?list=PLabc',
    'https://music.youtube.com/playlist?list=PLabc',
    'https://www.youtube.com/watch?v=abcdefghijk&list=PLabc&index=4',
    'https://youtu.be/abcdefghijk?list=PLabc',
])
def test_playlist_links_are_canonicalized(url):
    assert audio.playlist_target(url) == 'https://www.youtube.com/playlist?list=PLabc'


def test_plain_song_and_video_are_not_playlists():
    assert audio.playlist_target('a song list=PLabc') is None
    assert audio.playlist_target('https://youtu.be/abcdefghijk') is None


async def test_playlist_preserves_order_duplicates_and_requester_skipping_unavailable():
    youtube = YouTube()
    first = {'id': 'abcdefghijk', 'title': 'First', 'duration': 12}
    youtube.extract = AsyncMock(return_value={'entries': [
        first, None,
        {'id': 'private0000', 'title': '[Private video]'},
        {'id': 'deleted0000', 'title': '[Deleted video]'},
        {'id': 'live0000000', 'is_live': True},
        {'id': 'future00000', 'live_status': 'is_upcoming'},
        {'id': 'locked00000', 'availability': 'needs_auth'},
        {'id': '../bad'},
        {'id': '01234567890', 'title': 'Second'}, first,
    ]})
    tracks = await youtube.search('https://youtu.be/abcdefghijk?list=PLabc&index=4', 42, 100, playlist=True)
    assert [t.title for t in tracks] == ['First', 'Second', 'First']
    assert all(t.requester == 42 for t in tracks)
    assert tracks[0].url == 'https://www.youtube.com/watch?v=abcdefghijk'
    youtube.extract.assert_awaited_once_with(
        'https://www.youtube.com/playlist?list=PLabc', flat=True, playlist_limit=100)


async def test_empty_playlist_has_actionable_error():
    youtube = YouTube()
    youtube.extract = AsyncMock(return_value={'entries': [None]})
    with pytest.raises(ValueError, match='No playable videos'):
        await youtube.search('https://youtube.com/playlist?list=PLabc', 1, 100, playlist=True)


async def test_flat_extraction_is_bounded_without_resolving_audio(monkeypatch):
    factory = Mock()
    factory.return_value.__enter__ = Mock(return_value=Mock(extract_info=Mock(return_value={'entries': []})))
    factory.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(audio.yt_dlp, 'YoutubeDL', factory)
    await YouTube().extract('https://youtube.com/playlist?list=PLabc', flat=True, playlist_limit=25)
    options = factory.call_args.args[0]
    assert options['playlistend'] == 25
    assert options['extract_flat'] == 'in_playlist'
    assert options['check_formats'] is None
