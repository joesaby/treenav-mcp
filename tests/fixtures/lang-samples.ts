/**
 * Comprehensive language sample fixtures for parser tests.
 *
 * Each fixture exercises edge cases and realistic patterns for
 * TypeScript, Python, Go, Rust, Java, C/C++, Ruby, and Shell parsers.
 */

// ── TypeScript / JavaScript ────────────────────────────────────────

export const TS_ABSTRACT_CLASS = `import { EventEmitter } from "events";

export abstract class BaseRepository<T> {
  protected db: Database;
  abstract tableName: string;

  constructor(db: Database) {
    this.db = db;
  }

  abstract findById(id: string): Promise<T | null>;

  async findAll(): Promise<T[]> {
    return this.db.query(\`SELECT * FROM \${this.tableName}\`);
  }

  protected async save(entity: T): Promise<T> {
    return this.db.insert(this.tableName, entity);
  }
}
`;

export const TS_COMPLEX_GENERICS = `export interface Repository<T extends Entity, ID = string> {
  findById(id: ID): Promise<T | null>;
  findAll(filter?: Partial<T>): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: ID): Promise<void>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
`;

export const TS_ENUM_CONST_ENUM = `export enum Direction {
  Up = "UP",
  Down = "DOWN",
  Left = "LEFT",
  Right = "RIGHT",
}

export const enum Status {
  Active,
  Inactive,
  Pending,
}

enum InternalState {
  Loading,
  Ready,
  Error,
}
`;

export const TS_MULTI_LINE_FUNCTION = `export async function fetchData<T>(
  url: string,
  options: RequestInit,
  retries: number = 3,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      return await response.json();
    } catch (e) {
      if (i === retries - 1) throw e;
    }
  }
  throw new Error("unreachable");
}

export function* generateIds(prefix: string): Generator<string> {
  let id = 0;
  while (true) {
    yield \`\${prefix}_\${id++}\`;
  }
}
`;

export const TS_COMPLEX_ARROW = `export const debounce = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): ((...args: Parameters<T>) => void) => {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

export const identity = <T>(x: T): T => x;

const privateUtil = (data: string): string => {
  return data.trim().toLowerCase();
};

export const CONFIG = {
  apiUrl: "https://api.example.com",
  timeout: 5000,
  retries: 3,
};

export const ROUTES = [
  "/api/users",
  "/api/posts",
  "/api/comments",
];
`;

export const TS_CLASS_ACCESSORS = `export class User {
  private _name: string;
  private _email: string;
  readonly id: string;

  constructor(id: string, name: string, email: string) {
    this.id = id;
    this._name = name;
    this._email = email;
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = value.trim();
  }

  get email(): string {
    return this._email;
  }

  static fromJSON(json: { id: string; name: string; email: string }): User {
    return new User(json.id, json.name, json.email);
  }

  override toString(): string {
    return \`User(\${this.id}, \${this._name})\`;
  }
}
`;

export const TS_EXPORTED_ARRAYS_OBJECTS = `export const ALLOWED_ORIGINS = [
  "https://example.com",
  "https://staging.example.com",
  "http://localhost:3000",
];

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

export let mutableConfig = {
  debug: false,
  verbose: true,
};
`;

export const TS_IMPLEMENTS_EXTENDS = `export class AdminUser extends User implements Serializable, Auditable {
  role: string = "admin";

  constructor(id: string, name: string) {
    super(id, name, "admin@example.com");
    this.role = "admin";
  }

  serialize(): string {
    return JSON.stringify({ id: this.id, name: this.name, role: this.role });
  }

  getAuditLog(): AuditEntry[] {
    return [];
  }
}
`;

export const TS_ONLY_IMPORTS = `import { readFileSync } from "fs";
import { join, resolve } from "path";
import type { Config } from "./config";
`;

export const TS_EMPTY_FILE = ``;

