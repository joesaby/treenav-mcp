/**
 * Sample code fixtures for code indexer tests.
 *
 * Provides in-memory source code for TypeScript, Python, and Go
 * to test the code indexer without filesystem I/O.
 */

// ── TypeScript fixtures ─────────────────────────────────────────────

export const TS_CLASS_WITH_METHODS = `import { Request, Response } from "express";
import { verify } from "jsonwebtoken";

export class AuthService {
  private secret: string;
  private tokenExpiry: number;

  constructor(secret: string, tokenExpiry: number = 3600) {
    this.secret = secret;
    this.tokenExpiry = tokenExpiry;
  }

  async authenticate(username: string, password: string): Promise<string> {
    // Verify credentials
    const user = await this.findUser(username);
    if (!user || user.password !== password) {
      throw new Error("Invalid credentials");
    }
    return this.generateToken(user.id);
  }

  private generateToken(userId: string): string {
    return \`token_\${userId}_\${Date.now()}\`;
  }

  async refreshToken(token: string): Promise<string> {
    const payload = verify(token, this.secret);
    return this.generateToken((payload as any).userId);
  }
}

export interface AuthConfig {
  secret: string;
  tokenExpiry: number;
  refreshEnabled: boolean;
}

export type TokenPayload = {
  userId: string;
  exp: number;
  iat: number;
};

export function validateToken(token: string, secret: string): boolean {
  try {
    verify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_EXPIRY = 3600;
`;

export const TS_INTERFACES_AND_TYPES = `export interface TreeNode {
  node_id: string;
  title: string;
  level: number;
  parent_id: string | null;
  children: string[];
  content: string;
}

export interface SearchResult {
  doc_id: string;
  node_id: string;
  score: number;
  snippet: string;
  matched_terms: string[];
}

export type FilterIndex = Map<string, Map<string, Set<string>>>;

export type FacetCounts = Record<string, Record<string, number>>;

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}
`;

export const TS_ARROW_FUNCTIONS = `import { join } from "node:path";

export const greet = (name: string): string => {
  return \`Hello, \${name}!\`;
};

export const add = (a: number, b: number) => a + b;

const internal = async (data: Buffer): Promise<void> => {
  console.log(data.toString());
};

export const processItems = (items: string[]) => {
  return items
    .filter(Boolean)
    .map((item) => item.trim())
    .sort();
};
`;

// ── Python fixtures ─────────────────────────────────────────────────

export const PY_CLASS_WITH_METHODS = `import os
import sys
from typing import Optional, List
from dataclasses import dataclass

RETRY_COUNT = 3
MAX_TIMEOUT = 30

@dataclass
class Config:
    host: str
    port: int = 8080
    debug: bool = False

class DatabaseConnection:
    """Manages database connections and queries."""

    def __init__(self, config: Config):
        self.config = config
        self._connection = None

    async def connect(self) -> None:
        """Establish database connection."""
        self._connection = await self._create_connection()

    async def query(self, sql: str, params: Optional[List] = None) -> List[dict]:
        """Execute a SQL query and return results."""
        if not self._connection:
            raise RuntimeError("Not connected")
        return await self._execute(sql, params)

    async def _execute(self, sql: str, params):
        pass

    def close(self) -> None:
        """Close the database connection."""
        if self._connection:
            self._connection.close()
            self._connection = None

def create_pool(config: Config, size: int = 5) -> "ConnectionPool":
    """Create a connection pool."""
    return ConnectionPool(config, size)

def _internal_helper():
    pass
`;

// ── Java fixtures ────────────────────────────────────────────────────

