# treenav-mcp Benchmark — prometheus

**Date:** 2026-02-27
**Root:** `/tmp/prometheus`
**Language filter:** go

## Indexing Performance

| Metric | Value |
|---|---|
| Files indexed | 675 |
| Parse time | 0.15s |
| Store load time | 0.44s |
| Files/second | 4,383 |
| Total nodes | 10,657 |
| Indexed terms | 46,829 |
| Total words | 871,979 |

## Symbol Extraction

| Metric | Value |
|---|---|
| Avg nodes/file | 15.8 |
| Median nodes/file | 7 |
| Max nodes/file | 280 |
| Files with 0 symbols | 0 (0.0%) |
| Files with only imports | 27 (4.0%) |

### Nodes by symbol kind

| Kind | Total nodes | Files containing |
|---|---|---|
| function | 8,409 | 633 |
| class | 1,060 | 354 |
| variable | 382 | 220 |
| interface | 146 | 70 |
| method | 2 | 1 |

## Sample Files (top 10 by node count)

| File | Nodes | Description |
|---|---|---|
| `prompb/types.pb.go` | 280 | 16 classes: MetricMetadata, Sample, Exemplar, Histogram, Histogram_Cou |
| `prompb/io/prometheus/client/metrics.pb.go` | 243 | 12 classes: LabelPair, Gauge, Counter, Quantile, Summary, Untyped, His |
| `scrape/scrape_test.go` | 194 | 3 classes: testLoop, testScraper, noopFailureLogger; 190 functions: Te |
| `prompb/io/prometheus/write/v2/types.pb.go` | 182 | 11 classes: Request, TimeSeries, Exemplar, Sample, Metadata, Histogram |
| `tsdb/db_test.go` | 152 | 4 classes: testDBOptions, mockCompactorFailing, mockCompactorFn, block |
| `promql/engine.go` | 130 | 13 classes: engineMetrics, PrometheusQueryOpts, query, QueryOrigin, En |
| `tsdb/head.go` | 130 | 18 classes: Head, HeadOptions, headMetrics, HeadStats, WALReplayStatus |
| `promql/functions.go` | 123 | 118 functions: funcTime, pickOrInterpolateLeft, pickOrInterpolateRight |
| `tsdb/head_test.go` | 123 | 2 classes: unsupportedChunk, countSeriesLifecycleCallback; 120 functio |
| `prompb/remote.pb.go` | 115 | 6 classes: WriteRequest, ReadRequest, ReadResponse, Query, QueryResult |

## Search Quality

### Query: `query`

| Score | Symbol | Snippet |
|---|---|---|
| 58.2 | class engineMetrics | type engineMetrics struct { currentQueries prometheus.Gauge maxConcurrentQueries |
| 54.1 | function queryExemplarsPath | …params, Responses: responsesWithErrorExamples("QueryExemplarsOutputBody", query |
| 50.5 | function NewEngine | …Help: "The total number of samples loaded by all queries.", }), queryQueueTime: |
| 44.9 | function queryString | func (p *queryLogTest) queryString() string { switch p.origin { case apiOrigin:  |
| 43.9 | function queryRangePath | …Tags: []string{"query"}, RequestBody: formRequestBodyWithExamples("QueryRangePo |
| 42.9 | function queryPath | …query."), }, Post: &v3.Operation{ OperationId: "query-post", Summary: "Evaluate |
| 31.8 | function remoteReadStreamedXORChunks | …err } defer func() { if err := querier.Close(); err != nil { h.logger.Warn("Err |
| 31.7 | function queryPostExamples | func queryPostExamples() *orderedmap.Map[string, *base.Example] { examples := or |

### Query: `scrape target`

| Score | Symbol | Snippet |
|---|---|---|
| 145.6 | class scrapeMetrics | …targetMetadataCache *MetadataMetricsCollector targetScrapePools prometheus.Coun |
| 70.0 | function targets | …getGlobalURL(target.URL(), api.globalURLOptions) res.ActiveTargets = append(res |
| 51.6 | function scrapePoolsPath | …(*OpenAPIBuilder) scrapePoolsPath() *v3.PathItem { return &v3.PathItem{ Get: &v |
| 50.9 | function targetsPath | func (*OpenAPIBuilder) targetsPath() *v3.PathItem { params := []*v3.Parameter{ q |
| 50.4 | function targetSchema | …stringSchemaWithDescription("Scrape interval for this target.")) props.Set("scr |
| 50.1 | interface TargetRetriever | type TargetRetriever interface { TargetsActive() map[string][]*scrape.Target Tar |
| 50.1 | interface TargetRetriever | type TargetRetriever interface { TargetsActive() map[string][]*scrape.Target Tar |
| 46.1 | function targetsRelabelStepsPath | func (*OpenAPIBuilder) targetsRelabelStepsPath() *v3.PathItem { params := []*v3. |

### Query: `alerting rule`

| Score | Symbol | Snippet |
|---|---|---|
| 75.2 | function rulesAlertsToAPIAlerts | func rulesAlertsToAPIAlerts(rulesAlerts []*rules.Alert) []*Alert { apiAlerts :=  |
| 52.0 | function FixtureRuleGroups | func FixtureRuleGroups() []*rules.Group { // Create a simple recording rule. exp |
| 49.0 | function rules | …Limit: grp.Limit(), Rules: []Rule{}, EvaluationTime: grp.GetEvaluationTime().Se |
| 48.6 | function ruleMetric | func ruleMetric(rule rulefmt.Rule) string { if rule.Alert != "" { return rule.Al |
| 47.0 | class rulesRetrieverMock | type rulesRetrieverMock struct { alertingRules []*rules.AlertingRule ruleGroups  |
| 46.0 | interface RulesRetriever | type RulesRetriever interface { RuleGroups() []*rules.Group AlertingRules() []*r |
| 46.0 | interface RulesRetriever | type RulesRetriever interface { RuleGroups() []*rules.Group AlertingRules() []*r |
| 42.9 | interface Rule | type Rule interface { Name() string // Labels of the rule. Labels() labels.Label |

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