export const TS_COMMENTS_ONLY = `// This file is intentionally empty
/* Block comment */
/**
 * JSDoc comment
 */
`;

export const TS_INTERFACE_WITH_METHODS = `export interface EventBus {
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
  once(event: string, handler: (...args: any[]) => void): void;
  readonly listenerCount: number;
}
`;

export const TS_MULTIPLE_CLASSES = `export class Parser {
  parse(input: string): AST {
    return { type: "root", children: [] };
  }
}

export class Lexer {
  tokenize(input: string): Token[] {
    return [];
  }
}

class InternalHelper {
  private data: string;

  constructor(data: string) {
    this.data = data;
  }

  process(): string {
    return this.data;
  }
}
`;

// ── Python ─────────────────────────────────────────────────────────

export const PY_ASYNC_DECORATORS = `import asyncio
from functools import wraps
from typing import Any, Callable, TypeVar

T = TypeVar("T")

def retry(max_attempts: int = 3):
    """Decorator that retries a function on failure."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            for attempt in range(max_attempts):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise
        return wrapper
    return decorator

@retry(max_attempts=5)
async def fetch_data(url: str) -> dict:
    """Fetch data from a URL with retries."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()

class APIClient:
    """HTTP API client with retry support."""

    def __init__(self, base_url: str, timeout: int = 30):
        self.base_url = base_url
        self.timeout = timeout

    @retry(max_attempts=3)
    async def get(self, path: str) -> dict:
        """Make a GET request."""
        url = f"{self.base_url}{path}"
        return await fetch_data(url)

    @retry(max_attempts=3)
    async def post(self, path: str, data: dict) -> dict:
        """Make a POST request."""
        pass

    @staticmethod
    def build_url(base: str, path: str) -> str:
        """Build a full URL."""
        return f"{base.rstrip('/')}/{path.lstrip('/')}"

    @classmethod
    def from_env(cls) -> "APIClient":
        """Create client from environment variables."""
        import os
        return cls(os.environ["API_URL"])
`;

export const PY_INHERITANCE = `from abc import ABC, abstractmethod

class Shape(ABC):
    """Abstract base class for shapes."""

    @abstractmethod
    def area(self) -> float:
        """Calculate the area."""
        pass

    @abstractmethod
    def perimeter(self) -> float:
        """Calculate the perimeter."""
        pass

class Circle(Shape):
    """A circle shape."""

    PI = 3.14159

    def __init__(self, radius: float):
        self.radius = radius

    def area(self) -> float:
        return self.PI * self.radius ** 2

    def perimeter(self) -> float:
        return 2 * self.PI * self.radius

class Rectangle(Shape):
    """A rectangle shape."""

    def __init__(self, width: float, height: float):
        self.width = width
        self.height = height

    def area(self) -> float:
        return self.width * self.height

    def perimeter(self) -> float:
        return 2 * (self.width + self.height)
`;

export const PY_MODULE_CONSTANTS = `import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
CONFIG_PATH = os.path.join(BASE_DIR, "config.yaml")

MAX_RETRIES = 3
DEFAULT_TIMEOUT: int = 30
API_VERSION = "v2"

SUPPORTED_FORMATS = [
    "json",
    "yaml",
    "toml",
]

ERROR_CODES = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
}

_INTERNAL_SECRET = "should-not-be-exported"

def get_config() -> dict:
    """Load configuration from file."""
    pass
`;

export const PY_DUNDER_METHODS = `class Matrix:
    """A 2D matrix with operator overloading."""

    def __init__(self, rows: list[list[float]]):
        self.rows = rows

    def __repr__(self) -> str:
        return f"Matrix({self.rows})"

    def __str__(self) -> str:
        return "\\n".join(" ".join(str(x) for x in row) for row in self.rows)

    def __add__(self, other: "Matrix") -> "Matrix":
        result = []
        for r1, r2 in zip(self.rows, other.rows):
            result.append([a + b for a, b in zip(r1, r2)])
        return Matrix(result)

    def __mul__(self, scalar: float) -> "Matrix":
        return Matrix([[x * scalar for x in row] for row in self.rows])

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Matrix):
            return NotImplemented
        return self.rows == other.rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> list[float]:
        return self.rows[index]
`;

