import hashlib
import hmac
import secrets
import time

PBKDF2_ITERATIONS = 240_000

MAX_FAILED_LOGINS = 5
LOCK_SECONDS = 300


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, expected = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), expected)


# 帳號不存在時也做一次雜湊比對，避免從回應時間猜出帳號是否存在。
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def verify_unknown_account(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


def new_token() -> str:
    """領款 QR 用的唯一碼（128 bit 隨機）。"""
    return secrets.token_hex(16)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LoginThrottle:
    """連續登入失敗太多次就暫時鎖定該帳號（單機版；多台部署請改放 Redis / DB）。"""

    def __init__(self) -> None:
        self._failures: dict[str, tuple[int, float]] = {}

    def is_locked(self, account: str) -> bool:
        count, locked_until = self._failures.get(account, (0, 0.0))
        if locked_until and time.monotonic() >= locked_until:
            self._failures.pop(account, None)
            return False
        return count >= MAX_FAILED_LOGINS

    def record_failure(self, account: str) -> None:
        count, _ = self._failures.get(account, (0, 0.0))
        count += 1
        locked_until = time.monotonic() + LOCK_SECONDS if count >= MAX_FAILED_LOGINS else 0.0
        self._failures[account] = (count, locked_until)

    def reset(self, account: str) -> None:
        self._failures.pop(account, None)
