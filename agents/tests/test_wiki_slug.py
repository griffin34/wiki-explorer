from __future__ import annotations

from agents.wiki import _make_slug


def test_make_slug_lowercases_and_replaces_spaces():
    assert _make_slug("Kara Dave") == "kara-dave"


def test_make_slug_strips_punctuation():
    assert _make_slug("React & Node.js!") == "react--nodejs"
