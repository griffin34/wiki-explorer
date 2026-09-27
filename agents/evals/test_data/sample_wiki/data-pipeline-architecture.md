---
title: Data Pipeline Architecture
type: concept
tags: [architecture, data-pipeline, technical, infrastructure]
created: 2026-02-15
modified: 2026-06-20
---

# Data Pipeline Architecture

Technical architecture documentation for the [[project-overview|DataFlow Platform]] data pipeline.

## System Overview

The DataFlow pipeline processes streaming data from customer sources through ingestion, transformation, storage, and query layers.

```
                    ┌─────────────────────────────────────────────┐
                    │              DataFlow Platform              │
                    │                                             │
┌─────────┐        │  ┌─────────┐   ┌───────────┐   ┌─────────┐ │
│ Sources │───────►│  │ Ingest  │──►│ Transform │──►│ Storage │ │
│         │        │  │ Layer   │   │  Layer    │   │  Layer  │ │
└─────────┘        │  └─────────┘   └───────────┘   └─────────┘ │
                    │       │              │              │       │
                    │       ▼              ▼              ▼       │
                    │  ┌─────────────────────────────────────┐   │
                    │  │           Query Layer               │   │
                    │  │      (SQL API + REST API)           │   │
                    │  └─────────────────────────────────────┘   │
                    │                    │                        │
                    └────────────────────┼────────────────────────┘
                                         │
                                         ▼
                                    ┌─────────┐
                                    │  Users  │
                                    └─────────┘
```

## Layer Details

### 1. Ingestion Layer

**Technology:** Apache Kafka

**Purpose:** Accept data from diverse sources with guaranteed delivery.

**Connectors:**
- HTTP/REST webhook receiver
- Kafka native (for Kafka-native sources)
- S3 event listener
- Database CDC (Debezium)
- Custom SDK (Python, Java, Go)

**Specifications:**
| Metric | Value |
|--------|-------|
| Throughput | 1M events/sec (target) |
| Retention | 7 days |
| Partitions | 64 per topic |
| Replication | 3x |

**Schema Registry:**
- Confluent Schema Registry for Avro/Protobuf
- Schema evolution with compatibility checks
- Dead letter queue for malformed messages

### 2. Transform Layer

**Technology:** Apache Spark Structured Streaming

**Purpose:** Real-time data transformations, enrichment, and aggregations.

**Processing modes:**
- **Continuous** — Sub-second latency for hot paths
- **Micro-batch** — Cost-efficient for near-real-time
- **Batch** — Historical reprocessing and backfills

**Built-in transformations:**
- JSON/Avro parsing
- Schema normalization
- Timestamp alignment
- Geolocation enrichment
- PII masking

**Custom transformations:**
Users can define SQL-based transformations:

```sql
CREATE TRANSFORMATION enrich_events AS
SELECT 
    *,
    geo_lookup(ip_address) AS location,
    CASE 
        WHEN amount > 10000 THEN 'high_value'
        ELSE 'standard'
    END AS transaction_tier
FROM raw_events
WHERE event_type IN ('purchase', 'refund')
```

### 3. Feature Store

**Technology:** Custom implementation on Delta Lake

**Purpose:** Serve pre-computed features for [[machine-learning-basics|ML models]].

**Capabilities:**
- Point-in-time correct feature retrieval
- Online (low-latency) and offline (batch) serving
- Feature versioning and lineage
- Automated feature computation pipelines

**Example feature definition:**

```python
@feature_store.register
def user_purchase_stats(user_id: str, window: str = "7d"):
    return {
        "total_purchases": count(purchases, window),
        "avg_purchase_value": avg(purchases.amount, window),
        "purchase_frequency": count(purchases, window) / days(window)
    }
```

Contact [[team-members#sarah-martinez|Sarah Martinez]] for feature store access.

### 4. Storage Layer

**Technology:** Delta Lake on S3

**Purpose:** Durable, ACID-compliant storage with time travel.

**Table organization:**
```
s3://dataflow-prod/
├── bronze/          # Raw ingested data
│   └── events/
├── silver/          # Cleaned, normalized
│   └── events_clean/
├── gold/            # Aggregated, business-ready
│   ├── daily_metrics/
│   └── user_profiles/
└── features/        # ML feature tables
    └── user_features/
```

**Retention policies:**
| Layer | Retention | Compaction |
|-------|-----------|------------|
| Bronze | 90 days | None |
| Silver | 1 year | Weekly |
| Gold | 3 years | Daily |
| Features | 30 days | Continuous |

### 5. Query Layer

**Technology:** Presto / Trino

**Purpose:** SQL interface for analytics and dashboards.

**Query patterns supported:**
- Ad-hoc exploration
- Scheduled reports
- Dashboard queries
- API-driven queries

**Performance tiers:**
| Tier | Latency | Use Case |
|------|---------|----------|
| Interactive | <1s | Dashboards |
| Standard | <30s | Reports |
| Batch | <10min | Large exports |

## Infrastructure

### Kubernetes Deployment

All services run on Amazon EKS with the following configuration:

| Service | Instances | CPU | Memory |
|---------|-----------|-----|--------|
| Kafka brokers | 6 | 8 | 32GB |
| Spark drivers | 4 | 4 | 16GB |
| Spark executors | 12-48 | 8 | 32GB |
| Presto coordinators | 2 | 4 | 16GB |
| Presto workers | 8-24 | 16 | 64GB |

### Auto-scaling

Kubernetes HPA configured for:
- Spark executors: Scale on CPU (target 70%)
- Presto workers: Scale on query queue depth
- Ingestion: Scale on Kafka consumer lag

### Monitoring

**Metrics (Prometheus + Grafana):**
- Pipeline latency (P50, P95, P99)
- Throughput (events/sec)
- Error rates
- Resource utilization

**Alerts:**
- Consumer lag > 100K events
- Transform error rate > 1%
- Query latency P99 > 5s
- Storage write failures

Contact [[team-members#michael-thompson|Michael Thompson]] for architecture questions.

## Security

### Data Protection

- **Encryption at rest:** AES-256 (S3 SSE-KMS)
- **Encryption in transit:** TLS 1.3
- **PII handling:** Column-level masking, tokenization
- **Access control:** RBAC with Ranger

### Compliance

- SOC2 Type II certified (see [[quarterly-review-q2-2026]])
- GDPR data deletion pipeline
- Audit logging for all data access

## Disaster Recovery

| Metric | Target |
|--------|--------|
| RPO | 1 hour |
| RTO | 4 hours |
| Backup frequency | Hourly snapshots |
| Cross-region replication | US-East → US-West |

## API Reference

### REST API

```
POST /api/v1/events
Content-Type: application/json

{
  "events": [
    {"type": "purchase", "user_id": "123", "amount": 49.99}
  ]
}
```

### SDK Usage

```python
from dataflow import Client

client = Client(api_key="...")
client.send_event({
    "type": "purchase",
    "user_id": "123",
    "amount": 49.99
})
```

## Runbooks

### Consumer Lag Alert

1. Check Kafka broker health: `kubectl get pods -l app=kafka`
2. Verify Spark jobs running: `kubectl get pods -l app=spark`
3. Scale executors if needed: `kubectl scale deployment spark-executor --replicas=24`
4. Check for poison messages in DLQ

### Query Performance Degradation

1. Check Presto coordinator logs
2. Verify Delta table compaction status
3. Review recent schema changes
4. Consider partition pruning optimization

---

Maintained by [[team-members#michael-thompson|Michael Thompson]].
Last reviewed: 2026-06-20.
