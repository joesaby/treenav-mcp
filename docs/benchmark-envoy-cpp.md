# treenav-mcp Benchmark — envoy

**Date:** 2026-02-27
**Root:** `/tmp/envoy`
**Language filter:** cpp

## Indexing Performance

| Metric | Value |
|---|---|
| Files indexed | 657 |
| Parse time | 0.11s |
| Store load time | 0.29s |
| Files/second | 5,919 |
| Total nodes | 7,159 |
| Indexed terms | 44,426 |
| Total words | 403,468 |

## Symbol Extraction

| Metric | Value |
|---|---|
| Avg nodes/file | 10.9 |
| Median nodes/file | 6 |
| Max nodes/file | 135 |
| Files with 0 symbols | 0 (0.0%) |
| Files with only imports | 53 (8.1%) |

### Nodes by symbol kind

| Kind | Total nodes | Files containing |
|---|---|---|
| function | 6,306 | 594 |
| class | 188 | 98 |
| enum | 8 | 6 |
| version_suffix.cc | 1 | — |
| version_linkstamp.cc | 1 | — |

## Sample Files (top 10 by node count)

| File | Nodes | Description |
|---|---|---|
| `source/common/http/http2/codec_impl.cc` | 135 | 2 classes: StaticHeaderNameLookup, Http2ResponseCodeDetailValues; 129  |
| `source/common/http/filter_manager.cc` | 122 | 121 functions: ActiveStreamFilterBase::commonContinue, ActiveStreamFil |
| `source/common/http/conn_manager_impl.cc` | 103 | 102 functions: ConnectionManagerImpl::generateStats, ConnectionManager |
| `source/common/http/http1/codec_impl.cc` | 86 | 2 classes: Http1ResponseCodeDetailValues, Http1HeaderTypesValues; 83 f |
| `source/common/upstream/cluster_manager_impl.cc` | 79 | 78 functions: ClusterManagerInitHelper::addCluster, ClusterManagerInit |
| `source/extensions/filters/http/ext_proc/ext_proc.cc` | 79 | 78 functions: std::function, FilterConfig::FilterConfig, ExtProcLoggin |
| `source/common/stats/thread_local_store.cc` | 78 | 2 classes: StatNameTagHelper, MetricBag; 75 functions: ThreadLocalStor |
| `source/common/tcp_proxy/tcp_proxy.cc` | 77 | 2 classes: PerConnectionClusterFactory, PerConnectionIdleTimeoutMsObje |
| `source/common/upstream/upstream_impl.cc` | 72 | 71 functions: LoadMetricStatsImpl::add, LoadMetricStatsImpl::latch, Ho |
| `source/common/http/utility.cc` | 72 | 3 classes: SettingsEntry, SettingsEntryHash, SettingsEntryEquals; 68 f |

## Search Quality

### Query: `filter`

