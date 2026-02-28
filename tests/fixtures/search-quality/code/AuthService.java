package com.example.auth;

import java.util.Optional;

/**
 * Core authentication service.
 * Handles credential validation, token issuance, and token lifecycle.
 */
public class AuthService {

    private final TokenRepository tokenRepository;
    private final UserRepository userRepository;

    public AuthService(TokenRepository tokenRepository, UserRepository userRepository) {
        this.tokenRepository = tokenRepository;
        this.userRepository = userRepository;
    }

    public Optional<AuthToken> authenticate(String username, String password) {
        return userRepository.findByUsername(username)
            .filter(user -> user.checkPassword(password))
            .map(user -> tokenRepository.createToken(user.getId(), UserRole.USER));
    }

    public boolean validateToken(String token) {
        return tokenRepository.findByValue(token)
            .filter(t -> !t.isExpired())
            .isPresent();
    }

    public void revokeToken(String token) {
        tokenRepository.delete(token);
    }

    protected AuthToken refreshToken(String refreshToken) {
        return tokenRepository.refresh(refreshToken);
    }

    private boolean hasPermission(AuthToken token, String resource) {
        return token.getRole().canAccess(resource);
    }

    public enum UserRole {
        ADMIN, USER, READONLY;

        public boolean canAccess(String resource) {
            return this == ADMIN || (!resource.startsWith("admin/") && this == USER);
        }
    }
}