export const PY_EMPTY_FILE = ``;

export const PY_ONLY_IMPORTS = `import os
import sys
from typing import Optional
`;

export const PY_MULTI_LINE_IMPORTS = `from typing import (
    Optional,
    List,
    Dict,
    Tuple,
    Set,
    Union,
)
from pathlib import Path
import os

def process():
    pass
`;

export const PY_NESTED_CLASSES = `class Outer:
    """Outer class with nested inner class."""

    class Inner:
        """Inner class."""

        def inner_method(self):
            pass

    def outer_method(self):
        pass
`;

// ── Go ─────────────────────────────────────────────────────────────

export const GO_INTERFACES = `package storage

import (
\t"context"
\t"io"
)

type Reader interface {
\tRead(ctx context.Context, key string) (io.ReadCloser, error)
\tExists(ctx context.Context, key string) (bool, error)
}

type Writer interface {
\tWrite(ctx context.Context, key string, data io.Reader) error
\tDelete(ctx context.Context, key string) error
}

type Storage interface {
\tReader
\tWriter
\tClose() error
}

type S3Storage struct {
\tbucket string
\tregion string
}

func NewS3Storage(bucket, region string) *S3Storage {
\treturn &S3Storage{bucket: bucket, region: region}
}

func (s *S3Storage) Read(ctx context.Context, key string) (io.ReadCloser, error) {
\treturn nil, nil
}

func (s *S3Storage) Write(ctx context.Context, key string, data io.Reader) error {
\treturn nil
}

func (s *S3Storage) Delete(ctx context.Context, key string) error {
\treturn nil
}

func (s *S3Storage) Exists(ctx context.Context, key string) (bool, error) {
\treturn false, nil
}

func (s *S3Storage) Close() error {
\treturn nil
}

var DefaultBucket = "my-bucket"
const MaxFileSize = 1024 * 1024 * 100
`;

export const GO_UNEXPORTED = `package internal

type config struct {
\thost string
\tport int
}

func newConfig() *config {
\treturn &config{host: "localhost", port: 8080}
}

func (c *config) validate() error {
\treturn nil
}

var defaultConfig = newConfig()
`;

// ── Rust ───────────────────────────────────────────────────────────

export const RUST_STRUCTS_TRAITS = `use std::fmt;
use std::collections::HashMap;

pub struct Config {
    pub host: String,
    pub port: u16,
    debug: bool,
}

impl Config {
    pub fn new(host: String, port: u16) -> Self {
        Config { host, port, debug: false }
    }

    pub fn with_debug(mut self) -> Self {
        self.debug = true;
        self
    }

    fn validate(&self) -> bool {
        self.port > 0
    }
}

impl fmt::Display for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.host, self.port)
    }
}

pub trait Service {
    fn start(&self) -> Result<(), Box<dyn std::error::Error>>;
    fn stop(&self);
    fn health_check(&self) -> bool;
}

pub enum ServerState {
    Running,
    Stopped,
    Error(String),
}

pub async fn start_server(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn internal_helper() -> bool {
    true
}

pub const MAX_CONNECTIONS: u32 = 1000;
pub static DEFAULT_HOST: &str = "localhost";
pub type ConnectionPool = Vec<Connection>;
`;

export const RUST_ENUMS = `pub enum Color {
    Red,
    Green,
    Blue,
    Custom(u8, u8, u8),
}

enum InternalError {
    NotFound,
    Timeout,
    Unknown(String),
}
`;

// ── Java ───────────────────────────────────────────────────────────

