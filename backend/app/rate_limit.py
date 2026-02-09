"""
Minimal in-memory rate limiter for FastAPI.
Uses Depends() pattern - no middleware, no external dependencies.
"""

from datetime import datetime, timedelta
from collections import defaultdict
from typing import Callable, Optional, Union
from fastapi import Request, HTTPException


class RateLimiter:
    """
    In-memory rate limiter with automatic cleanup.

    Usage:
        limiter = RateLimiter(limit=5, window_seconds=60)

        @app.post("/endpoint")
        async def endpoint(request: Request, _: None = Depends(limiter)):
            ...
    """

    def __init__(
        self,
        limit: Union[int, Callable[[], int]],
        window_seconds: int,
        key_func: Optional[Callable[[Request], str]] = None
    ):
        self._limit = limit
        self.window = timedelta(seconds=window_seconds)
        self.key_func = key_func or (lambda r: r.client.host if r.client else "unknown")
        self.requests: dict[str, list[datetime]] = defaultdict(list)
        self._last_cleanup = datetime.utcnow()

    def _current_limit(self) -> int:
        raw = self._limit() if callable(self._limit) else self._limit
        try:
            value = int(raw)
        except (ValueError, TypeError):
            value = 0
        return max(0, value)

    def _cleanup_if_needed(self) -> None:
        """Remove expired entries periodically (every 60 seconds)."""
        now = datetime.utcnow()
        if now - self._last_cleanup < timedelta(seconds=60):
            return

        self._last_cleanup = now
        cutoff = now - self.window

        # Remove expired timestamps
        expired_keys = []
        for key, timestamps in self.requests.items():
            self.requests[key] = [t for t in timestamps if t > cutoff]
            if not self.requests[key]:
                expired_keys.append(key)

        # Remove empty keys
        for key in expired_keys:
            del self.requests[key]

    async def __call__(self, request: Request) -> None:
        """FastAPI dependency - raises 429 if rate limit exceeded."""
        self._cleanup_if_needed()

        key = self.key_func(request)
        now = datetime.utcnow()
        cutoff = now - self.window
        limit = self._current_limit()

        # Filter to recent requests only
        self.requests[key] = [t for t in self.requests[key] if t > cutoff]

        if limit <= 0:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Try again later."
            )

        if len(self.requests[key]) >= limit:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Try again in {self.window.seconds} seconds."
            )

        self.requests[key].append(now)
