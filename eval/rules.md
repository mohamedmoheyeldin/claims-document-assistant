# Evaluation: rules extractor

Run on 2026-10-18 over 60 labelled synthetic documents.

| Metric | Result |
|---|---|
| Field accuracy (all 60 documents) | 80.5% |
| Documents with every field correct | 80.0% |
| Missing/invalid-information flags: precision | 17.9% |
| Missing/invalid-information flags: recall | 94.3% |
| Claims routed to the right status | 88.3% |
| Time per document (mean / p95) | 8 ms / 11 ms |

## By layout

| Layout | Documents | Field accuracy | Every field correct | Flag precision | Flag recall |
|---|---|---|---|---|---|
| form | 31 | 100.0% | 100.0% | 100.0% | 100.0% |
| letter | 17 | 100.0% | 100.0% | 100.0% | 100.0% |
| note | 12 | 2.5% | 0.0% | 3.2% | 71.4% |
