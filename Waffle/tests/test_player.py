import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from waffle.audio import Stream, Track
from waffle.player import Player


async def until(predicate):
    async with asyncio.timeout(2):
        while not predicate():
            await asyncio.sleep(0.005)


@pytest.fixture
def setup_player(monkeypatch):
    sources = []
    def source(*args, **kwargs):
        item = Mock()
        sources.append(item)
        return item
    monkeypatch.setattr('waffle.player.discord.FFmpegOpusAudio', source)
    voice = Mock()
    voice.disconnect = AsyncMock()
    callbacks = []
    voice.play.side_effect = lambda source, after: callbacks.append(after)
    channel = Mock(send=AsyncMock())
    youtube = Mock(stream=AsyncMock(return_value=Stream('https://test.googlevideo.com/audio', {})))
    return voice, callbacks, channel, youtube


async def test_track_loop_and_skip_advances(setup_player):
    voice, callbacks, channel, yt = setup_player
    p = Player(voice, channel, yt)
    a, b = Track('A', 'a', 10, 1), Track('B', 'b', 10, 2)
    try:
        p.loop = 'track'
        p.add(a)
        p.add(b)
        await until(lambda: len(callbacks) == 1)
        callbacks[0](None)
        await until(lambda: len(callbacks) == 2)
        assert p.current == a
        p.skip()
        await until(lambda: len(callbacks) == 3)
        assert p.current == b
    finally:
        await p.close()
    assert p.task.done()
    voice.disconnect.assert_awaited_once()


async def test_stop_during_extraction_prevents_playback(setup_player):
    voice, _callbacks, channel, yt = setup_player
    entered = asyncio.Event()
    async def slow(track):
        entered.set()
        await asyncio.Event().wait()
    yt.stream.side_effect = slow
    p = Player(voice, channel, yt)
    p.add(Track('A', 'a', 10, 1))
    await entered.wait()
    await p.close()
    voice.play.assert_not_called()
    assert not p.queue and p.current is None


async def test_failed_track_does_not_repeat(setup_player):
    voice, callbacks, channel, yt = setup_player
    yt.stream.side_effect = [ValueError('unavailable'), Stream('https://test.googlevideo.com/audio', {})]
    p = Player(voice, channel, yt)
    try:
        p.loop = 'track'
        p.add(Track('bad', 'a', 10, 1))
        p.add(Track('good', 'b', 10, 1))
        await until(lambda: len(callbacks) == 1)
        assert p.current.title == 'good'
    finally:
        await p.close()


async def test_player_passes_headers_to_ffmpeg(setup_player, monkeypatch):
    voice, callbacks, channel, yt = setup_player
    yt.stream.return_value = Stream('https://test.googlevideo.com/audio', {'User-Agent': 'Test client'})
    factory = Mock()
    monkeypatch.setattr('waffle.player.discord.FFmpegOpusAudio', factory)
    p = Player(voice, channel, yt)
    try:
        p.add(Track('A', 'a', 10, 1))
        await until(lambda: len(callbacks) == 1)
        assert factory.call_args.args == ('https://test.googlevideo.com/audio',)
        assert 'User-Agent: Test client\r\n' in factory.call_args.kwargs['before_options']
    finally:
        await p.close()


async def test_queue_limit_and_idle_disconnect(setup_player):
    voice, callbacks, channel, yt = setup_player
    p = Player(voice, channel, yt, idle=0.02, max_queue=1)
    p.add(Track('A', 'a', 10, 1))
    with pytest.raises(ValueError, match='full'):
        p.add(Track('B', 'b', 10, 1))
    await until(lambda: len(callbacks) == 1)
    callbacks[0](None)
    await until(lambda: p.closed)
    await p.task
    voice.disconnect.assert_awaited_once()


async def test_late_callback_from_skipped_track_cannot_finish_next(setup_player):
    voice, callbacks, channel, yt = setup_player
    p = Player(voice, channel, yt)
    try:
        p.add(Track('A', 'a', 10, 1))
        p.add(Track('B', 'b', 10, 1))
        await until(lambda: len(callbacks) == 1)
        p.skip()
        await until(lambda: len(callbacks) == 2)
        callbacks[0](None)
        await asyncio.sleep(0.03)
        assert p.current.title == 'B'
        assert not p.done.is_set()
    finally:
        await p.close()
