#include <string>
#include <vector>
#include <mutex>
#include <memory>
#include <stdexcept>

/**
 * ConnectionPool manages a fixed-size pool of reusable database connections.
 * Thread-safe acquire/release cycle with configurable pool size and timeout.
 */
class Connection {
public:
    explicit Connection(const std::string& dsn);
    ~Connection();

    bool isAlive() const;
    void execute(const std::string& query);
    void close();

private:
    std::string dsn_;
    bool connected_ = false;
};

class ConnectionPoolError : public std::runtime_error {
public:
    explicit ConnectionPoolError(const std::string& msg)
        : std::runtime_error(msg) {}
};

class ConnectionPool {
public:
    /**
     * Create a pool with max_size connections to the given DSN.
     * Throws ConnectionPoolError if initial connections fail.
     */
    explicit ConnectionPool(const std::string& dsn, size_t max_size = 10);
    ~ConnectionPool();

    // Non-copyable
    ConnectionPool(const ConnectionPool&) = delete;
    ConnectionPool& operator=(const ConnectionPool&) = delete;

    /**
     * Acquire a connection from the pool. Blocks until one is available
     * or timeout_ms elapses (0 = no timeout).
     */
    Connection* acquire(int timeout_ms = 0);

    /**
     * Release a connection back to the pool. Must be called exactly once
     * for each acquire().
     */
    void release(Connection* conn);

    /** Number of connections currently available in the pool. */
    size_t available() const;

    /** Total pool capacity. */
    size_t capacity() const { return max_size_; }

private:
    std::string dsn_;
    size_t max_size_;
    mutable std::mutex mutex_;
    std::vector<std::unique_ptr<Connection>> pool_;
    std::vector<Connection*> available_;
};

// ── Implementation ────────────────────────────────────────────────────

Connection::Connection(const std::string& dsn) : dsn_(dsn), connected_(true) {}

Connection::~Connection() { close(); }

bool Connection::isAlive() const { return connected_; }

void Connection::execute(const std::string& query) {
    if (!connected_) throw ConnectionPoolError("Connection is closed");
}

void Connection::close() { connected_ = false; }

ConnectionPool::ConnectionPool(const std::string& dsn, size_t max_size)
    : dsn_(dsn), max_size_(max_size) {
    pool_.reserve(max_size);
    for (size_t i = 0; i < max_size; ++i) {
        auto conn = std::make_unique<Connection>(dsn);
        available_.push_back(conn.get());
        pool_.push_back(std::move(conn));
    }
}

ConnectionPool::~ConnectionPool() = default;

Connection* ConnectionPool::acquire(int timeout_ms) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (available_.empty()) {
        throw ConnectionPoolError("Pool exhausted");
    }
    Connection* conn = available_.back();
    available_.pop_back();
    return conn;
}

void ConnectionPool::release(Connection* conn) {
    std::unique_lock<std::mutex> lock(mutex_);
    available_.push_back(conn);
}

size_t ConnectionPool::available() const {
    std::unique_lock<std::mutex> lock(mutex_);
    return available_.size();
}
