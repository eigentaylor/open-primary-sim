// Shared display metadata for the 6 metrics, used by both the metric-vs-k
// small multiples and the headline comparison table so labels/formatting
// stay consistent across charts.

export const METRICS = [
  {
    key: 'maxC',
    label: 'Runoff competitiveness',
    shortLabel: 'Cᵢⱼ (max)',
    format: (v) => (v == null ? '—' : v.toFixed(3)),
    domain: null,
    isProbabilityLike: true,
    higherIsBetter: true,
  },
  {
    key: 'partyDiversity',
    label: 'Party diversity (P[both sides present])',
    shortLabel: 'Party div.',
    format: (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`),
    domain: [0, 1],
    isProbabilityLike: true,
    higherIsBetter: true,
  },
  {
    key: 'candidateDiversity',
    label: 'Candidate diversity (range / σ)',
    shortLabel: 'Cand. div.',
    format: (v) => (v == null ? '—' : v.toFixed(3)),
    domain: null,
    yFloor: 0,
    isProbabilityLike: false,
    higherIsBetter: true,
  },
  {
    key: 'consensusCapture',
    label: 'Consensus capture (P[CC advances])',
    shortLabel: 'CC capture',
    format: (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`),
    domain: [0, 1],
    isProbabilityLike: true,
    higherIsBetter: true,
  },
  {
    key: 'ccRank',
    label: 'Consensus place (avg. rank of CC)',
    shortLabel: 'CC place',
    format: (v) => (v == null ? '—' : v.toFixed(2)),
    domain: null,
    // Rank can't go below 1st place, so pin the axis floor there instead of
    // letting it fit down to the data min (which would still be >1 and
    // misleadingly suggest 1 is unreachable).
    yFloor: 1,
    isProbabilityLike: false,
    // Lower rank = the consensus candidate finished closer to 1st place in
    // the primary tally, i.e. lower is better here (unlike every other metric).
    higherIsBetter: false,
  },
  {
    key: 'vse',
    label: 'VSE-style score',
    shortLabel: 'VSE',
    format: (v) => (v == null ? 'N/A (insufficient candidate spread)' : `${v.toFixed(1)}%`),
    domain: null,
    isProbabilityLike: false,
    higherIsBetter: true,
  },
];

// %-vs-baseline display: relative percent normally; when the baseline value
// is ~0 (real for party-diversity/consensus-capture probabilities), a
// relative percent is undefined/misleading -- show a percentage-point
// difference instead.
const BASELINE_EPS = 1e-9;

export function formatDelta(value, baseline) {
  if (value == null || baseline == null) return '—';
  const diff = value - baseline;
  if (Math.abs(baseline) < BASELINE_EPS) {
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(3)} (abs., baseline ≈0)`;
  }
  const pct = (diff / Math.abs(baseline)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
