import uuid

from app.integrations.session_cookie import sign_user_id, verify_cookie


def test_sign_and_verify_roundtrip() -> None:
    user_id = uuid.uuid4()
    cookie = sign_user_id(user_id)
    assert verify_cookie(cookie) == user_id


def test_tampered_signature_is_rejected() -> None:
    user_id = uuid.uuid4()
    cookie = sign_user_id(user_id)
    payload, _, signature = cookie.partition(".")
    # Flip one hex character in the signature - still well-formed, still wrong.
    flipped = ("0" if signature[0] != "0" else "1") + signature[1:]
    assert verify_cookie(f"{payload}.{flipped}") is None


def test_swapped_user_id_with_original_signature_is_rejected() -> None:
    """The failure mode a naive implementation would miss: pasting a *different*, validly
    signed cookie's payload onto this one's signature must not verify — the signature has to be
    checked against the paired payload, not just "is this a signature-shaped string"."""
    cookie_a = sign_user_id(uuid.uuid4())
    cookie_b = sign_user_id(uuid.uuid4())
    _, _, signature_b = cookie_b.partition(".")
    payload_a, _, _ = cookie_a.partition(".")
    assert verify_cookie(f"{payload_a}.{signature_b}") is None


def test_malformed_values_return_none_not_raise() -> None:
    for value in [
        "",
        "no-separator-at-all",
        ".",
        "not-a-uuid.deadbeef",
        uuid.uuid4().hex,
    ]:
        assert verify_cookie(value) is None
