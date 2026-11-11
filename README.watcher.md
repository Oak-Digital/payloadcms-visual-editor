# Watcher benchmark

Measured on 2026-11-11 in the frontend Nix environment (Node 24.13.0), using an isolated package copy with the same source snapshot, configuration and linked dependencies for both runs. The baseline watcher and package scripts came from `be2614bcf1a0e697ed51658b9d179e63d6f31e70`. Existing development processes were left running, so these are local samples, not controlled performance guarantees.

Each run started with existing build output. The optimized run first completed the new full build to record its fingerprint, matching Turbo's build-before-dev flow. Startup measures watcher launch to readiness, not a cold build or Next startup. Three stylesheet and three TSX edits appended a harmless comment to the HelpTooltip component and its stylesheet, restoring each file between samples. A 5 ms output-mtime poll measured file availability; build completion was measured separately from process logs. Both watchers retained the 150 ms debounce. Declaration checking runs separately in the optimized watcher.

| Measurement | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| Startup, existing output (one sample) | 2052 ms | 67 ms | 30.5× |
| Stylesheet output (median) | 481 ms | 164 ms | 2.9× |
| TSX output (median) | 1916 ms | 166 ms | 11.5× |
| Stylesheet complete update cycle (median) | 1895 ms | 162 ms | 11.7× |
| TSX complete update cycle (median) | 1924 ms | 163 ms | 11.8× |

Browser refresh/rendering and declaration-check completion are not included in the output timings. The old build copied styles before completing type generation and SWC compilation, which is why style output improved less than the complete build cycle.

## Raw samples

Times are milliseconds.

```json
{
  "before": [
    {
      "kind": "startup",
      "ms": 2051.914167
    },
    {
      "kind": "style",
      "ms": 1895.286583,
      "outputMs": 478.9353329999999
    },
    {
      "kind": "tsx",
      "ms": 1922.7870830000002,
      "outputMs": 1915.6902910000008
    },
    {
      "kind": "style",
      "ms": 2782.071250000001,
      "outputMs": 676.0138750000006
    },
    {
      "kind": "tsx",
      "ms": 1924.4346249999999,
      "outputMs": 1909.840542
    },
    {
      "kind": "style",
      "ms": 1826.0338329999977,
      "outputMs": 481.32383299999856
    },
    {
      "kind": "tsx",
      "ms": 2370.6163750000014,
      "outputMs": 2359.286583000001
    }
  ],
  "after": [
    {
      "kind": "startup",
      "ms": 67.215791
    },
    {
      "kind": "style",
      "ms": 162.88820800000002,
      "outputMs": 162.94354099999998
    },
    {
      "kind": "tsx",
      "ms": 163.13145900000006,
      "outputMs": 167.70916699999998
    },
    {
      "kind": "style",
      "ms": 161.376125,
      "outputMs": 163.80004099999996
    },
    {
      "kind": "tsx",
      "ms": 163.06333299999983,
      "outputMs": 163.1450829999999
    },
    {
      "kind": "style",
      "ms": 162.30012499999998,
      "outputMs": 167.43670800000018
    },
    {
      "kind": "tsx",
      "ms": 162.96958299999983,
      "outputMs": 166.4248329999998
    }
  ]
}
```
