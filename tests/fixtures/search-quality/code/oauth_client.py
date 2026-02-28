"""OAuth 2.0 client for obtaining and refreshing access tokens."""

import requests
from typing import Optional
from dataclasses import dataclass

CLIENT_TIMEOUT = 30


@dataclass
class TokenResponse:
    access_token: str
    token_type: str
    expires_in: int
    refresh_token: Optional[str] = None


class OAuthClient:
    """Client for the OAuth 2.0 authorization code and refresh token flows."""

    def __init__(self, client_id: str, client_secret: str, token_url: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_url = token_url
        self._token: Optional[TokenResponse] = None

    def get_token(self, code: str, redirect_uri: str) -> TokenResponse:
        """Exchange an authorization code for an access token."""
        response = requests.post(self.token_url, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }, timeout=CLIENT_TIMEOUT)
        response.raise_for_status()
        self._token = TokenResponse(**response.json())
        return self._token

    def refresh_token(self, refresh_token: str) -> TokenResponse:
        """Obtain a new access token using a refresh token."""
        response = requests.post(self.token_url, data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }, timeout=CLIENT_TIMEOUT)
        response.raise_for_status()
        self._token = TokenResponse(**response.json())
        return self._token

    def _is_expired(self) -> bool:
        if not self._token:
            return True
        return self._token.expires_in <= 0


def create_oauth_client(client_id: str, client_secret: str, token_url: str) -> OAuthClient:
    """Factory function for OAuthClient."""
    return OAuthClient(client_id, client_secret, token_url)