| Score | Symbol | Snippet |
|---|---|---|
| 67.5 | function FilterChainManagerImpl::addFilterChains | …filter_chain_factory_builder.buildFilterChain(*filter_chain, context_creator, f |
| 52.5 | function FilterChainManagerImpl::verifyNoDuplicateMatchers | …envoy::config::listener::v3::FilterChain& filter_chain) { const auto& filter_ch |
| 52.0 | function FilterChainManagerImpl::findFilterChainForSourceTypes | …{ if (!filter_chain_local.first.empty()) { return findFilterChainForSourceIpAnd |
| 46.7 | function FilterChainManagerImpl::setupFilterChainMatcher | …FilterChainManagerImpl::setupFilterChainMatcher( const xds::type::matcher::v3:: |
| 44.7 | class FilterChainNameAction | struct FilterChainNameAction : public Matcher::ActionBase<Protobuf::StringValue, |
| 43.7 | function FilterChainManagerImpl::maybeConstructMatcher | …FilterChainsByName& filter_chains_by_name, Configuration::FactoryContext& paren |
| 43.0 | function FilterManager::handleDataIfStopAll | bool FilterManager::handleDataIfStopAll(ActiveStreamFilterBase& filter, Buffer:: |
| 42.6 | function FilterChainUtility::buildFilterChain | bool FilterChainUtility::buildFilterChain(Network::FilterManager& filter_manager |

### Query: `http connection`

| Score | Symbol | Snippet |
|---|---|---|
| 97.9 | function ProxyStatusUtils::proxyStatusErrorToString | …ProxyStatusError::ConnectionTimeout: return CONNECTION_TIMEOUT; case ProxyStatu |
| 91.2 | class Http1ResponseCodeDetailValues | struct Http1ResponseCodeDetailValues { const absl::string_view TooManyHeaders =  |
| 63.1 | function ActiveStream::ActiveStream | …connection_manager_.overload_manager_), request_response_timespan_(new Stats::H |
| 59.7 | function HttpConnPoolImplBase::onPoolReady | …*http_context.callbacks_; // Track this request on the connection http_client-> |
| 56.7 | function ConnectionManagerUtility::autoCreateCodec | …ConnectionManagerUtility::autoCreateCodec( Network::Connection& connection, con |
| 55.9 | function ConnectionImpl::ConnectionImpl | ConnectionImpl::ConnectionImpl(Network::Connection& connection, CodecStats& stat |
| 55.2 | function BalsaParser::BalsaParser | …!= nullptr); quiche::HttpValidationPolicy http_validation_policy; http_validati |
| 54.1 | function ClientConnectionImpl::ClientConnectionImpl | …stats, Random::RandomGenerator& random_generator, const envoy::config::core::v3 |

### Query: `listener`

| Score | Symbol | Snippet |
|---|---|---|
| 53.8 | function ListenerFilterChainFactoryBuilder::ListenerFilterChainFactoryBuilder | ListenerFilterChainFactoryBuilder::ListenerFilterChainFactoryBuilder( ListenerIm |
| 53.7 | function ListenersHandler::writeListenersAsJson | void ListenersHandler::writeListenersAsJson(Buffer::Instance& response) { envoy: |
| 53.4 | function ListenerManagerImpl::createListenSocketFactory | absl::Status ListenerManagerImpl::createListenSocketFactory(ListenerImpl& listen |
| 49.1 | function ListenerFilterMatcherBuilder::buildListenerFilterMatcher | …ListenerFilterMatcherBuilder::buildListenerFilterMatcher( const envoy::config:: |
| 39.3 | function ListenerManagerImpl::listeners | ListenerManagerImpl::listeners(ListenerState state) { std::vector<std::reference |
| 38.6 | function ListenerFilterSetLogicMatcher::ListenerFilterSetLogicMatcher | ListenerFilterSetLogicMatcher::ListenerFilterSetLogicMatcher( absl::Span<const : |
| 38.4 | function ListenerImpl::createListenerFilterFactories | ListenerImpl::createListenerFilterFactories(const envoy::config::listener::v3::L |
| 38.2 | function ProdListenerComponentFactory::createListenerFilterMatcher | Network::ListenerFilterMatcherSharedPtr ProdListenerComponentFactory::createList |

## Parser Coverage Notes

| Language | Parser | Class | Interface | Enum | Methods | Known gaps |
|---|---|---|---|---|---|---|
| Java | java.ts (dedicated) | ✓ | ✓ | ✓ | ✓ | Inner class members not recursed |
| TypeScript/JS | typescript.ts (dedicated) | ✓ | ✓ | ✓ | ✓ | — |
| Python | python.ts (dedicated) | ✓ | — | — | ✓ | — |
| Go | generic.ts | ✓ structs | ✓ interfaces | ✓ | ✓ receiver methods | impl blocks |
| Rust | generic.ts | ✓ structs | ✓ traits | ✓ | top-level fn only | impl blocks, pub(crate) fn |
| C++ | generic.ts | ✓ (top-level) | — | — | ✓ ClassName::method | Indented classes (namespaces) |
| C# / Kotlin / Scala | generic.ts | ✓ | ✓ | ✓ | ✗ (no fn keyword) | Methods inside classes |