/** Realistic EJB service bean — tests annotations, all access modifiers, generics, constructors */
export const JAVA_EJB_BEAN = `package com.example.service;

import javax.ejb.Stateless;
import javax.ejb.TransactionAttribute;
import javax.ejb.TransactionAttributeType;
import javax.inject.Inject;
import java.util.List;
import java.util.Map;

@Stateless
@TransactionAttribute(TransactionAttributeType.REQUIRED)
public class PersistentObjectServiceBean extends AbstractService
        implements PersistentObjectService {

    @Inject
    private NodeTypeRepository nodeTypeRepository;

    @EJB
    private EventPropagator eventPropagator;

    public PersistentObjectServiceBean() {
    }

    @Override
    public ManagedObject create(String fdn, Map<String, Object> attributes) {
        validateFdn(fdn);
        final ManagedObject mo = new ManagedObjectImpl(fdn);
        mo.setAttributes(attributes);
        eventPropagator.propagate(new CreateEvent(fdn));
        return mo;
    }

    @Override
    public ManagedObject findByFdn(String fdn) {
        return nodeTypeRepository.findByFdn(fdn);
    }

    @Override
    public List<ManagedObject> search(Map<String, Object> criteria) {
        return nodeTypeRepository.findByCriteria(criteria);
    }

    @TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
    public long count() {
        return nodeTypeRepository.count();
    }

    protected void validateFdn(String fdn) {
        if (fdn == null || fdn.isEmpty()) {
            throw new IllegalArgumentException("FDN must not be empty");
        }
    }

    private boolean isValidAttribute(String key, Object value) {
        return key != null && !key.isEmpty() && value != null;
    }
}
`;

/** Abstract repository with generics — tests generic return types, abstract methods */
export const JAVA_ABSTRACT_REPOSITORY = `package com.example.repository;

import java.util.List;
import java.util.Optional;
import javax.persistence.EntityManager;
import javax.persistence.PersistenceContext;
import javax.persistence.TypedQuery;

public abstract class AbstractRepository<T, ID> {

    @PersistenceContext
    protected EntityManager em;

    protected abstract Class<T> getEntityClass();

    public Optional<T> findById(ID id) {
        return Optional.ofNullable(em.find(getEntityClass(), id));
    }

    public List<T> findAll() {
        TypedQuery<T> q = em.createQuery(
            "SELECT e FROM " + getEntityClass().getSimpleName() + " e",
            getEntityClass());
        return q.getResultList();
    }

    public <R> List<R> findBy(String jpql, Class<R> resultType) {
        return em.createQuery(jpql, resultType).getResultList();
    }

    public T save(T entity) {
        if (em.contains(entity)) {
            return em.merge(entity);
        }
        em.persist(entity);
        return entity;
    }

    public void delete(ID id) {
        T entity = em.find(getEntityClass(), id);
        if (entity != null) em.remove(entity);
    }
}
`;

/** Interface with default methods — tests abstract method detection (ends with ;) */
export const JAVA_INTERFACE = `package com.example.api;

import java.util.List;

public interface PersistentObjectService {

    ManagedObject create(String fdn, java.util.Map<String, Object> attributes);

    ManagedObject findByFdn(String fdn);

    List<ManagedObject> search(java.util.Map<String, Object> criteria);

    default boolean exists(String fdn) {
        return findByFdn(fdn) != null;
    }

    long count();
}
`;

/** Enum with methods — tests enum body parsing */
export const JAVA_ENUM_WITH_METHODS = `package com.example.model;

public enum NodeStatus {

    ACTIVE("active", true),
    INACTIVE("inactive", false),
    PENDING("pending", false);

    private final String code;
    private final boolean operational;

    NodeStatus(String code, boolean operational) {
        this.code = code;
        this.operational = operational;
    }

    public String getCode() {
        return code;
    }

    public boolean isOperational() {
        return operational;
    }

    public static NodeStatus fromCode(String code) {
        for (NodeStatus status : values()) {
            if (status.code.equals(code)) return status;
        }
        throw new IllegalArgumentException("Unknown status: " + code);
    }
}
`;

// ── Go fixtures ─────────────────────────────────────────────────────

export const GO_STRUCTS_AND_FUNCS = `package auth

import (
\t"context"
\t"crypto/rand"
\t"encoding/hex"
\t"errors"
\t"time"
)

type TokenService struct {
\tSecret    string
\tExpiry    time.Duration
\tRefresh   bool
}

type Claims struct {
\tUserID    string
\tExpiresAt time.Time
}

func NewTokenService(secret string, expiry time.Duration) *TokenService {
\treturn &TokenService{
\t\tSecret: secret,
\t\tExpiry: expiry,
\t}
}

func (ts *TokenService) Generate(ctx context.Context, userID string) (string, error) {
\ttoken := make([]byte, 32)
\t_, err := rand.Read(token)
\tif err != nil {
\t\treturn "", err
\t}
\treturn hex.EncodeToString(token), nil
}

func (ts *TokenService) Validate(token string) (*Claims, error) {
\tif token == "" {
\t\treturn nil, errors.New("empty token")
\t}
\treturn &Claims{UserID: "test"}, nil
}

var ErrExpired = errors.New("token expired")
`;