export const JAVA_CLASS = `package com.example.auth;

import java.util.Map;
import java.util.HashMap;
import java.util.Optional;

public class AuthenticationService {
    private final Map<String, String> tokenStore;
    private final int maxRetries;

    public AuthenticationService(int maxRetries) {
        this.tokenStore = new HashMap<>();
        this.maxRetries = maxRetries;
    }

    public Optional<String> authenticate(String username, String password) {
        if (username == null || password == null) {
            return Optional.empty();
        }
        String token = generateToken(username);
        tokenStore.put(token, username);
        return Optional.of(token);
    }

    private String generateToken(String username) {
        return username + "_" + System.currentTimeMillis();
    }

    public boolean validateToken(String token) {
        return tokenStore.containsKey(token);
    }

    public void revokeToken(String token) {
        tokenStore.remove(token);
    }
}

interface TokenProvider {
    String generateToken(String subject);
    boolean validateToken(String token);
}

enum AuthRole {
    ADMIN,
    USER,
    GUEST
}
`;

// ── C/C++ ──────────────────────────────────────────────────────────

export const C_HEADER = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_BUFFER 1024
#define MIN(a, b) ((a) < (b) ? (a) : (b))

typedef struct {
    char* host;
    int port;
    int max_connections;
} ServerConfig;

typedef enum {
    STATUS_OK = 0,
    STATUS_ERROR = 1,
    STATUS_TIMEOUT = 2
} StatusCode;

ServerConfig* create_config(const char* host, int port);
void destroy_config(ServerConfig* config);
StatusCode start_server(ServerConfig* config);
static void internal_init(void);
`;

export const CPP_CLASS = `#include <string>
#include <vector>
#include <memory>

class HttpServer {
public:
    HttpServer(const std::string& host, int port);
    ~HttpServer();

    void start();
    void stop();
    bool isRunning() const;

    void addRoute(const std::string& path, Handler handler);

private:
    std::string host_;
    int port_;
    bool running_;
    std::vector<Route> routes_;

    void handleRequest(const Request& req, Response& res);
    void logRequest(const Request& req);
};

namespace utils {
    std::string urlEncode(const std::string& input);
    std::string urlDecode(const std::string& input);
}
`;

export const CPP_IMPL = `#include "http_server.h"

HttpServer::HttpServer(const std::string& host, int port)
    : host_(host), port_(port), running_(false) {}

HttpServer::~HttpServer() {
    if (running_) {
        stop();
    }
}

void HttpServer::start() {
    running_ = true;
}

void HttpServer::stop() {
    running_ = false;
}

bool HttpServer::isRunning() const {
    return running_;
}

void HttpServer::handleRequest(const Request& req, Response& res) {
    logRequest(req);
}
`;

// ── Ruby ───────────────────────────────────────────────────────────

export const RUBY_CLASS = `require 'json'
require_relative 'config'

class UserService
  attr_reader :users

  def initialize(config)
    @config = config
    @users = {}
  end

  def find(id)
    @users[id]
  end

  def create(name, email)
    id = SecureRandom.uuid
    @users[id] = { name: name, email: email }
    id
  end

  def delete(id)
    @users.delete(id)
  end

  def _internal_validate(user)
    user[:name] && user[:email]
  end
end

class AdminService < UserService
  def promote(user_id)
    user = find(user_id)
    user[:role] = :admin if user
  end
end

def create_service(config)
  UserService.new(config)
end
`;

// ── Shell ──────────────────────────────────────────────────────────

export const SHELL_SCRIPT = `#!/bin/bash

source /etc/profile
. ./helpers.sh

MAX_RETRIES=3
LOG_FILE="/var/log/deploy.log"

function deploy() {
    echo "Deploying..."
    build_app
    run_migrations
    restart_service
}

function build_app() {
    echo "Building..."
    npm run build
}

run_migrations() {
    echo "Running migrations..."
    ./manage.py migrate
}

function restart_service() {
    systemctl restart myapp
}

cleanup() {
    rm -rf /tmp/build-*
}
`;
